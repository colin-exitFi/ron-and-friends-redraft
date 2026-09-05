/**
 * Borrowing `data/draft-state-2026.json` without being the reason the league
 * loses its draft.
 *
 * ============================================================================
 * WHAT THIS IS PROTECTING AGAINST
 * ============================================================================
 *
 * Two recap harnesses need a FINISHED board to have anything to render, and the
 * real board holds keepers and no picks until Saturday. Both solved it the same
 * way: write a fixture over the live state file, drive the page, put the
 * original back in a `finally`.
 *
 * That is fine on a Tuesday and it is a live grenade on draft day. Three things
 * are wrong with `finally` as the only protection, and two of them have already
 * happened in this repo:
 *
 *   1. TWO RUNS INTERLEAVE. A second harness starts while the first has its
 *      fixture installed, "backs up" the fixture as though it were the live
 *      board, and restores that. The live board is now a completed mock draft
 *      and both scripts reported success. This bit a concurrent session: one of
 *      its runs silently reported POSTDRAFT because a fixture board was
 *      installed underneath it.
 *   2. THE PROCESS DIES. `finally` does not run for SIGKILL, and a plain `^C`
 *      only runs it if somebody wired SIGINT. The original was held in memory,
 *      so when the process goes, so does the only copy.
 *   3. IT OVERWRITES A DRAFT IN PROGRESS. At pick 40 on Saturday afternoon the
 *      live file is forty real picks. A harness that installs a fixture over it
 *      and restores three seconds later has still thrown away every pick the
 *      commissioner entered inside that window.
 *
 * ============================================================================
 * WHAT IT DOES INSTEAD
 * ============================================================================
 *
 *   REFUSES TO TOUCH A BOARD WITH PICKS ON IT. This is the guard that matters
 *   on the day. A harness has no business writing over a draft that is
 *   happening, and no amount of restoring makes it safe. `ALLOW_FIXTURE_OVER_LIVE_PICKS=1`
 *   exists as the deliberate override and is not something to reach for.
 *
 *   TAKES ONE LOCK. A second run refuses to start rather than backing up the
 *   first one's fixture. A lock whose owner is gone is reclaimed, not obeyed.
 *
 *   PUTS THE BACKUP ON DISK BEFORE THE FIRST WRITE, so the original survives
 *   the process. A later run finding a stale lock next to a backup restores it
 *   before doing anything else, which turns `kill -9` from "lost the board"
 *   into "the next run puts it back and says so".
 *
 *   RESTORES ON EVERY EXIT PATH — normal, thrown, rejected, SIGINT, SIGTERM,
 *   SIGHUP — and verifies the restore by SHA-256. A restore that does not
 *   verify keeps the backup, prints the one command that fixes it, and exits
 *   non-zero. The backup is never deleted until the bytes are confirmed back.
 *
 * The board is the one artefact in this repo that cannot be regenerated. It is
 * worth a file of its own.
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const DATA = path.join(process.cwd(), "data");
const LOCK = path.join(DATA, ".live-board-borrowed.lock");
const VAULT = path.join(DATA, ".live-board-vault");

/** The files a recap harness is allowed to borrow, and put back. */
const BORROWED = ["draft-state-2026.json", "draft-recap-2026.json"];

const sha = (file) =>
  existsSync(file)
    ? createHash("sha256").update(readFileSync(file)).digest("hex")
    : "absent";

const short = (digest) => (digest === "absent" ? "absent" : `${digest.slice(0, 12)}…`);

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Put back whatever is in the vault, whoever left it there.
 *
 * Deliberately usable on a vault this process did not create: that is the whole
 * crash-recovery path. Returns the files it restored.
 */
function emptyVault() {
  if (!existsSync(VAULT)) return [];
  const restored = [];
  for (const name of BORROWED) {
    const held = path.join(VAULT, `${name}`);
    const absent = path.join(VAULT, `${name}.was-absent`);
    const live = path.join(DATA, name);
    if (existsSync(held)) {
      copyFileSync(held, live);
      restored.push(name);
    } else if (existsSync(absent)) {
      rmSync(live, { force: true });
      restored.push(`${name} (removed — it did not exist before)`);
    }
  }
  return restored;
}

/** Everything in the vault is confirmed back on disk, byte for byte. */
function vaultVerified() {
  if (!existsSync(VAULT)) return true;
  for (const name of BORROWED) {
    const held = path.join(VAULT, name);
    const absent = path.join(VAULT, `${name}.was-absent`);
    const live = path.join(DATA, name);
    if (existsSync(held) && sha(held) !== sha(live)) return false;
    if (existsSync(absent) && existsSync(live)) return false;
  }
  return true;
}

/**
 * Recovers a vault left behind by a run that died, if its lock owner is gone.
 *
 * Runs before the picks check, deliberately: a leftover fixture board HAS picks
 * on it, so checking first would refuse to start and leave the fixture sitting
 * there for good.
 */
function recoverAbandoned() {
  if (!existsSync(VAULT)) return;

  if (existsSync(LOCK)) {
    let owner;
    try {
      owner = JSON.parse(readFileSync(LOCK, "utf8"));
    } catch {
      owner = null;
    }
    if (owner?.pid && isAlive(owner.pid) && owner.pid !== process.pid) return;
  }

  console.log("\n⚠  A previous run left the live board borrowed and did not put it back.");
  const restored = emptyVault();
  for (const name of restored) console.log(`   restored data/${name}`);
  if (!vaultVerified()) {
    console.error("   …and the restore did NOT verify. Stopping before making it worse.");
    console.error(`   The originals are in ${path.relative(process.cwd(), VAULT)} — copy them back by hand.`);
    process.exit(1);
  }
  rmSync(VAULT, { recursive: true, force: true });
  rmSync(LOCK, { force: true });
  console.log("   The board is back. Carrying on.\n");
}

function picksOnBoard() {
  const file = path.join(DATA, "draft-state-2026.json");
  if (!existsSync(file)) return 0;
  try {
    return JSON.parse(readFileSync(file, "utf8")).picks?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Takes the lock, vaults the live files and hands back a `putBack()`.
 *
 * `putBack` is idempotent and is wired to every exit path before this returns,
 * so a caller that forgets to call it is still safe; calling it explicitly only
 * makes the reporting tidier.
 */
export function borrowLiveBoard(who) {
  mkdirSync(DATA, { recursive: true });
  recoverAbandoned();

  if (existsSync(LOCK)) {
    let owner = null;
    try {
      owner = JSON.parse(readFileSync(LOCK, "utf8"));
    } catch {
      /* an unparseable lock is a dead lock */
    }
    if (owner?.pid && isAlive(owner.pid)) {
      console.error(
        `\nThe live board is already borrowed by ${owner.who ?? "another run"} ` +
          `(pid ${owner.pid}, since ${owner.since}).\n\n` +
          `Two harnesses writing fixtures over data/draft-state-2026.json at once is how\n` +
          `a mock draft ends up saved as the real one — the second run backs up the first\n` +
          `run's fixture and restores THAT. Wait for it to finish and run again.\n`,
      );
      process.exit(2);
    }
    rmSync(LOCK, { force: true });
  }

  const picks = picksOnBoard();
  if (picks > 0 && process.env.ALLOW_FIXTURE_OVER_LIVE_PICKS !== "1") {
    console.error(
      `\nRefusing to run: data/draft-state-2026.json has ${picks} picks on it.\n\n` +
        `This harness writes a fixture board over the live one. On a board that is\n` +
        `mid-draft that discards every pick entered while the fixture is installed,\n` +
        `and restoring afterwards does not bring those back.\n\n` +
        `If the draft is genuinely not running and you know what this file is:\n` +
        `  ALLOW_FIXTURE_OVER_LIVE_PICKS=1 <command>\n`,
    );
    process.exit(3);
  }

  // The vault first, the lock second: a lock with no vault behind it is a
  // promise to restore something nobody kept a copy of.
  mkdirSync(VAULT, { recursive: true });
  for (const name of BORROWED) {
    const live = path.join(DATA, name);
    if (existsSync(live)) copyFileSync(live, path.join(VAULT, name));
    else writeFileSync(path.join(VAULT, `${name}.was-absent`), "");
  }
  writeFileSync(
    LOCK,
    JSON.stringify(
      { pid: process.pid, who, since: new Date().toISOString() },
      null,
      2,
    ),
  );

  const before = Object.fromEntries(
    BORROWED.map((n) => [n, sha(path.join(DATA, n))]),
  );
  console.log(
    `Borrowed the live board (${who}). ` +
      `draft-state sha ${short(before["draft-state-2026.json"])}, ${picks} picks.`,
  );

  let done = false;
  /** Idempotent. Returns true when every borrowed file is verifiably back. */
  function putBack({ quiet = false } = {}) {
    if (done) return true;
    done = true;
    emptyVault();
    const ok = vaultVerified();
    if (ok) {
      rmSync(VAULT, { recursive: true, force: true });
      rmSync(LOCK, { force: true });
      if (!quiet) {
        console.log(
          `\nLive board restored. draft-state sha ` +
            `${short(sha(path.join(DATA, "draft-state-2026.json")))} ` +
            `(was ${short(before["draft-state-2026.json"])}).`,
        );
      }
    } else {
      console.error(
        `\n!! THE LIVE BOARD DID NOT RESTORE CLEANLY.\n` +
          `   The originals are still in ${path.relative(process.cwd(), VAULT)}.\n` +
          `   Put them back with:\n` +
          `     cp ${path.relative(process.cwd(), VAULT)}/draft-state-2026.json data/\n`,
      );
    }
    return ok;
  }

  /*
   * Every way out. `exit` is synchronous-only and is the last net under a
   * throw that nothing else caught; the signal handlers are what make ^C safe,
   * which plain `finally` never was.
   */
  process.on("exit", () => putBack({ quiet: true }));
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => {
      putBack();
      process.exit(130);
    });
  }
  process.on("uncaughtException", (err) => {
    putBack();
    console.error(err);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    putBack();
    console.error(err);
    process.exit(1);
  });

  return { putBack, digestBefore: before, picksBefore: picks };
}

/**
 * The board at `base` is one this vault could actually put back.
 *
 * CALL THIS BEFORE `borrowLiveBoard`. It reads nothing and writes nothing, and
 * a harness aimed at the wrong machine should be stopped before it takes a lock
 * over a file that has no bearing on where its picks are going.
 *
 * `borrowLiveBoard` vaults a local FILE. Point `BASE` at the deployment and the
 * board lives in Postgres instead: the reset would land on the league's real
 * draft, and the "restore" afterwards would put back a local file that had
 * nothing to do with it — a wipe reported as a clean run. Loopback only, with
 * no override, because a harness that wants to drive the deployment needs the
 * database-side snapshot in `verify-draft-two-clients.mjs`, not this one.
 */
export function assertLocalBase(base) {
  const origin = base.replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)) return origin;

  console.error(
    `\nRefusing to run against ${origin}.\n\n` +
      `This harness resets the board and puts it back from a copy of\n` +
      `data/draft-state-2026.json on this machine. A board that is not served by a\n` +
      `process on this machine is not that file — the reset would land on the real\n` +
      `draft and the restore would never reach it.\n\n` +
      `Point BASE at a local build on a throwaway port — not the dev server the\n` +
      `commissioner has open — and run it again.\n`,
  );
  process.exit(4);
}

/**
 * Nobody is drafting into the board at `base`.
 *
 * CALL THIS AFTER `borrowLiveBoard`, which recovers a fixture left behind by a
 * run that died. A leftover fixture has picks on it, so checking first would
 * refuse to start and strand it there.
 *
 * This duplicates the picks check inside `borrowLiveBoard` on purpose. That one
 * reads the file; this one asks the server, and is the only one of the two that
 * notices when the server is serving a board from somewhere the vault cannot
 * see — a different working directory, or the database store.
 */
export async function assertServerHasNoPicks(base) {
  const origin = base.replace(/\/+$/, "");

  let view;
  try {
    ({ view } = await (await fetch(`${origin}/api/draft/state`, { cache: "no-store" })).json());
  } catch (err) {
    console.error(
      `\nCould not read ${origin}/api/draft/state: ${err.message}\n` +
        `Start the local build this harness needs before running it.\n`,
    );
    process.exit(5);
  }

  /*
   * `view.picksMade` — entered picks, keepers excluded — and not a filter over
   * the slots. A filter here would want to say `s.player && !s.isKeeper`, and
   * `isKeeper` is not a field on a `LiveSlot` (`fill` is, and it reads
   * "keeper" | "pick" | null), so that expression is `s.player && true` and
   * counts all nineteen keepers as entered picks. Harmless while such a number
   * is only being printed. Not harmless as the thing deciding whether a wipe is
   * safe: it would refuse every run, and the first person to "fix" it would
   * reach for the override.
   */
  if (view.picksMade > 0) {
    console.error(
      `\nRefusing to run: the board at ${origin} has ${view.picksMade} entered pick(s).\n\n` +
        `This harness resets the board in order to seed a known one. Against a draft\n` +
        `in progress that is a wipe, and putting the file back afterwards does not\n` +
        `recover a pick entered while the harness owned the board.\n\n` +
        `Keepers are not picks and do not trip this — ${view.keeperCount} of them are on the\n` +
        `board right now, and a reset leaves every one of them alone.\n`,
    );
    process.exit(3);
  }

  return view;
}

/** How many fixture boards are sitting in `data/draft-backups`, for reporting. */
export function backupCount() {
  const dir = path.join(DATA, "draft-backups");
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith(".json")).length;
}

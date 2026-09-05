/**
 * Two boards, two browsers, one draft.
 *
 *   BASE=https://ron-and-friends-redraft.vercel.app npm run verify:draft:remote
 *
 * That deployed URL is the one the league actually drafts on, so it is the one
 * worth proving. It is NOT `ultimate-keeper-league.vercel.app`, which this line
 * named until the fork: that deployment is still up and still answers, so
 * pointing this at it proves sync on a board nobody is using. A local
 * production build works too:
 *
 *   BASE=http://127.0.0.1:3131 npm run verify:draft:remote
 *
 * Everything else about the live sync can be checked by reading code or poking
 * Postgres. This cannot: that a pick typed by the person in the room appears on
 * a remote manager's board, without a reload, WITHOUT EATING WHAT THAT MANAGER
 * IS HALFWAY THROUGH TYPING.
 *
 * That last clause is the entire reason the board does not call
 * `router.refresh()`, and a test that only checked propagation would pass just
 * as happily on the implementation that loses keystrokes. So it is asserted
 * directly, in order of how expensive each is to get wrong on Saturday:
 *
 *   1. a pick entered in A appears in B, and B never navigated to get it
 *   2. a pick arriving from A leaves a half-typed name in B intact and still live
 *   3. B's own pick reaches A — the sync is not one-way
 *
 * RUN AGAINST A PRODUCTION BUILD (`next build && next start`) with
 * DRAFT_STORE=database. Not `next dev`: HMR reloads the page on its own, which
 * both breaks claim 1's "never navigated" check and makes the first API call
 * slow enough to look like a failed pick. And not the file store, which is one
 * process's disk with nothing to synchronise.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 * There is no test season to hide in: `DRAFT_STORE=database` means the real
 * `draft_live_state` row for the real season, and `BASE` makes no difference to
 * that — a local build reads the same Supabase project the deployment does.
 *
 * This used to end by POSTing `{"confirm":"RESET"}` in its `finally` and
 * calling that the cleanup. On a keepers-only board a reset happens to land on
 * roughly what was already there, which is why it looked harmless. Run as the
 * pre-draft sanity check it is at 6:50 on Saturday, with picks on the board, it
 * is a wipe nobody asked for — and the restore point it leaves behind is one
 * `undoLast` on somebody else's device away from being spent.
 *
 * So, the same shape as `verify-draft-typing.mjs` and
 * `verify-fantasypros-banner.mjs`:
 *
 *   1. It REFUSES TO RUN if the board has any entered pick on it. Keepers are
 *      fine — they come from the snapshot and this script cannot touch them.
 *   2. The `draft_live_state` rows are read before anything is written and put
 *      back on every exit path, verified by SHA-256 rather than assumed.
 *
 * The restore is a plain update rather than a reset, so nothing is archived,
 * nothing fabricates a restore point, and the board comes back byte-identical.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

import { DB_SCHEMA } from "../src/lib/db-schema.mjs";
import { createHash } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:3131";
const VIEWPORT = { width: 1600, height: 1000 };

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}\n${"─".repeat(t.length)}`);

/** Types with nothing focused, which is how the board expects to be driven. */
async function typeAtDocument(page, text) {
  for (const char of text) {
    await page.keyboard.press(char === " " ? "Space" : char);
    await page.waitForTimeout(15);
  }
}

/**
 * Whether a surname is drawn in a BOARD CELL.
 *
 * Deliberately not a count of filled cells: an empty cell belonging to a traded
 * pick renders as "1.08 ZACH", so a naive "has more text than its label" filter
 * counts dozens of things on a board that has only keepers on it. Scoping to
 * `[data-slot-id]` and looking for the actual name is both precise and the thing
 * worth proving.
 */
const cellHasPlayer = (page, surname) =>
  page.evaluate(
    (name) =>
      [...document.querySelectorAll("[data-slot-id]")].some((c) =>
        c.innerText.toUpperCase().includes(name.toUpperCase()),
      ),
    surname,
  );

/**
 * Entered picks, keepers excluded — the number the precondition turns on.
 *
 * `view.picksMade` rather than a filter over the slots. The filter here read
 * `s.player && !s.isKeeper`, and `isKeeper` is not a field on a `LiveSlot`
 * (`fill` is), so it was `s.player && true` and counted all 19 keepers as
 * entered picks. Harmless while the number was only being printed. Not harmless
 * as the thing deciding whether a wipe is safe.
 */
async function serverPicks() {
  const res = await fetch(`${BASE}/api/draft/state`, { cache: "no-store" });
  const { view } = await res.json();
  return view.picksMade;
}

async function waitFor(fn, ms = 20_000, step = 250) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, step));
  }
  return false;
}

// --- The live board, borrowed -----------------------------------------------

/*
 * Nothing below this writes until the two checks here have passed: that the
 * board is safe to draft into, and that it can be put back afterwards.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error(
    "This test enters real picks into the shared draft board, and it will not do\n" +
      "that without the credentials to put the board back. Set\n" +
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (they are in\n" +
      ".env.local, which the npm script already loads) and run it again.",
  );
  process.exit(1);
}

/*
 * `db.schema`: this snapshots and RESTORES the real draft board, so a client
 * on the wrong schema would read an empty snapshot, "restore" it over the live
 * row, and report success. The one test that borrows the live board has to be
 * the most certain about which board it is holding.
 */
const db = createClient(url, service, {
  db: { schema: DB_SCHEMA },
  auth: { persistSession: false },
});

const entered = await serverPicks().catch((err) => {
  console.error(`Could not read ${BASE}/api/draft/state: ${err.message}`);
  console.error("Start the production build this test needs before running it.");
  process.exit(1);
});

if (entered > 0) {
  console.error(
    `REFUSING TO RUN. The board has ${entered} entered pick(s) on it.\n\n` +
      "This test drafts Barkley, Kelce and Daniels into the real board and then\n" +
      "puts the whole row back as it found it. That is safe on an empty board and\n" +
      "it is not something to be doing to a draft in progress — the picks it\n" +
      "enters would be interleaved with real ones, and the restore would take the\n" +
      "real ones with it.\n\n" +
      "If the draft is over, read the board out of draft_live_backups first.",
  );
  process.exit(1);
}

/**
 * Every row of `draft_live_state`, before this test writes anything.
 *
 * Unfiltered on purpose: the season lives in the row, so snapshotting whatever
 * is there cannot be wrong about which season the app is writing to.
 */
const { data: snapshot, error: snapshotError } = await db
  .from("draft_live_state")
  .select("season, state, revision");
if (snapshotError) {
  console.error(`Could not snapshot draft_live_state: ${snapshotError.message}`);
  process.exit(1);
}

const digest = (rows) =>
  createHash("sha256")
    .update(JSON.stringify([...rows].sort((a, b) => a.season - b.season).map((r) => [r.season, r.state])))
    .digest("hex");
const before = digest(snapshot);
console.log(`Live board sha256 before: ${before.slice(0, 16)}… (${snapshot.length} row(s))`);

let restored = false;
/**
 * Put the rows back exactly as they were.
 *
 * `revision` is deliberately NOT rewound. It is a conflict token, not part of
 * the board: the store re-reads it before every write, and handing back a
 * number the running server has already moved past would refuse the next real
 * pick. The state is what has to be identical, and it is.
 */
async function restore() {
  if (restored) return;
  restored = true;

  const { data: now } = await db.from("draft_live_state").select("season, revision");
  const seasonsNow = new Set((now ?? []).map((r) => r.season));

  for (const row of snapshot) {
    const live = (now ?? []).find((r) => r.season === row.season);
    const next = Math.max(row.revision, live?.revision ?? 0) + 1;
    const payload = {
      season: row.season,
      state: row.state,
      revision: next,
      updated_at: row.state?.updatedAt ?? new Date().toISOString(),
    };
    const { error } = live
      ? await db.from("draft_live_state").update(payload).eq("season", row.season)
      : await db.from("draft_live_state").insert(payload);
    if (error) {
      console.error(`  RESTORE FAILED for season ${row.season}: ${error.message}`);
      console.error("  Recover the board from draft_live_backups before Saturday.");
    }
    seasonsNow.delete(row.season);
  }

  // A season this test caused to exist. Leaving one behind is its own change.
  for (const orphan of seasonsNow) {
    await db.from("draft_live_state").delete().eq("season", orphan);
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    void restore().finally(() => process.exit(130));
  });
}
process.on("uncaughtException", (err) => {
  void restore().finally(() => {
    console.error(err);
    process.exit(1);
  });
});
/*
 * The last net, and it can only shout: an `exit` handler cannot await the
 * database. Every path that CAN restore does so above; this is here so a path
 * that somehow did not can never be mistaken for a clean run.
 */
process.on("exit", () => {
  if (!restored) {
    console.error(
      "\n!! THE DRAFT BOARD WAS NOT RESTORED. Test picks may still be on it.\n" +
        "!! Check /draft and recover from draft_live_backups if needed.\n",
    );
  }
});

const browser = await chromium.launch();
/** Separate contexts: genuinely two devices, two websockets, two sessions. */
const ctxA = await browser.newContext({ viewport: VIEWPORT });
const ctxB = await browser.newContext({ viewport: VIEWPORT });
const A = await ctxA.newPage();
const B = await ctxB.newPage();

let navsB = 0;
B.on("framenavigated", (f) => {
  if (f === B.mainFrame()) navsB++;
});

/**
 * The three players this test enters, and the strings it types to find them.
 *
 * NONE OF THEM MAY ALREADY BE ON THE BOARD, and that is checked below rather
 * than assumed. This asked for Jayden Daniels as B's pick, and he has since
 * been declared a keeper at 9.03 — so B's Enter raised the duplicate warning
 * instead of drafting, and the two checks that follow it went on passing
 * against the KEEPER'S cell. "B's own pick reached A" was reading a player who
 * had been sitting on A's board since before the test started. Keeper
 * declarations move right up to the draft, so the guard is the fix and swapping
 * the name is only half of it.
 */
const CAST = [
  { typed: "saquon", name: "Saquon Barkley", surname: "Barkley" },
  { typed: "kelce", name: "Travis Kelce", surname: "Kelce" },
  { typed: "gibbs", name: "Jahmyr Gibbs", surname: "Gibbs" },
];

const { view: liveView } = await (
  await fetch(`${BASE}/api/draft/state`, { cache: "no-store" })
).json();
const alreadyOnBoard = CAST.filter((p) =>
  liveView.slots.some((s) => s.player?.name === p.name),
);
if (alreadyOnBoard.length) {
  console.error(
    `REFUSING TO RUN. ${alreadyOnBoard.map((p) => p.name).join(", ")} is already on ` +
      `the board — a keeper, most likely.\n\n` +
      "This test proves a pick propagates by watching a cell fill with a name.\n" +
      "A name that is ALREADY in a cell makes that check pass without anything\n" +
      "having propagated, and the Enter that was supposed to draft him raises the\n" +
      "duplicate warning instead. Pick players nobody is keeping and update CAST.",
  );
  process.exit(1);
}

try {
  section("Setup — two boards on the shared database store");
  console.log(`  picks on the board before the test: ${await serverPicks()}`);
  console.log(`  entering: ${CAST.map((p) => p.name).join(", ")}`);

  await A.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await B.goto(`${BASE}/draft`, { waitUntil: "networkidle" });

  /*
   * THE BOARD'S FOOTER NO LONGER EXISTS — it was deleted deliberately (see the
   * note in `final-board.tsx`), and the live indicator moved into the header.
   * This used to read `footer`, which meant the whole test aborted on a locator
   * timeout before asserting a single thing about syncing.
   */
  /*
   * SCOPED TO THE DOT, NOT TO `header`. The page has two headers — the app
   * shell's nav is first in the DOM — so `textContent("header")` read
   * "Open navigation…" and never saw the board's status at all. The dot's
   * tooltip is unique to it, which makes it the one honest handle.
   */
  const dot = '[title*="Picks are saved to"]';
  const dotLabel = async (page) => (await page.textContent(dot).catch(() => "")) ?? "";
  const dotTitle = async (page) => (await page.getAttribute(dot, "title").catch(() => "")) ?? "";

  check("picks save to the league database", (await dotTitle(A)).includes("the league database"));

  /*
   * The indicator only renders when `savesAreShared()` is true, so its presence
   * is also proof the deployment-shaped config resolved to the database store.
   *
   * "live" specifically, NOT merely that picks arrive: the fallback poll would
   * carry them too, a full ten seconds later, and a test that accepted either
   * could not tell a working socket from a broken one.
   */
  const isLive = async (page) => (await dotLabel(page)).includes("live");
  check("board A opened a live subscription", await waitFor(() => isLive(A), 20_000));
  check("board B opened a live subscription", await waitFor(() => isLive(B), 20_000));

  const navsAtStart = navsB;

  section("1. A pick entered in A reaches B");
  await typeAtDocument(A, CAST[0].typed);
  await A.waitForTimeout(500);
  check(
    `typing "${CAST[0].typed}" matched ${CAST[0].name} in A`,
    (await A.textContent("body")).includes(CAST[0].name),
  );

  await A.keyboard.press("Enter");
  check(
    "A shows its own pick in a cell",
    await waitFor(() => cellHasPlayer(A, CAST[0].surname), 10_000),
  );

  check(
    "B shows it too, having been told rather than asked",
    await waitFor(() => cellHasPlayer(B, CAST[0].surname), 20_000),
  );
  check(
    "…and B never navigated to get it",
    navsB === navsAtStart,
    `${navsB - navsAtStart} navigation(s)`,
  );

  section("2. An incoming pick does not eat what B is typing");
  /*
   * The hazard the migration warned about. B starts a name, a pick lands from A
   * while those keystrokes are still uncommitted, and the question is whether
   * B's half-typed name survives. Under `router.refresh()` it would not.
   */
  await typeAtDocument(B, CAST[2].typed);
  await B.waitForTimeout(500);
  check(
    `B has an uncommitted "${CAST[2].name}" match on screen`,
    (await B.textContent("body")).includes(CAST[2].name),
  );

  await typeAtDocument(A, CAST[1].typed);
  await A.waitForTimeout(500);
  const matchedSecond = (await A.textContent("body")).includes(CAST[1].name);
  check(`A matched ${CAST[1].name}`, matchedSecond);

  if (matchedSecond) {
    await A.keyboard.press("Enter");

    const bGotSecond = await waitFor(() => cellHasPlayer(B, CAST[1].surname), 20_000);
    check("B received A's second pick", bGotSecond);

    check(
      "B's half-typed name SURVIVED the incoming pick",
      (await B.textContent("body")).includes(CAST[2].name),
    );

    // Committing it proves the match was still live state, not a stale painting.
    await B.keyboard.press("Enter");
    check(
      "B could still commit the name it had been typing",
      await waitFor(() => cellHasPlayer(B, CAST[2].surname), 10_000),
    );

    section("3. The sync is not one-way");
    check(
      "B's own pick reached A",
      await waitFor(() => cellHasPlayer(A, CAST[2].surname), 20_000),
    );
    /*
     * All three, on the server, counted. Every check above is satisfied by a
     * name being DRAWN somewhere, and the optimistic board draws a pick the
     * instant it is typed — so a pick the server refused looks identical to one
     * it kept until somebody asks the server. This is that question, and it is
     * how the keeper collision above was eventually noticed: three Enters were
     * leaving two picks on the board and every check was green.
     */
    check(
      `all ${CAST.length} picks are on the SERVER, not just drawn`,
      (await serverPicks()) === CAST.length,
      `${await serverPicks()} of ${CAST.length}`,
    );
  }

  console.log(`\n  picks on the board at the end: ${await serverPicks()}`);
} finally {
  // Before the browser, so a close that throws or hangs cannot get between the
  // board and its restore.
  section("The live draft board is back exactly as it was");
  await restore();
  await browser.close();

  const { data: after, error: afterError } = await db
    .from("draft_live_state")
    .select("season, state, revision");
  if (afterError) {
    check("re-read draft_live_state to verify the restore", false, afterError.message);
  } else {
    check(
      "sha256 of the stored draft board is unchanged by the whole run",
      digest(after) === before,
      `${before.slice(0, 12)}… → ${digest(after).slice(0, 12)}…`,
    );
    check(
      "no test picks left on the board",
      (await serverPicks()) === 0,
      `${await serverPicks()} entered pick(s)`,
    );
  }
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

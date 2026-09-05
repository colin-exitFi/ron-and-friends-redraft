import "server-only";

import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  fsyncSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { clearedState, emptyState, isDraftStateFile } from "@/lib/draft-engine";
import { SupabaseDraftStore } from "@/lib/draft-store-db";
import { hasDatabase } from "@/lib/env";
import type { DraftStateFile } from "@/lib/draft-types";

/**
 * Where the draft lives between requests.
 *
 * TWO BACKENDS, ONE INTERFACE. Where there is a writable disk the board is a
 * JSON file under `data/`; where there is not — a deployment, whose filesystem
 * is read-only and whose first write returned `EROFS` and lost the pick — it is
 * a row in Postgres (`@/lib/draft-store-db`). Both write the same document, so
 * a board can be carried from one to the other by copying the JSON, and nothing
 * above this module — not the API routes, not the UI — can tell which one it is
 * talking to. See `store()` at the foot of the file for how one is chosen.
 *
 * The file is written the way you write a file you cannot afford to lose: to a
 * temporary path in the same directory, fsynced, then renamed over the target.
 * Rename is atomic on the same filesystem, so a crash mid-write leaves either
 * the previous complete file or the new complete file, never a half one. Every
 * write also drops a timestamped copy in `data/draft-backups/`, which is the
 * difference between "reboot and carry on" and "re-enter 90 picks from memory
 * in front of ten people". The database store keeps the same discipline in
 * `draft_live_backups`.
 */
export interface DraftStore {
  /** Never throws for "no draft yet" — that case returns a fresh empty state. */
  read(season: number, boardFingerprint: string): Promise<DraftStateFile>;
  /**
   * Saves `state`, which the caller derived from `base` — the state it read a
   * moment ago. Naming the base is what lets the database store refuse a write
   * that would overwrite somebody else's pick; the file store, which is one
   * laptop with one writer, ignores it.
   *
   * Prefer `mutate` for anything that reads the board in order to change it.
   * A `read` and a `write` are two separate turns of the queue, so on the file
   * store two of them can interleave and the second write silently drops the
   * first one's pick.
   */
  write(state: DraftStateFile, base: DraftStateFile): Promise<void>;
  /**
   * Read the board, apply `change` to it, save the result — with nothing else
   * able to write in between. Returns what was saved.
   *
   * THE WHOLE POINT IS THE WORD "BETWEEN". Both stores serialise their writes,
   * which is not the same thing as serialising a read-modify-write: with a
   * `read` and a `write` each taking their own turn, `readA readB writeA writeB`
   * is reachable, and B saves a board it computed before A's pick existed. On
   * the database store the conditional write catches it and refuses B — one
   * pick has to be re-entered, but nothing is lost quietly. On the file store,
   * which is the one the commissioner's laptop uses, `base` was ignored and A's
   * pick simply disappeared after A's caller had already been told `ok: true`.
   *
   * `change` is pure and may throw — a `DraftRuleError` for a refused pick —
   * in which case nothing is written and the lock is released.
   */
  mutate(
    season: number,
    boardFingerprint: string,
    change: (state: DraftStateFile) => DraftStateFile,
  ): Promise<DraftStateFile>;
  /** Archives the current state and starts over. Used only by the reset route. */
  clear(season: number, boardFingerprint: string): Promise<DraftStateFile>;
  /** Where a save lands, for the reassurance line in the board's footer. */
  location(season: number): string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const BACKUP_DIR = path.join(DATA_DIR, "draft-backups");
/** Enough to cover a whole draft twice over; old ones are pruned. */
const BACKUPS_KEPT = 400;

function stateFile(season: number): string {
  return path.join(DATA_DIR, `draft-state-${season}.json`);
}

/**
 * Serialises access within the process. Next.js can run two route handlers
 * concurrently, and two picks landing at once must not interleave a
 * read-modify-write.
 *
 * ONE TURN PER MUTATION, NOT ONE PER FILE OPERATION. This used to be taken by
 * `read` and by `write` separately, which serialises each half and leaves the
 * whole unprotected — see `DraftStore.mutate`, which is what holds the queue
 * across both. Nothing inside a turn may call back into here: the inner call
 * would wait on the turn it is already inside, and the draft would hang.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function writeAtomic(target: string, contents: string) {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(tmp, contents, "utf8");
    // Flush the bytes before the rename, or the rename can land ahead of the data.
    const fd = openSync(tmp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === "EROFS" || code === "EACCES" || code === "EPERM") {
      throw new Error(
        `The board cannot be saved: ${target} is not writable. This is what a ` +
          `deployment's read-only filesystem looks like — set the Supabase ` +
          `environment variables so picks are saved to the league database ` +
          `instead, or run the board locally.`,
        { cause },
      );
    }
    throw cause;
  }
}

function backup(season: number, contents: string) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(path.join(BACKUP_DIR, `draft-state-${season}-${stamp}.json`), contents, "utf8");

  const mine = readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(`draft-state-${season}-`) && f.endsWith(".json"))
    .sort();
  for (const stale of mine.slice(0, Math.max(0, mine.length - BACKUPS_KEPT))) {
    try {
      rmSync(path.join(BACKUP_DIR, stale));
    } catch {
      // A backup we could not prune is not a reason to fail a pick.
    }
  }
}

/*
 * The two halves of the file store, WITHOUT the lock.
 *
 * Lifted out so a caller can take one turn of the queue and do both inside it.
 * Neither of these may call `serialize` — see the note there. Everything that
 * reaches them goes through a method that has already taken the turn.
 */
function loadState(season: number, boardFingerprint: string): DraftStateFile {
  const file = stateFile(season);
  if (!existsSync(file)) return emptyState(season, boardFingerprint);
  const raw = readFileSync(file, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `The draft state at data/draft-state-${season}.json is not valid JSON. ` +
        `A timestamped copy of every previous save is in data/draft-backups/ — ` +
        `copy the newest good one over it to recover.`,
      { cause },
    );
  }
  if (!isDraftStateFile(parsed)) {
    throw new Error(
      `The draft state at data/draft-state-${season}.json is not a draft state file. ` +
        `Recover from data/draft-backups/ rather than deleting it.`,
    );
  }
  return parsed;
}

function saveState(state: DraftStateFile): void {
  const contents = `${JSON.stringify(state, null, 2)}\n`;
  writeAtomic(stateFile(state.season), contents);
  backup(state.season, contents);
}

class JsonFileDraftStore implements DraftStore {
  async read(season: number, boardFingerprint: string): Promise<DraftStateFile> {
    return serialize(() => loadState(season, boardFingerprint));
  }

  /**
   * One laptop, one writer: there is nothing for `base` to protect against —
   * PROVIDED the read it was derived from is inside the same lock as this
   * write, which is what `mutate` is for and what every mutation goes through.
   */
  async write(state: DraftStateFile): Promise<void> {
    return serialize(() => saveState(state));
  }

  async mutate(
    season: number,
    boardFingerprint: string,
    change: (state: DraftStateFile) => DraftStateFile,
  ): Promise<DraftStateFile> {
    return serialize(() => {
      const next = change(loadState(season, boardFingerprint));
      saveState(next);
      return next;
    });
  }

  async clear(season: number, boardFingerprint: string): Promise<DraftStateFile> {
    return serialize(() => {
      const file = stateFile(season);
      // A board too corrupt to parse is exactly when somebody reaches for
      // reset, so a failed read must not block the wipe. It only costs the
      // restore point: there is no sound way to offer to put back picks we
      // cannot read.
      let previous: DraftStateFile | null = null;
      try {
        previous = loadState(season, boardFingerprint);
      } catch {
        previous = null;
      }

      // Reset is destructive by definition, so the pre-reset board is archived
      // before it goes. Nothing is ever deleted outright.
      if (existsSync(file)) backup(season, readFileSync(file, "utf8"));

      const cleared = previous
        ? clearedState(previous, season, boardFingerprint)
        : emptyState(season, boardFingerprint);
      saveState(cleared);
      return cleared;
    });
  }

  location(season: number): string {
    return path.relative(process.cwd(), stateFile(season));
  }
}

/** Whether this machine will let us save a file where the board goes. */
function dataDirIsWritable(): boolean {
  try {
    accessSync(existsSync(DATA_DIR) ? DATA_DIR : process.cwd(), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Which store this process gets.
 *
 * THE DISK WINS WHERE THERE IS ONE. On the commissioner's laptop the board must
 * keep working with the venue's wifi unplugged, so a writable `data/` means the
 * file store even when Supabase credentials are sitting in `.env.local`. A
 * deployment has no writable disk, and that is precisely where the database
 * store belongs — it is also the only way two phones see one draft.
 *
 * `DRAFT_STORE=file` or `DRAFT_STORE=database` overrides the detection, for the
 * case where the guess is wrong and it is 7pm on a Saturday.
 *
 * Resolved once per process, because the database store is stateful: it
 * remembers the revision each state was read at, so it must not be rebuilt
 * between a read and its write.
 */
let backend: DraftStore | null = null;
function store(): DraftStore {
  if (backend) return backend;

  const forced = process.env.DRAFT_STORE?.toLowerCase();
  if (forced === "database") backend = new SupabaseDraftStore();
  else if (forced === "file") backend = new JsonFileDraftStore();
  else if (dataDirIsWritable()) backend = new JsonFileDraftStore();
  else if (hasDatabase()) backend = new SupabaseDraftStore();
  // Nowhere to save. The file store's write says so in as many words, which is
  // a better failure than a store that pretends to have saved a pick.
  else backend = new JsonFileDraftStore();

  return backend;
}

export const draftStore: DraftStore = {
  read: (season, boardFingerprint) => store().read(season, boardFingerprint),
  write: (state, base) => store().write(state, base),
  mutate: (season, boardFingerprint, change) =>
    store().mutate(season, boardFingerprint, change),
  clear: (season, boardFingerprint) => store().clear(season, boardFingerprint),
  location: (season) => store().location(season),
};

/** Exposed for the report / the UI's "the board is saved" reassurance line. */
export function draftStateLocation(season: number): string {
  return store().location(season);
}

/**
 * Whether picks land somewhere the OTHER DEVICES IN THE DRAFT CAN SEE.
 *
 * True only for the database store. The file store is one laptop's disk: a
 * second board reading it would be reading a different draft, so there is
 * nothing to subscribe to and no honest way to show a "live" indicator.
 *
 * The draft board asks this before opening a Realtime channel. Claiming to be
 * live while picks go to a local file is the single most expensive lie this UI
 * could tell — a manager would watch a board that cannot ever update and assume
 * it was simply nobody's turn.
 */
export function draftStoreIsShared(): boolean {
  return store() instanceof SupabaseDraftStore;
}

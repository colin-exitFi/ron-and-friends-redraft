import "server-only";

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  isMockDraftFile,
  type MockDraftFile,
} from "@/lib/mock-draft-types";

/**
 * Where a mock draft is parked between page loads.
 *
 * ============================================================================
 * THIS MODULE EXISTS TO BE UNABLE TO TOUCH THE LIVE BOARD
 * ============================================================================
 *
 * `data/draft-state-2026.json` is Saturday's board. It holds the league's
 * keepers pre-placed and zero entered picks. A mock fills every remaining
 * draftable slot, and one of those picks landing in that file is found out at
 * the table in front of ten people.
 *
 * The protection is not a check. A check was tried and it was worthless: the
 * obvious one is "refuse if the live board already has picks", which passes
 * cheerfully every time, because the live board is legitimately empty right up
 * until the draft starts. A condition that is true when you need it to be false
 * is not a safeguard, it is a decoration.
 *
 * So instead:
 *
 *  1. THE FILENAME CANNOT BE THE LIVE ONE. `mockStateFile` builds its path from
 *     a string literal that contains `mock-draft-state-`. There is no parameter,
 *     no template hole and no configuration value anywhere in this module that
 *     could make it produce `draft-state-2026.json`. The only variable part is
 *     the season number.
 *
 *  2. THIS MODULE DOES NOT KNOW HOW TO WRITE LIVE STATE. It does not import
 *     `@/lib/draft-store`, `@/lib/draft-service`, or anything from
 *     `@/lib/supabase`. It cannot call the live writer because the live writer
 *     is not in scope. `verify:mock` asserts this by reading the imports of
 *     every file in the mock feature rather than by trusting this paragraph.
 *
 *  3. THE SHAPES ARE MUTUALLY UNREADABLE. `MockDraftFile.version` is the string
 *     `"mock-1"`. `isDraftStateFile` requires the number `1`, so a mock file
 *     fed to the live loader is rejected loudly instead of loading as a board
 *     with 142 picks on it. `isMockDraftFile` requires a `kind` field that live
 *     state does not have, so the reverse fails too. And `MockDraftFile` is not
 *     assignable to `DraftStateFile`, so `draftStore.write(mock)` does not
 *     compile.
 *
 *  4. THERE IS A RUNTIME ASSERTION ANYWAY, because the cost of one string
 *     comparison is nothing and the cost of being wrong is the draft.
 *
 * Nothing here writes to Postgres. Mock picks never reach a database: this is
 * the only I/O in the mock feature and it is a single JSON file.
 *
 * No atomic-rename ceremony beyond a temp file and a rename, and no backup
 * directory. The live store keeps 400 timestamped copies of the real board
 * because losing it means re-entering 90 picks from memory. A mock is disposable
 * by definition — the "recovery" for a corrupt mock is to press Restart.
 */

const DATA_DIR = path.join(process.cwd(), "data");

/**
 * The one filename this module can produce. The `mock-draft-state-` prefix is
 * a literal in the source; only the season varies.
 */
function mockStateFile(season: number): string {
  return path.join(DATA_DIR, `mock-draft-state-${season}.json`);
}

/** The live board's path, computed here ONLY so it can be refused. */
function liveStateFileForComparison(season: number): string {
  return path.join(DATA_DIR, `draft-state-${season}.json`);
}

/**
 * Belt and braces on top of three structural guarantees. If this ever throws,
 * something has gone very wrong and stopping is the correct behaviour.
 */
function assertNotTheLiveBoard(target: string, season: number): void {
  const base = path.basename(target);
  if (!base.startsWith("mock-draft-state-")) {
    throw new Error(
      `Refusing to write mock draft state to "${base}" — a mock may only ever ` +
        `write a file whose name begins with "mock-draft-state-".`,
    );
  }
  if (path.resolve(target) === path.resolve(liveStateFileForComparison(season))) {
    throw new Error(
      "Refusing to write mock draft state over the live draft board. " +
        "This should be unreachable; treat it as a bug in mock-draft-store.",
    );
  }
}

/** Relative path, for the UI's "this is where the mock lives" reassurance line. */
export function mockStateLocation(season: number): string {
  return path.relative(process.cwd(), mockStateFile(season));
}

export function readMockDraft(season: number): MockDraftFile | null {
  const file = mockStateFile(season);
  if (!existsSync(file)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    // A file that is not a mock file is discarded rather than adapted. In
    // particular this is what rejects live draft state if it ever appeared here.
    return isMockDraftFile(parsed) ? parsed : null;
  } catch {
    // A corrupt mock is not worth recovering. Say nothing and start fresh.
    return null;
  }
}

export function writeMockDraft(state: MockDraftFile): void {
  const target = mockStateFile(state.season);
  assertNotTheLiveBoard(target, state.season);

  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  renameSync(tmp, target);
}

export function clearMockDraft(season: number): void {
  const target = mockStateFile(season);
  assertNotTheLiveBoard(target, season);
  rmSync(target, { force: true });
}

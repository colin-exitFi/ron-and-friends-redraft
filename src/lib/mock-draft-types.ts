/**
 * Types for a MOCK draft — a rehearsal against the real board that must never
 * touch the real board's state.
 *
 * ============================================================================
 * WHY THESE TYPES EXIST AT ALL, RATHER THAN REUSING THE LIVE DRAFT'S
 * ============================================================================
 *
 * `data/draft-state-2026.json` is the live board for Saturday. It holds 18
 * keepers and zero entered picks, and it must still hold exactly that after any
 * number of mocks. A mock generates ~142 picks; one of them reaching that file
 * is discovered at the table in front of ten people.
 *
 * A guard is not good enough. The obvious guard — "refuse to run if the board
 * already has picks" — passes happily, because the real board is legitimately
 * empty right up until the draft starts. That check has already nearly caused
 * this exact accident. So the separation here is STRUCTURAL, in three
 * independent ways, and none of them is a runtime condition that could be true
 * at the wrong moment:
 *
 *  1. A DIFFERENT FILE. Mock state persists to `mock-draft-state-<season>.json`
 *     via `@/lib/mock-draft-store`, which does not import `@/lib/draft-store`
 *     and has no expression anywhere in it that can evaluate to the live
 *     board's filename.
 *
 *  2. A DIFFERENT SHAPE, CHECKED BOTH WAYS. `version` is the string `"mock-1"`,
 *     never the number `1`. `isDraftStateFile` in `@/lib/draft-engine` requires
 *     `version === 1`, so a mock file handed to the live loader is REFUSED,
 *     loudly, instead of loading as a board with 142 picks on it. And
 *     `MockDraftFile` is not assignable to `DraftStateFile`, so
 *     `draftStore.write(mock)` does not compile. The reverse holds too:
 *     `isMockDraftFile` requires `kind`, which live state does not carry.
 *
 *  3. NO WRITE PATH AT ALL DURING PLAY. The mock runs entirely in the browser
 *     against pure functions. Making a pick calls no API route, so there is no
 *     request in flight that could be aimed at the wrong endpoint. Persistence
 *     is a separate, debounced snapshot of the whole mock, not a per-pick write.
 *
 * Nothing here is ever written to Postgres. `@/lib/mock-draft-store` is the
 * only module in the feature that performs I/O, and it uses `node:fs`.
 *
 * Free of `server-only` and of I/O so the browser can import it.
 */

import type { BoardPlayer } from "@/lib/board-types";

/**
 * What the browser needs to run the mock: the autocomplete's fields plus the
 * bye week the roster card prints, plus ADP, which is the whole basis of the
 * AI's judgement.
 *
 * Shaped to satisfy `Searchable` in `@/lib/draft-search` so the mock gets the
 * real board's name matching — every nickname, misspelling and defense alias —
 * without a second implementation of it.
 */
export type MockPlayer = BoardPlayer & {
  /** Consensus PPR ADP from `data/smartdraft-players.json`. Null = undrafted. */
  adp: number | null;
  /**
   * FantasyPros headshot, or null when there is none. Carried here so a mock —
   * which the commissioner runs as rehearsal for the real thing — announces
   * picks exactly the way Saturday will.
   */
  headshotUrl: string | null;
};

/** Who made a pick. The only field a mock pick has that a live one does not. */
export type MockPickSource = "you" | "ai";

/** A pick made in a mock. Mirrors `LivePick` so the board renders identically. */
export type MockPick = {
  slotId: string;
  overallPick: number;
  label: string;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
  /** The slot's CURRENT owner — the traded-pick rule, same as the live board. */
  teamId: string;
  teamName: string;
  seq: number;
  by: MockPickSource;
  enteredAt: string;
};

/**
 * Exactly what gets written to `data/mock-draft-state-<season>.json`.
 *
 * `kind` and the string `version` are the load-bearing fields — see the header.
 * Do not "tidy" `version` into a number.
 */
export type MockDraftFile = {
  kind: "ultimate-keeper-mock-draft";
  version: "mock-1";
  season: number;
  /** Which snapshot this mock ran against, so a stale resume can be spotted. */
  boardFingerprint: string;
  /** The franchise the commissioner is drafting for. Null = watching. */
  controlledTeamId: string | null;
  /** Which bot personality each franchise was drafting as, by team id. */
  archetypes: Record<string, string>;
  nextSeq: number;
  picks: MockPick[];
  startedAt: string;
  updatedAt: string;
};

export const MOCK_FILE_KIND = "ultimate-keeper-mock-draft" as const;
export const MOCK_FILE_VERSION = "mock-1" as const;

export function emptyMockDraft(
  season: number,
  boardFingerprint: string,
  controlledTeamId: string | null,
  archetypes: Record<string, string> = {},
): MockDraftFile {
  const now = new Date().toISOString();
  return {
    kind: MOCK_FILE_KIND,
    version: MOCK_FILE_VERSION,
    season,
    boardFingerprint,
    controlledTeamId,
    archetypes,
    nextSeq: 1,
    picks: [],
    startedAt: now,
    updatedAt: now,
  };
}

/**
 * Accepts a parsed file only if it is a MOCK file. Deliberately strict about
 * `kind` and `version`: the whole point is that live draft state read through
 * here is rejected rather than adopted.
 */
export function isMockDraftFile(value: unknown): value is MockDraftFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<MockDraftFile>;
  return (
    v.kind === MOCK_FILE_KIND &&
    v.version === MOCK_FILE_VERSION &&
    typeof v.season === "number" &&
    typeof v.boardFingerprint === "string" &&
    typeof v.nextSeq === "number" &&
    Array.isArray(v.picks) &&
    v.picks.every(
      (p) =>
        typeof p?.slotId === "string" &&
        typeof p?.playerId === "string" &&
        typeof p?.teamId === "string" &&
        typeof p?.seq === "number",
    )
  );
}

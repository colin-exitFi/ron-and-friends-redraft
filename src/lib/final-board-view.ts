/**
 * The board you stand around and argue about after the draft.
 *
 * THE ONE IDEA: a column is the franchise that OWNS the player, not the
 * franchise that owned the pick.
 *
 * The live board is keyed the other way round, and it has to be — the room calls
 * picks by slot ("who's got 4.06?"), so a franchise keeps its column all sixteen
 * rounds and an acquired pick shows up as a foreign name inside someone else's
 * column. That is right for entering picks and useless for reading the result:
 * Scott's third-round pick sits in the Sandmen column under a "→ SCOTT" strip,
 * and nobody can hold ten of those corrections in their head while making fun of
 * somebody's roster.
 *
 * ROWS ARE EACH FRANCHISE'S OWN PICK ORDER, NOT ROUNDS.
 *
 * This was built the other way first — rows as true rounds — and it was wrong.
 * Trades do not respect rounds: Zach owns three picks in round 4 and Witte three
 * in round 8, so a round-keyed cell has to be a *list*, and rounds 4 and 8 came
 * out three players deep while 11, 14 and 15 were one. Ragged rows, twenty-three
 * holes, three names stacked in a box. It read as janky because it was.
 *
 * Keying rows to the franchise's own selection order gives a perfectly uniform
 * 10×16 — one player per cell, no holes, no stacks, and the same geometry as the
 * live board, which is already known to fit a projector.
 *
 * The cost is real and worth naming: row 5 is not "round 5" for a franchise that
 * held two of round 4. So THE ROUND IS PRINTED IN EVERY CELL and is the only
 * thing the round is read from. Do not reintroduce a row-level round label; it
 * would be a lie for exactly the franchises this layout exists to handle.
 *
 * Pure and I/O-free: takes the room view, returns the grid.
 */

import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";
import type { BoardTeamSummary } from "@/lib/board-types";

/** How many of each are marked. Small on purpose: the board has to stay clean. */
const MARK_COUNT = 5;
/** Below this, a gap from ADP is noise rather than a story. */
const MARK_MIN_GAP = 12;

export type FinalBoardEntry = {
  slot: LiveSlot;
  /** 1-based position within this franchise's own draft. */
  ordinal: number;
  /**
   * `expectedPick - overallPick`. Positive means he went EARLIER than he was
   * expected to — a reach. Negative means he lasted longer — a steal. Null when
   * the player has no expectation, or is a keeper (a keeper was not a decision
   * made at this slot, so measuring it against draft position says nothing).
   *
   * Measured against a KEEPER-ADJUSTED expectation, not raw consensus ADP. Raw
   * ADP is a different unit from a pick number on this board and comparing them
   * inflated every gap toward "reach" by ~7 picks. See `expected-pick.ts`.
   */
  picksEarlier: number | null;
  mark: "reach" | "steal" | null;
};

export type FinalBoardTeam = {
  team: BoardTeamSummary;
  /** Head count by position across everything this franchise owns. */
  byPosition: Record<string, number>;
  keepers: number;
  filled: number;
  owned: number;
};

export type FinalBoardView = {
  season: number;
  rounds: number;
  teams: FinalBoardTeam[];
  /** `rows[i][teamIndex]` — that franchise's (i+1)th pick. Null if it holds fewer. */
  rows: (FinalBoardEntry | null)[][];
  keeperCount: number;
  filled: number;
  owned: number;
  /** No owned slot is still empty. Only then is this a *final* board. */
  complete: boolean;
  /** True when any pick carries a mark, so the legend can stay quiet otherwise. */
  hasMarks: boolean;
};

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "DST"];

export function buildFinalBoard(
  view: DraftRoomView,
  /**
   * Expected pick by player id, from `buildExpectedPicks`. A slot number on
   * this board, NOT consensus ADP. Absent ids simply go unmarked.
   */
  expectedPick: Record<string, number | null> = {},
): FinalBoardView {
  const teams: FinalBoardTeam[] = [];
  /** Per franchise, its own picks in draft order. */
  const columns: FinalBoardEntry[][] = [];

  for (const team of view.teams) {
    const held = view.slots
      .filter((s) => s.currentOwner.id === team.id)
      .sort((a, b) => a.overallPick - b.overallPick);

    const byPosition: Record<string, number> = {};
    for (const s of held) {
      if (!s.player) continue;
      byPosition[s.player.position] = (byPosition[s.player.position] ?? 0) + 1;
    }

    columns.push(
      held.map((slot, i) => ({
        slot,
        ordinal: i + 1,
        picksEarlier: gapFromExpected(slot, expectedPick),
        mark: null,
      })),
    );

    teams.push({
      team,
      byPosition,
      keepers: held.filter((s) => s.fill === "keeper").length,
      filled: held.filter((s) => s.player).length,
      owned: held.length,
    });
  }

  markExtremes(columns);

  /*
   * Uniform by construction: the grid is as tall as the franchise holding the
   * most picks, and a franchise holding fewer gets nulls at the bottom rather
   * than the grid going ragged. Trades need not net out one-for-one, so this is
   * not the same thing as `view.rounds` even though it equals it in 2026.
   */
  const rowCount = columns.reduce((max, c) => Math.max(max, c.length), 0);
  const rows: (FinalBoardEntry | null)[][] = Array.from(
    { length: rowCount },
    (_, i) => columns.map((c) => c[i] ?? null),
  );

  const owned = teams.reduce((sum, t) => sum + t.owned, 0);
  const filled = teams.reduce((sum, t) => sum + t.filled, 0);

  return {
    season: view.season,
    rounds: view.rounds,
    teams,
    rows,
    keeperCount: view.keeperCount,
    filled,
    owned,
    complete: filled === owned,
    hasMarks: columns.some((c) => c.some((e) => e.mark !== null)),
  };
}

function gapFromExpected(
  slot: LiveSlot,
  expectedPick: Record<string, number | null>,
): number | null {
  if (!slot.player || slot.fill === "keeper") return null;
  const value = expectedPick[slot.player.id];
  if (value == null) return null;
  return Math.round(value - slot.overallPick);
}

/**
 * Flags only the biggest few in each direction, board-wide.
 *
 * A threshold alone would mark whatever the expectation's noise happens to
 * exceed it — potentially sixty cells, which is not "the biggest reaches and
 * steals", it is a rash. Ranking and taking five of each keeps the marks
 * meaning "this one is worth bringing up".
 *
 * Note the threshold only became meaningful once the expectation was put in
 * board units. Against raw ADP it was competing with a systematic ~7-pick bias,
 * so more than half of what it admitted was measurement error rather than a
 * decision anyone made.
 */
function markExtremes(columns: FinalBoardEntry[][]): void {
  const candidates = columns
    .flat()
    .filter(
      (e) => e.picksEarlier !== null && Math.abs(e.picksEarlier) >= MARK_MIN_GAP,
    );

  const reaches = [...candidates]
    .sort((a, b) => b.picksEarlier! - a.picksEarlier!)
    .filter((e) => e.picksEarlier! > 0)
    .slice(0, MARK_COUNT);
  const steals = [...candidates]
    .sort((a, b) => a.picksEarlier! - b.picksEarlier!)
    .filter((e) => e.picksEarlier! < 0)
    .slice(0, MARK_COUNT);

  for (const e of reaches) e.mark = "reach";
  for (const e of steals) e.mark = "steal";
}

/** "QB2 RB5 WR6 TE2 DST1", in lineup order, skipping what a franchise has none of. */
export function positionCountEntries(
  byPosition: Record<string, number>,
): { position: string; count: number }[] {
  return POSITION_ORDER.filter((p) => byPosition[p]).map((p) => ({
    position: p,
    count: byPosition[p],
  }));
}

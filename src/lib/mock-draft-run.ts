/**
 * Driving a mock draft forward one pick at a time.
 *
 * Pure. No I/O, no `server-only`, no React. The browser and
 * `scripts/verify-mock-isolation.mts` both step a mock through this module, so
 * what the verification proves is what the commissioner actually plays.
 *
 * ============================================================================
 * THE ENGINE IS THE REAL ONE
 * ============================================================================
 *
 * A mock is not a parallel implementation of the draft. It runs on
 * `@/lib/draft-engine` — the same `applyPick`, `buildRoomView` and `undoLast`
 * that Saturday runs on, which are pure functions over (board, state) with no
 * persistence of their own. So a mock inherits, for free and without a second
 * copy to keep in step:
 *
 *   · keepers are pre-placed and cannot be drafted into
 *   · a pick is credited to the slot's CURRENT owner, so all 29 traded picks
 *     land with the franchise that acquired them
 *   · a player already on the board raises the duplicate warning
 *   · undo unwinds by entry order and restores the previous board exactly
 *
 * ============================================================================
 * AND IT CANNOT REACH THE REAL BOARD
 * ============================================================================
 *
 * The working state is an ordinary in-memory `DraftStateFile` that is never
 * handed to `@/lib/draft-store`. Nothing in this module's import graph performs
 * I/O of any kind — `draft-engine`, `draft-roster`, `roster-lineup`,
 * `mock-draft-ai`, `mock-draft-bots` and `league-config` are all pure. The only
 * module in the mock feature that touches a filesystem is
 * `@/lib/mock-draft-store`, which is not imported here, writes a different
 * filename, and writes a different shape. `verify:mock` asserts this import
 * property by reading the source, not by trusting this comment.
 */

import {
  applyPick,
  boardFingerprint,
  buildRoomView,
  emptyState,
  undoLast,
} from "@/lib/draft-engine";
import { buildFranchiseLineups } from "@/lib/roster-lineup";
import { archetypeByKey, defaultArchetypeFor } from "@/lib/mock-draft-bots";
import { chooseMockPick, type MockChoice } from "@/lib/mock-draft-ai";
import {
  MOCK_FILE_KIND,
  MOCK_FILE_VERSION,
  type MockDraftFile,
  type MockPickSource,
  type MockPlayer,
} from "@/lib/mock-draft-types";
import type { BoardView } from "@/lib/board-types";
import type { DraftRoomView, DraftStateFile, LiveSlot } from "@/lib/draft-types";

/** Which archetype each franchise is drafting as, keyed by team id. */
export type ArchetypeAssignment = Record<string, string>;

/**
 * A fresh mock: the board as it stands with its keepers, and nothing entered.
 *
 * Deliberately built from `emptyState` rather than from whatever is in the live
 * draft state. A mock is a rehearsal from pick one, and starting it this way
 * means the mock surface never reads `data/draft-state-2026.json` at all — the
 * file it must not disturb is not even opened.
 */
export function freshMockState(board: BoardView): DraftStateFile {
  return emptyState(board.season, boardFingerprint(board));
}

/** Deals the default mixed room out across the franchises. */
export function defaultAssignment(board: BoardView): ArchetypeAssignment {
  const assignment: ArchetypeAssignment = {};
  for (const team of board.teams) {
    assignment[team.id] = defaultArchetypeFor(team.slot);
  }
  return assignment;
}

export type MockStep = {
  state: DraftStateFile;
  view: DraftRoomView;
  slot: LiveSlot;
  choice: MockChoice;
};

/**
 * Makes the pick for whoever is on the clock, using their archetype.
 *
 * Returns null when the board is full. Throws only for things that cannot
 * happen on a valid board — an unknown franchise, an empty player pool — which
 * is what you want in a verification script and what the UI turns into a
 * visible error rather than swallowing.
 */
export function botPickOnce({
  board,
  state,
  pool,
  archetypes,
  rng = Math.random,
}: {
  board: BoardView;
  state: DraftStateFile;
  pool: MockPlayer[];
  archetypes: ArchetypeAssignment;
  rng?: () => number;
}): MockStep | null {
  const view = buildRoomView(board, state);
  if (!view.onTheClockSlotId) return null;

  const slot = view.slots.find((s) => s.id === view.onTheClockSlotId);
  if (!slot) return null;

  const choice = chooseMockPick({
    view,
    pool,
    slot,
    archetype: archetypeByKey(archetypes[slot.currentOwner.id]),
    rng,
    // The board is about to render these anyway, and the AI needs the same
    // numbers, so they are computed once here.
    lineups: buildFranchiseLineups(view),
  });

  const next = applyPick(board, state, {
    slotId: slot.id,
    playerId: choice.player.id,
    playerName: choice.player.name,
    position: choice.player.position,
    nflTeam: choice.player.nflTeam,
    byeWeek: choice.player.byeWeek,
  });

  return { state: next, view: buildRoomView(board, next), slot, choice };
}

/**
 * Records the commissioner's own pick.
 *
 * A thin pass-through to the real engine, kept here so the mock has exactly one
 * place where a pick enters the state and the UI never calls `applyPick`
 * directly. `override` carries the duplicate through, exactly as on the live
 * board — picking somebody already taken is a forfeit in this league, not an
 * error, and the mock has to behave the same way or it is not rehearsal.
 */
export function humanPickOnce({
  board,
  state,
  slotId,
  player,
  override,
}: {
  board: BoardView;
  state: DraftStateFile;
  slotId: string;
  player: MockPlayer;
  override: boolean;
}): DraftStateFile {
  return applyPick(
    board,
    state,
    {
      slotId,
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      byeWeek: player.byeWeek,
    },
    { override },
  );
}

export function undoMockPick(state: DraftStateFile): DraftStateFile {
  return undoLast(state);
}

/**
 * Runs a whole mock to completion with every franchise on a bot.
 *
 * Used by `verify:mock`. Not used by the UI, which steps one pick at a time so
 * the room can read them.
 */
export function runWholeMock({
  board,
  pool,
  archetypes,
  rng,
  onStep,
}: {
  board: BoardView;
  pool: MockPlayer[];
  archetypes: ArchetypeAssignment;
  rng?: () => number;
  onStep?: (step: MockStep) => void;
}): { state: DraftStateFile; view: DraftRoomView; steps: number } {
  let state = freshMockState(board);
  let view = buildRoomView(board, state);
  let steps = 0;

  // Bounded rather than `while (true)`: a bug that stops advancing the clock
  // should fail the run, not hang the process.
  const limit = board.totalPicks + 10;
  while (steps < limit) {
    const step = botPickOnce({ board, state, pool, archetypes, rng });
    if (!step) break;
    state = step.state;
    view = step.view;
    steps++;
    onStep?.(step);
  }

  return { state, view, steps };
}

// --- Saving and resuming ----------------------------------------------------

/**
 * Packs a live mock into the file shape.
 *
 * Note what this conversion is FOR: it turns an ordinary `DraftStateFile` — the
 * shape the engine works in — into a `MockDraftFile`, which the live draft
 * loader refuses to read. The mock's working state and its saved state are
 * deliberately different types, so the thing that gets persisted can never be
 * mistaken for a real board. See `@/lib/mock-draft-types`.
 */
export function toMockFile({
  state,
  controlledTeamId,
  archetypes,
  sources,
  startedAt,
}: {
  state: DraftStateFile;
  controlledTeamId: string | null;
  archetypes: ArchetypeAssignment;
  /** Who made each pick, by slot id. Anything missing is assumed to be a bot. */
  sources: Record<string, MockPickSource>;
  startedAt: string;
}): MockDraftFile {
  return {
    kind: MOCK_FILE_KIND,
    version: MOCK_FILE_VERSION,
    season: state.season,
    boardFingerprint: state.boardFingerprint,
    controlledTeamId,
    archetypes,
    nextSeq: state.nextSeq,
    picks: state.picks.map((p) => ({ ...p, by: sources[p.slotId] ?? "ai" })),
    startedAt,
    updatedAt: new Date().toISOString(),
  };
}

/** Unpacks a saved mock back into the engine's working shape. */
export function fromMockFile(file: MockDraftFile): {
  state: DraftStateFile;
  sources: Record<string, MockPickSource>;
} {
  const sources: Record<string, MockPickSource> = {};
  for (const p of file.picks) sources[p.slotId] = p.by;
  return {
    state: {
      version: 1,
      season: file.season,
      boardFingerprint: file.boardFingerprint,
      nextSeq: file.nextSeq,
      // `by` is dropped: the engine has no concept of who typed a pick, and
      // carrying an extra field into its state would be a lie about the type.
      picks: file.picks.map((p) => ({
        slotId: p.slotId,
        overallPick: p.overallPick,
        label: p.label,
        playerId: p.playerId,
        playerName: p.playerName,
        position: p.position,
        nflTeam: p.nflTeam,
        byeWeek: p.byeWeek,
        teamId: p.teamId,
        teamName: p.teamName,
        seq: p.seq,
        enteredAt: p.enteredAt,
      })),
      updatedAt: file.updatedAt,
    },
    sources,
  };
}

/** The pool, trimmed to what a mock needs. Kicker-free by construction. */
export function toMockPool(
  players: {
    id: string;
    name: string;
    position: string;
    nflTeam: string | null;
    byeWeek: number | null;
    adp: number | null;
    headshotUrl?: string | null;
  }[],
): MockPlayer[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    nflTeam: p.nflTeam,
    byeWeek: p.byeWeek,
    adp: p.adp,
    headshotUrl: p.headshotUrl ?? null,
  }));
}

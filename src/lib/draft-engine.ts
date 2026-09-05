/**
 * The draft engine. Pure functions over (board, state) — no I/O, no `fs`, no
 * `server-only`, no React. Persistence is somebody else's job (`draft-store`),
 * which is what lets the whole 160-pick draft be simulated in a plain Node
 * script before any of it is trusted in a room.
 *
 * The rules it enforces, in the order they bite:
 *
 *   1. The team that picks is the slot's CURRENT owner. 29 of the 160 slots
 *      changed hands, so reading the original owner would misattribute nearly a
 *      fifth of the board.
 *   2. Keepers are pre-placed by the snapshot and are not pickable. The clock
 *      skips them; it never lands on one.
 *   3. A player should be on the board once — but see the override rule below.
 *   4. Any empty slot can be filled at any time. In-person drafts wander, and
 *      refusing an out-of-sequence pick would just get the app closed.
 *   5. Undo unwinds by ENTRY order, not by pick number, for the same reason.
 *
 * THE OVERRIDE RULE. The commissioner outranks this software. Drafting a player
 * who is already on the board is refused ONCE, with an error naming who holds
 * him and where, and then allowed if the caller asks again with `override`. The
 * duplicate stays on the board and is reported in `conflicts` so the screen can
 * keep shouting about it until somebody fixes it. Refusing outright would mean
 * the room's argument is settled by a JSON file, which is the wrong way round.
 *
 * The two things that are never overridable are physical rather than
 * procedural: a cell already holding a player, and a keeper slot. One cell
 * cannot show two players, so there is nothing to override — undo the sitting
 * pick first.
 */

import type { BoardView } from "@/lib/board-types";
import type {
  DraftConflict,
  DraftRoomView,
  DraftStateFile,
  LivePick,
  LiveSlot,
} from "@/lib/draft-types";

// --- State ------------------------------------------------------------------

export function emptyState(season: number, boardFingerprint: string): DraftStateFile {
  return {
    version: 1,
    season,
    boardFingerprint,
    nextSeq: 1,
    picks: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * What a reset leaves behind: an empty board that still remembers what it wiped,
 * so `undoLast` can put it back.
 *
 * A wipe of an already-empty board has nothing of its own to offer back, but it
 * must not throw away what the wipe BEFORE it was holding. Reset is reached by
 * someone who has just done something they regret, and the second press is
 * often part of the same fumble — two resets used to leave `undoLast` with
 * nothing at all, which is 90 picks gone with the recovery this file exists to
 * provide silently deleted in between.
 *
 * `nextSeq` deliberately does NOT rewind. Restoring returns the wiped picks
 * under their original `seq`, so a counter reset to 1 would hand that same 1 to
 * the first pick entered after the wipe and leave two different picks claiming
 * to have been entered first — which is precisely the ordering undo relies on.
 */
export function clearedState(
  previous: DraftStateFile,
  season: number,
  boardFingerprint: string,
): DraftStateFile {
  const fresh = emptyState(season, boardFingerprint);
  if (previous.picks.length === 0) {
    if (!previous.restorable) return fresh;
    return {
      ...fresh,
      nextSeq: Math.max(fresh.nextSeq, previous.nextSeq),
      // Carried whole, `clearedAt` included: the restore point still describes
      // the wipe that actually took the picks, not the empty press after it.
      restorable: previous.restorable,
    };
  }
  return {
    ...fresh,
    nextSeq: Math.max(fresh.nextSeq, previous.nextSeq),
    restorable: { picks: previous.picks, clearedAt: fresh.updatedAt },
  };
}

/**
 * Identifies the snapshot a set of picks was entered against. Covers the things
 * a pick depends on — which slots exist and who owns them — and deliberately
 * not keeper placement, because keepers are still arriving and a changed
 * fingerprint should mean "ownership moved", which is the alarming case.
 */
export function boardFingerprint(board: BoardView): string {
  let hash = 5381;
  for (const slot of board.slots) {
    const line = `${slot.id}|${slot.overallPick}|${slot.currentOwner.id}`;
    for (let i = 0; i < line.length; i++) {
      hash = ((hash << 5) + hash + line.charCodeAt(i)) | 0;
    }
  }
  return `${board.slots.length}-${(hash >>> 0).toString(36)}`;
}

/**
 * Accepts a parsed file only if it is a state file we understand. A corrupt or
 * truncated file must not silently read as an empty draft — that is how you
 * lose 90 picks and not notice.
 */
function isPickList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (p) =>
        typeof p?.slotId === "string" &&
        typeof p?.playerId === "string" &&
        typeof p?.teamId === "string" &&
        typeof p?.seq === "number",
    )
  );
}

export function isDraftStateFile(value: unknown): value is DraftStateFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<DraftStateFile>;
  // Absent is the normal case, and every state written before restore points
  // existed is in it. Present-but-malformed is not: undo would offer to restore
  // a board it cannot actually rebuild.
  if (v.restorable != null && !isPickList(v.restorable.picks)) return false;
  return (
    v.version === 1 &&
    typeof v.season === "number" &&
    typeof v.boardFingerprint === "string" &&
    typeof v.nextSeq === "number" &&
    isPickList(v.picks)
  );
}

// --- Derivation -------------------------------------------------------------

/**
 * Folds the saved picks onto the snapshot board. Everything the room sees comes
 * from here, so this is the only place the two sources meet.
 */
export function buildRoomView(board: BoardView, state: DraftStateFile): DraftRoomView {
  const bySlot = new Map<string, LivePick>();
  const conflicts: DraftConflict[] = [];
  const slotIndex = new Map(board.slots.map((s) => [s.id, s]));

  // Keepers claim their players before any live pick is considered, so a
  // snapshot re-pull that turns a picked slot into a keeper reports a conflict
  // rather than quietly double-rostering the player.
  const claimedPlayers = new Map<string, string>();
  for (const slot of board.slots) {
    if (slot.isKeeper && slot.player) claimedPlayers.set(slot.player.id, slot.label);
  }

  for (const pick of [...state.picks].sort((a, b) => a.seq - b.seq)) {
    const slot = slotIndex.get(pick.slotId);
    if (!slot) {
      conflicts.push({
        kind: "unknown-slot",
        slotId: pick.slotId,
        label: pick.label,
        message: `${pick.playerName} was entered at ${pick.label}, which is not in the current snapshot.`,
      });
      continue;
    }
    if (slot.isKeeper) {
      // The only case where a saved pick cannot be shown: the snapshot moved
      // and made this cell a keeper, and one cell cannot hold two players.
      conflicts.push({
        kind: "keeper-collision",
        slotId: pick.slotId,
        label: slot.label,
        message: `${slot.label} is now a keeper slot (${slot.player?.name ?? "unnamed"}), but ${pick.playerName} was entered there.`,
      });
      continue;
    }
    const claimedAt = claimedPlayers.get(pick.playerId);
    if (claimedAt) {
      // Deliberately KEPT on the board, not dropped. If the commissioner
      // overrode a duplicate warning he meant it; the board's job is to keep
      // saying so, not to quietly delete his pick.
      conflicts.push({
        kind: "duplicate-player",
        slotId: pick.slotId,
        label: slot.label,
        message: `${pick.playerName} is on the board twice — ${claimedAt} and ${slot.label}.`,
      });
    } else {
      claimedPlayers.set(pick.playerId, slot.label);
    }
    bySlot.set(pick.slotId, pick);
  }

  const slots: LiveSlot[] = board.slots.map((slot) => {
    const pick = bySlot.get(slot.id);
    if (slot.isKeeper) {
      return { ...slot, fill: "keeper", seq: null, enteredAt: null, onTheClock: false };
    }
    if (pick) {
      return {
        ...slot,
        player: {
          id: pick.playerId,
          name: pick.playerName,
          position: pick.position,
          nflTeam: pick.nflTeam,
          byeWeek: pick.byeWeek,
        },
        fill: "pick",
        seq: pick.seq,
        enteredAt: pick.enteredAt,
        onTheClock: false,
      };
    }
    // The snapshot's own `isCurrent` describes the Smart Draft room, not ours.
    return { ...slot, fill: null, seq: null, enteredAt: null, onTheClock: false };
  });

  const onClock = slots.find((s) => s.fill === null) ?? null;
  if (onClock) onClock.onTheClock = true;

  const live = slots.filter((s) => s.fill === "pick");
  const lastPick =
    live.length > 0 ? live.reduce((a, b) => ((b.seq ?? 0) > (a.seq ?? 0) ? b : a)) : null;
  const filled = slots.filter((s) => s.fill !== null).length;

  return {
    season: board.season,
    rounds: board.rounds,
    teamCount: board.teamCount,
    totalPicks: board.totalPicks,
    teams: board.teams,
    slots,
    keeperCount: board.keeperCount,
    tradedCount: board.tradedCount,
    picksMade: live.length,
    filled,
    remaining: slots.length - filled,
    onTheClockSlotId: onClock?.id ?? null,
    lastPick,
    // Only while the board is still empty. Once a pick is entered the honest
    // answer to "what does undo do" is that pick, and offering the wipe as well
    // would be offering two undos from one button.
    restorable:
      live.length === 0 && state.restorable?.picks.length
        ? {
            pickCount: state.restorable.picks.length,
            clearedAt: state.restorable.clearedAt,
          }
        : null,
    draftedPlayerIds: slots.filter((s) => s.player).map((s) => s.player!.id),
    conflicts,
    /**
     * Derived rather than stored. A stored "draft started" flag survives undo
     * and then disagrees with a board that has no picks on it; deriving it from
     * the picks themselves means undoing back to zero genuinely returns the
     * board to its pre-draft state, with nothing left over to reconcile.
     * ISO-8601 sorts lexicographically, so `sort()[0]` is the earliest.
     */
    startedAt:
      state.picks.length > 0
        ? state.picks.map((p) => p.enteredAt).sort()[0]
        : null,
    updatedAt: state.updatedAt,
    fetchedAt: board.fetchedAt,
  };
}

// --- Mutations --------------------------------------------------------------

export type PickInput = {
  slotId: string;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
};

/**
 * A move the board would rather not make. `overridable` distinguishes "this is
 * probably a mistake, say so and let him decide" from "one cell cannot hold two
 * players", which is not a matter of opinion.
 */
export type DraftRuleCode = "duplicate-player" | "slot-occupied" | "keeper-slot" | "unknown";

export class DraftRuleError extends Error {
  // Written out longhand rather than as constructor parameter properties, which
  // Node's `--experimental-strip-types` cannot parse — and the verification
  // script runs this module under exactly that.
  readonly code: DraftRuleCode;
  readonly overridable: boolean;

  constructor(message: string, code: DraftRuleCode = "unknown", overridable = false) {
    super(message);
    this.name = "DraftRuleError";
    this.code = code;
    this.overridable = overridable;
  }
}

export type ApplyPickOptions = {
  /**
   * Enter the pick even though the player is already on the board. Set only
   * after the operator has been shown who holds him and has said yes.
   */
  override?: boolean;
};

/**
 * Records a pick. Returns a NEW state — the caller persists it, so a failed
 * write cannot leave the in-memory board ahead of the disk.
 *
 * @throws DraftRuleError when the board cannot do it. Check `overridable`:
 * a duplicate player is a warning the caller may repeat past, everything else
 * is final.
 */
export function applyPick(
  board: BoardView,
  state: DraftStateFile,
  input: PickInput,
  options: ApplyPickOptions = {},
): DraftStateFile {
  const slot = board.slots.find((s) => s.id === input.slotId);
  if (!slot) throw new DraftRuleError(`No slot ${input.slotId} on this board.`);
  if (slot.isKeeper) {
    throw new DraftRuleError(
      `${slot.label} is a keeper slot (${slot.player?.name ?? "unnamed"}) and cannot be drafted into.`,
      "keeper-slot",
    );
  }

  const view = buildRoomView(board, state);
  const target = view.slots.find((s) => s.id === input.slotId)!;
  if (target.fill !== null) {
    throw new DraftRuleError(
      `${slot.label} already holds ${target.player?.name}. Undo it before drafting there again.`,
      "slot-occupied",
    );
  }

  if (!options.override) {
    const takenAt = view.slots.find((s) => s.player?.id === input.playerId);
    if (takenAt) {
      throw new DraftRuleError(
        `${input.playerName} is already on the board — ${takenAt.label}, round ${takenAt.round}, ${takenAt.currentOwner.name}${takenAt.fill === "keeper" ? " (keeper)" : ""}.`,
        "duplicate-player",
        true,
      );
    }
  }

  const now = new Date().toISOString();
  const pick: LivePick = {
    slotId: slot.id,
    overallPick: slot.overallPick,
    label: slot.label,
    playerId: input.playerId,
    playerName: input.playerName,
    position: input.position,
    nflTeam: input.nflTeam,
    byeWeek: input.byeWeek,
    // The current owner, not the original. This is the traded-pick rule.
    teamId: slot.currentOwner.id,
    teamName: slot.currentOwner.name,
    seq: state.nextSeq,
    enteredAt: now,
  };

  return {
    ...state,
    boardFingerprint: boardFingerprint(board),
    nextSeq: state.nextSeq + 1,
    picks: [...state.picks, pick],
    updatedAt: now,
  };
}

/**
 * Removes the most recently ENTERED pick. Because the board is derived from
 * nothing but this list, dropping the tail restores the previous board exactly
 * — there is no separate history to keep in step.
 */
/**
 * Undoes the last thing that HAPPENED, which is not always the last thing that
 * was picked. On a board with picks on it that means the pick entered most
 * recently; on a board a reset emptied it means the reset, and the wiped picks
 * come back.
 *
 * One verb for both because the room only ever has one question — "put it
 * back" — and a wipe is the case where the answer matters most and the old code
 * answered "there is nothing to undo".
 *
 * A restore is spent once. Undoing again then walks back into the restored
 * picks one at a time, which is the same board the commissioner would have had
 * if the reset had never been pressed.
 */
export function undoLast(state: DraftStateFile): DraftStateFile {
  if (state.picks.length === 0) {
    const wiped = state.restorable;
    if (!wiped?.picks.length) {
      throw new DraftRuleError("There is nothing to undo.", "unknown");
    }
    return {
      ...state,
      picks: wiped.picks,
      // The wiped picks keep their original `seq`, and `clearedState` held the
      // counter above them, so nothing has to be renumbered.
      nextSeq: Math.max(state.nextSeq, ...wiped.picks.map((p) => p.seq + 1)),
      restorable: null,
      updatedAt: new Date().toISOString(),
    };
  }
  const last = state.picks.reduce((a, b) => (b.seq > a.seq ? b : a));
  return {
    ...state,
    picks: state.picks.filter((p) => p.seq !== last.seq),
    updatedAt: new Date().toISOString(),
  };
}

/** Removes one specific pick, for correcting a mis-entry deep in the board. */
export function removePick(state: DraftStateFile, slotId: string): DraftStateFile {
  const pick = state.picks.find((p) => p.slotId === slotId);
  if (!pick) throw new DraftRuleError("No pick has been entered at that slot.", "unknown");
  return {
    ...state,
    picks: state.picks.filter((p) => p.slotId !== slotId),
    updatedAt: new Date().toISOString(),
  };
}

// --- Order helpers ----------------------------------------------------------

/** Snake slot for an overall pick number — the shape of the board, not its owners. */
export function snakeSlotForPick(pickNo: number, teamCount: number): number {
  const round = Math.ceil(pickNo / teamCount);
  const posInRound = ((pickNo - 1) % teamCount) + 1;
  return round % 2 === 1 ? posInRound : teamCount + 1 - posInRound;
}

/** The next `count` slots that still need a player, in board order. */
export function upcomingSlots(view: DraftRoomView, count: number): LiveSlot[] {
  return view.slots.filter((s) => s.fill === null).slice(0, count);
}

/**
 * How many empty slots until this team is up again, counting from the clock.
 * Undefined when they have no picks left.
 */
export function picksUntilTeamIsUp(view: DraftRoomView, teamId: string): number | null {
  const open = view.slots.filter((s) => s.fill === null);
  const idx = open.findIndex((s) => s.currentOwner.id === teamId);
  return idx === -1 ? null : idx;
}

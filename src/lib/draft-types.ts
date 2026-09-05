/**
 * Types for the live draft — the picks the commissioner enters in the room, as
 * distinct from the static board that comes out of the Smart Draft snapshot.
 *
 * Two sources feed one board and they are deliberately kept apart:
 *
 *   KEEPERS live in the Smart Draft snapshot. Zach's and Joe's declarations are
 *   still outstanding as of writing, so re-pulling the snapshot must be able to
 *   add keepers without disturbing picks already entered. Baking keepers into
 *   the saved state would make a re-pull destructive.
 *
 *   LIVE PICKS live in the state file this module describes. Nothing else is
 *   stored: the whole board is derived, which is what makes undo exact — drop
 *   the last record and the prior board reappears by construction.
 *
 * Free of `server-only` and of I/O so client components can import them.
 */

import type { BoardSlot, BoardTeamSummary } from "@/lib/board-types";

/**
 * What the browser needs to run the autocomplete, and nothing more.
 *
 * The whole pool ships to the client once and every keystroke is matched
 * locally, so entering a pick never touches the network. Trimmed to six fields
 * because the Smart Draft record carries nine ADP feeds per player and this
 * screen renders none of them — there is no browsable player list here, only a
 * name box. `adp` survives solely to break ties between equally good name
 * matches, so that typing "chase" offers Ja'Marr before Chase Brown.
 */
export type ClientPlayer = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  /**
   * Printed on the board cell and in the announcement, so it has to reach the
   * browser: the cell is drawn optimistically from this record the moment Enter
   * lands, and a bye that only arrives with the server's reply would blink in a
   * beat later on every single pick.
   */
  byeWeek: number | null;
  adp: number | null;
  /**
   * FantasyPros headshot, already resolved and known to exist, or null when
   * there is no picture of him.
   *
   * Here for the same reason `byeWeek` is: the announcement is drawn from this
   * record the instant Enter lands, and anything it needs that is not already
   * in the browser would have to be fetched at the exact moment ten people are
   * watching. Resolved for the whole pool ahead of the draft instead — see
   * `scripts/fantasypros-players.mjs`.
   */
  headshotUrl: string | null;
};

/** A pick the commissioner typed in. Keepers are never recorded here. */
export type LivePick = {
  /** Smart Draft `slotKey`. Stable across snapshot re-pulls. */
  slotId: string;
  overallPick: number;
  /** Pick label — "4.06". Denormalised so an export needs no board join. */
  label: string;
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
  /** The slot's CURRENT owner at the time of entry — never the original. */
  teamId: string;
  teamName: string;
  /**
   * Entry order, not board order. The room drafts out of sequence, so undo has
   * to unwind what was typed last rather than the highest pick number.
   */
  seq: number;
  enteredAt: string;
};

/**
 * What a reset wiped, kept so that undo can put it back.
 *
 * A reset is the one action on this board that destroys work nobody can
 * reconstruct from memory — 90 picks entered over three hours — and it is one
 * keystroke away from the actions that do not. The backups have always caught
 * this, but recovering from them means a commissioner reading a filename in the
 * middle of the draft, which is not a recovery anybody performs in front of ten
 * people. So the wiped board rides along in the state that replaced it.
 */
export type RestorePoint = {
  picks: LivePick[];
  clearedAt: string;
};

/** Exactly what gets written to disk. Version it — this file outlives a crash. */
export type DraftStateFile = {
  version: 1;
  season: number;
  /**
   * Fingerprint of the snapshot these picks were entered against. A mismatch on
   * load does not invalidate anything; it just means conflicts are worth
   * checking, which `reconcile` does.
   */
  boardFingerprint: string;
  /** Monotonic. Never reused, so `seq` also orders a re-imported file. */
  nextSeq: number;
  picks: LivePick[];
  /**
   * Set only by a reset, and cleared the moment undo spends it. Absent on every
   * state written before this existed, which is why it is optional rather than
   * a version bump: an old file simply has nothing to restore.
   */
  restorable?: RestorePoint | null;
  /**
   * When this file was last saved. Deliberately the ONLY mutable field that is
   * not derived from `picks` — see the note on `startedAt` in `draft-engine`.
   */
  updatedAt: string;
};

/**
 * A live pick that the current snapshot can no longer honour — raised when the
 * snapshot moved under a draft in progress (a new keeper landing on a slot that
 * was already picked, most plausibly).
 */
export type DraftConflict = {
  kind: "keeper-collision" | "duplicate-player" | "unknown-slot";
  slotId: string;
  label: string;
  message: string;
};

/** A board slot with whatever is sitting in it now. */
export type LiveSlot = BoardSlot & {
  /** Where the player came from, or null for an empty slot. */
  fill: "keeper" | "pick" | null;
  /** Entry order for live picks; null for keepers and empty slots. */
  seq: number | null;
  enteredAt: string | null;
};

/** Everything the draft room renders from. Derived; never stored. */
export type DraftRoomView = {
  season: number;
  rounds: number;
  teamCount: number;
  totalPicks: number;
  teams: BoardTeamSummary[];
  /** In overall pick order. */
  slots: LiveSlot[];
  keeperCount: number;
  tradedCount: number;
  /** Live picks entered, excluding keepers. */
  picksMade: number;
  /** Slots with a player in them, keepers included. */
  filled: number;
  remaining: number;
  /** Lowest-numbered empty slot, or null when the board is full. */
  onTheClockSlotId: string | null;
  /** Most recently entered live pick, for the undo affordance. */
  lastPick: LiveSlot | null;
  /**
   * A wipe that undo can still take back, summarised for the button's label.
   * The picks themselves stay on the server: the board would have to hold a
   * second full draft in memory to no purpose, and the browser never needs to
   * know more than how many there are and when they went.
   */
  restorable: { pickCount: number; clearedAt: string } | null;
  /** Every player already on the board, keepers included. */
  draftedPlayerIds: string[];
  conflicts: DraftConflict[];
  startedAt: string | null;
  updatedAt: string | null;
  /** When the Smart Draft snapshot behind the board was pulled. */
  fetchedAt: string | null;
};

export type DraftMutationResult =
  | { ok: true; view: DraftRoomView }
  | { ok: false; error: string; view: DraftRoomView };

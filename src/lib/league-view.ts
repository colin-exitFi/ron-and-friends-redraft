/**
 * View types for the franchise, keeper, and trade surfaces.
 *
 * Deliberately free of `server-only` and of any I/O, so both server components
 * and client components can import them. Two implementations produce these
 * shapes — `@/lib/league-json` reads the snapshots in `data/`, and
 * `@/lib/league-db` reads Supabase — and `@/lib/league-source` picks between
 * them. The pages know only about this file, which is what lets the league move
 * onto the database without any of the UI changing.
 *
 * Same contract the draft board already runs on: JSON now, database when
 * present, and the JSON path is the one that has to keep working on Saturday.
 */

import type { TenureDispute } from "@/lib/keeper-tenure-dispute";

export type { TenureDispute };

// --- Franchises -------------------------------------------------------------

/** One of a franchise's keeper declarations, as the /teams page shows it. */
export type FranchiseKeeper = {
  playerId: string;
  playerName: string;
  position: string;
  /** Round he occupies on the board, which is what he costs. */
  costRound: number;
  /** "4.02" — the pick he sits on. */
  boardLabel: string;
  /**
   * Keeper seasons already served entering 2026, the `@/lib/keeper-clock`
   * convention. NOT the keeper sheets' "N of 3".
   */
  seasonsKept: number;
  /**
   * "Year 2 of 3 — first keeper season". Counts SEASONS OF TENURE out of three,
   * the league's own convention, with the acquisition season as year 1. Never
   * "of 2" — see `describeClock`.
   */
  clockLabel: string;
  /** He is on the board this season and must be released afterwards. */
  finalSeason: boolean;
  /**
   * Set when the league has not settled how long this franchise may keep him.
   * `clockLabel` is then deliberately non-committal, and a surface showing a
   * final season must show the dispute instead of choosing a side.
   */
  tenureDispute: TenureDispute | null;
};

/**
 * Where a franchise stands on declaring keepers. The three states are visually
 * distinct on the pages because they mean different things to a commissioner
 * chasing answers:
 *
 *   complete   declared the maximum — nothing outstanding.
 *   awaiting   fewer than the maximum and the list is NOT closed. No answer
 *              yet. This is not a decision to keep nobody.
 *   final      fewer than the maximum, but the manager has closed his list, so
 *              the unfilled slots are a deliberate pass.
 */
export type KeeperDeclarationStatus = "complete" | "awaiting" | "final";

export type FranchiseView = {
  /** Stable Smart Draft team id, so this survives a franchise rename. */
  id: string;
  /** Short handle — "Greg", "Witte". The join key across every source. */
  shortName: string;
  /** Real ESPN franchise name — "Jimmy's Johnson". */
  franchiseName: string;
  abbrev: string;
  manager: string;
  /** 2026 draft slot. The Smart Draft order, which beat ESPN's stale one. */
  draftSlot: number | null;
  espnTeamId: number | null;

  /** Board slots this franchise currently holds, after trades. */
  picksHeld: number;
  /** Held slots that started life as another franchise's. */
  picksAcquired: number;
  /** Own slots now held by someone else. */
  picksTradedAway: number;
  /** Rounds the franchise holds a pick in, ascending, with duplicates. */
  roundsHeld: number[];

  keepers: FranchiseKeeper[];
  /** Keeper slots the franchise is entitled to and has not filled. */
  keeperSlotsPending: number;
  /** How many keepers this franchise may declare. */
  keeperSlotsAllowed: number;
  /** See `KeeperDeclarationStatus`. Never infer this from `keepers.length`. */
  declarationStatus: KeeperDeclarationStatus;
  /** When the manager closed his list, if he has. */
  declarationsClosedAt: string | null;
};

/** One board slot as a franchise's detail page shows it. */
export type FranchisePickView = {
  round: number;
  pickInRound: number;
  overallPick: number;
  /** "1.08" */
  label: string;
  /** Short handle of the franchise this pick was born to. */
  originalOwner: string;
  /** Short handle of whoever holds it now. */
  currentOwner: string;
  /** Held by this franchise but originally someone else's. */
  acquired: boolean;
  isKeeper: boolean;
  playerName: string | null;
};

export type FranchiseDetailView = FranchiseView & {
  /** Slots this franchise currently holds, in board order. */
  picks: FranchisePickView[];
  /** Slots born to this franchise and now held by someone else. */
  picksGivenAway: FranchisePickView[];
};

// --- Keepers ----------------------------------------------------------------

export type KeeperConflict = {
  /** What disagreed, in the commissioner's words. */
  summary: string;
  /** How it was settled, or null if it is still open. */
  resolution: string | null;
};

export type KeeperEntry = {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;

  teamId: string;
  teamShortName: string;
  franchiseName: string;
  manager: string;

  /** The round he occupies on the 2026 board. */
  costRound: number;
  boardLabel: string;
  overallPick: number;
  /**
   * The round he occupied LAST season. Cost is this minus one — not the
   * original draft round, because a trade carries the price across untouched.
   */
  basisRound: number | null;
  /** A free-agent acquisition has no round to his name and prices at R9. */
  isUndrafted: boolean;

  /**
   * The keeper sheets' "N of 3" for 2026, counting the season he was acquired
   * as year 1. Null when no sheet row could be matched.
   */
  sheetTenureYear: number | null;
  /** Keeper seasons already served entering 2026. Excludes the acquisition season. */
  seasonsKept: number;
  /**
   * "Year 2 of 3 — first keeper season" / "Year 3 of 3 — final season". Seasons
   * of TENURE out of three, matching the keeper sheets' `N of 3`. Never "of 2".
   */
  clockLabel: string;
  /** Must be released back into the 2027 pool after this season. */
  finalSeason: boolean;
  keepableIn2027: boolean;
  /**
   * Set when how long this franchise may keep him is genuinely unsettled and
   * awaiting a league vote. Never affects the current season — a dispute that
   * did would need a ruling before the draft, and the dispute module refuses to
   * carry one. See `@/lib/keeper-tenure-dispute`.
   */
  tenureDispute: TenureDispute | null;

  /** A trade restarted his clock with this franchise while the price carried. */
  clockResetByTrade: boolean;
  /** Where this row's facts came from, most authoritative first. */
  sources: string[];
  conflicts: KeeperConflict[];
};

/** A franchise that has keeper slots left to fill. */
export type PendingDeclaration = {
  teamId: string;
  shortName: string;
  franchiseName: string;
  manager: string;
  declared: number;
  allowed: number;
  /**
   * `awaiting` — no answer yet. `final` — the manager closed his list and is
   * deliberately leaving slots empty. The distinction is the whole point of
   * this type; do not collapse it.
   */
  status: Exclude<KeeperDeclarationStatus, "complete">;
  declarationsClosedAt: string | null;
};

/**
 * How far this app's keeper list has drifted from the Smart Draft room.
 *
 * The league has not adopted this app yet, so Smart Draft remains the
 * operational system and the commissioner keeps it current by hand. This is the
 * list of keepers he still needs to key in over there — reconciliation work he
 * is otherwise doing from memory. Shown compactly, not as an alarm: the board is
 * already correct either way.
 */
export type KeeperRoomSync = {
  /** Declarations the Smart Draft room already carries. */
  inRoom: number;
  /** Declarations this app holds that the room does not. */
  missingFromRoom: {
    playerName: string;
    teamShortName: string;
    manager: string;
    costRound: number;
  }[];
};

/**
 * A declaration the rules do not permit.
 *
 * Kept as its own channel rather than folded into `keepers`, because an
 * ineligible player cannot occupy a board slot and so has no cost round, board
 * label or overall pick. It must still be SHOWN: a manager whose declaration is
 * refused needs to see the refusal and the reason, and the commissioner needs to
 * know a slot he thought was filled is not.
 */
export type IneligibleDeclaration = {
  playerName: string;
  teamId: string;
  teamShortName: string;
  franchiseName: string;
  manager: string;
  /** The round he occupied last season — the fact that bars him. */
  basisRound: number | null;
  reason: string;
};

export type KeeperBoardView = {
  season: number;
  /** Keeper seasons a franchise may serve, excluding the acquisition season. */
  maxKeeperSeasons: number;
  maxPerTeam: number;
  keepers: KeeperEntry[];
  /** Declarations barred by the rules. Shown, never silently dropped. */
  ineligible: IneligibleDeclaration[];
  /** Franchises with unfilled keeper slots, awaiting or deliberately passing. */
  pending: PendingDeclaration[];
  /** Of `pending`, those who have simply not answered. */
  awaitingCount: number;
  /** Keepers in their final season — released back into the pool after 2026. */
  expiringCount: number;
  keepableNextSeasonCount: number;
  /** When the room snapshot behind this was pulled. */
  fetchedAt: string | null;
  /** True when this came from the database rather than the snapshots. */
  fromDatabase: boolean;
  /** What Smart Draft is still missing. */
  roomSync: KeeperRoomSync;
};

// --- Trades -----------------------------------------------------------------

export type TradedPickView = {
  round: number;
  pickInRound: number;
  overallPick: number;
  /** "1.08" */
  label: string;
  originalOwnerId: string;
  originalOwner: string;
  currentOwnerId: string;
  currentOwner: string;
  /** The slot carries a keeper rather than an open pick. */
  isKeeper: boolean;
  playerName: string | null;
};

export type TradeLogPick = {
  season: number;
  round: number;
  /** Set when the log named whose pick it originally was — "Stefan's". */
  viaFranchise: string | null;
  label: string;
};

export type TradeLogPlayer = {
  /** Exactly as the commissioner typed it, spelling variants included. */
  typedName: string;
  /** Matched against the Smart Draft pool, or null if nothing matched. */
  playerId: string | null;
  resolvedName: string | null;
};

export type TradeLogSide = {
  manager: string;
  franchiseName: string | null;
  playersReceived: TradeLogPlayer[];
  picksReceived: TradeLogPick[];
  /**
   * Whole-dollar FAAB amounts received, if any.
   *
   * Optional because the imported workbook log has no FAAB in it — the field
   * exists for trades logged through the app. A line item, never a balance;
   * ESPN owns the budget.
   */
  faabReceived?: number[];
};

export type TradeLogEntry = {
  id: string;
  tradeNumber: number;
  sideA: TradeLogSide;
  sideB: TradeLogSide;
  notes: string[];
  /**
   * Not yet final. The Johnston/Blome contingent leg does not execute until the
   * day before the draft, and Scott holds an option to cancel if Nacua is
   * projected to miss six or more weeks.
   */
  provisional: boolean;
  /** Plain-language explanation of why it is provisional, when it is. */
  provisionalNote: string | null;
  /**
   * The trade was logged and then un-applied.
   *
   * Shown rather than hidden: the picks and keeper rights have gone back, so
   * presenting it as a live trade would describe a move that no longer stands,
   * and dropping it silently would lose the record that it was ever entered.
   */
  reversed?: boolean;
  /**
   * Recorded but never applied to the ledger.
   *
   * The 12 imported workbook trades sit here deliberately — the Smart Draft room
   * snapshot already reflects their net 2026 result, so applying them on top
   * would move the same picks a second time.
   */
  unapplied?: boolean;
};

export type TradeBoardView = {
  season: number;
  tradedPicks: TradedPickView[];
  /** Per-franchise net pick movement, in draft-slot order. */
  ledger: {
    teamId: string;
    shortName: string;
    franchiseName: string;
    picksHeld: number;
    acquired: number;
    tradedAway: number;
  }[];
  log: TradeLogEntry[];
  tradeDeadlineWeek: number;
  /** Picks may be traded across these seasons. */
  tradableSeasons: number[];
  fetchedAt: string | null;
  fromDatabase: boolean;
};

// --- Shared formatting ------------------------------------------------------

/** "4.02" — how the room refers to a pick. */
export function pickLabel(round: number, pickInRound: number): string {
  return `${round}.${String(pickInRound).padStart(2, "0")}`;
}

/** "2026 R3" — how the trade log refers to a pick. */
export function pickRefLabel(season: number, round: number): string {
  return `${season} R${round}`;
}

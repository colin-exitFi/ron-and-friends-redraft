import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { KEEPERS } from "@/lib/league-config";
import {
  clockPosition,
  describeClock,
  evaluateKeeperEligibility,
  keeperCostRound,
  seasonsKeptAfterTrade,
  type ClockPosition,
  type KeeperEligibility,
} from "@/lib/keeper-clock";

/**
 * The keeper-rights ledger: one row per player, tracking where he sits on the
 * keeper clock and what he would cost to keep.
 *
 * All clock and cost SEMANTICS live in `@/lib/keeper-clock`. This module only
 * persists and reads them. There are no keeper fees in this league.
 *
 *  - basis_round: the round the player OCCUPIED LAST SEASON — his draft round if
 *    he was drafted, or the cost round he was kept at if he was kept. It walks
 *    down by one every keeper season, because the league prices a keeper against
 *    last season's round rather than against his original draft round. Undrafted
 *    players carry a null basis and use the undrafted default round.
 *  - consecutive_seasons: KEEPER seasons the current franchise has already
 *    served with him, not counting the season it acquired him. Two is the max.
 *  - last_team_id: supports the trade-back guard.
 *  - prior_owner_clocks: the clock a player carried when he left each roster, so
 *    a manager who re-acquires him doesn't get a free reset.
 */

/**
 * When and how the current franchise came to hold a player.
 *
 * The keeper term is an acquisition season plus two keeper seasons, so the
 * season the tenure STARTED in is an input to every clock read. Until this was
 * recorded it had to be assumed, which is why the league holds two records of
 * Puka Nacua that disagree by a full season.
 */
export type AcquisitionStamp = {
  /** The date the acquiring trade happened, `YYYY-MM-DD`. */
  acquiredAt: string | null;
  /** The league season that date belongs to. */
  acquisitionSeason: number | null;
};

export type KeeperRights = {
  playerId: string;
  isUndrafted: boolean;
  originalRound: number | null;
  basisRound: number | null;
  currentTeamId: string | null;
  /** Consecutive KEEPER seasons already served by the current franchise. */
  consecutiveSeasons: number;
  lastTeamId: string | null;
  priorOwnerClocks: Record<string, number>;
  /** When the current franchise acquired him. Null where never recorded. */
  acquiredAt: string | null;
  acquisitionSeason: number | null;
  /** The stamp he carried when he left each roster, for an exact reversal. */
  priorOwnerAcquisitions: Record<string, AcquisitionStamp>;
};

type RightsRow = {
  player_id: string;
  is_undrafted: boolean;
  original_round: number | null;
  basis_round: number | null;
  current_team_id: string | null;
  consecutive_seasons: number;
  prior_owner_clocks: Record<string, number> | null;
  last_team_id: string | null;
  acquired_at: string | null;
  acquisition_season: number | null;
  prior_owner_acquisitions: Record<string, AcquisitionStamp> | null;
};

const RIGHTS_COLUMNS =
  "player_id, is_undrafted, original_round, basis_round, current_team_id, consecutive_seasons, prior_owner_clocks, last_team_id, acquired_at, acquisition_season, prior_owner_acquisitions";

function toRights(r: RightsRow): KeeperRights {
  return {
    playerId: r.player_id,
    isUndrafted: r.is_undrafted,
    originalRound: r.original_round,
    basisRound: r.basis_round,
    currentTeamId: r.current_team_id,
    consecutiveSeasons: r.consecutive_seasons,
    lastTeamId: r.last_team_id,
    priorOwnerClocks: r.prior_owner_clocks ?? {},
    acquiredAt: r.acquired_at,
    acquisitionSeason: r.acquisition_season,
    priorOwnerAcquisitions: r.prior_owner_acquisitions ?? {},
  };
}

/**
 * The round this player would occupy if kept right now, or null when there is
 * no such round because he cannot be kept — a player who occupied a round-1
 * slot last season (rule R6 in `keeper-clock`).
 */
export function nextKeeperCostRound(
  rights: Pick<KeeperRights, "basisRound" | "consecutiveSeasons" | "isUndrafted">,
): number | null {
  return keeperCostRound({
    basisRound: rights.basisRound,
    seasonsKept: rights.consecutiveSeasons,
    isUndrafted: rights.isUndrafted,
  });
}

/** Where this player sits on the keeper clock. */
export function rightsClock(rights: Pick<KeeperRights, "consecutiveSeasons">): ClockPosition {
  return clockPosition(rights.consecutiveSeasons);
}

export function describeRightsClock(rights: Pick<KeeperRights, "consecutiveSeasons">): string {
  return describeClock(rights.consecutiveSeasons);
}

export type Eligibility = KeeperEligibility;

/** Eligibility + cost for the CURRENT owner keeping this player next season. */
export function evaluateRights(rights: KeeperRights): Eligibility {
  return evaluateKeeperEligibility({
    basisRound: rights.basisRound,
    seasonsKept: rights.consecutiveSeasons,
    isUndrafted: rights.isUndrafted,
    originalRound: rights.originalRound,
  });
}

export async function getRights(playerId: string): Promise<KeeperRights | null> {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("keeper_rights")
    .select(RIGHTS_COLUMNS)
    .eq("player_id", playerId)
    .maybeSingle();
  return data ? toRights(data as RightsRow) : null;
}

export async function getManyRights(playerIds: string[]): Promise<Map<string, KeeperRights>> {
  if (!playerIds.length) return new Map();
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("keeper_rights")
    .select(RIGHTS_COLUMNS)
    .in("player_id", playerIds);
  return new Map(((data ?? []) as RightsRow[]).map((r) => [r.player_id, toRights(r)]));
}

/**
 * A real draft selection resets everything: the cost basis becomes the round he
 * was just drafted in, and the keeper clock starts over at zero.
 */
export async function recordDraftSelection(
  playerId: string,
  round: number,
  teamId: string | null,
): Promise<void> {
  const supabase = createServiceClient();
  await supabase.from("keeper_rights").upsert(
    {
      player_id: playerId,
      is_undrafted: false,
      original_round: round,
      basis_round: round,
      current_team_id: teamId,
      consecutive_seasons: 0,
      prior_owner_clocks: {},
      // Wiped alongside the clocks: a redrafted player's earlier tenure is
      // over, and a lingering stamp could be restored by a later reversal and
      // describe a tenure that no longer exists.
      prior_owner_acquisitions: {},
      last_team_id: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "player_id" },
  );
}

/** Ensure a rights row exists. Undrafted players get a null basis round. */
export async function ensureRights(
  playerId: string,
  opts: { teamId?: string | null; originalRound?: number | null; isUndrafted?: boolean } = {},
): Promise<KeeperRights> {
  const existing = await getRights(playerId);
  if (existing) return existing;

  const isUndrafted = opts.isUndrafted ?? opts.originalRound == null;
  const round = isUndrafted ? null : opts.originalRound ?? null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("keeper_rights")
    .insert({
      player_id: playerId,
      is_undrafted: isUndrafted,
      original_round: round,
      // An undrafted player has no cost basis at all, so the column is left
      // unset rather than written as a round he never occupied.
      ...(round == null ? {} : { basis_round: round }),
      current_team_id: opts.teamId ?? null,
      consecutive_seasons: 0,
      prior_owner_clocks: {},
    })
    .select(RIGHTS_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return toRights(data as RightsRow);
}

/**
 * Record a confirmed keeper season — advances the clock by one AND walks the
 * cost basis down to the round he has just occupied, so next season prices off
 * this season rather than off a draft that may be several years back.
 */
export async function applyKeeperSeason(playerId: string, teamId: string): Promise<void> {
  const rights = await getRights(playerId);
  if (!rights) throw new Error("No keeper rights on file for this player.");

  // A player who occupied a round-1 slot has no cheaper round to be kept at, so
  // there is no keeper season to apply. `declareKeeper` already refuses him;
  // this is the backstop, because writing a null basis here would either violate
  // the column's CHECK or silently mark him undrafted.
  const basisRound = nextKeeperCostRound(rights);
  if (basisRound == null) {
    throw new Error(
      `${playerId} occupied a round-1 slot last season and cannot be kept, so no keeper ` +
        `season can be recorded for him.`,
    );
  }

  const supabase = createServiceClient();
  const sameFranchise = rights.currentTeamId === teamId;
  await supabase
    .from("keeper_rights")
    .update({
      consecutive_seasons: sameFranchise ? rights.consecutiveSeasons + 1 : 1,
      basis_round: basisRound,
      current_team_id: teamId,
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", playerId);
}

/** Reverse a keeper season (e.g. an un-declared keeper). Restores the basis too. */
export async function revertKeeperSeason(playerId: string): Promise<void> {
  const rights = await getRights(playerId);
  if (!rights) return;
  const supabase = createServiceClient();
  await supabase
    .from("keeper_rights")
    .update({
      consecutive_seasons: Math.max(0, rights.consecutiveSeasons - 1),
      ...(rights.basisRound == null ? {} : { basis_round: rights.basisRound + 1 }),
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", playerId);
}

/**
 * Transfer keeper rights on a trade. The contract has the cost basis carry
 * across untouched while keeper eligibility restarts with the new team, so
 * `basis_round` is left alone and the clock comes from `keeper-clock` (rule R5
 * there, which resets it).
 *
 * The sender's clock is stamped into `prior_owner_clocks` on the way out. That
 * column already means "the clock a player carried when he left each roster",
 * and a trade is a player leaving a roster — `recordDeparture` does the same
 * thing for a drop. Two things fall out of writing it here:
 *
 *   1. a manager who trades a player away and later re-acquires him resumes the
 *      clock he left with instead of getting a free reset, which is the same
 *      loophole `recordReacquire` already closes for waiver adds;
 *   2. `restoreRightsOnTradeReversal` has an exact value to put back, so a
 *      mis-logged trade can genuinely be undone rather than approximately.
 */
export async function transferRightsOnTrade(
  playerId: string,
  fromTeamId: string,
  toTeamId: string,
  /**
   * The date the trade happened, `YYYY-MM-DD`.
   *
   * OPTIONAL ONLY SO THE TWELVE UNDATED IMPORTED TRADES REMAIN APPLICABLE. Every
   * trade logged through the app supplies it, and omitting it leaves the
   * acquisition season null rather than inventing one — a null reads as "not
   * recorded" and can be backfilled, whereas a guessed season is
   * indistinguishable from a known one and silently corrupts a clock nine months
   * later.
   */
  tradedAt?: string | null,
): Promise<void> {
  const rights = await ensureRights(playerId, { teamId: fromTeamId });
  const supabase = createServiceClient();

  // The season the new tenure starts in, derived from the date rather than
  // assumed. `@/lib/trade-timing` owns that derivation.
  let acquisitionSeason: number | null = null;
  if (tradedAt) {
    const { seasonForDate } = await import("@/lib/trade-timing");
    acquisitionSeason = seasonForDate(tradedAt);
  }

  await supabase
    .from("keeper_rights")
    .update({
      current_team_id: toTeamId,
      last_team_id: fromTeamId,
      consecutive_seasons: seasonsKeptAfterTrade(rights.consecutiveSeasons),
      prior_owner_clocks: {
        ...rights.priorOwnerClocks,
        [fromTeamId]: rights.consecutiveSeasons,
      },
      acquired_at: tradedAt ?? null,
      acquisition_season: acquisitionSeason,
      // The stamp the sender's tenure carried, so a reversal restores the
      // acquisition as exactly as it restores the clock.
      prior_owner_acquisitions: {
        ...rights.priorOwnerAcquisitions,
        [fromTeamId]: {
          acquiredAt: rights.acquiredAt,
          acquisitionSeason: rights.acquisitionSeason,
        },
      },
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", playerId);
}

/**
 * Undo `transferRightsOnTrade` — the player goes back to the sending franchise
 * with the clock he had before the trade was applied.
 *
 * Refuses rather than guessing when there is no stamped clock for the franchise
 * being restored to. A trade applied before that stamp existed leaves no record
 * of the pre-trade clock anywhere, and silently writing zero would hand the
 * franchise keeper seasons it has already used.
 */
export async function restoreRightsOnTradeReversal(
  playerId: string,
  fromTeamId: string,
  toTeamId: string,
): Promise<void> {
  const rights = await getRights(playerId);
  if (!rights) return;

  // Only unwind a transfer that actually looks applied. Reversing twice must
  // not walk the player back off the roster he legitimately sits on.
  if (rights.currentTeamId !== toTeamId) return;

  const restored = rights.priorOwnerClocks[fromTeamId];
  if (restored == null) {
    throw new Error(
      `Cannot reverse the transfer of player ${playerId}: no record of the keeper clock he ` +
        `carried before the trade, so restoring him would invent a clock. Set ` +
        `keeper_rights.consecutive_seasons by hand for this player and reverse the rest.`,
    );
  }

  // The stamp is consumed by the restore, so it does not linger and make a
  // later re-acquisition resume a clock that was never actually left behind.
  const remaining = Object.fromEntries(
    Object.entries(rights.priorOwnerClocks).filter(([teamId]) => teamId !== fromTeamId),
  );

  // The acquisition stamp comes back with the clock. Restoring one without the
  // other would leave the player on his old roster carrying the date he was
  // traded AWAY — a tenure that reads as starting when it actually ended.
  const restoredAcquisition = rights.priorOwnerAcquisitions[fromTeamId] ?? {
    acquiredAt: null,
    acquisitionSeason: null,
  };
  const remainingAcquisitions = Object.fromEntries(
    Object.entries(rights.priorOwnerAcquisitions).filter(
      ([teamId]) => teamId !== fromTeamId,
    ),
  );

  const supabase = createServiceClient();
  await supabase
    .from("keeper_rights")
    .update({
      current_team_id: fromTeamId,
      // The trade-back guard was set by the trade being undone, so it goes too.
      last_team_id: null,
      consecutive_seasons: restored,
      prior_owner_clocks: remaining,
      acquired_at: restoredAcquisition.acquiredAt,
      acquisition_season: restoredAcquisition.acquisitionSeason,
      prior_owner_acquisitions: remainingAcquisitions,
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", playerId);
}

/** Player leaves a roster (drop/trade-away): remember the clock for that team. */
export async function recordDeparture(playerId: string, teamId: string): Promise<void> {
  const rights = await getRights(playerId);
  if (!rights) return;
  const supabase = createServiceClient();
  await supabase
    .from("keeper_rights")
    .update({
      prior_owner_clocks: { ...rights.priorOwnerClocks, [teamId]: rights.consecutiveSeasons },
      current_team_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", playerId);
}

/**
 * Re-acquisition off waivers / free agency: a manager who previously held this
 * player resumes the clock he left with, so dropping and re-adding isn't a way
 * to buy extra keeper years. Anyone else starts fresh.
 */
export async function recordReacquire(playerId: string, teamId: string): Promise<void> {
  const rights = await getRights(playerId);
  if (!rights) {
    await ensureRights(playerId, { teamId, isUndrafted: true });
    return;
  }
  const restored = rights.priorOwnerClocks[teamId];
  const supabase = createServiceClient();
  await supabase
    .from("keeper_rights")
    .update({
      current_team_id: teamId,
      consecutive_seasons: restored ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", playerId);
}

/**
 * Trade-back guard: a player can't be traded straight back to the team that just
 * traded him away, before the next draft.
 */
export async function wouldViolateTradeBack(playerId: string, toTeamId: string): Promise<boolean> {
  const rights = await getRights(playerId);
  return !!rights && rights.lastTeamId === toTeamId;
}

export { KEEPERS };

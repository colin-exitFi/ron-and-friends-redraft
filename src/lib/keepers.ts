import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { CURRENT_SEASON, KEEPERS } from "@/lib/league-config";
import {
  clockPosition,
  describeClock,
  evaluateKeeperEligibility,
  resolveSameRoundConflicts,
  sheetTenureYearEnteringSeason,
  type KeeperSlotClaim,
} from "@/lib/keeper-clock";
import {
  applyKeeperSeason,
  ensureRights,
  evaluateRights,
  getManyRights,
  revertKeeperSeason,
} from "@/lib/keeper-rights";
import type { KeeperStatus } from "@/lib/supabase/types";

/**
 * Declaring and un-declaring keepers, and placing them on the board.
 *
 * This is the WRITE path, and it only runs when the database is connected. The
 * read path that /keepers renders lives in `@/lib/league-source`, which falls
 * back to the snapshots in `data/`.
 *
 * All clock and cost SEMANTICS come from `@/lib/keeper-clock`. Nothing here
 * decides what a keeper costs or how long he may be held.
 *
 * ON THE TWO CLOCK CONVENTIONS: `keepers.seasons_kept` is keeper seasons already
 * SERVED, excluding the acquisition season. `keepers.sheet_tenure_year` is the
 * spreadsheets' "N of 3", which counts it. A database CHECK holds them to
 * `seasons_kept = max(0, sheet_tenure_year - 2)`, so both are written together
 * from the same source value and never derived from each other by hand.
 */

/** Keepers are live, so declarations target the season the app is pointed at. */
export function keeperTargetSeason(): number {
  return CURRENT_SEASON;
}

/** Cost basis comes from the season before the one being declared for. */
export function keeperSourceSeason(targetSeason: number): number {
  return targetSeason - 1;
}

export type KeeperRightsSummary = {
  /** Null for a player who has never been drafted. */
  basisRound: number | null;
  consecutiveSeasons: number;
  /** Human-readable clock state from `@/lib/keeper-clock`. */
  clock: string;
  pedigree: string;
};

export type KeeperView = {
  id: string;
  season: number;
  teamId: string;
  /** Short handle — "Greg". */
  teamName: string;
  franchiseName: string;
  manager: string;
  playerId: string;
  playerName: string | null;
  position: string | null;
  costRound: number;
  /** The round he occupied LAST season. Not his original draft round. */
  basisRound: number | null;
  isUndrafted: boolean;
  /** Keeper seasons already served entering this season. */
  seasonsKept: number;
  /** The keeper sheets' "N of 3" for this season, where it is known. */
  sheetTenureYear: number | null;
  clock: string;
  finalSeason: boolean;
  clockResetByTrade: boolean;
  status: KeeperStatus;
  declaredAt: string;
  rights: KeeperRightsSummary | null;
};

export type EligiblePlayer = {
  playerId: string;
  playerName: string;
  /** Round he occupied on last season's board. */
  draftRound: number;
  overallPick: number;
  isUndrafted: boolean;
  /** Cost if kept now, from the rights ledger. Null when he cannot be kept. */
  costRound: number | null;
  clock: string;
  /**
   * Whether he can actually be kept. INELIGIBLE PLAYERS ARE STILL RETURNED,
   * with the reason — a manager whose first-round pick is off the table needs to
   * be told why rather than finding the name missing from his own roster list
   * and assuming a bug.
   */
  eligible: boolean;
  ineligibleReason: string | null;
};

const KEEPER_COLUMNS =
  "id, season, team_id, player_id, cost_round, basis_round, is_undrafted, " +
  "sheet_tenure_year, seasons_kept, acquired_by_trade, clock_reset_by_trade, " +
  "status, declared_at, teams(short_name, franchise_name, manager), players(full_name, position)";

type KeeperRow = {
  id: string;
  season: number;
  team_id: string;
  player_id: string;
  cost_round: number;
  basis_round: number | null;
  is_undrafted: boolean;
  sheet_tenure_year: number | null;
  seasons_kept: number;
  acquired_by_trade: boolean;
  clock_reset_by_trade: boolean;
  status: KeeperStatus;
  declared_at: string;
  teams: { short_name: string; franchise_name: string; manager: string } | null;
  players: { full_name: string; position: string | null } | null;
};

function toView(row: KeeperRow): KeeperView {
  return {
    id: row.id,
    season: row.season,
    teamId: row.team_id,
    teamName: row.teams?.short_name ?? "Unknown",
    franchiseName: row.teams?.franchise_name ?? "Unknown",
    manager: row.teams?.manager ?? "",
    playerId: row.player_id,
    playerName: row.players?.full_name ?? null,
    position: row.players?.position ?? null,
    costRound: row.cost_round,
    basisRound: row.basis_round,
    isUndrafted: row.is_undrafted,
    seasonsKept: row.seasons_kept,
    sheetTenureYear: row.sheet_tenure_year,
    clock: describeClock(row.seasons_kept),
    finalSeason: clockPosition(row.seasons_kept).isFinalSeason,
    clockResetByTrade: row.clock_reset_by_trade,
    status: row.status,
    declaredAt: row.declared_at,
    rights: null,
  };
}

export async function listKeepers(season: number): Promise<KeeperView[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("keepers")
    .select(KEEPER_COLUMNS)
    .eq("season", season)
    .neq("status", "withdrawn")
    .order("cost_round", { ascending: true });
  if (error) throw new Error(error.message);

  const views = (data as unknown as KeeperRow[]).map(toView);

  // Enrich with the keeper-rights ledger (pedigree + per-franchise clock).
  const rightsMap = await getManyRights(views.map((v) => v.playerId));
  for (const v of views) {
    const r = rightsMap.get(v.playerId);
    if (!r) continue;
    v.rights = {
      basisRound: r.basisRound,
      consecutiveSeasons: r.consecutiveSeasons,
      clock: describeClock(r.consecutiveSeasons),
      pedigree: r.isUndrafted
        ? `Undrafted — free-agent pickup, costs R${KEEPERS.undraftedDefaultRound}`
        : `Drafted R${r.originalRound ?? r.basisRound}`,
    };
  }
  return views;
}

/**
 * Players a franchise could keep: everyone it took on last season's board who
 * is not already declared. Cost and clock come from the rights ledger, so a
 * traded pedigree flows through without this function knowing about trades.
 */
export async function getEligiblePlayers(
  teamId: string,
  targetSeason: number,
): Promise<EligiblePlayer[]> {
  const sourceSeason = keeperSourceSeason(targetSeason);
  const supabase = createServiceClient();

  const [{ data: slots }, { data: existing }] = await Promise.all([
    supabase
      .from("draft_slots")
      .select("overall_pick, round, player_id, players(full_name)")
      .eq("season", sourceSeason)
      .eq("current_team_id", teamId)
      .not("player_id", "is", null)
      .order("overall_pick"),
    supabase
      .from("keepers")
      .select("player_id")
      .eq("season", targetSeason)
      .eq("team_id", teamId),
  ]);

  const taken = new Set((existing ?? []).map((k) => k.player_id));

  type SlotRow = {
    overall_pick: number;
    round: number;
    player_id: string;
    players: { full_name: string } | null;
  };

  /**
   * Only players already declared are dropped. A round-1 player used to be
   * filtered out here, which meant a manager looking at his own roster simply
   * did not see his best player and had no way to know whether that was a rule
   * or a bug. He is now returned, flagged ineligible, with the reason.
   */
  const candidates = (slots as unknown as SlotRow[] | null ?? []).filter(
    (s) => !taken.has(s.player_id),
  );

  const rights = await getManyRights(candidates.map((s) => s.player_id));

  return candidates.map((s) => {
    const r = rights.get(s.player_id);
    const seasonsKept = r?.consecutiveSeasons ?? 0;

    // With no rights row on file, the board slot he occupied IS his basis — it
    // is the round he sat in last season, which is exactly what the rule keys
    // on. So the same evaluation applies either way.
    const evaluated = r
      ? evaluateRights(r)
      : evaluateKeeperEligibility({
          basisRound: s.round,
          seasonsKept: 0,
          isUndrafted: false,
          originalRound: s.round,
        });

    return {
      playerId: s.player_id,
      playerName: s.players?.full_name ?? "Unknown",
      draftRound: s.round,
      overallPick: s.overall_pick,
      isUndrafted: r?.isUndrafted ?? false,
      costRound: evaluated.eligible ? evaluated.costRound : null,
      clock: describeClock(seasonsKept),
      eligible: evaluated.eligible,
      ineligibleReason: evaluated.eligible ? null : evaluated.reason ?? "Not keeper-eligible.",
    };
  });
}

/**
 * The keeper YEAR is never supplied by the caller — it comes off the rights
 * ledger's clock, so a franchise cannot reset a player's clock by re-declaring
 * him as a fresh keeper.
 */
export type DeclareKeeperInput = {
  season: number;
  teamId: string;
  playerId: string;
  isUndrafted?: boolean;
  /** Round he occupied last season, when the ledger does not already know. */
  basisRound?: number;
};

export async function declareKeeper(input: DeclareKeeperInput): Promise<KeeperView> {
  const supabase = createServiceClient();

  const { data: league } = await supabase
    .from("leagues")
    .select("season, keepers_per_team")
    .eq("season", input.season)
    .maybeSingle();
  if (!league) {
    throw new Error(
      `No ${input.season} season in the database yet. Run the seed first: node scripts/seed-league.mjs`,
    );
  }

  const { data: teamKeepersRaw } = await supabase
    .from("keepers")
    .select("id, player_id, cost_round, players(full_name)")
    .eq("season", input.season)
    .eq("team_id", input.teamId)
    .neq("status", "withdrawn");

  type TeamKeeperRow = {
    id: string;
    player_id: string;
    cost_round: number;
    players: { full_name: string } | null;
  };
  const teamKeepers = (teamKeepersRaw as unknown as TeamKeeperRow[] | null) ?? [];

  if (teamKeepers.length >= league.keepers_per_team) {
    throw new Error(`Maximum ${league.keepers_per_team} keepers per franchise.`);
  }
  if (teamKeepers.some((k) => k.player_id === input.playerId)) {
    throw new Error("Player already declared as a keeper.");
  }

  const { data: player } = await supabase
    .from("players")
    .select("full_name")
    .eq("player_id", input.playerId)
    .maybeSingle();
  if (!player) throw new Error("Player is not in the players table.");

  // The rights ledger is the source of truth for cost basis and clock, so a
  // traded pedigree and the per-season escalation flow through automatically.
  const rights = await ensureRights(input.playerId, {
    teamId: input.teamId,
    originalRound: input.basisRound ?? null,
    isUndrafted: input.isUndrafted,
  });

  const evaluated = evaluateRights(rights);
  if (!evaluated.eligible || evaluated.costRound == null) {
    throw new Error(evaluated.reason ?? "Player is not keeper-eligible.");
  }
  // Narrowed for the rest of the function: an eligible player always has a real
  // cost round, and the check above is what guarantees it.
  const costRound: number = evaluated.costRound;

  // A franchise holds one pick per round, so two keepers cannot share a round.
  // Existing keepers keep their STORED cost, which was finalized when they were
  // declared; re-deriving it from the ledger would double-count their keep.
  const existingClaims: KeeperSlotClaim[] = teamKeepers.map((k) => ({
    playerId: k.player_id,
    playerName: k.players?.full_name ?? "?",
    baseCostRound: k.cost_round,
    eligible: true,
  }));

  const { resolved, error: conflictErr } = resolveSameRoundConflicts([
    ...existingClaims,
    {
      playerId: input.playerId,
      playerName: player.full_name,
      baseCostRound: costRound,
      eligible: true,
    },
  ]);
  if (conflictErr) throw new Error(conflictErr);

  const final = resolved.find((k) => k.playerId === input.playerId);
  if (!final) throw new Error("Could not resolve a cost round for this keeper.");

  // Re-sync any existing keeper whose round shifted because of the bump. Done
  // before the insert so the one-per-round index never sees a collision.
  for (const claim of resolved) {
    const row = teamKeepers.find((t) => t.player_id === claim.playerId);
    if (row && row.cost_round !== claim.costRound) {
      await supabase
        .from("keepers")
        .update({ cost_round: claim.costRound })
        .eq("id", row.id);
    }
  }

  const { data: inserted, error } = await supabase
    .from("keepers")
    .insert({
      season: input.season,
      team_id: input.teamId,
      player_id: input.playerId,
      cost_round: final.costRound,
      basis_round: rights.isUndrafted ? null : rights.basisRound,
      is_undrafted: rights.isUndrafted,
      // Written together from one value so the two conventions cannot diverge.
      seasons_kept: rights.consecutiveSeasons,
      sheet_tenure_year: sheetTenureYearEnteringSeason(rights.consecutiveSeasons),
      status: "declared",
      source: "app",
    })
    .select(KEEPER_COLUMNS)
    .single();
  if (error) throw new Error(error.message);

  // Record the keeper season on the ledger (escalates cost, advances the clock).
  await applyKeeperSeason(input.playerId, input.teamId);
  await syncBoardKeepers(input.season);

  return toView(inserted as unknown as KeeperRow);
}

export async function removeKeeper(id: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("keepers")
    .select("season, team_id, player_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return;

  await supabase.from("keepers").delete().eq("id", id);

  // Reverse the keeper season on the rights ledger.
  await revertKeeperSeason(row.player_id);

  // Re-resolve same-round conflicts among what is left.
  const remaining = (await listKeepers(row.season)).filter(
    (k) => k.teamId === row.team_id,
  );
  if (remaining.length > 1) {
    const { resolved } = resolveSameRoundConflicts(
      remaining.map((k) => ({
        playerId: k.playerId,
        playerName: k.playerName ?? "?",
        baseCostRound: k.costRound,
        eligible: true,
      })),
    );
    for (const claim of resolved) {
      const view = remaining.find((t) => t.playerId === claim.playerId);
      if (view && view.costRound !== claim.costRound) {
        await supabase
          .from("keepers")
          .update({ cost_round: claim.costRound })
          .eq("id", view.id);
      }
    }
  }

  await syncBoardKeepers(row.season);
}

/**
 * Put every declared keeper onto the board at his cost round.
 *
 * A KEEPER MAY OCCUPY AN ACQUIRED PICK. This is not an assumption — four of the
 * keepers the Smart Draft room already carries do exactly that: Kyle's Jaxon
 * Smith-Njigba sits on Elbe's R4, Stefan's Rashee Rice on Witte's R4, Kyle's
 * Chase Brown on Witte's R6, and Witte's De'Von Achane on Zach's R8. So the
 * slot is found among the picks the franchise CURRENTLY HOLDS in that round,
 * preferring its own where it still has it.
 *
 * An earlier version of this searched by `original_team_id`, which would have
 * failed for all four of those keepers and for Zach's Ladd McConkey at R6 —
 * Zach traded his own R6 to Witte and holds Kyle's instead.
 */
export async function placeKeepersOnBoard(targetSeason: number): Promise<number> {
  const supabase = createServiceClient();
  const keepers = await listKeepers(targetSeason);
  if (!keepers.length) throw new Error("No keepers declared.");

  const { data: draftState } = await supabase
    .from("draft_state")
    .select("status")
    .eq("season", targetSeason)
    .maybeSingle();
  if (!draftState) {
    throw new Error(`No ${targetSeason} draft board in the database yet.`);
  }
  if (draftState.status !== "not_started") {
    throw new Error("Keepers are locked once the draft is under way.");
  }

  // Idempotent: clear prior placements first, so re-running cannot duplicate a
  // keeper or leave one stranded at a round he no longer costs.
  await supabase
    .from("draft_slots")
    .update({ player_id: null, is_keeper: false })
    .eq("season", targetSeason)
    .eq("is_keeper", true);

  let placed = 0;
  for (const k of keepers) {
    const { data: candidates } = await supabase
      .from("draft_slots")
      .select("id, original_team_id, player_id")
      .eq("season", targetSeason)
      .eq("round", k.costRound)
      .eq("current_team_id", k.teamId);

    const held = (candidates ?? []).filter((s) => !s.player_id);
    if (!held.length) {
      throw new Error(
        `${k.teamName} holds no free round-${k.costRound} pick in ${targetSeason}, own or ` +
          `acquired, so ${k.playerName} cannot be placed there. This is the Colston ` +
          `Loveland situation and it needs a ruling on his cost round.`,
      );
    }

    // Prefer the franchise's own slot so a keeper does not consume an acquired
    // pick while its own sits empty in the same round.
    const slot = held.find((s) => s.original_team_id === k.teamId) ?? held[0];

    await supabase
      .from("draft_slots")
      .update({ player_id: k.playerId, is_keeper: true })
      .eq("id", slot.id);

    await supabase.from("keepers").update({ status: "placed" }).eq("id", k.id);
    placed += 1;
  }

  return placed;
}

/**
 * Keep the board in lockstep with declarations. Safe to call after any
 * declare/remove: it only touches a board that exists and has not started.
 */
export async function syncBoardKeepers(targetSeason: number): Promise<void> {
  const supabase = createServiceClient();
  const { data: state } = await supabase
    .from("draft_state")
    .select("status")
    .eq("season", targetSeason)
    .maybeSingle();
  if (!state || state.status !== "not_started") return;

  const keepers = await listKeepers(targetSeason);
  if (keepers.length) {
    await placeKeepersOnBoard(targetSeason);
    return;
  }

  await supabase
    .from("draft_slots")
    .update({ player_id: null, is_keeper: false })
    .eq("season", targetSeason)
    .eq("is_keeper", true);
}

import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { buildRoomSync } from "@/lib/league-json";
import { CURRENT_SEASON, KEEPERS, TRADES } from "@/lib/league-config";
import {
  clockPosition,
  describeClock,
  evaluateKeeperEligibility,
  keeperCostRound,
} from "@/lib/keeper-clock";
import {
  describeDisputedClock,
  findTenureDispute,
} from "@/lib/keeper-tenure-dispute";
import { parsePickRef, pickTradableSeasons } from "@/lib/trade-rules";
import {
  pickLabel,
  pickRefLabel,
  type FranchiseDetailView,
  type FranchiseKeeper,
  type KeeperDeclarationStatus,
  type FranchisePickView,
  type FranchiseView,
  type IneligibleDeclaration,
  type KeeperBoardView,
  type KeeperConflict,
  type KeeperEntry,
  type PendingDeclaration,
  type TradeBoardView,
  type TradeLogEntry,
  type TradeLogPick,
  type TradeLogPlayer,
  type TradeLogSide,
  type TradedPickView,
} from "@/lib/league-view";

/**
 * The same views as `@/lib/league-json`, read out of Supabase instead of the
 * snapshots in `data/`.
 *
 * Only reached when `hasDatabase()` is true, and `@/lib/league-source` falls
 * back to JSON if any of it throws. Nothing here is on the critical path for
 * draft day; the snapshots are.
 *
 * The clock semantics are NOT re-derived here. `keepers.seasons_kept` is stored
 * in the `@/lib/keeper-clock` convention (keeper seasons served, excluding the
 * acquisition season) and a database CHECK holds it to
 * `seasons_kept = max(0, sheet_tenure_year - 2)`, so this module reads it and
 * hands it straight to `describeClock`.
 */

function fail(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`Reading ${what} from the database failed: ${error.message}`);
}

type TeamRow = {
  id: string;
  short_name: string;
  franchise_name: string;
  manager: string;
  abbrev: string | null;
  draft_slot: number | null;
  espn_team_id: number | null;
  /** Set once the manager's keeper list is final. See the migration comment. */
  keeper_declarations_closed_at: string | null;
};

// One literal, not a concatenation: postgrest-js infers the row type from the
// select string, and only a literal gives it something to infer from.
const TEAM_COLUMNS =
  "id, short_name, franchise_name, manager, abbrev, draft_slot, espn_team_id, keeper_declarations_closed_at";

/**
 * The three declaration states. Unlike the JSON path, the database can tell
 * "hasn't answered" from "closed his list and is keeping nobody", because
 * `teams.keeper_declarations_closed_at` records it.
 */
function declarationStatusFor(
  declared: number,
  allowed: number,
  closedAt: string | null,
): KeeperDeclarationStatus {
  if (declared >= allowed) return "complete";
  return closedAt ? "final" : "awaiting";
}

async function readTeams(): Promise<TeamRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("teams")
    .select(TEAM_COLUMNS)
    .order("draft_slot", { ascending: true, nullsFirst: false })
    .order("short_name", { ascending: true });
  fail("franchises", error);
  return (data ?? []) as TeamRow[];
}

type SlotRow = {
  round: number;
  pick_in_round: number;
  overall_pick: number;
  original_team_id: string;
  current_team_id: string;
  is_keeper: boolean;
  player_id: string | null;
};

async function readSlots(season: number): Promise<SlotRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("draft_slots")
    .select(
      "round, pick_in_round, overall_pick, original_team_id, current_team_id, is_keeper, player_id",
    )
    .eq("season", season)
    .order("overall_pick", { ascending: true });
  fail("the draft board", error);
  return (data ?? []) as SlotRow[];
}

// --- Keepers ----------------------------------------------------------------

type KeeperRow = {
  id: string;
  team_id: string;
  player_id: string;
  cost_round: number;
  basis_round: number | null;
  is_undrafted: boolean;
  sheet_tenure_year: number | null;
  seasons_kept: number;
  acquired_by_trade: boolean;
  clock_reset_by_trade: boolean;
  source: string | null;
  notes: string | null;
};

type PlayerRow = {
  player_id: string;
  full_name: string;
  position: string | null;
  nfl_team: string | null;
};

export async function getKeeperBoardFromDb(): Promise<KeeperBoardView> {
  const season = CURRENT_SEASON;
  const supabase = createServiceClient();

  const [teams, slots, keepersResult] = await Promise.all([
    readTeams(),
    readSlots(season),
    supabase
      .from("keepers")
      .select(
        "id, team_id, player_id, cost_round, basis_round, is_undrafted, " +
          "sheet_tenure_year, seasons_kept, acquired_by_trade, clock_reset_by_trade, source, notes",
      )
      .eq("season", season)
      .neq("status", "withdrawn"),
  ]);
  fail("keepers", keepersResult.error);
  const keeperRows = (keepersResult.data ?? []) as unknown as KeeperRow[];

  const players = new Map<string, PlayerRow>();
  if (keeperRows.length) {
    const { data, error } = await supabase
      .from("players")
      .select("player_id, full_name, position, nfl_team")
      .in("player_id", keeperRows.map((k) => k.player_id));
    fail("players", error);
    for (const p of (data ?? []) as PlayerRow[]) players.set(p.player_id, p);
  }

  const teamById = new Map(teams.map((t) => [t.id, t]));

  // The board is what says which slot a keeper occupies, so the label comes
  // from there rather than being recomputed from the cost round.
  const slotByPlayer = new Map(
    slots.filter((s) => s.player_id).map((s) => [s.player_id as string, s]),
  );

  const allKeepers: KeeperEntry[] = keeperRows.map((k) => {
    const team = teamById.get(k.team_id);
    const player = players.get(k.player_id);
    const slot = slotByPlayer.get(k.player_id);
    const clock = clockPosition(k.seasons_kept);

    // A note on a `commissioner`-sourced row IS the ruling that settled the
    // disagreement, so it must not be presented as an open question. Anything
    // else still needs an answer. Getting this backwards would either hide a
    // real conflict or nag about one that has already been decided.
    const conflicts: KeeperConflict[] = [];
    if (k.notes) {
      conflicts.push(
        k.source === "commissioner"
          ? { summary: "The sources disagreed; settled by ruling.", resolution: k.notes }
          : { summary: k.notes, resolution: null },
      );
    }

    /**
     * Same lookup the JSON layer does, deliberately keyed on the same two
     * fields, so both sources report an unsettled tenure identically instead of
     * each computing its own confident final season.
     */
    const tenureDispute = findTenureDispute(
      player?.full_name ?? k.player_id,
      team?.short_name ?? "?",
    );

    return {
      playerId: k.player_id,
      playerName: player?.full_name ?? k.player_id,
      position: player?.position ?? "",
      nflTeam: player?.nfl_team ?? null,
      teamId: k.team_id,
      teamShortName: team?.short_name ?? "?",
      franchiseName: team?.franchise_name ?? "?",
      manager: team?.manager ?? "?",
      costRound: k.cost_round,
      boardLabel: slot
        ? pickLabel(slot.round, slot.pick_in_round)
        : `R${k.cost_round}`,
      overallPick: slot?.overall_pick ?? k.cost_round * 100,
      basisRound: k.basis_round,
      isUndrafted: k.is_undrafted,
      sheetTenureYear: k.sheet_tenure_year,
      seasonsKept: k.seasons_kept,
      clockLabel: tenureDispute
        ? describeDisputedClock(tenureDispute)
        : describeClock(k.seasons_kept, k.sheet_tenure_year),
      finalSeason: clock.isFinalSeason,
      // A reset clock buys a season the raw position would not show, which is
      // why the sheet tenure wins where it is recorded. R6 then overrides both:
      // a keeper occupying a round-1 slot has no cheaper round next season, so
      // he is done however much clock is left.
      keepableIn2027:
        (k.sheet_tenure_year != null ? k.sheet_tenure_year < 3 : !clock.isFinalSeason) &&
        keeperCostRound({
          basisRound: k.cost_round,
          seasonsKept: k.seasons_kept + 1,
          isUndrafted: k.is_undrafted,
        }) != null,
      tenureDispute,
      clockResetByTrade: k.clock_reset_by_trade,
      sources: k.source ? [k.source] : ["League database"],
      conflicts,
    };
  });

  /**
   * A stored keeper whose basis was a round-1 slot should never have been
   * declared — `declareKeeper` refuses him — so a row like this means the data
   * predates the ruling or was written around the app. Split out rather than
   * rendered as a normal keeper, matching the JSON path exactly so the two
   * sources present the same board.
   */
  const barred = (k: KeeperEntry) => !k.isUndrafted && k.basisRound === 1;

  const ineligible: IneligibleDeclaration[] = allKeepers.filter(barred).map((k) => ({
    playerName: k.playerName,
    teamId: k.teamId,
    teamShortName: k.teamShortName,
    franchiseName: k.franchiseName,
    manager: k.manager,
    basisRound: k.basisRound,
    reason:
      evaluateKeeperEligibility({
        basisRound: k.basisRound,
        seasonsKept: k.seasonsKept,
        isUndrafted: k.isUndrafted,
        originalRound: k.basisRound,
      }).reason ?? "Not keeper-eligible.",
  }));

  const keepers = allKeepers.filter((k) => !barred(k));

  keepers.sort((a, b) => a.overallPick - b.overallPick);

  const declaredByTeam = new Map<string, number>();
  for (const k of keepers) {
    declaredByTeam.set(k.teamId, (declaredByTeam.get(k.teamId) ?? 0) + 1);
  }

  const pending: PendingDeclaration[] = teams
    .map((t) => {
      const declared = declaredByTeam.get(t.id) ?? 0;
      const closedAt = t.keeper_declarations_closed_at;
      return {
        teamId: t.id,
        shortName: t.short_name,
        franchiseName: t.franchise_name,
        manager: t.manager,
        declared,
        allowed: KEEPERS.maxPerTeam,
        status: (closedAt ? "final" : "awaiting") as "final" | "awaiting",
        declarationsClosedAt: closedAt,
      };
    })
    .filter((p) => p.declared < p.allowed)
    .sort((a, b) => a.declared - b.declared || a.shortName.localeCompare(b.shortName));

  return {
    season,
    maxKeeperSeasons: KEEPERS.maxConsecutiveSeasons,
    maxPerTeam: KEEPERS.maxPerTeam,
    keepers,
    ineligible,
    pending,
    awaitingCount: pending.filter((p) => p.status === "awaiting").length,
    expiringCount: keepers.filter((k) => k.finalSeason).length,
    keepableNextSeasonCount: keepers.filter((k) => k.keepableIn2027).length,
    fetchedAt: null,
    fromDatabase: true,
    // Computed from the local room snapshot, not the database: what Smart Draft
    // is missing is a property of that file, and it is readable either way.
    roomSync: buildRoomSync(keepers),
  };
}

// --- Franchises -------------------------------------------------------------

export async function getFranchisesFromDb(): Promise<FranchiseView[]> {
  const season = CURRENT_SEASON;
  const [teams, slots, board] = await Promise.all([
    readTeams(),
    readSlots(season),
    getKeeperBoardFromDb(),
  ]);

  const keepersByTeam = new Map<string, FranchiseKeeper[]>();
  for (const k of board.keepers) {
    const arr = keepersByTeam.get(k.teamId) ?? [];
    arr.push({
      playerId: k.playerId,
      playerName: k.playerName,
      position: k.position,
      costRound: k.costRound,
      boardLabel: k.boardLabel,
      seasonsKept: k.seasonsKept,
      clockLabel: k.clockLabel,
      finalSeason: k.finalSeason,
      tenureDispute: k.tenureDispute,
    });
    keepersByTeam.set(k.teamId, arr);
  }

  const pendingByTeam = new Map(board.pending.map((p) => [p.teamId, p]));

  return teams.map((t) => {
    const held = slots.filter((s) => s.current_team_id === t.id);
    const declared = keepersByTeam.get(t.id) ?? [];
    const pendingRow = pendingByTeam.get(t.id);
    return {
      id: t.id,
      shortName: t.short_name,
      franchiseName: t.franchise_name,
      abbrev: t.abbrev ?? t.short_name.slice(0, 4).toUpperCase(),
      manager: t.manager,
      draftSlot: t.draft_slot,
      espnTeamId: t.espn_team_id,
      picksHeld: held.length,
      picksAcquired: held.filter((s) => s.original_team_id !== t.id).length,
      picksTradedAway: slots.filter(
        (s) => s.original_team_id === t.id && s.current_team_id !== t.id,
      ).length,
      roundsHeld: held.map((s) => s.round).sort((a, b) => a - b),
      keepers: [...declared].sort((a, b) => a.costRound - b.costRound),
      keeperSlotsPending: pendingRow ? pendingRow.allowed - pendingRow.declared : 0,
      keeperSlotsAllowed: KEEPERS.maxPerTeam,
      declarationStatus: declarationStatusFor(
        declared.length,
        KEEPERS.maxPerTeam,
        t.keeper_declarations_closed_at,
      ),
      declarationsClosedAt: t.keeper_declarations_closed_at,
    };
  });
}

export async function getFranchiseDetailFromDb(
  id: string,
): Promise<FranchiseDetailView | null> {
  const season = CURRENT_SEASON;
  const supabase = createServiceClient();

  const [franchises, slots, teams] = await Promise.all([
    getFranchisesFromDb(),
    readSlots(season),
    readTeams(),
  ]);

  const franchise = franchises.find((f) => f.id === id);
  if (!franchise) return null;

  const shortNameById = new Map(teams.map((t) => [t.id, t.short_name]));

  const playerIds = [...new Set(slots.map((s) => s.player_id).filter((p): p is string => !!p))];
  const playerNames = new Map<string, string>();
  if (playerIds.length) {
    const { data, error } = await supabase
      .from("players")
      .select("player_id, full_name")
      .in("player_id", playerIds);
    fail("players", error);
    for (const p of (data ?? []) as { player_id: string; full_name: string }[]) {
      playerNames.set(p.player_id, p.full_name);
    }
  }

  const toPick = (s: SlotRow): FranchisePickView => ({
    round: s.round,
    pickInRound: s.pick_in_round,
    overallPick: s.overall_pick,
    label: pickLabel(s.round, s.pick_in_round),
    originalOwner: shortNameById.get(s.original_team_id) ?? "?",
    currentOwner: shortNameById.get(s.current_team_id) ?? "?",
    acquired: s.original_team_id !== id && s.current_team_id === id,
    isKeeper: s.is_keeper,
    playerName: s.player_id ? playerNames.get(s.player_id) ?? null : null,
  });

  return {
    ...franchise,
    picks: slots.filter((s) => s.current_team_id === id).map(toPick),
    picksGivenAway: slots
      .filter((s) => s.original_team_id === id && s.current_team_id !== id)
      .map(toPick),
  };
}

// --- Trades -----------------------------------------------------------------

type TradeRow = {
  id: string;
  status: string;
  notes: string | null;
  contingent: boolean;
  source_ref: string | null;
  created_at: string;
};

type AssetRow = {
  trade_id: string;
  from_team: string;
  to_team: string;
  asset_type: string;
  ref: string;
};

export async function getTradeBoardFromDb(): Promise<TradeBoardView> {
  const season = CURRENT_SEASON;
  const supabase = createServiceClient();

  const [teams, slots, tradesResult] = await Promise.all([
    readTeams(),
    readSlots(season),
    supabase
      .from("trades")
      .select("id, status, notes, contingent, source_ref, created_at")
      .eq("season", season)
      .order("created_at", { ascending: true }),
  ]);
  fail("trades", tradesResult.error);
  const tradeRows = (tradesResult.data ?? []) as TradeRow[];

  const teamById = new Map(teams.map((t) => [t.id, t]));

  const tradedPicks: TradedPickView[] = [];
  const playerIds = new Set<string>();
  for (const s of slots) {
    if (s.player_id) playerIds.add(s.player_id);
  }

  let assets: AssetRow[] = [];
  if (tradeRows.length) {
    const { data, error } = await supabase
      .from("trade_assets")
      .select("trade_id, from_team, to_team, asset_type, ref")
      .in("trade_id", tradeRows.map((t) => t.id));
    fail("trade assets", error);
    assets = (data ?? []) as AssetRow[];
    for (const a of assets) {
      if (a.asset_type !== "pick") playerIds.add(a.ref);
    }
  }

  const playerNames = new Map<string, string>();
  if (playerIds.size) {
    const { data, error } = await supabase
      .from("players")
      .select("player_id, full_name")
      .in("player_id", [...playerIds]);
    fail("players", error);
    for (const p of (data ?? []) as { player_id: string; full_name: string }[]) {
      playerNames.set(p.player_id, p.full_name);
    }
  }

  for (const s of slots) {
    if (s.original_team_id === s.current_team_id) continue;
    tradedPicks.push({
      round: s.round,
      pickInRound: s.pick_in_round,
      overallPick: s.overall_pick,
      label: pickLabel(s.round, s.pick_in_round),
      originalOwnerId: s.original_team_id,
      originalOwner: teamById.get(s.original_team_id)?.short_name ?? "?",
      currentOwnerId: s.current_team_id,
      currentOwner: teamById.get(s.current_team_id)?.short_name ?? "?",
      isKeeper: s.is_keeper,
      playerName: s.player_id ? playerNames.get(s.player_id) ?? null : null,
    });
  }

  const ledger = teams.map((t) => {
    const held = slots.filter((s) => s.current_team_id === t.id);
    return {
      teamId: t.id,
      shortName: t.short_name,
      franchiseName: t.franchise_name,
      picksHeld: held.length,
      acquired: held.filter((s) => s.original_team_id !== t.id).length,
      tradedAway: slots.filter(
        (s) => s.original_team_id === t.id && s.current_team_id !== t.id,
      ).length,
    };
  });

  const assetsByTrade = new Map<string, AssetRow[]>();
  for (const a of assets) {
    const arr = assetsByTrade.get(a.trade_id) ?? [];
    arr.push(a);
    assetsByTrade.set(a.trade_id, arr);
  }

  function toPlayer(ref: string): TradeLogPlayer {
    const name = playerNames.get(ref) ?? null;
    return { typedName: name ?? ref, playerId: name ? ref : null, resolvedName: name };
  }

  function toPick(ref: string): TradeLogPick {
    try {
      const { season: s, round, originalTeam } = parsePickRef(ref);
      // A three-segment ref names the franchise the pick was born to, which is
      // what the log's "1 (Stefan's)" annotation means and the only way a
      // multi-hop pick can be described correctly.
      const via = originalTeam ? teamById.get(originalTeam)?.short_name ?? null : null;
      return { season: s, round, viaFranchise: via, label: pickRefLabel(s, round) };
    } catch {
      return { season, round: 0, viaFranchise: null, label: ref };
    }
  }

  /** Everything `teamId` RECEIVED in this trade, which is how the log reads. */
  function toSide(teamId: string, rows: AssetRow[]): TradeLogSide {
    const team = teamById.get(teamId);
    const received = rows.filter((a) => a.to_team === teamId);
    return {
      manager: team?.short_name ?? "?",
      franchiseName: team?.franchise_name ?? null,
      // Named types rather than "not a pick": a FAAB row's ref is a dollar
      // amount, and treating it as a player id renders "$20" as an unmatched
      // player name — precisely the class of quiet wrongness this log exists
      // to make visible.
      playersReceived: received
        .filter((a) => a.asset_type === "player" || a.asset_type === "keeper_right")
        .map((a) => toPlayer(a.ref)),
      picksReceived: received
        .filter((a) => a.asset_type === "pick")
        .map((a) => toPick(a.ref)),
      faabReceived: received
        .filter((a) => a.asset_type === "faab")
        .map((a) => Number(a.ref))
        .filter((n) => Number.isFinite(n)),
    };
  }

  const log: TradeLogEntry[] = tradeRows.map((t, i) => {
    const rows = assetsByTrade.get(t.id) ?? [];
    // Two-sided by construction: the parties are whoever appears in the assets.
    const parties = [...new Set(rows.flatMap((a) => [a.from_team, a.to_team]))];
    const [a, b] = parties;
    const number = t.source_ref
      ? Number.parseInt(t.source_ref.replace(/\D+/g, ""), 10) || i + 1
      : i + 1;

    return {
      id: t.id,
      tradeNumber: number,
      sideA: a ? toSide(a, rows) : emptySide(),
      sideB: b ? toSide(b, rows) : emptySide(),
      notes: t.notes ? [t.notes] : [],
      provisional: t.contingent,
      provisionalNote: t.contingent ? t.notes : null,
      reversed: t.status === "reversed",
      unapplied: t.status === "proposed",
    };
  });

  log.sort((x, y) => x.tradeNumber - y.tradeNumber);

  return {
    season,
    tradedPicks,
    ledger,
    log,
    tradeDeadlineWeek: TRADES.deadlineWeek,
    tradableSeasons: pickTradableSeasons(season),
    fetchedAt: null,
    fromDatabase: true,
  };
}

function emptySide(): TradeLogSide {
  return { manager: "?", franchiseName: null, playersReceived: [], picksReceived: [] };
}

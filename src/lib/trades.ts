import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { CURRENT_SEASON, DRAFT, LEAGUE, TRADES } from "@/lib/league-config";
import {
  formatPickRef,
  parsePickRef,
  pickTradableSeasons,
  validateTradeShape,
  type TradeAssetInput,
} from "@/lib/trade-rules";
import {
  restoreRightsOnTradeReversal,
  transferRightsOnTrade,
  wouldViolateTradeBack,
} from "@/lib/keeper-rights";
import type { TradeAssetType, TradeStatus } from "@/lib/supabase/types";

/**
 * Optional pick-count neutrality. This league sets
 * `TRADES.requirePickCountBalance` to false — a franchise is allowed to end the
 * offseason with more or fewer picks than anyone else — so this only runs where
 * a future rules change turns it back on.
 */
function assertPickBalance(assets: TradeAssetInput[]): void {
  if (!TRADES.requirePickCountBalance) return;
  const net = new Map<string, number>();
  for (const a of assets) {
    if (a.assetType !== "pick") continue;
    net.set(a.toTeam, (net.get(a.toTeam) ?? 0) + 1);
    net.set(a.fromTeam, (net.get(a.fromTeam) ?? 0) - 1);
  }
  for (const [, delta] of net) {
    if (delta !== 0) {
      throw new Error(
        `Pick counts must net to zero per team — everyone keeps ${DRAFT.rounds} picks. ` +
          "Add a balancing (later-round) pick, or enable commissioner override.",
      );
    }
  }
}

export type TradeAssetView = {
  id: string;
  fromTeamId: string;
  fromTeamName: string;
  toTeamId: string;
  toTeamName: string;
  assetType: TradeAssetType;
  ref: string;
  keeperClockReset: boolean;
  label: string;
};

export type TradeView = {
  id: string;
  season: number;
  status: TradeStatus;
  createdBy: string | null;
  createdByName: string | null;
  executedAt: string | null;
  /**
   * The date the trade happened, `YYYY-MM-DD`. Null for the imported workbook
   * trades, which carry no date and need backfill rather than a guess.
   */
  tradedAt: string | null;
  notes: string | null;
  /** Not yet fired — e.g. the Johnston/Blome contingent leg. */
  contingent: boolean;
  /** 'spreadsheet-trade-log' for an imported trade, null for one logged here. */
  source: string | null;
  sourceRef: string | null;
  createdAt: string;
  assets: TradeAssetView[];
};

export type PickOwnershipView = {
  id: string;
  season: number;
  round: number;
  originalTeamId: string;
  originalTeamName: string;
  currentTeamId: string;
  currentTeamName: string;
  traded: boolean;
};

type AssetRow = {
  id: string;
  from_team: string;
  to_team: string;
  asset_type: TradeAssetType;
  ref: string | null;
  keeper_clock_reset: boolean;
  from: { name: string } | null;
  to: { name: string } | null;
};

type TradeRow = {
  id: string;
  season: number;
  status: TradeStatus;
  created_by: string | null;
  executed_at: string | null;
  traded_at: string | null;
  notes: string | null;
  contingent: boolean;
  source: string | null;
  source_ref: string | null;
  created_at: string;
  creator: { name: string } | null;
  trade_assets: AssetRow[];
};

function assetLabel(a: AssetRow, playerNames?: Map<string, string>): string {
  const ref = a.ref ?? "";
  switch (a.asset_type) {
    case "pick": {
      try {
        const { season, round } = parsePickRef(ref);
        return `${season} Rd ${round}`;
      } catch {
        return ref;
      }
    }
    case "player":
      return playerNames?.get(ref) ?? `Player ${ref}`;
    case "keeper_right":
      return `${playerNames?.get(ref) ?? ref} (keeper rights)`;
    case "faab":
      // A dollar figure that moved, not a balance this app maintains.
      return `$${ref} FAAB`;
    default:
      return ref;
  }
}

function toTradeView(row: TradeRow, playerNames?: Map<string, string>): TradeView {
  return {
    id: row.id,
    season: row.season,
    status: row.status,
    createdBy: row.created_by,
    createdByName: row.creator?.name ?? null,
    executedAt: row.executed_at,
    tradedAt: row.traded_at,
    notes: row.notes,
    contingent: row.contingent,
    source: row.source,
    sourceRef: row.source_ref,
    createdAt: row.created_at,
    assets: (row.trade_assets ?? []).map((a) => ({
      id: a.id,
      fromTeamId: a.from_team,
      fromTeamName: a.from?.name ?? "?",
      toTeamId: a.to_team,
      toTeamName: a.to?.name ?? "?",
      assetType: a.asset_type,
      ref: a.ref ?? "",
      keeperClockReset: a.keeper_clock_reset,
      label: assetLabel(a, playerNames),
    })),
  };
}

/** Seed pick ownership for a season (idempotent). */
export async function initializeLedgers(season: number = CURRENT_SEASON): Promise<{
  picks: number;
}> {
  const supabase = createServiceClient();
  const { data: teams } = await supabase.from("teams").select("id").order("short_name");
  if (!teams?.length) throw new Error("Add teams first.");
  if (teams.length !== LEAGUE.teams) {
    throw new Error(`Need ${LEAGUE.teams} teams to initialize ledgers.`);
  }

  const pickRows = teams.flatMap((t) =>
    Array.from({ length: DRAFT.rounds }, (_, i) => ({
      season,
      round: i + 1,
      original_team: t.id,
      current_team: t.id,
    })),
  );

  const { error: pickErr } = await supabase
    .from("pick_ownership")
    .upsert(pickRows, { onConflict: "season,round,original_team", ignoreDuplicates: true });
  if (pickErr) throw new Error(pickErr.message);

  return { picks: pickRows.length };
}

export async function listTrades(season: number = CURRENT_SEASON): Promise<TradeView[]> {
  const supabase = createServiceClient();
  const { data: trades, error } = await supabase
    .from("trades")
    .select("id, season, status, created_by, executed_at, traded_at, notes, contingent, source, source_ref, created_at")
    .eq("season", season)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  if (!trades?.length) return [];

  const { data: teams } = await supabase.from("teams").select("id, short_name");
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.short_name]));

  const ids = trades.map((t) => t.id);
  const { data: assets } = await supabase
    .from("trade_assets")
    .select("id, trade_id, from_team, to_team, asset_type, ref, keeper_clock_reset")
    .in("trade_id", ids);

  type AssetDb = NonNullable<typeof assets>[number];
  const byTrade = new Map<string, AssetDb[]>();
  for (const a of assets ?? []) {
    const arr = byTrade.get(a.trade_id) ?? [];
    arr.push(a);
    byTrade.set(a.trade_id, arr);
  }

  // Resolve player names for player / keeper-rights assets.
  const playerRefs = Array.from(
    new Set(
      (assets ?? [])
        .filter((a) => (a.asset_type === "player" || a.asset_type === "keeper_right") && a.ref)
        .map((a) => a.ref as string),
    ),
  );
  const playerNames = new Map<string, string>();
  if (playerRefs.length) {
    const { data: players } = await supabase
      .from("players")
      .select("player_id, full_name")
      .in("player_id", playerRefs);
    for (const p of players ?? []) playerNames.set(p.player_id, p.full_name);
  }

  return trades.map((t) => {
    const assetRows: AssetRow[] = (byTrade.get(t.id) ?? []).map((a) => ({
      id: a.id,
      from_team: a.from_team,
      to_team: a.to_team,
      asset_type: a.asset_type,
      ref: a.ref,
      keeper_clock_reset: a.keeper_clock_reset,
      from: { name: teamName.get(a.from_team) ?? "?" },
      to: { name: teamName.get(a.to_team) ?? "?" },
    }));
    return toTradeView(
      {
        ...t,
        creator: t.created_by ? { name: teamName.get(t.created_by) ?? "?" } : null,
        trade_assets: assetRows,
      } as TradeRow,
      playerNames,
    );
  });
}

/** Picks a team currently owns within the tradable window (this + next season). */
export async function listTeamPickInventory(
  season: number,
  teamId: string,
): Promise<{ season: number; round: number }[]> {
  const supabase = createServiceClient();
  const seasons = pickTradableSeasons(season);
  const { data } = await supabase
    .from("pick_ownership")
    .select("season, round")
    .eq("current_team", teamId)
    .in("season", seasons)
    .order("season")
    .order("round");
  return (data ?? []).map((r) => ({ season: r.season, round: r.round }));
}

export async function listPickOwnership(
  season: number = CURRENT_SEASON,
): Promise<PickOwnershipView[]> {
  const supabase = createServiceClient();
  const [{ data: rows, error }, { data: teams }] = await Promise.all([
    supabase
      .from("pick_ownership")
      .select("id, season, round, original_team, current_team")
      .eq("season", season)
      .order("round")
      .order("original_team"),
    supabase.from("teams").select("id, short_name"),
  ]);
  if (error) throw new Error(error.message);
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.short_name]));

  return (rows ?? []).map((r) => ({
    id: r.id,
    season: r.season,
    round: r.round,
    originalTeamId: r.original_team,
    originalTeamName: teamName.get(r.original_team) ?? "?",
    currentTeamId: r.current_team,
    currentTeamName: teamName.get(r.current_team) ?? "?",
    traded: r.original_team !== r.current_team,
  }));
}

export type ProposeTradeInput = {
  season?: number;
  createdBy?: string;
  notes?: string;
  /** Deal that has not fired yet, so nothing is applied to the ledger. */
  contingent?: boolean;
  override?: boolean;
  /**
   * The date the trade actually happened, `YYYY-MM-DD`.
   *
   * Distinct from `created_at`, which is when the row was written. The keeper
   * clock depends on which side of the draft a trade fell, so this is an input
   * to the rules rather than a display field. Optional only because the twelve
   * trades imported from the workbook have no date in any source.
   */
  tradedAt?: string | null;
  assets: TradeAssetInput[];
};

/**
 * Which `pick_ownership` row an asset actually refers to.
 *
 * A pick's identity is (season, round, ORIGINAL owner), and the sender is only
 * the original owner on the pick's first hop. So:
 *
 *   - a three-segment ref names the original owner outright and is used as-is;
 *   - a two-segment ref means "the sender's own pick", which is checked and
 *     accepted only when that pick is genuinely still the sender's;
 *   - otherwise it is AMBIGUOUS and this throws, because the alternative is
 *     moving whichever pick the round happens to match.
 */
async function resolvePickOwnership(
  a: Pick<TradeAssetInput, "fromTeam" | "ref">,
): Promise<{ season: number; round: number; originalTeam: string }> {
  const supabase = createServiceClient();
  const { season: pickSeason, round, originalTeam } = parsePickRef(a.ref);

  if (originalTeam) {
    const { data: row } = await supabase
      .from("pick_ownership")
      .select("current_team")
      .eq("season", pickSeason)
      .eq("round", round)
      .eq("original_team", originalTeam)
      .maybeSingle();
    if (!row) {
      throw new Error(
        `Pick ${formatPickRef(pickSeason, round, originalTeam)} is not in the ledger — ` +
          `initialize ledgers first.`,
      );
    }
    if (row.current_team !== a.fromTeam) {
      throw new Error(
        `Round ${round} of ${pickSeason} originally belonging to that franchise is not held ` +
          `by the sender.`,
      );
    }
    return { season: pickSeason, round, originalTeam };
  }

  // No original owner named. Everything the sender HOLDS in that round.
  const { data: held } = await supabase
    .from("pick_ownership")
    .select("original_team")
    .eq("season", pickSeason)
    .eq("round", round)
    .eq("current_team", a.fromTeam);

  const options = held ?? [];
  if (!options.length) {
    throw new Error(
      `The sender holds no round-${round} pick in ${pickSeason}, so there is nothing to trade.`,
    );
  }

  const own = options.find((o) => o.original_team === a.fromTeam);
  if (own) return { season: pickSeason, round, originalTeam: a.fromTeam };

  // He holds a round-N pick, but not his own — it is one he acquired, and this
  // ref cannot say which. Guessing here is how the wrong pick moves.
  throw new Error(
    `Ambiguous pick: the sender holds ${options.length} round-${round} pick(s) in ${pickSeason} ` +
      `but not his own, so "${a.ref}" does not say which one is moving. Use ` +
      `season:round:originalTeamId — for example ` +
      `${formatPickRef(pickSeason, round, options[0].original_team)}.`,
  );
}

async function validateAssets(
  season: number,
  assets: TradeAssetInput[],
): Promise<void> {
  const shapeErr = validateTradeShape(assets);
  if (shapeErr) throw new Error(shapeErr);

  const tradable = new Set(pickTradableSeasons(season));

  for (const a of assets) {
    if (a.assetType === "pick") {
      const { season: pickSeason } = parsePickRef(a.ref);
      if (!tradable.has(pickSeason)) {
        const window = [...tradable].sort((x, y) => x - y).join(", ");
        throw new Error(
          `Cannot trade ${pickSeason} picks — the tradable window is ${window}.`,
        );
      }
      // Throws on an unowned, missing or ambiguous pick.
      await resolvePickOwnership(a);
    }

    // Trade-back restriction — hard rule, never overridable.
    if (a.assetType === "player" || a.assetType === "keeper_right") {
      if (await wouldViolateTradeBack(a.ref, a.toTeam)) {
        throw new Error(
          "That player can't be traded back to his previous team before the next draft.",
        );
      }
    }
  }
}

export async function proposeTrade(input: ProposeTradeInput): Promise<TradeView> {
  const season = input.season ?? CURRENT_SEASON;
  await validateAssets(season, input.assets);
  if (!input.override) assertPickBalance(input.assets);

  const supabase = createServiceClient();

  const { data: trade, error } = await supabase
    .from("trades")
    .insert({
      season,
      status: "proposed",
      created_by: input.createdBy ?? null,
      notes: input.notes ?? null,
      contingent: input.contingent ?? false,
      traded_at: input.tradedAt ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const assetRows = input.assets.map((a) => ({
    trade_id: trade.id,
    from_team: a.fromTeam,
    to_team: a.toTeam,
    asset_type: a.assetType,
    ref: a.ref,
    keeper_clock_reset: a.keeperClockReset ?? false,
  }));
  const { error: assetErr } = await supabase.from("trade_assets").insert(assetRows);
  if (assetErr) throw new Error(assetErr.message);

  const list = await listTrades(season);
  const view = list.find((t) => t.id === trade.id);
  if (!view) throw new Error("Failed to load trade after create.");
  return view;
}

async function applyAsset(
  tradeId: string,
  a: TradeAssetView,
  /** The trade's own date, so a keeper clock is stamped rather than assumed. */
  tradedAt: string | null,
): Promise<void> {
  const supabase = createServiceClient();

  if (a.assetType === "pick") {
    const { season: pickSeason, round, originalTeam } = await resolvePickOwnership({
      fromTeam: a.fromTeamId,
      ref: a.ref,
    });

    await supabase
      .from("pick_ownership")
      .update({ current_team: a.toTeamId, updated_at: new Date().toISOString() })
      .eq("season", pickSeason)
      .eq("round", round)
      .eq("original_team", originalTeam);

    await supabase.from("traded_picks").insert({
      season: pickSeason,
      round,
      // The franchise the pick was BORN TO, not the franchise sending it. These
      // are the same thing only on a first hop, and writing the sender here is
      // what made the log misdescribe every pick on its second move — the log
      // being the thing you read in August to work out why a cell looks wrong.
      original_team: originalTeam,
      // This hop's sender, which is what makes the chain reconstructable.
      from_team: a.fromTeamId,
      current_team: a.toTeamId,
      trade_id: tradeId,
    });
  }

  // Player / keeper-rights: the cost basis carries across while keeper
  // eligibility restarts with the new team (`keeper-clock` rule R5). Also
  // records the trade-back guard.
  if (a.assetType === "player" || a.assetType === "keeper_right") {
    await transferRightsOnTrade(a.ref, a.fromTeamId, a.toTeamId, tradedAt);
  }
}

export async function acceptTrade(tradeId: string): Promise<TradeView> {
  const supabase = createServiceClient();
  const { data: trade } = await supabase
    .from("trades")
    .select("id, season, status, contingent, traded_at")
    .eq("id", tradeId)
    .maybeSingle();
  if (!trade) throw new Error("Trade not found.");
  if (trade.status === "accepted") throw new Error("Trade already accepted.");
  if (trade.status === "vetoed" || trade.status === "reversed") {
    throw new Error("Cannot accept a vetoed/reversed trade.");
  }
  if (trade.contingent) {
    throw new Error(
      "This trade is contingent and has not fired yet. Clear the contingency before applying it.",
    );
  }

  const views = await listTrades(trade.season);
  const view = views.find((t) => t.id === tradeId);
  if (!view) throw new Error("Trade not found.");

  await validateAssets(
    trade.season,
    view.assets.map((a) => ({
      fromTeam: a.fromTeamId,
      toTeam: a.toTeamId,
      assetType: a.assetType,
      ref: a.ref,
      keeperClockReset: a.keeperClockReset,
    })),
  );

  for (const a of view.assets) {
    await applyAsset(tradeId, a, trade.traded_at);
  }

  const now = new Date().toISOString();
  await supabase
    .from("trades")
    .update({ status: "accepted", executed_at: now })
    .eq("id", tradeId);

  const updated = await listTrades(trade.season);
  const result = updated.find((t) => t.id === tradeId);
  if (!result) throw new Error("Failed to load trade.");
  return result;
}

/**
 * Un-apply an accepted trade and mark it reversed.
 *
 * The whole point of a reverse is that a mistake logged in November is
 * catchable, so a reverse that only flips a status word is worse than having no
 * reverse at all: the ledger stays moved while the trade reads as undone, and
 * nobody finds out until the board looks wrong.
 *
 * Every asset is walked backwards:
 *
 *   PICKS    ownership returns to the sender, and the hop rows this trade wrote
 *            are deleted. `traded_picks` is otherwise append-only, but a
 *            reversed trade did not happen — leaving its hops in place would
 *            make the provenance log describe a move that has been undone. The
 *            audit trail is `trades.status = 'reversed'` plus its notes.
 *   PLAYERS  rights go back to the sender with the clock he had before, which
 *            `restoreRightsOnTradeReversal` refuses to invent if it is unknown.
 *
 * Ordering is deliberate: assets are restored BEFORE the status flips, so a
 * failure part-way leaves the trade still marked accepted. That is the honest
 * state — partially reversed and still needing attention — rather than a trade
 * that claims to be undone while half its assets have moved.
 */
export async function reverseTrade(tradeId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: trade } = await supabase
    .from("trades")
    .select("id, season, status")
    .eq("id", tradeId)
    .maybeSingle();
  if (!trade) throw new Error("Trade not found.");
  if (trade.status === "reversed") return;

  const views = await listTrades(trade.season);
  const view = views.find((t) => t.id === tradeId);
  if (!view) throw new Error("Trade not found.");

  // A proposed or vetoed trade was never applied, so there is nothing to
  // un-apply and only the status changes.
  if (trade.status === "accepted") {
    for (const a of view.assets) {
      if (a.assetType === "pick") {
        const { season: pickSeason, round, originalTeam } = parsePickRef(a.ref);
        // Resolved from the log rather than the ref where the ref is silent:
        // the hop rows this trade wrote say exactly which pick moved.
        const { data: hops } = await supabase
          .from("traded_picks")
          .select("original_team")
          .eq("trade_id", tradeId)
          .eq("season", pickSeason)
          .eq("round", round);

        const target = originalTeam ?? hops?.[0]?.original_team;
        if (!target) {
          throw new Error(
            `Cannot tell which round-${round} pick of ${pickSeason} this trade moved, so ` +
              `reversing it could return the wrong one. Fix the pick ref to ` +
              `season:round:originalTeamId and try again.`,
          );
        }

        await supabase
          .from("pick_ownership")
          .update({ current_team: a.fromTeamId, updated_at: new Date().toISOString() })
          .eq("season", pickSeason)
          .eq("round", round)
          .eq("original_team", target)
          // Only move it back if it is still where this trade put it. A pick
          // traded onward afterwards must not be yanked out of a later deal.
          .eq("current_team", a.toTeamId);
      }

      if (a.assetType === "player" || a.assetType === "keeper_right") {
        await restoreRightsOnTradeReversal(a.ref, a.fromTeamId, a.toTeamId);
      }
    }

    const { error: hopErr } = await supabase
      .from("traded_picks")
      .delete()
      .eq("trade_id", tradeId);
    if (hopErr) throw new Error(hopErr.message);
  }

  const { error } = await supabase
    .from("trades")
    .update({ status: "reversed" })
    .eq("id", tradeId);
  if (error) throw new Error(error.message);
}

export async function setTradeStatus(
  tradeId: string,
  status: "vetoed" | "reversed",
): Promise<void> {
  // A reversal is an un-apply, not a status change. Routed rather than
  // duplicated so every existing caller — the API route included — gets the
  // real behaviour without having to know it changed.
  if (status === "reversed") {
    await reverseTrade(tradeId);
    return;
  }

  const supabase = createServiceClient();
  const { data: trade } = await supabase
    .from("trades")
    .select("status")
    .eq("id", tradeId)
    .maybeSingle();
  if (!trade) throw new Error("Trade not found.");
  if (trade.status === "accepted") {
    throw new Error(
      "This trade has already been applied to the ledger, so vetoing it would leave the " +
        "picks and keeper rights moved. Reverse it instead.",
    );
  }

  const { error } = await supabase.from("trades").update({ status }).eq("id", tradeId);
  if (error) throw new Error(error.message);
}

/**
 * Push `pick_ownership` onto the board, so the grid shows who actually holds
 * each slot.
 *
 * Slots are matched by (round, ORIGINAL owner), never by current ownership —
 * that becomes ambiguous the moment a franchise holds two picks in a round, and
 * the column belongs to the original owner for all 16 rounds anyway.
 */
export async function buildBoardFromOwnership(targetSeason: number): Promise<number> {
  const supabase = createServiceClient();
  const ownership = await listPickOwnership(targetSeason);
  if (!ownership.length) return 0;

  let updated = 0;
  for (const o of ownership) {
    const { data: slot } = await supabase
      .from("draft_slots")
      .select("id, current_team_id")
      .eq("season", targetSeason)
      .eq("round", o.round)
      .eq("original_team_id", o.originalTeamId)
      .maybeSingle();
    if (!slot || slot.current_team_id === o.currentTeamId) continue;
    await supabase
      .from("draft_slots")
      .update({ current_team_id: o.currentTeamId })
      .eq("id", slot.id);
    updated += 1;
  }
  return updated;
}

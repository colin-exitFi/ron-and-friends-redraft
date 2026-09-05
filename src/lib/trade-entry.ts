import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { CURRENT_SEASON, DRAFT, KEEPERS, LEAGUE, TRADES } from "@/lib/league-config";
import {
  classifyTradeDate,
  isAfterTradeDeadline,
  keeperConsequenceOfTrade,
  todayIso,
  type TradeTiming,
} from "@/lib/trade-timing";
import {
  describeClock,
  keeperCostRound,
  seasonsKeptAfterTrade,
} from "@/lib/keeper-clock";
import { wouldViolateTradeBack } from "@/lib/keeper-rights";
import {
  formatPickRef,
  parseFaabRef,
  parsePickRef,
  pickTradableSeasons,
  type TradeAssetInput,
} from "@/lib/trade-rules";
import { acceptTrade, proposeTrade } from "@/lib/trades";
import { pickLabel } from "@/lib/league-view";
import type {
  CommitResult,
  LedgerInvariant,
  LoggedTradeView,
  OwnershipGridView,
  ParticipantOption,
  PickOption,
  RosterOption,
  TradeDraft,
  TradePreview,
} from "@/lib/trade-entry-types";

/**
 * Logging a trade that has already happened in ESPN.
 *
 * Read `@/lib/trade-entry-types` first — it carries the reasoning behind the
 * shape. This module is the implementation: what a franchise may offer, what a
 * trade would do, and applying it.
 *
 * ============================================================================
 * WHY THE EXISTING SCHEMA NEEDED NO CHANGES FOR N-TEAM TRADES
 * ============================================================================
 * `trades` carries no team columns at all — only `season`, `status`, `notes`
 * and provenance — and `trade_assets` carries `from_team` and `to_team` on
 * EVERY ROW. So a trade already is exactly "a set of asset movements, each with
 * a from-franchise and a to-franchise", which is the general shape: two
 * franchises and five franchises store identically and nothing needs widening.
 *
 * The two-party assumption in the codebase is not in the database, it is in one
 * consumer — `TradeLogEntry` in `@/lib/league-view` has `sideA` / `sideB`, which
 * is right for the imported workbook log (every one of those 12 trades is
 * two-sided) and would silently drop the third leg of a three-team trade. So
 * `LoggedTradeView` lists parties instead, and nothing here builds on a pair.
 *
 * ============================================================================
 * WHAT IS NOT MODELLED, ON PURPOSE
 * ============================================================================
 * CONDITIONS. No pending state, no condition tracking, no automatic
 * resolution — a free-text note and nothing else. The league has not decided
 * whether contingent trades are permitted; the only one that exists was
 * arranged privately, hinges on an injury, and lived in a Word document.
 * Structured support would encode a rule that does not exist yet. The
 * commissioner resolves the condition himself and logs the outcome as an
 * ordinary trade.
 *
 * A FAAB BALANCE. FAAB is recorded as a dollar figure that moved. ESPN owns the
 * budget, so there is no balance here to overdraw and nothing checks one.
 *
 * A TRADE DEADLINE CHECK. ESPN already blocks trades after its deadline. If
 * this app also policed it, the single thing that would happen is a legitimate
 * late-logged trade being refused at the exact moment someone is trying to do
 * the right thing.
 */

// --- Reading what a franchise can actually offer -----------------------------

type TeamRow = { id: string; short_name: string; franchise_name: string; manager: string };

async function readTeams(): Promise<TeamRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("teams")
    .select("id, short_name, franchise_name, manager")
    .order("short_name");
  if (error) throw new Error(error.message);
  return (data ?? []) as TeamRow[];
}

function toParticipant(t: TeamRow): ParticipantOption {
  return {
    teamId: t.id,
    shortName: t.short_name,
    franchiseName: t.franchise_name,
    manager: t.manager,
  };
}

/**
 * Every pick each franchise CURRENTLY holds inside the tradable window.
 *
 * Resolved from `pick_ownership.current_team`, which is the whole point: a
 * franchise can only offer a pick it actually owns, so a pick already traded
 * away is not in its list and cannot be selected. This is the single check that
 * would have prevented the multi-hop defect on its own — when Witte no longer
 * holds his own round 4, the UI does not offer it, and there is no path by which
 * the wrong round-4 pick can be moved.
 *
 * Also why every ref generated here has three segments. `formatPickRef` will
 * emit the two-segment "the sender's own pick" form if the original owner is
 * omitted, and that form stops identifying anything once a pick has moved
 * twice. Naming the original owner always is free and removes the ambiguity
 * class permanently.
 */
export async function listSendablePicks(
  season: number = CURRENT_SEASON,
): Promise<Record<string, PickOption[]>> {
  const supabase = createServiceClient();
  const [teams, ownership] = await Promise.all([
    readTeams(),
    supabase
      .from("pick_ownership")
      .select("season, round, original_team, current_team")
      .in("season", pickTradableSeasons(season))
      .order("season")
      .order("round"),
  ]);
  if (ownership.error) throw new Error(ownership.error.message);

  const shortName = new Map(teams.map((t) => [t.id, t.short_name]));
  const byTeam: Record<string, PickOption[]> = Object.fromEntries(
    teams.map((t) => [t.id, [] as PickOption[]]),
  );

  for (const row of ownership.data ?? []) {
    const holder = byTeam[row.current_team];
    if (!holder) continue;
    const acquired = row.original_team !== row.current_team;
    const originalName = shortName.get(row.original_team) ?? "?";
    holder.push({
      ref: formatPickRef(row.season, row.round, row.original_team),
      season: row.season,
      round: row.round,
      originalTeamId: row.original_team,
      originalTeamShortName: originalName,
      acquired,
      label: `${row.season} R${row.round} ${acquired ? `(originally ${originalName}'s)` : "(own)"}`,
    });
  }

  return byTeam;
}

/**
 * Players the ledger says each franchise holds, as a shortlist beside search.
 *
 * Not a substitute for search, and deliberately not a restriction on it. Before
 * Saturday's draft import the ledger knows the pedigree of 18 players, and
 * in-season waiver activity happens entirely in ESPN and is never reported
 * here, so this list is incomplete by construction. It is offered because
 * picking a name off a roster is faster and safer than searching a
 * 1,195-player pool, and a player missing from it is a WARNING in the preview
 * rather than a refusal.
 */
export async function listLedgerRosters(): Promise<Record<string, RosterOption[]>> {
  const supabase = createServiceClient();
  const [teams, rights] = await Promise.all([
    readTeams(),
    supabase
      .from("keeper_rights")
      .select("player_id, current_team_id, consecutive_seasons, basis_round")
      .not("current_team_id", "is", null),
  ]);
  if (rights.error) throw new Error(rights.error.message);

  const rows = rights.data ?? [];
  const byTeam: Record<string, RosterOption[]> = Object.fromEntries(
    teams.map((t) => [t.id, [] as RosterOption[]]),
  );
  if (!rows.length) return byTeam;

  const { data: players } = await supabase
    .from("players")
    .select("player_id, full_name, position, nfl_team")
    .in("player_id", rows.map((r) => r.player_id));
  const playerById = new Map(
    (players ?? []).map((p) => [p.player_id, p]),
  );

  for (const r of rows) {
    const bucket = byTeam[r.current_team_id as string];
    if (!bucket) continue;
    const p = playerById.get(r.player_id);
    bucket.push({
      playerId: r.player_id,
      name: p?.full_name ?? r.player_id,
      position: p?.position ?? "—",
      nflTeam: p?.nfl_team ?? null,
      seasonsKept: r.consecutive_seasons,
      clockLabel: describeClock(r.consecutive_seasons),
      basisRound: r.basis_round,
    });
  }

  for (const bucket of Object.values(byTeam)) {
    bucket.sort((a, b) => a.name.localeCompare(b.name));
  }
  return byTeam;
}

export type TradeEntryContext = {
  season: number;
  participants: ParticipantOption[];
  /** Picks each franchise currently holds, keyed by team id. */
  picksByTeam: Record<string, PickOption[]>;
  /** Players the ledger says each franchise holds, keyed by team id. */
  rostersByTeam: Record<string, RosterOption[]>;
  tradableSeasons: number[];
  /** ESPN's deadline, shown for information. Never enforced here. */
  deadlineWeek: number;
  /** Today's date, `YYYY-MM-DD`, as the date field's default. */
  today: string;
};

export async function getTradeEntryContext(
  season: number = CURRENT_SEASON,
): Promise<TradeEntryContext> {
  const [teams, picksByTeam, rostersByTeam] = await Promise.all([
    readTeams(),
    listSendablePicks(season),
    listLedgerRosters(),
  ]);
  return {
    season,
    participants: teams.map(toParticipant),
    picksByTeam,
    rostersByTeam,
    tradableSeasons: pickTradableSeasons(season),
    deadlineWeek: TRADES.deadlineWeek,
    // Defaulted, not imposed: he is usually logging a trade the day ESPN
    // approved it, but a date that is merely convenient is worse than useless
    // for a calculation that pays off in nine months.
    today: todayIso(),
  };
}

// --- The preview ------------------------------------------------------------

/** Turn the wizard's draft into the asset rows `@/lib/trades` understands. */
function toAssetInputs(draft: TradeDraft): TradeAssetInput[] {
  return draft.lines.map((line) => {
    switch (line.asset.kind) {
      case "player":
        return {
          fromTeam: line.fromTeamId,
          toTeam: line.toTeamId,
          assetType: "player" as const,
          ref: line.asset.playerId,
          // A league rule, not a per-trade choice: a trade restarts the
          // player's keeper eligibility with his new team.
          keeperClockReset: true,
        };
      case "pick":
        return {
          fromTeam: line.fromTeamId,
          toTeam: line.toTeamId,
          assetType: "pick" as const,
          ref: line.asset.ref,
        };
      case "faab":
        return {
          fromTeam: line.fromTeamId,
          toTeam: line.toTeamId,
          assetType: "faab" as const,
          ref: String(line.asset.amount),
        };
    }
  });
}

/**
 * What this trade will do, computed against the live ledger, writing nothing.
 *
 * This is the error-catching mechanism, so it is deliberately more suspicious
 * than the validation in `@/lib/trades`: that layer refuses what is impossible,
 * and this layer additionally reports what is merely unlikely. The distinction
 * is `blockers` versus `warnings` and it is not cosmetic — see the note on
 * `TradePreview`.
 */
export async function previewTrade(draft: TradeDraft): Promise<TradePreview> {
  const supabase = createServiceClient();
  const teams = await readTeams();
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const name = (id: string) => teamById.get(id)?.short_name ?? "?";

  const blockers: string[] = [];
  const warnings: string[] = [];

  /**
   * THE SEASON COMES FROM THE DATE, not from the client.
   *
   * Recomputed here rather than trusted, because two fields that must agree are
   * two fields that can disagree, and the one that decides keeper clocks should
   * be derived from the one the commissioner actually chose.
   */
  let timing: TradeTiming;
  try {
    timing = classifyTradeDate(draft.tradedAt);
  } catch (err) {
    // Without a valid date nothing else can be computed — the season is unknown,
    // so ownership cannot be looked up and no clock has a meaning.
    return {
      season: draft.season,
      tradedAt: draft.tradedAt ?? "",
      timingLabel: "",
      participants: [],
      blockers: [err instanceof Error ? err.message : "Invalid trade date."],
      warnings: [],
      pickMoves: [],
      playerMoves: [],
      faabMoves: [],
      pickCounts: [],
      summaryByTeam: [],
    };
  }

  const season = timing.season;

  // `trades.season` is a foreign key onto `leagues`, so a date back-dated into a
  // season the league has no row for would fail at the database with a message
  // nobody can act on. Refused here, in terms that say what to do.
  const { data: leagueRow } = await supabase
    .from("leagues")
    .select("season")
    .eq("season", season)
    .maybeSingle();
  if (!leagueRow) {
    blockers.push(
      `${draft.tradedAt} falls in the ${season} season, which this app has no record ` +
        `of. Check the date — or if it is right, ${season} needs adding before its ` +
        `trades can be logged.`,
    );
  }

  if (timing.draftDateAssumed) {
    warnings.push(
      `The ${season} draft date is not configured, so whether this counts as pre-draft ` +
        `or in-season was judged against ${timing.draftDate}, assumed from ${DRAFT.date}. ` +
        `That distinction changes the keeper clock, so confirm it.`,
    );
  }

  if (isAfterTradeDeadline(draft.tradedAt)) {
    warnings.push(
      `That date looks to be past ESPN's week-${TRADES.deadlineWeek} trade deadline. ` +
        `Recorded anyway — ESPN already polices its own deadline and this app will not ` +
        `refuse a late-logged trade — but worth confirming the date.`,
    );
  }

  const participantIds = [...new Set(draft.participantIds)];
  const participants = participantIds
    .map((id) => teamById.get(id))
    .filter((t): t is TeamRow => !!t)
    .map(toParticipant);

  if (participantIds.length !== participants.length) {
    blockers.push("One of the franchises in this trade is not in the league.");
  }
  if (participants.length < 2) {
    blockers.push("A trade needs at least two franchises.");
  }

  if (!draft.lines.length) {
    blockers.push("Nothing is moving — add what each franchise received.");
  }

  const tradable = new Set(pickTradableSeasons(season));

  // --- picks ---------------------------------------------------------------

  const pickMoves: TradePreview["pickMoves"] = [];
  const seenPickRefs = new Set<string>();
  const pickSeasonsTouched = new Set<number>();
  const pickDeltas = new Map<string, Map<number, number>>();

  function bumpPicks(teamId: string, pickSeason: number, by: number) {
    const perSeason = pickDeltas.get(teamId) ?? new Map<number, number>();
    perSeason.set(pickSeason, (perSeason.get(pickSeason) ?? 0) + by);
    pickDeltas.set(teamId, perSeason);
  }

  for (const line of draft.lines) {
    if (line.fromTeamId === line.toTeamId) {
      blockers.push(`A franchise cannot trade with itself (${name(line.fromTeamId)}).`);
      continue;
    }
    for (const side of [line.fromTeamId, line.toTeamId]) {
      if (!participantIds.includes(side)) {
        blockers.push(
          `${name(side)} appears on an asset but is not listed as part of this trade.`,
        );
      }
    }

    if (line.asset.kind !== "pick") continue;

    let parsed;
    try {
      parsed = parsePickRef(line.asset.ref);
    } catch (err) {
      blockers.push(err instanceof Error ? err.message : "Invalid pick.");
      continue;
    }
    const { season: pickSeason, round, originalTeam } = parsed;

    if (!tradable.has(pickSeason)) {
      blockers.push(
        `${pickSeason} picks cannot be traded — the window is ${[...tradable]
          .sort((a, b) => a - b)
          .join(" and ")}.`,
      );
      continue;
    }

    // A pick can only move once inside one trade. Two lines naming the same
    // pick is a data-entry slip, and applying both would move it twice.
    const dedupeKey = `${pickSeason}:${round}:${originalTeam ?? line.fromTeamId}`;
    if (seenPickRefs.has(dedupeKey)) {
      blockers.push(
        `The same pick (${pickSeason} R${round}, originally ` +
          `${name(originalTeam ?? line.fromTeamId)}'s) is listed twice.`,
      );
      continue;
    }
    seenPickRefs.add(dedupeKey);

    // OWNERSHIP, from the ledger rather than from the form.
    const resolvedOriginal = originalTeam ?? line.fromTeamId;
    const { data: owned } = await supabase
      .from("pick_ownership")
      .select("current_team")
      .eq("season", pickSeason)
      .eq("round", round)
      .eq("original_team", resolvedOriginal)
      .maybeSingle();

    if (!owned) {
      blockers.push(
        `${pickSeason} R${round} originally ${name(resolvedOriginal)}'s is not in the ` +
          `ledger, so it cannot be traded.`,
      );
      continue;
    }
    if (owned.current_team !== line.fromTeamId) {
      blockers.push(
        `${name(line.fromTeamId)} does not hold ${pickSeason} R${round} ` +
          `(originally ${name(resolvedOriginal)}'s) — ${name(owned.current_team)} does.`,
      );
      continue;
    }

    const { count: priorHops } = await supabase
      .from("traded_picks")
      .select("id", { count: "exact", head: true })
      .eq("season", pickSeason)
      .eq("round", round)
      .eq("original_team", resolvedOriginal);

    // Where it will draw. The column belongs to the ORIGINAL owner for all 16
    // rounds, so a traded pick shows up as a foreign name inside his column
    // rather than moving cells.
    const { data: slot } = await supabase
      .from("draft_slots")
      .select("round, pick_in_round")
      .eq("season", pickSeason)
      .eq("round", round)
      .eq("original_team_id", resolvedOriginal)
      .maybeSingle();

    const originalName = name(resolvedOriginal);
    const boardNote = slot
      ? `Draws at ${pickLabel(slot.round, slot.pick_in_round)}, in ${originalName}'s ` +
        `column of the ${pickSeason} board.`
      : `Will draw in ${originalName}'s column of the ${pickSeason} board, in round ` +
        `${round}, once that board is built.`;

    pickMoves.push({
      ref: formatPickRef(pickSeason, round, resolvedOriginal),
      pickSeason,
      round,
      originalTeamShortName: originalName,
      fromShortName: name(line.fromTeamId),
      toShortName: name(line.toTeamId),
      hop: (priorHops ?? 0) + 1,
      boardNote,
    });

    pickSeasonsTouched.add(pickSeason);
    bumpPicks(line.fromTeamId, pickSeason, -1);
    bumpPicks(line.toTeamId, pickSeason, 1);
  }

  // --- players -------------------------------------------------------------

  const playerMoves: TradePreview["playerMoves"] = [];
  const seenPlayers = new Set<string>();
  const playerLines = draft.lines.filter(
    (l): l is typeof l & { asset: { kind: "player"; playerId: string } } =>
      l.asset.kind === "player",
  );

  if (playerLines.length) {
    const ids = playerLines.map((l) => l.asset.playerId);
    const [{ data: players }, { data: rightsRows }] = await Promise.all([
      supabase.from("players").select("player_id, full_name, position").in("player_id", ids),
      supabase
        .from("keeper_rights")
        .select("player_id, current_team_id, consecutive_seasons, basis_round, is_undrafted")
        .in("player_id", ids),
    ]);
    const playerById = new Map((players ?? []).map((p) => [p.player_id, p]));
    const rightsById = new Map((rightsRows ?? []).map((r) => [r.player_id, r]));

    for (const line of playerLines) {
      const playerId = line.asset.playerId;
      if (seenPlayers.has(playerId)) {
        blockers.push(
          `${playerById.get(playerId)?.full_name ?? playerId} is listed twice.`,
        );
        continue;
      }
      seenPlayers.add(playerId);

      const player = playerById.get(playerId);
      if (!player) {
        blockers.push(
          `Player ${playerId} is not in the league's player pool, so he cannot be ` +
            `recorded. Pick him from the search rather than entering an id.`,
        );
        continue;
      }

      // Hard rule, never overridable: a player cannot be traded straight back
      // to the franchise that just sent him away, before the next draft.
      if (await wouldViolateTradeBack(playerId, line.toTeamId)) {
        blockers.push(
          `${player.full_name} was traded away by ${name(line.toTeamId)} and cannot go ` +
            `back before the next draft.`,
        );
        continue;
      }

      const rights = rightsById.get(playerId);
      const before = rights?.consecutive_seasons ?? 0;
      const after = seasonsKeptAfterTrade(before);
      const basisRound = rights?.basis_round ?? null;
      const isUndrafted = rights?.is_undrafted ?? true;

      if (!rights) {
        warnings.push(
          `The ledger has no keeper pedigree for ${player.full_name} yet, so he would be ` +
            `priced as a free-agent acquisition at round ${KEEPERS.undraftedDefaultRound}. ` +
            `That is expected before the draft result is imported; after it, check the name.`,
        );
      } else if (rights.current_team_id && rights.current_team_id !== line.fromTeamId) {
        warnings.push(
          `The ledger has ${name(rights.current_team_id)} holding ${player.full_name}, not ` +
            `${name(line.fromTeamId)}. Worth a second look — the ledger does not see ESPN ` +
            `waiver moves, so it can legitimately be behind.`,
        );
      }

      const nextCostRound = keeperCostRound({
        basisRound,
        seasonsKept: after,
        isUndrafted,
      });

      // The point of recording the date: how long the receiving franchise can
      // hold him, which depends on which side of the draft the trade fell.
      const consequence = keeperConsequenceOfTrade(draft.tradedAt);

      const costNote =
        nextCostRound == null
          ? `He occupied a round-1 slot, so he cannot be kept at all — every ` +
            `first-round pick is a one-year rental.`
          : basisRound == null
            ? `No draft pedigree on file, so he prices as a free-agent acquisition at ` +
              `round ${nextCostRound}.`
            : `Basis round ${basisRound} carries across untouched, so he would cost ` +
              `${name(line.toTeamId)} a round-${nextCostRound} pick next preseason.`;

      playerMoves.push({
        playerId,
        name: player.full_name,
        position: player.position ?? "—",
        fromShortName: name(line.fromTeamId),
        toShortName: name(line.toTeamId),
        clockBeforeLabel: describeClock(before),
        clockAfterLabel: describeClock(after),
        seasonsKeptBefore: before,
        seasonsKeptAfter: after,
        basisRound,
        nextCostRound,
        costNote,
        firstKeeperSeason: consequence.firstKeeperSeason,
        lastKeeperSeason: consequence.lastKeeperSeason,
        timingSummary: consequence.summary,
        timingDisputeNote: consequence.disputeNote,
      });
    }
  }

  // --- FAAB ----------------------------------------------------------------

  const faabMoves: TradePreview["faabMoves"] = [];
  for (const line of draft.lines) {
    if (line.asset.kind !== "faab") continue;
    try {
      const amount = parseFaabRef(String(line.asset.amount));
      faabMoves.push({
        amount,
        fromShortName: name(line.fromTeamId),
        toShortName: name(line.toTeamId),
      });
    } catch (err) {
      blockers.push(err instanceof Error ? err.message : "Invalid FAAB amount.");
    }
  }

  // --- pick counts, before and after --------------------------------------

  const pickCounts: TradePreview["pickCounts"] = [];
  for (const pickSeason of [...pickSeasonsTouched].sort((a, b) => a - b)) {
    const { data: rows } = await supabase
      .from("pick_ownership")
      .select("current_team")
      .eq("season", pickSeason);
    const held = new Map<string, number>();
    for (const r of rows ?? []) {
      held.set(r.current_team, (held.get(r.current_team) ?? 0) + 1);
    }
    pickCounts.push({
      pickSeason,
      rows: teams
        .map((t) => {
          const before = held.get(t.id) ?? 0;
          const delta = pickDeltas.get(t.id)?.get(pickSeason) ?? 0;
          return {
            teamId: t.id,
            shortName: t.short_name,
            before,
            after: before + delta,
            delta,
          };
        })
        // Only franchises this trade actually changes, plus nobody else's noise.
        .filter((r) => r.delta !== 0),
    });
  }

  // --- per-franchise summary, and the one-sided check ---------------------

  const describeLine = (line: TradeDraft["lines"][number]): string => {
    const asset = line.asset;
    switch (asset.kind) {
      case "player":
        return (
          playerMoves.find((p) => p.playerId === asset.playerId)?.name ?? asset.playerId
        );
      case "pick": {
        let ref;
        try {
          ref = parsePickRef(asset.ref);
        } catch {
          return asset.ref;
        }
        const original = ref.originalTeam ?? line.fromTeamId;
        // Only annotate whose pick it was when that is not the sender, since
        // "Witte's 2027 R4 from Witte" reads as noise.
        const via = original === line.fromTeamId ? "" : ` (${name(original)}'s)`;
        return `${ref.season} R${ref.round}${via}`;
      }
      case "faab":
        return `$${asset.amount} FAAB`;
    }
  };

  const summaryByTeam = participants.map((p) => {
    const receives = draft.lines
      .filter((l) => l.toTeamId === p.teamId)
      .map((l) => `${describeLine(l)} from ${name(l.fromTeamId)}`);
    const sends = draft.lines
      .filter((l) => l.fromTeamId === p.teamId)
      .map((l) => `${describeLine(l)} to ${name(l.toTeamId)}`);
    return { teamId: p.teamId, shortName: p.shortName, receives, sends };
  });

  for (const row of summaryByTeam) {
    if (!row.receives.length && !row.sends.length) {
      blockers.push(
        `${row.shortName} is listed in this trade but neither sends nor receives ` +
          `anything. Remove the franchise, or record his side of it.`,
      );
    } else if (!row.receives.length) {
      // The likeliest data-entry mistake in the whole flow: one side entered,
      // the other forgotten. Legal, so it warns rather than blocks.
      warnings.push(
        `${row.shortName} gives up ${row.sends.length} asset(s) and receives nothing. ` +
          `That is legal, but check the other side of the trade was recorded.`,
      );
    } else if (!row.sends.length) {
      warnings.push(
        `${row.shortName} receives ${row.receives.length} asset(s) and gives up nothing. ` +
          `That is legal, but check the other side of the trade was recorded.`,
      );
    }
  }

  return {
    season,
    tradedAt: draft.tradedAt,
    timingLabel: timing.label,
    participants,
    blockers,
    warnings,
    pickMoves,
    playerMoves,
    faabMoves,
    pickCounts,
    summaryByTeam,
  };
}

/**
 * Apply a logged trade to the ledger.
 *
 * Goes straight to `accepted`: ESPN already approved it, so there is no propose
 * step to model. The preview is re-run server-side first and a blocker refuses
 * the write — the client cannot skip a check by not asking for one.
 */
export async function commitTrade(draft: TradeDraft): Promise<CommitResult> {
  const preview = await previewTrade(draft);
  if (preview.blockers.length) {
    throw new Error(preview.blockers.join(" "));
  }

  const notes = draft.notes.trim();
  const trade = await proposeTrade({
    // The season the DATE says, not the one the client sent. `previewTrade`
    // already refused a date whose season the league has no row for.
    season: preview.season,
    tradedAt: draft.tradedAt,
    notes: notes || undefined,
    assets: toAssetInputs(draft),
  });

  try {
    await acceptTrade(trade.id);
  } catch (err) {
    // `acceptTrade` validates every asset before applying any, so reaching here
    // means the ledger moved under us or the database failed mid-write. Say so
    // and leave the row: a trade sitting at `proposed` is honest and fixable,
    // and deleting it would destroy the only record of what was entered.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `The trade was saved but could NOT be applied to the ledger: ${message} ` +
        `It is recorded as unapplied — reverse it and log it again once the cause is fixed.`,
    );
  }

  return { tradeId: trade.id, applied: preview };
}

// --- The standing reconciliation view ---------------------------------------

export async function getOwnershipGrid(season: number): Promise<OwnershipGridView> {
  const supabase = createServiceClient();
  const [teams, { data: rows, error }] = await Promise.all([
    readTeams(),
    supabase
      .from("pick_ownership")
      .select("round, original_team, current_team")
      .eq("season", season)
      .order("round"),
  ]);
  if (error) throw new Error(error.message);

  const shortName = new Map(teams.map((t) => [t.id, t.short_name]));
  const cells: OwnershipGridView["cells"] = {};
  const heldCounts: Record<string, number> = Object.fromEntries(teams.map((t) => [t.id, 0]));

  for (const row of rows ?? []) {
    const byRound = cells[row.original_team] ?? {};
    byRound[row.round] = {
      holderId: row.current_team,
      holderShortName: shortName.get(row.current_team) ?? "?",
    };
    cells[row.original_team] = byRound;
    heldCounts[row.current_team] = (heldCounts[row.current_team] ?? 0) + 1;
  }

  return {
    season,
    rounds: Array.from({ length: DRAFT.rounds }, (_, i) => i + 1),
    teams: teams.map((t) => ({ teamId: t.id, shortName: t.short_name })),
    cells,
    heldCounts,
    empty: !(rows ?? []).length,
  };
}

/**
 * Statements about the ledger that are either true or a problem to fix.
 *
 * These are the checks that turn "find out at the draft table next August" into
 * "find out in November". Each one corresponds to a way the ledger has actually
 * been observed to go wrong, or could silently go wrong under the writes this
 * flow performs.
 */
export async function checkLedgerInvariants(season: number): Promise<LedgerInvariant[]> {
  const supabase = createServiceClient();
  const out: LedgerInvariant[] = [];
  const teams = await readTeams();
  const shortName = new Map(teams.map((t) => [t.id, t.short_name]));
  const expectedRows = LEAGUE.teams * DRAFT.rounds;

  // 1. Nothing lost or duplicated: one owner per (round, original franchise).
  const { data: ownership } = await supabase
    .from("pick_ownership")
    .select("round, original_team, current_team")
    .eq("season", season);
  const rows = ownership ?? [];
  const perRound = new Map<number, number>();
  for (const r of rows) perRound.set(r.round, (perRound.get(r.round) ?? 0) + 1);
  const shortRounds = [...perRound.entries()].filter(([, n]) => n !== LEAGUE.teams);
  out.push({
    label: `Every ${season} round has exactly ${LEAGUE.teams} picks accounted for`,
    ok: rows.length === expectedRows && shortRounds.length === 0,
    detail:
      rows.length === expectedRows && shortRounds.length === 0
        ? null
        : rows.length === 0
          ? `No ${season} pick ownership exists yet — initialize the ledger for that season.`
          : `${rows.length} of ${expectedRows} rows; rounds off count: ` +
            (shortRounds.map(([r, n]) => `R${r} has ${n}`).join(", ") || "none"),
  });

  // 2. Every holder is a real franchise.
  const unknownHolders = rows.filter((r) => !shortName.has(r.current_team));
  out.push({
    label: "Every pick is held by a franchise in the league",
    ok: unknownHolders.length === 0,
    detail: unknownHolders.length ? `${unknownHolders.length} pick(s) held by unknown ids` : null,
  });

  // 3. The board and the ledger agree. Only meaningful once a board exists —
  //    this is what makes a traded pick appear in the right cell on draft night.
  const { data: slots } = await supabase
    .from("draft_slots")
    .select("round, original_team_id, current_team_id")
    .eq("season", season);
  if ((slots ?? []).length) {
    const ledger = new Map(rows.map((r) => [`${r.round}:${r.original_team}`, r.current_team]));
    const disagreements = (slots ?? []).filter(
      (s) => ledger.get(`${s.round}:${s.original_team_id}`) !== s.current_team_id,
    );
    out.push({
      label: `The ${season} board and the pick ledger agree on every slot`,
      ok: disagreements.length === 0,
      detail: disagreements.length
        ? disagreements
            .slice(0, 5)
            .map(
              (s) =>
                `R${s.round} of ${shortName.get(s.original_team_id) ?? "?"}: board says ` +
                `${shortName.get(s.current_team_id) ?? "?"}, ledger says ` +
                `${shortName.get(ledger.get(`${s.round}:${s.original_team_id}`) ?? "") ?? "nobody"}`,
            )
            .join("; ")
        : null,
    });
  }

  // 4. The provenance log describes picks that exist. A `traded_picks` row whose
  //    `original_team` disagrees with the ownership row it describes is exactly
  //    the corruption the multi-hop defect used to write.
  const { data: hops } = await supabase
    .from("traded_picks")
    .select("season, round, original_team, trade_id")
    .eq("season", season);
  const ownershipKeys = new Set(rows.map((r) => `${r.round}:${r.original_team}`));
  const orphanHops = (hops ?? []).filter(
    (h) => !ownershipKeys.has(`${h.round}:${h.original_team}`),
  );
  out.push({
    label: "Every recorded pick movement describes a pick that exists",
    ok: orphanHops.length === 0,
    detail: orphanHops.length
      ? `${orphanHops.length} movement row(s) name an original owner with no matching pick`
      : null,
  });

  // 5. A reversed trade left nothing behind. A reversal deletes its hop rows,
  //    because a reversed trade did not happen; the audit trail is the status.
  const { data: reversed } = await supabase
    .from("trades")
    .select("id")
    .eq("season", season)
    .eq("status", "reversed");
  const reversedIds = (reversed ?? []).map((t) => t.id);
  let strayReversedHops = 0;
  if (reversedIds.length) {
    const { count } = await supabase
      .from("traded_picks")
      .select("id", { count: "exact", head: true })
      .in("trade_id", reversedIds);
    strayReversedHops = count ?? 0;
  }
  out.push({
    label: "No reversed trade still has picks recorded against it",
    ok: strayReversedHops === 0,
    detail: strayReversedHops ? `${strayReversedHops} movement row(s) survive a reversal` : null,
  });

  // 6. Every trade records WHEN it happened.
  //
  //    Not bookkeeping: the keeper term is an acquisition season plus two keeper
  //    seasons, and which season is which depends on whether the trade fell
  //    before the draft or during the season. An undated trade therefore has no
  //    computable keeper consequence at all. The twelve imported from the
  //    workbook are undated and stay that way — the workbook is the only timing
  //    evidence for them and it is known to omit at least one real trade, so a
  //    guessed date would be indistinguishable from a known one.
  const { data: dateRows } = await supabase
    .from("trades")
    .select("id, status, source, source_ref, traded_at")
    .eq("season", season);
  const undated = (dateRows ?? []).filter((t) => !t.traded_at && t.status !== "reversed");
  const undatedApplied = undated.filter((t) => t.status === "accepted");
  const undatedImported = undated.filter((t) => t.status !== "accepted");

  out.push({
    label: "Every trade applied to the ledger records the date it happened",
    ok: undatedApplied.length === 0,
    detail: undatedApplied.length
      ? `${undatedApplied.length} applied trade(s) have no date, so the keeper clocks ` +
        `they set cannot be verified: ` +
        undatedApplied.map((t) => t.source_ref ?? t.id.slice(0, 8)).join(", ")
      : null,
  });

  // The imported trades have no date, and that USED to be reported as an
  // outstanding failure. It no longer is.
  //
  // COMMISSIONER CONFIRMATION, Aug 26 2026: "No pre-draft player trades this
  // year. Just confirmed." That answers the only question the date was needed
  // for. Every one of the twelve is an IN-SEASON trade, so for each of them the
  // acquisition season is simply the season the trade occurred, and the keeper
  // sheet's `N of 3` column already encodes exactly that — which is why the app
  // and the sheet agree on every undisputed keeper on the board. (Puka Nacua is
  // the only disputed one, and his 2026 cost is settled either way.)
  //
  // So this is now a statement of fact rather than a defect. A permanently
  // failing check is worse than no check: it trains the reader to skip the
  // output, which is how a real failure gets missed.
  if (undatedImported.length) {
    out.push({
      label: `${undatedImported.length} imported trade(s) carry no date — confirmed in-season`,
      ok: true,
      detail:
        `${undatedImported.map((t) => t.source_ref ?? t.id.slice(0, 8)).join(", ")} — ` +
        `imported from the workbook, which carries no dates. The commissioner has ` +
        `confirmed there were NO pre-draft player trades this year, so all of these ` +
        `are in-season and their acquisition season is the season they occurred. The ` +
        `keeper sheet's "N of 3" already records that. Dates are still not invented ` +
        `for them: every trade logged through the app from now on carries its own.`,
    });
  }

  // 7. Every keeper sits on a pick his franchise actually holds in his cost
  //    round. Placing a keeper on a pick that has since been traded away is how
  //    a board ends up with two players in one cell.
  const { data: keepers } = await supabase
    .from("keepers")
    .select("player_id, team_id, cost_round")
    .eq("season", season);
  const holderOf = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.round}`;
    holderOf.set(key, [...(holderOf.get(key) ?? []), r.current_team]);
  }
  const homeless = (keepers ?? []).filter(
    (k) => !(holderOf.get(String(k.cost_round)) ?? []).includes(k.team_id),
  );
  if ((keepers ?? []).length) {
    out.push({
      label: "Every keeper sits in a round his franchise holds a pick in",
      ok: homeless.length === 0,
      detail: homeless.length
        ? `${homeless.length} keeper(s) priced into a round their franchise no longer holds`
        : null,
    });
  }

  return out;
}

/**
 * Trades in the ledger, listed by party rather than by side.
 *
 * Not built on a pair: a three-team trade is legal here and a two-sided shape
 * would silently drop its third leg.
 */
export async function listLoggedTrades(season: number): Promise<LoggedTradeView[]> {
  const supabase = createServiceClient();
  const [teams, { data: trades, error }] = await Promise.all([
    readTeams(),
    supabase
      .from("trades")
      .select("id, season, status, executed_at, traded_at, created_at, notes, source")
      .eq("season", season)
      .order("created_at", { ascending: false }),
  ]);
  if (error) throw new Error(error.message);
  if (!trades?.length) return [];

  const shortName = new Map(teams.map((t) => [t.id, t.short_name]));
  const { data: assets } = await supabase
    .from("trade_assets")
    .select("trade_id, from_team, to_team, asset_type, ref")
    .in("trade_id", trades.map((t) => t.id));

  const playerRefs = [
    ...new Set(
      (assets ?? [])
        .filter((a) => a.asset_type === "player" || a.asset_type === "keeper_right")
        .map((a) => a.ref),
    ),
  ];
  const playerNames = new Map<string, string>();
  if (playerRefs.length) {
    const { data: players } = await supabase
      .from("players")
      .select("player_id, full_name")
      .in("player_id", playerRefs);
    for (const p of players ?? []) playerNames.set(p.player_id, p.full_name);
  }

  const label = (a: { asset_type: string; ref: string }): string => {
    if (a.asset_type === "pick") {
      try {
        const { season: s, round, originalTeam } = parsePickRef(a.ref);
        const via = originalTeam ? shortName.get(originalTeam) : null;
        return `${s} R${round}${via ? ` (${via}'s)` : ""}`;
      } catch {
        return a.ref;
      }
    }
    if (a.asset_type === "faab") return `$${a.ref} FAAB`;
    return playerNames.get(a.ref) ?? a.ref;
  };

  const byTrade = new Map<string, NonNullable<typeof assets>>();
  for (const a of assets ?? []) {
    byTrade.set(a.trade_id, [...(byTrade.get(a.trade_id) ?? []), a]);
  }

  return trades.map((t) => {
    const rows = byTrade.get(t.id) ?? [];
    const partyIds = [...new Set(rows.flatMap((a) => [a.from_team, a.to_team]))];
    return {
      id: t.id,
      season: t.season,
      status: t.status,
      executedAt: t.executed_at,
      createdAt: t.created_at,
      tradedAt: t.traded_at,
      // Derived on read rather than stored, so the classification always
      // reflects the current calendar rather than a stale copy of it.
      timingLabel: t.traded_at ? classifyTradeDate(t.traded_at).label : null,
      // The twelve imported trades land here. Surfaced rather than guessed: the
      // workbook is the only timing evidence for them and is known incomplete.
      needsDateBackfill: !t.traded_at,
      notes: t.notes,
      reversed: t.status === "reversed",
      imported: !!t.source,
      parties: partyIds.map((id) => ({
        teamId: id,
        shortName: shortName.get(id) ?? "?",
        receives: rows.filter((a) => a.to_team === id).map(label),
        sends: rows.filter((a) => a.from_team === id).map(label),
      })),
    };
  });
}

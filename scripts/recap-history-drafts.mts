/**
 * Eight real drafts, loaded off the commissioner's workbook, plus the fixture
 * factory the edge cases are built from.
 *
 * Used by `scripts/verify-recap-grade.mts`. Kept beside it rather than in
 * `@/lib` for the same reason `scripts/recap-board-shapes.mts` is: it exists to
 * feed a verification script boards the shipping code has never seen, and
 * nothing in the app should be able to import a spreadsheet parser.
 *
 * ============================================================================
 * WHY HISTORICAL BOARDS ARE THE RIGHT FIDELITY TEST, AND WHAT THEY CANNOT DO
 * ============================================================================
 *
 * `buildGradeInput`'s central claim is that it never reports an absent input as
 * a zero — that a board it cannot price comes back saying so instead of coming
 * back with ten franchises who captured no value. The only honest way to test
 * that claim is on data that is genuinely missing pieces, and a synthetic stub
 * with fields deleted proves nothing, because the person deleting them is the
 * person who decided which ones matter.
 *
 * These eight seasons are missing pieces for real:
 *
 *   · NO ADP, ANY YEAR. There is no historical consensus ranking anywhere in the
 *     repo, so no pick in 2018 has an expected slot and no gap can be computed.
 *     The board-relative yardstick — the thing the whole grade rests on — simply
 *     does not exist for any past draft. This is not a gap that can be filled
 *     from within the repo, and it is the reason a historical draft cannot be
 *     graded by the shipping rubric.
 *   · NO PROJECTIONS. `data/fantasypros-projections-2026.json` is a 2026
 *     snapshot. No points, no wins, no playoff odds for any past season.
 *   · NO KEEPER ATTRIBUTION, IN SEVEN OF THE EIGHT SEASONS. The 2018-2025
 *     draft-result sheets mark kept players by CELL HIGHLIGHTING — the 2018
 *     sheet says so in a stray cell, "Keepers Highlighted" — and the extraction
 *     to JSON kept the values and dropped the formatting. The keeper-list sheets
 *     record who was ELIGIBLE to be kept, not who was kept. So which of those
 *     seasons' rows were keepers is not recoverable, and those fixtures carry no
 *     keepers rather than guessing: a wrong keeper price in front of the model is
 *     worse than telling it the price is unknown.
 *
 *     2017 IS THE EXCEPTION AND IT IS USEFUL. That sheet is a text listing
 *     rather than a table, and it marks its keepers in the text itself with a
 *     trailing `*K*` — nineteen of them, the only season in the repository where
 *     the split between a keeper and a pick survives the extraction. It is the
 *     sole historical board that can exercise the keeper path at all, and it
 *     exercises the honest version of it: keepers present, prices unknown.
 *   · NO LINEUPS. A draft sheet records who took whom and nothing about whether
 *     the result could field nine starters.
 *
 * What they DO have is 160 real picks a year, by real managers, in real rounds —
 * which is exactly enough to prove that nothing is dropped, nothing is
 * double-counted, every comparison is internally consistent, and every absence
 * is labelled.
 *
 * ============================================================================
 * WHAT IS NOT HERE: FINAL STANDINGS
 * ============================================================================
 *
 * There are none, and this is worth writing down where somebody will find it.
 * The only standings fact in the repository is `league.standings2025` in
 * `data/league-history.json`: three positions, marked `inferred`, reverse-
 * engineered from a quote about the slot auction, with its own note saying the
 * other seven are unrecorded. There is no season-by-season results table, no
 * champions list and no win-loss record for any year.
 *
 * So "did the A-graded teams contend" has no answer key and no amount of
 * cleverness in this file will produce one. What replaces it is
 * `revealedValue`, below, which measures what the LEAGUE ITSELF did with a
 * drafted player afterwards — and that is recorded, in eleven keeper lists and
 * eight draft sheets.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { FRANCHISES } from "@/lib/league-config";
import {
  DRAFT_SHEET_SEASONS,
  loadDraftSheet,
  normalizePlayerName as normalizeName,
  toShortName,
  type SheetPick,
} from "@/lib/recap-grade-source";
import type {
  DossierPick,
  FranchiseDossier,
  PickCapital,
  RecapDossier,
} from "@/lib/recap-dossier";

/** Rounds every season in this league has run. */
const ROUNDS = 16;
const TEAMS = 10;

/**
 * The draft-result sheets, by season.
 *
 * 2016 and 2022 are absent from the workbook — the 2022 gap is load-bearing
 * elsewhere in the repo, since it is the one year that would settle the Elbe
 * quarterback joke. 2017 is a different shape from the rest: a formatted
 * "*** ROUND n RESULTS ***" listing rather than a table, parsed separately
 * below.
 */
/**
 * The seasons with a draft-result sheet, and the loader for them.
 *
 * BOTH RE-EXPORTED RATHER THAN REIMPLEMENTED. An earlier version of this file
 * carried its own copy of the spreadsheet parser, which meant two parsers over
 * the same eight sheets: one feeding the positional price market that a grade
 * cites, and one feeding the fixtures that verify the grade. Two parsers over one
 * source is how a page ends up printing two different numbers for the same fact,
 * which this repository has already done twice. `@/lib/recap-grade-source` owns
 * it; this file owns the fixtures built from it.
 */
export const HISTORY_SEASONS = DRAFT_SHEET_SEASONS;

export type HistoricalPick = SheetPick;

export { normalizeName, toShortName };

/** Every slot of one season, in board order. Keepers included, flagged. */
export function loadSeason(season: number): HistoricalPick[] {
  return loadDraftSheet(season);
}

/** Keeper-list sheets, used only by `revealedValue` to see who survived. */
const KEEPER_LIST_SEASONS = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2024, 2025, 2026];

function keeperListFile(season: number): string {
  if (season === 2016) return "2026-draft__2016-keeper";
  if (season === 2017) return "2026-draft__2017-keeper";
  if (season === 2018) return "2026-draft__2018-keeper";
  return `2026-draft__keeper-list-for-${season}`;
}

/** Every name on a keeper-list sheet, with the manager it sat under. */
function loadKeeperList(season: number): { player: string; manager: string }[] {
  let sheet: { rows: unknown[][] };
  try {
    const full = path.join(
      process.cwd(),
      "data",
      "spreadsheets",
      `${keeperListFile(season)}.json`,
    );
    sheet = JSON.parse(readFileSync(full, "utf8")) as { rows: unknown[][] };
  } catch {
    return [];
  }
  if (!sheet?.rows) return [];

  const headerIndex = sheet.rows.findIndex((row) =>
    row.some((c) => typeof c === "string" && c.trim().toLowerCase() === "league member"),
  );
  if (headerIndex === -1) return [];
  const header = sheet.rows[headerIndex].map((c) =>
    typeof c === "string" ? c.trim().toLowerCase() : "",
  );
  const iPlayer = header.indexOf("player");
  const iManager = header.indexOf("league member");

  const out: { player: string; manager: string }[] = [];
  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    if (typeof row[iPlayer] !== "string" || typeof row[iManager] !== "string") continue;
    if (!row[iPlayer].trim() || !row[iManager].trim()) continue;
    out.push({ player: row[iPlayer].trim(), manager: toShortName(row[iManager]) });
  }
  return out;
}

// --- Revealed value, which is what replaces the missing standings -----------

export type RevealedPick = HistoricalPick & {
  /**
   * Later seasons, of those the repo has sheets for, in which this player
   * appears anywhere — any draft sheet or any keeper list, under any manager.
   *
   * THIS IS THE LEAGUE'S OWN VERDICT ON THE PICK, and it is recorded rather than
   * modelled. A player the room kept paying to keep, or kept drafting, was worth
   * having; a player who never appears again was not. It says nothing about
   * whether his franchise won, which is the thing that genuinely cannot be
   * recovered here.
   */
  survivingSeasons: number;
  /** True when the same manager had him on his keeper list the very next year. */
  keptForward: boolean;
  /**
   * Round drafted times seasons survived. A LATE PICK THAT LASTED, in one
   * number — which is what the league means when it talks about a great pick.
   * A first-rounder who lasts seven years scores 7; a sixteenth-rounder who
   * lasts seven scores 112, and the second one is the story.
   */
  lateAndLasted: number;
};

/**
 * What the league went on to do with every player taken in one season.
 *
 * The later seasons are those the repo actually has, which is uneven — 2022 is
 * missing a draft sheet and 2023 a keeper list — so `survivingSeasons` is a
 * count out of what exists rather than out of the calendar. Comparisons within
 * one season are sound; comparisons of the raw count across seasons are not,
 * because a 2025 pick has one later season to survive and a 2017 pick has
 * fifteen.
 */
export function revealedValue(season: number): RevealedPick[] {
  /*
   * Keepers are excluded because this measures DRAFT decisions. Keeping a player
   * already on the roster is a February decision priced in rounds, and counting
   * it here would credit a manager for drafting a man he drafted years ago.
   * Only 2017 has any to exclude.
   */
  const picks = loadSeason(season).filter((p) => !p.isKeeper);
  if (!picks.length) return [];

  const laterDraftSeasons = HISTORY_SEASONS.filter((s) => s > season);
  const laterKeeperSeasons = KEEPER_LIST_SEASONS.filter((s) => s > season);

  const appearances = new Map<string, Set<number>>();
  const note = (name: string, s: number) => {
    const key = normalizeName(name);
    (appearances.get(key) ?? appearances.set(key, new Set()).get(key)!).add(s);
  };

  for (const s of laterDraftSeasons) {
    for (const p of loadSeason(s)) note(p.player, s);
  }
  for (const s of laterKeeperSeasons) {
    for (const k of loadKeeperList(s)) note(k.player, s);
  }

  const nextKeeperList = loadKeeperList(season + 1);
  const keptForwardBy = new Map<string, string>(
    nextKeeperList.map((k) => [normalizeName(k.player), k.manager]),
  );

  return picks.map((p) => {
    const key = normalizeName(p.player);
    const surviving = appearances.get(key)?.size ?? 0;
    return {
      ...p,
      survivingSeasons: surviving,
      keptForward: keptForwardBy.get(key) === p.manager,
      lateAndLasted: p.round * surviving,
    };
  });
}

// --- Dossier fixtures -------------------------------------------------------

const EMPTY_CAPITAL: PickCapital = {
  earlyThroughRound: 6,
  draftableRounds: [],
  keeperConsumedRounds: [],
  doubledRounds: [],
  emptyRounds: [],
  acquired: [],
  surrendered: [],
  earlyPicks: 0,
  earlyPicksLeagueMedian: 0,
  earlyPicksVsMedian: 0,
  earlyCapitalRank: 1,
  medianDraftableOverall: null,
  topTalentWindow: 20,
  topTalentCaptured: 0,
  topTalentLeagueMedian: 0,
  topTalentPlayers: [],
  longestGapRounds: 0,
  longestGapAfterRound: null,
};

/**
 * One franchise, with every field at its honest empty.
 *
 * The base for both the historical seasons and the edge cases, so that a field
 * added to `FranchiseDossier` upstream breaks this in one place rather than in
 * nine fixtures.
 */
export function fixtureFranchise(
  overrides: Partial<FranchiseDossier> & Pick<FranchiseDossier, "teamId" | "teamName">,
): FranchiseDossier {
  const franchise: FranchiseDossier = {
    franchiseName: overrides.teamName,
    manager: overrides.teamName,
    draftSlot: 1,
    keepers: [],
    passedOnKeepers: [],
    passedOnKeepersTotal: 0,
    unusedKeeperSlots: { count: 0, deliberate: false },
    draftCapital: {
      picksHeld: 0,
      acquired: 0,
      tradedAway: 0,
      firstPickLabel: null,
      firstPickOverall: null,
      hasFirstRoundPick: false,
      roundsWithNoPick: [],
    },
    pickCapital: { ...EMPTY_CAPITAL },
    picks: [],
    bestSteal: null,
    worstReach: null,
    valueGained: 0,
    averageSlotsVsBoard: 0,
    scoredPicks: 0,
    starters: [],
    benchCount: 0,
    byPosition: {},
    openStarterSlots: [],
    positionsAtCap: [],
    picksRemaining: 0,
    oddities: [],
    ...overrides,
  };
  /*
   * `passedOnKeepersTotal` counts the options BEFORE `passedOnKeepers` is
   * capped, so a fixture that supplies a list and no total has not truncated
   * anything and its total is the length of that list. Defaulting it to zero
   * would break the dossier's own invariant — the total is never smaller than
   * the list it caps — and would hand the prompt a franchise whose options are
   * listed and simultaneously said not to exist.
   */
  return {
    ...franchise,
    passedOnKeepersTotal: overrides.passedOnKeepersTotal ?? franchise.passedOnKeepers.length,
  };
}

/** A whole board at its honest empty, for the edge cases to fill in. */
export function fixtureDossier(overrides: Partial<RecapDossier> = {}): RecapDossier {
  return {
    season: 2026,
    rounds: ROUNDS,
    teamCount: TEAMS,
    keepersOutOfPool: 0,
    draftableSlots: ROUNDS * TEAMS,
    picksEntered: 0,
    boardComplete: false,
    league: {
      scoringFormat: "PPR",
      passingTouchdownPoints: 6,
      startingLineup: "1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX, 1 DST",
      benchSlots: 7,
      rosterCap: 16,
      positionalMax: {},
      noKicker: true,
    },
    franchises: [],
    valueLeaderboard: [],
    biggestSteals: [],
    biggestReaches: [],
    positionRuns: [],
    positionWaits: [],
    leagueAverageByPosition: {},
    projectedStandings: null,
    ...overrides,
  };
}

/**
 * A real season as a dossier, with every unavailable field left unavailable.
 *
 * NOTHING IS INVENTED TO FILL A GAP. `expectedPick` and `slotsVsBoard` are null
 * on every pick because no historical ADP exists; `keepers` is empty because
 * which rows were keepers is not recoverable; `starters` is empty because no
 * lineup was ever solved; `projectedStandings` is null. Those nulls are the
 * point — they are what `buildGradeInput` has to notice and report rather than
 * flatten to zero.
 *
 * The figures that ARE recoverable are computed properly rather than stubbed:
 * pick capital comes off the rounds each manager actually held, position counts
 * off the players actually taken, and the league median and ranks off those. A
 * fixture whose comparisons were fake would let a bug in the comparison layer
 * through.
 */
export function historicalDossier(season: number): RecapDossier {
  const all = loadSeason(season);
  const managers = [...new Set(all.map((p) => p.manager))].sort();

  const byManager = new Map<string, HistoricalPick[]>(
    managers.map((m) => [m, all.filter((p) => p.manager === m)]),
  );
  /*
   * A keeper-consumed slot is not capital — the same rule the live dossier
   * follows. Only 2017 has any, so everywhere else `drafted` is the whole list.
   */
  const draftedBy = (m: string) => byManager.get(m)!.filter((p) => !p.isKeeper);
  const keptBy = (m: string) => byManager.get(m)!.filter((p) => p.isKeeper);

  const earlyPicksByManager = new Map(
    managers.map((m) => [m, draftedBy(m).filter((p) => p.round <= 6).length]),
  );
  const earlyValues = [...earlyPicksByManager.values()];
  const sortedEarly = [...earlyValues].sort((a, b) => a - b);
  const mid = Math.floor(sortedEarly.length / 2);
  const earlyMedian = sortedEarly.length
    ? sortedEarly.length % 2
      ? sortedEarly[mid]
      : Math.round(((sortedEarly[mid - 1] + sortedEarly[mid]) / 2) * 10) / 10
    : 0;

  const topTalentSlots = new Set(
    all
      .filter((p) => !p.isKeeper)
      .map((p) => p.overallPick)
      .sort((a, b) => a - b)
      .slice(0, EMPTY_CAPITAL.topTalentWindow),
  );
  const topTalentByManager = new Map(
    managers.map((m) => [
      m,
      draftedBy(m).filter((p) => topTalentSlots.has(p.overallPick)).length,
    ]),
  );
  const talentValues = [...topTalentByManager.values()].sort((a, b) => a - b);
  const tMid = Math.floor(talentValues.length / 2);
  const talentMedian = talentValues.length
    ? talentValues.length % 2
      ? talentValues[tMid]
      : Math.round(((talentValues[tMid - 1] + talentValues[tMid]) / 2) * 10) / 10
    : 0;

  const label = (p: HistoricalPick) =>
    `${p.round}.${String(((p.overallPick - 1) % TEAMS) + 1).padStart(2, "0")}`;

  const franchises: FranchiseDossier[] = managers.map((manager) => {
    const held = byManager.get(manager)!;
    const mine = draftedBy(manager);
    const kept = keptBy(manager);
    const known = FRANCHISES.find((f) => f.shortName === manager);
    const rounds = mine.map((p) => p.round).sort((a, b) => a - b);
    const roundCounts = new Map<number, number>();
    for (const r of rounds) roundCounts.set(r, (roundCounts.get(r) ?? 0) + 1);
    const allRounds = Array.from({ length: ROUNDS }, (_, i) => i + 1);

    const byPosition: Record<string, number> = {};
    for (const p of held) {
      if (!p.position) continue;
      byPosition[p.position] = (byPosition[p.position] ?? 0) + 1;
    }

    const early = earlyPicksByManager.get(manager)!;

    return fixtureFranchise({
      teamId: manager,
      teamName: manager,
      franchiseName: known?.franchiseName ?? manager,
      manager: known?.manager ?? manager,
      draftSlot: held[0] ? ((held[0].overallPick - 1) % TEAMS) + 1 : 1,
      keepers: kept.map((p) => ({
        player: p.player,
        position: p.position,
        costRound: p.round,
        label: label(p),
        costOverallPick: p.overallPick,
        // No historical ADP, so the keeper cannot be priced against the market.
        // Null is the answer; zero would say keeping him saved nothing.
        rawAdp: null,
        pickIfReleased: null,
        slotsSavedByKeeping: null,
      })),
      picks: mine.map(
        (p): DossierPick => ({
          label: label(p),
          round: p.round,
          overallPick: p.overallPick,
          player: p.player,
          position: p.position,
          nflTeam: p.nflTeam,
          // No historical ADP exists, so there is no expectation and no gap.
          rawAdp: null,
          expectedPick: null,
          slotsVsBoard: null,
          acquiredFrom: null,
        }),
      ),
      draftCapital: {
        picksHeld: held.length,
        // Historical trades are not recorded per slot anywhere in the repo, so
        // no slot can be attributed to another franchise. Zero here means
        // "unrecorded", and the payload's trade block is empty for the same
        // reason rather than because these were quiet years.
        acquired: 0,
        tradedAway: 0,
        firstPickLabel: mine[0] ? label(mine[0]) : null,
        firstPickOverall: mine[0]?.overallPick ?? null,
        hasFirstRoundPick: roundCounts.has(1),
        roundsWithNoPick: allRounds.filter((r) => !roundCounts.has(r)),
      },
      pickCapital: {
        ...EMPTY_CAPITAL,
        draftableRounds: rounds,
        keeperConsumedRounds: kept.map((p) => p.round).sort((a, b) => a - b),
        doubledRounds: [...roundCounts]
          .filter(([, count]) => count > 1)
          .sort((a, b) => a[0] - b[0])
          .map(([round, count]) => ({ round, count })),
        emptyRounds: allRounds.filter((r) => !roundCounts.has(r)),
        earlyPicks: early,
        earlyPicksLeagueMedian: earlyMedian,
        earlyPicksVsMedian: Math.round((early - earlyMedian) * 10) / 10,
        earlyCapitalRank: earlyValues.filter((v) => v > early).length + 1,
        medianDraftableOverall: mine.length
          ? mine.map((p) => p.overallPick).sort((a, b) => a - b)[
              Math.floor(mine.length / 2)
            ]
          : null,
        topTalentCaptured: topTalentByManager.get(manager)!,
        topTalentLeagueMedian: talentMedian,
      },
      byPosition,
      benchCount: held.length,
    });
  });

  const totals: Record<string, number> = {};
  for (const f of franchises) {
    for (const [position, count] of Object.entries(f.byPosition)) {
      totals[position] = (totals[position] ?? 0) + count;
    }
  }

  const keptCount = all.filter((p) => p.isKeeper).length;

  return fixtureDossier({
    season,
    teamCount: franchises.length,
    keepersOutOfPool: keptCount,
    draftableSlots: all.length - keptCount,
    picksEntered: all.length - keptCount,
    boardComplete: true,
    franchises,
    valueLeaderboard: franchises.map((f, i) => ({
      rank: i + 1,
      teamId: f.teamId,
      teamName: f.teamName,
      manager: f.manager,
      valueGained: 0,
      averageSlotsVsBoard: 0,
    })),
    leagueAverageByPosition: Object.fromEntries(
      Object.entries(totals).map(([position, total]) => [
        position,
        Math.round((total / (franchises.length || 1)) * 10) / 10,
      ]),
    ),
  });
}

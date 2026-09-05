/**
 * A projected 1-to-10 finish for the league, computed here so that no language
 * model ever has to guess one.
 *
 * Sibling of `@/lib/expected-pick`, and for the same reason. That module exists
 * because a model asked "was this a reach?" will happily invent a number; this
 * one exists because a model asked "who wins the league?" will happily invent
 * an order, and an invented order is worse. The recap hands out glory and
 * ridicule on the strength of a projected finish, in front of ten people who
 * will remember it. So the ranking is arithmetic over the finished board and
 * the LLM's only job is to narrate a table it was handed.
 *
 * ============================================================================
 * WHAT THE NUMBER IS, AND WHAT IT IS NOT
 * ============================================================================
 *
 * `projectedPoints` is the season-long fantasy point total of a franchise's
 * BEST LEGAL STARTING LINEUP, scored on this league's own rules.
 *
 * It is not a prediction of the standings. Fantasy standings are decided
 * head-to-head over a schedule, and a team can out-score the league and miss
 * the playoffs by losing five one-point games. Total points and final position
 * are correlated, not the same thing, and anything reading this module must say
 * so rather than quietly upgrading a points ranking into a prophecy.
 *
 * The rows are therefore RANKED ON PROJECTED POINTS — stated in
 * `basis.rankedOn` and again in `basis.disclaimer`, so a caller has to go out
 * of its way to misrepresent it.
 *
 * Where a real schedule is available the module does better, and says so
 * separately. This league's 2026 ESPN extract carries a genuine 14-week
 * regular season — 70 games, five a week, every franchise playing every week —
 * so `simulateSeason` runs a Monte Carlo over the ACTUAL fixtures and fills in
 * `projectedWins` and `playoffOdds`. Those figures know about schedule luck,
 * which the points ranking cannot. They still do not decide the order: a Monte
 * Carlo is a distribution, and ranking on a sampled mean would let the
 * headline finish move on the sampling seed. Points rank; wins inform.
 *
 * No schedule is ever invented. `schedule` is an input, null is a normal value,
 * and the simulation block is simply absent when nothing real was supplied.
 *
 * ============================================================================
 * WHY THE LINEUP IS RE-OPTIMISED RATHER THAN READ OFF THE ROSTER SCREEN
 * ============================================================================
 *
 * `buildFranchiseLineups` supplies each franchise's roster, and this module
 * uses it for exactly that. But its lineup card is filled in BOARD ORDER —
 * earliest pick first — because the roster screen's question is "which player
 * is in which slot", and draft order is the only value signal a `LiveSlot`
 * carries.
 *
 * That is the wrong lineup to project from. A franchise that took a running
 * back in round two who is projected for 140 and one in round nine projected
 * for 210 would have the round-two back in RB1 and the better player behind
 * him, and board order would quietly leave points on the bench. Projecting off
 * it would rank teams partly on the order they happened to draft in, which is
 * not a thing that scores points in September.
 *
 * So the roster comes from `buildFranchiseLineups` and the ASSIGNMENT is
 * recomputed here against the projections. A bench full of running backs does
 * not score, and neither does a good running back sat behind a worse one.
 *
 * ============================================================================
 * WHY THE GREEDY ASSIGNMENT IS ACTUALLY OPTIMAL
 * ============================================================================
 *
 * FLEX is the only slot in this league that accepts more than its own name,
 * and it accepts a SUPERSET of what RB, WR and TE accept. That makes a
 * two-pass greedy provably optimal rather than merely convenient:
 *
 *   1. Every dedicated slot takes the highest-projected unused player of its
 *      own position.
 *   2. Every FLEX slot then takes the highest-projected player left who is
 *      eligible for it.
 *
 * Suppose some assignment beats that. Take any dedicated slot — RB1, say —
 * whose occupant is not the franchise's best available running back. The
 * better back must be sitting in a FLEX slot or on the bench. If he is in
 * FLEX, swap the two: both slots still legal, because FLEX accepts running
 * backs, and the total is unchanged. If he is on the bench, promote him and
 * bench the worse one: the total strictly rises, contradicting optimality.
 * Repeat until every dedicated slot holds the top of its position, at which
 * point step 2 is just "take the best of what is left", which is optimal by
 * construction. Same exchange argument `@/lib/draft-roster` and
 * `@/lib/roster-lineup` rest on.
 *
 * The two passes are SEPARATE on purpose, and this is the trap in the file.
 * `STARTING_LINEUP` lists FLEX *before* TE, so walking `lineupSlots()` once in
 * config order would let a FLEX slot take a franchise's only tight end and
 * leave the dedicated TE slot empty — turning a legal roster into an illegal
 * one and docking the franchise a starter it actually has. Dedicated slots go
 * first regardless of the order the config prints them in.
 *
 * ============================================================================
 * SIX-POINT PASSING TOUCHDOWNS
 * ============================================================================
 *
 * This league pays six for a passing touchdown where the public feeds assume
 * four, and that is worth about sixty points a season on a starting
 * quarterback — larger than the gap between fourth and eighth. This module
 * never sees a vendor's point total: `@/lib/projections` rescores stat lines
 * through `SCORING_SPEC`, and any row it could not rescore is counted in
 * `basis.vendorScoredCount` and disclosed rather than blended in silently.
 * `basis.passingTouchdownPoints` is published in the output so the recap can
 * state the basis instead of assuming it.
 *
 * ============================================================================
 * DETERMINISM
 * ============================================================================
 *
 * A projected finish that moves between page loads is worthless — worse than
 * absent, because the room will notice and stop believing the tab. So:
 *
 *   · Points are rounded to one decimal BEFORE ranking, so the number printed
 *     on screen is the number the order was decided on. A tie that looks like
 *     a tie is one.
 *   · Ties break on bench points descending, then on draft slot ascending.
 *     Draft slots are unique across the ten franchises, so the order is total
 *     and no pair can ever be left to sort order.
 *   · Player selection within a position breaks ties by earlier board slot,
 *     then by player id, so two equally projected players cannot swap places
 *     between runs.
 *   · The Monte Carlo is seeded from a constant, so the same board yields the
 *     same win totals every time. Pass a different seed to see the spread.
 *
 * ============================================================================
 * IT CANNOT BREAK THE DRAFT
 * ============================================================================
 *
 * The league drafts off the production app. This module is pure, I/O-free, and
 * imported by nothing on the draft path. Handed null projections it returns
 * null — "not available" — and it does not throw on a half-finished board,
 * a franchise short of starters, or a player nobody has a projection for. Each
 * of those is reported in a field rather than raised as an error, because the
 * correct behaviour on draft night is a blank section, never a stack trace and
 * never a fabricated order.
 */

import {
  LEAGUE,
  ROSTER,
  SCORING_FORMAT,
  SCORING_SPEC,
  STARTING_LINEUP,
} from "@/lib/league-config";
import { buildFranchiseLineups, lineupSlots, STARTER_COUNT } from "@/lib/roster-lineup";
import type { ProjectionIndex } from "@/lib/projections";
import type { DraftRoomView } from "@/lib/draft-types";
import type { LineupPlayer } from "@/lib/roster-lineup";

// --- Schedule ---------------------------------------------------------------

/**
 * One regular-season fixture, by franchise abbreviation.
 *
 * Abbreviations rather than team ids because the schedule comes out of ESPN and
 * the board comes out of Smart Draft, and the two products do not share an
 * identifier. `abbrev` is on both sides and is stable, so it is the join key —
 * the same reasoning that makes the room's short name the join key in
 * `@/lib/league-config`.
 */
export type ScheduleGame = {
  /** Matchup week, 1-based. */
  week: number;
  homeAbbrev: string;
  awayAbbrev: string;
};

export type LeagueSchedule = {
  season: number;
  /** Where this came from, printed in the output so the method is auditable. */
  source: string;
  games: ScheduleGame[];
};

// --- Output shapes ----------------------------------------------------------

/** One starting slot, with whoever the optimiser put in it. */
export type ProjectedStarter = {
  /** "QB", "RB", "FLEX"… as `STARTING_LINEUP` names it. */
  slot: string;
  /** "RB2" — the label the roster screen uses. */
  label: string;
  playerId: string | null;
  name: string | null;
  position: string | null;
  /** Season points. Zero for an empty slot AND for an unprojected player. */
  points: number;
  /** False when the slot is empty or the player has no projection. */
  projected: boolean;
  viaKeeper: boolean;
};

/** A rostered player with no projection to his name. */
export type MissingProjection = {
  teamId: string;
  teamName: string;
  playerName: string;
  position: string;
  /** True when the optimiser started him anyway, so the total is understated. */
  inStartingLineup: boolean;
  viaKeeper: boolean;
};

/**
 * A franchise's projected finish.
 *
 * Structurally a superset of `ProjectedFinish` in `@/lib/recap-dossier`, so an
 * array of these can be handed straight to `buildRecapDossier` without a
 * mapping step. That is deliberate: the dossier declared the four fields it
 * needs and this satisfies them exactly, which keeps the two modules
 * independent while letting them compose.
 */
export type ProjectedStandingsRow = {
  /** 1 is first. Dense and unique — see the tiebreak note in the header. */
  rank: number;
  teamId: string;
  /** Short handle — "Greg", "Witte". What the dense tables print. */
  teamName: string;
  franchiseName: string;
  abbrev: string;
  manager: string;
  /** Draft slot, 1-10. The final tiebreak, so it is published. */
  draftSlot: number;

  /** Season points from the best legal starting lineup. One decimal. */
  projectedPoints: number;
  starters: ProjectedStarter[];

  /** Total projected points of everyone NOT starting. Depth, in one number. */
  benchPoints: number;
  /** The best bench player. What one injury actually has behind it. */
  bestBenchPoints: number;
  /**
   * Points lost if this franchise's single best starter disappeared and the
   * best legal replacement on the bench took his slot. The honest measure of
   * depth: a big bench total made of a fourth quarterback does not cover a
   * running back.
   */
  replacementGap: number;

  /** Starting slots nobody can fill, by label. Non-empty means illegal. */
  openStarterLabels: string[];
  /** Starters with no projection, by name. Non-empty means understated. */
  unprojectedStarters: string[];
  /**
   * Starters the feed projects at exactly zero, by name.
   *
   * Distinct from `unprojectedStarters`, which is a JOIN failure. This is a
   * projection that exists and says zero — plausible for a third-string
   * quarterback, not plausible for somebody's starting running back, so a name
   * here usually means the feed has a gap rather than an opinion. Either way the
   * franchise's total is depressed by a slot contributing nothing, and that
   * should be visible rather than absorbed.
   */
  zeroProjectedStarters: string[];

  /**
   * The starting slot dragging this roster down, measured against the LEAGUE
   * MEAN for that same slot rather than in raw points. Raw points would name
   * the defence every time on all ten rosters, which tells nobody anything.
   * Null when the roster is incomplete or the league has no comparison.
   */
  weakestSlot: string | null;
  /** How far below the league's mean for that slot, in points. Positive. */
  weakestSlotDeficit: number | null;
  strongestSlot: string | null;
  strongestSlotSurplus: number | null;

  /**
   * Share of the starting projection resting on the top TWO starters, 0-1.
   * The fragility number a recap can say out loud.
   */
  topHeavyShare: number | null;
  /**
   * Concentration across all nine starters, 0-1. A normalised
   * Herfindahl index: 0 is nine identical contributors, 1 is one player and
   * eight zeroes. Distinct from `topHeavyShare`, which only looks at the top of
   * the roster — this catches a team that is thin everywhere as well as one
   * that is top-heavy.
   */
  fragility: number | null;

  /** Starting points by position, so a stack can be seen. */
  byPositionPoints: Record<string, number>;
  /**
   * Positions where the franchise rosters more than the lineup can ever start.
   * `surplus` is how many are structurally unstartable in any given week.
   */
  overConcentration: { position: string; rostered: number; startable: number; surplus: number }[];

  keeperCount: number;
  /** Starting points contributed by kept players. */
  keeperPoints: number;
  /** Share of the starting projection that came from keepers, 0-1. */
  keeperShare: number | null;

  rosterSize: number;

  /**
   * Mean projected points of this franchise's scheduled opponents. Schedule
   * strength, and the reason a points ranking and a wins ranking differ. Null
   * without a real schedule.
   */
  opponentStrength: number | null;
  /** Mean wins over the Monte Carlo. Null without a real schedule. */
  projectedWins: number | null;
  projectedLosses: number | null;
  /** Share of simulated seasons making the playoffs, 0-1. */
  playoffOdds: number | null;
  /** Share of simulated seasons winning the whole thing, 0-1. */
  titleOdds: number | null;
  /** Best and worst win totals seen across the runs. The spread, honestly. */
  winsRange: [number, number] | null;
};

export type ProjectedStandings = {
  /** Everything needed to state what this ranking is before quoting it. */
  basis: {
    rankedOn: "projected-points";
    /** Verbatim sentence for a UI or a prompt. Do not paraphrase it away. */
    disclaimer: string;
    scoringFormat: string;
    /** Six in this league. Published so nothing downstream has to assume. */
    passingTouchdownPoints: number;
    startingLineup: string;
    /** Documented, in application order. */
    tiebreaks: string[];
    projectionsSource: string;
    projectionsPulledAt: string;
    /** Rows rescored on this league's rules. */
    leagueScoredCount: number;
    /** Rows carried at a vendor's own scoring, and therefore suspect. */
    vendorScoredCount: number;
    /** True when every rostered player on all ten teams had a projection. */
    complete: boolean;
    /** True when all ten franchises field a full legal lineup. */
    allLineupsLegal: boolean;
  };
  /** First to last. */
  rows: ProjectedStandingsRow[];
  /** Every rostered player with no projection. Empty is the healthy state. */
  missingProjections: MissingProjection[];
  /** Present only when a real schedule was supplied. */
  simulation: {
    source: string;
    weeks: number;
    games: number;
    runs: number;
    seed: number;
    weeklyVolatility: number;
    note: string;
  } | null;
};

// --- Modelling constants ----------------------------------------------------

/**
 * Weeks an NFL team plays, used to turn a season projection into a per-week
 * mean for the simulation.
 *
 * Seventeen games, not the league's fourteen scoring periods. A season-long
 * projection covers the whole NFL season, so dividing by fourteen would inflate
 * every weekly score by about a fifth. It would not change the ORDER — the same
 * factor applies to all ten teams — but it would put implausible numbers in
 * front of the room and make the simulation easy to dismiss.
 */
const NFL_GAME_WEEKS = 17;

/**
 * Week-to-week standard deviation of a fantasy team's score, as a fraction of
 * its own mean.
 *
 * THIS IS THE ONE ASSUMPTION IN THE FILE THAT IS NOT DERIVED FROM THE LEAGUE'S
 * OWN DATA. It is a stated modelling parameter, published in
 * `simulation.weeklyVolatility` so a reader can see it and argue with it, and
 * it is the reason the standings are ranked on points rather than on simulated
 * wins. Raising it flattens the win distribution and pushes playoff odds toward
 * 60% for everybody; lowering it makes the schedule nearly deterministic.
 * Around 0.3 is the usual empirical figure for a nine-starter lineup.
 *
 * It is deliberately the SAME for every franchise. Making it depend on roster
 * fragility is defensible and would be more realistic, but it would also mean
 * the playoff odds encoded a second unfalsifiable judgement on top of this one,
 * and the fragility figures are already published for a human to weigh.
 */
const WEEKLY_VOLATILITY = 0.3;

/** Fixed so the same board always yields the same win totals. */
const DEFAULT_SEED = 20260829;

const DEFAULT_RUNS = 10_000;

// --- Small helpers ----------------------------------------------------------

/** One decimal, the unit fantasy points are quoted in. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Matches `mulberry32` in `@/lib/mock-draft-ai`; kept local so the standings
 * do not depend on the mock draft's AI for a four-line hash. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A standard normal draw, Box-Muller. The second value is discarded rather
 * than cached: keeping it would make a draw depend on how many draws came
 * before it, which is exactly the kind of hidden state that makes a
 * "deterministic" simulation stop being reproducible after a refactor.
 */
function normal(rng: () => number): number {
  const u = Math.max(rng(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** How many of a position the lineup can start at once, FLEX included. */
function startableCount(position: string): number {
  let n = 0;
  for (const { slot, count } of STARTING_LINEUP) {
    if (slot === position) n += count;
    else if (slot === "FLEX" && (position === "RB" || position === "WR" || position === "TE")) {
      n += count;
    }
  }
  return n;
}

const STARTING_LINEUP_LABEL = STARTING_LINEUP.map((s) => `${s.count} ${s.slot}`).join(", ");

// --- Lineup optimisation ----------------------------------------------------

type Candidate = {
  player: LineupPlayer;
  points: number;
  projected: boolean;
};

/**
 * Orders candidates within a position: most points first, then the earlier
 * board slot, then the player id.
 *
 * The last two are not cosmetic. Several players will share a projection to the
 * decimal, and without a total order two runs could put a different one in RB2
 * — same total, different lineup card, and a recap that contradicts itself
 * between refreshes.
 */
function byValue(a: Candidate, b: Candidate): number {
  if (b.points !== a.points) return b.points - a.points;
  if (a.player.overallPick !== b.player.overallPick) {
    return a.player.overallPick - b.player.overallPick;
  }
  return a.player.playerId.localeCompare(b.player.playerId);
}

/**
 * Fills the nine starting slots for maximum projected points.
 *
 * Dedicated slots first, then FLEX — see the proof in the header, and note that
 * this must NOT follow `lineupSlots()` order, which prints FLEX before TE.
 */
function bestLineup(roster: Candidate[]): {
  starters: ProjectedStarter[];
  benchCandidates: Candidate[];
} {
  const slots = lineupSlots();
  const used = new Set<string>();

  const available = [...roster].sort(byValue);
  const take = (eligible: readonly string[]): Candidate | null => {
    for (const c of available) {
      if (used.has(c.player.playerId)) continue;
      if (!eligible.includes(c.player.position)) continue;
      used.add(c.player.playerId);
      return c;
    }
    return null;
  };

  const filled = new Map<number, Candidate | null>();

  slots.forEach((slot, i) => {
    if (slot.eligible.length === 1) filled.set(i, take(slot.eligible));
  });
  slots.forEach((slot, i) => {
    if (slot.eligible.length !== 1) filled.set(i, take(slot.eligible));
  });

  const starters: ProjectedStarter[] = slots.map((slot, i) => {
    const c = filled.get(i) ?? null;
    if (!c) {
      return {
        slot: slot.slot,
        label: slot.label,
        playerId: null,
        name: null,
        position: null,
        points: 0,
        projected: false,
        viaKeeper: false,
      };
    }
    return {
      slot: slot.slot,
      label: slot.label,
      playerId: c.player.playerId,
      name: c.player.name,
      position: c.player.position,
      points: round1(c.points),
      projected: c.projected,
      viaKeeper: c.player.source === "keeper",
    };
  });

  return {
    starters,
    benchCandidates: roster.filter((c) => !used.has(c.player.playerId)).sort(byValue),
  };
}

// --- Monte Carlo ------------------------------------------------------------

type SimTeam = {
  abbrev: string;
  weeklyMean: number;
  weeklySd: number;
};

type SimResult = {
  wins: Map<string, number>;
  playoffs: Map<string, number>;
  titles: Map<string, number>;
  minWins: Map<string, number>;
  maxWins: Map<string, number>;
  runs: number;
  weeks: number;
};

/**
 * Plays the real schedule `runs` times.
 *
 * Each franchise's weekly score is drawn independently from a normal centred on
 * its season projection spread over `NFL_GAME_WEEKS` and clamped at zero. That
 * is a simplification in three known ways, all of which push toward the middle
 * rather than toward any particular franchise: it ignores bye weeks (already
 * inside a season-long projection), it ignores in-season injury and waiver
 * activity, and it treats teams as independent when they share players' real
 * outcomes not at all but share weather and game scripts a little.
 *
 * Playoff seeding follows the league's own configuration — `LEAGUE.playoffTeams`
 * qualify, ranked on wins and then on total points, which is ESPN's tiebreak
 * and this league's. The bracket is the real one: the top two seeds sit out the
 * first round and the field is reseeded so the top seed always draws the lowest
 * survivor.
 */
function simulateSeason(
  teams: SimTeam[],
  schedule: LeagueSchedule,
  runs: number,
  seed: number,
): SimResult {
  const abbrevs = teams.map((t) => t.abbrev);
  const index = new Map(abbrevs.map((a, i) => [a, i]));

  const games = schedule.games
    .filter((g) => index.has(g.homeAbbrev) && index.has(g.awayAbbrev))
    .map((g) => ({
      week: g.week,
      home: index.get(g.homeAbbrev)!,
      away: index.get(g.awayAbbrev)!,
    }))
    .sort((a, b) => a.week - b.week || a.home - b.home);

  const weeks = new Set(games.map((g) => g.week)).size;

  const wins = new Array(teams.length).fill(0);
  const playoffs = new Array(teams.length).fill(0);
  const titles = new Array(teams.length).fill(0);
  const minWins = new Array(teams.length).fill(Infinity);
  const maxWins = new Array(teams.length).fill(-Infinity);

  const rng = mulberry32(seed);
  const score = (t: SimTeam) => Math.max(0, t.weeklyMean + t.weeklySd * normal(rng));

  const weekNumbers = [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
  const gamesByWeek = weekNumbers.map((w) => games.filter((g) => g.week === w));

  for (let run = 0; run < runs; run++) {
    const runWins = new Array(teams.length).fill(0);
    const runPoints = new Array(teams.length).fill(0);

    for (const week of gamesByWeek) {
      const weekScores = teams.map(score);
      for (let i = 0; i < teams.length; i++) runPoints[i] += weekScores[i];
      for (const g of week) {
        // An exact tie is measure-zero on a continuous draw, but half a win
        // each is the honest handling rather than an arbitrary winner.
        if (weekScores[g.home] > weekScores[g.away]) runWins[g.home] += 1;
        else if (weekScores[g.away] > weekScores[g.home]) runWins[g.away] += 1;
        else {
          runWins[g.home] += 0.5;
          runWins[g.away] += 0.5;
        }
      }
    }

    for (let i = 0; i < teams.length; i++) {
      wins[i] += runWins[i];
      if (runWins[i] < minWins[i]) minWins[i] = runWins[i];
      if (runWins[i] > maxWins[i]) maxWins[i] = runWins[i];
    }

    const seeded = teams
      .map((_, i) => i)
      .sort((a, b) => runWins[b] - runWins[a] || runPoints[b] - runPoints[a] || a - b)
      .slice(0, Math.min(LEAGUE.playoffTeams, teams.length));

    for (const i of seeded) playoffs[i] += 1;

    const champion = playBracket(seeded, teams, score);
    if (champion != null) titles[champion] += 1;
  }

  const toMap = (arr: number[], f: (v: number) => number) =>
    new Map(abbrevs.map((a, i) => [a, f(arr[i])]));

  return {
    wins: toMap(wins, (v) => v / runs),
    playoffs: toMap(playoffs, (v) => v / runs),
    titles: toMap(titles, (v) => v / runs),
    minWins: toMap(minWins, (v) => (Number.isFinite(v) ? v : 0)),
    maxWins: toMap(maxWins, (v) => (Number.isFinite(v) ? v : 0)),
    runs,
    weeks,
  };
}

/**
 * One playoff bracket. `seeded` is in seed order, best first.
 *
 * Byes for however many teams the field leaves over after pairing the rest —
 * with six qualifiers that is the top two, matching `LEAGUE.playoffTeams` and
 * the configured three playoff weeks. Written in terms of the field size so a
 * change to `playoffTeams` does not silently produce a bracket nobody plays.
 */
function playBracket(
  seeded: number[],
  teams: SimTeam[],
  score: (t: SimTeam) => number,
): number | null {
  if (seeded.length === 0) return null;
  if (seeded.length === 1) return seeded[0];

  const play = (a: number, b: number): number => {
    const sa = score(teams[a]);
    const sb = score(teams[b]);
    // Ties go to the better seed, which is what a bracket does.
    return sa >= sb ? a : b;
  };

  const seedOf = new Map(seeded.map((team, i) => [team, i]));

  let field = [...seeded];
  /*
   * Bounded rather than `while (field.length > 1)`. An earlier version of this
   * loop computed "how many play this round" as `(size - advancing) * 2`, which
   * is zero when the field is already a power of two — so a six-team bracket
   * reduced to four and then span forever, taking the whole verification with
   * it. A bracket cannot need more rounds than there are teams, so the bound
   * turns any future arithmetic slip into a wrong answer instead of a hang, and
   * this module is imported by a page the league drafts off.
   */
  for (let round = 0; round < seeded.length && field.length > 1; round++) {
    /*
     * The largest power of two at or below the field size is how many teams
     * come out of this round, so byes land with the top seeds. When the field
     * IS a power of two there are no byes and everybody plays.
     */
    const advancing = 2 ** Math.floor(Math.log2(field.length));
    const playing = field.length === advancing ? field.length : (field.length - advancing) * 2;
    const byes = field.slice(0, field.length - playing);
    const contested = field.slice(field.length - playing);

    const winners: number[] = [];
    for (let i = 0; i < contested.length / 2; i++) {
      winners.push(play(contested[i], contested[contested.length - 1 - i]));
    }
    // Reseed: the top seed always draws the lowest survivor.
    field = [...byes, ...winners].sort((a, b) => seedOf.get(a)! - seedOf.get(b)!);
  }
  return field[0];
}

// --- The entry point --------------------------------------------------------

export type BuildProjectedStandingsInput = {
  /** The finished (or unfinished) board. Read-only. */
  view: DraftRoomView;
  /**
   * Projections keyed by player id, already scored on this league's rules.
   * NULL MEANS NOT AVAILABLE and the function returns null — never a guess.
   */
  projections: ProjectionIndex | null;
  /**
   * A real schedule, or null. Supplying null omits the simulation block; it
   * does not substitute a made-up schedule.
   */
  schedule?: LeagueSchedule | null;
  /** Monte Carlo runs. Ignored without a schedule. */
  runs?: number;
  /** Seed. Fixed by default so the published finish is reproducible. */
  seed?: number;
};

/**
 * The ranked table.
 *
 * Returns null when there are no projections, which is the honest "not pulled"
 * state and the only reason it returns null. Everything else — an unfinished
 * board, a franchise that cannot field nine starters, a player nobody has a
 * number for — comes back as a populated row plus a flag, because a recap of a
 * half-finished draft is legitimate and a thrown error on draft night is not.
 */
export function buildProjectedStandings({
  view,
  projections,
  schedule = null,
  runs = DEFAULT_RUNS,
  seed = DEFAULT_SEED,
}: BuildProjectedStandingsInput): ProjectedStandings | null {
  if (!projections) return null;

  const lineups = buildFranchiseLineups(view);
  const missingProjections: MissingProjection[] = [];

  type Draft = {
    row: Omit<
      ProjectedStandingsRow,
      | "rank"
      | "weakestSlot"
      | "weakestSlotDeficit"
      | "strongestSlot"
      | "strongestSlotSurplus"
      | "opponentStrength"
      | "projectedWins"
      | "projectedLosses"
      | "playoffOdds"
      | "titleOdds"
      | "winsRange"
    >;
  };

  const drafts: Draft[] = lineups.map((lineup) => {
    const rostered: LineupPlayer[] = [
      ...lineup.starters.map((s) => s.player).filter((p): p is LineupPlayer => p != null),
      ...lineup.bench,
      ...lineup.overflow,
    ];

    const roster: Candidate[] = rostered.map((player) => {
      const hit = projections.byPlayerId.get(player.playerId);
      return { player, points: hit?.points ?? 0, projected: hit != null };
    });

    const { starters, benchCandidates } = bestLineup(roster);
    const startingIds = new Set(
      starters.map((s) => s.playerId).filter((id): id is string => id != null),
    );

    for (const c of roster) {
      if (c.projected) continue;
      missingProjections.push({
        teamId: lineup.team.id,
        teamName: lineup.team.name,
        playerName: c.player.name,
        position: c.player.position,
        inStartingLineup: startingIds.has(c.player.playerId),
        viaKeeper: c.player.source === "keeper",
      });
    }

    const projectedPoints = round1(starters.reduce((n, s) => n + s.points, 0));
    const benchPoints = round1(benchCandidates.reduce((n, c) => n + c.points, 0));
    const bestBenchPoints = round1(benchCandidates[0]?.points ?? 0);

    /*
     * What one injury costs. The best starter is removed and the best bench
     * player ELIGIBLE FOR HIS SLOT steps in — not simply the best bench player,
     * because a spare quarterback does not replace a wide receiver. FLEX
     * eligibility is respected via the same slot table the lineup uses.
     */
    const bestStarter = [...starters]
      .filter((s) => s.playerId != null)
      .sort((a, b) => b.points - a.points)[0];
    let replacementGap = 0;
    if (bestStarter) {
      const slotDef = lineupSlots().find((s) => s.label === bestStarter.label);
      const eligible = slotDef?.eligible ?? [bestStarter.position ?? ""];
      const stand = benchCandidates.find((c) => eligible.includes(c.player.position));
      replacementGap = round1(bestStarter.points - (stand?.points ?? 0));
    }

    const starterPoints = starters
      .filter((s) => s.playerId != null)
      .map((s) => s.points)
      .sort((a, b) => b - a);

    const topHeavyShare =
      projectedPoints > 0
        ? round3((starterPoints[0] ?? 0) + (starterPoints[1] ?? 0)) / projectedPoints
        : null;

    /*
     * Normalised Herfindahl over the starters. Raw HHI runs from 1/n to 1, so
     * it is rescaled to 0-1 — otherwise a perfectly balanced nine-man lineup
     * would read as 0.11 "fragile", which invites exactly the misreading the
     * number exists to prevent.
     */
    let fragility: number | null = null;
    if (projectedPoints > 0 && starterPoints.length > 1) {
      const hhi = starterPoints.reduce((n, p) => n + (p / projectedPoints) ** 2, 0);
      const floor = 1 / starterPoints.length;
      fragility = round3(Math.max(0, (hhi - floor) / (1 - floor)));
    }

    const byPositionPoints: Record<string, number> = {};
    for (const s of starters) {
      if (!s.position) continue;
      byPositionPoints[s.position] = round1((byPositionPoints[s.position] ?? 0) + s.points);
    }

    const overConcentration = Object.entries(lineup.byPosition)
      .map(([position, rostered_]) => {
        const startable = startableCount(position);
        return { position, rostered: rostered_, startable, surplus: rostered_ - startable };
      })
      .filter((r) => r.surplus > 0)
      .sort((a, b) => b.surplus - a.surplus || a.position.localeCompare(b.position));

    const keeperPoints = round1(
      starters.filter((s) => s.viaKeeper).reduce((n, s) => n + s.points, 0),
    );

    return {
      row: {
        teamId: lineup.team.id,
        teamName: lineup.team.name,
        franchiseName: lineup.team.franchiseName,
        abbrev: lineup.team.abbrev,
        manager: lineup.team.manager,
        draftSlot: lineup.team.slot,
        projectedPoints,
        starters,
        benchPoints,
        bestBenchPoints,
        replacementGap,
        openStarterLabels: starters.filter((s) => s.playerId == null).map((s) => s.label),
        unprojectedStarters: starters
          .filter((s) => s.playerId != null && !s.projected)
          .map((s) => s.name!)
          .sort((a, b) => a.localeCompare(b)),
        zeroProjectedStarters: starters
          .filter((s) => s.playerId != null && s.projected && s.points === 0)
          .map((s) => s.name!)
          .sort((a, b) => a.localeCompare(b)),
        topHeavyShare: topHeavyShare != null ? round3(topHeavyShare) : null,
        fragility,
        byPositionPoints,
        overConcentration,
        keeperCount: lineup.keeperCount,
        keeperPoints,
        keeperShare: projectedPoints > 0 ? round3(keeperPoints / projectedPoints) : null,
        rosterSize: lineup.rosterSize,
      },
    };
  });

  // --- Slot strength against the rest of the league ------------------------

  /*
   * Computed across all ten franchises, which is why it cannot live in the map
   * above: "weakest slot" is a comparative claim and needs the league mean for
   * the same slot label before it means anything.
   */
  const slotMeans = new Map<string, number>();
  for (const label of lineupSlots().map((s) => s.label)) {
    const values = drafts
      .map((d) => d.row.starters.find((s) => s.label === label))
      .filter((s): s is ProjectedStarter => s != null && s.playerId != null)
      .map((s) => s.points)
      /*
       * Sorted before summing, which is not tidiness. Floating-point addition
       * is not associative, so totalling these in `view.teams` order made the
       * mean differ in its last bits when the same board arrived with its
       * franchises in a different sequence — enough to push a deficit across a
       * rounding boundary and rename a franchise's weakest slot. Sorting makes
       * the sum a function of the multiset rather than of the caller.
       * `verify:projections` feeds the board in shuffled to hold this.
       */
      .sort((a, b) => a - b);
    if (values.length > 0) {
      slotMeans.set(label, values.reduce((n, v) => n + v, 0) / values.length);
    }
  }

  // --- Simulation ---------------------------------------------------------

  /*
   * Sorted by abbreviation, and that is load-bearing rather than tidy.
   *
   * Each franchise draws its weekly score from a shared seeded generator, so
   * the ORDER the teams are drawn in decides which numbers each one gets. Built
   * in `view.teams` order, the simulated win totals moved whenever the board
   * arrived with its franchises in a different sequence — the ranking held,
   * because that is decided by points, but playoff odds shifted by a point or
   * two between callers. `verify:projections` caught it by feeding the same
   * board in shuffled. Abbreviations are unique and fixed, so sorting on them
   * pins the draw order to the league rather than to the caller.
   */
  const simTeams: SimTeam[] = drafts
    .map((d) => ({
      abbrev: d.row.abbrev,
      weeklyMean: d.row.projectedPoints / NFL_GAME_WEEKS,
      weeklySd: (d.row.projectedPoints / NFL_GAME_WEEKS) * WEEKLY_VOLATILITY,
    }))
    .sort((a, b) => a.abbrev.localeCompare(b.abbrev));

  const usableSchedule =
    schedule && schedule.games.length > 0 && runs > 0
      ? scheduleCoveringAll(schedule, simTeams.map((t) => t.abbrev))
      : null;

  const sim = usableSchedule ? simulateSeason(simTeams, usableSchedule, runs, seed) : null;

  const pointsByAbbrev = new Map(drafts.map((d) => [d.row.abbrev, d.row.projectedPoints]));
  const opponentStrength = new Map<string, number>();
  if (usableSchedule) {
    const opponents = new Map<string, number[]>();
    for (const g of usableSchedule.games) {
      const h = pointsByAbbrev.get(g.homeAbbrev);
      const a = pointsByAbbrev.get(g.awayAbbrev);
      if (h == null || a == null) continue;
      (opponents.get(g.homeAbbrev) ?? opponents.set(g.homeAbbrev, []).get(g.homeAbbrev)!).push(a);
      (opponents.get(g.awayAbbrev) ?? opponents.set(g.awayAbbrev, []).get(g.awayAbbrev)!).push(h);
    }
    for (const [abbrev, values] of opponents) {
      opponentStrength.set(abbrev, round1(values.reduce((n, v) => n + v, 0) / values.length));
    }
  }

  // --- Rank ---------------------------------------------------------------

  /*
   * Sorted on the ROUNDED points, so the order matches the printed number.
   * Bench points then draft slot break ties; draft slots are unique, so the
   * comparator is a total order and `sort` stability is never load-bearing.
   */
  const ordered = [...drafts].sort(
    (a, b) =>
      b.row.projectedPoints - a.row.projectedPoints ||
      b.row.benchPoints - a.row.benchPoints ||
      a.row.draftSlot - b.row.draftSlot,
  );

  const rows: ProjectedStandingsRow[] = ordered.map((d, i) => {
    let weakestSlot: string | null = null;
    let weakestSlotDeficit: number | null = null;
    let strongestSlot: string | null = null;
    let strongestSlotSurplus: number | null = null;

    for (const s of d.row.starters) {
      const mean = slotMeans.get(s.label);
      if (mean == null || s.playerId == null) continue;
      const delta = s.points - mean;
      if (weakestSlotDeficit == null || -delta > weakestSlotDeficit) {
        weakestSlot = s.label;
        weakestSlotDeficit = round1(-delta);
      }
      if (strongestSlotSurplus == null || delta > strongestSlotSurplus) {
        strongestSlot = s.label;
        strongestSlotSurplus = round1(delta);
      }
    }

    const wins = sim?.wins.get(d.row.abbrev) ?? null;

    return {
      rank: i + 1,
      ...d.row,
      weakestSlot,
      weakestSlotDeficit,
      strongestSlot,
      strongestSlotSurplus,
      opponentStrength: opponentStrength.get(d.row.abbrev) ?? null,
      projectedWins: wins != null ? round1(wins) : null,
      projectedLosses: wins != null && sim ? round1(sim.weeks - wins) : null,
      playoffOdds: sim ? round3(sim.playoffs.get(d.row.abbrev) ?? 0) : null,
      titleOdds: sim ? round3(sim.titles.get(d.row.abbrev) ?? 0) : null,
      winsRange: sim
        ? [sim.minWins.get(d.row.abbrev) ?? 0, sim.maxWins.get(d.row.abbrev) ?? 0]
        : null,
    };
  });

  return {
    basis: {
      rankedOn: "projected-points",
      disclaimer:
        "Ranked on projected season points from each franchise's best legal " +
        "starting lineup. Fantasy standings are decided head-to-head over a " +
        "schedule, so this is a measure of roster strength, not a prediction " +
        "of the final table.",
      scoringFormat: SCORING_FORMAT,
      passingTouchdownPoints: SCORING_SPEC.passTd,
      startingLineup: STARTING_LINEUP_LABEL,
      tiebreaks: [
        "Projected points, rounded to one decimal, descending",
        "Total projected bench points, descending",
        "Draft slot, ascending — unique across the ten franchises, so the order is total",
      ],
      projectionsSource: projections.provenance.source,
      projectionsPulledAt: projections.provenance.pulledAt,
      leagueScoredCount: projections.leagueScoredCount,
      vendorScoredCount: projections.vendorScoredCount,
      complete: missingProjections.length === 0,
      allLineupsLegal: rows.every((r) => r.openStarterLabels.length === 0),
    },
    rows,
    missingProjections: missingProjections.sort(
      (a, b) => a.teamName.localeCompare(b.teamName) || a.playerName.localeCompare(b.playerName),
    ),
    simulation:
      sim && usableSchedule
        ? {
            source: usableSchedule.source,
            weeks: sim.weeks,
            games: usableSchedule.games.length,
            runs: sim.runs,
            seed,
            weeklyVolatility: WEEKLY_VOLATILITY,
            note:
              `Monte Carlo over the real ${usableSchedule.season} schedule. Weekly scores ` +
              `are drawn from a normal centred on each franchise's season projection ` +
              `spread over ${NFL_GAME_WEEKS} NFL weeks, with a standard deviation of ` +
              `${Math.round(WEEKLY_VOLATILITY * 100)}% of that mean. Wins and playoff ` +
              `odds inform the table; they do not set the order.`,
          }
        : null,
  };
}

/**
 * The schedule, but only if it actually covers this league.
 *
 * A schedule naming nine of the ten franchises would silently leave one team
 * with no games and a zero win total, which would read as a catastrophic
 * projection rather than as a broken join. Better to run no simulation at all.
 */
function scheduleCoveringAll(
  schedule: LeagueSchedule,
  abbrevs: string[],
): LeagueSchedule | null {
  const seen = new Set<string>();
  for (const g of schedule.games) {
    seen.add(g.homeAbbrev);
    seen.add(g.awayAbbrev);
  }
  return abbrevs.every((a) => seen.has(a)) ? schedule : null;
}

/** Total starting slots, re-exported so a caller need not reach past this. */
export { STARTER_COUNT };

/** Roster cap, for a UI printing "16 / 16" beside a projection. */
export const PROJECTION_ROSTER_CAP: number = ROSTER.activeCap;

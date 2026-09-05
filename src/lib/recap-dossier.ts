/**
 * The case file the recap is argued from — every number a blurb is allowed to
 * cite, worked out here so that no model ever has to work one out.
 *
 * WHY THE ARITHMETIC IS DONE IN TYPESCRIPT AND NOT IN THE PROMPT.
 *
 * The recap's whole claim on the room's attention is that it is RIGHT. A blurb
 * that calls a fair-value pick a two-round reach is not a joke that landed
 * badly, it is the feature discrediting itself in front of ten people who can
 * see the board. So every comparison a blurb can make is precomputed and handed
 * over finished: the model's job is the sentence, never the subtraction.
 *
 * THE NUMBERS ARE KEEPER-ADJUSTED, AND THAT IS THE WHOLE TRICK.
 *
 * `expectedPick` here is `@/lib/expected-pick`'s output: a REAL SLOT ON THIS
 * BOARD, arrived at by ranking the pool with kept players removed and mapping
 * the nth-ranked available player onto the nth actually-draftable slot. It is
 * already in the same unit as `overallPick`, which is what makes `gap` mean
 * anything. Read that module's header before touching any of this — in
 * particular, the reason the correction is a RANKING problem and not a matter
 * of subtracting a keeper count from an ADP.
 *
 * The consequence for this file: `rawAdp` is carried alongside every pick for
 * flavour and context only, and is labelled as the generic-league number it is.
 * Nothing here compares it to a pick number, and the prompt tells the model not
 * to either.
 *
 * TWO MEASURES OF VALUE, AND THEY ARE NOT INTERCHANGEABLE.
 *
 * There are two different questions here and each needs its own baseline. They
 * were briefly answered on one, which produced a card whose blurb and whose
 * receipt disagreed about the same keeper — so they now carry names that cannot
 * be read as the same thing:
 *
 *   `DossierPick.slotsVsBoard`  "was this PICK a reach or a steal?" The
 *      counterfactual is the board that actually existed, with the kept players
 *      already gone. Baseline: `expectedPick`, keeper-adjusted.
 *
 *   `DossierKeeper.slotsSavedByKeeping`  "was this KEEPER a good price?" The
 *      counterfactual is that this franchise released him — everyone else's
 *      keepers still standing, his slot back in the draft. Baseline:
 *      `pickIfReleased`.
 *
 * Both are in board slots and both are positive-is-good, which is exactly why
 * they are easy to conflate and exactly why they must never be subtracted from
 * one another or compared across a sentence.
 *
 * THE KEEPER COUNT IS DERIVED, NEVER ASSERTED.
 *
 * `keepersOutOfPool` is counted off the assembled board with the same predicate
 * `buildExpectedPicks` filters on, so the figure a blurb quotes is by
 * construction the figure the expectation was computed against.
 *
 * This is not defensive programming, it is the lesson of every count this
 * league has argued about. The room snapshot, the resolved keeper JSON and the
 * declarations overflow have each been the freshest source at some point and
 * each has been stale at another, and the arithmetic of adding two of them
 * together has already produced a wrong answer once. No number is written down
 * here, in a comment or in code. Whatever the board carries when the recap is
 * generated is what the recap says.
 *
 * Pure and I/O-free, in the manner of the rest of `@/lib`. It takes a finished
 * room view and returns a JSON-serialisable document; it does not know that an
 * LLM exists.
 */

import {
  KEEPERS,
  ROSTER,
  SCORING_FORMAT,
  STARTING_LINEUP,
  isPostDraftSlot,
} from "@/lib/league-config";
import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildFranchiseLineups } from "@/lib/roster-lineup";
import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";

/** How many of each extreme the league-wide lists carry. */
const EXTREMES = 5;
/** Below this a gap is expectation noise, not a decision. Matches the board. */
const NOTABLE_GAP = 12;
/** Consecutive picks at one position before it counts as a run. */
const RUN_LENGTH = 4;
/** Per franchise. Sixteen eligible names is a wall; the top few are the story. */
const PASSED_KEEPERS_SHOWN = 5;
/**
 * Where "early" stops, for the capital concentration count.
 *
 * Six because that is where this league's keeper costs run out — the latest
 * keeper on the board sits inside it — and because rounds 1-6 are the picks
 * managers actually traded for. Stated as data on every `pickCapital` so a
 * blurb or a card never has to know the constant.
 */
const EARLY_ROUNDS = 6;
/**
 * How many of the board's best available players the top-talent window covers.
 *
 * Two rounds' worth of draftable slots. Wide enough that owning two of them is
 * a real edge, narrow enough that most franchises own one or none, which is
 * what makes the figure worth printing.
 */
const TOP_TALENT_WINDOW = 20;
/** Named in the receipt. More than three is a list, not a joke. */
const TOP_TALENT_NAMED = 3;

export type DossierPick = {
  /** "4.06" — what the room calls the pick. */
  label: string;
  round: number;
  overallPick: number;
  player: string;
  position: string;
  nflTeam: string | null;
  /**
   * Consensus ADP as the feed reports it: a generic-league number, NOT a slot
   * on this board. Present for colour only. Never subtract it from anything.
   */
  rawAdp: number | null;
  /** Keeper-adjusted expected slot on THIS board. Comparable to `overallPick`. */
  expectedPick: number | null;
  /**
   * `expectedPick - overallPick`. POSITIVE MEANS REACH — taken earlier than he
   * could have been had for. Negative means he lasted, which is a steal.
   */
  slotsVsBoard: number | null;
  /** The franchise the slot came from, when it was acquired in a trade. */
  acquiredFrom: string | null;
};

export type DossierKeeper = {
  player: string;
  position: string;
  /** The round the keeper costs, which is also the round he sits in. */
  costRound: number;
  /** Board cell the keeper occupies, and therefore the pick it consumed. */
  label: string;
  costOverallPick: number;
  /** Consensus ADP. Generic-league colour, as everywhere else. */
  rawAdp: number | null;
  /**
   * Where THIS BOARD would have taken him had this franchise not kept him —
   * everybody else's keepers standing, his own slot back in the draft. The
   * keeper measure. See `pickIfReleased()`.
   */
  pickIfReleased: number | null;
  /**
   * `costOverallPick - pickIfReleased`, in board slots. POSITIVE MEANS KEEPING
   * HIM SAVED THAT MANY SLOTS: he cost a pick later than the one it would have
   * taken to draft him back. Negative means the franchise is paying ahead of
   * what redrafting him would have cost.
   *
   * NOT comparable to `DossierPick.slotsVsBoard` — different question, different
   * baseline. See the two-measures note in the file header.
   */
  slotsSavedByKeeping: number | null;
};

/** A player a franchise could have kept and didn't. */
export type PassedKeeper = {
  player: string;
  position: string;
  /** What keeping him would have cost, in rounds. */
  costRound: number;
  /** Where he actually went on this board, or null if he went undrafted. */
  draftedAtLabel: string | null;
  draftedAtRound: number | null;
  draftedAtOverallPick: number | null;
  /** Franchise that ended up with him. Null if nobody did. */
  draftedBy: string | null;
  /**
   * `costRound - draftedAtRound`. POSITIVE MEANS THE PASS WAS A MISTAKE: he
   * could have been kept for a later round than the one he actually went in.
   * Null when he went undrafted, which is its own verdict — nobody wanted him.
   */
  roundsCheaperToKeep: number | null;
};

/**
 * What a franchise walked into the draft holding, and how that compares.
 *
 * WHY THIS IS NOT `draftCapital` AND WHY BOTH STAY.
 *
 * `draftCapital` answers "could this manager draft at all, and when" — a first
 * pick, a list of rounds he is blank in. It was enough while the story was
 * Stefan having no first-rounder. It is not enough for the story the
 * commissioner actually tells about this league, which is CONCENTRATION: Zach
 * walking in with three fourth-rounders is not visible in a count of sixteen
 * picks or in a list of rounds he holds one of.
 *
 * THE COUNT IS NEVER THE STORY, BECAUSE THE COUNT IS ALWAYS SIXTEEN. Trades in
 * this league move ownership, not volume: every franchise holds exactly one
 * pick per round times the round count, and the traded picks net out. So this
 * type carries no "how many picks" figure at all. What it carries is shape —
 * which rounds, doubled up where, bought from whom — and one weighted measure
 * of how much of the board's real talent those slots are expected to reach.
 *
 * KEEPER-CONSUMED SLOTS ARE NOT CAPITAL. A kept player occupies the board cell
 * for his cost round, and that cell cannot be drafted into. Zach owns a
 * sixth-rounder and cannot draft with it, because a keeper is sitting in it.
 * Everything here counts DRAFTABLE slots, and `keeperConsumedRounds` says
 * separately where the rest went — which is the difference between "he has no
 * sixth" and "he spent his sixth on a keeper", and a blurb that mixes those up
 * is a blurb the room catches.
 *
 * THE LEAGUE COMPARISON IS PRECOMPUTED AND IDENTICAL ON ALL TEN. `*LeagueMedian`
 * is the same number on every franchise, carried per franchise on purpose: a
 * model that has to work out a median across ten objects to say "twice the
 * league median" will get it wrong in front of ten people who can check.
 */
export type PickCapital = {
  /** Last round counted as early. Data rather than a constant a caller must know. */
  earlyThroughRound: number;
  /**
   * Rounds this franchise can actually draft in, ascending, WITH REPEATS —
   * `[1, 1, 2, 3, 4, 4, 4, 11, …]` is a franchise with two firsts and three
   * fourths, and the repeats are the whole point.
   */
  draftableRounds: number[];
  /** Rounds where the pick exists but a keeper is sitting in it. Not capital. */
  keeperConsumedRounds: number[];
  /** Rounds holding two or more draftable picks. The shape, stated finished. */
  doubledRounds: { round: number; count: number }[];
  /** Rounds with no draftable pick at all, keeper-consumed ones included. */
  emptyRounds: number[];
  /**
   * Slots that came in from another franchise. `spentOnKeeper` is true where
   * the acquired slot is the one a keeper now occupies, which turns "he bought
   * a sixth" into "he bought a sixth and put a keeper in it".
   */
  acquired: { round: number; from: string; spentOnKeeper: boolean }[];
  /** Own slots that went out. Named, because the other side is a receipt too. */
  surrendered: { round: number; to: string }[];
  /** Draftable picks in rounds 1..`earlyThroughRound`. The plain count. */
  earlyPicks: number;
  /** The league median of `earlyPicks`. Same on all ten. */
  earlyPicksLeagueMedian: number;
  /** `earlyPicks - earlyPicksLeagueMedian`. Positive is rich. */
  earlyPicksVsMedian: number;
  /** 1 is the richest early board in the league. Ties share the better rank. */
  earlyCapitalRank: number;
  /** Median overall pick across every draftable slot held. Lower is earlier. */
  medianDraftableOverall: number | null;
  /**
   * THE WEIGHTED MEASURE, and it is `@/lib/expected-pick`'s output rather than
   * a second opinion about it.
   *
   * `buildExpectedPicks` maps the nth-best available player onto the nth slot
   * that can actually be drafted into. So the first `topTalentWindow` draftable
   * slots on the board are, by construction, exactly where the board's best
   * `topTalentWindow` players are expected to go — and counting how many of
   * those slots a franchise owns is a talent-weighted measure of its capital
   * that needs no curve, no invented tier table and no magic constant beyond
   * the window itself.
   *
   * A count of picks in rounds 1-6 says Scott is the richest man in the room.
   * This says whether that money is anywhere near the top of the board.
   */
  topTalentWindow: number;
  topTalentCaptured: number;
  /** Median of `topTalentCaptured` across the league. Same on all ten. */
  topTalentLeagueMedian: number;
  /**
   * The players the keeper-adjusted board expects at those slots, best first
   * and capped. A statement about the BOARD's expectation at a slot, never a
   * claim that this franchise got the man — the draft decides that.
   */
  topTalentPlayers: string[];
  /**
   * Longest run of consecutive rounds with no draftable pick, and the last
   * round before it. A drought is a real story where a blank round is noise.
   */
  longestGapRounds: number;
  longestGapAfterRound: number | null;
};

/** A pick with the franchise attached, for the league-wide lists. */
export type AttributedPick = DossierPick & {
  teamId: string;
  teamName: string;
  manager: string;
};

export type FranchiseDossier = {
  teamId: string;
  /** The handle the league uses — "Witte", "Elbe". Address managers by this. */
  teamName: string;
  franchiseName: string;
  manager: string;
  draftSlot: number;
  keepers: DossierKeeper[];
  /**
   * Players this franchise was entitled to keep and passed on, worst mistake
   * first. Empty when the keeper sheet is unavailable — never a claim that a
   * franchise had no options.
   *
   * CAPPED at `PASSED_KEEPERS_SHOWN`. Read `passedOnKeepersTotal` before
   * characterising this as everything he could have kept; it usually is not.
   */
  passedOnKeepers: PassedKeeper[];
  /**
   * How many players this franchise was entitled to keep in total, before the
   * cap above.
   *
   * Published because a consumer shown five rows out of sixteen will describe
   * them as the whole set, and a recap that says "his options were X, Y and Z"
   * about a third of the list is confidently wrong in a way nobody can see from
   * the payload. The count makes the truncation legible instead.
   */
  passedOnKeepersTotal: number;
  /**
   * Keeper slots this franchise was allowed and did not use.
   *
   * `deliberate` is the field that matters and it is never inferred from the
   * count. True means the manager gave his final answer and chose to leave the
   * slot empty; false means the board simply shows fewer than the maximum,
   * which is not evidence of anything. Roasting a decision is fair. Roasting a
   * man for missing a deadline he did not miss is the sort of mistake that
   * takes the whole recap down with it.
   */
  unusedKeeperSlots: { count: number; deliberate: boolean };
  /**
   * What this franchise actually had to draft with, which trades make wildly
   * uneven and which no other field captures.
   */
  draftCapital: {
    picksHeld: number;
    /** Picks acquired from other franchises, and own picks given away. */
    acquired: number;
    tradedAway: number;
    /** First slot this franchise could actually draft in. */
    firstPickLabel: string | null;
    firstPickOverall: number | null;
    hasFirstRoundPick: boolean;
    /** Rounds this franchise holds no draftable pick in at all. */
    roundsWithNoPick: number[];
  };
  /**
   * The same capital, in shape rather than in count, with the league beside it.
   * See `PickCapital` — in particular why the number of picks is never the
   * story and why keeper-consumed slots are not capital.
   */
  pickCapital: PickCapital;
  /** Every pick this franchise made, in board order. Keepers are not here. */
  picks: DossierPick[];
  /** Furthest a player fell past his expectation. Null if nothing was scored. */
  bestSteal: DossierPick | null;
  worstReach: DossierPick | null;
  /**
   * Slots of value gained across every scored pick, `-gap` summed. POSITIVE IS
   * GOOD: it is how many board slots' worth of player this franchise took
   * beyond what its pick numbers entitled it to.
   */
  valueGained: number;
  /** Mean `gap`. Positive means this franchise reached on average. */
  averageSlotsVsBoard: number;
  scoredPicks: number;
  /** The nine starting slots and who is in each. Null where nobody is. */
  starters: { slot: string; player: string | null; position: string | null }[];
  benchCount: number;
  byPosition: Record<string, number>;
  /** Starting slots nobody can fill — "RB2", "FLEX1". Empty on a full roster. */
  openStarterSlots: string[];
  /** Positions at the league's roster limit. */
  positionsAtCap: string[];
  /** Owned slots still empty. Non-zero means this franchise is not finished. */
  picksRemaining: number;
  /**
   * Roster facts that are strange on their face, stated finished so the model
   * need not derive them — "4 QB rostered; the league starts 1". Empty when a
   * roster is unremarkable, and an empty list is not an invitation to invent.
   */
  oddities: string[];
};

export type PositionRun = {
  position: string;
  /** Consecutive picks at this position, ignoring keeper slots in between. */
  count: number;
  fromOverallPick: number;
  toOverallPick: number;
  /** Franchises that took one, in order. Repeats are real: he went twice. */
  teams: string[];
};

export type PositionWait = {
  position: string;
  teamId: string;
  teamName: string;
  manager: string;
  /** Overall pick of their first one, or null if they never took one at all. */
  firstOverallPick: number | null;
  /** True when it came from a keeper rather than from a decision on the day. */
  viaKeeper: boolean;
};

export type RecapDossier = {
  season: number;
  rounds: number;
  teamCount: number;
  /**
   * Players who never entered the draft because a franchise kept them, counted
   * off the assembled board at generation time. THE ONLY correct figure for
   * this recap — see the header. Cite it; never estimate it.
   */
  keepersOutOfPool: number;
  /** Slots a pick could actually be made in, which is what the expectation maps onto. */
  draftableSlots: number;
  picksEntered: number;
  /** False when owned slots are still empty. A recap of an unfinished board. */
  boardComplete: boolean;
  league: {
    scoringFormat: string;
    /** The one that moves draft value: this league pays 6 for a passing TD. */
    passingTouchdownPoints: number;
    startingLineup: string;
    benchSlots: number;
    rosterCap: number;
    positionalMax: Record<string, number>;
    noKicker: true;
  };
  franchises: FranchiseDossier[];
  /** Best value first. The order the room will argue about. */
  valueLeaderboard: {
    rank: number;
    teamId: string;
    teamName: string;
    manager: string;
    valueGained: number;
    averageSlotsVsBoard: number;
  }[];
  /** Deepest steals of the whole draft, best first. Head of the list is THE steal. */
  biggestSteals: AttributedPick[];
  /** Worst reaches of the whole draft, worst first. Head of the list is THE reach. */
  biggestReaches: AttributedPick[];
  /** Positional runs, longest first. Empty when the draft had none. */
  positionRuns: PositionRun[];
  /**
   * Who went longest without a quarterback, tight end or defence, latest first
   * within each position. A null `firstOverallPick` means they never took one,
   * which is the more damning version.
   */
  positionWaits: PositionWait[];
  /** Mean rostered count per position, so a stack can be measured against the room. */
  leagueAverageByPosition: Record<string, number>;
  /**
   * Projected finish, first to last, computed in TypeScript from season
   * projections and each franchise's best legal starting lineup. Null when the
   * projections snapshot has not been pulled, which is a normal state and not a
   * reason to withhold a recap.
   *
   * THE ORDER IS ON PROJECTED POINTS. Wins and playoff odds come from a Monte
   * Carlo over the real schedule and are carried alongside, but they are not
   * what the ranking sorts by — so a franchise can project third on points and
   * fourth on wins, and saying "projected to finish third" means the points
   * order. `basis.disclaimer` says this in one sentence and is passed through
   * verbatim to both the page and the prompt.
   */
  projectedStandings: {
    basis: ProjectedBasis;
    rows: ProjectedFinish[];
    /** How separated the table actually is. See `ProjectedSpread`. */
    spread: ProjectedSpread;
  } | null;
};

/**
 * How far apart the projected table really is, decided here.
 *
 * WHY THIS IS NOT LEFT TO THE MODEL. The commissioner's brief on this league:
 * "It is a highly competitive league. Competitive as fuck... no one drafts
 * themself out of contention... I expected things to be tight." A model handed
 * ten rows sorted best-to-worst will narrate a hierarchy whether or not one
 * exists — the rank numbers themselves imply separation that four points of
 * projection does not support, and tenth place reads as an obituary when it is
 * in fact a rounding error behind seventh.
 *
 * So the shape of the table is arithmetic like everything else on this page.
 * `shape` is the field a blurb should act on, and it is a stated rule rather
 * than a vibe:
 *
 *   "pack"      — at least half the league sits within one projected win of
 *                 the median AND no single gap dwarfs the rest of the table.
 *                 Margins are tight and the prose must say so.
 *   "tiered"    — a real gap somewhere, and a bunch either side of it. Either
 *                 the pack test failed narrowly, or it passed and `dominantCliff`
 *                 overruled it — a bunched middle is not licence to ignore a
 *                 franchise sitting four hundred points off the end of it.
 *   "separated" — three or fewer franchises are within a win of the median,
 *                 which is a genuinely stratified league.
 *
 * With no schedule there are no simulated wins, so the same test runs on
 * projected points against a band of the median instead, and `basedOn` says
 * which happened. Never present the fallback as though it were the simulation.
 */
export type ProjectedSpread = {
  /** Which currency the shape was decided in. */
  basedOn: "wins" | "points";
  shape: "pack" | "tiered" | "separated";
  /** `projectedPoints`, rank 1 minus rank last. */
  pointsFirstToLast: number;
  /** Median gap between adjacent ranks. The honest measure of separation. */
  medianAdjacentPointsGap: number;
  /** The one real cliff in the table, and the two ranks it falls between. */
  largestAdjacentPointsGap: number;
  largestGapBetweenRanks: [number, number] | null;
  /**
   * True when `largestAdjacentPointsGap` is a genuine cliff rather than the
   * table's ordinary spacing — at least `CLIFF_MULTIPLE` times the typical
   * neighbour gap and at least `pointsBand` in absolute terms.
   *
   * Published rather than left implicit inside `shape` because it is the fact a
   * blurb acts on: it says the seam named by `largestGapBetweenRanks` is worth
   * putting in a sentence. When it is false, that gap is noise and naming it is
   * manufacturing a tier out of rounding.
   */
  dominantCliff: boolean;
  /** Mean wins, first minus last. Null with no schedule. */
  winsFirstToLast: number | null;
  /**
   * Franchises whose mean wins sit within one win of the league median — the
   * count `shape` is decided on. Null with no schedule, where the points band
   * below stands in.
   */
  teamsWithinOneWin: number | null;
  /** Franchises within `pointsBand` of the median projection. */
  pointsBand: number;
  teamsWithinPointsBand: number;
  /**
   * Franchises whose playoff odds are neither close to nothing nor close to
   * certain — genuinely undecided by the projection. Null with no schedule.
   */
  teamsWithLivePlayoffOdds: number | null;
};

/**
 * A franchise's projected finish, computed elsewhere and passed through.
 *
 * Structural rather than imported from `@/lib/projected-standings`, for the
 * same reason `@/lib/expected-pick` takes structural parameters: this module
 * needs four fields and should not acquire a dependency on the shape of a
 * module that is still being built. It also means the dossier keeps working
 * when the projections snapshot has not been pulled — the field is simply
 * absent, and the recap is worth writing without it.
 */
export type ProjectedFinish = {
  rank: number;
  teamId: string;
  teamName: string;
  manager: string;
  /** Season points from the best legal starting lineup. What the rank is on. */
  projectedPoints: number;
  /** Mean wins over the Monte Carlo. Null when no real schedule was found. */
  projectedWins: number | null;
  projectedLosses: number | null;
  /** Share of simulated seasons reaching the playoffs, 0–1. Null as above. */
  playoffOdds: number | null;
  titleOdds: number | null;
  /** The starting slot dragging this roster down, measured against its peers. */
  weakestSlot: string | null;
  weakestSlotDeficit: number | null;
  /** Share of the projection resting on the top two starters, 0–1. */
  topHeavyShare: number | null;
  /** Share resting on kept players, 0–1. */
  keeperShare: number | null;
  /**
   * Starters the feed projects at exactly zero, by name. A starting slot
   * contributing nothing is specific, true and funny — but it is as often a
   * hole in the feed as a verdict on the player, so it is carried as a fact
   * about the projection rather than as a fact about the man.
   */
  zeroProjectedStarters: string[];
  /** Starters with no projection at all. A join failure, not an opinion. */
  unprojectedStarters: string[];
};

/** What the projected table is, stated so nothing downstream has to assume. */
export type ProjectedBasis = {
  rankedOn: string;
  /** Verbatim from the module. Do not paraphrase it away. */
  disclaimer: string;
  projectionsSource: string;
  projectionsPulledAt: string;
  /** True when every rostered player had a projection. */
  complete: boolean;
  /** Present only when a real schedule backed the simulation. */
  simulation: { source: string; weeks: number; games: number; runs: number } | null;
};

/** Positions where waiting is a decision worth naming. */
const WAIT_POSITIONS = ["QB", "TE", "DST"];

/** Above this a franchise is hoarding a position the league starts one of. */
const STACK_THRESHOLD: Record<string, number> = { QB: 3, TE: 3, DST: 2 };

/**
 * Where ONE keeper would have gone if his franchise had not kept him.
 *
 * ============================================================================
 * THIS IS A DIFFERENT QUESTION FROM `expectedPick` AND THE TWO MUST NOT BE
 * MIXED. See the note on the two measures in the file header.
 * ============================================================================
 *
 * The realistic counterfactual to keeping a player is narrow: THIS franchise
 * declines THIS player, everybody else's keepers stand, and the slot he would
 * have occupied goes back into the draft. So that is exactly what is modelled —
 * his keeper flag is cleared and nobody else's is, which puts him back in the
 * ranked pool and adds one slot to the draftable list. Same `buildExpectedPicks`
 * as everywhere else; only the premise changes.
 *
 * An earlier version cleared ALL the keeper flags at once and priced every
 * keeper against a draft in which nobody was kept. That was wrong, and wrong in
 * a way that showed: it described a board that never existed, deepened the pool
 * by nineteen players nobody had to compete with, and reported Greg's two
 * keepers as costing him eight and nine slots when they in fact saved him four
 * apiece. A blurb quoting the true figure then contradicted the receipt printed
 * beside it.
 *
 * One ranking per keeper, nineteen of them. Each is over a few hundred players
 * and costs nothing worth measuring.
 */
function pickIfReleased(
  view: DraftRoomView,
  slotId: string,
  playerId: string,
  pool: readonly { id: string; name: string; adp: number | null }[],
): number | null {
  const expected = buildExpectedPicks(
    pool,
    view.slots.map((s) => (s.id === slotId ? { ...s, isKeeper: false } : s)),
  );
  return expected[playerId] ?? null;
}

/** Playoff odds this far from 0 and 1 are a coin toss, not a projection. */
const LIVE_ODDS_BAND = [0.2, 0.8] as const;
/** Wins within this of the median count as part of the pack. */
const PACK_WINS_BAND = 1;
/** Share of the median projection that counts as the same tier on points. */
const PACK_POINTS_BAND = 0.05;

/**
 * How many times the typical neighbour gap a single gap must be before it
 * counts as a cliff rather than as the table's ordinary spacing.
 *
 * ============================================================================
 * WHY THE PACK TEST ALONE WAS NOT ENOUGH, WITH THE BOARDS THAT PROVED IT
 * ============================================================================
 *
 * `teamsWithinOneWin` asks whether the MIDDLE of the table is bunched. It is a
 * good question and it is not the only one, because a board can have a bunched
 * middle and still contain the single most quotable fact of the night at one
 * end of it. Redealing a finished board through `verify:recap:spread` produces
 * exactly that, repeatedly:
 *
 *   · nine franchises inside 280 points and a tenth 448 adrift — 8 within a win
 *     of the median, so "pack";
 *   · a runaway leader 620 points clear of second — 9 within a win, so "pack";
 *   · two franchises tied at the top and a 462-point drop to third — 6 within a
 *     win, so "pack".
 *
 * On all three the prompt then required the model to SAY the field was bunched
 * and gave it no licence to name the cliff, which is the recap declining to
 * mention the one thing everybody in the room can already see. That is the
 * failure this feature exists to avoid, arriving from the opposite direction to
 * the one the pack rule was written for.
 *
 * The `"tiered"` shape was always documented as "a real gap somewhere, and a
 * bunch either side of it" and was never actually computed that way — it was
 * whatever fell between the pack and separated counts, which for ten teams is
 * the single value four. So a cliff now downgrades a pack to `"tiered"`, which
 * makes the label mean what it always said it meant, and `"tiered"` reachable
 * by the boards it was named for.
 *
 * BOTH TESTS MUST PASS, and they are independent on purpose. The multiple stops
 * an evenly-spaced ladder reading as a cliff, and the floor stops a freakishly
 * tight table turning an ordinary 40-point gap into one. Today's pre-draft
 * board clears both with room: its largest gap is 53.4 against a typical 26.7,
 * so 2.0× where 3× is needed, and 53.4 points where about 105 are needed. It
 * stays a pack, which is correct, and it would take a genuine change in the
 * board to move it.
 */
const CLIFF_MULTIPLE = 3;

/** Median of a numeric list. Even lengths take the mean of the middle two. */
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : round1((sorted[mid - 1] + sorted[mid]) / 2)!;
}

/**
 * The shape of the projected table, worked out so no blurb has to eyeball it.
 *
 * Rows arrive already sorted on `projectedPoints`, which is what the ranking
 * is; nothing here re-sorts them or disagrees with the order.
 */
function projectedSpread(rows: readonly ProjectedFinish[]): ProjectedSpread {
  const points = rows.map((r) => r.projectedPoints);
  const adjacent = points.slice(1).map((p, i) => round1(points[i] - p)!);
  const largest = adjacent.length ? Math.max(...adjacent) : 0;
  const largestAt = adjacent.indexOf(largest);

  const pointsMedian = median(points) ?? 0;
  const pointsBand = round1(pointsMedian * PACK_POINTS_BAND)!;
  const teamsWithinPointsBand = points.filter(
    (p) => Math.abs(p - pointsMedian) <= pointsBand,
  ).length;

  const wins = rows
    .map((r) => r.projectedWins)
    .filter((w): w is number => w !== null);
  const simulated = wins.length === rows.length && rows.length > 0;
  const winsMedian = simulated ? (median(wins) ?? 0) : null;
  const teamsWithinOneWin =
    winsMedian === null
      ? null
      : wins.filter((w) => Math.abs(w - winsMedian) <= PACK_WINS_BAND).length;

  const inPack = teamsWithinOneWin ?? teamsWithinPointsBand;
  const half = Math.ceil(rows.length / 2);

  /*
   * One gap that dwarfs the rest of the table. See `CLIFF_MULTIPLE` for the two
   * boards' worth of evidence behind requiring both tests — a bunched middle
   * does not entitle the table to hide a franchise sitting 450 points off it.
   */
  const typicalGap = median(adjacent) ?? 0;
  const dominantCliff =
    largest >= typicalGap * CLIFF_MULTIPLE && largest >= pointsBand && largest > 0;

  const shape: ProjectedSpread["shape"] =
    inPack >= half
      ? dominantCliff
        ? "tiered"
        : "pack"
      : inPack <= 3
        ? "separated"
        : "tiered";

  const odds = rows.map((r) => r.playoffOdds).filter((o): o is number => o !== null);

  return {
    basedOn: teamsWithinOneWin === null ? "points" : "wins",
    shape,
    dominantCliff,
    pointsFirstToLast: round1(points[0] - points[points.length - 1]) ?? 0,
    medianAdjacentPointsGap: median(adjacent) ?? 0,
    largestAdjacentPointsGap: largest,
    // Adjacent gap i sits between ranks i+1 and i+2.
    largestGapBetweenRanks: largestAt < 0 ? null : [largestAt + 1, largestAt + 2],
    winsFirstToLast: simulated ? round1(wins[0] - wins[wins.length - 1]) : null,
    teamsWithinOneWin,
    pointsBand,
    teamsWithinPointsBand,
    teamsWithLivePlayoffOdds: odds.length
      ? odds.filter((o) => o >= LIVE_ODDS_BAND[0] && o <= LIVE_ODDS_BAND[1]).length
      : null,
  };
}

/**
 * Every franchise's pick-capital profile, league comparisons filled in.
 *
 * One pass over the board rather than one per franchise, and the medians and
 * ranks are attached before anything is returned, so no caller can end up
 * holding a profile that knows its own figure and not the league's.
 *
 * `expectedPick` is taken as an argument and used as given. The top-talent
 * window relies on the invariant that `buildExpectedPicks` maps the nth-best
 * available player onto the nth draftable slot; the mapping is read back off
 * its output rather than recomputed here, which is what keeps this measure and
 * every `slotsVsBoard` on the same board.
 */
function pickCapitalByTeam({
  view,
  expectedPick,
  pool,
}: {
  view: DraftRoomView;
  expectedPick: Record<string, number | null>;
  pool: readonly { id: string; name: string; adp: number | null }[];
}): Map<string, PickCapital> {
  const draftableOverall = view.slots
    .filter((s) => !s.isKeeper)
    .map((s) => s.overallPick)
    .sort((a, b) => a - b);
  const topTalentSlots = new Set(draftableOverall.slice(0, TOP_TALENT_WINDOW));

  /*
   * Slot number to the player the board expects there. Sound because
   * `buildExpectedPicks` hands the nth-ranked available player the nth
   * draftable slot number verbatim, so inside the window this is a bijection
   * and no two players can claim the same slot.
   */
  const expectedAt = new Map<number, string>();
  for (const p of pool) {
    const slot = expectedPick[p.id];
    if (slot == null || !topTalentSlots.has(slot)) continue;
    expectedAt.set(slot, p.name);
  }

  type Raw = Omit<
    PickCapital,
    | "earlyPicksLeagueMedian"
    | "earlyPicksVsMedian"
    | "earlyCapitalRank"
    | "topTalentLeagueMedian"
  >;

  const raw = new Map<string, Raw>(
    view.teams.map((team) => {
      const held = view.slots
        .filter((s) => s.currentOwner.id === team.id)
        .sort((a, b) => a.overallPick - b.overallPick);
      const draftable = held.filter((s) => !s.isKeeper);
      const keeperConsumed = held.filter((s) => s.isKeeper);

      const perRound = new Map<number, number>();
      for (const s of draftable) perRound.set(s.round, (perRound.get(s.round) ?? 0) + 1);

      const allRounds = Array.from({ length: view.rounds }, (_, i) => i + 1);
      const emptyRounds = allRounds.filter((r) => !perRound.has(r));

      // Longest run of consecutive empty rounds, and the round it starts after.
      let longestGapRounds = 0;
      let longestGapAfterRound: number | null = null;
      let run = 0;
      for (const r of allRounds) {
        if (perRound.has(r)) {
          run = 0;
          continue;
        }
        run += 1;
        if (run > longestGapRounds) {
          longestGapRounds = run;
          longestGapAfterRound = r - run;
        }
      }

      const talent = draftable.filter((s) => topTalentSlots.has(s.overallPick));

      return [
        team.id,
        {
          earlyThroughRound: EARLY_ROUNDS,
          draftableRounds: draftable.map((s) => s.round),
          keeperConsumedRounds: keeperConsumed.map((s) => s.round),
          doubledRounds: [...perRound]
            .filter(([, count]) => count > 1)
            .sort((a, b) => a[0] - b[0])
            .map(([round, count]) => ({ round, count })),
          emptyRounds,
          acquired: held
            .filter((s) => s.originalOwner.id !== team.id)
            .map((s) => ({
              round: s.round,
              from: s.originalOwner.name,
              spentOnKeeper: s.isKeeper,
            })),
          surrendered: view.slots
            .filter((s) => s.originalOwner.id === team.id && s.currentOwner.id !== team.id)
            .sort((a, b) => a.round - b.round)
            .map((s) => ({ round: s.round, to: s.currentOwner.name })),
          earlyPicks: draftable.filter((s) => s.round <= EARLY_ROUNDS).length,
          medianDraftableOverall: median(draftable.map((s) => s.overallPick)),
          topTalentWindow: TOP_TALENT_WINDOW,
          topTalentCaptured: talent.length,
          topTalentPlayers: talent
            .map((s) => expectedAt.get(s.overallPick))
            .filter((n): n is string => n !== undefined)
            .slice(0, TOP_TALENT_NAMED),
          longestGapRounds,
          longestGapAfterRound,
        } satisfies Raw,
      ];
    }),
  );

  const rows = [...raw.values()];
  const earlyMedian = median(rows.map((r) => r.earlyPicks)) ?? 0;
  const talentMedian = median(rows.map((r) => r.topTalentCaptured)) ?? 0;
  const earlyDescending = [...rows].map((r) => r.earlyPicks).sort((a, b) => b - a);

  return new Map(
    [...raw].map(([teamId, r]) => [
      teamId,
      {
        ...r,
        earlyPicksLeagueMedian: earlyMedian,
        earlyPicksVsMedian: round1(r.earlyPicks - earlyMedian)!,
        // Ties share the better rank: two men with five early picks are both
        // second, and neither can be called "fourth in the room" for it.
        earlyCapitalRank: earlyDescending.indexOf(r.earlyPicks) + 1,
        topTalentLeagueMedian: talentMedian,
      },
    ]),
  );
}

export function buildRecapDossier({
  view,
  expectedPick,
  pool,
  keeperOptions = [],
  closedKeeperLists = [],
  projectedStandings = null,
}: {
  view: DraftRoomView;
  /**
   * From `buildExpectedPicks`. Slot numbers on this board, already
   * keeper-adjusted. Not ADP, and not interchangeable with it.
   */
  expectedPick: Record<string, number | null>;
  pool: readonly { id: string; name: string; adp: number | null }[];
  /**
   * Who each franchise was entitled to keep, from `readKeeperOptions`. Optional
   * because the dossier is worth building without it and because a pure module
   * must not go looking for a file.
   */
  keeperOptions?: readonly { manager: string; player: string; position: string; costRound: number }[];
  /**
   * Managers who closed a short keeper list on purpose, from
   * `readClosedKeeperLists`. Absent means "nobody is known to have", which is
   * deliberately weaker than "nobody did".
   */
  closedKeeperLists?: readonly { manager: string }[];
  /**
   * From `@/lib/projected-standings`, when its snapshot exists. Passed in
   * rather than computed: this module is pure and the projections come off
   * disk. Structurally typed and trimmed on the way in — the module's rows
   * carry every starter's projection, which the board already knows and a
   * prompt does not need.
   */
  projectedStandings?: {
    basis: ProjectedBasis;
    rows: readonly ProjectedFinish[];
  } | null;
}): RecapDossier {
  const adpById = new Map(pool.map((p) => [p.id, p.adp]));
  const lineups = new Map(buildFranchiseLineups(view).map((l) => [l.team.id, l]));
  const capital = pickCapitalByTeam({ view, expectedPick, pool });

  /*
   * Every player already on the board, by name, so a passed-over keeper can be
   * told where he actually ended up. Matched on name rather than on id: the
   * keeper sheet is a spreadsheet export and carries no player ids at all.
   */
  const onBoard = new Map(
    view.slots
      .filter((s) => s.player)
      .map((s) => [
        normalizeName(s.player!.name),
        { slot: s, owner: s.currentOwner.name },
      ]),
  );
  const keptNames = new Set(
    view.slots
      .filter((s) => s.isKeeper && s.player)
      .map((s) => normalizeName(s.player!.name)),
  );

  /*
   * The same predicate `buildExpectedPicks` filters keepers with. Deriving both
   * from the slots is what guarantees the count a blurb quotes is the count the
   * expectation was built against, whatever the declaration files happen to say.
   */
  const keeperSlots = view.slots.filter((s) => s.isKeeper && s.player);
  const draftableSlots = view.slots.filter((s) => !s.isKeeper).length;

  const toPick = (slot: LiveSlot): DossierPick => {
    const expected = expectedPick[slot.player!.id] ?? null;
    return {
      label: slot.label,
      round: slot.round,
      overallPick: slot.overallPick,
      player: slot.player!.name,
      position: slot.player!.position,
      nflTeam: slot.player!.nflTeam,
      rawAdp: round1(adpById.get(slot.player!.id) ?? null),
      expectedPick: expected === null ? null : Math.round(expected),
      slotsVsBoard: expected === null ? null : Math.round(expected - slot.overallPick),
      acquiredFrom: slot.traded ? slot.originalOwner.name : null,
    };
  };

  const franchises: FranchiseDossier[] = view.teams.map((team) => {
    const held = view.slots
      .filter((s) => s.currentOwner.id === team.id)
      .sort((a, b) => a.overallPick - b.overallPick);

    const picks = held
      .filter((s) => s.player && s.fill === "pick")
      .map(toPick);

    const keepers: DossierKeeper[] = held
      .filter((s) => s.player && s.fill === "keeper")
      .map((s) => {
        const released = pickIfReleased(view, s.id, s.player!.id, pool);
        return {
          player: s.player!.name,
          position: s.player!.position,
          costRound: s.round,
          label: s.label,
          costOverallPick: s.overallPick,
          rawAdp: round1(adpById.get(s.player!.id) ?? null),
          pickIfReleased: released === null ? null : Math.round(released),
          slotsSavedByKeeping:
            released === null ? null : Math.round(s.overallPick - released),
        };
      });

    const draftableHeld = held.filter((s) => !s.isKeeper);
    const roundsHeld = new Set(draftableHeld.map((s) => s.round));

    const scored = picks.filter((p) => p.slotsVsBoard !== null);
    const lineup = lineups.get(team.id);
    const byPosition = lineup?.byPosition ?? {};

    return {
      teamId: team.id,
      teamName: team.name,
      franchiseName: team.franchiseName,
      manager: team.manager,
      draftSlot: team.slot,
      keepers,
      passedOnKeepers: passedOn(team.name, keeperOptions, keptNames, onBoard),
      passedOnKeepersTotal: passedOnCount(team.name, keeperOptions, keptNames),
      unusedKeeperSlots: {
        count: Math.max(0, KEEPERS.maxPerTeam - keepers.length),
        deliberate: closedKeeperLists.some(
          (c) => c.manager.toLowerCase() === team.name.toLowerCase(),
        ),
      },
      draftCapital: {
        picksHeld: held.length,
        acquired: held.filter((s) => s.originalOwner.id !== team.id).length,
        tradedAway: view.slots.filter(
          (s) => s.originalOwner.id === team.id && s.currentOwner.id !== team.id,
        ).length,
        firstPickLabel: draftableHeld[0]?.label ?? null,
        firstPickOverall: draftableHeld[0]?.overallPick ?? null,
        hasFirstRoundPick: roundsHeld.has(1),
        roundsWithNoPick: Array.from(
          { length: view.rounds },
          (_, i) => i + 1,
        ).filter((r) => !roundsHeld.has(r)),
      },
      pickCapital: capital.get(team.id)!,
      picks,
      // Sorted copies: `picks` stays in board order, which is how a blurb reads
      // a draft back, and the extremes are pulled off separately.
      bestSteal: [...scored].sort((a, b) => a.slotsVsBoard! - b.slotsVsBoard!)[0] ?? null,
      worstReach: [...scored].sort((a, b) => b.slotsVsBoard! - a.slotsVsBoard!)[0] ?? null,
      valueGained: scored.reduce((sum, p) => sum - p.slotsVsBoard!, 0),
      averageSlotsVsBoard: scored.length
        ? round1(scored.reduce((sum, p) => sum + p.slotsVsBoard!, 0) / scored.length)!
        : 0,
      scoredPicks: scored.length,
      starters:
        lineup?.starters.map((s) => ({
          slot: s.label,
          player: s.player?.name ?? null,
          position: s.player?.position ?? null,
        })) ?? [],
      benchCount: lineup?.bench.length ?? 0,
      byPosition,
      openStarterSlots: lineup?.openStarterLabels ?? [],
      positionsAtCap: lineup?.positionsAtCap ?? [],
      picksRemaining: lineup?.picksRemaining ?? 0,
      oddities: oddities(byPosition, lineup?.openStarterLabels ?? []),
    };
  });

  const allPicks: AttributedPick[] = franchises.flatMap((f) =>
    f.picks
      .filter((p) => p.slotsVsBoard !== null)
      .map((p) => ({
        ...p,
        teamId: f.teamId,
        teamName: f.teamName,
        manager: f.manager,
      })),
  );

  return {
    season: view.season,
    rounds: view.rounds,
    teamCount: view.teamCount,
    keepersOutOfPool: keeperSlots.length,
    draftableSlots,
    picksEntered: view.picksMade,
    boardComplete: view.remaining === 0,
    league: {
      scoringFormat: SCORING_FORMAT,
      passingTouchdownPoints: 6,
      startingLineup: STARTING_LINEUP.map((s) => `${s.count} ${s.slot}`).join(", "),
      benchSlots: ROSTER.bench,
      rosterCap: ROSTER.activeCap,
      positionalMax: ROSTER.positionalMax,
      noKicker: true,
    },
    franchises,
    valueLeaderboard: [...franchises]
      .sort((a, b) => b.valueGained - a.valueGained)
      .map((f, i) => ({
        rank: i + 1,
        teamId: f.teamId,
        teamName: f.teamName,
        manager: f.manager,
        valueGained: f.valueGained,
        averageSlotsVsBoard: f.averageSlotsVsBoard,
      })),
    biggestSteals: [...allPicks]
      .filter((p) => p.slotsVsBoard! <= -NOTABLE_GAP)
      .sort((a, b) => a.slotsVsBoard! - b.slotsVsBoard!)
      .slice(0, EXTREMES),
    biggestReaches: [...allPicks]
      .filter((p) => p.slotsVsBoard! >= NOTABLE_GAP)
      .sort((a, b) => b.slotsVsBoard! - a.slotsVsBoard!)
      .slice(0, EXTREMES),
    positionRuns: positionRuns(view),
    positionWaits: positionWaits(view, franchises),
    leagueAverageByPosition: leagueAverages(franchises),
    projectedStandings: projectedStandings?.rows.length
      ? {
          basis: projectedStandings.basis,
          rows: projectedStandings.rows.map(trimFinish),
          spread: projectedSpread(projectedStandings.rows),
        }
      : null,
  };
}

/**
 * The projected row, cut down to what a blurb can use.
 *
 * Written out field by field rather than spread, so that a future field added
 * upstream — another per-starter breakdown, say — cannot silently double the
 * size of the prompt.
 */
function trimFinish(row: ProjectedFinish): ProjectedFinish {
  return {
    rank: row.rank,
    teamId: row.teamId,
    teamName: row.teamName,
    manager: row.manager,
    projectedPoints: row.projectedPoints,
    projectedWins: row.projectedWins,
    projectedLosses: row.projectedLosses,
    playoffOdds: row.playoffOdds,
    titleOdds: row.titleOdds,
    weakestSlot: row.weakestSlot,
    weakestSlotDeficit: row.weakestSlotDeficit,
    topHeavyShare: row.topHeavyShare,
    keeperShare: row.keeperShare,
    zeroProjectedStarters: row.zeroProjectedStarters ?? [],
    unprojectedStarters: row.unprojectedStarters ?? [],
  };
}

/** One decimal, because ADP feeds carry three and nobody reads the third. */
function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

/**
 * Case-folded, punctuation-stripped, for joining a spreadsheet to a board.
 *
 * The keeper sheet carries no player ids, so the join is on name, and the two
 * sources disagree about full stops and suffixes — "Brian Thomas Jr." against
 * "Brian Thomas Jr". A missed join silently drops a keeper option, which reads
 * as "he had no choice" rather than as a bug, so the match is made forgiving.
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The same name with a generational suffix taken off as well.
 *
 * ============================================================================
 * THIS EXISTS BECAUSE A GENERATED BLURB TOLD A JOKE ABOUT A PLAYER WHO DOES NOT
 * EXIST.
 * ============================================================================
 *
 * `normalizeName` handles the full stop, because the two sources disagree about
 * "Brian Thomas Jr." and "Brian Thomas Jr". They also disagree about whether
 * the suffix is there AT ALL: the board carries Josh's keeper as "Travis
 * Etienne" and the keeper sheet carries the same man as "Travis Etienne Jr", so
 * the join in `passedOn` missed and he came back in `passedOnKeepers` — a
 * player his own franchise had just kept, listed as one it had declined.
 *
 * A model handed that contradiction does not report a data error, it writes a
 * joke: a shipped generation said Josh "kept one Etienne and let the other one
 * walk out the door", which is a false statement about a real manager delivered
 * in front of the room with a number attached. Precisely the failure this whole
 * module exists to make impossible.
 *
 * SUFFIX-STRIPPED MATCHING IS ONLY USED TO EXCLUDE, never to attribute. Two
 * different footballers can share a surname and a suffix, so this is not safe
 * as a general identity: dropping a keeper option that MIGHT be the man already
 * kept costs one line of a list that is capped at five anyway, while wrongly
 * merging two players would put the wrong name in a blurb. The asymmetry is the
 * point — the exact-match path is what still decides who anybody is.
 */
function normalizeNameLoose(name: string): string {
  return normalizeName(name)
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "")
    .trim();
}

/**
 * What a franchise could have kept and didn't, and what the pass actually cost.
 *
 * This is the sharpest thing in the dossier, because it is a mistake expressed
 * entirely in arithmetic: a manager who declined to keep a player at a
 * ninth-round price, and then watched that player go in the fourth, made a
 * measurable error that no amount of draft-night confidence can talk away.
 *
 * A player kept by SOMEBODY is excluded, whoever kept him. The sheet is a
 * post-2025-season roster snapshot and trades have moved players since — Puka
 * Nacua sits on it under Greg and on the board under Scott — so "he was yours
 * to keep" cannot be taken from the sheet alone. Excluding every kept player
 * resolves that from the board, which is the source that wins everywhere else.
 *
 * Ordered worst mistake first and capped, because ten franchises times sixteen
 * eligible players is a wall of names and only the top of each list is a story.
 */
/** A franchise's own eligible-and-not-kept players, before the display cap. */
function eligibleAndPassed(
  teamName: string,
  options: readonly { manager: string; player: string; position: string; costRound: number }[],
  keptNames: ReadonlySet<string>,
): readonly { manager: string; player: string; position: string; costRound: number }[] {
  const keptLoose = new Set([...keptNames].map(normalizeNameLoose));
  return options.filter(
    (o) =>
      o.manager.toLowerCase() === teamName.toLowerCase() &&
      !keptNames.has(normalizeName(o.player)) &&
      !keptLoose.has(normalizeNameLoose(o.player)),
  );
}

/** How long that list really is, so the cap on it cannot be mistaken for it. */
function passedOnCount(
  teamName: string,
  options: readonly { manager: string; player: string; position: string; costRound: number }[],
  keptNames: ReadonlySet<string>,
): number {
  return eligibleAndPassed(teamName, options, keptNames).length;
}

function passedOn(
  teamName: string,
  options: readonly { manager: string; player: string; position: string; costRound: number }[],
  keptNames: ReadonlySet<string>,
  onBoard: ReadonlyMap<string, { slot: LiveSlot; owner: string }>,
): PassedKeeper[] {
  /*
   * The suffix-loose exclusion is the second half of the filter and it is not
   * belt-and-braces. See `normalizeNameLoose`: the board and the keeper sheet
   * disagree about whether a player's "Jr" is part of his name, which put a
   * franchise's own kept player into its list of declined ones and got a false
   * claim about it read out on the page.
   */
  const mine = eligibleAndPassed(teamName, options, keptNames);

  const rows: PassedKeeper[] = mine.map((o) => {
    const landed = onBoard.get(normalizeName(o.player));
    return {
      player: o.player,
      position: o.position,
      costRound: o.costRound,
      draftedAtLabel: landed?.slot.label ?? null,
      draftedAtRound: landed?.slot.round ?? null,
      draftedAtOverallPick: landed?.slot.overallPick ?? null,
      draftedBy: landed?.owner ?? null,
      roundsCheaperToKeep:
        landed === undefined ? null : o.costRound - landed.slot.round,
    };
  });

  /*
   * Undrafted players sort last rather than being dropped. "You passed on him
   * and so did everyone else" is a real answer to "should he have kept him",
   * and a list that only ever shows mistakes would imply every pass was one.
   *
   * THE TIEBREAK IS LOAD-BEARING BEFORE THE DRAFT, and its absence was a bug.
   * `roundsCheaperToKeep` is null for every option until somebody is actually
   * drafted, so on a pre-draft board the primary key ties across the whole list
   * and the sort collapses to the order the keeper spreadsheet happened to be
   * written in. The five rows that survive the cap were therefore arbitrary:
   * Greg's round-1 option did not appear at all while four of his round-8s did,
   * and a model shown five arbitrary rows will describe them as the whole set.
   *
   * Cheapest cost round first is the right second key in both states. A low
   * round is an EXPENSIVE keeper, which is the option worth arguing about —
   * before the draft it is the only signal available, and after it the primary
   * key already has the mistakes at the top.
   */
  return rows
    .sort(
      (a, b) =>
        (b.roundsCheaperToKeep ?? -Infinity) - (a.roundsCheaperToKeep ?? -Infinity) ||
        a.costRound - b.costRound,
    )
    .slice(0, PASSED_KEEPERS_SHOWN);
}

/**
 * Roster facts stated finished.
 *
 * Every line here is a comparison against the league's own starting lineup
 * rather than against a feeling about roster construction, so a blurb quoting
 * one is quoting the league's rules back at somebody. Thresholds live in
 * `STACK_THRESHOLD` and are deliberately generous — two quarterbacks is
 * ordinary, four is a story.
 */
function oddities(
  byPosition: Record<string, number>,
  openStarterSlots: string[],
): string[] {
  const out: string[] = [];

  /*
   * EVERY CLAUSE NAMES THE POSITION IT IS COUNTING. These strings are printed
   * verbatim on the recap tab, and "no QB at all; the league starts 1" ends on
   * a bare numeral that the reader has to supply a noun for — the commissioner
   * read one off the screen as a sentence that had been cut off. It had not;
   * it was simply written that way. Saying "starts 1 QB" costs three
   * characters and finishes the thought.
   */
  for (const { slot, count } of STARTING_LINEUP) {
    if (slot === "FLEX") continue;
    const have = byPosition[slot] ?? 0;
    /*
     * A SHORTFALL AT A POST-DRAFT SLOT IS NOT AN ODDITY. These strings are
     * printed verbatim on the recap tab and handed to the model as evidence, so
     * "no DST at all; the league starts 1 DST" is the sentence a grade then
     * quotes back as a hole. The league streams defences off waivers within the
     * week and the commissioner ruled that skipping one is a plan rather than a
     * gap — see `POST_DRAFT_STARTER_SLOTS`. Hoarding is still reported below,
     * because three defences on one roster is a story about a decision; having
     * none is not.
     */
    if (!isPostDraftSlot(slot)) {
      if (have === 0) {
        out.push(`no ${slot} at all; the league starts ${count} ${slot}`);
      } else if (have < count) {
        out.push(`only ${have} ${slot}; the league starts ${count} ${slot}`);
      }
    }
    const stack = STACK_THRESHOLD[slot];
    if (stack && have >= stack) {
      out.push(`${have} ${slot} rostered; the league starts ${count} ${slot}`);
    }
  }

  const realOpen = openStarterSlots.filter((slot) => !isPostDraftSlot(slot));
  if (realOpen.length) {
    out.push(`cannot field a full lineup — ${realOpen.join(", ")} empty`);
  }

  return out;
}

/**
 * Streaks of one position taken back to back.
 *
 * Keeper slots are stepped over rather than breaking a streak: a keeper is not
 * a decision anybody made on the day, so a run of running backs interrupted
 * only by somebody's pre-placed tight end is still a run of running backs. Runs
 * are counted in BOARD ORDER, which is the order the room experienced them.
 */
function positionRuns(view: DraftRoomView): PositionRun[] {
  const made = view.slots
    .filter((s) => s.player && s.fill === "pick")
    .sort((a, b) => a.overallPick - b.overallPick);

  const runs: PositionRun[] = [];
  let start = 0;
  for (let i = 1; i <= made.length; i++) {
    const same =
      i < made.length && made[i].player!.position === made[start].player!.position;
    if (same) continue;

    const streak = made.slice(start, i);
    if (streak.length >= RUN_LENGTH) {
      runs.push({
        position: streak[0].player!.position,
        count: streak.length,
        fromOverallPick: streak[0].overallPick,
        toOverallPick: streak[streak.length - 1].overallPick,
        teams: streak.map((s) => s.currentOwner.name),
      });
    }
    start = i;
  }

  return runs.sort((a, b) => b.count - a.count);
}

/**
 * How long each franchise went before its first quarterback, tight end and
 * defence — keepers included, because a franchise that kept a quarterback did
 * not wait for one, it simply paid earlier and in a different currency.
 */
function positionWaits(
  view: DraftRoomView,
  franchises: FranchiseDossier[],
): PositionWait[] {
  const waits: PositionWait[] = [];

  for (const position of WAIT_POSITIONS) {
    const forPosition = franchises.map((f) => {
      const first = view.slots
        .filter(
          (s) =>
            s.currentOwner.id === f.teamId &&
            s.player?.position === position,
        )
        .sort((a, b) => a.overallPick - b.overallPick)[0];

      return {
        position,
        teamId: f.teamId,
        teamName: f.teamName,
        manager: f.manager,
        firstOverallPick: first?.overallPick ?? null,
        viaKeeper: first?.fill === "keeper",
      };
    });

    /*
     * Never-took-one sorts last, which puts it FIRST once reversed: it is the
     * strongest version of the same fact, and a blurb should reach for it
     * before it reaches for "waited until pick 140".
     */
    waits.push(
      ...forPosition.sort(
        (a, b) => (b.firstOverallPick ?? Infinity) - (a.firstOverallPick ?? Infinity),
      ),
    );
  }

  return waits;
}

function leagueAverages(franchises: FranchiseDossier[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const f of franchises) {
    for (const [position, count] of Object.entries(f.byPosition)) {
      totals[position] = (totals[position] ?? 0) + count;
    }
  }
  return Object.fromEntries(
    Object.entries(totals).map(([position, total]) => [
      position,
      round1(total / franchises.length)!,
    ]),
  );
}

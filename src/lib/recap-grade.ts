/**
 * The draft grade: everything the model needs to assign one, the rubric it
 * assigns it by, and the check that catches it assigning a wrong one.
 *
 * ============================================================================
 * THE MODEL ASSIGNS THE LETTER. THIS FILE DOES NOT.
 * ============================================================================
 *
 * The commissioner ruled on this directly: "it's a lot, it's value, it's
 * keepers coming in, it's projections, you need to kind of let the AI weigh all
 * the data and assign the grade... weighing it against the internet, kind of
 * every variable it can get its hands on."
 *
 * So there is no weighted sum in here and there must not be one. A formula that
 * turned nine dimensions into one letter would be an opinion about how much a
 * keeper bargain is worth against an unfilled FLEX slot, dressed up as
 * arithmetic and impossible to argue with. The judgement is the model's.
 *
 * WHAT IS LEFT FOR THIS FILE IS THE PART THAT MAKES THE JUDGEMENT DEFENSIBLE,
 * and it is three jobs:
 *
 *   1.  `buildGradeInput` — the evidence, complete. A grade assigned on partial
 *       data is the failure this module exists to prevent, so the payload states
 *       what it knows AND what it does not (`GradeCoverage`), and refuses to
 *       report an absent input as a zero.
 *   2.  `gradeRubric` — what each letter means in this league's terms, what is
 *       being graded, and what the internet may and may not be used for.
 *       Exported as text because `@/lib/recap-prompt` owns the prompt and this
 *       module owns the standard.
 *   3.  `validateGrades` — run over what came back. It never edits a grade; it
 *       names the contradiction so a human can. See `GradeFlag`.
 *
 * ============================================================================
 * THE PAYLOAD NEVER RESTATES A DOSSIER FIGURE, AND THAT IS THE MAIN RULE
 * ============================================================================
 *
 * `@/lib/recap-dossier` is already in the prompt, in full, and it is the source
 * of truth for every raw number on this page. If this payload carried its own
 * copy of `valueGained` there would be two of them in one request, and the
 * lesson of this codebase — earned twice, on Greg's keepers and on Zach's
 * fourth-rounders — is that two copies of a number eventually disagree and the
 * room reads both off the same card.
 *
 * So what is added here is exactly the layer the dossier does not have: the
 * COMPARATIVE and DERIVED figures a grade needs and a per-franchise document
 * cannot hold. Ranks across the ten. Medians and distances from them. The split
 * between what a manager inherited and what he earned on the day. Coverage.
 * Where the raw number lives, `dossierField` says so by name rather than by
 * value.
 *
 * ============================================================================
 * WHAT IS BEING GRADED: THE DRAFT, NOT THE ROSTER
 * ============================================================================
 *
 * In a keeper league the two come apart, and the whole credibility of a letter
 * rests on which one it is. Nineteen players never entered the pool. A manager
 * who kept Ja'Marr Chase and then drafted badly for sixteen rounds owns a
 * strong roster and had a poor draft; a manager with nothing to keep who
 * captured value at every turn had a fine draft and may still project ninth.
 *
 * Every field here is therefore named for which of the two it measures, and the
 * projections — which are mostly INHERITED, and say so via `keeperShare` — are
 * handed over with `draftedShare` beside them and a caution in the payload
 * itself. A grade that is really a roster ranking would contradict nothing and
 * mean nothing; it would also be the second thing on this page to imply a
 * hierarchy the season has not decided.
 *
 * ============================================================================
 * THE YARDSTICK RULE, WHICH IS THE ONE THE PAGE ALREADY PROMISES
 * ============================================================================
 *
 * The recap's subtitle says it in terms: "Every verdict is measured against
 * where a player was expected to go on THIS board — 19 keepers are out of the
 * pool, so consensus ADP is not the yardstick."
 *
 * Web research is in scope and wanted — a keeper price means something
 * different for a man who has not practised since August 11. But the internet
 * is for OUTLOOK AND SITUATION, never for price. Pulling nineteen players out
 * of a hundred and sixty slots moves every draft position on the board, so
 * external ADP misprices this draft systematically, and a grade argued from it
 * would contradict the sentence at the top of the same page. The rubric states
 * the split and `validateGrades` checks it — see `ADP_YARDSTICK_PATTERN`.
 *
 * ============================================================================
 * DISPUTED VALUE: PROVENANCE IS AN ATTRIBUTE OF THE EVIDENCE, NOT A DISCOUNT
 * ============================================================================
 *
 * The largest single figure on the 2026 board is Puka Nacua saving Scott 103
 * slots, where the next-best declaration in the league saves 72. It is also the
 * league's most resented transaction: a two-party DocuSigned contract that
 * revived an expired keeper clock, with no record anywhere of the league
 * approving it. The commissioner's instruction is not to stroke Scott's ego, and
 * the risk is concrete — any grade built on value captured makes him the runaway
 * top letter on the strength of the one deal everybody in the room dislikes, and
 * the page then loses its audience while being arithmetically correct.
 *
 * THE VALUE IS NOT DISCOUNTED. Three reasons, and the third is the one that
 * settles it:
 *
 *   1.  The 103 slots are real and will really be scored this season.
 *       `verify:picks` confirms every leg against four independent sources. A
 *       grade that quietly shaved them would be inaccurate, and "just be legit"
 *       is the governing instruction.
 *   2.  A discount needs a discount factor, and inventing one is the weighted-sum
 *       problem the commissioner already ruled out when he gave the letter to the
 *       model. There is no defensible number between "worth 103" and "worth 0".
 *   3.  NO RULE WAS BROKEN, and the repository says so in terms.
 *       `nacuaAgreement.whoApprovedIt.isApprovalEvenRequired` is marked
 *       `verified`: "No rule currently permits or forbids this, which is the
 *       problem." Docking a grade for an unratified mechanism would be this app
 *       enforcing a rule that does not exist — pre-empting the very ballot item
 *       that exists to decide it. `@/lib/keeper-tenure-dispute` is the standard
 *       here and its rule is one line: the app does not adjudicate, it reports.
 *       A discount adjudicates.
 *
 * And a discount could not be applied honestly even if it were wanted, because
 * it would have to be generic. `DECISIONS.md` records the same trade-and-reset
 * mechanism producing Trey McBride's third season — and McBride is the
 * OPERATOR'S keeper. A rule aimed at disputed provenance hits the man who
 * objects to it; a rule aimed only at Scott is not a rule, it is a grudge.
 *
 * WHAT HAPPENS INSTEAD is that provenance travels with the figure. The keeper
 * carries a `DisputedValue` — the question, both readings, how it gets settled,
 * and the app's own refusal to state a clock year — the rubric requires any
 * grade resting on such a figure to SAY SO in its reason rather than admire it,
 * and `validateGrades` blocks a grade that cites disputed value silently. The
 * biggest number is not automatically the best decision, and that sentence is in
 * the rubric generically rather than aimed at one franchise.
 *
 * The list of disputes is `@/lib/keeper-tenure-dispute`'s, not this module's, so
 * nothing here names a player or a franchise. A dispute recorded there is
 * flagged here; one that is not, is not. That is also why McBride is absent —
 * no dispute is recorded against him — which is an asymmetry this module reports
 * and must not fix, because recording a new dispute is adjudication.
 *
 * Pure and I/O-free like the rest of `@/lib`. The one input that comes off disk
 * — the confidence-marked league history — is read by
 * `@/lib/recap-grade-source` and passed in.
 */

import { FEATURES, KEEPERS, isPostDraftSlot } from "@/lib/league-config";
import { describeDisputedClock, findTenureDispute } from "@/lib/keeper-tenure-dispute";
import type {
  DossierKeeper,
  FranchiseDossier,
  PassedKeeper,
  ProjectedFinish,
  RecapDossier,
} from "@/lib/recap-dossier";

// ── The scale ───────────────────────────────────────────────────────────────

/**
 * A through F with plus and minus, thirteen steps, best first.
 *
 * WHY THERE IS NO "F-". An F is already the floor, and the floor is reached by
 * a draft with several compounding self-inflicted errors — which is a real
 * thing that can happen in one night. Below that there is nothing left to
 * measure, only emphasis, and a grade that exists to be funnier than the grade
 * above it is the feature editorialising through the scale instead of through
 * the prose. The blurb is where the knife goes.
 *
 * WHY THIRTEEN STEPS FOR TEN FRANCHISES. Most of the scale goes unused in any
 * given year and that is correct rather than wasteful: the letters are anchored
 * to descriptions of drafts (see `GRADE_BANDS`), not to deciles of this
 * particular field. A scale sized to the field would make "C" mean "fifth best
 * tonight", which is not what a C means to anybody reading it.
 */
export const GRADE_SCALE = [
  "A+",
  "A",
  "A-",
  "B+",
  "B",
  "B-",
  "C+",
  "C",
  "C-",
  "D+",
  "D",
  "D-",
  "F",
] as const;

export type GradeLetter = (typeof GRADE_SCALE)[number];

/** The letter's position on the scale. 0 is A+, 12 is F. Lower is better. */
export function gradeIndex(letter: GradeLetter): number {
  return GRADE_SCALE.indexOf(letter);
}

export function isGradeLetter(value: unknown): value is GradeLetter {
  return typeof value === "string" && (GRADE_SCALE as readonly string[]).includes(value);
}

/** The band, ignoring the modifier — "B+", "B" and "B-" are all "B". */
export function gradeBand(letter: GradeLetter): "A" | "B" | "C" | "D" | "F" {
  return letter[0] as "A" | "B" | "C" | "D" | "F";
}

/**
 * What each band means, in drafts rather than in percentiles.
 *
 * These are the sentences the model is graded against and the sentences a card
 * can print under a letter, so they describe DECISIONS: value captured against
 * the board's own expectation, capital converted into startable slots, holes
 * left open. None of them mentions where a franchise projects to finish,
 * because a projection is mostly a fact about the players rather than about the
 * night anybody had.
 *
 * THE KEEPER CLAUSES FOLLOW THE LEAGUE'S OWN SWITCH. Three of these bands were
 * written for a keeper league and priced declarations inside their own
 * definitions — "keeper prices well under what redrafting would have cost", "a
 * keeper slot passed on a player who then went several rounds earlier". In a
 * redraft those are not lenient descriptions, they are conditions no franchise
 * can meet or fail, and a band a man cannot be measured against is a band that
 * quietly widens the one next to it. The redraft wordings say the same thing
 * about the one decision that does exist here: what a pick cost against where
 * the board had the player.
 */
export const GRADE_BANDS: { band: "A" | "B" | "C" | "D" | "F"; means: string }[] = [
  {
    band: "A",
    means: FEATURES.keepers
      ? "Took value the board did not have to give up: several picks that beat their " +
        "slot, keeper prices well under what redrafting would have cost, early capital " +
        "turned into players who actually start, and no starting slot left unfillable. " +
        "An A is a night where the decisions, not the inheritance, are why this roster " +
        "is better than it was."
      : "Took value the board did not have to give up: several picks that beat their " +
        "slot by a real margin, the early rounds turned into players who actually " +
        "start, a position filled a round before the run on it, and no starting slot " +
        "left unfillable. An A is a night where the decisions, not the draft slot, are " +
        "why this roster is better than the seat he sat down in.",
  },
  {
    band: "B",
    means: FEATURES.keepers
      ? "A good draft with one soft spot. Value captured on the whole, keepers priced " +
        "sensibly, the lineup legal — but one reach that cost real slots, or one " +
        "position handled late, or capital spent on depth the roster did not need."
      : "A good draft with one soft spot. Value captured on the whole and the lineup " +
        "legal — but one reach that cost real slots, or one position handled late, or " +
        "a middle round spent on depth the roster did not need.",
  },
  {
    band: "C",
    means:
      "Par. Took roughly what the pick numbers entitled him to and left roughly what " +
      "he was given. Nothing here is a mistake and nothing here is an edge. Most " +
      "competent drafts in a tight league land in this band, and putting a franchise " +
      "here is not an insult.",
  },
  {
    band: "D",
    means: FEATURES.keepers
      ? "Gave value back. Reaches that cost more slots than the steals returned, or a " +
        "keeper paid for ahead of his redraft price, or a keeper slot passed on a player " +
        "who then went several rounds earlier than keeping him would have cost, or a " +
        "starting slot nobody on the roster can fill."
      : "Gave value back. Reaches that cost more slots than the steals returned, or a " +
        "position taken so far ahead of the board that the same player was there two " +
        "rounds later, or a run he sat out and then paid full retail to catch, or a " +
        "starting slot nobody on the roster can fill.",
  },
  {
    band: "F",
    means: FEATURES.keepers
      ? "Several of the D failures at once, compounding, and self-inflicted. Reserved " +
        "for a draft that made the roster worse than the picks and keepers walking in " +
        "should have produced. A thin roster inherited is NOT an F — a thin roster is " +
        "the hand, and the grade is the play."
      : "Several of the D failures at once, compounding, and self-inflicted. Reserved " +
        "for a draft that made the roster worse than the draft slot should have " +
        "produced. A bad seat in the order is NOT an F — the seat is the hand, and the " +
        "grade is the play.",
  },
];

// ── What is being graded, when the board is not finished ─────────────────────

/**
 * What there actually is to grade, which is not always a draft.
 *
 * The commissioner is already complaining that this page renders prose about an
 * unfinished board. A "Draft grade" printed against a board with zero picks in
 * it would be the same fault with a letter on top.
 *
 * ============================================================================
 * THE ZERO-PICK CASE WAS CALLED `keeper-slate`, AND IN A REDRAFT IT IS NOTHING
 * ============================================================================
 *
 * That name was right for the league this app was forked from: nineteen
 * keepers were in before anybody drafted, so a zero-pick board still carried
 * ten finished decisions and grading them was honest. Ron and Friends has no
 * keepers, so a zero-pick board carries NO DECISIONS AT ALL. Everything left is
 * the draft slot, which is a lottery result, and the franchise name, which is a
 * joke — and a letter assigned on those is not a lenient grade, it is a grade
 * of the draw. That is the roster ranking this module's header refuses to be,
 * with the one honest input removed.
 *
 * So the member is renamed for the board state rather than for one league's
 * format — `no-picks` is true whichever way the keeper switch is set — and
 * whether it can be graded is decided by `buildCoverage` off what is actually
 * on the board. With keepers declared it grades them exactly as before; with
 * none it refuses, and the refusal travels through `sufficientToGrade` to the
 * route, which then never asks for letters at all.
 *
 * DUPLICATED FROM `recapStage` ON PURPOSE, AND NARROWLY. `@/lib/recap-prompt`
 * already classifies the board into predraft/midraft/postdraft, and this module
 * must not import it: the prompt imports the rubric from here, and a cycle
 * whose members are a const and a function is a cycle that resolves to
 * `undefined` on some load orders. So the derivation is restated, and
 * `verify:recap:grade` asserts the two agree on every board it builds — which
 * is the same way this codebase keeps the spread rule and the prompt from
 * drifting apart.
 */
export type GradeSubject = "no-picks" | "partial-draft" | "draft";

export function gradeSubject(dossier: {
  picksEntered: number;
  boardComplete: boolean;
}): GradeSubject {
  if (dossier.picksEntered === 0) return "no-picks";
  return dossier.boardComplete ? "draft" : "partial-draft";
}

/**
 * What the card must call the grade. Not decoration — a zero-pick grade printed
 * as "Draft grade" is a false claim about a draft that has not happened, and it
 * is checked.
 *
 * The zero-pick label follows the keeper switch because the two states are
 * genuinely different things and not two wordings of one thing: with keepers
 * there is a slate to grade and the card says so, and without them no letter is
 * ever issued, so the string exists to be honest in a payload rather than to be
 * printed beside ten grades.
 */
export const SUBJECT_LABEL: Record<GradeSubject, string> = {
  "no-picks": FEATURES.keepers ? "Keeper slate grade" : "Not graded — no picks yet",
  "partial-draft": "Partial draft grade",
  draft: "Draft grade",
};

/** One sentence a card or a blurb can print about what the letter covers. */
export const SUBJECT_NOTE: Record<GradeSubject, string> = {
  "no-picks": FEATURES.keepers
    ? "No picks have been made. This grades the keeper declarations alone — who was " +
      "kept, at what price, and who was passed on — and it is not a draft grade."
    : "No picks have been made and this league keeps nobody, so not one decision has " +
      "been taken yet. There is nothing to grade and no letter is issued.",
  "partial-draft":
    "The draft is not finished. This grades the picks made so far and says so; it " +
    "will change when the board does.",
  draft: FEATURES.keepers
    ? "The board is complete. This grades the decisions made on it — the picks, the " +
      "keeper prices and what the capital was turned into."
    : "The board is complete. This grades the decisions made on it — what each pick " +
      "cost against where the board had the player, and what the draft slot became.",
};

// ── The evidence ────────────────────────────────────────────────────────────

/** Whether an input exists at all. An absent input is never a zero. */
export type Availability = "present" | "absent";

/**
 * What the grade can and cannot be argued from on this board.
 *
 * THIS IS THE FIELD THAT STOPS A CONFIDENT WRONG GRADE. Historical boards have
 * no ADP and therefore no board-relative expectation; a checkout with no
 * projections snapshot has no points, wins or playoff odds. Both are ordinary
 * states, and both mean a different grade is possible from the one the rubric
 * describes. Reporting them as zeros would produce a franchise that "captured 0
 * slots of value" when the truth is that nobody measured.
 */
export type GradeCoverage = {
  /** Board-relative expectation — the yardstick. Absent means no ADP was joined. */
  boardExpectation: Availability;
  /** Season projections: points, and the weakest-slot comparison. */
  projections: Availability;
  /** The Monte Carlo: wins, losses, playoff and title odds. */
  simulation: Availability;
  /** `pickIfReleased` on every keeper — what keeping actually saved. */
  keeperCounterfactual: Availability;
  /** The keeper sheet, so a pass can be priced. */
  keeperOptions: Availability;
  /**
   * The best-legal-lineup solve, which is what makes "capital converted into
   * starters" and "starting slot nobody can fill" answerable.
   *
   * ABSENT MUST NOT READ AS A LEGAL LINEUP. Without it `openStarterSlots` is an
   * empty array on every franchise, which is indistinguishable from ten rosters
   * that can all field a full nine — so the conversion figures go null rather
   * than zero and `validateGrades` stops asserting anything about holes. A
   * historical draft sheet is precisely this case: it records who took whom and
   * nothing about whether the result was startable.
   */
  lineup: Availability;
  /**
   * The positional price record from this league's own draft sheets, via
   * `@/lib/positional-norms`. Absent means no keeper price can be judged against
   * what the position actually costs here, and the rubric says so rather than
   * letting the model reach for the scoring settings instead.
   */
  positionalNorms: Availability;
  /** Confidence-marked league history for these managers. */
  history: Availability;
  /**
   * Whether the rubric's own minimum is met. FALSE MEANS DO NOT GRADE: the
   * letter would rest on nothing, and `validateGrades` blocks a grade issued
   * against it rather than trusting the prompt to have been read.
   */
  sufficientToGrade: boolean;
  /** Named in English, so a card can say what was missing instead of hiding it. */
  missing: string[];
};

/** A league-history fact, with the confidence mark carried through verbatim. */
export type HistoryConfidence = "verified" | "derived" | "inferred" | "unverified";

export type HistoryNote = {
  fact: string;
  source: string;
  confidence: HistoryConfidence;
};

/**
 * How the confidence marks must be read, carried into the payload.
 *
 * `data/league-history.json` was compiled so a joke could be built safely, and
 * its own `howToRead` block is the standard the rest of this page is held to. It
 * travels with the notes rather than living only in the prompt, because a note
 * and the rule for reading it becoming separated is how an inferred thing gets
 * read out as a hard number.
 */
export const CONFIDENCE_RULE =
  "Every history note carries a confidence mark and it governs what you may say. " +
  "`verified` may be stated as fact. `derived` was computed from repo data by a " +
  "stated method and may be stated as fact. `inferred` follows from an argument " +
  "rather than a source — treat as probably true, never read it aloud as a hard " +
  "number, and never make it a reason for a grade. `unverified` may not be stated " +
  "at all. No grade may rest on anything below `derived`.";

/**
 * Value captured, expressed against the league rather than in isolation.
 *
 * Nothing here is a number the dossier already carries. `slotsGained` is not
 * copied — `dossierField` names where it lives, and everything beside it is the
 * comparison a single franchise's document cannot make.
 */
export type ValueCapturedComparison = {
  /** Where the raw figure lives, so nothing has to be restated to be cited. */
  dossierField: "franchises[].valueGained";
  /** 1 is the most value captured in the league. Ties share the better rank. */
  leagueRank: number;
  leagueMedian: number;
  /** Distance from the median, in board slots. Positive is above it. */
  vsLeagueMedian: number;
  /** Best and worst in the room, for scale. Names, not just figures. */
  leagueBest: { teamName: string; slotsGained: number };
  leagueWorst: { teamName: string; slotsGained: number };
  /** Picks that beat their slot by more than the board's own noise threshold. */
  notableSteals: number;
  notableReaches: number;
  /** Picks with no expectation to measure against. Not failures — unmeasured. */
  unscoredPicks: number;
};

/**
 * Value whose PROVENANCE the league has not settled.
 *
 * Not a discount and not a warning label — an attribute of the figure, carried
 * beside it so a grade can be argued honestly. See the module header for why the
 * number itself stands at full value.
 *
 * Everything in here is read from `@/lib/keeper-tenure-dispute`, which is the
 * app's single record of a question it refuses to answer. Nothing is written
 * down in this module, so a dispute settled by a league vote disappears from
 * every grade the moment it disappears from there.
 */
export type DisputedValue = {
  player: string;
  /**
   * The figure at stake, at full value. The whole point is that this is NOT
   * adjusted — the dispute is about how the value was obtained and how long it
   * lasts, never about whether it counts this season.
   */
  slotsSavedByKeeping: number | null;
  /** The question, stated so that neither side is the default. */
  question: string;
  /**
   * What the app prints instead of a clock year, verbatim from
   * `describeDisputedClock`. THE MODEL MAY QUOTE THIS AND MAY NOT IMPROVE ON IT.
   * Nacua is the only keeper on the board whose `clockYear2026`,
   * `isFinalKeeperSeason` and `keepableIn2027` are all null, and every other
   * surface in the app prints this string rather than picking a season. A grade
   * that picked one would be the one place in the app that took a side.
   */
  clockLabel: string;
  /** The competing final seasons, earliest first. Both, never one. */
  contestedFinalSeasons: number[];
  /** How it gets settled, and by whom. */
  resolution: string;
  /**
   * Whether a rule was broken. It was not, and the model needs to know that as
   * plainly as it needs to know the deal was never ratified — a reason that
   * calls this cheating is as wrong as one that calls it a masterstroke.
   */
  ruleStatus: string;
};

/**
 * Where this league actually drafts each position, and the dearest keeper price
 * anyone has ever actually declared at it.
 *
 * ============================================================================
 * THE ERROR THIS EXISTS TO KILL
 * ============================================================================
 *
 * A generation told Joe that Burrow "was keepable at a round-3 price, in a league
 * that pays six points for a passing touchdown, and you let him walk." The
 * commissioner: "No one would touch a 3rd round QB keeper, not even close."
 *
 * The heuristic was: six points a passing touchdown, therefore quarterbacks are
 * premium, therefore a declined quarterback is a mistake. It priced a position
 * off the SCORING SETTINGS, which say what a position is worth in points and
 * nothing about what it costs in rounds. What settles the question is where this
 * league actually drafts the position, and the league's own sheets say the
 * dearest quarterback anybody has ever kept cost a SIXTH-ROUND pick. A round-3
 * price is off the end of the record. Declining it is not a judgement call.
 *
 * A blurb saying that is bad; a GRADE saying it is worse, because a letter has no
 * room to hedge. So the price context is handed over as data, and the rubric
 * states the general rule rather than a quarterback exception: A KEEPER PRICE IS
 * DEFENSIBLE RELATIVE TO WHERE THIS LEAGUE ACTUALLY DRAFTS THAT POSITION — not
 * relative to the scoring settings, and not relative to external ADP.
 *
 * ============================================================================
 * ONE TABLE, AND IT IS NOT COMPUTED HERE
 * ============================================================================
 *
 * `@/lib/positional-norms` computes this for the prose layer, and the grade
 * consumes THAT rather than computing a second opinion. This module briefly did
 * compute its own, off a wider span of seasons and by a different method for
 * identifying a declaration, and the two agreed on the figure that settles the
 * Burrow question — the dearest quarterback ever declared cost a round-6 pick —
 * and disagreed by two rounds on the median. A grade citing a round-12 median
 * beside a blurb citing a round-10 one, on the same card, is the failure this
 * repository has already had twice.
 *
 * So the types below are a STRUCTURAL MIRROR of that module's output and the
 * norms are passed in. Structural rather than imported for the same reason
 * `ProjectedFinish` is structural in `@/lib/recap-dossier`: that module is
 * `server-only` and reads spreadsheets off disk, this one is pure and is
 * exercised by a verification script. Assignability is what keeps them honest,
 * and `verify:recap:grade` asserts the real output satisfies it.
 */
export type PositionPriceNorm = {
  position: string;
  /** Declarations found. The sample size, stated rather than implied. */
  declarations: number;
  /**
   * The DEAREST price anyone has ever actually declared here, in rounds — so
   * lower is dearer. Null when nobody has ever kept one at all, which is its own
   * answer and a stronger one.
   *
   * THE FIGURE THAT SETTLES A DECLINE. A price dearer than this is a price no
   * manager in the recorded history of this league has agreed to pay, which
   * makes declining it the obvious call rather than a lost opportunity.
   */
  mostExpensiveRound: number | null;
  medianRound: number | null;
};

export type PositionDraftNorm = {
  position: string;
  /** Starting slots the league fields at this position. Teams × slot count. */
  starterDemand: number;
  /** Median round the first one DRAFTED goes, keepers excluded. */
  firstDraftedMedianRound: number | null;
  /**
   * Median round by which the league's whole starter demand is off the board.
   *
   * THE HONEST COST OF AN EMPTY SLOT. Ten franchises start one quarterback, so
   * this is the round by which the tenth is gone — which is what it actually
   * costs to fill the slot, as against where the first one goes.
   */
  demandMetMedianRound: number | null;
};

export type PositionalNormsInput = {
  /** Seasons the figures come from. Never overstate this. */
  seasons: number[];
  declarations: number;
  keeperPrices: PositionPriceNorm[];
  draftPrices: PositionDraftNorm[];
};

/**
 * A keeper this franchise was entitled to keep and declined, WITH THE PRICE
 * CONTEXT that says whether declining was sensible.
 *
 * The dossier's `PassedKeeper` answers "could he have been kept for later than
 * he went", which is a real question and not the whole one. A player who could
 * have been kept a round cheaper than he was drafted is only a missed opportunity
 * if anybody would have wanted him at that price.
 */
export type PassedKeeperJudgement = {
  player: string;
  position: string;
  /** What keeping him would have cost, in rounds. */
  costRound: number;
  draftedAtRound: number | null;
  /**
   * `costRound - draftedAtRound`. Positive looks like a mistake — he could have
   * been kept for later than he actually went. Read it beside
   * `declineWasDefensible` before calling it one.
   */
  roundsCheaperToKeep: number | null;
  /**
   * TRUE means declining was the obvious call: the price was DEARER than any
   * keeper ever declared at this position in this league. FALSE means the price
   * was within the range managers here do pay, so the pass is arguable. NULL
   * means there is no positional record to judge it against.
   */
  declineWasDefensible: boolean | null;
  /** The comparison in one sentence, with the numbers in it. */
  priceContext: string | null;
};

/**
 * A starting slot nobody on the roster can fill, with the two facts that decide
 * how much it matters.
 *
 * "No starting quarterback" sounds structural and mostly is not. One quarterback
 * slot across ten franchises means replacement-level quarterback is cheap and
 * late — median round fourteen in this league — and before the draft ALL TEN
 * franchises have no quarterback, which is how much signal the phrase carries.
 * A hole everybody shares is a description of the draft not having happened.
 */
export type StarterHole = {
  slot: string;
  /** Position the slot needs, or null for a FLEX that several could fill. */
  position: string | null;
  /**
   * How many of the league's franchises cannot fill this same slot. Equal to the
   * franchise count means it is not a deficiency, it is a stage of the draft.
   */
  sharedByFranchises: number;
  /** Franchises in the league, so the share reads without arithmetic. */
  ofFranchises: number;
  /**
   * The round by which this league's whole starting demand at the position is
   * off the board — what filling the slot actually costs. Null without norms.
   */
  demandMetByRound: number | null;
  /**
   * The league fills this slot off waivers after the draft, so it is NOT a
   * deficiency however few franchises share it. See `POST_DRAFT_STARTER_SLOTS`
   * for the ruling; unlike `sharedByFranchises` this does not soften as other
   * franchises fill the slot, because streaming a defence never stops being
   * cheap.
   */
  filledAfterDraft: boolean;
};

/** Keepers coming in, priced and ranked against the room. */
export type KeeperComparison = {
  dossierField: "franchises[].keepers";
  count: number;
  maxAllowed: number;
  /**
   * Slots saved across every keeper, summed. Null when the counterfactual could
   * not be computed for all of them, which is different from zero.
   */
  totalSlotsSaved: number | null;
  leagueRank: number | null;
  leagueMedian: number | null;
  vsLeagueMedian: number | null;
  /**
   * Keepers costing a pick EARLIER than redrafting them would have — money paid
   * ahead of the market. A decision, and one of the few unambiguous ones.
   */
  paidOver: { player: string; slotsSavedByKeeping: number }[];
  /**
   * Every pass this franchise made, judged against the positional price record.
   * Worst apparent mistake first, as the dossier orders them.
   */
  passedOn: PassedKeeperJudgement[];
  /**
   * The pass that cost the most, if the keeper sheet loaded. Positive
   * `roundsCheaperToKeep` means he could have been kept for later than he went.
   */
  worstPass: PassedKeeper | null;
  /**
   * Passes that are actually arguable as mistakes: he could have been kept for
   * later than he went AND the price was one managers in this league do pay.
   *
   * A DECLINE AT AN OFF-THE-RECORD PRICE IS NOT COUNTED HERE, and that is the
   * whole change. Counting it made a correct, obvious decision look like a loss
   * — the Burrow error — and a count is exactly the kind of figure a grade gets
   * argued from.
   */
  costlyPasses: number;
  /**
   * Passes where the price was dearer than anyone here has ever paid at that
   * position. GOOD DECISIONS, and a franchise should not be marked down for one.
   */
  defensibleDeclines: number;
  /**
   * Where this league drafts each position a keeper is actually held at, so
   * slots saved can be read in the right currency. Slots saved on a quarterback
   * and slots saved on a running back are not the same money, because the
   * replacement cost behind them differs enormously — but the weighting is the
   * model's to apply, not this module's to bake in.
   */
  keeperPositionContext: {
    player: string;
    position: string;
    costRound: number;
    leagueMedianKeeperRound: number | null;
    dearestEverDeclaredRound: number | null;
  }[];
  /** Slots left unused, and whether that was a stated decision or unknown. */
  unusedSlots: { count: number; deliberate: boolean };
  /** Rounds a keeper is sitting in, which cannot be drafted with. */
  consumedRounds: number[];
  /**
   * Keepers whose provenance the league has not settled. Empty on nine of the
   * ten franchises, and empty entirely once the ballot is held.
   */
  disputedProvenance: DisputedValue[];
};

/**
 * The projection, with the inherited share broken out.
 *
 * READ THE `caution`. The rank in here is a fact about a roster, and most of a
 * roster in this league walked in already owned. `keeperShare` is how much of
 * the projection rests on kept players and `draftedShare` is the rest — the
 * part the draft is actually responsible for. A grade that tracked `rank` would
 * be a keeper-declaration grade wearing a draft grade's label.
 */
export type ProjectionComparison = {
  dossierField: "projectedStandings.rows[]";
  rank: number;
  totalRanked: number;
  pointsVsLeagueMedian: number;
  /** 0–1. Share of the projected starting total resting on kept players. */
  keeperShare: number | null;
  /** `1 - keeperShare`. The draft's own contribution, such as it is. */
  draftedShare: number | null;
  /** Rank on `draftedShare` — who got the most out of the day itself. */
  draftedShareLeagueRank: number | null;
  /** Playoff odds as a percentage as well as a share, since both get quoted. */
  playoffOddsPercent: number | null;
  /** How separated the table really is. Straight from the dossier's own rule. */
  fieldShape: "pack" | "tiered" | "separated";
  /** Whether the weakest slot is one the draft could have fixed and did not. */
  weakestSlot: string | null;
  weakestSlotDeficit: number | null;
  weakestSlotWasDraftable: boolean;
};

/** What the capital was, and what it turned into. */
export type CapitalConversion = {
  dossierField: "franchises[].pickCapital";
  /** Draftable slots held in rounds 1-6, against the league. From the dossier. */
  earlyCapitalRank: number;
  earlyPicksVsMedian: number;
  /** Slots inside the board's top-talent window, and the league's median. */
  topTalentCaptured: number;
  topTalentLeagueMedian: number;
  /**
   * Starting slots filled by a player this franchise DRAFTED. The conversion,
   * and the single best answer to "did the capital become anything".
   *
   * NULL WHEN THERE IS NO LINEUP TO SOLVE — see `GradeCoverage.lineup`. Zero
   * would say the draft produced no starters, which is a verdict; null says
   * nobody worked it out, which is the truth on a board with no roster solve.
   */
  startersDrafted: number | null;
  /** Starting slots filled by a kept player. The inheritance. */
  startersKept: number | null;
  /**
   * Starting slots nobody can fill. Non-empty means the lineup is illegal.
   * Null, not empty, when there is no lineup — an empty list would read as a
   * clean bill of health.
   */
  startersUnfilled: string[] | null;
  /** Owned slots still empty. Non-zero means this franchise is not finished. */
  picksRemaining: number;
  /** Rank on `startersDrafted`, so conversion can be compared across the room. */
  startersDraftedLeagueRank: number | null;
};

/** Holes, stacks and scarcity — stated against the league's own lineup rules. */
export type RosterShape = {
  dossierField: "franchises[].openStarterSlots, .oddities, .byPosition";
  /**
   * Null when there is no lineup solve. See `CapitalConversion`. Each hole
   * carries how many franchises share it and what the position costs, because
   * the bare label overstates every one of them — see `StarterHole`.
   */
  unfilledStarterSlots: StarterHole[] | null;
  /*
   * `oddities` and `positionsAtCap` are NOT repeated here. Both are carried
   * verbatim on the dossier's own franchise entry and copying them in was 1.5 KB
   * of the same strings arriving twice in one prompt. Read them there.
   */
  /** Positions this franchise rosters more of than anybody else in the league. */
  deepestAt: string[];
  /** Positions where it rosters fewer than the league mean, by more than one. */
  thinnestAt: string[];
  /**
   * Positions this franchise took later than everybody else, or never took.
   * Null `firstOverallPick` is the more damning version and is preserved.
   */
  latestAt: { position: string; firstOverallPick: number | null; viaKeeper: boolean }[];
};

/**
 * Picks moved, and which way the early rounds went.
 *
 * THE LISTS THEMSELVES ARE NOT HERE. `dossierField` points at them, and they
 * were briefly copied in — 3.4 KB of arrays the prompt already carried once,
 * which is the restatement this module's header forbids. What is added is the
 * part the dossier cannot know: the net direction of the early rounds and where
 * this franchise sits among the ten for activity.
 */
export type TradeActivity = {
  dossierField: "franchises[].pickCapital.acquired, .surrendered";
  acquiredCount: number;
  surrenderedCount: number;
  /** The other franchises involved, deduplicated. Named because a trade has two sides. */
  counterparties: string[];
  /** Early-round slots gained minus early-round slots given up. */
  netEarlyRounds: number;
  /** 1 is the busiest franchise in the room. Ties share the rank. */
  activityRank: number;
};

/**
 * What the model should go and look up, and what it may do with the answer.
 *
 * WEB RESEARCH IS FOR SITUATION, NOT FOR PRICE, and the two halves of that rule
 * travel together here so neither can arrive without the other. A keeper price
 * is worth grading differently for a man who has not practised since August 11;
 * the same search must not become "he went twelve spots ahead of ADP", because
 * nineteen players are out of this pool and external ADP is measuring a
 * different draft.
 */
export type ResearchBrief = {
  /** Names where outlook plausibly changes the verdict on a decision. */
  playersWorthChecking: string[];
};

/**
 * The rules that govern every franchise, stated ONCE.
 *
 * They were briefly carried per franchise, which is where the payload came from
 * for half its size: four paragraphs of identical prose repeated ten times, 14
 * KB of a 54 KB document saying the same four things over and over. That is not
 * only wasteful in a prompt that already carries a 69 KB dossier — it is the
 * exact smell this codebase has been bitten by twice. A rule with ten copies is
 * a rule that can end up with two versions, and a model reading a yardstick
 * sentence on Witte's block that differs from the one on Zach's is worse than a
 * model reading it once.
 */
export type GradeRules = {
  /** How price and value are measured, and what may not measure them. */
  yardstick: string;
  /** Why the projected rank is not a draft verdict. Read before weighing it. */
  projectionCaution: string;
  /** What web research is for. */
  researchPermitted: string;
  /** What it is not for. */
  researchForbidden: string;
  /**
   * What to do with value the league never sanctioned. Stated generically — it
   * governs any `disputedProvenance` entry, and names no franchise.
   */
  provenance: string;
  /** What a keeper price is measured against, and what a hole actually costs. */
  positionalPrice: string;
};

export const GRADE_RULES: GradeRules = {
  yardstick:
    "Board-relative: every pick is measured against where THIS board expected the " +
    "player to go, with the kept players already out of the pool, and every keeper " +
    "against what redrafting the same player would have cost. Consensus ADP is not " +
    "the yardstick and may not be used as one.",
  projectionCaution:
    "A projected rank is a fact about a ROSTER, and in a keeper league most of a " +
    "roster was owned before the draft started. `keeperShare` is how much of it was " +
    "inherited and `draftedShare` is the part the draft is responsible for. Grade " +
    "the draft, not the inheritance.",
  researchPermitted:
    "Outlook and situation only: injury and practice status, depth chart, camp " +
    "reports, role changes, suspension, holdout, and 2026 outlook pieces. A keeper " +
    "price is worth grading differently for a player who has not practised in " +
    "weeks, and that is exactly what this is for.",
  researchForbidden:
    "Not for price. Do not use consensus ADP, expert draft rankings or any external " +
    "draft position as the benchmark for whether a pick was a reach or a steal, or " +
    "whether a keeper was cheap. Nineteen players are out of this pool, so external " +
    "ADP is measuring a different draft, and the top of this page already promises " +
    "the room it is not the yardstick.",
  provenance:
    "Where a figure carries a `disputedProvenance` entry, the league has not settled " +
    "how that value was obtained. The number itself stands at full value — it is " +
    "real, it will be scored this season, and no rule was broken, so do not shave it " +
    "and do not call it cheating. What you must not do is admire it. THE BIGGEST " +
    "NUMBER IS NOT AUTOMATICALLY THE BEST DECISION: value taken through a mechanism " +
    "nobody ratified is reported, not applauded. A grade that rests on a disputed " +
    "figure has to say so in its reason, in the register of a receipt rather than a " +
    "compliment. And you may not resolve the dispute: quote `clockLabel` as the app " +
    "prints it and never assert one of the contested final seasons, because every " +
    "other surface in this app refuses to and a grade cannot be the one place that " +
    "takes a side.",
  positionalPrice:
    "A KEEPER PRICE IS DEFENSIBLE RELATIVE TO WHERE THIS LEAGUE ACTUALLY DRAFTS THAT " +
    "POSITION — not relative to the scoring settings, and not relative to external " +
    "ADP. `positionalNorms` carries both figures for every position: the round by which " +
    "the league's whole starting demand at it is met, and the dearest price anyone " +
    "ever actually declared at it. Three consequences. First, DECLINING AN OVERPRICED " +
    "KEEPER IS A GOOD DECISION and grades as one: where " +
    "`passedOn[].declineWasDefensible` is true, the price was dearer than anyone here " +
    "has ever paid at that position, and the manager should get credit rather than " +
    "blame. Second, slots saved on one position are not the same money as slots saved " +
    "on another, because the replacement cost behind them differs — weigh that, using " +
    "`keeperPositionContext`. Third, an unfilled starting slot costs what the position " +
    "costs: read `sharedByFranchises` and `demandMetByRound` before calling a " +
    "hole structural, because a slot every franchise in the league has open is not a " +
    "deficiency, it is a description of the draft not having happened yet. And where a " +
    "hole carries `filledAfterDraft`, IT IS NOT A HOLE AT ALL: this league streams that " +
    "position off waivers in the days after the draft, so a manager who spent no pick on " +
    "it made the cheapest correct decision available to him and gets credit for it if he " +
    "gets anything. Do not call it a gap, do not say he cannot field a lineup, and do not " +
    "let it cost him a letter — that is the commissioner's ruling, not a matter of " +
    "emphasis. Never argue a price from the scoring rules: what a position is worth in " +
    "POINTS says nothing about what it costs in ROUNDS.",
};

export type FranchiseGradeInput = {
  teamId: string;
  /** The handle the league uses — "Witte", "Elbe". */
  teamName: string;
  franchiseName: string;
  manager: string;
  draftSlot: number;

  valueCaptured: ValueCapturedComparison;
  keepersIn: KeeperComparison;
  /** Null when no projections snapshot exists. Absent, not zero. */
  projections: ProjectionComparison | null;
  capitalConversion: CapitalConversion;
  rosterShape: RosterShape;
  trades: TradeActivity;
  research: ResearchBrief;
  /** Confidence-marked history for THIS manager. Read `CONFIDENCE_RULE` first. */
  history: HistoryNote[];
};

export type GradeInput = {
  season: number;
  /** What there is to grade. A keeper slate is not a draft. */
  subject: GradeSubject;
  subjectLabel: string;
  subjectNote: string;
  coverage: GradeCoverage;
  /** The rules that govern all ten. Stated once — see `GradeRules`. */
  rules: GradeRules;
  /** How the confidence marks on `franchises[].history` must be read. */
  confidenceRule: string;
  /** The scale, so the model cannot invent a step that is not on it. */
  scale: readonly string[];
  /**
   * Where this league actually drafts each position, and the dearest keeper
   * price ever declared at it, from `@/lib/positional-norms`. Passed through
   * whole so the grade and the prose quote one table. Null when unavailable.
   */
  positionalNorms: PositionalNormsInput | null;
  /**
   * The distribution rules, restated as data. A model that has to remember the
   * anti-clustering guidance from four hundred words earlier will cluster.
   */
  distribution: {
    franchises: number;
    /** Above this many in the A band the grades are inflation, not a verdict. */
    aBandCeiling: number;
    /** Grades spanning fewer steps than this are not discriminating. */
    minimumSpanSteps: number;
    rule: string;
  };
  franchises: FranchiseGradeInput[];
};

// ── Building it ─────────────────────────────────────────────────────────────

/** Above this many slots a gap is a decision rather than expectation noise. */
const NOTABLE_GAP = 12;

/** Rounds 1-6, matching the dossier's own definition of early. */
const EARLY_ROUNDS = 6;

/** Names handed to the research brief per franchise. More is a shopping list. */
const RESEARCH_NAMES = 6;

/**
 * Passes judged per franchise, worst apparent mistake first.
 *
 * The dossier caps its own list at five. Three is enough for a grade: the worst
 * apparent mistake, and enough room beside it for a defensible decline to be
 * visible. Every one carries a name and a price comparison, and ten franchises'
 * worth of five was a fifth of the payload.
 */
const PASSES_JUDGED = 3;

/** More than this many A grades on a ten-team board is inflation. */
const A_BAND_CEILING = 3;

/** Ten grades inside fewer steps than this are not telling the room anything. */
const MINIMUM_SPAN_STEPS = 4;

/** Positions where being thin is a lineup problem rather than a preference. */
const THIN_MARGIN = 1;

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : round1((sorted[mid - 1] + sorted[mid]) / 2);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Ties share the better rank, as everywhere else on this page. */
function rankOf(value: number, all: readonly number[], highIsBetter = true): number {
  return all.filter((v) => (highIsBetter ? v > value : v < value)).length + 1;
}

/**
 * The evidence for all ten, assembled once.
 *
 * Takes the finished dossier and adds only what it cannot contain. The history
 * is passed in rather than read, because this module is pure — see
 * `@/lib/recap-grade-source`.
 */
export function buildGradeInput({
  dossier,
  history = {},
  positionalNorms = null,
}: {
  dossier: RecapDossier;
  /**
   * Confidence-marked notes keyed by the SHORT NAME the league uses — "Witte",
   * "Elbe". Never keyed on a first name: four managers share one and two of
   * them are called Scott. See `identityTrap` in `data/league-history.json`.
   */
  history?: Record<string, HistoryNote[]>;
  /**
   * From `positionalNorms()` in `@/lib/positional-norms`. Passed in rather than
   * computed here: that module owns this table, and a second computation of it
   * would eventually print a different number on the same page. Null is an
   * ordinary state and is reported in `coverage`, never guessed around.
   */
  positionalNorms?: PositionalNormsInput | null;
}): GradeInput {
  const subject = gradeSubject(dossier);
  const priceFor = (position: string): PositionPriceNorm | null =>
    positionalNorms?.keeperPrices.find((r) => r.position === position) ?? null;
  const supplyFor = (position: string): PositionDraftNorm | null =>
    positionalNorms?.draftPrices.find((r) => r.position === position) ?? null;
  const standings = dossier.projectedStandings;
  const rowByTeam = new Map<string, ProjectedFinish>(
    (standings?.rows ?? []).map((r) => [r.teamId, r]),
  );

  const coverage = buildCoverage({ dossier, history, subject, positionalNorms });

  /*
   * How many franchises cannot fill each starting slot, counted once across the
   * league. This is the figure that stops "no starting quarterback" reading as a
   * structural failure when it is in fact the state of all ten rosters before
   * anybody has drafted.
   */
  const holeSharedBy = new Map<string, number>();
  for (const f of dossier.franchises) {
    for (const slot of f.openStarterSlots) {
      holeSharedBy.set(slot, (holeSharedBy.get(slot) ?? 0) + 1);
    }
  }

  // League-wide distributions, computed once so no two franchises can disagree
  // about the median they are being measured against.
  const valueAll = dossier.franchises.map((f) => f.valueGained);
  const valueMedian = median(valueAll) ?? 0;
  const savedAll = dossier.franchises.map((f) => totalSlotsSaved(f.keepers));
  const savedKnown = savedAll.filter((v): v is number => v !== null);
  const savedMedian = median(savedKnown);
  const pointsMedian = median((standings?.rows ?? []).map((r) => r.projectedPoints));

  const draftedShareAll = dossier.franchises
    .map((f) => draftedShareOf(rowByTeam.get(f.teamId) ?? null))
    .filter((v): v is number => v !== null);

  /*
   * Whether anybody solved a lineup for this board. One check for all ten, so
   * the conversion figures cannot be null on some franchises and zero on others
   * — which would read as "these three drafted no starters".
   */
  const hasLineup = dossier.franchises.some((f) => f.starters.length > 0);
  const startersDraftedAll = hasLineup
    ? dossier.franchises.map((f) => startersDraftedCount(f))
    : [];
  const activityAll = dossier.franchises.map(
    (f) => f.pickCapital.acquired.length + f.pickCapital.surrendered.length,
  );

  const bestValue = [...dossier.franchises].sort((a, b) => b.valueGained - a.valueGained)[0];
  const worstValue = [...dossier.franchises].sort((a, b) => a.valueGained - b.valueGained)[0];

  const leagueAverages = dossier.leagueAverageByPosition;
  const deepestByPosition = new Map<string, number>();
  for (const f of dossier.franchises) {
    for (const [position, count] of Object.entries(f.byPosition)) {
      deepestByPosition.set(position, Math.max(deepestByPosition.get(position) ?? 0, count));
    }
  }

  const franchises = dossier.franchises.map((f): FranchiseGradeInput => {
    const row = rowByTeam.get(f.teamId) ?? null;
    const saved = totalSlotsSaved(f.keepers);
    const drafted = hasLineup ? startersDraftedCount(f) : null;
    const activity = f.pickCapital.acquired.length + f.pickCapital.surrendered.length;
    /*
     * Judged over ALL of them and only then trimmed, so `defensibleDeclines` and
     * `costlyPasses` count the whole list rather than the visible top of it. A
     * count that changed with the display cap would be a count nobody could
     * check against the dossier.
     */
    const judged = f.passedOnKeepers.map((p) => judgePass(p, priceFor(p.position)));
    /*
     * The visible list is the worst apparent mistakes in the dossier's own order,
     * PLUS every defensible decline whether or not it made the cut.
     *
     * The union is not tidiness. `validateGrades` can only see what the payload
     * carries, so a defensible decline trimmed off the end would be one the
     * Burrow check could not catch — and a manager could be marked down for a
     * correct decision precisely because it was too far down the list to print.
     * A defensible decline is also the one item here a franchise deserves CREDIT
     * for, which is a poor thing to hide.
     */
    const visible = judged.slice(0, PASSES_JUDGED);
    const passes = [
      ...visible,
      ...judged.filter((p) => p.declineWasDefensible === true && !visible.includes(p)),
    ];

    return {
      teamId: f.teamId,
      teamName: f.teamName,
      franchiseName: f.franchiseName,
      manager: f.manager,
      draftSlot: f.draftSlot,

      valueCaptured: {
        dossierField: "franchises[].valueGained",
        leagueRank: rankOf(f.valueGained, valueAll),
        leagueMedian: valueMedian,
        vsLeagueMedian: round1(f.valueGained - valueMedian),
        leagueBest: { teamName: bestValue.teamName, slotsGained: bestValue.valueGained },
        leagueWorst: { teamName: worstValue.teamName, slotsGained: worstValue.valueGained },
        notableSteals: f.picks.filter(
          (p) => p.slotsVsBoard !== null && p.slotsVsBoard <= -NOTABLE_GAP,
        ).length,
        notableReaches: f.picks.filter(
          (p) => p.slotsVsBoard !== null && p.slotsVsBoard >= NOTABLE_GAP,
        ).length,
        unscoredPicks: f.picks.length - f.scoredPicks,
      },

      keepersIn: {
        dossierField: "franchises[].keepers",
        count: f.keepers.length,
        maxAllowed: KEEPERS.maxPerTeam,
        totalSlotsSaved: saved,
        leagueRank: saved === null || !savedKnown.length ? null : rankOf(saved, savedKnown),
        leagueMedian: savedMedian,
        vsLeagueMedian:
          saved === null || savedMedian === null ? null : round1(saved - savedMedian),
        paidOver: f.keepers
          .filter((k) => k.slotsSavedByKeeping !== null && k.slotsSavedByKeeping < 0)
          .map((k) => ({ player: k.player, slotsSavedByKeeping: k.slotsSavedByKeeping! })),
        passedOn: passes,
        worstPass: f.passedOnKeepers[0] ?? null,
        costlyPasses: judged.filter(
          (p) =>
            p.roundsCheaperToKeep !== null &&
            p.roundsCheaperToKeep > 0 &&
            p.declineWasDefensible !== true,
        ).length,
        defensibleDeclines: judged.filter((p) => p.declineWasDefensible === true).length,
        keeperPositionContext: f.keepers.map((k) => ({
          player: k.player,
          position: k.position,
          costRound: k.costRound,
          leagueMedianKeeperRound: priceFor(k.position)?.medianRound ?? null,
          dearestEverDeclaredRound: priceFor(k.position)?.mostExpensiveRound ?? null,
        })),
        unusedSlots: f.unusedKeeperSlots,
        consumedRounds: f.pickCapital.keeperConsumedRounds,
        disputedProvenance: disputedValues(f),
      },

      projections: row
        ? {
            dossierField: "projectedStandings.rows[]",
            rank: row.rank,
            totalRanked: standings!.rows.length,
            pointsVsLeagueMedian: round1(row.projectedPoints - (pointsMedian ?? 0)),
            keeperShare: row.keeperShare,
            draftedShare: draftedShareOf(row),
            draftedShareLeagueRank: (() => {
              const share = draftedShareOf(row);
              return share === null || !draftedShareAll.length
                ? null
                : rankOf(share, draftedShareAll);
            })(),
            playoffOddsPercent:
              row.playoffOdds === null ? null : round1(row.playoffOdds * 100),
            fieldShape: standings!.spread.shape,
            weakestSlot: row.weakestSlot,
            weakestSlotDeficit: row.weakestSlotDeficit,
            /*
             * A weakest slot the draft could have addressed is a decision; one
             * filled by a kept player is largely not. The distinction is what
             * stops "his RB2 is weak" being held against a man whose RB2 is a
             * keeper he is contractually stuck with.
             */
            weakestSlotWasDraftable: weakestSlotWasDraftable(f, row),
          }
        : null,

      capitalConversion: {
        dossierField: "franchises[].pickCapital",
        earlyCapitalRank: f.pickCapital.earlyCapitalRank,
        earlyPicksVsMedian: f.pickCapital.earlyPicksVsMedian,
        topTalentCaptured: f.pickCapital.topTalentCaptured,
        topTalentLeagueMedian: f.pickCapital.topTalentLeagueMedian,
        startersDrafted: drafted,
        startersKept: hasLineup ? startersKeptCount(f) : null,
        startersUnfilled: hasLineup ? f.openStarterSlots : null,
        picksRemaining: f.picksRemaining,
        startersDraftedLeagueRank:
          drafted === null ? null : rankOf(drafted, startersDraftedAll),
      },

      rosterShape: {
        dossierField: "franchises[].openStarterSlots, .oddities, .byPosition",
        unfilledStarterSlots: hasLineup
          ? f.openStarterSlots.map((slot) => {
              const position = slotPosition(slot);
              const supply = position ? supplyFor(position) : null;
              return {
                slot,
                position,
                sharedByFranchises: holeSharedBy.get(slot) ?? 0,
                ofFranchises: dossier.franchises.length,
                demandMetByRound: supply?.demandMetMedianRound ?? null,
                filledAfterDraft: isPostDraftSlot(slot),
              };
            })
          : null,
        deepestAt: Object.entries(f.byPosition)
          .filter(([position, count]) => deepestByPosition.get(position) === count && count > 0)
          .map(([position]) => position)
          .sort(),
        thinnestAt: Object.entries(leagueAverages)
          .filter(
            ([position, average]) => (f.byPosition[position] ?? 0) < average - THIN_MARGIN,
          )
          .map(([position]) => position)
          .sort(),
        latestAt: dossier.positionWaits
          .filter((w) => w.teamId === f.teamId)
          .map((w) => ({
            position: w.position,
            firstOverallPick: w.firstOverallPick,
            viaKeeper: w.viaKeeper,
          })),
      },

      trades: {
        dossierField: "franchises[].pickCapital.acquired, .surrendered",
        acquiredCount: f.pickCapital.acquired.length,
        surrenderedCount: f.pickCapital.surrendered.length,
        counterparties: [
          ...new Set([
            ...f.pickCapital.acquired.map((a) => a.from),
            ...f.pickCapital.surrendered.map((s) => s.to),
          ]),
        ].sort(),
        netEarlyRounds:
          f.pickCapital.acquired.filter((a) => a.round <= EARLY_ROUNDS).length -
          f.pickCapital.surrendered.filter((s) => s.round <= EARLY_ROUNDS).length,
        activityRank: rankOf(activity, activityAll),
      },

      research: { playersWorthChecking: researchNames(f, row) },

      history: history[f.teamName] ?? [],
    };
  });

  return {
    season: dossier.season,
    subject,
    subjectLabel: SUBJECT_LABEL[subject],
    subjectNote: SUBJECT_NOTE[subject],
    coverage,
    rules: GRADE_RULES,
    confidenceRule: CONFIDENCE_RULE,
    scale: GRADE_SCALE,
    positionalNorms,
    distribution: {
      franchises: dossier.franchises.length,
      aBandCeiling: A_BAND_CEILING,
      minimumSpanSteps: MINIMUM_SPAN_STEPS,
      rule:
        `Ten franchises and thirteen steps: most of the scale will go unused and that ` +
        `is fine. Two failures to avoid. Do not cluster — if eight of these letters ` +
        `are B+, B or B-, the grades are saying nothing and the differences in the ` +
        `evidence are real enough to separate. Do not manufacture spread either — a ` +
        `franchise that drafted competently gets a C or a B even if that leaves the ` +
        `bottom of the scale empty, and an F must be earned by compounding errors ` +
        `rather than handed out to complete a curve. No more than ${A_BAND_CEILING} ` +
        `in the A band unless the evidence genuinely forces a fourth.`,
    },
    franchises,
  };
}

/**
 * The keepers on this franchise whose provenance is contested.
 *
 * Matched on player name AND franchise short name, which is
 * `findTenureDispute`'s own contract: a dispute belongs to a specific
 * franchise's clock, and the same player under a different franchise is a
 * different question. The short name is `teamName` — never the manager's first
 * name, since four of the ten share one and two are called Scott.
 */
function disputedValues(f: FranchiseDossier): DisputedValue[] {
  const out: DisputedValue[] = [];
  for (const keeper of f.keepers) {
    const dispute = findTenureDispute(keeper.player, f.teamName);
    if (!dispute) continue;
    out.push({
      player: keeper.player,
      slotsSavedByKeeping: keeper.slotsSavedByKeeping,
      question: dispute.question,
      clockLabel: describeDisputedClock(dispute),
      contestedFinalSeasons: dispute.readings
        .map((r) => r.finalSeason)
        .sort((a, b) => a - b),
      resolution: dispute.resolution,
      /*
       * Stated rather than implied. A model told only that a deal was never
       * ratified will reach for "cheated", which is a false statement about a
       * real manager on a page he reads out loud — and the repository is
       * explicit that no rule covers it either way.
       */
      ruleStatus:
        "No rule was broken. The league has no rule permitting or forbidding the " +
        "mechanism, which is why it is on a ballot rather than in a ruling. Do not " +
        "call it cheating and do not attribute a ruling to the commissioner: none exists.",
    });
  }
  return out;
}

/**
 * The position a starting slot needs, from its label.
 *
 * "RB1" and "RB2" both want a running back; "FLEX1" wants any of several and so
 * returns null rather than guessing, because a FLEX hole cannot be priced
 * against one position's market.
 */
function slotPosition(slot: string): string | null {
  const match = slot.match(/^([A-Z/]+?)\d*$/);
  if (!match) return null;
  const base = match[1].toUpperCase();
  if (base === "FLEX") return null;
  return base === "D/ST" ? "DST" : base;
}

/**
 * Whether declining a keeper was the obvious call, or arguably a mistake.
 *
 * THE COMPARISON IS AGAINST WHAT MANAGERS HERE ACTUALLY PAY, which is the only
 * thing that answers the question. A price DEARER than the dearest anyone has
 * ever declared at the position is a price nobody in the recorded history of
 * this league has agreed to, so passing on it is not a lost opportunity.
 *
 * Note the direction: rounds count UP as they get cheaper, so a cost round
 * BELOW the record is dearer than the record.
 *
 * Both branches say the numbers out loud, because the model has to be able to
 * cite the comparison rather than assert the conclusion.
 */
function judgePass(
  pass: PassedKeeper,
  market: PositionPriceNorm | null,
): PassedKeeperJudgement {
  const base = {
    player: pass.player,
    position: pass.position,
    costRound: pass.costRound,
    draftedAtRound: pass.draftedAtRound,
    roundsCheaperToKeep: pass.roundsCheaperToKeep,
  };

  if (!market || market.mostExpensiveRound === null) {
    return { ...base, declineWasDefensible: null, priceContext: null };
  }

  /*
   * TERSE ON PURPOSE. This was two sentences of explanation per pass, which came
   * to fifteen kilobytes across ten franchises and restated the same two market
   * figures fifty times — the `GradeRules` mistake again in a different field.
   * `positionalNorms` is in the payload as a table; this only has to state the
   * comparison, and the rubric says what to do with it.
   */
  const dearest = market.mostExpensiveRound;
  const context =
    `R${pass.costRound} ${pass.position}; dearest ${pass.position} keeper ever ` +
    `declared here R${dearest}, median R${market.medianRound}`;

  /*
   * The argument is spelled out only where it OVERTURNS the apparent verdict.
   * A pass at an ordinary price needs no explanation — the flag says it is
   * arguable and `positionalNorms` carries the figures — whereas a defensible
   * decline is a good decision that looks like a bad one, and that is the case
   * the model has to be handed finished.
   */
  return pass.costRound < dearest
    ? {
        ...base,
        declineWasDefensible: true,
        priceContext: `${context}. Nobody here has ever paid this much for the position.`,
      }
    : { ...base, declineWasDefensible: false, priceContext: null };
}

/** Slots saved across every keeper, or null when any is unpriced. */
function totalSlotsSaved(keepers: readonly DossierKeeper[]): number | null {
  if (!keepers.length) return 0;
  if (keepers.some((k) => k.slotsSavedByKeeping === null)) return null;
  return keepers.reduce((sum, k) => sum + k.slotsSavedByKeeping!, 0);
}

/** The share of the projection NOT resting on kept players. */
function draftedShareOf(row: ProjectedFinish | null): number | null {
  if (!row || row.keeperShare === null) return null;
  return round1((1 - row.keeperShare) * 100) / 100;
}

/** Starting slots held by a player this franchise drafted rather than kept. */
function startersDraftedCount(f: FranchiseDossier): number {
  const kept = new Set(f.keepers.map((k) => k.player));
  return f.starters.filter((s) => s.player !== null && !kept.has(s.player)).length;
}

function startersKeptCount(f: FranchiseDossier): number {
  const kept = new Set(f.keepers.map((k) => k.player));
  return f.starters.filter((s) => s.player !== null && kept.has(s.player)).length;
}

/**
 * Whether the weakest starting slot is one the draft was free to fix.
 *
 * A slot occupied by a kept player is one the manager chose in February and is
 * paying a round for; a slot occupied by a drafted player, or empty, is one the
 * draft owned. Holding the first against a draft grade would be grading the
 * inheritance, which is the one thing this module exists to stop.
 */
function weakestSlotWasDraftable(f: FranchiseDossier, row: ProjectedFinish): boolean {
  if (!row.weakestSlot) return false;
  const slot = f.starters.find((s) => s.slot === row.weakestSlot);
  if (!slot || slot.player === null) return true;
  return !f.keepers.some((k) => k.player === slot.player);
}

/**
 * Who is worth a search for this franchise.
 *
 * Keepers first, because a keeper price is the decision most changed by a man's
 * current situation. Then the picks at the extremes, then any starter the feed
 * cannot price — an unprojected or zero-projected starter is as often a hole in
 * the feed as a verdict on the player, and the internet is how the model tells
 * which.
 */
function researchNames(f: FranchiseDossier, row: ProjectedFinish | null): string[] {
  const names: string[] = [
    ...f.keepers.map((k) => k.player),
    ...(row?.zeroProjectedStarters ?? []),
    ...(row?.unprojectedStarters ?? []),
    ...[f.bestSteal?.player, f.worstReach?.player].filter((n): n is string => !!n),
  ];
  return [...new Set(names)].slice(0, RESEARCH_NAMES);
}

function buildCoverage({
  dossier,
  history,
  subject,
  positionalNorms,
}: {
  dossier: RecapDossier;
  history: Record<string, HistoryNote[]>;
  subject: GradeSubject;
  positionalNorms: PositionalNormsInput | null;
}): GradeCoverage {
  const anyScored = dossier.franchises.some((f) => f.scoredPicks > 0);
  const standings = dossier.projectedStandings;
  const simulated = !!standings?.rows.every((r) => r.projectedWins !== null);
  const keepers = dossier.franchises.flatMap((f) => f.keepers);
  const counterfactual = keepers.length === 0 || keepers.every((k) => k.pickIfReleased !== null);
  const options = dossier.franchises.some((f) => f.passedOnKeepers.length > 0);
  const lineup = dossier.franchises.some((f) => f.starters.length > 0);
  const historyPresent = Object.values(history).some((notes) => notes.length > 0);

  /*
   * WHETHER ANYBODY KEPT ANYONE, WHICH IS NOT THE SAME QUESTION AS `counterfactual`.
   *
   * `counterfactual` asks whether every keeper is priced, and an empty list
   * satisfies it vacuously — which is how a redraft board with no keepers and no
   * picks was reporting itself gradable. The zero-pick branch needs the prior
   * question: is there a declaration here at all?
   */
  const keepersDeclared = keepers.length > 0;

  const missing: string[] = [];
  if (!anyScored && subject !== "no-picks") {
    missing.push("board-relative expectation — no pick has an expected slot to be measured against");
  }
  if (subject === "no-picks" && !keepersDeclared) {
    missing.push(
      "any decision at all — nobody has picked and this league keeps nobody, so the " +
        "only things on this board are the draft order and the franchise names",
    );
  }
  if (!standings) missing.push("season projections — no snapshot on this checkout");
  else if (!simulated) missing.push("the simulation — no schedule, so no wins or playoff odds");
  /*
   * THE KEEPER GAPS ARE ONLY GAPS IN A KEEPER LEAGUE. Reported unconditionally
   * they told a redraft board it was missing a counterfactual, a keeper sheet
   * and a table of keeper prices — three things it is not supposed to have. A
   * coverage list that names inapplicable inputs as absent is worse than one
   * that omits them, because `missing` is what the ungradable flag prints as
   * its reason.
   */
  if (FEATURES.keepers) {
    if (!counterfactual) missing.push("the keeper counterfactual — at least one keeper is unpriced");
    if (!options) missing.push("the keeper sheet — passes cannot be priced");
    if (!positionalNorms?.keeperPrices.length) {
      missing.push(
        "the positional price record — no keeper price can be judged against what the " +
          "position actually costs in this league",
      );
    }
  }
  if (!lineup) {
    missing.push(
      "the lineup solve — no roster was fitted to the starting slots, so nothing can " +
        "be said about capital converted into starters or about holes",
    );
  }
  if (!historyPresent) missing.push("league history — no confidence-marked notes were supplied");

  /*
   * THE MINIMUM, AND WHY IT IS THIS.
   *
   * A draft grade needs the yardstick. Without board-relative expectation there
   * is no way to say a pick beat its slot, and every remaining input — capital,
   * holes, projections — describes the roster rather than the decisions. A
   * letter assigned on those alone would be the roster ranking this module
   * spends its header refusing to be.
   *
   * THE ZERO-PICK BRANCH NEEDS A DECISION TO EXIST BEFORE IT NEEDS IT PRICED,
   * and that is the bug this replaced. It used to accept the keeper
   * counterfactual on its own, which an empty keeper list satisfies for free —
   * so a redraft board before the draft reported itself gradable and would have
   * put ten letters on the seats people drew in a lottery. Now it wants the
   * declarations to be there AND priced, which is the same rule as before in a
   * keeper season and a refusal in a redraft.
   *
   * Projections and history stay enriching and never required — the page is
   * explicitly built to work without either.
   */
  const sufficientToGrade =
    subject === "no-picks" ? keepersDeclared && counterfactual : anyScored && counterfactual;

  return {
    boardExpectation: anyScored ? "present" : "absent",
    projections: standings ? "present" : "absent",
    simulation: simulated ? "present" : "absent",
    keeperCounterfactual: counterfactual ? "present" : "absent",
    keeperOptions: options ? "present" : "absent",
    lineup: lineup ? "present" : "absent",
    positionalNorms: positionalNorms?.keeperPrices.length ? "present" : "absent",
    history: historyPresent ? "present" : "absent",
    sufficientToGrade,
    missing,
  };
}

// ── The rubric ──────────────────────────────────────────────────────────────

/**
 * Markers the verify script asserts on.
 *
 * The same device as `SEPARATED_FIELD_MARKER` in `@/lib/recap-prompt`: the
 * load-bearing clauses are asserted by marker rather than by prose, so that
 * rewording a paragraph cannot silently delete the rule inside it.
 */
export const GRADE_SUBJECT_MARKER = "GRADE THE DRAFT, NOT THE ROSTER";
export const GRADE_YARDSTICK_MARKER = "CONSENSUS ADP IS NOT THE YARDSTICK";
export const GRADE_CITATION_MARKER = "EVERY LETTER CARRIES ITS RECEIPTS";
export const GRADE_PROVENANCE_MARKER = "REPORT DISPUTED VALUE, DO NOT ADMIRE IT";
export const GRADE_POSITION_MARKER =
  "PRICE A POSITION AGAINST WHERE THIS LEAGUE DRAFTS IT";

/**
 * The grading instructions, rendered for what is actually being graded.
 *
 * Exported as text because `@/lib/recap-prompt` owns the prompt and this module
 * owns the standard. Agent B includes it; nothing here knows how.
 */
export function gradeRubric(subject: GradeSubject = "draft"): string {
  const bands = GRADE_BANDS.map((b) => `  ${b.band} range — ${b.means}`).join("\n\n");

  const subjectPara =
    subject === "no-picks"
      ? FEATURES.keepers
        ? `NO PICKS HAVE BEEN MADE, SO YOU ARE NOT GRADING A DRAFT. Call it what the ` +
          `payload calls it: "${SUBJECT_LABEL[subject]}". What is on the table is the ` +
          `declarations — who was kept, what the price was against what redrafting him ` +
          `would have cost, who was passed on and what that pass cost. Grade those and ` +
          `nothing else. Do not grade picks that do not exist, and do not grade the ` +
          `roster: every roster on the board right now is keepers and empty slots.`
        : `NO PICKS HAVE BEEN MADE AND THIS LEAGUE KEEPS NOBODY, SO THERE IS NOTHING ` +
          `TO GRADE. Not one decision has been taken by anybody. The only things on ` +
          `this board are the draft order, which was drawn, and the franchise names. ` +
          `**DO NOT ASSIGN A LETTER TO ANYONE.** A grade here would be a grade of the ` +
          `lottery, and \`coverage.sufficientToGrade\` is false so any letter you do ` +
          `return is dropped before it reaches the page.`
      : subject === "partial-draft"
        ? `THE BOARD IS NOT FINISHED. Call it what the payload calls it: ` +
          `"${SUBJECT_LABEL[subject]}". Grade the picks that have actually been made ` +
          `and say in the reason that the board is incomplete. A franchise with picks ` +
          `still to make has not left a starting slot empty — it has not filled it yet, ` +
          `and those are different things.`
        : `The board is complete. Grade the whole night.`;

  return [
    `THE DRAFT GRADE`,
    ``,
    `Assign every franchise a letter from this scale, best to worst:`,
    `  ${GRADE_SCALE.join("  ")}`,
    ``,
    subjectPara,
    ``,
    `${GRADE_SUBJECT_MARKER}.`,
    ``,
    `Nineteen players never entered this pool. That means roster strength is mostly`,
    `INHERITED and has very little to do with how anybody drafted. A manager who kept`,
    `two elite players and then drafted badly for sixteen rounds owns a strong roster`,
    `and had a poor draft. A manager with nothing worth keeping who captured value at`,
    `every turn had a good draft and may still project ninth. Both of those are`,
    `correct outcomes and your letters must reflect them.`,
    ``,
    `So grade DECISIONS, not luck and not inheritance:`,
    `  · value captured against where this board expected each player to go;`,
    `  · keeper prices against what redrafting the same player would have cost;`,
    `  · whether pick capital turned into players who actually start;`,
    `  · holes left unfilled, and whether the draft was free to fill them —`,
    `    \`weakestSlotWasDraftable\` tells you; a weak slot occupied by a keeper is a`,
    `    February decision, not a draft one;`,
    `  · keeper slots passed on players who then went earlier than keeping cost;`,
    `  · positional scarcity handled or ignored.`,
    ``,
    `The projected standings are in the payload and you should weigh them, but read`,
    `\`rules.projectionCaution\` before you do:`,
    ``,
    `  ${GRADE_RULES.projectionCaution}`,
    ``,
    `First in projected points is not an A and last is not an F.`,
    ``,
    `${GRADE_YARDSTICK_MARKER}.`,
    ``,
    /*
     * QUOTED FROM `GRADE_RULES` RATHER THAN REWRITTEN. The same four rules travel
     * in the payload as data and here as instructions, and a paraphrase would be
     * a second version of a rule that has already been the subject of a
     * commissioner's ruling. One text, two places.
     */
    `Web research is in scope and wanted. What it is for:`,
    ``,
    `  ${GRADE_RULES.researchPermitted}`,
    ``,
    `What it is not for:`,
    ``,
    `  ${GRADE_RULES.researchForbidden}`,
    ``,
    `The yardstick, which is the rule the top of this page already promises the room:`,
    ``,
    `  ${GRADE_RULES.yardstick}`,
    ``,
    `\`rawAdp\` is carried in the dossier for colour and may be mentioned as colour. It`,
    `may not be the reason for a letter.`,
    ``,
    `${GRADE_PROVENANCE_MARKER}.`,
    ``,
    `  ${GRADE_RULES.provenance}`,
    ``,
    `Concretely: if a franchise's \`keepersIn.disputedProvenance\` is non-empty and your`,
    `letter leans on that value, the reason must name the dispute. Not as an apology`,
    `and not as an accusation — as a fact about where the number came from, the way a`,
    `receipt names a shop. "The largest keeper surplus in the league, and the one the`,
    `league never ratified" is the register. "A masterclass in exploiting the rules" is`,
    `not, and neither is "he cheated".`,
    ``,
    `Never state which of \`contestedFinalSeasons\` is right, and never write a single`,
    `year as his last. Quote \`clockLabel\` if you need to refer to it at all.`,
    ``,
    `${GRADE_POSITION_MARKER}.`,
    ``,
    `  ${GRADE_RULES.positionalPrice}`,
    ``,
    /*
     * THE WORKED EXAMPLE IS IN THE RUBRIC ON PURPOSE. The abstract rule was not
     * enough to stop the error the first time: the model had the scoring format
     * and the keeper price and reasoned from the wrong one. Naming the shape of
     * the mistake is what a rule against it needs, and it is stated as a shape
     * rather than as "do not say this about Joe".
     */
    `The mistake this rule exists to stop, so you can recognise it: reasoning that a`,
    `position is premium BECAUSE OF THE SCORING and therefore that declining it was a`,
    `blunder. A league can pay six points for a passing touchdown and still never see`,
    `anybody pay an early-round keeper price for a quarterback, because one starting`,
    `slot across ten franchises means the replacement is cheap and late. If the record`,
    `says no manager here has ever paid that much for the position, the manager who`,
    `declined it made the obvious call, and a grade that docks him for it is wrong.`,
    ``,
    `WHAT THE LETTERS MEAN`,
    ``,
    bands,
    ``,
    `DISTRIBUTION`,
    ``,
    `Read \`distribution.rule\` in the payload and follow it. Thirteen steps and ten`,
    `franchises: most of the scale goes unused every year and that is expected. The`,
    `two ways to get this wrong are clustering everyone into the B band because the`,
    `differences feel small, and inventing a D so the spread looks decisive. The`,
    `evidence separates these ten more than it feels like it does — the value column`,
    `alone runs from the league best to the league worst and both are named for you.`,
    ``,
    `${GRADE_CITATION_MARKER}.`,
    ``,
    `Every grade must come back with two to four cited figures and one sentence of`,
    `reason. A citation is a LABEL AND A NUMBER, and the number must be one that`,
    `appears in the dossier or in the grade payload for that same franchise — not a`,
    `number you worked out, rounded differently, or remembered. A grade whose figures`,
    `cannot be found in the evidence is rejected and the whole set is dropped, because`,
    `these letters are relative to each other and nine of ten is not a curve.`,
    ``,
    /*
     * THE EXAMPLE IS HERE BECAUSE THE RULE ALONE WAS NOT ENOUGH. On a bench run
     * against a historical board the model returned citations whose `value` was a
     * player's name — {"label": "Patrick Mahomes"} with nothing numeric — which
     * the validator rejected as unfindable, correctly and unhelpfully. It wanted
     * to cite a THING rather than a figure. The name belongs in the label, where
     * it is welcome; the value has to be a number or there is nothing to check.
     */
    `The name goes in the label and the number goes in the value. Like this:`,
    ``,
    `  {"label": "slots of value captured", "value": 41}`,
    `  {"label": "his tight end's keeper surplus", "value": 27}`,
    `  {"label": "playoff odds, percent", "value": 57}`,
    ``,
    `NOT like this — there is no number here and it will be rejected:`,
    ``,
    `  {"label": "best pick of the night", "value": "Patrick Mahomes"}`,
    ``,
    `Read \`confidenceRule\` before citing anything from \`history\`. No grade may rest`,
    `on a note marked \`inferred\` or \`unverified\`.`,
  ].join("\n");
}

/** The rubric for a finished board — the ordinary case. */
export const GRADE_RUBRIC = gradeRubric("draft");

// ── What comes back ─────────────────────────────────────────────────────────

/** A figure the model says the letter rests on. The number must be findable. */
export type GradeCitation = {
  /** "slots saved by keeping", "playoff odds". What the card prints. */
  label: string;
  value: number;
};

export type AssignedGrade = {
  teamId: string;
  letter: string;
  /** One sentence. Why this letter, in this league's terms. */
  reason: string;
  citations: GradeCitation[];
};

// ── The consistency check ───────────────────────────────────────────────────

/**
 * Reasons that price value in ADP terms.
 *
 * NARROW ON PURPOSE, AND NARROWER THAN THE OBVIOUS VERSION. `rawAdp` is
 * legitimately in the dossier, carried for colour, and a reason is allowed to
 * mention it — so a bare occurrence of the word cannot be the trigger. The
 * first attempt at this looked for ADP anywhere within eighty characters of a
 * value word, which would have rejected "kept him at a round-7 price, +52 slots
 * against redrafting; his ADP is 12" — a sentence that uses the correct
 * yardstick and mentions ADP as an aside. Rejecting that would make the check
 * punish the right answer, and a validator that cries wolf gets switched off.
 *
 * What is caught instead is ADP standing in a COMPARATIVE position: something
 * measured against it, or ADP itself asserting where a player belonged. That is
 * the one use the top of this page has already promised the room it does not
 * make.
 */
const ADP_YARDSTICK_PATTERN = new RegExp(
  [
    // "against ADP", "ahead of his ADP", "twelve spots below consensus ADP".
    String.raw`\b(?:against|versus|vs\.?|compared\s+(?:to|with)|relative\s+to|ahead\s+of|behind|below|above|over|under|past|beat)\s+(?:his\s+|their\s+|the\s+|consensus\s+|market\s+)*adps?\b`,
    // "ADP said 34", "ADP had him in the fourth", "ADP puts him at 51".
    String.raw`\badps?\b\s*(?:said|says|had\s+him|has\s+him|puts?\s+him|placed\s+him|of\s+\d)`,
    // Naming the forbidden yardstick outright.
    String.raw`\bconsensus\s+adps?\b`,
    String.raw`\bexpert\s+(?:consensus\s+)?rankings?\b`,
  ].join("|"),
  "i",
);

/** Rounding slack when matching a cited figure against the evidence. */
const CITATION_TOLERANCE = 0.051;

/**
 * Words that acknowledge contested provenance.
 *
 * Deliberately broad, because the requirement is that the dispute be MENTIONED
 * and the register is judged separately below. Any of these in a reason means the
 * model did not pass the biggest number on the board off as an ordinary one.
 */
const PROVENANCE_ACKNOWLEDGED =
  /\b(disput\w*|contest\w*|unratified|not ratified|never ratified|unsanctioned|unapproved|never approved|no rule|loophole|ballot|vote|asterisk|provenance|went rogue|contract|agreement|reset\w*\s+(?:his\s+|the\s+)?clock)\b/i;

/**
 * Admiration, which is the register the commissioner ruled out.
 *
 * "Don't stroke his ego too much." Separate from the acknowledgement check
 * because the two failures are different: one is hiding the dispute, the other
 * is disclosing it and then praising it anyway. This one is a WARNING — register
 * is a judgement about prose, and a validator that blocked a whole curve on a
 * word-list would be overruling the model on exactly the thing it was given.
 *
 * "Steal" and "bargain" are deliberately absent: both are technical terms on this
 * page, and `biggestSteals` is a dossier field.
 */
const ADMIRING_REGISTER =
  /\b(brilliant|genius|masterclass|masterstroke|master\s?stroke|coup|clinic|magnificent|superb|flawless|immaculate|beautifully|hats off|credit to him|deserves credit|well played|perfectly played|savvy|shrewd)\b/i;

/**
 * Pricing a position off the scoring settings — the Burrow error, exactly.
 *
 * The observed failure was "keepable at a round-3 price, in a league that pays
 * six points for a passing touchdown, and you let him walk": a scoring fact
 * offered as the reason a ROUND price was worth paying. What a position is worth
 * in points says nothing about what it costs in rounds, and this league's own
 * record says nobody has ever paid an early round for a quarterback.
 *
 * Requires the scoring reference AND a PRICE word, so that a reason mentioning
 * the format as colour is not caught — six points a passing touchdown is a real
 * and quotable feature of this league.
 *
 * "Value" and "worth" are deliberately NOT price words here. The first version
 * included them and rejected "six points a passing touchdown is why this league
 * is fun, and he still captured the most value on the board" — a sentence using
 * the correct yardstick with the format as an aside. Value captured is the right
 * language for this page; what must not appear beside the scoring rules is a
 * ROUND price.
 */
const SCORING_AS_PRICE = new RegExp(
  [
    String.raw`\b(?:six|6)\s+points?\b[^.]{0,90}\b(?:keep\w*|price|premium|pays?|paying|cost)\b`,
    String.raw`\bpassing\s+touchdowns?\b[^.]{0,90}\b(?:keep\w*|price|premium|cost)\b`,
    String.raw`\b(?:keep\w*|price|premium)\b[^.]{0,90}\b(?:six|6)\s+points?\b`,
    String.raw`\bscoring\s+(?:settings|format|rules)\b[^.]{0,90}\b(?:keep\w*|price|premium|cost)\b`,
  ].join("|"),
  "i",
);

/**
 * A reason framing an empty starting slot as a fault rather than mentioning it.
 *
 * Shared by the two hole flags so they cannot drift into disagreeing about what
 * counts as calling a slot a deficiency. Both then require the SLOT NAME as
 * well, so this deliberately does not try to be specific on its own.
 */
const HOLE_AS_DEFICIENCY =
  /\b(hole|gap|deficien\w+|missing|empty|nothing at|no\s+\w+\s+at all|glaring|serious|major|structural)\b/i;

/** Blame, for detecting a decline being held against a manager. */
const BLAME_REGISTER =
  /\b(let\s+\w+\s+(?:walk|go)|walked away|passed up|blunder|mistake|error|should have kept|failed to keep|declined|let him walk|gave up on|missed|whiffed|inexplicabl\w+|baffling)\b/i;

/**
 * Credit, for the case where the decline is named approvingly.
 *
 * Naming a defensible decline is GOOD — "he was right to let a round-3
 * quarterback walk" is exactly the sentence this whole mechanism is trying to
 * make possible — so blame detection alone would punish the correct behaviour.
 */
const CREDIT_REGISTER =
  /\b(right to|correctly|sensibly|wisely|good call|obvious call|no one would|nobody would|rightly|sound|defensible|smart to|dodged)\b/i;

/**
 * A bare assertion of one contested final season.
 *
 * The app refuses to state Nacua's clock year on every surface. This catches a
 * reason naming one of the two contested years without presenting both — quoting
 * `clockLabel`, which says "final season disputed (2027 or 2028)", passes because
 * it presents both and says it is disputed.
 */
function assertsContestedSeason(reason: string, seasons: readonly number[]): boolean {
  const named = seasons.filter((s) => new RegExp(`\\b${s}\\b`).test(reason));
  if (!named.length) return false;
  // Both years named together, or the word "disputed" beside them, is the app's
  // own wording rather than a verdict.
  if (named.length === seasons.length) return false;
  return !/disput\w*|contest\w*|or\s+20\d\d/i.test(reason);
}

export type GradeFlagCode =
  | "off-scale"
  | "missing-grade"
  | "duplicate-grade"
  | "unknown-franchise"
  | "ungradable-board"
  | "uncited"
  | "figure-not-in-evidence"
  | "adp-yardstick"
  | "no-discrimination"
  | "a-band-inflation"
  | "contradicts-evidence"
  | "manufactured-failure"
  | "undisclosed-provenance"
  | "admires-disputed-value"
  | "asserts-disputed-clock"
  | "scoring-as-price"
  | "penalises-defensible-decline"
  | "universal-hole-as-deficiency"
  | "post-draft-hole-as-deficiency";

export type GradeFlag = {
  code: GradeFlagCode;
  /**
   * `blocking` means these grades must not be saved. `warning` means a human
   * should look and the grades may still ship. See `GradeValidation`.
   */
  severity: "blocking" | "warning";
  /** Null for a flag about the whole set rather than one franchise. */
  teamId: string | null;
  teamName: string | null;
  /** Plain English, printable in a script or a log without reformatting. */
  message: string;
};

/**
 * The verdict on a set of grades.
 *
 * WHAT BLOCKING MEANS, DECIDED HERE AND NOT LEFT TO A CALLER.
 *
 * A blocking flag drops THE WHOLE SET OF GRADES, and the recap saves and renders
 * without them. Three reasons, in order of how much they matter:
 *
 *   1.  The grades are relative to each other. Dropping one franchise's letter
 *       leaves a nine-team curve that no longer means what it said, and the card
 *       with no grade on it reads as an accusation. A curve is all or nothing.
 *   2.  The blurbs are worth keeping. They cost most of the ~$0.92 a generation
 *       runs, they are checked by their own rules, and throwing them away
 *       because a letter was wrong would make the failure more expensive than
 *       the thing it prevents.
 *   3.  No grade is recoverable in one keystroke — the room re-rolls. A WRONG
 *       grade next to the projected table that contradicts it is not
 *       recoverable, because ten people have already read it.
 *
 * NOTHING HERE EVER REWRITES A GRADE. The model was given the judgement; a
 * silent correction would mean the letter on the card was assigned by neither
 * the model nor a person. Flags name the contradiction and stop.
 */
export type GradeValidation = {
  flags: GradeFlag[];
  /** True when at least one flag is blocking. Do not save the grades. */
  blocking: boolean;
  /** Grades that passed every check, in the order they were given. */
  accepted: AssignedGrade[];
  /** How the letters landed, for the log and for the next run's calibration. */
  distribution: { letter: string; count: number }[];
  /** Steps between the best and worst letter awarded. 0 means all identical. */
  spanSteps: number;
};

/**
 * Every number that could honestly be cited for one franchise.
 *
 * Gathered by walking the franchise's own dossier entry, its projected row and
 * its grade payload and collecting every finite number, rather than by listing
 * fields. The point is to catch an INVENTED figure, not to police which of the
 * real ones the model chose — so the net is deliberately wide, and a field added
 * upstream becomes citable without anybody having to remember to add it here.
 *
 * Shares are added as percentages too. `keeperShare` is 0.62 in the payload and
 * a model quoting "62 percent" is quoting it correctly; rejecting that would
 * make the check punish the right answer.
 */
export function citableFigures(
  dossier: RecapDossier,
  input: GradeInput,
  teamId: string,
): number[] {
  const franchise = dossier.franchises.find((f) => f.teamId === teamId);
  const row = dossier.projectedStandings?.rows.find((r) => r.teamId === teamId);
  const payload = input.franchises.find((f) => f.teamId === teamId);

  const found = new Set<number>();
  const walk = (value: unknown): void => {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return;
      found.add(round1(value));
      // Shares and odds are quoted both ways round.
      if (value > 0 && value <= 1) found.add(round1(value * 100));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value)) walk(item);
    }
  };

  walk(franchise);
  walk(row);
  walk(payload);

  /*
   * League-wide scalars, which belong to every franchise. A grade citing "19
   * keepers out of the pool" or "141 draftable slots" is citing the board, and
   * the board is evidence for all ten.
   */
  walk({
    season: dossier.season,
    rounds: dossier.rounds,
    teamCount: dossier.teamCount,
    keepersOutOfPool: dossier.keepersOutOfPool,
    draftableSlots: dossier.draftableSlots,
    picksEntered: dossier.picksEntered,
    spread: dossier.projectedStandings?.spread,
    leagueAverageByPosition: dossier.leagueAverageByPosition,
  });

  return [...found];
}

/**
 * Runs the assigned grades back over the evidence they claim to rest on.
 *
 * Called after generation and before the recap is saved. It is the whole of the
 * "just be legit" requirement that can be mechanised: the model's judgement is
 * not second-guessed, but a letter that cites a number nobody can find, or that
 * contradicts every figure beside it, does not get to ship quietly.
 */
export function validateGrades({
  dossier,
  input,
  grades,
}: {
  dossier: RecapDossier;
  input: GradeInput;
  grades: readonly AssignedGrade[];
}): GradeValidation {
  const flags: GradeFlag[] = [];
  const byTeam = new Map(input.franchises.map((f) => [f.teamId, f]));
  const nameOf = (teamId: string) => byTeam.get(teamId)?.teamName ?? teamId;

  const flag = (
    code: GradeFlagCode,
    severity: GradeFlag["severity"],
    teamId: string | null,
    message: string,
  ) => {
    flags.push({
      code,
      severity,
      teamId,
      teamName: teamId === null ? null : nameOf(teamId),
      message,
    });
  };

  /*
   * The board first. Grading a board that cannot support a grade is the failure
   * the coverage block exists for, and it is checked here rather than trusted to
   * the prompt: an instruction is not an enforcement.
   */
  if (grades.length && !input.coverage.sufficientToGrade) {
    flag(
      "ungradable-board",
      "blocking",
      null,
      `Grades were assigned against a board that cannot support one. Missing: ` +
        `${input.coverage.missing.join("; ") || "unstated"}.`,
    );
  }

  // Coverage of the ten: every franchise once, nobody twice, nobody invented.
  const seen = new Set<string>();
  for (const grade of grades) {
    if (!byTeam.has(grade.teamId)) {
      flag(
        "unknown-franchise",
        "blocking",
        null,
        `A grade was returned for "${grade.teamId}", which is not a franchise on this board.`,
      );
      continue;
    }
    if (seen.has(grade.teamId)) {
      flag("duplicate-grade", "blocking", grade.teamId, `Two grades were returned for ${nameOf(grade.teamId)}.`);
    }
    seen.add(grade.teamId);
  }
  for (const f of input.franchises) {
    if (!seen.has(f.teamId)) {
      flag("missing-grade", "blocking", f.teamId, `${f.teamName} was not graded.`);
    }
  }

  const valid = grades.filter((g) => byTeam.has(g.teamId));

  for (const grade of valid) {
    const teamName = nameOf(grade.teamId);

    if (!isGradeLetter(grade.letter)) {
      flag(
        "off-scale",
        "blocking",
        grade.teamId,
        `${teamName} was graded "${grade.letter}", which is not on the scale ` +
          `(${GRADE_SCALE.join(" ")}).`,
      );
      continue;
    }

    if (!grade.citations.length) {
      flag(
        "uncited",
        "blocking",
        grade.teamId,
        `${teamName}'s ${grade.letter} cites no figure at all, so there is nothing to check it against.`,
      );
    }

    const evidence = citableFigures(dossier, input, grade.teamId);
    for (const citation of grade.citations) {
      if (!Number.isFinite(citation.value)) {
        flag(
          "figure-not-in-evidence",
          "blocking",
          grade.teamId,
          `${teamName}'s ${grade.letter} cites "${citation.label}" with no usable number.`,
        );
        continue;
      }
      const target = round1(citation.value);
      const matched = evidence.some((v) => Math.abs(v - target) <= CITATION_TOLERANCE);
      if (!matched) {
        flag(
          "figure-not-in-evidence",
          "blocking",
          grade.teamId,
          `${teamName}'s ${grade.letter} cites ${citation.label} = ${citation.value}, ` +
            `which appears nowhere in this franchise's evidence. Either it was invented ` +
            `or it came from outside the board — and external draft position is not the yardstick.`,
        );
      }
    }

    if (ADP_YARDSTICK_PATTERN.test(grade.reason)) {
      flag(
        "adp-yardstick",
        "blocking",
        grade.teamId,
        `${teamName}'s reason prices value against ADP: "${grade.reason.trim()}". ` +
          `Nineteen keepers are out of this pool and the page tells the room ADP is not ` +
          `the yardstick, so a grade argued from it contradicts the top of the same page.`,
      );
    }

    // ── Positional price ──────────────────────────────────────────────────
    const franchise = byTeam.get(grade.teamId)!;

    if (SCORING_AS_PRICE.test(grade.reason)) {
      flag(
        "scoring-as-price",
        "blocking",
        grade.teamId,
        `${teamName}'s reason prices a position off the scoring settings: ` +
          `"${grade.reason.trim()}". What a position is worth in POINTS says nothing ` +
          `about what it costs in ROUNDS. This league pays six for a passing ` +
          `touchdown and has still never seen anybody declare a quarterback keeper ` +
          `dearer than the round in \`positionalNorms\` — price it against that.`,
      );
    }

    /*
     * THE BURROW CHECK. A decline at a price nobody in this league has ever paid
     * is a correct, obvious decision, and a grade that holds it against the
     * manager is making a false claim about his judgement. Fires only when the
     * reason NAMES the player and blames him for it, and not when it names him
     * approvingly — "he was right to let a round-3 quarterback walk" is the
     * sentence this mechanism exists to make possible.
     */
    for (const pass of franchise.keepersIn.passedOn) {
      if (pass.declineWasDefensible !== true) continue;
      const surname = pass.player.split(/\s+/).slice(-1)[0];
      const named =
        grade.reason.toLowerCase().includes(pass.player.toLowerCase()) ||
        (surname.length > 3 && grade.reason.toLowerCase().includes(surname.toLowerCase()));
      if (!named) continue;
      if (!BLAME_REGISTER.test(grade.reason)) continue;
      if (CREDIT_REGISTER.test(grade.reason)) continue;
      flag(
        "penalises-defensible-decline",
        "blocking",
        grade.teamId,
        `${teamName}'s reason holds a correct decision against him: ` +
          `"${grade.reason.trim()}". ${pass.priceContext} Declining it is the obvious ` +
          `call, and this is the error the commissioner caught in the prose — ` +
          `"no one would touch a 3rd round QB keeper, not even close".`,
      );
    }

    /*
     * A hole every franchise shares. WARNING RATHER THAN BLOCKING: how much
     * weight a hole deserves is a judgement, the payload already states
     * `sharedByFranchises` beside it, and blocking a whole curve over emphasis
     * would be overruling the model on the thing it was given. The fact that
     * ALL ten share it is what makes the claim indefensible, so that is the
     * trigger rather than any threshold.
     */
    const universal = (franchise.rosterShape.unfilledStarterSlots ?? []).filter(
      (h) => h.sharedByFranchises === h.ofFranchises && h.ofFranchises > 1,
    );
    for (const hole of universal) {
      const mentioned = new RegExp(`\\b${hole.slot}\\b`, "i").test(grade.reason);
      if (!mentioned) continue;
      if (!HOLE_AS_DEFICIENCY.test(grade.reason)) continue;
      flag(
        "universal-hole-as-deficiency",
        "warning",
        grade.teamId,
        `${teamName}'s reason treats ${hole.slot} as a deficiency, but all ` +
          `${hole.ofFranchises} franchises have that slot open` +
          `${hole.demandMetByRound !== null ? ` and the whole starting demand at the position is off the board by round ${hole.demandMetByRound}` : ""}` +
          `. A hole everybody shares is a stage of the draft, not a verdict on a roster.`,
      );
    }

    /*
     * A slot the league fills off waivers after the draft. BLOCKING, where the
     * shared-hole flag above is only a warning, and the difference is not a
     * matter of degree.
     *
     * The shared-hole rule is about EMPHASIS: the hole is real, the payload
     * states how many franchises share it, and how much weight it deserves is
     * the judgement the model was hired to make. This one is about a FACT the
     * model got wrong. The commissioner has ruled that a missing team defence is
     * not a deficiency in this league at all, because it is replaced off waivers
     * within the week for nothing. Marking a man down for it is the same error as
     * `penalises-defensible-decline`, which blocks for the same reason: a wrong
     * letter beside a receipt that contradicts it is not recoverable once ten
     * people have read it off the screen.
     *
     * It fires on the reason's LANGUAGE, not on the letter, so a blurb that
     * mentions a franchise streaming a defence is untouched — only one that
     * frames it as a gap.
     */
    const postDraft = (franchise.rosterShape.unfilledStarterSlots ?? []).filter(
      (h) => h.filledAfterDraft,
    );
    for (const hole of postDraft) {
      if (!new RegExp(`\\b${hole.slot}\\b`, "i").test(grade.reason)) continue;
      if (!HOLE_AS_DEFICIENCY.test(grade.reason)) continue;
      flag(
        "post-draft-hole-as-deficiency",
        "blocking",
        grade.teamId,
        `${teamName}'s reason holds an open ${hole.slot} against him: ` +
          `"${grade.reason.trim()}". This league fills ${hole.slot} off waivers after ` +
          `the draft, so spending no pick on it is the cheapest correct decision on ` +
          `the board, not a hole. The commissioner ruled on exactly this — ` +
          `"${hole.slot} will be picked up after draft. And he has a point" — so a ` +
          `grade that docks him for it is wrong, not merely over-emphasised.`,
      );
    }

    // ── Disputed provenance ────────────────────────────────────────────────
    const disputed = franchise.keepersIn.disputedProvenance;
    if (disputed.length) {
      /*
       * Only fires when the LETTER LEANS ON the disputed figure. A franchise
       * holding a contested keeper is not thereby required to discuss it in
       * every grade — if the letter was argued from pick capital and roster
       * holes, the dispute is beside the point and demanding a mention would be
       * the validator writing the reason.
       */
      const leansOnIt = grade.citations.some((c) =>
        disputed.some(
          (d) =>
            d.slotsSavedByKeeping !== null &&
            Math.abs(round1(c.value) - round1(d.slotsSavedByKeeping)) <= CITATION_TOLERANCE,
        ),
      );

      if (leansOnIt && !PROVENANCE_ACKNOWLEDGED.test(grade.reason)) {
        flag(
          "undisclosed-provenance",
          "blocking",
          grade.teamId,
          `${teamName}'s ${grade.letter} is argued from ` +
            `${disputed.map((d) => d.player).join(", ")} — the largest value on this ` +
            `board and the one the league never ratified — and the reason does not ` +
            `mention that at all: "${grade.reason.trim()}". The number stands, but a ` +
            `grade that presents it as an ordinary bargain is the page applauding the ` +
            `one transaction the room resents.`,
        );
      }

      if (leansOnIt && ADMIRING_REGISTER.test(grade.reason)) {
        flag(
          "admires-disputed-value",
          "warning",
          grade.teamId,
          `${teamName}'s reason admires value the league never ratified: ` +
            `"${grade.reason.trim()}". Report it, do not compliment it — the biggest ` +
            `number is not automatically the best decision.`,
        );
      }

      /*
       * The hard one. `@/lib/keeper-tenure-dispute` exists because two surfaces
       * once printed two different final seasons for this keeper, and the app's
       * answer was to print neither. A grade naming one would make this the
       * single place in the app that adjudicated a dispute the commissioner is
       * himself a party to.
       */
      for (const d of disputed) {
        if (assertsContestedSeason(grade.reason, d.contestedFinalSeasons)) {
          flag(
            "asserts-disputed-clock",
            "blocking",
            grade.teamId,
            `${teamName}'s reason states a final season for ${d.player}: ` +
              `"${grade.reason.trim()}". That question is unsettled — ` +
              `${d.contestedFinalSeasons.join(" or ")} — and every other surface in ` +
              `this app prints "${d.clockLabel}" rather than picking one. A grade may ` +
              `not be the exception.`,
          );
        }
      }
    }
  }

  // ── The set as a whole ────────────────────────────────────────────────────

  const letters = valid
    .map((g) => g.letter)
    .filter(isGradeLetter);

  const distribution = GRADE_SCALE.map((letter) => ({
    letter: letter as string,
    count: letters.filter((l) => l === letter).length,
  })).filter((row) => row.count > 0);

  const indices = letters.map(gradeIndex);
  const spanSteps = indices.length ? Math.max(...indices) - Math.min(...indices) : 0;

  if (letters.length >= 2 && spanSteps === 0) {
    flag(
      "no-discrimination",
      "blocking",
      null,
      `All ${letters.length} franchises were graded ${letters[0]}. A grade that is the ` +
        `same for everybody is not a grade.`,
    );
  } else if (letters.length >= input.distribution.franchises && spanSteps < input.distribution.minimumSpanSteps) {
    flag(
      "no-discrimination",
      "warning",
      null,
      `All ${letters.length} grades sit within ${spanSteps} step(s) of each other ` +
        `(${distribution.map((d) => `${d.count}×${d.letter}`).join(", ")}). The evidence ` +
        `separates these franchises further than the letters do.`,
    );
  }

  const aBand = letters.filter((l) => gradeBand(l) === "A").length;
  if (aBand > input.distribution.aBandCeiling) {
    flag(
      "a-band-inflation",
      "warning",
      null,
      `${aBand} of ${letters.length} franchises are in the A band, above the ` +
        `${input.distribution.aBandCeiling} this board expects. Either the night was ` +
        `extraordinary or the grades are inflated.`,
    );
  }

  /*
   * THE CONTRADICTION THE COMMISSIONER NAMED, and it is conditional on purpose.
   *
   * A low grade beside a first-place projection is NOT automatically wrong —
   * that is the whole point of grading the draft rather than the roster, and a
   * franchise can lead the table on keepers alone while having drafted poorly.
   * What is wrong is a low grade with nothing supporting it: top of the
   * projected table AND above the median on value captured AND a legal lineup.
   * At that point every figure on the card disagrees with the letter on it.
   */
  for (const grade of valid) {
    if (!isGradeLetter(grade.letter)) continue;
    const f = byTeam.get(grade.teamId)!;
    const band = gradeBand(grade.letter);
    const projection = f.projections;
    const valueAboveMedian = f.valueCaptured.vsLeagueMedian > 0;
    /*
     * TRUE ONLY WHEN SOMEBODY ACTUALLY CHECKED. Null means no lineup was solved,
     * and every contradiction flag below is about a letter disagreeing with the
     * evidence — so an unknown must not be allowed to stand in as evidence
     * either way. On a board with no lineup these flags simply do not fire.
     */
    const unfilled = f.capitalConversion.startersUnfilled;
    /*
     * A slot every franchise in the league has open does not make a lineup
     * illegal in any meaningful sense before the draft — it is the state of all
     * ten boards. Counting it would make the "nothing supports this letter"
     * flags fire on the pre-draft board for everybody at once.
     *
     * A post-draft slot is dropped for a different reason and on every board,
     * finished ones included: the league fills it off waivers within the week,
     * so a franchise missing one can field a lineup by the time a lineup is due.
     * Counting DST here would have let an A-grade draft read as "unable to field
     * DST" on the two 2026 cards that deliberately skipped it.
     */
    const realHoles = (f.rosterShape.unfilledStarterSlots ?? []).filter(
      (h) =>
        !h.filledAfterDraft &&
        !(h.sharedByFranchises === h.ofFranchises && h.ofFranchises > 1),
    );
    const lineupLegal = unfilled === null ? null : realHoles.length === 0;

    if (
      (band === "D" || band === "F") &&
      projection !== null &&
      projection.rank <= 2 &&
      valueAboveMedian &&
      lineupLegal === true
    ) {
      flag(
        "contradicts-evidence",
        "warning",
        grade.teamId,
        `${f.teamName} was graded ${grade.letter} while sitting ${ordinal(projection.rank)} ` +
          `in projected points, above the league median on value captured ` +
          `(${f.valueCaptured.vsLeagueMedian > 0 ? "+" : ""}${f.valueCaptured.vsLeagueMedian} slots) ` +
          `and able to field a legal lineup. Nothing on this card supports the letter.`,
      );
    }

    if (
      band === "A" &&
      projection !== null &&
      projection.rank >= projection.totalRanked - 1 &&
      f.valueCaptured.leagueRank >= input.distribution.franchises - 1 &&
      lineupLegal === false
    ) {
      flag(
        "contradicts-evidence",
        "warning",
        grade.teamId,
        `${f.teamName} was graded ${grade.letter} while ${ordinal(projection.rank)} of ` +
          `${projection.totalRanked} in projected points, ${ordinal(f.valueCaptured.leagueRank)} ` +
          `of ${input.distribution.franchises} on value captured, and unable to field ` +
          `${realHoles.map((h) => h.slot).join(", ")}.`,
      );
    }

    /*
     * The bad-faith F, coming the other way. A franchise at or above the median
     * on value with a legal lineup has not had a D-grade draft, and handing it
     * one to fill out the bottom of the curve is the same failure as inflation.
     */
    if (
      (band === "D" || band === "F") &&
      f.valueCaptured.vsLeagueMedian >= 0 &&
      lineupLegal === true &&
      f.keepersIn.paidOver.length === 0 &&
      f.keepersIn.costlyPasses === 0
    ) {
      flag(
        "manufactured-failure",
        "warning",
        grade.teamId,
        `${f.teamName} was graded ${grade.letter} despite capturing value at or above ` +
          `the league median, fielding a legal lineup, paying over on no keeper and ` +
          `passing on nobody who went earlier than keeping him cost. That is a ` +
          `competent draft being marked down to complete a curve.`,
      );
    }
  }

  const blocking = flags.some((f) => f.severity === "blocking");
  const blockedTeams = new Set(
    flags.filter((f) => f.severity === "blocking").map((f) => f.teamId),
  );

  return {
    flags,
    blocking,
    /*
     * `accepted` is empty when anything blocks, because the curve is the unit —
     * see the note on `GradeValidation`. It is not "the ones that passed".
     */
    accepted: blocking ? [] : valid.filter((g) => !blockedTeams.has(g.teamId)),
    distribution,
    spanSteps,
  };
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

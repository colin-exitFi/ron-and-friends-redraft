/**
 * Proves the draft grade is arguable — that the evidence handed to the model is
 * complete, that absences are labelled rather than zeroed, and that a grade
 * contradicting its own receipts gets caught.
 *
 *   npm run verify:recap:grade                 offline, free, no API key needed
 *   npm run verify:recap:grade -- --straight-face   one paid model call, opt-in
 *
 * ============================================================================
 * WHAT THIS CAN AND CANNOT PROVE, STATED FIRST BECAUSE IT MATTERS MOST
 * ============================================================================
 *
 * The obvious validation for a draft grade is the outcome one: grade the last
 * decade of drafts, then check whether the A-graded franchises contended. THAT
 * VALIDATION CANNOT BE RUN, and no amount of work in this file would change it.
 * Two independent blockers, both about data that is not in the repository:
 *
 *   1.  NO HISTORICAL FINAL STANDINGS. The only standings fact anywhere is
 *       `league.standings2025` in `data/league-history.json` — three positions,
 *       marked `inferred`, reverse-engineered from a quote about the slot
 *       auction, with its own note saying the other seven are unrecorded. No
 *       season-by-season table, no champions list, no win-loss records. There is
 *       no answer key to correlate against.
 *   2.  NO HISTORICAL ADP. The grade's yardstick is where THIS board expected a
 *       player to go, which needs a ranked pool. No past season has one, so no
 *       past pick has an expected slot and no past draft can be scored the way
 *       tonight's will be. This is not a gap that can be filled from inside the
 *       repo.
 *
 * So the outcome backtest is replaced by four validations that are actually
 * possible, and the honest summary of the difference is this: what follows
 * proves the grade is built on complete, correctly-labelled evidence and that a
 * wrong grade is caught. It does not prove that a good grade predicts a good
 * season, and nothing in this repository could.
 *
 *   1.  THE SCALE AND THE RUBRIC. Thirteen steps, no gaps, and the load-bearing
 *       clauses still present — asserted by marker, so rewording a paragraph
 *       cannot silently delete the rule inside it.
 *   2.  THE LIVE BOARD, COMPLETE. A whole mock draft through the real engine,
 *       the real projections and the real dossier, and then every comparative
 *       figure in the payload recomputed off the dossier it came from. This is
 *       the one that says the model will be weighing real numbers.
 *   3.  INPUT FIDELITY ON EIGHT REAL DRAFTS. 2017 through 2025, every pick
 *       accounted for, and — the actual point — every missing input reported as
 *       missing rather than as a zero. A historical board must come back saying
 *       it cannot be graded, because it cannot.
 *   4.  THE STRAIGHT-FACE TEST, on what the league itself remembers. Witte took
 *       Patrick Mahomes with the literal last pick of the 2018 draft and kept
 *       him for years; Joe took Amari Rodgers in round 15 of 2021 and nobody in
 *       this league has seen him since. If the evidence a model is handed does
 *       not point the right way on those two, nothing downstream can.
 *   5.  THE VALIDATOR, both ways round. Every flag must fire on a case built to
 *       trip it AND stay silent on a case built to look like it. A check that
 *       only ever fires is a check nobody will leave switched on.
 *
 * Exits non-zero on the first failure. Nothing is written anywhere.
 */

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import { recapStage } from "@/lib/recap-prompt";
import { allTenureDisputes } from "@/lib/keeper-tenure-dispute";
import {
  readClosedKeeperLists,
  readKeeperOptions,
  readProjectedStandings,
} from "@/lib/recap-source";
import { defaultAssignment, runWholeMock, toMockPool } from "@/lib/mock-draft-run";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import {
  GRADE_BANDS,
  GRADE_CITATION_MARKER,
  GRADE_POSITION_MARKER,
  GRADE_PROVENANCE_MARKER,
  GRADE_RUBRIC,
  GRADE_RULES,
  GRADE_SCALE,
  GRADE_SUBJECT_MARKER,
  GRADE_YARDSTICK_MARKER,
  SUBJECT_LABEL,
  buildGradeInput,
  citableFigures,
  gradeBand,
  gradeRubric,
  gradeSubject,
  isGradeLetter,
  validateGrades,
  type AssignedGrade,
  type GradeFlagCode,
  type GradeInput,
  type PositionalNormsInput,
} from "@/lib/recap-grade";
import { readGradeHistory } from "@/lib/recap-grade-source";
import { FEATURES } from "@/lib/league-config";
import {
  HISTORY_SEASONS,
  fixtureDossier,
  fixtureFranchise,
  historicalDossier,
  loadSeason,
  revealedValue,
} from "./recap-history-drafts.mts";
import type { RecapDossier } from "@/lib/recap-dossier";

let failures = 0;
function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

/** Seeded, so a failure here is reproducible rather than a coin toss. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const history = readGradeHistory();

/**
 * The positional price table, from the module that owns it.
 *
 * IMPORTED DEFENSIVELY, AND THAT IS DELIBERATE RATHER THAN TIMID.
 * `@/lib/positional-norms` belongs to the prose layer and was still untracked
 * when this was written, so a hard import would mean this script — and anything
 * that runs it — could not load on a checkout where that file had not landed
 * yet. The grade itself has no such dependency: `buildGradeInput` takes the
 * norms as a STRUCTURAL parameter (see `PositionalNormsInput`) and reports them
 * absent when nobody supplies any, exactly as it does for projections.
 *
 * So this resolves them if they exist and says so plainly if they do not. The
 * positional checks below then skip themselves rather than failing, because
 * "the other agent's table is not here" is a fact about the checkout and not a
 * defect in the grade.
 */
let positionalNorms: PositionalNormsInput | null = null;
let normsSource = "not present on this checkout";
try {
  const mod = (await import("@/lib/positional-norms")) as {
    positionalNorms?: () => PositionalNormsInput | null;
  };
  positionalNorms = mod.positionalNorms?.() ?? null;
  normsSource = positionalNorms ? "@/lib/positional-norms" : "module present but returned null";
} catch {
  positionalNorms = null;
}
console.log(`\nPositional price norms: ${normsSource}`);

// ============================================================================
section("1. The scale and the rubric");
// ============================================================================

check(
  `thirteen steps, A+ down to F (${GRADE_SCALE.join(" ")})`,
  GRADE_SCALE.length === 13 && GRADE_SCALE[0] === "A+" && GRADE_SCALE[12] === "F",
);
check(
  "every band from A to F is on the scale, and every step is A-F with an optional modifier",
  GRADE_SCALE.every((l) => /^[ABCDF][+-]?$/.test(l)) &&
    new Set(GRADE_SCALE.map(gradeBand)).size === 5,
);
check(
  "the scale has no duplicates and no gaps in the middle bands",
  new Set(GRADE_SCALE).size === GRADE_SCALE.length &&
    (["A", "B", "C"] as const).every(
      (band) => GRADE_SCALE.filter((l) => gradeBand(l) === band).length === 3,
    ),
);
check(
  "every band carries a description written in drafts rather than percentiles",
  GRADE_BANDS.length === 5 &&
    GRADE_BANDS.every((b) => b.means.length > 120) &&
    !GRADE_BANDS.some((b) => /percentile|top \d+%/i.test(b.means)),
);
/*
 * THE HAND IS NOT THE PLAY, AND WHAT "THE HAND" IS DEPENDS ON THE FORMAT.
 *
 * In a keeper league a man walks in holding an inherited roster; in a redraft
 * he walks in holding nothing but the seat the lottery gave him. Either way the
 * F band has to say that the thing he did not choose is not what the letter is
 * for. Asserted in both wordings, plus the shared clause — which makes this
 * check stricter than the one it replaces, not looser.
 */
const fBand = GRADE_BANDS.find((b) => b.band === "F")!.means;
check(
  "the F band explicitly refuses to punish the hand a manager was dealt",
  /the grade is the play/i.test(fBand) &&
    (FEATURES.keepers ? /thin roster/i.test(fBand) : /bad seat in the order/i.test(fBand)),
);

/*
 * The markers. Same device as `SEPARATED_FIELD_MARKER` in the prompt: these are
 * the two rules the commissioner set in terms, and asserting the prose would let
 * a rewrite delete them while the test kept passing.
 */
check(
  `the rubric still says what is being graded (${GRADE_SUBJECT_MARKER})`,
  GRADE_RUBRIC.includes(GRADE_SUBJECT_MARKER),
);
check(
  `…and still forbids the ADP yardstick (${GRADE_YARDSTICK_MARKER})`,
  GRADE_RUBRIC.includes(GRADE_YARDSTICK_MARKER),
);
check(
  `…and still demands receipts (${GRADE_CITATION_MARKER})`,
  GRADE_RUBRIC.includes(GRADE_CITATION_MARKER),
);
/*
 * Asserted against the rubric with its line wrapping collapsed. The rubric is
 * hard-wrapped for a prompt, so "injury and practice status" is split across two
 * lines in the source and a naive regex misses it — which is a test failing on
 * typography rather than on the rule being gone.
 */
const rubricText = GRADE_RUBRIC.replace(/\s+/g, " ");
check(
  "the rubric licenses web research for situation while refusing it for price",
  /injury and practice status/i.test(rubricText) &&
    /measuring a different draft/i.test(rubricText) &&
    /may not be the reason for a letter/i.test(rubricText),
);
check(
  "it warns against both clustering and manufactured spread",
  /clustering everyone into the B band/i.test(rubricText) &&
    /inventing a D so the spread looks decisive/i.test(rubricText),
);
check(
  "it tells the model that first in projected points is not automatically an A",
  /First in projected points is not an A/i.test(rubricText),
);
check(
  "it forbids resting a grade on an inferred history note",
  /inferred/i.test(rubricText) && /No grade may rest on/i.test(rubricText),
);
/*
 * The rubric quotes `GRADE_RULES` rather than paraphrasing it, so that the rule
 * arriving as an instruction and the same rule arriving as data cannot come to
 * disagree. If a future edit rewrites either in its own words, this fails.
 */
check(
  "the rubric and the payload state the four rules in the same words",
  ([GRADE_RULES.yardstick, GRADE_RULES.projectionCaution, GRADE_RULES.researchPermitted, GRADE_RULES.researchForbidden] as const).every(
    (rule) => rubricText.includes(rule.replace(/\s+/g, " ")),
  ),
);
/*
 * The pre-draft rubric is a different document, not the same one with a
 * sentence bolted on. A board with no picks has nothing to say about value
 * captured, and a rubric that asked for it anyway would be inviting the model to
 * narrate empty arrays — which is the fault the commissioner is already
 * complaining about on this page.
 */
const preDraftRubric = gradeRubric("keeper-slate");
check(
  "the pre-draft rubric refuses to call itself a draft grade",
  preDraftRubric.includes(SUBJECT_LABEL["keeper-slate"]) &&
    /NO PICKS HAVE BEEN MADE/i.test(preDraftRubric) &&
    /Do not grade picks that do not exist/i.test(preDraftRubric),
);
check(
  "…and the finished-board rubric does not claim the board is unfinished",
  !/NO PICKS HAVE BEEN MADE/i.test(GRADE_RUBRIC) &&
    !GRADE_RUBRIC.includes(SUBJECT_LABEL["keeper-slate"]),
);

// ============================================================================
section("2. The live board — a whole mock draft, every figure recomputed");
// ============================================================================

const board = getBoard();
const pool = getPlayerPool();

const { view } = runWholeMock({
  board,
  pool: toMockPool(pool),
  archetypes: defaultAssignment(board),
  rng: mulberry32(20260829),
});
check("the mock board finished", view.remaining === 0, `${view.remaining} slots left`);

const dossier = buildRecapDossier({
  view,
  expectedPick: buildExpectedPicks(pool, view.slots),
  pool,
  keeperOptions: readKeeperOptions(),
  closedKeeperLists: readClosedKeeperLists(),
  projectedStandings: readProjectedStandings(view),
});
const live = buildGradeInput({ dossier, history, positionalNorms });

check(
  `all ${dossier.teamCount} franchises are in the payload, once each`,
  live.franchises.length === dossier.teamCount &&
    new Set(live.franchises.map((f) => f.teamId)).size === dossier.teamCount,
);
check(
  "every franchise in the payload is one that is actually on this board",
  live.franchises.every((f) => dossier.franchises.some((d) => d.teamId === f.teamId)),
);
check(
  `the board is gradable (subject "${live.subject}")`,
  live.coverage.sufficientToGrade,
  live.coverage.missing.join("; "),
);
/*
 * THE DUPLICATION CHECK. `gradeSubject` restates the classification that
 * `recapStage` already makes, because the prompt imports the rubric from the
 * grade module and importing back the other way would make a cycle whose
 * members are a const and a function. Restating it is only safe if a drift is
 * caught, which is this.
 */
const stage = recapStage(dossier);
check(
  `the grade's subject agrees with the prompt's stage ("${live.subject}" vs "${stage}")`,
  (live.subject === "draft" && stage === "postdraft") ||
    (live.subject === "keeper-slate" && stage === "predraft") ||
    (live.subject === "partial-draft" && stage === "midraft"),
);
check(
  "the label matches the subject",
  live.subjectLabel === SUBJECT_LABEL[live.subject],
);

/*
 * NO NaN, NO undefined, ANYWHERE. A payload with a NaN in it produces a model
 * citing "NaN slots" on a card, and JSON turns it into null on the way out so
 * nothing upstream notices. Serialised and scanned, which is what the prompt
 * will actually do to it.
 */
const serialised = JSON.stringify(live);
check(
  "the payload serialises with no NaN and no Infinity",
  !/NaN|Infinity/.test(serialised),
);
check(
  "…and carries no undefined-shaped holes",
  !serialised.includes('":,') && !serialised.includes("undefined"),
);

/*
 * THE COMPARATIVE LAYER IS THE WHOLE VALUE OF THIS PAYLOAD, so every figure in
 * it is recomputed here off the dossier it was derived from. If a rank or a
 * median were wrong, the model would weigh a false comparison and the card would
 * print the dossier's true figure beside a verdict argued from a false one.
 */
const valueAll = dossier.franchises.map((f) => f.valueGained);
const trueValueMedian = medianOf(valueAll);
const comparisonErrors: string[] = [];
for (const f of live.franchises) {
  const d = dossier.franchises.find((x) => x.teamId === f.teamId)!;

  const trueRank = valueAll.filter((v) => v > d.valueGained).length + 1;
  if (f.valueCaptured.leagueRank !== trueRank) {
    comparisonErrors.push(`${f.teamName}: value rank ${f.valueCaptured.leagueRank} ≠ ${trueRank}`);
  }
  if (Math.abs(f.valueCaptured.leagueMedian - trueValueMedian) > 0.05) {
    comparisonErrors.push(`${f.teamName}: value median ${f.valueCaptured.leagueMedian} ≠ ${trueValueMedian}`);
  }
  if (Math.abs(f.valueCaptured.vsLeagueMedian - (d.valueGained - trueValueMedian)) > 0.05) {
    comparisonErrors.push(`${f.teamName}: vsMedian is not the difference`);
  }
  const trueSteals = d.picks.filter((p) => p.slotsVsBoard !== null && p.slotsVsBoard <= -12).length;
  const trueReaches = d.picks.filter((p) => p.slotsVsBoard !== null && p.slotsVsBoard >= 12).length;
  if (f.valueCaptured.notableSteals !== trueSteals || f.valueCaptured.notableReaches !== trueReaches) {
    comparisonErrors.push(`${f.teamName}: steal/reach counts wrong`);
  }
  if (f.valueCaptured.unscoredPicks !== d.picks.length - d.scoredPicks) {
    comparisonErrors.push(`${f.teamName}: unscored pick count wrong`);
  }
  if (f.keepersIn.count !== d.keepers.length) {
    comparisonErrors.push(`${f.teamName}: keeper count wrong`);
  }
  // Slots saved must be the sum, or null — never a partial sum.
  const priced = d.keepers.every((k) => k.slotsSavedByKeeping !== null);
  const trueSaved = priced ? d.keepers.reduce((n, k) => n + k.slotsSavedByKeeping!, 0) : null;
  if (f.keepersIn.totalSlotsSaved !== trueSaved) {
    comparisonErrors.push(`${f.teamName}: slots saved ${f.keepersIn.totalSlotsSaved} ≠ ${trueSaved}`);
  }
  // The conversion figures must partition the filled starting slots.
  const filled = d.starters.filter((s) => s.player !== null).length;
  if (
    f.capitalConversion.startersDrafted !== null &&
    f.capitalConversion.startersKept !== null &&
    f.capitalConversion.startersDrafted + f.capitalConversion.startersKept !== filled
  ) {
    comparisonErrors.push(
      `${f.teamName}: drafted+kept starters ` +
        `${f.capitalConversion.startersDrafted}+${f.capitalConversion.startersKept} ≠ ${filled}`,
    );
  }
}
check(
  "every rank, median and derived total recomputes off the dossier",
  comparisonErrors.length === 0,
  comparisonErrors.slice(0, 4).join("; "),
);

/*
 * Ties share the better rank everywhere else on this page, and a grade payload
 * that ranked them densely would let a model call two men with identical value
 * "third and fourth in the room".
 */
check(
  "ties share the better rank",
  live.franchises.every(
    (f) =>
      f.valueCaptured.leagueRank ===
      live.franchises.filter((o) => {
        const mine = dossier.franchises.find((x) => x.teamId === f.teamId)!.valueGained;
        const theirs = dossier.franchises.find((x) => x.teamId === o.teamId)!.valueGained;
        return theirs > mine;
      }).length + 1,
  ),
);

/*
 * THE INHERITED/EARNED SPLIT, which is the intellectual claim of the whole
 * feature. If `draftedShare` were not the complement of `keeperShare` the model
 * would be told the draft was responsible for a share of the projection that it
 * was not, and the grade would drift back towards being a roster ranking.
 */
const withProjection = live.franchises.filter((f) => f.projections !== null);
if (!withProjection.length) {
  console.log(
    "  – no projections snapshot on this checkout, so the inherited/earned split\n" +
      "    cannot be exercised. Run `npm run pull:projections`. Not a failure.",
  );
} else {
  check(
    `every franchise has a projection (${withProjection.length}/${live.franchises.length})`,
    withProjection.length === live.franchises.length,
  );
  check(
    "draftedShare is exactly the complement of keeperShare",
    withProjection.every((f) => {
      const p = f.projections!;
      if (p.keeperShare === null) return p.draftedShare === null;
      return p.draftedShare !== null && Math.abs(p.keeperShare + p.draftedShare - 1) < 0.011;
    }),
  );
  check(
    "the payload carries the caution that says not to grade the roster",
    /Grade the draft, not the inheritance/i.test(live.rules.projectionCaution),
  );
  check(
    "playoff odds are offered as a percentage as well as a share",
    withProjection.every((f) => {
      const p = f.projections!;
      const row = dossier.projectedStandings!.rows.find((r) => r.teamId === f.teamId)!;
      if (row.playoffOdds === null) return p.playoffOddsPercent === null;
      return (
        p.playoffOddsPercent !== null &&
        Math.abs(p.playoffOddsPercent - row.playoffOdds * 100) < 0.06
      );
    }),
  );
  check(
    "the field shape is the dossier's own classification, not a second opinion",
    withProjection.every((f) => f.projections!.fieldShape === dossier.projectedStandings!.spread.shape),
  );
  /*
   * A weakest slot occupied by a kept player is a February decision. Marking it
   * draftable would let the grade dock a manager for a hole he is contractually
   * stuck with, which is the inheritance being graded again by the back door.
   */
  const keeperHeldWeakSlots = live.franchises.filter((f) => {
    const p = f.projections;
    if (!p?.weakestSlot) return false;
    const d = dossier.franchises.find((x) => x.teamId === f.teamId)!;
    const slot = d.starters.find((s) => s.slot === p.weakestSlot);
    return !!slot?.player && d.keepers.some((k) => k.player === slot.player);
  });
  check(
    `a weakest slot held by a keeper is not called draftable (${keeperHeldWeakSlots.length} such)`,
    keeperHeldWeakSlots.every((f) => f.projections!.weakestSlotWasDraftable === false),
  );
}

/*
 * The research brief. The model is being sent to the internet on purpose, and
 * the two halves of the rule have to arrive together — a permitted use with no
 * forbidden use beside it is how ADP becomes the yardstick by accident.
 */
check(
  "every franchise gets names worth researching",
  live.franchises.every((f) => f.research.playersWorthChecking.length > 0),
);
/*
 * BOTH HALVES OF THE RESEARCH RULE, STATED ONCE. They travel at the top of the
 * payload rather than on each franchise — see `GradeRules` for why ten copies
 * was a bug and not a convenience — so what matters is that neither half can
 * arrive without the other.
 */
check(
  "the payload carries both halves of the research rule",
  /injury and practice status/i.test(live.rules.researchPermitted) &&
    /consensus ADP/i.test(live.rules.researchForbidden) &&
    /not the yardstick/i.test(live.rules.yardstick),
);
check(
  "…and states them once rather than once per franchise",
  !serialised.includes("injury and practice status") ||
    serialised.split("injury and practice status").length - 1 === 1,
);
check(
  "keepers are always among the names to check, since their price is the decision",
  live.franchises.every((f) => {
    const d = dossier.franchises.find((x) => x.teamId === f.teamId)!;
    return d.keepers.every((k) => f.research.playersWorthChecking.includes(k.player)) ||
      f.research.playersWorthChecking.length >= 6;
  }),
);

/*
 * Confidence marks. The whole standard of this page is that an inferred thing is
 * not stated as fact, and a mark separated from its fact is how that fails.
 */
check(
  `history reached the payload for ${live.franchises.filter((f) => f.history.length > 0).length} of ${live.franchises.length} franchises`,
  live.coverage.history === "present",
);
check(
  "every history note carries a confidence mark and a source",
  live.franchises.every((f) =>
    f.history.every(
      (n) =>
        ["verified", "derived", "inferred", "unverified"].includes(n.confidence) &&
        n.source.length > 0 &&
        n.fact.length > 0,
    ),
  ),
);
check(
  "the rule for reading those marks travels with them",
  /inferred/i.test(live.confidenceRule) && /never read it aloud as a hard number/i.test(live.confidenceRule),
);
check(
  "history is keyed by short name, so no manager gets another man's notes",
  live.franchises.every((f) => {
    const notes = history[f.teamName] ?? [];
    return f.history.length === notes.length;
  }),
);

const kb = serialised.length / 1024;
const dossierKb = JSON.stringify(dossier).length / 1024;
console.log(
  `  payload is ${kb.toFixed(1)} KB, roughly ${Math.round(serialised.length / 4)} tokens, ` +
    `beside a ${dossierKb.toFixed(1)} KB dossier`,
);
/*
 * TWO BOUNDS, AND NEITHER IS A ROUND NUMBER PICKED BY HAND.
 *
 * This started as "under 40 KB", which was invented before anything had been
 * measured and then failed three times while genuinely useful evidence was being
 * added. Moving a threshold to make a test pass is worthless, so it was replaced
 * with the two limits that can be argued for:
 *
 *   1.  SMALLER THAN THE DOSSIER IT DERIVES FROM. A derived layer larger than
 *       its source is not a derived layer, it is a second copy — which is the one
 *       thing this module's header forbids. This is the bound that actually
 *       bites: it caught 3.4 KB of trade arrays and 1.5 KB of oddity strings
 *       being restated verbatim from the dossier, both of which are now gone.
 *   2.  UNDER 50 KB, so that the two together stay inside the 120 KB ceiling
 *       `verify:recap` already asserts for the dossier alone. That figure is
 *       somebody else's considered limit rather than one invented here.
 */
check(
  `smaller than the dossier it derives from (${kb.toFixed(1)} KB against ${dossierKb.toFixed(1)} KB)`,
  kb < dossierKb,
);
check(
  "…and the two together stay inside the 120 KB prompt ceiling verify:recap asserts",
  kb + dossierKb < 120,
  `${(kb + dossierKb).toFixed(1)} KB combined`,
);

/*
 * AND IT MUST NOT BE A SECOND COPY OF THE BOARD.
 *
 * The rule this module is built on is that no dossier figure is restated,
 * because two copies of a number in one prompt eventually disagree and the room
 * reads both off the same card. Size alone is a poor proxy for that — the first
 * version of this check compared kilobytes and failed on a payload whose bulk
 * was league history, which is not a copy of anything.
 *
 * So the test is the one that actually matters: the dossier names all 160
 * rostered players, and the payload may only name the handful it genuinely needs
 * — the keeper paid over the market, the worst pass, the names worth a search.
 * If the pick list ever gets copied in, this is what notices.
 */
const boardNames = new Set(
  dossier.franchises.flatMap((f) => [
    ...f.picks.map((p) => p.player),
    ...f.keepers.map((k) => k.player),
  ]),
);
const namedInPayload = [...boardNames].filter((name) => serialised.includes(`"${name}"`));
/*
 * The precise version: no franchise's PICK LIST may be reproduced. A raw count of
 * names is the wrong test — the payload legitimately names keepers, the players
 * worth researching and the keeper alternatives a manager declined, and that can
 * reach half the board without a single pick having been copied.
 */
const copiedPickLists = dossier.franchises.filter(
  (f) => f.picks.length > 2 && f.picks.every((p) => serialised.includes(`"${p.player}"`)),
);
check(
  `no franchise's pick list is reproduced (${namedInPayload.length} of ${boardNames.size} players named at all)`,
  copiedPickLists.length === 0,
  copiedPickLists.map((f) => f.teamName).join(", "),
);
check(
  "every block names the dossier field its raw numbers live in",
  live.franchises.every(
    (f) =>
      f.valueCaptured.dossierField.length > 0 &&
      f.keepersIn.dossierField.length > 0 &&
      f.capitalConversion.dossierField.length > 0 &&
      f.rosterShape.dossierField.length > 0 &&
      f.trades.dossierField.length > 0,
  ),
);

// ============================================================================
section("3. Input fidelity across eight real drafts");
// ============================================================================

console.log(
  `  2017, 2018, 2019, 2020, 2021, 2023, 2024, 2025. No 2016 and no 2022 sheet.\n` +
    `  None of them has ADP, projections or a lineup solve, which is the point.\n`,
);

const fidelityErrors: string[] = [];
for (const season of HISTORY_SEASONS) {
  const sheet = loadSeason(season);
  const historic = historicalDossier(season);
  const input = buildGradeInput({ dossier: historic, history, positionalNorms });

  // Nothing dropped, nothing double-counted, nobody invented.
  const accounted = historic.franchises.reduce(
    (n, f) => n + f.picks.length + f.keepers.length,
    0,
  );
  const kept = sheet.filter((p) => p.isKeeper).length;
  const names = historic.franchises.flatMap((f) => [
    ...f.picks.map((p) => p.player),
    ...f.keepers.map((k) => k.player),
  ]);

  if (accounted !== sheet.length) {
    fidelityErrors.push(`${season}: ${accounted} accounted for against ${sheet.length} on the sheet`);
  }
  if (input.franchises.length !== historic.franchises.length) {
    fidelityErrors.push(`${season}: ${input.franchises.length} payloads for ${historic.franchises.length} franchises`);
  }
  if (new Set(historic.franchises.map((f) => f.teamId)).size !== historic.franchises.length) {
    fidelityErrors.push(`${season}: a franchise appears twice`);
  }
  const json = JSON.stringify(input);
  if (/NaN|Infinity/.test(json)) fidelityErrors.push(`${season}: payload contains NaN or Infinity`);

  /*
   * THE LOAD-BEARING ASSERTION OF THIS WHOLE SECTION. A historical board has no
   * yardstick, so it cannot be graded, and the module has to SAY SO rather than
   * hand over ten franchises who each captured zero slots of value. If this ever
   * passes as gradable, the grade has become something other than a measure of
   * value against the board.
   */
  if (input.coverage.sufficientToGrade) {
    fidelityErrors.push(`${season}: reported as gradable, but it has no board expectation`);
  }
  if (input.coverage.boardExpectation !== "absent") {
    fidelityErrors.push(`${season}: claims a board expectation it does not have`);
  }
  if (input.coverage.projections !== "absent" || input.coverage.lineup !== "absent") {
    fidelityErrors.push(`${season}: claims projections or a lineup it does not have`);
  }
  if (!input.coverage.missing.length) {
    fidelityErrors.push(`${season}: reports nothing missing on a board missing three things`);
  }

  // Absent is never zero. These are the four fields where a zero would read as
  // a verdict rather than as an absence.
  for (const f of input.franchises) {
    if (f.projections !== null) fidelityErrors.push(`${season}/${f.teamName}: invented a projection`);
    if (f.capitalConversion.startersDrafted !== null) {
      fidelityErrors.push(`${season}/${f.teamName}: claims ${f.capitalConversion.startersDrafted} drafted starters with no lineup`);
    }
    if (f.capitalConversion.startersUnfilled !== null) {
      fidelityErrors.push(`${season}/${f.teamName}: claims a legal lineup with no lineup solved`);
    }
    if (f.rosterShape.unfilledStarterSlots !== null) {
      fidelityErrors.push(`${season}/${f.teamName}: claims no holes with no lineup solved`);
    }
    const d = historic.franchises.find((x) => x.teamId === f.teamName)!;
    if (d.keepers.length && f.keepersIn.totalSlotsSaved !== null) {
      fidelityErrors.push(`${season}/${f.teamName}: priced ${d.keepers.length} keepers with no ADP`);
    }
    if (f.valueCaptured.unscoredPicks !== d.picks.length) {
      fidelityErrors.push(`${season}/${f.teamName}: ${f.valueCaptured.unscoredPicks} unscored of ${d.picks.length}`);
    }
  }

  console.log(
    `  ${season}: ${sheet.length} slots (${kept} kept, ${sheet.length - kept} drafted) · ` +
      `${historic.franchises.length} franchises · ${new Set(names).size} distinct players · ` +
      `gradable=${input.coverage.sufficientToGrade}`,
  );
}
check(
  `every pick in all eight seasons survives into a payload, and every absence is labelled`,
  fidelityErrors.length === 0,
  fidelityErrors.slice(0, 6).join("; "),
);

/*
 * 2017 is the only season whose sheet distinguishes a keeper from a pick — it
 * marks them `*K*` in the text where every other sheet used cell highlighting
 * that the extraction dropped. So it is the only historical board that can
 * exercise the keeper path at all, and the version it exercises is the honest
 * one: keepers present, prices unknown.
 */
const s2017 = historicalDossier(2017);
const keepers2017 = s2017.franchises.reduce((n, f) => n + f.keepers.length, 0);
check(
  `2017 recovers its keepers from the sheet's own marks (${keepers2017} of them)`,
  keepers2017 === 19 && s2017.keepersOutOfPool === 19,
  `${keepers2017} found`,
);
check(
  "…and prices none of them, because there is no historical ADP to price against",
  s2017.franchises.every((f) => f.keepers.every((k) => k.slotsSavedByKeeping === null)),
);
check(
  "…and does not count a keeper's round as draftable capital",
  s2017.franchises.every(
    (f) =>
      f.pickCapital.keeperConsumedRounds.length === f.keepers.length &&
      f.pickCapital.draftableRounds.length === f.picks.length,
  ),
);

// ============================================================================
section("4. The straight-face test against what the league remembers");
// ============================================================================

/*
 * Two picks in this league's history are canon, and `data/league-history.json`
 * records both with sources. They are the closest thing to an answer key that
 * exists, and what they can test is whether the EVIDENCE points the right way —
 * because if it does not, no rubric and no model can rescue the grade.
 *
 * The measure is `revealedValue`: how many later seasons a drafted player went
 * on to appear in anywhere in this league, and whether his own manager paid to
 * keep him the very next year. It is recorded league behaviour rather than a
 * model of it, which is why it survives the absence of standings.
 */
const r2018 = revealedValue(2018);
const ranked2018 = [...r2018].sort((a, b) => b.lateAndLasted - a.lateAndLasted);
const mahomes = r2018.find((p) => /mahomes/i.test(p.player));

check(
  "Mahomes is on the 2018 board at the last pick of the draft",
  !!mahomes && mahomes.round === 16 && mahomes.overallPick === 160 && mahomes.manager === "Witte",
  mahomes ? `R${mahomes.round} p${mahomes.overallPick} to ${mahomes.manager}` : "not found",
);
check(
  `…and the revealed-value measure makes him the best pick of that draft (${mahomes?.lateAndLasted})`,
  ranked2018[0]?.player === mahomes?.player,
  `top was ${ranked2018[0]?.player} (${ranked2018[0]?.lateAndLasted})`,
);
check(
  "…kept forward by the same manager the following season, as the history file says",
  mahomes?.keptForward === true,
);

const r2021 = revealedValue(2021);
const rodgers = r2021.find((p) => /amari rodgers/i.test(p.player));
check(
  "Amari Rodgers is on the 2021 board in round 15, to Joe",
  !!rodgers && rodgers.round === 15 && rodgers.manager === "Joe",
  rodgers ? `R${rodgers.round} p${rodgers.overallPick} to ${rodgers.manager}` : "not found",
);
check(
  "…and the measure records that nobody in this league ever wanted him again",
  rodgers?.survivingSeasons === 0 && rodgers?.keptForward === false,
  `survived ${rodgers?.survivingSeasons}`,
);

/*
 * And the measure must discriminate, or it is passing the two checks above by
 * being flat. A draft where every pick scores the same tells the model nothing.
 */
const spread2018 = new Set(r2018.map((p) => p.lateAndLasted)).size;
check(
  `the measure separates the 2018 board (${spread2018} distinct scores across ${r2018.length} picks)`,
  spread2018 > 20,
);
console.log(`\n  2018, by revealed value — the five the league was proved right about:`);
for (const p of ranked2018.slice(0, 5)) {
  console.log(
    `    ${String(p.lateAndLasted).padStart(3)}  R${String(p.round).padStart(2)} p${String(p.overallPick).padStart(3)} ` +
      `${p.player.padEnd(20)} ${p.manager.padEnd(8)} survived ${p.survivingSeasons} later seasons` +
      `${p.keptForward ? ", kept forward" : ""}`,
  );
}
const vanished2021 = r2021.filter((p) => p.survivingSeasons === 0);
console.log(
  `\n  2021: ${vanished2021.length} of ${r2021.length} picks never appeared in this league again.\n` +
    `    Joe's among them: ${vanished2021
      .filter((p) => p.manager === "Joe")
      .map((p) => `${p.player} (R${p.round})`)
      .join(", ")}`,
);

console.log(
  `\n  WHAT THIS DOES NOT SHOW: whether Witte's 2018 season was any good. There are no\n` +
    `  historical standings in this repository, so the measure above is "did the league\n` +
    `  keep wanting the player", not "did the franchise contend". Those are different\n` +
    `  claims and only the first one is available.`,
);

// ============================================================================
section("5. Edge cases");
// ============================================================================

/** Ten franchises with nothing in them, for the degenerate boards. */
function bareBoard(overrides: Partial<RecapDossier> = {}): RecapDossier {
  return fixtureDossier({
    franchises: Array.from({ length: 10 }, (_, i) =>
      fixtureFranchise({ teamId: `t${i + 1}`, teamName: `Team${i + 1}`, draftSlot: i + 1 }),
    ),
    ...overrides,
  });
}

// --- A board with no picks at all: the state the app is in right now ---------
const preDraft = bareBoard({ picksEntered: 0, boardComplete: false, keepersOutOfPool: 19 });
const preDraftInput = buildGradeInput({ dossier: preDraft, history, positionalNorms });
check(
  `a board with no picks is a keeper slate, not a draft ("${preDraftInput.subject}")`,
  preDraftInput.subject === "keeper-slate" &&
    preDraftInput.subjectLabel === "Keeper slate grade",
);
check(
  "…and its note says in terms that it is not a draft grade",
  /not a draft grade/i.test(preDraftInput.subjectNote),
);
check(
  "…and it does not claim ten franchises captured zero value as a verdict",
  preDraftInput.franchises.every((f) => f.valueCaptured.unscoredPicks === 0 && f.projections === null),
);
check(
  `…and it agrees with the prompt's own pre-draft stage`,
  gradeSubject(preDraft) === "keeper-slate" && recapStage(preDraft) === "predraft",
);

// --- A franchise with no picks while others have some -----------------------
const withOnePickless = bareBoard({
  picksEntered: 1,
  boardComplete: false,
  franchises: [
    fixtureFranchise({
      teamId: "t1",
      teamName: "Team1",
      picks: [
        {
          label: "1.01",
          round: 1,
          overallPick: 1,
          player: "A Player",
          position: "RB",
          nflTeam: "KC",
          rawAdp: 3,
          expectedPick: 4,
          slotsVsBoard: 3,
          acquiredFrom: null,
        },
      ],
      valueGained: -3,
      averageSlotsVsBoard: 3,
      scoredPicks: 1,
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      fixtureFranchise({ teamId: `t${i + 2}`, teamName: `Team${i + 2}` }),
    ),
  ],
});
const pickless = buildGradeInput({ dossier: withOnePickless, history, positionalNorms });
check(
  "a franchise that has not picked still gets a payload rather than being skipped",
  pickless.franchises.length === 10,
);
check(
  "…and its value figures are honest zeroes with zero unscored picks, not nulls",
  pickless.franchises.slice(1).every((f) => f.valueCaptured.unscoredPicks === 0),
);
check(
  "…and the one franchise that reached is ranked last on value, not first",
  pickless.franchises[0].valueCaptured.leagueRank === 10,
  `rank ${pickless.franchises[0].valueCaptured.leagueRank}`,
);

// --- A franchise that traded everything away -------------------------------
const strippedBoard = bareBoard({
  picksEntered: 0,
  franchises: [
    fixtureFranchise({
      teamId: "t1",
      teamName: "Stripped",
      pickCapital: {
        ...fixtureFranchise({ teamId: "x", teamName: "x" }).pickCapital,
        surrendered: Array.from({ length: 16 }, (_, i) => ({ round: i + 1, to: "Team2" })),
        emptyRounds: Array.from({ length: 16 }, (_, i) => i + 1),
        longestGapRounds: 16,
        longestGapAfterRound: 0,
      },
      draftCapital: {
        picksHeld: 0,
        acquired: 0,
        tradedAway: 16,
        firstPickLabel: null,
        firstPickOverall: null,
        hasFirstRoundPick: false,
        roundsWithNoPick: Array.from({ length: 16 }, (_, i) => i + 1),
      },
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      fixtureFranchise({ teamId: `t${i + 2}`, teamName: `Team${i + 2}` }),
    ),
  ],
});
const stripped = buildGradeInput({ dossier: strippedBoard, history, positionalNorms });
check(
  "a franchise that traded every pick away is described rather than crashing",
  stripped.franchises[0].trades.surrenderedCount === 16 &&
    stripped.franchises[0].trades.netEarlyRounds === -6,
  `net early ${stripped.franchises[0].trades.netEarlyRounds}`,
);
check(
  "…and it is ranked the busiest franchise in the room",
  stripped.franchises[0].trades.activityRank === 1,
);
check(
  "…and it names the counterparty rather than repeating the dossier's pick list",
  stripped.franchises[0].trades.counterparties.join(",") === "Team2" &&
    !("surrendered" in stripped.franchises[0].trades),
);

// --- An all-keeper roster: every slot spent before the draft ----------------
const allKeeperBoard = bareBoard({
  keepersOutOfPool: 2,
  franchises: [
    fixtureFranchise({
      teamId: "t1",
      teamName: "AllKeeper",
      keepers: [
        {
          player: "Kept One",
          position: "WR",
          costRound: 3,
          label: "3.01",
          costOverallPick: 21,
          rawAdp: 8,
          pickIfReleased: 9,
          slotsSavedByKeeping: 12,
        },
        {
          player: "Kept Two",
          position: "RB",
          costRound: 5,
          label: "5.01",
          costOverallPick: 41,
          rawAdp: 60,
          pickIfReleased: 62,
          slotsSavedByKeeping: -21,
        },
      ],
      starters: [
        { slot: "WR1", player: "Kept One", position: "WR" },
        { slot: "RB1", player: "Kept Two", position: "RB" },
      ],
      openStarterSlots: ["QB", "RB2", "WR2", "TE", "FLEX1", "FLEX2", "DST"],
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      fixtureFranchise({ teamId: `t${i + 2}`, teamName: `Team${i + 2}` }),
    ),
  ],
});
const allKeeper = buildGradeInput({ dossier: allKeeperBoard, history, positionalNorms });
const ak = allKeeper.franchises[0];
check(
  "an all-keeper roster reports its keeper total as the sum of both prices",
  ak.keepersIn.totalSlotsSaved === -9,
  `${ak.keepersIn.totalSlotsSaved}`,
);
check(
  "…and names the keeper that was paid over the market, not just the total",
  ak.keepersIn.paidOver.length === 1 && ak.keepersIn.paidOver[0].player === "Kept Two",
);
check(
  "…and both its starters are counted as inherited, none as drafted",
  ak.capitalConversion.startersKept === 2 && ak.capitalConversion.startersDrafted === 0,
  `kept ${ak.capitalConversion.startersKept}, drafted ${ak.capitalConversion.startersDrafted}`,
);
check(
  "…and the seven slots it cannot fill are reported as holes",
  ak.capitalConversion.startersUnfilled?.length === 7,
);

// --- An unpriced keeper poisons the total rather than being counted as zero --
const unpricedBoard = bareBoard({
  franchises: [
    fixtureFranchise({
      teamId: "t1",
      teamName: "Unpriced",
      keepers: [
        {
          player: "Priced",
          position: "WR",
          costRound: 3,
          label: "3.01",
          costOverallPick: 21,
          rawAdp: 8,
          pickIfReleased: 9,
          slotsSavedByKeeping: 12,
        },
        {
          player: "Unpriceable",
          position: "TE",
          costRound: 9,
          label: "9.01",
          costOverallPick: 81,
          rawAdp: null,
          pickIfReleased: null,
          slotsSavedByKeeping: null,
        },
      ],
    }),
    ...Array.from({ length: 9 }, (_, i) =>
      fixtureFranchise({ teamId: `t${i + 2}`, teamName: `Team${i + 2}` }),
    ),
  ],
});
const unpriced = buildGradeInput({ dossier: unpricedBoard, history, positionalNorms });
check(
  "one unpriced keeper makes the total null rather than a partial sum",
  unpriced.franchises[0].keepersIn.totalSlotsSaved === null &&
    unpriced.franchises[0].keepersIn.leagueRank === null,
);
check(
  "…and the board reports the counterfactual as absent",
  unpriced.coverage.keeperCounterfactual === "absent" &&
    unpriced.coverage.sufficientToGrade === false,
);

// --- Ties -------------------------------------------------------------------
const tiedBoard = bareBoard({
  picksEntered: 10,
  boardComplete: true,
  franchises: Array.from({ length: 10 }, (_, i) =>
    fixtureFranchise({
      teamId: `t${i + 1}`,
      teamName: `Team${i + 1}`,
      valueGained: 7,
      scoredPicks: 1,
      picks: [
        {
          label: "1.01",
          round: 1,
          overallPick: i + 1,
          player: `P${i}`,
          position: "RB",
          nflTeam: null,
          rawAdp: null,
          expectedPick: i + 8,
          slotsVsBoard: -7,
          acquiredFrom: null,
        },
      ],
    }),
  ),
});
const tied = buildGradeInput({ dossier: tiedBoard, history, positionalNorms });
check(
  "ten franchises tied on value all share rank 1",
  tied.franchises.every((f) => f.valueCaptured.leagueRank === 1),
);
check(
  "…and all sit exactly on the median, which is their own figure",
  tied.franchises.every((f) => f.valueCaptured.vsLeagueMedian === 0 && f.valueCaptured.leagueMedian === 7),
);
check(
  "…and the best and worst in the room are the same number",
  tied.franchises.every(
    (f) => f.valueCaptured.leagueBest.slotsGained === f.valueCaptured.leagueWorst.slotsGained,
  ),
);

// ============================================================================
section("6. The validator, both ways round");
// ============================================================================

/**
 * A set of grades that should pass cleanly, built off the live board.
 *
 * Every citation is a real figure taken from the evidence rather than typed in,
 * which is also a test of `citableFigures`: if the gathering were wrong, the
 * clean set would fail and the whole check would be measuring nothing.
 */
const spreadLetters = ["A", "A-", "B+", "B", "B", "B-", "C+", "C", "C-", "D+"];
function cleanGrades(input: GradeInput = live, dossierFor: RecapDossier = dossier): AssignedGrade[] {
  return input.franchises.map((f, i) => {
    const evidence = citableFigures(dossierFor, input, f.teamId);
    return {
      teamId: f.teamId,
      letter: spreadLetters[i % spreadLetters.length],
      reason: `Measured against where this board expected each player, ${f.teamName} landed here.`,
      citations: [
        { label: "slots of value captured", value: evidence[0] },
        { label: "value rank in the league", value: f.valueCaptured.leagueRank },
      ],
    };
  });
}

const clean = validateGrades({ dossier, input: live, grades: cleanGrades() });
check(
  "a well-formed set of grades raises nothing",
  clean.flags.length === 0 && !clean.blocking,
  clean.flags.map((f) => `${f.code}: ${f.message}`).join(" | "),
);
check(
  "…and every one of them is accepted",
  clean.accepted.length === live.franchises.length,
);
check(
  `…and the span is reported (${clean.spanSteps} steps, ${clean.distribution.map((d) => `${d.count}×${d.letter}`).join(" ")})`,
  clean.spanSteps > 0 && clean.distribution.reduce((n, d) => n + d.count, 0) === 10,
);

/** Runs one mutation of the clean set and reports which codes came back. */
function codesFor(mutate: (grades: AssignedGrade[]) => AssignedGrade[], input = live): {
  codes: GradeFlagCode[];
  blocking: boolean;
  accepted: number;
} {
  const result = validateGrades({ dossier, input, grades: mutate(cleanGrades(input)) });
  return {
    codes: [...new Set(result.flags.map((f) => f.code))],
    blocking: result.blocking,
    accepted: result.accepted.length,
  };
}

const offScale = codesFor((g) => [{ ...g[0], letter: "A++" }, ...g.slice(1)]);
check(
  "a letter that is not on the scale blocks",
  offScale.codes.includes("off-scale") && offScale.blocking,
  offScale.codes.join(","),
);

const missing = codesFor((g) => g.slice(1));
check(
  "a franchise left ungraded blocks",
  missing.codes.includes("missing-grade") && missing.blocking,
  missing.codes.join(","),
);

const duplicated = codesFor((g) => [...g, { ...g[0], letter: "F" }]);
check(
  "two grades for one franchise block",
  duplicated.codes.includes("duplicate-grade") && duplicated.blocking,
  duplicated.codes.join(","),
);

const stranger = codesFor((g) => [...g, { ...g[0], teamId: "not-a-team" }]);
check(
  "a grade for a franchise that is not on the board blocks",
  stranger.codes.includes("unknown-franchise") && stranger.blocking,
  stranger.codes.join(","),
);

const uncited = codesFor((g) => [{ ...g[0], citations: [] }, ...g.slice(1)]);
check(
  "a grade citing nothing blocks",
  uncited.codes.includes("uncited") && uncited.blocking,
  uncited.codes.join(","),
);

/*
 * THE ONE THAT MATTERS MOST. A model that invents a figure is the specific way
 * this feature discredits itself — a card printing a number the room can check
 * and find nowhere. 999999 cannot be anywhere in the evidence.
 */
const invented = codesFor((g) => [
  { ...g[0], citations: [{ label: "slots saved", value: 999_999 }] },
  ...g.slice(1),
]);
check(
  "a cited figure that appears nowhere in the evidence blocks",
  invented.codes.includes("figure-not-in-evidence") && invented.blocking,
  invented.codes.join(","),
);
check(
  "…and nothing is accepted when anything blocks, because a curve is all or nothing",
  invented.accepted === 0,
);

/*
 * The ADP rule, in both directions. The forbidden use is ADP standing as the
 * benchmark; the permitted use is ADP as colour beside the right yardstick. A
 * validator that caught the second would be punishing the correct answer, and
 * would be switched off within a week.
 */
const adpYardstick = codesFor((g) => [
  {
    ...g[0],
    reason: "Took him eleven spots ahead of his ADP, which is a reach in anybody's book.",
  },
  ...g.slice(1),
]);
check(
  "pricing a pick against ADP blocks",
  adpYardstick.codes.includes("adp-yardstick") && adpYardstick.blocking,
  adpYardstick.codes.join(","),
);
const adpColour = codesFor((g) => [
  {
    ...g[0],
    reason:
      "Kept him at a round-7 price for +52 slots against redrafting him on this board; " +
      "his ADP is 12, for the curious.",
  },
  ...g.slice(1),
]);
check(
  "…while mentioning ADP as colour beside the right yardstick does not",
  !adpColour.codes.includes("adp-yardstick"),
  adpColour.codes.join(","),
);
const rankingsYardstick = codesFor((g) => [
  { ...g[0], reason: "Expert consensus rankings had him two rounds later, so this was a steal." },
  ...g.slice(1),
]);
check(
  "…and borrowing expert rankings as the yardstick blocks too",
  rankingsYardstick.codes.includes("adp-yardstick"),
  rankingsYardstick.codes.join(","),
);

const identical = codesFor((g) => g.map((x) => ({ ...x, letter: "B" })));
check(
  "ten identical grades block — a grade that is the same for everybody is not a grade",
  identical.codes.includes("no-discrimination") && identical.blocking,
  identical.codes.join(","),
);

const clustered = codesFor((g) =>
  g.map((x, i) => ({ ...x, letter: ["B+", "B", "B-"][i % 3] })),
);
check(
  "grades clustered inside three steps warn without blocking",
  clustered.codes.includes("no-discrimination") && !clustered.blocking,
  `${clustered.codes.join(",")} blocking=${clustered.blocking}`,
);

const inflated = codesFor((g) =>
  g.map((x, i) => ({ ...x, letter: i < 5 ? "A" : ["B", "C", "C-", "D", "F"][i - 5] })),
);
check(
  "five A grades warn about inflation without blocking",
  inflated.codes.includes("a-band-inflation") && !inflated.blocking,
  `${inflated.codes.join(",")} blocking=${inflated.blocking}`,
);

/*
 * Grading a board that cannot be graded. This is the historical case arriving
 * through the front door: an instruction in a rubric is not an enforcement, so
 * the coverage gate is checked here rather than trusted.
 */
const historical = historicalDossier(2018);
const historicalInput = buildGradeInput({ dossier: historical, history, positionalNorms });
const ungradable = validateGrades({
  dossier: historical,
  input: historicalInput,
  grades: historicalInput.franchises.map((f, i) => ({
    teamId: f.teamId,
    letter: spreadLetters[i],
    reason: "A confident letter on a board with no yardstick.",
    citations: [{ label: "picks held", value: 16 }],
  })),
});
check(
  "grading a board with no yardstick blocks, whatever the rubric said",
  ungradable.flags.some((f) => f.code === "ungradable-board") && ungradable.blocking,
  ungradable.flags.map((f) => f.code).join(","),
);
check(
  "…and the flag says what was missing rather than just refusing",
  ungradable.flags.find((f) => f.code === "ungradable-board")!.message.includes("board-relative"),
);

/*
 * The contradiction the commissioner named, and the conditional it has to be.
 * A D beside a first-place projection is only wrong when NOTHING supports it —
 * a franchise can top the table on keepers alone and still have drafted badly,
 * and flagging that would be the validator insisting on the roster ranking this
 * whole module refuses to be.
 */
const topByPoints = live.franchises.find((f) => f.projections?.rank === 1);
if (!topByPoints) {
  console.log("  – no projections on this checkout, so the contradiction flags cannot fire here.");
} else {
  const contradiction = validateGrades({
    dossier,
    input: live,
    grades: cleanGrades().map((g) =>
      g.teamId === topByPoints.teamId ? { ...g, letter: "D" } : g,
    ),
  });
  const fired = contradiction.flags.filter((f) => f.teamId === topByPoints.teamId);
  const supported =
    topByPoints.valueCaptured.vsLeagueMedian > 0 &&
    topByPoints.capitalConversion.startersUnfilled?.length === 0;
  check(
    supported
      ? `a D for the projected leader with above-median value and a legal lineup is flagged (${topByPoints.teamName})`
      : `a D for the projected leader is NOT flagged, because its own value is below the median (${topByPoints.teamName}, ${topByPoints.valueCaptured.vsLeagueMedian} slots)`,
    supported
      ? fired.some((f) => f.code === "contradicts-evidence")
      : !fired.some((f) => f.code === "contradicts-evidence"),
    fired.map((f) => f.code).join(","),
  );
  check(
    "…and a contradiction warns rather than blocking, because the judgement is the model's",
    !contradiction.flags.some((f) => f.code === "contradicts-evidence" && f.severity === "blocking"),
  );
}

/*
 * And the bad-faith F, which the original brief called out by name: a franchise
 * that drafted competently must not be marked down to fill out a curve.
 *
 * BUILT RATHER THAN FOUND. This was first written to look for a clean franchise
 * on the live mock board and skip if there wasn't one — and there wasn't, so the
 * check silently did nothing. A test that only runs when the fixture happens to
 * suit it is a test that will be absent on the night it is needed, so the case
 * is constructed: exactly median on value, a legal lineup, no keeper paid over,
 * nobody passed on who went earlier than keeping cost.
 */
const competentBoard = bareBoard({
  picksEntered: 20,
  boardComplete: true,
  franchises: Array.from({ length: 10 }, (_, i) =>
    fixtureFranchise({
      teamId: `t${i + 1}`,
      teamName: `Team${i + 1}`,
      valueGained: 4,
      scoredPicks: 2,
      starters: [{ slot: "QB", player: `QB${i}`, position: "QB" }],
      picks: [
        {
          label: "1.01",
          round: 1,
          overallPick: i + 1,
          player: `QB${i}`,
          position: "QB",
          nflTeam: null,
          rawAdp: null,
          expectedPick: i + 5,
          slotsVsBoard: -4,
          acquiredFrom: null,
        },
      ],
      keepers: [
        {
          player: `Kept${i}`,
          position: "WR",
          costRound: 4,
          label: "4.01",
          costOverallPick: 31,
          rawAdp: null,
          pickIfReleased: 20,
          slotsSavedByKeeping: 11,
        },
      ],
    }),
  ),
});
const competentInput = buildGradeInput({ dossier: competentBoard, history, positionalNorms });
const manufactured = validateGrades({
  dossier: competentBoard,
  input: competentInput,
  /*
   * Only the first franchise is marked down. The other nine take letters from
   * the A-to-C range on purpose: every franchise on this fixture is identically
   * competent, so a D+ anywhere else would trip the same flag correctly and the
   * count below would be measuring the fixture rather than the rule.
   */
  grades: competentInput.franchises.map((f, i) => ({
    teamId: f.teamId,
    letter: i === 0 ? "F" : ["A", "A-", "B+", "B", "B", "B-", "C+", "C", "C-"][i - 1],
    reason: "Marked down to make the curve look decisive.",
    citations: [{ label: "slots of value captured", value: 4 }],
  })),
});
check(
  "an F for a demonstrably competent draft is flagged as manufactured",
  manufactured.flags.some((f) => f.code === "manufactured-failure" && f.teamId === "t1"),
  manufactured.flags.map((f) => f.code).join(","),
);
check(
  "…and it warns rather than blocking, because the judgement is still the model's",
  !manufactured.flags.some(
    (f) => f.code === "manufactured-failure" && f.severity === "blocking",
  ),
);
check(
  "…while the competent franchises graded normally raise no such flag",
  manufactured.flags.filter((f) => f.code === "manufactured-failure").length === 1,
);

// ── Positional price ────────────────────────────────────────────────────────

/*
 * THE BURROW ERROR. The recap told Joe that "Joe Burrow was keepable at a
 * round-3 price, in a league that pays six points for a passing touchdown, and
 * you let him walk." The commissioner: "No one would touch a 3rd round QB
 * keeper, not even close."
 *
 * The league's own record settles it, and these checks are the record.
 */
if (!positionalNorms) {
  console.log(
    "  – no positional norms on this checkout, so the price rules cannot be\n" +
      "    exercised against real figures. The grade reports them absent and the\n" +
      "    rubric tells the model it has no positional price context. Not a failure.",
  );
} else {
  const price = (p: string) => positionalNorms!.keeperPrices.find((r) => r.position === p);
  const supply = (p: string) => positionalNorms!.draftPrices.find((r) => r.position === p);
  const qb = price("QB");
  const wr = price("WR");

  console.log(
    `  from ${positionalNorms.seasons.length} seasons ` +
      `(${positionalNorms.seasons.join(", ")}) and ${positionalNorms.declarations} declarations:`,
  );
  for (const k of positionalNorms.keeperPrices) {
    const d = supply(k.position);
    console.log(
      `    ${k.position.padEnd(4)} keeper: n=${String(k.declarations).padStart(3)} ` +
        `dearest ${k.mostExpensiveRound === null ? "never kept" : `R${k.mostExpensiveRound}`} ` +
        `median ${k.medianRound === null ? "—" : `R${k.medianRound}`}  ·  ` +
        `draft: starts ${d?.starterDemand ?? "?"}, first usually R${d?.firstDraftedMedianRound ?? "?"}, ` +
        `demand met by R${d?.demandMetMedianRound ?? "never"}`,
    );
  }

  /*
   * STRUCTURAL ASSIGNABILITY, ASSERTED AT RUNTIME AS WELL AS AT COMPILE TIME.
   * `buildGradeInput` takes `PositionalNormsInput`, a structural mirror of that
   * module's output rather than an import of it — same device as
   * `ProjectedFinish` in the dossier. TypeScript checks the shape; this checks
   * the fields are actually populated, because an all-null table would satisfy
   * the type and tell the model nothing.
   */
  check(
    "the norms satisfy the structural contract the grade consumes them through",
    Array.isArray(positionalNorms.seasons) &&
      positionalNorms.seasons.length > 0 &&
      positionalNorms.keeperPrices.length >= 5 &&
      positionalNorms.draftPrices.length >= 5 &&
      positionalNorms.declarations > 0,
  );
  check(
    "every position's price row states its own sample size rather than implying one",
    positionalNorms.keeperPrices.every(
      (k) => typeof k.declarations === "number" && k.declarations >= 0,
    ),
  );

  /*
   * THE FINDING THE WHOLE MECHANISM RESTS ON. If this stops being true the
   * rubric's worked example is wrong and the Burrow check rests on nothing.
   */
  check(
    `nobody in this league has ever declared a QB keeper dearer than round ${qb?.mostExpensiveRound} (median R${qb?.medianRound}, n=${qb?.declarations})`,
    !!qb && qb.mostExpensiveRound !== null && qb.mostExpensiveRound >= 5,
    `dearest QB declaration R${qb?.mostExpensiveRound}`,
  );
  check(
    "…so a round-3 QB price is dearer than any QB keeper on record here",
    !!qb && qb.mostExpensiveRound !== null && 3 < qb.mostExpensiveRound,
  );
  /*
   * And the contrast that makes it a fact about the POSITION rather than about
   * the league being thrifty: receivers have been kept at a first-round price.
   */
  check(
    `…while a receiver has been kept at round ${wr?.mostExpensiveRound}, so this is positional and not general thrift`,
    !!wr && wr.mostExpensiveRound !== null && wr.mostExpensiveRound < (qb?.mostExpensiveRound ?? 0),
  );
  check(
    "the league's QB demand is met later than its RB, WR and TE demand — why QB is cheap to replace",
    (() => {
      const q = supply("QB")?.demandMetMedianRound;
      if (q == null) return false;
      return (["RB", "WR", "TE"] as const).every((p) => {
        const other = supply(p)?.demandMetMedianRound;
        return other == null || other <= q;
      });
    })(),
    `QB R${supply("QB")?.demandMetMedianRound}`,
  );

  // The payload's own use of it, per franchise.
  check(
    "the payload reports the norms as present",
    live.coverage.positionalNorms === "present",
  );
  check(
    "…and passes the table through whole rather than restating figures from it",
    live.positionalNorms === positionalNorms,
  );
  const withPasses = live.franchises.filter((f) => f.keepersIn.passedOn.length > 0);
  check(
    `every judged pass carries a verdict on the price (${withPasses.length} franchises with passes)`,
    withPasses.length > 0 &&
      withPasses.every((f) =>
        f.keepersIn.passedOn.every((p) => p.declineWasDefensible !== undefined),
      ),
  );
  const defensible = live.franchises.flatMap((f) =>
    f.keepersIn.passedOn.filter((p) => p.declineWasDefensible === true),
  );
  console.log(
    `\n  declines the record defends (${defensible.length} on this board):` +
      (defensible.length
        ? defensible
            .slice(0, 5)
            .map((p) => `\n    ${p.player} (${p.position}) — ${p.priceContext}`)
            .join("")
        : " none"),
  );
  check(
    "a defensible decline explains itself with the numbers, so a grade can cite it",
    defensible.every((p) => p.priceContext !== null && /dearest/.test(p.priceContext)),
  );
  check(
    "…and every keeper carries the price record for its own position",
    live.franchises.every((f) =>
      f.keepersIn.keeperPositionContext.every(
        (k) => k.dearestEverDeclaredRound !== null || !price(k.position)?.declarations,
      ),
    ),
  );

  /* The universal hole, priced. */
  const preDraftHoles = bareBoardHoles();
  check(
    `a slot every franchise has open is reported as shared by all of them (${preDraftHoles.shared} of ${preDraftHoles.of})`,
    preDraftHoles.shared === preDraftHoles.of && preDraftHoles.of === 10,
  );
  check(
    "…and it carries what filling the position actually costs",
    preDraftHoles.demandMetByRound !== null,
    `demand met by R${preDraftHoles.demandMetByRound}`,
  );

  // The rubric side.
  check(
    "the rubric carries the positional-price rule",
    GRADE_RUBRIC.includes(GRADE_POSITION_MARKER) &&
      rubricText.includes(GRADE_RULES.positionalPrice.replace(/\s+/g, " ")),
  );
  check(
    "…states it generically rather than as a quarterback exception",
    /A KEEPER PRICE IS DEFENSIBLE RELATIVE TO WHERE THIS LEAGUE ACTUALLY DRAFTS THAT POSITION/i.test(
      rubricText,
    ) && !/burrow/i.test(rubricText),
  );
  check(
    "…names the shape of the mistake so the model can recognise it",
    /reasoning that a position is premium BECAUSE OF THE SCORING/i.test(rubricText) &&
      /declined it made the obvious call/i.test(rubricText),
  );
  check(
    "…and says a shared hole is not a deficiency",
    /every franchise in the league has open is not a deficiency/i.test(rubricText),
  );

  // ── The validator, both ways round ──────────────────────────────────────
  const scoringPriced = codesFor((g) => [
    {
      ...g[0],
      reason:
        "Burrow was keepable at a round-3 price in a league that pays six points for " +
        "a passing touchdown, and he let him walk.",
    },
    ...g.slice(1),
  ]);
  check(
    "pricing a position off the scoring settings BLOCKS — the exact sentence the commissioner caught",
    scoringPriced.codes.includes("scoring-as-price") && scoringPriced.blocking,
    scoringPriced.codes.join(","),
  );
  const scoringColour = codesFor((g) => [
    {
      ...g[0],
      reason:
        "Six points a passing touchdown is why this league is fun, and he still " +
        "captured the most value on the board.",
    },
    ...g.slice(1),
  ]);
  check(
    "…while mentioning the scoring format as colour does not",
    !scoringColour.codes.includes("scoring-as-price"),
    scoringColour.codes.join(","),
  );

  const declineFixture = buildGradeInput({
    dossier: fixtureDossier({
      picksEntered: 10,
      boardComplete: true,
      franchises: Array.from({ length: 10 }, (_, i) =>
        fixtureFranchise({
          teamId: `t${i + 1}`,
          teamName: `Team${i + 1}`,
          valueGained: 5 - i,
          scoredPicks: 1,
          starters: [{ slot: "QB", player: `QB${i}`, position: "QB" }],
          picks: [
            {
              label: "1.01",
              round: 1,
              overallPick: i + 1,
              player: `QB${i}`,
              position: "QB",
              nflTeam: null,
              rawAdp: null,
              expectedPick: i + 6,
              slotsVsBoard: -(5 - i),
              acquiredFrom: null,
            },
          ],
          passedOnKeepers:
            i === 0
              ? [
                  {
                    player: "Joe Burrow",
                    position: "QB",
                    costRound: 3,
                    draftedAtLabel: "2.04",
                    draftedAtRound: 2,
                    draftedAtOverallPick: 14,
                    draftedBy: "Team5",
                    roundsCheaperToKeep: 1,
                  },
                ]
              : [],
        }),
      ),
    }),
    history,
    positionalNorms,
  });
  const burrow = declineFixture.franchises[0].keepersIn.passedOn[0];
  check(
    "a round-3 QB decline is judged defensible against the league's own record",
    burrow?.declineWasDefensible === true,
    `declineWasDefensible=${burrow?.declineWasDefensible}`,
  );
  check(
    "…and it is NOT counted as a costly pass, even though he went a round earlier than the price",
    declineFixture.franchises[0].keepersIn.costlyPasses === 0 &&
      declineFixture.franchises[0].keepersIn.defensibleDeclines === 1,
    `costly=${declineFixture.franchises[0].keepersIn.costlyPasses}`,
  );

  const declineGrades = (reason: string) =>
    validateGrades({
      dossier: fixtureDossier({ franchises: [] }),
      input: declineFixture,
      grades: declineFixture.franchises.map((f, i) => ({
        teamId: f.teamId,
        letter: spreadLetters[i],
        reason: i === 0 ? reason : "Graded on value captured.",
        citations: [{ label: "slots of value captured", value: 5 - i }],
      })),
    }).flags.filter((f) => f.teamId === "t1");

  const blamed = declineGrades(
    "He let Joe Burrow walk at a round-3 price, which is a mistake he will regret.",
  );
  check(
    "blaming a franchise for a decline the record defends BLOCKS",
    blamed.some((f) => f.code === "penalises-defensible-decline" && f.severity === "blocking"),
    blamed.map((f) => f.code).join(","),
  );
  const credited = declineGrades(
    "He was right to let Joe Burrow walk at a round-3 price — nobody here has ever paid that for a QB.",
  );
  check(
    "…while crediting him for the same decision does not",
    !credited.some((f) => f.code === "penalises-defensible-decline"),
    credited.map((f) => f.code).join(","),
  );
  const unrelated = declineGrades("Captured the most value on the board and fielded a legal nine.");
  check(
    "…and a reason that never mentions the decline is left alone",
    !unrelated.some((f) => f.code === "penalises-defensible-decline"),
    unrelated.map((f) => f.code).join(","),
  );

  /* The universal hole, on the pre-draft board where all ten share it. */
  const holeInput = buildGradeInput({
    dossier: fixtureDossier({
      picksEntered: 10,
      boardComplete: true,
      franchises: Array.from({ length: 10 }, (_, i) =>
        fixtureFranchise({
          teamId: `t${i + 1}`,
          teamName: `Team${i + 1}`,
          valueGained: 5 - i,
          scoredPicks: 1,
          starters: [{ slot: "RB1", player: `RB${i}`, position: "RB" }],
          openStarterSlots: ["QB"],
        }),
      ),
    }),
    history,
    positionalNorms,
  });
  const holeFlags = validateGrades({
    dossier: fixtureDossier({ franchises: [] }),
    input: holeInput,
    grades: holeInput.franchises.map((f, i) => ({
      teamId: f.teamId,
      letter: spreadLetters[i],
      reason:
        i === 0
          ? "A glaring hole at QB — he has nothing at the position at all."
          : "Graded on value captured.",
      citations: [{ label: "slots of value captured", value: 5 - i }],
    })),
  }).flags.filter((f) => f.teamId === "t1");
  check(
    "calling a hole all ten franchises share a glaring deficiency warns",
    holeFlags.some((f) => f.code === "universal-hole-as-deficiency"),
    holeFlags.map((f) => f.code).join(","),
  );
  check(
    "…and it warns rather than blocking, because how much a hole matters is a judgement",
    !holeFlags.some(
      (f) => f.code === "universal-hole-as-deficiency" && f.severity === "blocking",
    ),
  );

  /*
   * The post-draft slot, on a FINISHED board where only two franchises have it
   * open. This is the 2026 case the commissioner overruled, and the share is the
   * whole point of the fixture: eight of ten franchises drafted a defence, so
   * the universal-hole rule above is silent and only the post-draft rule can
   * catch it.
   */
  const dstInput = buildGradeInput({
    dossier: fixtureDossier({
      picksEntered: 160,
      boardComplete: true,
      franchises: Array.from({ length: 10 }, (_, i) =>
        fixtureFranchise({
          teamId: `t${i + 1}`,
          teamName: `Team${i + 1}`,
          valueGained: 5 - i,
          scoredPicks: 1,
          starters: [{ slot: "RB1", player: `RB${i}`, position: "RB" }],
          // Only the first two skipped a defence, exactly as 2026 went.
          openStarterSlots: i < 2 ? ["DST"] : [],
        }),
      ),
    }),
    history,
    positionalNorms,
  });

  const dstHole = dstInput.franchises[0].rosterShape.unfilledStarterSlots?.[0];
  check(
    "a DST slot is marked as one the league fills after the draft",
    dstHole?.filledAfterDraft === true,
    `slot=${dstHole?.slot} filledAfterDraft=${dstHole?.filledAfterDraft}`,
  );
  check(
    "…and it is NOT covered by the shared-hole rule, which is why it needs its own",
    (dstHole?.sharedByFranchises ?? 0) === 2 && (dstHole?.ofFranchises ?? 0) === 10,
    `shared by ${dstHole?.sharedByFranchises} of ${dstHole?.ofFranchises}`,
  );

  const dstFlags = (reason: string) =>
    validateGrades({
      dossier: fixtureDossier({ franchises: [] }),
      input: dstInput,
      grades: dstInput.franchises.map((f, i) => ({
        teamId: f.teamId,
        letter: spreadLetters[i],
        reason: i === 0 ? reason : "Graded on value captured.",
        citations: [{ label: "slots of value captured", value: 5 - i }],
      })),
    }).flags.filter((f) => f.teamId === "t1");

  const docked = dstFlags("A glaring hole at DST — he has nothing there at all.");
  check(
    "docking a franchise for an empty DST is flagged",
    docked.some((f) => f.code === "post-draft-hole-as-deficiency"),
    docked.map((f) => f.code).join(","),
  );
  check(
    "…and it BLOCKS, because the commissioner ruled it is wrong rather than overstated",
    docked.some(
      (f) => f.code === "post-draft-hole-as-deficiency" && f.severity === "blocking",
    ),
  );

  const mentioned = dstFlags(
    "Spent his sixteenth on a receiver and will stream a DST off waivers like everybody sensible.",
  );
  check(
    "…while merely mentioning the DST plan is left alone",
    !mentioned.some((f) => f.code === "post-draft-hole-as-deficiency"),
    mentioned.map((f) => f.code).join(","),
  );

  /* The lineup-legality side: an empty DST must not make a lineup illegal. */
  const dstOnlyHole = validateGrades({
    dossier: fixtureDossier({ franchises: [] }),
    input: dstInput,
    grades: dstInput.franchises.map((f, i) => ({
      teamId: f.teamId,
      letter: i === 0 ? "A" : spreadLetters[i],
      reason: "Graded on value captured.",
      citations: [{ label: "slots of value captured", value: 5 - i }],
    })),
  }).flags.filter((f) => f.teamId === "t1");
  check(
    "…and an A-grade franchise whose only open slot is DST is not called unable to field a lineup",
    !dstOnlyHole.some((f) => /unable to field/i.test(f.message)),
    dstOnlyHole.map((f) => f.code).join(","),
  );

  // The rubric side.
  check(
    "the rubric tells the model a post-draft slot is not a hole at all",
    /`filledAfterDraft`/.test(rubricText) &&
      /IT IS NOT A HOLE AT ALL/i.test(rubricText),
  );
}

/** The QB hole on a board where every franchise has one, for the check above. */
function bareBoardHoles(): { shared: number; of: number; demandMetByRound: number | null } {
  const input = buildGradeInput({
    dossier: fixtureDossier({
      picksEntered: 1,
      franchises: Array.from({ length: 10 }, (_, i) =>
        fixtureFranchise({
          teamId: `t${i + 1}`,
          teamName: `Team${i + 1}`,
          starters: [{ slot: "RB1", player: `RB${i}`, position: "RB" }],
          openStarterSlots: ["QB"],
        }),
      ),
    }),
    history,
    positionalNorms,
  });
  const hole = input.franchises[0].rosterShape.unfilledStarterSlots?.[0];
  return {
    shared: hole?.sharedByFranchises ?? 0,
    of: hole?.ofFranchises ?? 0,
    demandMetByRound: hole?.demandMetByRound ?? null,
  };
}

// ── Disputed provenance ─────────────────────────────────────────────────────

/*
 * THE COMMISSIONER'S OWN WORDS: "everyone is salty about this Scott trade, so
 * don't stroke his ego too much." The risk is arithmetic — Nacua is the largest
 * value on the board by 31 slots — so it is checked arithmetically.
 *
 * The fixture is built rather than found, and it is built off the LIVE board so
 * that it exercises the real dispute record in `@/lib/keeper-tenure-dispute`
 * rather than a stand-in. If the ballot is ever held and the dispute removed,
 * these checks skip themselves and say so, which is the correct behaviour: there
 * would no longer be anything to disclose.
 */
const disputedFranchise = live.franchises.find((f) => f.keepersIn.disputedProvenance.length > 0);
if (!disputedFranchise) {
  console.log(
    "  – no keeper on this board has contested provenance, so the disclosure rules\n" +
      "    cannot be exercised. That is the state after a league ballot, not a failure.",
  );
} else {
  const dv = disputedFranchise.keepersIn.disputedProvenance[0];
  console.log(
    `  the disputed figure on this board: ${dv.player} to ${disputedFranchise.teamName}, ` +
      `${dv.slotsSavedByKeeping} slots\n` +
      `    contested final seasons: ${dv.contestedFinalSeasons.join(" or ")}`,
  );

  check(
    "the disputed keeper carries the question, both readings and the resolution",
    dv.question.length > 40 &&
      dv.contestedFinalSeasons.length === 2 &&
      dv.resolution.length > 20,
  );
  check(
    "…and its value is carried at FULL value, not discounted",
    dv.slotsSavedByKeeping !== null &&
      dv.slotsSavedByKeeping ===
        dossier.franchises
          .find((f) => f.teamId === disputedFranchise.teamId)!
          .keepers.find((k) => k.player === dv.player)!.slotsSavedByKeeping,
  );
  check(
    "…and it says plainly that no rule was broken, so a reason cannot call it cheating",
    /No rule was broken/i.test(dv.ruleStatus) && /not call it cheating/i.test(dv.ruleStatus),
  );
  /*
   * The app refuses to state this keeper's clock year on every other surface.
   * The payload must not be the leak — if a clock year reached the model as data
   * it would not matter what the rubric said.
   */
  check(
    "the payload hands over the app's own refusal, not a clock year",
    /disputed/i.test(dv.clockLabel) &&
      dv.contestedFinalSeasons.every((s) => dv.clockLabel.includes(String(s))),
    dv.clockLabel,
  );
  check(
    "…and no franchise block anywhere asserts a single final season for him",
    !new RegExp(`"(?:clockYear|finalSeason|keepableIn)[^"]*":\\s*20\\d\\d`).test(serialised),
  );
  check(
    "the provenance rule is stated generically, naming no franchise and no player",
    !/nacua|scott|johnston/i.test(live.rules.provenance) &&
      /BIGGEST NUMBER IS NOT AUTOMATICALLY THE BEST DECISION/i.test(live.rules.provenance),
  );
  check(
    "…and the rubric carries it too, with the register spelled out",
    GRADE_RUBRIC.includes(GRADE_PROVENANCE_MARKER) &&
      !/nacua|johnston/i.test(rubricText) &&
      /the way a receipt names a shop/i.test(rubricText),
  );

  /** A grade for the disputed franchise, citing the disputed figure. */
  const gradesCiting = (reason: string): AssignedGrade[] =>
    cleanGrades().map((g) =>
      g.teamId === disputedFranchise.teamId
        ? {
            ...g,
            letter: "A+",
            reason,
            citations: [{ label: "slots saved by keeping", value: dv.slotsSavedByKeeping! }],
          }
        : g,
    );
  const provenanceCodes = (reason: string) => {
    const result = validateGrades({ dossier, input: live, grades: gradesCiting(reason) });
    return {
      codes: [...new Set(result.flags.filter((f) => f.teamId === disputedFranchise.teamId).map((f) => f.code))],
      blocking: result.blocking,
    };
  };

  const silent = provenanceCodes(
    "The largest keeper surplus in the league by thirty-one slots, and it is not close.",
  );
  check(
    "an A+ argued from the disputed figure without mentioning the dispute BLOCKS",
    silent.codes.includes("undisclosed-provenance") && silent.blocking,
    silent.codes.join(","),
  );

  const disclosed = provenanceCodes(
    "The largest keeper surplus in the league, and the one the league never ratified — " +
      "no rule forbade the reset and no vote approved it either.",
  );
  check(
    "…while the same figure disclosed as a receipt does not",
    !disclosed.codes.includes("undisclosed-provenance") &&
      !disclosed.codes.includes("admires-disputed-value"),
    disclosed.codes.join(","),
  );

  const admiring = provenanceCodes(
    "A masterclass in reading the keeper rules — the contract was genius and the " +
      "league never ratified a word of it.",
  );
  check(
    "…and disclosing it and then admiring it anyway warns without blocking the set",
    admiring.codes.includes("admires-disputed-value") &&
      !admiring.codes.includes("undisclosed-provenance"),
    admiring.codes.join(","),
  );

  const resolving = provenanceCodes(
    `The biggest surplus in the league, unratified, and he holds him through ` +
      `${dv.contestedFinalSeasons[1]}.`,
  );
  check(
    "asserting one of the contested final seasons BLOCKS, whatever else the reason says",
    resolving.codes.includes("asserts-disputed-clock") && resolving.blocking,
    resolving.codes.join(","),
  );

  const quoting = provenanceCodes(
    `Unratified value, and the app will not say whether it runs to ` +
      `${dv.contestedFinalSeasons[0]} or ${dv.contestedFinalSeasons[1]} — that is disputed.`,
  );
  check(
    "…while quoting both contested seasons as disputed does not",
    !quoting.codes.includes("asserts-disputed-clock"),
    quoting.codes.join(","),
  );

  /*
   * AND THE RULE MUST NOT FIRE ON A GRADE THAT NEVER LEANED ON THE FIGURE. A
   * franchise holding a contested keeper is not obliged to discuss it in a grade
   * argued from something else — requiring that would be the validator writing
   * the reason rather than checking it.
   */
  const elsewhere = validateGrades({
    dossier,
    input: live,
    grades: cleanGrades().map((g) =>
      g.teamId === disputedFranchise.teamId
        ? {
            ...g,
            reason: "Graded on pick capital and a legal lineup, nothing to do with keepers.",
            citations: [{ label: "value rank in the league", value: disputedFranchise.valueCaptured.leagueRank }],
          }
        : g,
    ),
  });
  check(
    "a grade for the same franchise that does not lean on the disputed figure is left alone",
    !elsewhere.flags.some(
      (f) => f.teamId === disputedFranchise.teamId && f.code === "undisclosed-provenance",
    ),
    elsewhere.flags.filter((f) => f.teamId === disputedFranchise.teamId).map((f) => f.code).join(","),
  );

  /*
   * The generic-not-special-case test. `DECISIONS.md` records the same
   * trade-and-reset mechanism producing Trey McBride's third keeper season, and
   * McBride is the OPERATOR'S keeper — so a provenance rule aimed only at one
   * franchise would be a grudge rather than a rule. This asserts the mechanism is
   * data-driven: it reads whatever `@/lib/keeper-tenure-dispute` records, and no
   * franchise or player is named in this module at all.
   */
  check(
    "the disclosure rule is driven by the dispute record rather than by a named franchise",
    live.franchises.filter((f) => f.keepersIn.disputedProvenance.length > 0).length ===
      allTenureDisputes().filter((d) =>
        live.franchises.some(
          (f) =>
            f.teamName === d.teamShortName &&
            dossier.franchises
              .find((x) => x.teamId === f.teamId)!
              .keepers.some((k) => k.player === d.playerName),
        ),
      ).length,
  );
  console.log(
    `    (the same trade-and-reset mechanism produced Trey McBride's third season and\n` +
      `     he is the operator's own keeper, but no dispute is recorded against him, so\n` +
      `     none is flagged. Recording one would be adjudication, which is not this\n` +
      `     module's job — reported here rather than fixed.)`,
  );
}

check(
  "every flag carries a message a human can act on without reading the code",
  validateGrades({
    dossier,
    input: live,
    grades: cleanGrades().map((g, i) => (i === 0 ? { ...g, letter: "Z" } : g)),
  }).flags.every((f) => f.message.length > 30 && f.message.includes(" ")),
);

// ============================================================================
section("7. The straight-face model run");
// ============================================================================

/*
 * OPT-IN AND PAID. A full recap generation costs about $0.92, most of it the web
 * research, and a verification script that spends money every time somebody runs
 * `npm run build` is a script that gets deleted. So this is off unless asked
 * for, uses no web search at all — the 2018 season is settled history and there
 * is nothing to look up — and grades one board rather than eight.
 */
if (!process.argv.includes("--straight-face")) {
  console.log(
    "  – skipped. This is the one check that spends money, so it is opt-in:\n" +
      "      npm run verify:recap:grade -- --straight-face\n" +
      "    It grades the 2018 draft with no web search and reports what it cost.",
  );
} else {
  await straightFaceRun();
}

/**
 * Has the model grade one historical draft, and reports what came back.
 *
 * WHAT IT IS FOR. The 2018 draft is the one the league's own history file is
 * most confident about: Witte took Patrick Mahomes with pick 160 of 160 and kept
 * him for years. If a model handed this board's evidence cannot arrive somewhere
 * defensible on Witte, the rubric is not doing its job — and that is worth one
 * dollar to find out before draft night rather than during it.
 *
 * WHAT IT IS NOT. It does not use the shipping prompt, because the shipping
 * prompt writes blurbs and needs a board this one cannot supply. It builds its
 * own message around the exported rubric and a hindsight appendix, and the
 * appendix is BUILT HERE RATHER THAN IN `@/lib/recap-grade` on purpose: revealed
 * value is a test instrument, and putting a second yardstick into the shipping
 * module would be exactly the confusion the ADP rule exists to prevent.
 */
async function straightFaceRun(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log("  – no ANTHROPIC_API_KEY, so there is nothing to ask. Not a failure.");
    return;
  }

  const season = 2018;
  const historic = historicalDossier(season);
  const input = buildGradeInput({ dossier: historic, history, positionalNorms });
  const revealed = revealedValue(season);

  const appendix = historic.franchises
    .map((f) => {
      const mine = revealed
        .filter((p) => p.manager === f.teamName)
        .sort((a, b) => b.lateAndLasted - a.lateAndLasted);
      const hits = mine.slice(0, 3).map(
        (p) => `${p.player} R${p.round}p${p.overallPick} (survived ${p.survivingSeasons} later seasons${p.keptForward ? ", kept next year" : ""})`,
      );
      const gone = mine.filter((p) => p.survivingSeasons === 0).length;
      return `${f.teamName}: best by hindsight — ${hits.join("; ")}. ${gone} of ${mine.length} picks never appeared in this league again.`;
    })
    .join("\n");

  const message = [
    gradeRubric("draft"),
    ``,
    `IMPORTANT — THIS IS A TEST ON A HISTORICAL BOARD, NOT THE LIVE ONE.`,
    ``,
    `This is the ${season} draft. There is no ADP for that season anywhere, so the`,
    `board-relative yardstick you would normally grade price and value against DOES`,
    `NOT EXIST here, and the payload's coverage block says so. In its place you are`,
    `given a HINDSIGHT appendix: what the league itself went on to do with each`,
    `drafted player, which is recorded fact rather than projection. Grade on that,`,
    `and say in each reason that the grade is hindsight rather than a draft-night`,
    `verdict. Do not invent an ADP and do not pretend to a yardstick you were not`,
    `given.`,
    ``,
    `GRADE PAYLOAD`,
    JSON.stringify(input),
    ``,
    `HINDSIGHT — what the league did next, from eight draft sheets and ten keeper lists`,
    appendix,
    ``,
    `Return JSON: {"teams":[{"teamId","letter","reason","citations":[{"label","value"}]}]}`,
    `One entry per franchise. \`teamId\` exactly as the payload gives it.`,
  ].join("\n");

  console.log(`  asking Claude to grade the ${season} draft (no web search)…`);
  const started = Date.now();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-opus-5",
      max_tokens: 8_000,
      messages: [{ role: "user", content: [{ type: "text", text: message }] }],
      output_config: { effort: "low" },
    }),
  });

  if (!response.ok) {
    console.log(`  ✗ Claude refused (${response.status}): ${(await response.text()).slice(0, 300)}`);
    failures++;
    return;
  }

  const payload = (await response.json()) as {
    content: { type: string; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = payload.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("");

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let grades: AssignedGrade[] = [];
  try {
    grades = (JSON.parse(text.slice(start, end + 1)) as { teams: AssignedGrade[] }).teams ?? [];
  } catch {
    console.log(`  ✗ the reply was not JSON: ${text.slice(0, 200)}`);
    failures++;
    return;
  }

  const cost =
    ((payload.usage?.input_tokens ?? 0) / 1e6) * 5 +
    ((payload.usage?.output_tokens ?? 0) / 1e6) * 25;
  console.log(
    `  ${grades.length} grades in ${((Date.now() - started) / 1000).toFixed(0)}s · ` +
      `${payload.usage?.input_tokens ?? 0} in / ${payload.usage?.output_tokens ?? 0} out · ` +
      `about $${cost.toFixed(3)}\n`,
  );
  for (const g of [...grades].sort(
    (a, b) => GRADE_SCALE.indexOf(a.letter as never) - GRADE_SCALE.indexOf(b.letter as never),
  )) {
    console.log(`    ${String(g.letter).padEnd(3)} ${String(g.teamId).padEnd(9)} ${g.reason}`);
  }

  const witte = grades.find((g) => g.teamId === "Witte");
  check(
    "every franchise came back with a grade on the scale",
    grades.length === historic.franchises.length && grades.every((g) => isGradeLetter(g.letter)),
    `${grades.length} grades, letters ${grades.map((g) => g.letter).join(",")}`,
  );
  /*
   * THE STRAIGHT-FACE ASSERTION. Witte's 2018 is the one draft in this league's
   * recorded history that everybody agrees about: the last pick of the night
   * became a multi-year keeper. A rubric that grades that below the middle of the
   * scale is a rubric the room would laugh at, and that is the failure worth
   * buying one API call to catch.
   */
  check(
    `Witte's 2018 — Mahomes at 16.160 — does not come back below the middle of the scale (${witte?.letter})`,
    !!witte && isGradeLetter(witte.letter) && GRADE_SCALE.indexOf(witte.letter) <= 5,
    witte ? `graded ${witte.letter}` : "no grade for Witte",
  );
  check(
    "…and the grades are not all the same letter",
    new Set(grades.map((g) => g.letter)).size > 1,
  );
  check(
    "every grade cites at least one figure",
    grades.every((g) => Array.isArray(g.citations) && g.citations.length > 0),
  );
  /*
   * The validator run over real model output, which is the only way to know
   * whether the citation rule is one a model can actually satisfy. Reported
   * rather than asserted: a hindsight run cites hindsight figures, which are
   * deliberately not in the payload, so `figure-not-in-evidence` firing here is
   * expected and is not a failure of the live path.
   */
  const verdict = validateGrades({ dossier: historic, input, grades });
  console.log(
    `\n  validator on the live-path rules: ${verdict.flags.length} flag(s), ` +
      `blocking=${verdict.blocking}`,
  );
  for (const f of verdict.flags.slice(0, 6)) {
    console.log(`    ${f.severity === "blocking" ? "✗" : "!"} ${f.code}: ${f.message.slice(0, 150)}`);
  }
  console.log(
    `    (expected: this board is ungradable by the shipping rubric, and the hindsight\n` +
      `     figures are not in the payload. Both flags are the validator working.)`,
  );
}

function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

console.log(`\n${failures === 0 ? "All grade checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

/**
 * Proves the projected-standings SHAPE reacts to the board, and that the prompt
 * has something to say in every shape it can return.
 *
 *   npm run verify:recap:spread
 *
 * ============================================================================
 * WHY THIS EXISTS SEPARATELY FROM `verify:recap`
 * ============================================================================
 *
 * `verify:recap` proves the spread's arithmetic is self-consistent on ONE board
 * — the mock, which comes out bunched because ten reasonable archetypes drafting
 * off one ranked pool produce ten reasonable rosters. That is the pre-draft
 * board, and every threshold in `projectedSpread` was calibrated against it.
 *
 * The board that matters has not happened yet. Ten managers will make real
 * picks and the field may genuinely separate, and the rules that stop the model
 * overclaiming on a bunched table must not muzzle it once there is a real gap
 * to name. A classifier that returns "pack" for every board it will ever see is
 * indistinguishable from a hardcoded constant, and the way that failure shows up
 * is not a red test — it is a recap that hedges every verdict on the one night
 * of the year the feature is used.
 *
 * So this constructs boards the classifier has never seen and checks it moves.
 *
 * The boards themselves come from `./recap-board-shapes.mts`, which redeals a
 * finished draft into tiers while preserving every franchise's positional
 * composition and leaving the keepers where the league put them — see that
 * file for why a board is redealt rather than a standings table invented. Every
 * figure downstream is then computed by the shipping code: real projections,
 * the real schedule, the real Monte Carlo, the real classifier.
 *
 * `experiment:recap --shape=<key>` sends the same boards to the live model, so
 * what is asserted here and what a human reads there are the same fixtures.
 *
 * ============================================================================
 * WHAT IT ASSERTS
 * ============================================================================
 *
 *   1.  The shape is a function of the board. A bunched deal and a stratified
 *       deal off the SAME players must not return the same shape — if they do,
 *       the field is being classified by something other than the field.
 *   2.  A genuinely stratified board is not called a pack, and a genuinely
 *       bunched one is.
 *   3.  No pre-draft value leaks: two dossiers built from two boards in one
 *       process disagree, and rebuilding the first board reproduces its own
 *       numbers exactly.
 *   4.  The prompt has a positive instruction for every shape the classifier can
 *       return — including the separated case, which must tell the model to name
 *       the gap with numbers rather than merely stop restricting it. An absent
 *       restriction is not a licence, and on a stratified board the brief wants
 *       a swing.
 *   5.  The write-off ban does not extend to a supported verdict. The banned
 *       framings are checked against sentences a brutal-but-numerate blurb has
 *       to be able to write, so that narrowing the target cannot quietly become
 *       softening the punch.
 *
 * No API key, no network, nothing written anywhere. Exits non-zero on the first
 * failure.
 */

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import {
  SEPARATED_FIELD_MARKER,
  WRITTEN_OFF_FRAMINGS,
  recapSystemPrompt,
} from "@/lib/recap-prompt";
import {
  readClosedKeeperLists,
  readKeeperOptions,
  readProjectedStandings,
} from "@/lib/recap-source";
import { readProjectionIndex } from "@/lib/projections-store";
import { defaultAssignment, runWholeMock, toMockPool } from "@/lib/mock-draft-run";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { BOARD_SHAPES, reshape, type Tiers } from "./recap-board-shapes.mts";
import type { DraftRoomView } from "@/lib/draft-types";
import type { ProjectedSpread } from "@/lib/recap-dossier";

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

// --- The board, and the machinery for reshaping it --------------------------

const board = getBoard();
const pool = getPlayerPool();
const projections = readProjectionIndex();

if (!projections) {
  console.error(
    "No projections snapshot on this checkout, so there are no points to shape a\n" +
      "table out of. Run `npm run pull:projections` first. This is not a failure of\n" +
      "the spread logic and it is not reported as one.",
  );
  process.exit(0);
}

const { view: baseView } = runWholeMock({
  board,
  pool: toMockPool(pool),
  archetypes: defaultAssignment(board),
  rng: mulberry32(20260829),
});

/** Season points for a player, or 0 — the same figure the standings rank on. */
function pointsOf(playerId: string): number {
  return projections!.byPlayerId.get(playerId)?.points ?? 0;
}

/** Board in, spread out — through the shipping path, with nothing shortcut. */
function spreadOf(view: DraftRoomView): {
  spread: ProjectedSpread;
  points: number[];
  wins: (number | null)[];
  names: string[];
} {
  const dossier = buildRecapDossier({
    view,
    expectedPick: buildExpectedPicks(pool, view.slots),
    pool,
    keeperOptions: readKeeperOptions(),
    closedKeeperLists: readClosedKeeperLists(),
    projectedStandings: readProjectedStandings(view),
  });
  const standings = dossier.projectedStandings;
  if (!standings) throw new Error("no projected standings on a board that has projections");
  return {
    spread: standings.spread,
    points: standings.rows.map((r) => r.projectedPoints),
    wins: standings.rows.map((r) => r.projectedWins),
    names: standings.rows.map((r) => r.teamName),
  };
}

// --- The fixtures -----------------------------------------------------------

const ids = [...baseView.teams].sort((a, b) => a.slot - b.slot).map((t) => t.id);

/**
 * What each of the shared fixtures must come back as.
 *
 * Only the two ends are pinned by name. The three lopsided boards are pinned as
 * "not a pack" rather than as a specific label because which of `tiered` and
 * `separated` they land on depends on how far the Monte Carlo compresses their
 * win totals, and that is a modelling parameter rather than a promise. What is
 * a promise is that none of them may come back bunched.
 */
const EXPECT: Record<string, "pack" | "not-pack"> = {
  bunched: "pack",
  stratified: "not-pack",
  "outlier-low": "not-pack",
  runaway: "not-pack",
  "tie-then-cliff": "not-pack",
  sequential: "not-pack",
};

const fixtures = Object.entries(BOARD_SHAPES).map(([key, shape]) => ({
  key,
  label: shape.label,
  tiers: shape.tiers(ids) as Tiers,
  expect: EXPECT[key],
}));

section("The board decides the shape");

const results = new Map<string, ReturnType<typeof spreadOf>>();
for (const f of fixtures) {
  const result = spreadOf(reshape(baseView, f.tiers, pointsOf));
  results.set(f.key, result);
  const s = result.spread;
  console.log(`\n  ${f.key} — ${f.label}`);
  console.log(
    `    shape ${s.shape.toUpperCase()} (on ${s.basedOn}) · ` +
      `${s.pointsFirstToLast} points first to last · ` +
      `median neighbour gap ${s.medianAdjacentPointsGap} · ` +
      `biggest gap ${s.largestAdjacentPointsGap} between ranks ` +
      `${s.largestGapBetweenRanks?.join(" and ") ?? "—"}`,
  );
  console.log(
    `    ${s.teamsWithinOneWin ?? s.teamsWithinPointsBand} of ${result.points.length} in the pack` +
      `${s.winsFirstToLast !== null ? ` · ${s.winsFirstToLast} wins first to last` : ""}` +
      `${s.teamsWithLivePlayoffOdds !== null ? ` · ${s.teamsWithLivePlayoffOdds} coin-toss playoff odds` : ""}`,
  );
  console.log(
    `    ${result.names
      .map((n, i) => `${n} ${result.points[i]}${result.wins[i] !== null ? `/${result.wins[i]}W` : ""}`)
      .join("  ")}`,
  );
}

section("1. The shape is a function of the board, not a constant");

const bunched = results.get("bunched")!;
const stratified = results.get("stratified")!;
const sequential = results.get("sequential")!;

check(
  "the same players dealt two ways do not produce the same shape",
  bunched.spread.shape !== stratified.spread.shape ||
    bunched.spread.shape !== sequential.spread.shape,
  `bunched=${bunched.spread.shape} stratified=${stratified.spread.shape} sequential=${sequential.spread.shape}`,
);
check(
  "a bunched deal is called a pack",
  bunched.spread.shape === "pack",
  bunched.spread.shape,
);
for (const f of fixtures) {
  if (f.expect !== "not-pack") continue;
  const s = results.get(f.key)!.spread;
  check(
    `a stratified deal (${f.key}) is not called a pack — it returns "${s.shape}"`,
    s.shape !== "pack",
    `${s.teamsWithinOneWin ?? s.teamsWithinPointsBand} still within the band`,
  );
}
check(
  "separation shows up in the points as well as the label",
  sequential.spread.pointsFirstToLast > bunched.spread.pointsFirstToLast * 1.5,
  `${sequential.spread.pointsFirstToLast} vs ${bunched.spread.pointsFirstToLast}`,
);

/*
 * The cliff override, which is the half of the rule that a bunched middle used
 * to defeat. Each of these three boards has most of the league inside one win
 * of the median and would have been reported as a pack on that test alone.
 */
check(
  "a bunched board has no dominant cliff",
  bunched.spread.dominantCliff === false,
  `largest ${bunched.spread.largestAdjacentPointsGap} vs typical ${bunched.spread.medianAdjacentPointsGap}`,
);
for (const key of ["outlier-low", "runaway", "tie-then-cliff"] as const) {
  const r = results.get(key)!;
  const inBand = r.spread.teamsWithinOneWin ?? r.spread.teamsWithinPointsBand;
  check(
    `a cliff overrules a bunched middle (${key}: ${inBand} of 10 within a win, ` +
      `${r.spread.largestAdjacentPointsGap} gap at ranks ${r.spread.largestGapBetweenRanks?.join("–")})`,
    r.spread.dominantCliff === true && r.spread.shape !== "pack",
    `dominantCliff=${r.spread.dominantCliff} shape=${r.spread.shape}`,
  );
}

section("2. Nothing is cached between boards");

/*
 * The projections snapshot IS memoised, deliberately — it is a file that does
 * not change during a process. The board is not, and this is the check that
 * says so: the first fixture is rebuilt from scratch after five other boards
 * have been through the same functions, and it has to come back identical.
 */
const rebuilt = spreadOf(reshape(baseView, [ids], pointsOf));
check(
  "rebuilding a board after five others reproduces it exactly",
  JSON.stringify(rebuilt.spread) === JSON.stringify(bunched.spread) &&
    JSON.stringify(rebuilt.points) === JSON.stringify(bunched.points),
);
check(
  "…and the stratified board still disagrees with it",
  JSON.stringify(stratified.points) !== JSON.stringify(bunched.points),
);

section("3. The prompt says something positive in every shape");

const prompt = recapSystemPrompt();

check(
  "the model is told to narrate the computed shape rather than the numbering",
  prompt.includes("projectedStandings.spread") && /narrate the shape you are given/i.test(prompt),
);
check(
  'the "pack" branch still restrains the model',
  /shape: "pack"/.test(prompt) && /may not describe any gap in the middle/i.test(prompt),
);
check(
  'the "tiered" branch names where the cliff is',
  /shape: "tiered"/.test(prompt) && prompt.includes("largestGapBetweenRanks"),
);
/*
 * THE ONE THAT MATTERS TONIGHT. A separated field used to be handled by simply
 * dropping the pack restriction, which is not the same thing as an instruction:
 * a model that has spent four hundred words being told the league is tight will
 * keep hedging when the hedging rule quietly stops applying. So the separated
 * branch has to be an affirmative order, with figures named, and it is asserted
 * by marker rather than by prose so that rewording the paragraph cannot silently
 * delete the licence.
 */
check(
  'the "separated" branch is a licence to swing, not just an absent restriction',
  prompt.includes(SEPARATED_FIELD_MARKER),
  "SEPARATED_FIELD_MARKER is missing from the rendered prompt",
);
check(
  "…and it tells the model which figures to hit the gap with",
  /shape: "separated"/.test(prompt) &&
    /pointsFirstToLast/.test(prompt) &&
    /winsFirstToLast/.test(prompt),
);
check(
  "…and it explicitly overrides the tightness framing rather than leaving it hanging",
  /do not hedge|stop hedging|the tightness rule does not apply/i.test(prompt),
);

section("4. The write-off ban does not gag a supported burial");

/*
 * The ban exists so that a bunched board cannot get a franchise buried on vibes,
 * and the pre-draft rationale for it is sound. The risk on a stratified board is
 * the opposite one: that a rule aimed at unsupported verdicts starts catching
 * supported ones and the recap softens exactly where the numbers licence a
 * swing.
 *
 * So the ban is run over sentences a brutal, numerate blurb has to be able to
 * write about a genuinely broken roster. Every one of these names a decision or
 * a figure rather than the franchise's viability, which is the line the rule is
 * meant to draw — if any of them trips, the rule has stopped drawing it.
 */
const mustSurvive = [
  "Nobody in this league gave up more value: 218 slots of reaches, and the next worst is 94.",
  "He walked out with no startable running back. RB2 is a 41-point deficit on the league mean.",
  "That is the worst starting lineup on the board by 340 points and it is not close.",
  "Four quarterbacks in a league that starts one. Three of them cannot play a down for him.",
  "He paid the 41st pick for a tight end the board had at 58 — a nineteen-slot reach, and his second of the night.",
  "Last on points, last on projected wins, and 12% to make the playoffs. Fix the RB room.",
];
const gagged = mustSurvive.flatMap((sentence) => {
  const text = sentence.toLowerCase();
  return WRITTEN_OFF_FRAMINGS.filter((p) => text.includes(p)).map(
    (p) => `"${p}" caught: ${sentence}`,
  );
});
check(
  `a numerically supported burial survives all ${WRITTEN_OFF_FRAMINGS.length} banned framings`,
  gagged.length === 0,
  gagged.join("; "),
);

/*
 * And the converse, so the check above cannot pass by the ban having been
 * quietly emptied out. These are the unsupported verdicts the rule is for.
 */
const mustBeCaught = [
  "His season is over before it started.",
  "This roster is dead. Pack it up.",
  "He drafted himself out of contention in round three.",
];
const escaped = mustBeCaught.filter(
  (s) => !WRITTEN_OFF_FRAMINGS.some((p) => s.toLowerCase().includes(p)),
);
check(
  "…while the unsupported ones are still caught",
  escaped.length === 0,
  escaped.join("; "),
);
check(
  "the prompt still states that narrowing the target does not soften the punch",
  /does not soften the punch/i.test(prompt) && /roasted without mercy/i.test(prompt),
);

// --- Result -----------------------------------------------------------------

console.log("");
if (failures > 0) {
  console.error(`${failures} check${failures === 1 ? "" : "s"} failed.`);
  process.exit(1);
}
console.log("All spread checks passed.");

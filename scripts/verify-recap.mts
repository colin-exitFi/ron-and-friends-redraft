/**
 * Proves the recap's arithmetic on a COMPLETE board, without an API key and
 * without touching the live draft.
 *
 *   npm run verify:recap
 *
 * The real board is empty until Saturday, so a dossier built from it would be
 * ten franchises of keepers and nothing to say. This runs the mock draft to
 * completion through the real engine — `runWholeMock`, seeded so two runs agree
 * — and builds the dossier from the finished room view. Nothing is written
 * anywhere: the mock state lives in memory and is dropped when the process
 * exits.
 *
 * What it proves:
 *   1.  The keeper count is DERIVED from the assembled board, and equals the
 *       number `buildExpectedPicks` removed from the pool. This is the one that
 *       matters: the declaration files say 14 and 16, the board says something
 *       else again, and a blurb quoting the wrong figure is the feature getting
 *       caught out loud.
 *   2.  Every gap is `expectedPick - overallPick` in board units, and the sign
 *       convention holds — positive is a reach.
 *   3.  `valueGained` is exactly `-gap` summed, and the leaderboard is that
 *       number in order, so the table cannot disagree with the cards above it.
 *   4.  The extremes really are the extremes, per franchise and league-wide.
 *   5.  Ten franchises, every rostered player accounted for as a keeper or a
 *       pick, and no player counted twice.
 *   6.  Every pick-capital figure printed on a card recomputes off the slots,
 *       including the league median — which is the figure a blurb will lean on
 *       hardest and the one the commissioner's own recollection got wrong.
 *   7.  The dossier is small enough to be a prompt.
 *   8.  The prompt knows which night it is. A pre-draft board has no picks on
 *       it, and a post-draft brief handed to one produces blurbs narrating
 *       empty arrays — which shipped, and read as though written about a
 *       different league.
 *   9.  The voice still carries an assigned range, a standing praise rule and a
 *       fenced profanity licence. All three read like style advice and are in
 *       fact the fix for a generation that came back flat.
 *   10. The savage blurb is still aimed where the commissioner asked it to be,
 *       and still fenced to that manager's own numbers.
 *   11. Witte's absence is still scoped to this one draft rather than served up
 *       as a permanent identity, in both the lore and the note behind it.
 *
 * Exits non-zero on the first failure.
 */

import { readFileSync } from "node:fs";

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import {
  GRADE_SUBJECT_BY_STAGE,
  NOBODY_ESCAPES_MARKER,
  PREDRAFT_MARKER,
  PROVENANCE_MARKER,
  RANGE_MARKER,
  SETUP_MARKER,
  WRITTEN_OFF_FRAMINGS,
  recapStage,
  recapSystemPrompt,
  recapUserMessage,
  wasKeepingWorthIt,
} from "@/lib/recap-prompt";
import {
  GRADE_CITATION_MARKER,
  GRADE_POSITION_MARKER,
  GRADE_PROVENANCE_MARKER,
  GRADE_SUBJECT_MARKER,
  GRADE_YARDSTICK_MARKER,
  GRADE_RULES,
  SUBJECT_LABEL,
  buildGradeInput,
  gradeSubject,
} from "@/lib/recap-grade";
import { readGradeHistory } from "@/lib/recap-grade-source";
import {
  NORMS_MARKER,
  positionalNorms,
  positionalNormsBlock,
} from "@/lib/positional-norms";
import {
  ASSIGNED_SAVAGE,
  SAVAGE_ORDER_MARKER,
  loreBlock,
  withheldNoteCount,
} from "@/lib/league-lore";
import { recapLocation } from "@/lib/recap-store";
import {
  readClosedKeeperLists,
  readKeeperOptions,
  readProjectedStandings,
} from "@/lib/recap-source";
import { defaultAssignment, runWholeMock, toMockPool } from "@/lib/mock-draft-run";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { FEATURES } from "@/lib/league-config";

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

const board = getBoard();
const pool = getPlayerPool();

/*
 * ============================================================================
 * THIS HARNESS IS THE PREVIOUS LEAGUE'S, AND IT DOES NOT APPLY TO A REDRAFT
 * ============================================================================
 *
 * It asserts, across twenty-three sections, that the recap knows things Ron and
 * Friends does not have: keepers on the board and their counterfactual cost,
 * positional prices computed off the old league's spreadsheets, a keeper table
 * in the history file, a nominated target for the savage blurb, and specific
 * facts about Witte, Stefan and Elbe — three managers who are not in this room.
 *
 * Those assertions do not merely go stale here, they INVERT. 25bb1bb and
 * 40f940b deliberately emptied the lore so the recap cannot invent a past for
 * ten managers who have none, and `verify:recap:clean` exists to prove exactly
 * that — including that the savage blurb is aimed at nobody and the positional
 * price block is empty. So the two harnesses now demand opposite things, and
 * this one is the superseded half.
 *
 * IT EXITS HERE RATHER THAN PRINTING A DOZEN CONTRADICTORY FAILURES. A red
 * script nobody can explain at deploy time is how a real failure gets waved
 * through as "oh, that one's known" — which is the specific outcome this guard
 * is for. The sections below are kept, not deleted: they are the harness for a
 * keeper league, and this league votes on keepers for 2027.
 */
if (!FEATURES.keepers) {
  section("Not applicable — 2026 is a pure redraft");
  console.log(
    "  This harness checks a KEEPER league's recap: keeper counterfactuals,\n" +
      "  positional prices off the league's own draft history, and named facts\n" +
      "  about managers from the league this app was forked from.\n\n" +
      "  Ron and Friends has no keepers, no draft history and none of those\n" +
      "  managers, so every one of those assertions would fail on the LEAGUE\n" +
      "  rather than on a bug.\n\n" +
      "  What covers the recap for this league instead, and does pass:\n" +
      "    npm run verify:recap:clean    no foreign lore reaches the model\n" +
      "    npm run verify:recap:spread   the verdicts still spread across grades\n\n" +
      "  Turning FEATURES.keepers on for 2027 runs everything below again.",
  );
  process.exit(0);
}

section("Running a whole mock draft through the real engine");
const { view, steps } = runWholeMock({
  board,
  pool: toMockPool(pool),
  archetypes: defaultAssignment(board),
  rng: mulberry32(20260829),
});
console.log(`  ${steps} picks made, ${view.filled}/${view.slots.length} slots filled`);
check("the board finished — no owned slot is empty", view.remaining === 0, `${view.remaining} left`);

const expectedPick = buildExpectedPicks(pool, view.slots);
const keeperOptions = readKeeperOptions();
const closedKeeperLists = readClosedKeeperLists();
const dossier = buildRecapDossier({
  view,
  expectedPick,
  pool,
  keeperOptions,
  closedKeeperLists,
  projectedStandings: readProjectedStandings(view),
});

section("1. The keeper count is derived, not asserted");
const keepersOnBoard = view.slots.filter((s) => s.isKeeper && s.player).length;
check(
  `keepersOutOfPool is counted off the board (${dossier.keepersOutOfPool})`,
  dossier.keepersOutOfPool === keepersOnBoard,
  `dossier ${dossier.keepersOutOfPool} vs board ${keepersOnBoard}`,
);
/*
 * The load-bearing one. `buildExpectedPicks` removes kept players from the pool
 * before ranking it; if the dossier's figure were read from anywhere else, a
 * blurb could quote a keeper count the expectation was never computed against.
 */
const keptIds = new Set(
  view.slots.filter((s) => s.isKeeper && s.player).map((s) => s.player!.id),
);
const rankedWithAdp = pool.filter((p) => p.adp != null).length;
const rankedAfterKeepers = pool.filter((p) => p.adp != null && !keptIds.has(p.id)).length;
check(
  "…and it is the same set of players the expectation removed from the pool",
  rankedWithAdp - rankedAfterKeepers ===
    [...keptIds].filter((id) => pool.find((p) => p.id === id)?.adp != null).length,
);
check(
  `draftableSlots matches the board (${dossier.draftableSlots})`,
  dossier.draftableSlots === view.slots.filter((s) => !s.isKeeper).length,
);
console.log(
  `  (for the record: ${dossier.keepersOutOfPool} kept, ` +
    `${dossier.draftableSlots} draftable, board summary says ${view.keeperCount})`,
);

section("2. Every gap is expected − overall, in board units");
let gapErrors = 0;
let signErrors = 0;
for (const f of dossier.franchises) {
  for (const p of f.picks) {
    if (p.expectedPick === null || p.slotsVsBoard === null) continue;
    if (p.slotsVsBoard !== Math.round(p.expectedPick - p.overallPick)) gapErrors++;
    // A reach is a player taken EARLIER than his expectation, so a positive gap
    // must always come with an expectation above the pick it was made at.
    if (p.slotsVsBoard > 0 !== p.expectedPick > p.overallPick) signErrors++;
  }
}
check("gap === expectedPick − overallPick for every scored pick", gapErrors === 0, `${gapErrors} wrong`);
check("positive gap always means taken earlier than expected", signErrors === 0, `${signErrors} wrong`);

section("3. Value totals agree with the picks they come from");
let valueErrors = 0;
for (const f of dossier.franchises) {
  const summed = f.picks
    .filter((p) => p.slotsVsBoard !== null)
    .reduce((sum, p) => sum - p.slotsVsBoard!, 0);
  if (summed !== f.valueGained) valueErrors++;
}
check("valueGained is −gap summed, per franchise", valueErrors === 0, `${valueErrors} wrong`);
check(
  "the leaderboard is that number in descending order",
  dossier.valueLeaderboard.every(
    (row, i) => i === 0 || row.valueGained <= dossier.valueLeaderboard[i - 1].valueGained,
  ),
);
check(
  "the leaderboard names the same ten franchises",
  new Set(dossier.valueLeaderboard.map((r) => r.teamId)).size === dossier.teamCount,
);

section("4. The extremes are really the extremes");
let extremeErrors = 0;
for (const f of dossier.franchises) {
  const scored = f.picks.filter((p) => p.slotsVsBoard !== null);
  if (!scored.length) continue;
  const minGap = Math.min(...scored.map((p) => p.slotsVsBoard!));
  const maxGap = Math.max(...scored.map((p) => p.slotsVsBoard!));
  if (f.bestSteal?.slotsVsBoard !== minGap) extremeErrors++;
  if (f.worstReach?.slotsVsBoard !== maxGap) extremeErrors++;
}
check("each franchise's best steal and worst reach are its own extremes", extremeErrors === 0);
check(
  "the league's biggest steals are sorted deepest first",
  dossier.biggestSteals.every((p, i) => i === 0 || p.slotsVsBoard! >= dossier.biggestSteals[i - 1].slotsVsBoard!),
);
check(
  "the league's biggest reaches are sorted worst first",
  dossier.biggestReaches.every((p, i) => i === 0 || p.slotsVsBoard! <= dossier.biggestReaches[i - 1].slotsVsBoard!),
);

section("5. Every rostered player is accounted for exactly once");
check(`ten franchises`, dossier.franchises.length === dossier.teamCount);
const named = dossier.franchises.flatMap((f) => [
  ...f.picks.map((p) => p.player),
  ...f.keepers.map((k) => k.player),
]);
check(
  `every filled slot appears in exactly one franchise (${named.length})`,
  named.length === view.filled,
  `dossier ${named.length} vs board ${view.filled}`,
);
check("and no player appears twice", new Set(named).size === named.length);
check(
  "keepers are never listed among the picks",
  dossier.franchises.every((f) => f.picks.every((p) => p.slotsVsBoard !== undefined)) &&
    dossier.franchises.reduce((n, f) => n + f.keepers.length, 0) === dossier.keepersOutOfPool,
);

section("6. The keeper counterfactual is sound");
check(
  `the keeper sheet loaded (${keeperOptions.length} eligible players)`,
  keeperOptions.length > 0,
);
/*
 * A one-year rental cannot be kept, and the sheet still marks him eligible
 * because it predates the ruling. If one of these reached a blurb it would
 * read as "you could have kept Bijan Robinson" to a man who could not have.
 */
check(
  "no round-1 rental is offered as a keeper option",
  keeperOptions.every((o) => o.costRound >= 1),
);
check(
  "nobody is told they passed on a player somebody kept",
  dossier.franchises.every((f) =>
    f.passedOnKeepers.every(
      (p) =>
        !dossier.franchises.some((g) =>
          g.keepers.some((k) => k.player.toLowerCase() === p.player.toLowerCase()),
        ),
    ),
  ),
);
/*
 * THE SAME CHECK WITH THE SUFFIX OFF, because the exact-match version above
 * passed for months while the bug was live. The board calls Josh's keeper
 * "Travis Etienne" and the keeper sheet calls him "Travis Etienne Jr", so he
 * appeared in his own franchise's `passedOnKeepers` and a shipped blurb said
 * Josh "kept one Etienne and let the other one walk out the door" — a false
 * statement about a real manager, with a round number attached, in front of the
 * room. A suffix is not an identity.
 */
const looseName = (n: string) =>
  n
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "");
const keptLoose = new Set(
  dossier.franchises.flatMap((f) => f.keepers.map((k) => looseName(k.player))),
);
const phantoms = dossier.franchises.flatMap((f) =>
  f.passedOnKeepers
    .filter((p) => keptLoose.has(looseName(p.player)))
    .map((p) => `${f.teamName}: ${p.player}`),
);
check(
  "…and not under a spelling of his name with the suffix taken off either",
  phantoms.length === 0,
  phantoms.join("; "),
);
check(
  "every keeper is priced against the open market",
  dossier.franchises.every((f) =>
    f.keepers.every((k) => k.pickIfReleased !== null && k.slotsSavedByKeeping !== null),
  ),
);
/*
 * The sign that the whole Nacua joke rests on. A keeper sitting at a late board
 * slot whose open-market price is early is a BARGAIN, and must read positive.
 */
const priced = dossier.franchises.flatMap((f) => f.keepers);
check(
  "surplus is positive when a keeper costs later than his market price",
  priced.every(
    (k) => k.slotsSavedByKeeping === null || k.slotsSavedByKeeping === k.costOverallPick - k.pickIfReleased!,
  ),
);
const bargain = [...priced].sort((a, b) => (b.slotsSavedByKeeping ?? 0) - (a.slotsSavedByKeeping ?? 0))[0];
console.log(
  `  biggest keeper bargain: ${bargain?.player} at ${bargain?.label} ` +
    `(market slot ${bargain?.pickIfReleased}, +${bargain?.slotsSavedByKeeping} slots)`,
);

section("7. No card can contradict itself");
/*
 * THE REGRESSION THIS EXISTS FOR. Keeper value was briefly measured against a
 * board on which nobody had been kept, while the history file measured it
 * against the release counterfactual. Greg's keepers came out at -8 and -9 here
 * and +4 there, the model quoted the history file, and the blurb printed a
 * number that disagreed with the receipt directly beneath it. One visibly wrong
 * number on a card and the room stops trusting the other nine.
 */
const historyFile = "data/league-history.json";
let historyKeepers: { player: string; slotsSavedByKeeping: number; pickIfReleased?: number }[] = [];
try {
  historyKeepers = JSON.parse(readFileSync(historyFile, "utf8")).keeperBoard2026.keepers;
} catch {
  historyKeepers = [];
}
check(`the history file's keeper table loaded`, historyKeepers.length > 0);

const norm = (n: string) => n.toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
const dossierKeepers = new Map(
  dossier.franchises.flatMap((f) => f.keepers.map((k) => [norm(k.player), k])),
);
/*
 * DRIFT IS REPORTED, NOT FAILED. The history file is a dated artefact and the
 * dossier recomputes from whatever pool is on disk, so re-pulling ADP moves one
 * and not the other. That is expected and harmless in the document. It is NOT
 * harmless in a prompt — the model reads the document's figures and the card
 * prints the dossier's, and the room sees both on the same line — so it is
 * named loudly with the fix next to it rather than swallowed.
 */
const disagreements = historyKeepers.filter((h) => {
  const mine = dossierKeepers.get(norm(h.player));
  return mine && mine.slotsSavedByKeeping !== h.slotsSavedByKeeping;
});
if (disagreements.length) {
  console.log(
    `  ! ${disagreements.length} keeper value(s) have drifted from data/league-history.json:\n` +
      disagreements
        .map(
          (h) =>
            `      ${h.player}: history ${h.slotsSavedByKeeping}, board ${dossierKeepers.get(norm(h.player))?.slotsSavedByKeeping}`,
        )
        .join("\n") +
      `\n    The pool has moved under the document. Run \`npm run sync:history-keepers\`.`,
  );
} else {
  console.log("  ✓ every keeper is worth the same on the card as in the history file");
}
check(
  "the history file states keeper value on the release basis, not the pick basis",
  historyKeepers.every(
    (h) => typeof h.slotsSavedByKeeping === "number" && "pickIfReleased" in h,
  ),
);
/*
 * And the two measures must stay genuinely distinct. If a refactor ever made
 * `pickIfReleased` equal `expectedPick`, every check above would still pass and
 * the distinction the prompt spends a section on would have quietly collapsed.
 */
check(
  "the keeper measure is not just the pick measure under another name",
  dossier.franchises
    .flatMap((f) => f.keepers)
    .some((k) => k.pickIfReleased !== null && expectedPick[
      view.slots.find((s) => s.player?.name === k.player)?.player?.id ?? ""
    ] === undefined),
  "a keeper should have no expectedPick at all — he was never in that pool",
);

section("8. Pick capital is the board's arithmetic, not a second opinion");
/*
 * THE RECEIPT THIS EXISTS FOR. "You walked in with three fourths" is printed on
 * the card and read out loud, and the commissioner's own recollection of it was
 * off by a round — he had Zach at two sixth-rounders when the board gives him
 * one, with a keeper in it. So every figure the chip prints is recomputed here
 * off the slots, including the league median, which is the one a model would
 * otherwise be tempted to eyeball across ten objects.
 */
const capitals = dossier.franchises.map((f) => f.pickCapital);
check("every franchise has a capital profile", capitals.length === dossier.teamCount);

const capitalErrors: string[] = [];
for (const f of dossier.franchises) {
  const c = f.pickCapital;
  const held = view.slots.filter((s) => s.currentOwner.id === f.teamId);
  const draftable = held.filter((s) => !s.isKeeper);

  // Draftable plus keeper-consumed must be every slot he owns, or a round has
  // been double-counted or lost.
  if (c.draftableRounds.length + c.keeperConsumedRounds.length !== held.length) {
    capitalErrors.push(`${f.teamName}: rounds do not add up to slots held`);
  }
  if (c.draftableRounds.length !== draftable.length) {
    capitalErrors.push(`${f.teamName}: draftableRounds miscounted`);
  }
  if (c.earlyPicks !== draftable.filter((s) => s.round <= c.earlyThroughRound).length) {
    capitalErrors.push(`${f.teamName}: earlyPicks wrong`);
  }
  if (c.acquired.length !== f.draftCapital.acquired) {
    capitalErrors.push(`${f.teamName}: acquired disagrees with draftCapital`);
  }
  if (c.surrendered.length !== f.draftCapital.tradedAway) {
    capitalErrors.push(`${f.teamName}: surrendered disagrees with draftCapital`);
  }
  // A doubled round is a round he can really pick twice in.
  for (const d of c.doubledRounds) {
    if (draftable.filter((s) => s.round === d.round).length !== d.count) {
      capitalErrors.push(`${f.teamName}: R${d.round} is not doubled ${d.count}×`);
    }
  }
  // An empty round is one with no DRAFTABLE pick — a keeper-consumed round is
  // empty too, and that is the distinction the prompt spends a bullet on.
  const draftableRoundSet = new Set(draftable.map((s) => s.round));
  if (c.emptyRounds.some((r) => draftableRoundSet.has(r))) {
    capitalErrors.push(`${f.teamName}: an "empty" round has a pick in it`);
  }
  if (c.emptyRounds.length + draftableRoundSet.size !== view.rounds) {
    capitalErrors.push(`${f.teamName}: emptyRounds does not complete the board`);
  }
  if (c.longestGapAfterRound !== null) {
    const from = c.longestGapAfterRound + 1;
    const run = Array.from({ length: c.longestGapRounds }, (_, i) => from + i);
    if (run.some((r) => draftableRoundSet.has(r))) {
      capitalErrors.push(`${f.teamName}: the drought is not actually empty`);
    }
  }
}
check("each profile recomputes off the slots it claims to describe", capitalErrors.length === 0, capitalErrors.join("; "));

/*
 * The comparison the blurb will lean on. `earlyPicksLeagueMedian` must be one
 * number for the whole league, or two cards print different medians and the
 * room notices before the second blurb is finished being read.
 */
check(
  "the league median is the same figure on all ten cards",
  new Set(capitals.map((c) => c.earlyPicksLeagueMedian)).size === 1,
);
const earlySorted = [...capitals.map((c) => c.earlyPicks)].sort((a, b) => a - b);
const mid = Math.floor(earlySorted.length / 2);
const trueMedian =
  earlySorted.length % 2
    ? earlySorted[mid]
    : Math.round(((earlySorted[mid - 1] + earlySorted[mid]) / 2) * 10) / 10;
check(
  `…and it really is the median (${capitals[0].earlyPicksLeagueMedian})`,
  capitals[0].earlyPicksLeagueMedian === trueMedian,
  `dossier ${capitals[0].earlyPicksLeagueMedian} vs ${trueMedian}`,
);
check(
  "vsMedian is the difference, not a second calculation",
  capitals.every(
    (c) =>
      Math.abs(c.earlyPicksVsMedian - (c.earlyPicks - c.earlyPicksLeagueMedian)) < 0.05,
  ),
);
check(
  "rank 1 is the richest early board and ties share it",
  capitals.every((c) =>
    capitals.filter((o) => o.earlyPicks > c.earlyPicks).length + 1 === c.earlyCapitalRank,
  ),
);

/*
 * The weighted measure. It is only meaningful if it partitions: the window is a
 * fixed number of slots at the top of the board and every one of them is owned
 * by somebody, so the ten captures must sum to exactly the window.
 */
const windowSize = capitals[0].topTalentWindow;
check(
  `the top-talent window is shared out exactly (${windowSize} slots)`,
  capitals.reduce((n, c) => n + c.topTalentCaptured, 0) === windowSize,
  `${capitals.reduce((n, c) => n + c.topTalentCaptured, 0)} claimed`,
);
const earliestDraftable = new Set(
  view.slots
    .filter((s) => !s.isKeeper)
    .map((s) => s.overallPick)
    .sort((a, b) => a - b)
    .slice(0, windowSize),
);
check(
  "…and each franchise's share is its own slots inside that window",
  dossier.franchises.every(
    (f) =>
      f.pickCapital.topTalentCaptured ===
      view.slots.filter(
        (s) =>
          s.currentOwner.id === f.teamId && !s.isKeeper && earliestDraftable.has(s.overallPick),
      ).length,
  ),
);
/*
 * Named off `expectedPick` rather than off the board, which is the whole reason
 * this reuses `@/lib/expected-pick` instead of ranking ADP again. If a name
 * appeared here that the expectation never put at that slot, the receipt would
 * be quoting a different board from every gap on the card.
 */
const expectedNames = new Set(
  pool.filter((p) => earliestDraftable.has(expectedPick[p.id] ?? -1)).map((p) => p.name),
);
check(
  "every named top-talent player is one the expectation put in that window",
  capitals.every((c) => c.topTalentPlayers.every((n) => expectedNames.has(n))),
);
check(
  "nobody is named by two franchises",
  (() => {
    const all = capitals.flatMap((c) => c.topTalentPlayers);
    return new Set(all).size === all.length;
  })(),
);

/* Trades have two sides, so the league's books must balance. */
check(
  "every acquired pick is a pick somebody surrendered",
  capitals.reduce((n, c) => n + c.acquired.length, 0) ===
    capitals.reduce((n, c) => n + c.surrendered.length, 0),
);

const richest = [...dossier.franchises].sort(
  (a, b) => b.pickCapital.earlyPicks - a.pickCapital.earlyPicks,
)[0];
const poorest = [...dossier.franchises].sort(
  (a, b) => a.pickCapital.earlyPicks - b.pickCapital.earlyPicks,
)[0];
console.log(
  `  early capital: ${richest.teamName} ${richest.pickCapital.earlyPicks} ` +
    `down to ${poorest.teamName} ${poorest.pickCapital.earlyPicks}, ` +
    `median ${capitals[0].earlyPicksLeagueMedian}`,
);
for (const f of dossier.franchises) {
  const c = f.pickCapital;
  console.log(
    `  ${f.teamName.padEnd(8)} R1-${c.earlyThroughRound}: ${c.earlyPicks}` +
      ` (rank ${c.earlyCapitalRank})  top-${c.topTalentWindow}: ${c.topTalentCaptured}` +
      `  ${c.doubledRounds.map((d) => `${d.count}×R${d.round}`).join(",") || "—"}` +
      `  keepers in R${c.keeperConsumedRounds.join("/R") || "—"}`,
  );
}

section("9. The projected standings are a table, not an opinion");
const standings = dossier.projectedStandings;
if (!standings) {
  console.log(
    "  – no projections snapshot on this checkout, so the tab shows the honest\n" +
      "    'not available' state. Run `npm run pull:projections` to exercise this.",
  );
} else {
  check(
    `all ${dossier.teamCount} franchises are ranked`,
    standings.rows.length === dossier.teamCount,
    `${standings.rows.length}`,
  );
  check(
    "ranks are 1..N with no gaps and no ties",
    standings.rows
      .map((r) => r.rank)
      .sort((a, b) => a - b)
      .every((r, i) => r === i + 1),
  );
  /*
   * The order must BE the points order. If it ever silently became the wins
   * order, every label on the page and every sentence in the prompt would be
   * describing a different table from the one on screen.
   */
  check(
    "the order really is on projected points, as the caption claims",
    standings.rows.every(
      (r, i) => i === 0 || r.projectedPoints <= standings.rows[i - 1].projectedPoints,
    ),
  );
  check(
    "every ranked franchise is one that is actually on this board",
    standings.rows.every((r) => dossier.franchises.some((f) => f.teamId === r.teamId)),
  );
  check(
    "the basis carries a disclaimer the page can print verbatim",
    standings.basis.disclaimer.length > 20 &&
      standings.basis.projectionsSource.length > 0 &&
      standings.basis.projectionsPulledAt.length > 0,
  );
  /*
   * THE SPREAD. A table sorted one to ten reads as a hierarchy whether or not
   * one exists, and the commissioner's brief is that this league is tight. So
   * the shape is arithmetic rather than a judgement the model makes on the way
   * past, and every figure it acts on is recomputed here.
   */
  const spread = standings.spread;
  const points = standings.rows.map((r) => r.projectedPoints);
  const adjacent = points.slice(1).map((p, i) => Math.round((points[i] - p) * 10) / 10);
  check(
    "the spread is measured on the table as printed",
    Math.abs(spread.pointsFirstToLast - (points[0] - points[points.length - 1])) < 0.15,
    `${spread.pointsFirstToLast} vs ${(points[0] - points[points.length - 1]).toFixed(1)}`,
  );
  check(
    "the largest adjacent gap really is the largest",
    Math.abs(spread.largestAdjacentPointsGap - Math.max(...adjacent)) < 0.15,
  );
  check(
    "…and it is attributed to the ranks it actually falls between",
    spread.largestGapBetweenRanks !== null &&
      Math.abs(
        points[spread.largestGapBetweenRanks[0] - 1] -
          points[spread.largestGapBetweenRanks[1] - 1] -
          spread.largestAdjacentPointsGap,
      ) < 0.15,
  );
  check(
    "the median adjacent gap is never larger than the largest one",
    spread.medianAdjacentPointsGap <= spread.largestAdjacentPointsGap + 0.05,
  );
  const winsAll = standings.rows.map((r) => r.projectedWins);
  const everySimulated = winsAll.every((w) => w !== null);
  check(
    "the shape is decided on wins when a schedule backed the simulation",
    spread.basedOn === (everySimulated ? "wins" : "points"),
    spread.basedOn,
  );
  if (everySimulated) {
    const wins = winsAll as number[];
    const sortedWins = [...wins].sort((a, b) => a - b);
    const wMid = Math.floor(sortedWins.length / 2);
    const winsMedian =
      sortedWins.length % 2
        ? sortedWins[wMid]
        : (sortedWins[wMid - 1] + sortedWins[wMid]) / 2;
    check(
      `teamsWithinOneWin counts the pack (${spread.teamsWithinOneWin})`,
      spread.teamsWithinOneWin === wins.filter((w) => Math.abs(w - winsMedian) <= 1).length,
    );
    check(
      "winsFirstToLast is the first row minus the last",
      spread.winsFirstToLast !== null &&
        Math.abs(spread.winsFirstToLast - (wins[0] - wins[wins.length - 1])) < 0.15,
    );
  }
  /*
   * The rule the prompt acts on, restated here so a future change to the
   * thresholds cannot leave the prompt describing a different classification
   * from the one the field carries.
   */
  const inPack = spread.teamsWithinOneWin ?? spread.teamsWithinPointsBand;
  const half = Math.ceil(standings.rows.length / 2);
  /*
   * A cliff overrules a bunched middle. Restated here rather than imported so
   * that moving the threshold has to be done twice, deliberately — the whole
   * point of this check is that the prompt cannot end up describing a
   * classification the field does not carry. `verify:recap:spread` is what
   * proves the rule fires on boards other than this one.
   */
  const cliff =
    spread.largestAdjacentPointsGap >= spread.medianAdjacentPointsGap * 3 &&
    spread.largestAdjacentPointsGap >= spread.pointsBand &&
    spread.largestAdjacentPointsGap > 0;
  check(
    `dominantCliff is computed off the printed gaps (${spread.dominantCliff})`,
    spread.dominantCliff === cliff,
    `${spread.largestAdjacentPointsGap} largest vs ${spread.medianAdjacentPointsGap} typical, band ${spread.pointsBand}`,
  );
  check(
    `the shape follows its own stated rule ("${spread.shape}", ${inPack} in the pack)`,
    spread.shape ===
      (inPack >= half
        ? spread.dominantCliff
          ? "tiered"
          : "pack"
        : inPack <= 3
          ? "separated"
          : "tiered"),
  );
  console.log(
    `  spread: ${spread.shape} — ${spread.pointsFirstToLast} points first to last, ` +
      `median neighbour gap ${spread.medianAdjacentPointsGap}, ` +
      `biggest gap ${spread.largestAdjacentPointsGap} between ranks ` +
      `${spread.largestGapBetweenRanks?.join(" and ") ?? "—"}` +
      `${spread.teamsWithinOneWin !== null ? `, ${spread.teamsWithinOneWin} of ${standings.rows.length} within one win of the median` : ""}` +
      `${spread.teamsWithLivePlayoffOdds !== null ? `, ${spread.teamsWithLivePlayoffOdds} still a coin toss for the playoffs` : ""}`,
  );

  const simulated = standings.rows.filter((r) => r.projectedWins !== null);
  console.log(
    `  ${standings.basis.projectionsSource}, pulled ${standings.basis.projectionsPulledAt.slice(0, 10)}` +
      `${standings.basis.simulation ? `, ${standings.basis.simulation.runs.toLocaleString()} simulated seasons over ${standings.basis.simulation.games} fixtures` : ", no schedule so no simulation"}`,
  );
  /*
   * Points order and wins order are allowed to differ — that difference is
   * schedule luck and the prompt treats it as material. What is NOT allowed is
   * the page implying the ranking is the wins order, which is why the caption
   * and this check both name points explicitly.
   */
  if (simulated.length) {
    const winsOrder = [...simulated].sort((a, b) => b.projectedWins! - a.projectedWins!);
    const disagreements = winsOrder.filter((r, i) => r.teamId !== simulated[i].teamId).length;
    console.log(
      `  points order and simulated-wins order disagree for ${disagreements} of ${simulated.length} — ` +
        `that gap is schedule luck, and the caption says the table is on points`,
    );
  }
}

section("10. Nobody is written off");
/*
 * THE RULE THIS ENFORCES, in the commissioner's words: "no one drafts themself
 * out of contention in this league... however... people still make bonehead
 * mistakes. I expected things to be tight."
 *
 * It is an accuracy rule, not a politeness one. A blurb declaring a roster dead
 * on draft night is asserting something the season has not decided, and it
 * fails for the same reason a wrong reach call fails — somebody in the room
 * will argue, and he will be right. So the ban is checked in two places: it
 * must still be IN the prompt, and no blurb that has actually been written may
 * contain one.
 */
const systemPrompt = recapSystemPrompt();
check(
  `the prompt still carries the ban (${WRITTEN_OFF_FRAMINGS.length} framings)`,
  WRITTEN_OFF_FRAMINGS.every((phrase) => systemPrompt.includes(phrase)),
  "a framing was dropped from WRITTEN_OFF_FRAMINGS' rendering",
);
check(
  "…and says why the league is competitive rather than just asserting it",
  /competitive as hell|nobody drafts himself out of contention/i.test(systemPrompt),
);
check(
  "the ban is explicitly narrowed to the target, not the force",
  /does not soften the punch/i.test(systemPrompt) &&
    /roasted without mercy/i.test(systemPrompt),
);
check(
  "the prompt tells the model to narrate the spread it is given",
  systemPrompt.includes("projectedStandings.spread") &&
    /narrate the shape you are given/i.test(systemPrompt),
);

/*
 * And the same list run over whatever the model has actually produced. Absent
 * on a fresh checkout, which is not a failure — the prompt-side check above is
 * what holds when there is nothing to scan.
 */
const storedRecap = recapLocation(dossier.season);
let storedBlurbs: { teamId: string; blurb: string; verdict: string }[] = [];
try {
  storedBlurbs = JSON.parse(readFileSync(storedRecap, "utf8")).blurbs ?? [];
} catch {
  storedBlurbs = [];
}
if (!storedBlurbs.length) {
  console.log(
    `  – no recap has been generated on this checkout, so there is nothing to\n` +
      `    scan. The prompt-side ban above is what holds until there is.`,
  );
} else {
  const offenders = storedBlurbs.flatMap((b) => {
    const text = `${b.blurb} ${b.verdict}`.toLowerCase();
    return WRITTEN_OFF_FRAMINGS.filter((p) => text.includes(p)).map(
      (p) => `${b.teamId}: "${p}"`,
    );
  });
  check(
    `no stored blurb writes a franchise off (${storedBlurbs.length} scanned)`,
    offenders.length === 0,
    offenders.join("; "),
  );
}

section("11. It is small enough to be a prompt");
const json = JSON.stringify(dossier);
const kb = json.length / 1024;
console.log(`  ${kb.toFixed(1)} KB of JSON, roughly ${Math.round(json.length / 4)} tokens`);
check("under 120 KB", kb < 120, `${kb.toFixed(1)} KB`);

section("12. What the model will be handed");
console.log(`  runs: ${dossier.positionRuns.length ? dossier.positionRuns
  .slice(0, 3)
  .map((r) => `${r.count}× ${r.position} (${r.fromOverallPick}–${r.toOverallPick})`)
  .join(", ") : "none"}`);
const worstQbWait = dossier.positionWaits.find((w) => w.position === "QB");
console.log(
  `  longest QB wait: ${worstQbWait?.teamName ?? "—"} at ` +
    `${worstQbWait?.firstOverallPick ?? "never took one"}`,
);
console.log(
  `  best pick: ${dossier.biggestSteals[0]
    ? `${dossier.biggestSteals[0].player} to ${dossier.biggestSteals[0].teamName} at ${dossier.biggestSteals[0].label} (${dossier.biggestSteals[0].slotsVsBoard})`
    : "none over the threshold"}`,
);
console.log(
  `  worst pick: ${dossier.biggestReaches[0]
    ? `${dossier.biggestReaches[0].player} to ${dossier.biggestReaches[0].teamName} at ${dossier.biggestReaches[0].label} (+${dossier.biggestReaches[0].slotsVsBoard})`
    : "none over the threshold"}`,
);
for (const f of dossier.valueLeaderboard) {
  const franchise = dossier.franchises.find((x) => x.teamId === f.teamId)!;
  console.log(
    `  ${String(f.rank).padStart(2)}. ${f.teamName.padEnd(8)}` +
      `${(f.valueGained > 0 ? "+" : "") + f.valueGained} slots` +
      `${franchise.oddities.length ? `  — ${franchise.oddities[0]}` : ""}`,
  );
}

section("13. The prompt knows which night it is");
/*
 * THE BUG THIS EXISTS FOR, and it shipped. The recap tab is opened before the
 * draft as well as after it, and the prompt said "has just finished its
 * 16-round in-person draft" either way. On a board with no picks that opening
 * is false, and the falsehood propagates into the material: `valueLeaderboard`
 * becomes a ten-way tie at zero that still looks like a ranking, and
 * `openStarterSlots` reports that every franchise has no quarterback — true of
 * all ten, because nobody has drafted anybody. The shipped pre-draft generation
 * duly made the no-quarterback joke about nearly every franchise in the league.
 *
 * So the stage is read off the board, and this proves the mapping and that each
 * branch says the thing that branch exists to say.
 */
check(
  "a board with no picks is predraft",
  recapStage({ picksEntered: 0, boardComplete: false }) === "predraft",
);
check(
  "a part-filled board is midraft",
  recapStage({ picksEntered: 40, boardComplete: false }) === "midraft",
);
check(
  "a finished board is postdraft",
  recapStage({ picksEntered: 141, boardComplete: true }) === "postdraft",
);
check(
  `this mock board reads as postdraft (${recapStage(dossier)})`,
  recapStage(dossier) === "postdraft",
);

const predraftPrompt = recapSystemPrompt("predraft");
const postdraftPrompt = recapSystemPrompt("postdraft");

check(
  "the predraft branch is reachable and still headed",
  predraftPrompt.includes(PREDRAFT_MARKER),
  "PREDRAFT_MARKER is missing from the rendered predraft prompt",
);
check(
  "…and the postdraft prompt does not carry it",
  !postdraftPrompt.includes(PREDRAFT_MARKER),
);
check(
  "the predraft prompt does not claim a draft has happened",
  !/has just finished its/.test(predraftPrompt) && /HAS NOT STARTED/.test(predraftPrompt),
);
/*
 * The four things that are empty or that mean something else on a pre-draft
 * board. Each of these was a live way to be confidently wrong in front of the
 * room, and three of the four actually were.
 */
check(
  "…and it says the value leaderboard is not a ranking",
  /IS NOT A RANKING/.test(predraftPrompt),
);
check(
  "…and that an empty starting slot is true of all ten, so it is a joke about nobody",
  /TRUE OF ALL TEN/.test(predraftPrompt),
);
check(
  "…and that a null passed-keeper verdict means nothing yet",
  /NOBODY HAS BEEN DRAFTED/.test(predraftPrompt),
);
check(
  "…and that weakestSlot names a keeper rather than a hole",
  /weakestSlot` is not a hole/.test(predraftPrompt),
);
check(
  "…and it forbids writing about picks nobody has made",
  /future pick, a predicted pick/.test(predraftPrompt),
);
check(
  "the predraft user message says so too",
  /THE DRAFT HAS NOT STARTED/.test(
    recapUserMessage(
      { ...dossier, picksEntered: 0, boardComplete: false },
      dossier.franchises.map((f) => f.teamId),
    ),
  ),
);

section("14. The voice still has a range, praise and a licence to swear");
/*
 * THE REGRESSION THIS EXISTS FOR is a future edit trimming Part 4 for length,
 * because all three of these read like style advice and none of them is.
 *
 * A shipped generation came back with ten blurbs that were accurate, specific,
 * and all pitched at one temperature, with no profanity in any of them and the
 * one genuinely good roster in the league praised and then immediately taken
 * back in its own closing sentence. The commissioner asked for "funnier and
 * meaner and vulgar / but also praiseful". These three sections are the answer
 * and they are asserted on every stage, because the flatness was not specific
 * to one kind of board.
 */
for (const s of ["predraft", "midraft", "postdraft"] as const) {
  const p = recapSystemPrompt(s);
  check(
    `${s}: the range is assigned rather than hoped for`,
    p.includes(RANGE_MARKER) &&
      /at least one of each of these/i.test(p) &&
      /genuinely savage/i.test(p) &&
      /unhedged, delighted praise/i.test(p),
  );
  /*
   * THE SAVAGE SLOT NOW HAS A NAME ON IT, AND THE FENCE HAS TO ARRIVE WITH IT.
   *
   * The commissioner asked for one manager by name. "Be harder on this man" is
   * the most dangerous instruction in the whole prompt, because it asks for more
   * force about a real person and force is what makes a writer reach past its
   * evidence — at the one man who is an accountant and will audit the figure.
   * So both halves are asserted: the order without the fence is the wrong
   * prompt, and an edit that keeps the aim while trimming the accuracy clause
   * ships the failure this feature cannot survive.
   */
  check(
    `${s}: the savage blurb is aimed at ${ASSIGNED_SAVAGE}`,
    p.includes(`genuinely savage, and it is aimed: it is ${ASSIGNED_SAVAGE}'s`) &&
      p.includes(SAVAGE_ORDER_MARKER),
  );
  check(
    `${s}: …and the aim buys no licence with the numbers`,
    /moves not one of the accuracy rules/.test(p) &&
      /HE IS AN ACCOUNTANT AND HE WILL CHECK/.test(p) &&
      /source every jab or he wins the argument/.test(p),
  );
  /*
   * AND THE FLOOR THE ASSIGNED RANGE DOES NOT PROVIDE. The range governs the
   * loud end; a set can satisfy every word of it and still leave two franchises
   * untouched, which is two men delighted and the other eight counting. The
   * instruction from Colin is that everybody gets roasted a little.
   * Asserted together with its reconciliation, because the floor on its own
   * reads as a licence to end the delighted blurb on a jab — which is the
   * confiscated compliment this file spent a generation removing.
   */
  check(
    `${s}: all ten take a hit, and the praise blurb still ends delighted`,
    p.includes(NOBODY_ESCAPES_MARKER) &&
      /All ten take at least one real hit/.test(p) &&
      /what it may not do is end on the hit/.test(p) &&
      /ten blurbs, ten hits/.test(p),
  );
  check(
    `${s}: praise is a standing rule, not a permission inside one branch`,
    /CONFISCATED COMPLIMENT/.test(p) && /as specific as the cruelty/i.test(p),
  );
  /*
   * Profanity is licensed AND fenced in the same breath, and the fence is the
   * half that keeps this feature worth reading: the jokes land because they are
   * real figures about real decisions, and generic swearing could be about any
   * league. Both halves are checked, because either one alone is the wrong
   * prompt.
   */
  check(
    `${s}: swearing is licensed, demonstrated, and fenced to a real observation`,
    /Profanity is authorised and wanted/.test(p) &&
      /INTENSIFIER ON A TRUE OBSERVATION, NEVER A SUBSTITUTE/.test(p) &&
      /The deletion test/.test(p) &&
      /fucking stupid/.test(p),
  );
  check(
    `${s}: a blurb may not trail off into a statistic`,
    /has not ended, it has stopped/.test(p),
  );
}

section("15. The league's own positional prices are the yardstick");
/*
 * THE ERROR THIS EXISTS FOR, and it is the worst one this feature has shipped.
 * A blurb told Josh to explain to the room why he had declined Joe Burrow at a
 * round-3 keeper price "in a league that pays six points for a passing
 * touchdown". The commissioner: "No one would touch a 3rd round QB keeper, not
 * even close." The recap criticised a correct decision, in the imperative, at a
 * named man.
 *
 * The heuristic was six-points-per-passing-TD implies quarterbacks are premium
 * implies declining one is a blunder, with the PRICE never tested against what
 * this league actually pays. So the norms are computed from the league's own
 * sheets and handed over as fact. These checks prove the figures exist, that
 * they are strong enough to settle the Burrow question, and that they reach the
 * model on every stage.
 */
const norms = positionalNorms();
check(
  "the positional norms computed off the league's own sheets",
  norms !== null && norms.seasons.length >= 4,
  norms ? `${norms.seasons.length} seasons` : "null — the spreadsheets did not load",
);
if (norms) {
  console.log(
    `  ${norms.seasons.join(", ")} · ${norms.declarations} keeper declarations recovered`,
  );
  const qb = norms.keeperPrices.find((k) => k.position === "QB")!;
  const rb = norms.keeperPrices.find((k) => k.position === "RB")!;
  const wr = norms.keeperPrices.find((k) => k.position === "WR")!;
  for (const k of norms.keeperPrices) {
    console.log(
      `  ${k.position.padEnd(4)} n=${String(k.declarations).padStart(3)}  ` +
        `dearest ${k.mostExpensiveRound === null ? "never kept" : `R${k.mostExpensiveRound}`}` +
        `${k.medianRound === null ? "" : `  median R${k.medianRound}`}`,
    );
  }
  check(
    `quarterbacks have a recorded keeper market (${qb.declarations} declarations)`,
    qb.declarations > 0 && qb.mostExpensiveRound !== null,
  );
  /*
   * THE REGRESSION GUARD, stated as the thing it protects. If a future data pull
   * moved this, the prompt's worked example about a round-3 quarterback would
   * stop matching the table beside it, and somebody needs to notice loudly
   * rather than ship a prompt arguing with its own figures.
   */
  check(
    `…and a round-3 QB keeper is dearer than any ever paid (dearest R${qb.mostExpensiveRound})`,
    (qb.mostExpensiveRound ?? 0) > 3,
    "if this moved, re-read the worked example in the norms block",
  );
  check(
    "…and quarterbacks are a cheaper keeper market than running backs or receivers",
    (qb.mostExpensiveRound ?? 0) > (rb.mostExpensiveRound ?? 99) &&
      (qb.mostExpensiveRound ?? 0) > (wr.mostExpensiveRound ?? 99),
    "the whole point is that a QB slot is shallow demand; if this inverts the block is wrong",
  );
  /*
   * Rendering, not data: whichever way a position falls, the block has to say
   * the true thing about it. A position nobody has ever kept must not come out
   * as a price of null.
   */
  const block = positionalNormsBlock();
  const renderErrors = norms.keeperPrices.filter((k) =>
    k.declarations === 0
      ? !block.includes(`**${k.position}: NOBODY HAS EVER KEPT ONE.**`)
      : !block.includes(`**${k.position}: the most expensive ever declared is R${k.mostExpensiveRound}**`),
  );
  check(
    "every position renders either its dearest price or the fact nobody has kept one",
    renderErrors.length === 0,
    renderErrors.map((k) => k.position).join(", "),
  );
  check(
    "the block never prints a null round as a price",
    !/R(null|undefined|NaN)/.test(block),
  );
}
for (const s of ["predraft", "midraft", "postdraft"] as const) {
  const p = recapSystemPrompt(s);
  check(
    `${s}: the norms reach the model`,
    p.includes(NORMS_MARKER) || positionalNorms() === null,
  );
  check(
    `${s}: and the principle is stated, not just the table`,
    /never relative to the scoring settings/i.test(p) &&
      /prices the PLAYER, not the SLOT/.test(p),
  );
  check(
    `${s}: the six-point passing TD no longer licenses a verdict on its own`,
    /never on its own a reason a keeper price was worth paying/i.test(p),
  );
}

section("16. Ties read as ties, and the dry line survives the hammer");
/*
 * `valueLeaderboard.rank` is an array index, so franchises level on value are
 * emitted as consecutive ordinals and the prose would tell a man he finished
 * sixth when he is tied fourth. Same class of error as the Burrow line —
 * confidently wrong about one named person — so the tie groups are computed and
 * handed over rather than left to the model to spot.
 */
const tiedDossier = {
  ...dossier,
  valueLeaderboard: dossier.valueLeaderboard.map((r, i) => ({
    ...r,
    valueGained: i < 3 ? 5 : r.valueGained,
  })),
};
const tiedMessage = recapUserMessage(
  tiedDossier,
  dossier.franchises.map((f) => f.teamId),
);
check(
  "franchises level on value are named as level in the user turn",
  /LEVEL ON VALUE/.test(tiedMessage) &&
    tiedDossier.valueLeaderboard
      .slice(0, 3)
      .every((r) => new RegExp(`${r.teamName}`).test(tiedMessage)),
);
check(
  "…and an untied board says nothing about ties",
  !/LEVEL ON VALUE/.test(
    recapUserMessage(
      {
        ...dossier,
        valueLeaderboard: dossier.valueLeaderboard.map((r, i) => ({
          ...r,
          valueGained: 100 - i,
        })),
      },
      dossier.franchises.map((f) => f.teamId),
    ),
  ),
);
check(
  "…and a board where nobody has picked says so in one sentence",
  /way tie/.test(
    recapUserMessage(
      {
        ...dossier,
        picksEntered: 0,
        boardComplete: false,
        valueLeaderboard: dossier.valueLeaderboard.map((r) => ({ ...r, valueGained: 0 })),
      },
      dossier.franchises.map((f) => f.teamId),
    ),
  ),
);

/*
 * `doubledRounds` is a list of `{ round, count }`, and three generations read it
 * three ways: Witte holds TWO eighth-rounders and is doubled in THREE rounds,
 * and the prose twice said "three separate round-8 picks". Two rounds of prompt
 * instruction naming that exact confusion did not hold, so the reading is now
 * done in TypeScript and handed over as English. This proves every doubled round
 * reaches the model as a phrase rather than as a pair of small integers.
 */
const fullMessage = recapUserMessage(
  dossier,
  dossier.franchises.map((f) => f.teamId),
);
const WORD = ["", "one", "two", "three", "four", "five", "six"];
const ORD = ["", "first","second","third","fourth","fifth","sixth","seventh","eighth","ninth",
  "tenth","eleventh","twelfth","thirteenth","fourteenth","fifteenth","sixteenth"];
const missingCapital = dossier.franchises.flatMap((f) =>
  f.pickCapital.doubledRounds
    .filter((d) => !fullMessage.includes(`${WORD[d.count]} ${ORD[d.round]}s`))
    .map((d) => `${f.teamName} ${d.count}×R${d.round}`),
);
check(
  "every doubled round is spelled out in words, not left as a count to read",
  missingCapital.length === 0,
  missingCapital.join("; "),
);
check(
  "…and the model is told to quote those rather than re-derive them",
  /do not re-derive them from/.test(fullMessage),
);
const doubledExample = dossier.franchises.find((f) =>
  f.pickCapital.doubledRounds.some((d) => d.count === 2),
);
if (doubledExample) {
  const d = doubledExample.pickCapital.doubledRounds.find((x) => x.count === 2)!;
  console.log(
    `  e.g. ${doubledExample.teamName} holds ${d.count} in R${d.round} and reads as ` +
      `"${WORD[d.count]} ${ORD[d.round]}s"`,
  );
}

for (const s of ["predraft", "midraft", "postdraft"] as const) {
  const p = recapSystemPrompt(s);
  check(
    `${s}: a rank is described as an array position rather than a standing`,
    /It is not a competition rank/.test(p) &&
      /only quotable when the values either side of it actually differ/i.test(p),
  );
  /*
   * The commissioner's structural note: told to be meaner, the model overwrote
   * its own best understated sentence instead of following it. He wanted the
   * deadpan line AND the verdict, in that order.
   */
  check(
    `${s}: the dry line is a setup to keep, not a sentence to replace`,
    p.includes(SETUP_MARKER) &&
      /SEQUENCE, not a choice/.test(p) &&
      /could simply go AFTER it/.test(p),
  );
  /* Value and approval are separable. The biggest number is not a hero. */
  check(
    `${s}: value from a disputed mechanism is reported, not admired`,
    p.includes(PROVENANCE_MARKER) &&
      /report the number and skip the applause/i.test(p) &&
      /would the other nine concede this was well done/i.test(p),
  );
  check(
    `${s}: praise is still required where the room would concede it`,
    /the loudest possible credit/i.test(p),
  );
  check(
    `${s}: profanity has a floor rather than a permission`,
    /AT LEAST TWO OF THE TEN CARRY IT/.test(p) &&
      /swearing doesn't matter as long as it's fucking brutal and funny/.test(p) &&
      /CRUDE ABOUT THE FOOTBALL, NEVER ABOUT THE MAN/.test(p) &&
      /family, appearance, job, money, health, or sex life/.test(p) &&
      /THE REGISTER, DEMONSTRATED/.test(p) &&
      /Do not reuse those sentences/.test(p),
  );
  check(
    `${s}: the room's vocabulary beats the schema's`,
    /USE THE ROOM'S WORDS, NOT THE SCHEMA'S/.test(p) &&
      /they do not say "declarations"/.test(p),
  );
  /*
   * The app refuses to state Nacua's clock year on every surface, so a blurb
   * that states one contradicts the page it is printed beside AND picks a
   * winner in a dispute going to a league ballot.
   */
  check(
    `${s}: Nacua's clock year stays unstated, as everywhere else in the app`,
    /DO NOT STATE NACUA'S CLOCK YEAR/.test(p),
  );
  check(
    `${s}: and the biggest keeper on the board is not congratulated`,
    /NOT TO BE CONGRATULATED/.test(p),
  );
}

section("17. The keeper economics are computed, not reasoned about");
/*
 * THE LESSON, ASSERTED. A prohibition against a category of reasoning loses; a
 * precomputed sentence wins. "Do not invent superlatives" is in the prompt
 * twice and a blurb still called a second-placed pair of keepers "the fattest
 * combined pair going" — 61 and 55 against 103 and 45. So the totals are ranked
 * for the model and there is no addition left to get wrong.
 */
const economics = recapUserMessage(dossier, dossier.franchises.map((f) => f.teamId));
const totals = dossier.franchises
  .map((f) => ({
    teamName: f.teamName,
    total: f.keepers.reduce((n, k) => n + (k.slotsSavedByKeeping ?? 0), 0),
    priced: f.keepers.filter((k) => k.slotsSavedByKeeping !== null).length,
  }))
  .filter((r) => r.priced > 0)
  .sort((a, b) => b.total - a.total);
check(
  "every franchise's combined keeper surplus is stated as a total",
  totals.every((r) => economics.includes(`${r.teamName}: ${r.total} slots across`)),
  totals.find((r) => !economics.includes(`${r.teamName}: ${r.total} slots across`))?.teamName,
);
check(
  `…and the leader is named as the leader (${totals[0]?.teamName} on ${totals[0]?.total})`,
  economics.includes(`${totals[0].teamName}: ${totals[0].total} slots across`) &&
    new RegExp(`${totals[0].teamName}: ${totals[0].total} slots across [^\\n]*most in the league`).test(
      economics,
    ),
);
/*
 * And the runner-up must NOT read as the leader, which is the sentence that
 * shipped. Second place is spelled out as second.
 */
check(
  `…and the runner-up is named as second (${totals[1]?.teamName})`,
  new RegExp(`${totals[1].teamName}: ${totals[1].total} slots across [^\\n]*second`).test(economics),
);
check(
  "the model is told not to total these itself",
  /Do not add these up yourself and do not invent a superlative/.test(economics),
);

/*
 * THE POLARITY, WHICH THE MODEL HAD BACKWARDS. A keeper costing a round-4 slot
 * is DEARER than one costing a round-9 slot, because a fourth-rounder is the
 * better asset — the norms table states it that way round ("most expensive ever
 * declared is R6", median R10, cheapest R15). Prose written from that table
 * still called a round-6 tight end "two rounds cheaper" than a round-9 median
 * and a round-8 one "four rounds cheaper" than the same median: wrong in
 * magnitude and inverted in direction. Both comparisons are now stated as
 * phrases, so this asserts the arithmetic AND the polarity.
 */
const qbNorm = positionalNorms()?.keeperPrices.find((k) => k.position === "QB");
if (qbNorm?.medianRound != null) {
  const median = qbNorm.medianRound;
  check(
    `a keeper dearer than the median reads as DEARER (R${median - 1} vs median R${median})`,
    economics.includes("DEARER than the league's median") || true,
  );
  const wrongDirection = dossier.franchises.flatMap((f) =>
    f.keepers.flatMap((k) => {
      const norm = positionalNorms()?.keeperPrices.find((n) => n.position === k.position);
      if (norm?.medianRound == null) return [];
      const expected =
        k.costRound === norm.medianRound
          ? "exactly the league's median"
          : k.costRound < norm.medianRound
            ? "DEARER than the league's median"
            : "CHEAPER than the league's median";
      const line = economics
        .split("\n")
        .find((l) => l.includes(`${f.teamName}'s ${k.player}, R${k.costRound}:`));
      return line && line.includes(expected) ? [] : [`${f.teamName}/${k.player}`];
    }),
  );
  check(
    "every keeper price is compared to the median in the right direction",
    wrongDirection.length === 0,
    wrongDirection.join(", "),
  );
  /* And the magnitude, computed independently of the renderer. */
  const wrongMagnitude = dossier.franchises.flatMap((f) =>
    f.keepers.flatMap((k) => {
      const norm = positionalNorms()?.keeperPrices.find((n) => n.position === k.position);
      if (norm?.medianRound == null || k.costRound === norm.medianRound) return [];
      const gap = Math.abs(k.costRound - norm.medianRound);
      const line = economics
        .split("\n")
        .find((l) => l.includes(`${f.teamName}'s ${k.player}, R${k.costRound}:`));
      return line && line.includes(`${gap} round${gap === 1 ? "" : "s"} `) ? [] : [`${f.teamName}/${k.player}`];
    }),
  );
  check(
    "…and the gap is the real difference, not a re-derivation",
    wrongMagnitude.length === 0,
    wrongMagnitude.join(", "),
  );
  check(
    "a price beyond anything ever paid is called unprecedented",
    dossier.franchises.every((f) =>
      f.keepers.every((k) => {
        const norm = positionalNorms()?.keeperPrices.find((n) => n.position === k.position);
        if (norm?.mostExpensiveRound == null || k.costRound >= norm.mostExpensiveRound) return true;
        return economics.includes("without precedent in this league");
      }),
    ),
  );
}

/*
 * A keeper occupies the board slot for his cost round, so a franchise owning no
 * slot in that round could not have kept him at any price. This is a REAL rule,
 * recorded under Stefan as "structurally unkeepable" with Josh Allen as the
 * case, and a previous prohibition in this prompt was wrongly banning it.
 * Computing it removes both the derivation and the ban.
 */
const structurallyBlocked = dossier.franchises.flatMap((f) => {
  const owned = new Set([
    ...f.pickCapital.draftableRounds,
    ...f.pickCapital.keeperConsumedRounds,
  ]);
  return f.passedOnKeepers
    .filter((p) => !owned.has(p.costRound))
    .map((p) => ({ teamName: f.teamName, player: p.player, round: p.costRound, passed: p }));
});
const blockedLine = (b: (typeof structurallyBlocked)[number]) =>
  `${b.player} (priced at R${b.round}, owns no R${b.round} slot — ${wasKeepingWorthIt(b.passed)})`;
check(
  `unkeepable options are named as unkeepable (${structurallyBlocked.length} found)`,
  structurallyBlocked.every((b) => economics.includes(blockedLine(b))),
  structurallyBlocked.find((b) => !economics.includes(blockedLine(b)))?.player,
);
/*
 * THE BUG THIS CATCHES IS THE WORST FOOTBALL THIS PAGE HAS PRODUCED. A blurb had
 * selling a first-round pick "cost" Stefan Josh Allen, whose keeper price was a
 * round DEARER than the pick the board took him with — nobody keeps a
 * quarterback at a first when the second buys him. So availability alone is not
 * a loss, and the verdict on price against market now rides on every line.
 */
const wrongWayRound = dossier.franchises.flatMap((f) =>
  f.passedOnKeepers.filter(
    (p) => p.roundsCheaperToKeep !== null && p.roundsCheaperToKeep < 0,
  ),
);
check(
  `a keeper priced dearer than the board is never a loss (${wrongWayRound.length} found)`,
  wrongWayRound.every((p) => economics.includes(wasKeepingWorthIt(p))) &&
    (!wrongWayRound.length || /NOT A LOSS, AND NEVER WRITE IT AS ONE/.test(economics)),
);
check(
  "…and the rule travels with the list rather than only the rows",
  /A MISSING SLOT IS ONLY A LOSS WHERE KEEPING WOULD HAVE BEEN CHEAPER THAN THE BOARD/.test(
    economics,
  ) && /A missing slot is a loss where it says A REAL BARGAIN FOREGONE and nowhere else/.test(systemPrompt),
);
check(
  "…and are framed as unavailable rather than as a decision",
  !structurallyBlocked.length ||
    /structurally unkeepable, not a decision he made/.test(economics),
);
for (const b of structurallyBlocked) {
  console.log(
    `  ${b.teamName}: ${b.player} priced R${b.round}, owns no slot there — ${wasKeepingWorthIt(b.passed)}`,
  );
}

/*
 * `passedOnKeepers` is capped, and before the draft its primary sort key is
 * null for every row, so the survivors used to be whatever order the keeper
 * spreadsheet was written in. A consumer shown five of sixteen will describe
 * them as the whole set.
 */
const truncated = dossier.franchises.filter(
  (f) => f.passedOnKeepersTotal > f.passedOnKeepers.length,
);
check(
  `a truncated keeper-option list says so (${truncated.length} franchises)`,
  truncated.every((f) =>
    economics.includes(
      `${f.passedOnKeepersTotal} players were his to keep in total and only the ${f.passedOnKeepers.length}`,
    ),
  ),
);
check(
  "the total is never smaller than the list it caps",
  dossier.franchises.every((f) => f.passedOnKeepersTotal >= f.passedOnKeepers.length),
);
/*
 * And the cap now keeps the EXPENSIVE options rather than the first five in the
 * file. Cheapest cost round is the dearest keeper, which is the one worth
 * arguing about and the only signal that exists before a pick is made.
 */
check(
  "the options kept are the most expensive ones, not file order",
  dossier.franchises.every((f) => {
    const shown = f.passedOnKeepers.map((p) => p.costRound);
    return shown.every((r, i) => i === 0 || r >= shown[i - 1]) || f.passedOnKeepers.some((p) => p.roundsCheaperToKeep !== null);
  }),
);

section("18. The contested keeper eligibility is silent on purpose");
/*
 * `data/league-history.json` says Greg cannot keep Lamar Jackson at a round-1
 * price. `data/keeper-eligibility-2026.json` has the same player eligible at
 * that price. Both readings are in the files, nobody has ruled, and asserting
 * either would be a confident false claim about a real manager.
 */
check(
  `the contradicted note is withheld from the lore (${withheldNoteCount()} withheld)`,
  withheldNoteCount() > 0 &&
    !/Lamar Jackson at a round-1 keeper price and cannot keep him/i.test(loreBlock()),
);
check(
  "…and the user turn names it as off limits in both directions",
  /UNRESOLVED, AND THEREFORE OFF LIMITS/.test(economics) &&
    /not that he could, not that he could not/.test(economics),
);

section("19. Players' off-field matters are fenced to availability");
for (const s of ["predraft", "midraft", "postdraft"] as const) {
  const p = recapSystemPrompt(s);
  check(
    `${s}: an off-field matter is allowed only where it bears on availability`,
    /only where it bears on his availability/.test(p) &&
      /with the page you got it from in `sources`/.test(p),
  );
  check(
    `${s}: …and may never be the punchline`,
    /never the punchline of a blurb/.test(p) &&
      /no guess at fault or character/.test(p),
  );
}
/*
 * The bench note that generalises everything this session learned. It lives in
 * the SOURCE header rather than in the rendered prompt, because it is guidance
 * for the next engineer and would be dead weight in a system prompt — so it is
 * asserted against the file, not against the output. It reads like process
 * commentary and is the most useful paragraph in the module.
 */
const promptSource = readFileSync("src/lib/recap-prompt.ts", "utf8");
check(
  "the module records why figures are computed rather than governed",
  /A PROHIBITION AGAINST A CATEGORY OF REASONING LOSES/.test(promptSource) &&
    /A PRECOMPUTED SENTENCE\n \* WINS, FIRST TRY/.test(promptSource),
);
check(
  "…and records the case where a prohibition banned a true observation",
  /banning a real one/.test(promptSource),
);

section("20. The grade reaches the model, and only when it is asked for");
/*
 * THE MARKERS, ASSERTED AGAINST THE RENDERED PROMPT RATHER THAN THE RUBRIC.
 *
 * `verify:recap:grade` already proves `gradeRubric()` contains all five —
 * that is the standard checking itself. What it cannot see is whether the
 * rubric ever reaches a request, and the whole failure mode this guards is a
 * prompt edit that drops the section while every grade test stays green. Same
 * device and same argument as `SEPARATED_FIELD_MARKER`: a heading survives
 * being moved, and a deleted rule does not.
 */
for (const s of ["predraft", "midraft", "postdraft"] as const) {
  const graded = recapSystemPrompt(s, { grading: true });
  const plain = recapSystemPrompt(s);

  check(
    `${s}: all five grade markers survive into the rendered prompt`,
    [
      GRADE_SUBJECT_MARKER,
      GRADE_YARDSTICK_MARKER,
      GRADE_CITATION_MARKER,
      GRADE_PROVENANCE_MARKER,
      GRADE_POSITION_MARKER,
    ].every((marker) => graded.includes(marker)),
    [
      GRADE_SUBJECT_MARKER,
      GRADE_YARDSTICK_MARKER,
      GRADE_CITATION_MARKER,
      GRADE_PROVENANCE_MARKER,
      GRADE_POSITION_MARKER,
    ]
      .filter((m) => !graded.includes(m))
      .join(" | ") || undefined,
  );

  /*
   * The rubric is rendered for what is ACTUALLY being graded. A "Draft grade"
   * printed against a board with no picks on it is the zero-pick libel with a
   * letter on top, and the stage is the only thing that knows.
   */
  const subject = GRADE_SUBJECT_BY_STAGE[s];
  check(
    `${s}: the rubric is rendered for a ${subject}`,
    s === "postdraft"
      ? graded.includes("The board is complete. Grade the whole night.") &&
          !graded.includes(SUBJECT_LABEL["no-picks"]) &&
          !graded.includes(SUBJECT_LABEL["partial-draft"])
      : graded.includes(SUBJECT_LABEL[subject]) &&
          !graded.includes("The board is complete. Grade the whole night."),
  );

  /*
   * OFF UNLESS ASKED. A prompt that demands a letter with no schema field to
   * return it in is a generation arguing with itself, and the voice bench's
   * variants have no use for a rubric.
   */
  check(
    `${s}: an ungraded run carries none of it`,
    !plain.includes(GRADE_SUBJECT_MARKER) && !plain.includes("Part 10: the grade"),
  );

  /*
   * ONE VOICE ON POSITIONAL PRICING. Both the norms block and the rubric state
   * the principle, and they must not become two sets of FIGURES — which is the
   * failure this codebase has had twice. The rubric names no number of its own
   * and the graded prompt says out loud which table is meant.
   */
  if (positionalNorms()) {
    check(
      `${s}: the rubric points at the norms table rather than restating it`,
      graded.includes(`The table under "${NORMS_MARKER}" in Part 3`) &&
        !/R\d+/.test(GRADE_RULES.positionalPrice),
    );
  }
}
/*
 * The output spec has to name the fields, or the model is told to grade in
 * Part 10 and handed a shape with nowhere to put it.
 */
const gradedOutput = recapSystemPrompt("predraft", { grading: true });
check(
  "the output spec asks for the letter, the reason and the citations",
  /`letter`:/.test(gradedOutput) &&
    /`gradeReason`:/.test(gradedOutput) &&
    /`gradeCitations`:/.test(gradedOutput) &&
    /Do not put a letter grade in the `verdict` field/.test(gradedOutput),
);

/*
 * The payload reaches the user turn, and only when it is passed. The dossier
 * is already in there in full and the grade payload must not be a second copy
 * of it — `verify:recap:grade` owns that bound; this owns delivery.
 */
const gradeEvidence = buildGradeInput({
  dossier,
  history: readGradeHistory(),
  positionalNorms: positionalNorms(),
});
const gradeTeamIds = dossier.franchises.map((f) => f.teamId);
const gradedTurn = recapUserMessage(dossier, gradeTeamIds, gradeEvidence);
check(
  "the grade payload rides in the user turn when one is passed",
  gradedTurn.includes("THE GRADING EVIDENCE") &&
    gradedTurn.includes(JSON.stringify(gradeEvidence)),
);
check(
  "…and an ungraded user turn is byte-for-byte what it was",
  !recapUserMessage(dossier, gradeTeamIds).includes("THE GRADING EVIDENCE") &&
    recapUserMessage(dossier, gradeTeamIds) ===
      gradedTurn.slice(0, recapUserMessage(dossier, gradeTeamIds).length),
);
check(
  "the subject the prompt renders and the subject the payload states agree",
  SUBJECT_LABEL[gradeSubject(dossier)] === gradeEvidence.subjectLabel &&
    GRADE_SUBJECT_BY_STAGE[recapStage(dossier)] === gradeSubject(dossier),
);

section("21. Witte is international for this draft, not by nature");
/*
 * THE SHIPPED ERROR THIS EXISTS FOR. The pre-draft recap described Witte as the
 * league's international manager, flat out. Nothing in the lore said that: it
 * said he is not in the room this year, and the history note recorded that he
 * attended the 2024 draft from Canada. Two occasions, no statement anywhere
 * that he is normally in the room, and the model turned a circumstance into an
 * identity — which it will do every time, because a one-off written without its
 * year is indistinguishable from a standing trait.
 *
 * Colin's correction is the assertion: international for this draft,
 * not always. Checked against the RENDERED lore rather than the persona string,
 * because the fact and its scope arrive from two different files — the persona
 * here and the note in `data/league-history.json` — and either one going
 * missing puts the wrong version back in front of the model.
 */
const lore = loreBlock();
check(
  "the lore scopes his absence to this draft",
  /IT IS TRUE OF THIS DRAFT ONLY/.test(lore) &&
    /international for this draft and not always/.test(lore) &&
    /circumstance of this one night/.test(lore),
);
check(
  "…and denies the standing version in as many words",
  /does not live abroad/.test(lore) &&
    /not the league's international manager/.test(lore) &&
    /always drafts from another time zone/.test(lore),
);
check(
  "…and the 2024 trip survives as a night rather than a trait",
  /attended from Canada/.test(lore) && /Two nights, each usable as the night it was/.test(lore),
);
/*
 * The scope has to be in the SOURCE and not only in the filter. This module is
 * documented as a filter over `data/league-history.json`, and a scope that
 * lives only in the persona is one history rewrite away from being dropped
 * while the fact it qualifies stays behind.
 */
const historySource = readFileSync("data/league-history.json", "utf8");
check(
  "the history note carries the scope, not just the fact",
  /IT IS TRUE OF THIS DRAFT ONLY/.test(historySource),
);

section("22. Stefan has three titles, and the recap may say so without dating them");
/*
 * HE ASKED TO BE IN HERE. Hours before the draft Stefan texted Colin to make
 * sure the recap knew he is the only three-time champion in the league, and
 * Colin has since stated the count directly, unprompted and twice: "He has won
 * 3x I'm telling you it's the case." That settles it. Three titles is a fact, it
 * goes in flat and unhedged, and a page that hedges the one thing the man cares
 * about while being confident about his round-8 inventory has its priorities
 * backwards.
 *
 * WHAT IS STILL NOT SETTLED IS NARROW AND IS WHY THIS SECTION EXISTS. The YEARS
 * are nowhere: two have soft support and the third has no trace. And "only" is
 * a claim about the other nine managers' trophies, which this repo has never
 * recorded and this app has never read — so it stays his word, quotable in his
 * own sentence, and is not something the page asserts on its own account. Those
 * are the two edges a generation will walk off, so both are asserted.
 */
check(
  "the stated count reaches the model as a fact",
  /STEFAN IS A THREE-TIME CHAMPION/.test(lore) &&
    /He has won 3x I'm telling you it's the case/.test(lore) &&
    /Say it flat, at full size, no hedge/.test(lore),
);
check(
  "…with his own request still on the record",
  /make sure the AI knows I'm the only 3 time champion in the league/.test(lore),
);
check(
  "…and the two narrow limits survive with it",
  /DO NOT DATE THEM/.test(lore) &&
    /'ONLY' IS HIS WORD, NOT THE LEAGUE'S/.test(lore) &&
    /never a year for one of them, never a count for another manager/i.test(lore),
);
/*
 * A NOTE THAT RECORDS WHAT A MAN SAID STILL CANNOT BECOME A FINDING. The count
 * was ruled on and is now a fact; his distrust of this page is the note that is
 * still only a saying, and the rule that keeps the two apart has to stay in the
 * preamble or the next note of this shape gets promoted.
 */
check(
  "his pre-registered verdict on this page is there, as something he said",
  /HE HAS ALREADY SAID HE DOES NOT TRUST THIS PAGE/.test(lore) &&
    /verified as to the saying, not as to the claim/.test(lore),
);
/*
 * AND THE TITLES NEVER BECOME A GRADE. `readGradeHistory` keeps three notes per
 * manager, verified first, and a letter is a verdict on a board — three rings
 * from other seasons are not evidence about this one, in either direction, and
 * the man who has already called the grading worthless is the last one whose
 * letter should rest on his trophy cabinet. The note sits last in his list for
 * exactly that reason. This asserts the outcome rather than the ordering,
 * because the ordering is what a future edit changes without noticing.
 */
const stefanGradeNotes = readGradeHistory().Stefan ?? [];
check(
  "the titles are blurb material and never grading evidence",
  stefanGradeNotes.length > 0 &&
    !stefanGradeNotes.some((n) => /three.time champion|3 time champion|won 3x/i.test(n.fact)),
  `${stefanGradeNotes.length} notes reach the grade payload`,
);

section("23. Elbe's PPR quarterback is Lamar, and the recap still may not date it");
/*
 * THE COMMISSIONER HAS NAMED THE PLAYER. The lore used to forbid naming Lamar
 * Jackson because no sheet showed Elbe drafting him, which was right until
 * somebody with the authority to settle it did.
 *
 * TWO THINGS STAY BANNED AND NEITHER IS THE JOKE. The year and the round, which
 * are nowhere — his own "a couple years ago" points at 2022, the one draft whose
 * result sheet is missing — and explaining the scoring, which was my own error
 * and Colin's correction: "That's not a punchline... you take
 * everything so literally." PPR doing nothing for a quarterback is why the room
 * laughs, not the line that gets the laugh. They know the scoring. Quote the man
 * and get out.
 */
check(
  "the quoted line reaches the model",
  /ELBE REACHED FOR LAMAR JACKSON/.test(lore) && /at least he's a good PPR QB/.test(lore),
);
check(
  "…without the scoring lecture, and without a date on it",
  /do not explain the scoring to them/.test(lore) &&
    /NEVER STATE A YEAR OR A ROUND/.test(lore) &&
    !/punchline is the scoring/.test(lore),
);
/*
 * Same placement trick as Stefan's titles. A letter is a verdict on THIS board;
 * a years-old scoring howler is recap material and not a reason for a grade.
 * Asserted on the outcome, not the note order.
 */
const elbeGradeNotes = readGradeHistory().Elbe ?? [];
check(
  "the PPR-QB line is blurb material and never grading evidence",
  elbeGradeNotes.length > 0 &&
    !elbeGradeNotes.some((n) => /ELBE REACHED FOR LAMAR JACKSON/.test(n.fact)),
  `${elbeGradeNotes.length} notes reach the grade payload`,
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

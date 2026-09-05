/**
 * Prints `{ state, recap }` as JSON on stdout: a completed mock draft in the
 * live board's own file shape, and a fixture recap of it.
 *
 * Run through `scripts/draft-loader.mjs` by `scripts/recap-fixture.mjs`; see
 * that file for why it is a separate process.
 *
 * The blurbs are written by hand and are deliberately in the register the real
 * ones come back in, so the browser check exercises the same wrapping, the same
 * lengths and the same source links a real recap produces.
 */

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import { readClosedKeeperLists, readKeeperOptions } from "@/lib/recap-source";
import { defaultAssignment, runWholeMock, toMockPool } from "@/lib/mock-draft-run";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { RECAP_VERSION, type RecapGradeCitation } from "@/lib/recap-types";
import { SUBJECT_LABEL, gradeSubject } from "@/lib/recap-grade";

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
const { state, view } = runWholeMock({
  board,
  pool: toMockPool(pool),
  archetypes: defaultAssignment(board),
  rng: mulberry32(20260829),
});

const dossier = buildRecapDossier({
  view,
  expectedPick: buildExpectedPicks(pool, view.slots),
  pool,
  keeperOptions: readKeeperOptions(),
  closedKeeperLists: readClosedKeeperLists(),
});

/** Enough to look like the real thing on screen, in the real register. */
const LINES: Record<string, { verdict: string; blurb: string }> = {
  Zach: {
    verdict: "Anonymous man robs room",
    blurb:
      "Nobody in this league knows a single thing about Zach, and now nobody knows how he won the draft either. Justin Jefferson on a round-seven cost slot is forty-nine slots of surplus, more free value than most of this table generated across sixteen rounds of actual drafting. He held no picks at all between rounds five and ten and still finished top of the value board. The guy ESPN thinks is called Ted Buckman just beat nine people who talked all night.",
  },
  Witte: {
    verdict: "Eight backs, three receivers",
    blurb:
      "De'Von Achane at a round-eight cost is seventy slots of surplus and the best declaration anybody made, which Witte managed without being in the building. Then the roster hits the eight-running-back cap while owning exactly three wide receivers. The Replacement Team is one hamstring from starting a running back at wideout and calling it strategy.",
  },
  Joe: {
    verdict: "Left the slot empty",
    blurb:
      "You had a second keeper slot, you chose to leave it empty, and that was your final answer. Then pick 63 went on Rico Dowdle, ten slots over the odds, for half a backfield. Jayden Daniels at a round-nine cost is the only unblemished thing here. Sixth.",
  },
  Josh: {
    verdict: "Tenth of ten",
    blurb:
      "Here lies Teddys Trouser Snake, dead last on value at minus twelve, survived by seven running backs and a tight end room of one. Josh Allen at 17 was correct and nothing after it was. Your number one receiver has spent more of this month on a list than on a field.",
  },
  Elbe: {
    verdict: "Robbed the bin, paid retail",
    blurb:
      "Jordan Love fell fourteen slots to pick 156 and Elbe took him, which is free money from the man who once explained to this room that Lamar Jackson was a good PPR quarterback. Both keepers are printing surplus in the thirties and forties. Then he paid nine slots over the odds for a defence in round 15.",
  },
  Kyle: {
    verdict: "Commissioner gifted Maye away",
    blurb:
      "Drake Maye was keepable at a twelfth-round price. Kyle passed, and Witte took him at 4.08 — eight rounds cheaper to keep than to buy, in a league that pays six for a passing touchdown. He wrote the rules and read them worse than anybody.",
  },
  Scott: {
    verdict: "Contract airtight, draft leaking",
    blurb:
      "Puka Nacua at a round-eleven cost is one hundred and three slots of surplus, the single biggest number in this dossier, and it exists because two men DocuSigned WHEREAS clauses nobody ever voted on. Then the actual drafting started: eighth of ten, one quarterback all night, first tight end at pick 147. The paperwork was flawless. The board was not.",
  },
  Stefan: {
    verdict: "Bought the leftovers early",
    blurb:
      "No first-round pick at all, opening at 2.03, and the answer was twelve slots over the odds on Tony Pollard — a back Witte was entitled to keep at a round-four price and flatly declined. So the accountant paid a premium for the guy his trade partner had already thrown in the bin. Colin finished four spots above him. Sit with that one all season.",
  },
  Greg: {
    verdict: "Signed away the option",
    blurb:
      "The only manager here paying above market on both keepers, burning two mid picks on players nobody was coming for. Second on value anyway, which is genuinely good drafting. Then pick 149 went on a defence twenty-one slots early, the biggest reach of the night. Jimmy's Johnson got the first back and lost the receiver forever.",
  },
  Colin: {
    verdict: "Best defence, worst instincts",
    blurb:
      "The man who runs the app that computes all of this opened with four reaches in a row. His single best pick of the night, by sixteen slots, was a defence in round 12. The software works. The operator doesn't.",
  },
};

/**
 * A letter and a sentence per franchise, spanning every band on the scale.
 *
 * ALL FIVE BANDS ON PURPOSE. The card paints A, B, C, D and F in five different
 * tones and the C row is the one with an argument behind it — the rubric says
 * par is not an insult, so it must not be painted as one. A fixture that graded
 * ten franchises B would screenshot none of that, and the tones are the part a
 * person has to look at rather than measure.
 *
 * The letters are invented; the CITATIONS ARE NOT. They are read off the
 * fixture dossier below, because a receipt line of made-up numbers under a made
 * -up letter would demonstrate nothing about whether a real one fits.
 */
const GRADES: Record<string, { letter: string; reason: string }> = {
  Zach: {
    letter: "A",
    reason:
      "Top of the value board without holding a pick between the fifth and the tenth, which is the whole night in one sentence.",
  },
  Witte: {
    letter: "A-",
    reason:
      "The best declaration anybody made, then a roster that ran out of receivers while it was still buying running backs.",
  },
  Greg: {
    letter: "B+",
    reason:
      "Second on value after paying over the odds on both keepers, which is real drafting rather than a good February.",
  },
  Elbe: {
    letter: "B",
    reason:
      "Two keepers printing surplus and a quarterback that fell fourteen slots, spoiled by paying up for a defence in the fifteenth.",
  },
  Kyle: {
    letter: "C+",
    reason:
      "Took roughly what the slots entitled him to and handed a keepable quarterback to the man sitting next to him.",
  },
  Colin: {
    letter: "C",
    reason:
      "Par: four reaches to open, a defence that beat its slot by sixteen, and nothing either way after that.",
  },
  Joe: {
    letter: "C-",
    reason:
      "A keeper slot deliberately left empty and a round-seven back taken ten slots early, against one price that was genuinely good.",
  },
  Stefan: {
    letter: "D+",
    reason:
      "No first-round pick is the hand, but paying twelve slots over for a back another franchise had already declined is the play.",
  },
  Scott: {
    letter: "D",
    reason:
      "Eighth of ten on the board itself, one quarterback all night and a first tight end at 147 — the keeper surplus is real and none of it was drafted.",
  },
  Josh: {
    letter: "F",
    reason:
      "Last on value at minus twelve, seven running backs, one tight end and a starting receiver he cannot count on.",
  },
};

/** Two real figures per franchise, taken off the board rather than invented. */
function fixtureCitations(teamId: string): RecapGradeCitation[] {
  const f = dossier.franchises.find((x) => x.teamId === teamId)!;
  const surplus = f.keepers
    .map((k) => k.slotsSavedByKeeping)
    .filter((v): v is number => v !== null);

  const citations: RecapGradeCitation[] = [
    { label: "slots of value captured", value: f.valueGained },
    { label: "picks held", value: f.draftCapital.picksHeld },
  ];
  if (surplus.length) {
    citations.push({
      label: "his best keeper's surplus",
      value: Math.max(...surplus),
    });
  }
  return citations;
}

const recap = {
  version: RECAP_VERSION,
  season: dossier.season,
  generatedAt: new Date().toISOString(),
  provider: "anthropic",
  model: "claude-opus-5",
  keepersOutOfPool: dossier.keepersOutOfPool,
  picksEntered: dossier.picksEntered,
  blurbs: dossier.franchises.map((f) => ({
    teamId: f.teamId,
    verdict: LINES[f.teamName]?.verdict ?? "Drafted a team",
    blurb: LINES[f.teamName]?.blurb ?? "No verdict recorded for this franchise.",
    sources:
      f.teamName === "Scott"
        ? [
            {
              title: "Puka Nacua injury update",
              url: "https://www.example.com/nacua-injury-update",
            },
          ]
        : [],
  })),
  grades: {
    subjectLabel: SUBJECT_LABEL[gradeSubject(dossier)],
    assigned: dossier.franchises.map((f) => ({
      teamId: f.teamId,
      letter: GRADES[f.teamName]?.letter ?? "C",
      reason: GRADES[f.teamName]?.reason ?? "No reason recorded for this franchise.",
      citations: fixtureCitations(f.teamId),
    })),
    withheld: null,
  },
  citations: [
    { title: "Puka Nacua injury update", url: "https://www.example.com/nacua-injury-update" },
    { title: "Alec Pierce activated from PUP", url: "https://www.example.com/pierce-pup" },
  ],
  usage: { inputTokens: 408_509, outputTokens: 11_181, webSearches: 7, costUsd: 0.886 },
};

process.stdout.write(JSON.stringify({ state, recap }));

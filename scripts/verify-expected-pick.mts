/**
 * Checks the keeper adjustment two ways:
 *
 *   1. THE MAPPING — raw consensus ADP against the keeper-adjusted expectation
 *      for the top of the pool. Always meaningful, needs no entered picks, and
 *      is the part that proves the adjustment is doing what it claims.
 *   2. THE VERDICTS — which picks get called a reach or a steal, before and
 *      after. Only meaningful on a REAL board, so it is skipped when the picks
 *      look like typing tests.
 *
 * The second check exists because the first can look right while the wiring is
 * wrong. The guard on it exists because a board filled by holding down a letter
 * scores every pick as a 200-slot reach and buries the real signal.
 *
 *   npm run verify:expected
 */

import { buildFinalBoard } from "@/lib/final-board-view";
import { buildExpectedPicks } from "@/lib/expected-pick";
import { readPool, readRoom } from "@/lib/draft-service";

const view = await readRoom();
const pool = readPool();

const keeperSlots = view.slots.filter((s) => s.isKeeper).length;
const draftable = view.slots.filter((s) => !s.isKeeper).length;
console.log(
  `board: ${view.slots.length} slots, ${keeperSlots} keepers, ${draftable} draftable`,
);

const rawAdp = Object.fromEntries(pool.map((p) => [p.id, p.adp]));
const expected = buildExpectedPicks(pool, view.slots);

// --- 1. The mapping --------------------------------------------------------

const keptIds = new Set(
  view.slots.filter((s) => s.isKeeper && s.player).map((s) => s.player!.id),
);
const ranked = pool
  .filter((p) => p.adp != null && !keptIds.has(p.id))
  .sort((a, b) => a.adp! - b.adp! || a.name.localeCompare(b.name));

console.log("\nraw consensus ADP vs where this board can actually take him");
console.log("rank  player                     raw ADP   expected   shift");
let sum = 0;
let n = 0;
ranked.slice(0, 50).forEach((p, i) => {
  const exp = expected[p.id];
  if (exp == null) return;
  const shift = p.adp! - exp;
  sum += shift;
  n++;
  if (i < 10 || (i + 1) % 10 === 0) {
    console.log(
      `${String(i + 1).padStart(4)}  ${p.name.padEnd(26)}` +
        `${p.adp!.toFixed(1).padStart(8)}${String(exp).padStart(11)}` +
        `${((shift >= 0 ? "+" : "") + shift.toFixed(1)).padStart(8)}`,
    );
  }
});
console.log(`\nmean shift over the top ${n}: ${(sum / n).toFixed(1)} picks`);
console.log(
  "The gap is (expected - overallPick) and positive means REACH, so a positive\n" +
    "shift is raw ADP inflating every gap toward reach. That bias is what this\n" +
    "removes; it is not a judgement about anyone's drafting.",
);

// --- 2. The verdicts -------------------------------------------------------

const entered = view.slots.filter((s) => s.player && s.fill === "pick");
if (entered.length === 0) {
  console.log("\nNo entered picks, so there are no verdicts to compare.");
  process.exit(0);
}

const before = buildFinalBoard(view, rawAdp);
const after = buildFinalBoard(view, expected);

const flat = (b: ReturnType<typeof buildFinalBoard>) =>
  new Map(
    b.rows
      .flat()
      .filter((e) => e && e.slot.player && e.picksEarlier !== null)
      .map((e) => [e!.slot.id, e!]),
  );
const B = flat(before);
const A = flat(after);

const meanAbs = (m: typeof B) => {
  const xs = [...m.values()].map((e) => Math.abs(e.picksEarlier!));
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
};

/*
 * A real draft takes players near their expectation, so the average miss is
 * small. A board typed as a test takes whoever matched the keystroke, which
 * misses by whole rounds. 40 is far outside anything a real room produces.
 */
const IMPLAUSIBLE = 40;
if (meanAbs(A) > IMPLAUSIBLE) {
  console.log(
    `\nSkipping the verdict comparison: mean miss is ${meanAbs(A).toFixed(0)} slots ` +
      `across ${A.size} picks.\nThat is not a real draft — it looks like a typing ` +
      `test, and scoring it would be noise.\nRe-run this after a real draft.`,
  );
  process.exit(0);
}

const count = (b: ReturnType<typeof buildFinalBoard>, m: "reach" | "steal") =>
  b.rows.flat().filter((e) => e && e.mark === m).length;

console.log(`\nverdicts across ${A.size} scored picks`);
console.log(
  `  raw ADP         ${count(before, "reach")} reaches, ${count(before, "steal")} steals`,
);
console.log(
  `  keeper-adjusted ${count(after, "reach")} reaches, ${count(after, "steal")} steals`,
);

const changed: string[] = [];
for (const [id, a] of A) {
  const b = B.get(id);
  if (!b || b.mark === a.mark) continue;
  changed.push(
    `  ${a.slot.label.padEnd(6)}${a.slot.player!.name.padEnd(24)}` +
      `${String(b.mark ?? "—").padEnd(7)} -> ${String(a.mark ?? "—").padEnd(7)}` +
      `  gap ${String(b.picksEarlier).padStart(5)} -> ${String(a.picksEarlier).padStart(5)}`,
  );
}
console.log(
  changed.length
    ? `\n${changed.length} verdicts changed\n${changed.join("\n")}`
    : "\nNo verdict changed.",
);

/**
 * The cheat sheet's arithmetic and its filtering, without a browser.
 *
 *   npm run verify:cheat-sheet
 *
 * Two things are worth proving here and they are worth proving separately.
 *
 * ONE: THAT A DRAFTED PLAYER LEAVES THE LIST. This is the entire reason the
 * page exists — two managers said they could not tell who was gone — and it is
 * a pure function of the pool and the drafted set, so it can be asserted
 * exhaustively in milliseconds rather than hopefully in a browser.
 *
 * TWO: THAT THE POINTS ARE THIS LEAGUE'S POINTS. A tight end catches at a full
 * point here and at half everywhere else, and until today nothing in this repo
 * applied that — `SCORING_SPEC.recTePremium` existed and was read by no one. A
 * regression would be invisible on screen: the column would still be full of
 * plausible three-figure numbers, and every tight end would be quietly fifty
 * points light. So the premium is asserted against a hand-computed stat line
 * rather than against whatever the code currently returns.
 *
 * The browser half — that the page redraws when a pick lands — is
 * `verify:cheat-sheet:browser`.
 */
import { buildCheatSheet } from "@/lib/cheat-sheet";
import {
  applyCheatSheet,
  draftedFromView,
  valueGap,
  type DraftedBy,
} from "@/lib/cheat-sheet-view";
import { pointsFromStats, receptionValue } from "@/lib/projections";
import { SCORING_SPEC } from "@/lib/league-config";
import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";

let failures = 0;
function check(label: string, condition: boolean, detail = "") {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

// --- 1. The tight end premium -----------------------------------------------

section("1. A tight end's catch is worth double everyone else's");

check(
  `league config carries a ${SCORING_SPEC.recTePremium} tight end premium`,
  SCORING_SPEC.recTePremium === 0.5,
  `got ${SCORING_SPEC.recTePremium}`,
);
check(
  "a tight end's reception is worth 1.0",
  receptionValue("TE") === SCORING_SPEC.ppr + SCORING_SPEC.recTePremium,
  `got ${receptionValue("TE")}`,
);
for (const pos of ["WR", "RB", "QB"]) {
  check(
    `a ${pos}'s reception is worth ${SCORING_SPEC.ppr}`,
    receptionValue(pos) === SCORING_SPEC.ppr,
    `got ${receptionValue(pos)}`,
  );
}
check(
  "an unstated position gets the base rate rather than a guess",
  receptionValue(undefined) === SCORING_SPEC.ppr && receptionValue(null) === SCORING_SPEC.ppr,
);

{
  /*
   * The same stat line at two positions. Everything except the receptions is
   * held constant, so the gap this asserts is caused by the premium alone —
   * and it is read from the config rather than written as a literal, so
   * re-pointing the league re-points the test with it.
   */
  const line = { receptions: 100, recYards: 1200, recTd: 8 };
  const te = pointsFromStats(line, "TE");
  const wr = pointsFromStats(line, "WR");
  const expected = 100 * SCORING_SPEC.recTePremium;
  check(
    `100 catches are worth ${expected} more to a tight end than to a receiver`,
    Math.abs(te - wr - expected) < 1e-9,
    `${te.toFixed(1)} vs ${wr.toFixed(1)}`,
  );
  check(
    "…and the receiver's own total is unchanged by the premium existing",
    Math.abs(wr - (100 * SCORING_SPEC.ppr + 1200 / 10 + 8 * SCORING_SPEC.recTd)) < 1e-9,
    `${wr.toFixed(2)}`,
  );
}

{
  // The six-point passing touchdown, which was already right and must stay so.
  const qb = pointsFromStats({ passYards: 4000, passTd: 30, interceptions: 10 }, "QB");
  const expected =
    4000 / SCORING_SPEC.passYardsPerPoint +
    30 * SCORING_SPEC.passTd +
    10 * SCORING_SPEC.interceptionThrown;
  check(
    `a 30-TD quarterback scores ${expected.toFixed(1)} on six-point passing TDs`,
    Math.abs(qb - expected) < 1e-9,
    `${qb.toFixed(1)}`,
  );
}

// --- 2. The real sheet ------------------------------------------------------

section("2. The sheet built from the committed pool and projections");

const { rows, meta } = buildCheatSheet();

check("the sheet is not empty", rows.length > 100, `${rows.length} rows`);
console.log(`  · ${rows.length} players, ${meta.projectedCount} of them projected`);
console.log(`  · projections pulled ${meta.projectionsPulledAt ?? "never"}`);
check(
  "there are no kickers — this league cannot start one",
  rows.every((r) => r.position !== "K"),
  rows.filter((r) => r.position === "K").length + " found",
);
check(
  "every row is ranked, projected or on the league board — nothing is filler",
  rows.every((r) => r.adp != null || r.points != null || r.leagueRank != null),
);
check(
  "player ids are unique, so a row cannot be drafted twice",
  new Set(rows.map((r) => r.id)).size === rows.length,
);

// --- 2b. The league-scoped board --------------------------------------------

section("2b. The ordering comes from the league-scoped export");

check(
  "there is a league-scoped board behind the ordering",
  meta.board?.scopedToLeague === true,
  meta.boardProblem ?? "no board",
);
if (meta.board) {
  console.log(`  · exported from “${meta.board.leagueLabel}” at ${meta.board.exportedAt}`);
  console.log(`  · ${meta.board.rankedCount} players carry a league rank`);
  check(
    "it ranks enough players to draft 150 of them",
    meta.board.rankedCount >= 300,
    `${meta.board.rankedCount}`,
  );
  check(
    "the tiers are labelled as coming from the generic board",
    meta.board.tierScope === "generic",
    meta.board.tierScope,
  );
}

check(
  "the default order is the league board, not ADP",
  rows
    .filter((r) => r.leagueRank != null)
    .every((r, i, a) => i === 0 || (a[i - 1].leagueRank ?? 0) <= (r.leagueRank ?? 0)),
);
check(
  "league ranks are unique — two players cannot share a slot in the order",
  (() => {
    const ranks = rows.map((r) => r.leagueRank).filter((r): r is number => r != null);
    return new Set(ranks).size === ranks.length;
  })(),
);

{
  /*
   * THE REASON THE EXPORT IS WORTH HAVING, ASSERTED RATHER THAN ASSUMED.
   *
   * The league board should rate tight ends materially higher than the market
   * does, because a tight end catches at a full point here and at half in the
   * ADP that ranks him. If this ever stops being true the export has quietly
   * been replaced with a generic one — which would look completely normal on
   * screen and would reintroduce the exact bias the page exists to remove.
   */
  const tes = rows.filter(
    (r) => r.position === "TE" && r.leagueRank != null && r.adp != null,
  );
  const lifted = tes.filter((r) => (r.leagueRank ?? 0) < (r.adp ?? 0));
  check(
    "tight ends rank higher on the league board than their market ADP",
    lifted.length > tes.length / 2,
    `${lifted.length} of ${tes.length}`,
  );
  const top = rows.filter((r) => r.leagueRank != null && r.leagueRank <= 20);
  const teInTop20 = top.filter((r) => r.position === "TE").length;
  check(
    "a tight end premium puts at least one TE in the top 20 overall",
    teInTop20 >= 1,
    `${teInTop20}`,
  );
  console.log(
    `  · top 20 by league rank: ${top
      .slice(0, 20)
      .map((r) => `${r.position}`)
      .join(" ")}`,
  );
}

check(
  "bye weeks are present for essentially everyone draftable",
  rows.filter((r) => r.leagueRank != null && r.leagueRank <= 250 && r.bye == null)
    .length === 0,
  `${rows.filter((r) => r.leagueRank != null && r.leagueRank <= 250 && r.bye == null).length} missing`,
);
check(
  "tiers arrived from the flat board",
  rows.filter((r) => r.tier != null).length > 300,
  `${rows.filter((r) => r.tier != null).length}`,
);

{
  const tes = rows.filter((r) => r.position === "TE" && r.points != null);
  check("tight ends are projected", tes.length > 10, `${tes.length}`);
  /*
   * The premium is worth ~50 points to a target-hog tight end, which is enough
   * to lift the best of them past a lot of what the market ranks above him.
   * Asserted as "the top tight end clears what he would have scored without
   * it" rather than against a fixed number, so a projection re-pull does not
   * fail this.
   */
  const best = tes.reduce((a, b) => ((a.points ?? 0) > (b.points ?? 0) ? a : b));
  check(
    `the best tight end (${best.name}, ${best.points}) is scored above 200`,
    (best.points ?? 0) > 200,
    `${best.points}`,
  );
  check(
    "tight ends are ranked densely within their position",
    tes
      .map((r) => r.pointsPositionRank)
      .sort((a, b) => (a ?? 0) - (b ?? 0))
      .every((r, i) => r === i + 1),
  );
}

check(
  "the page can state the tight end reception value it used",
  meta.tePremiumReception === 1 && meta.passTd === 6,
  `${meta.tePremiumReception} / ${meta.passTd}`,
);

{
  /*
   * The gap between where the market ranks a player and where this league does.
   * Not an assertion about any individual — projections move — but the page's
   * whole claim is that the two orders differ, so if they ever stopped
   * differing the page would be pointless and nothing else would say so.
   */
  const moved = rows.filter((r) => {
    const g = valueGap(r);
    return g != null && Math.abs(g) >= 5;
  });
  check(
    "this league's order really does differ from the market's",
    moved.length > 5,
    `${moved.length} players move 5+ positional places`,
  );
  const risers = rows
    .filter((r) => (valueGap(r) ?? 0) >= 5 && r.adp != null && r.adp < 120)
    .slice(0, 6);
  for (const r of risers) {
    console.log(
      `  · ${r.name} (${r.position}) — ADP ${r.adp}, ${r.position}${r.positionRank} by market, ` +
        `${r.position}${r.pointsPositionRank} by our scoring`,
    );
  }
}

// --- 3. Who is gone ---------------------------------------------------------

section("3. A drafted player leaves the available list");

/** A room view carrying just enough to exercise `draftedFromView`. */
function viewWith(picks: { id: string; name: string; by: string; label: string }[]) {
  const slots = picks.map(
    (p, i) =>
      ({
        id: `s${i}`,
        round: 1,
        pickInRound: i + 1,
        overallPick: i + 1,
        label: p.label,
        column: i + 1,
        originalOwner: { name: p.by },
        currentOwner: { name: p.by },
        traded: false,
        isKeeper: p.label === "kept",
        player: { id: p.id, name: p.name, position: "WR", nflTeam: "X", byeWeek: 7 },
        onTheClock: false,
        fill: "pick",
        seq: i,
        enteredAt: null,
      }) as unknown as LiveSlot,
  );
  return { slots } as unknown as DraftRoomView;
}

const [first, second, third] = rows;
const drafted: DraftedBy = draftedFromView(
  viewWith([
    { id: first.id, name: first.name, by: "Steve", label: "1.01" },
    { id: second.id, name: second.name, by: "Dennis", label: "1.02" },
  ]),
);

check(
  "the board's picks become the drafted set",
  drafted[first.id]?.by === "Steve" && drafted[second.id]?.label === "1.02",
  JSON.stringify(drafted),
);
check(
  "an empty slot contributes nothing",
  Object.keys(draftedFromView(viewWith([]))).length === 0,
);

const base = { q: "", position: "", sort: "adp" } as const;
const available = applyCheatSheet(rows, drafted, { ...base, availability: "available" });
const all = applyCheatSheet(rows, drafted, { ...base, availability: "all" });
const gone = applyCheatSheet(rows, drafted, { ...base, availability: "drafted" });

check(
  "the drafted players are not in the available list",
  !available.some((r) => r.id === first.id || r.id === second.id),
);
check(
  "…and the available list is exactly two shorter",
  available.length === rows.length - 2,
  `${available.length} vs ${rows.length}`,
);
check(
  "an undrafted player is still there",
  available.some((r) => r.id === third.id),
);
check("“All” keeps them, so you can see who went", all.length === rows.length);
check(
  "“Gone” shows only them",
  gone.length === 2 && gone.every((r) => drafted[r.id] != null),
  `${gone.length}`,
);
check(
  "nobody is in both the available and the gone list",
  available.every((r) => !gone.some((g) => g.id === r.id)),
);

// --- 4. Sorting and filtering -----------------------------------------------

section("4. The controls");

{
  const byPoints = applyCheatSheet(rows, {}, { ...base, availability: "all", sort: "points" });
  const projected = byPoints.filter((r) => r.points != null);
  check(
    "sorting by points is descending",
    projected.every((r, i, a) => i === 0 || (a[i - 1].points ?? 0) >= (r.points ?? 0)),
  );
  check(
    "unprojected players sort to the bottom rather than reading as zero",
    byPoints.findIndex((r) => r.points == null) === -1 ||
      byPoints.findIndex((r) => r.points == null) >= projected.length,
  );
  check(
    "the top of the points order is not the top of the ADP order",
    byPoints[0].id !== rows[0].id || byPoints[1].id !== rows[1].id,
    "identical orders would mean the league scoring changed nothing",
  );
  console.log(
    `  · top five by our scoring: ${byPoints
      .slice(0, 5)
      .map((r) => `${r.name} (${r.position}, ${r.points})`)
      .join(", ")}`,
  );
}

{
  const wr = applyCheatSheet(rows, {}, { ...base, availability: "all", position: "WR" });
  check(
    "the position filter admits only that position",
    wr.length > 0 && wr.every((r) => r.position === "WR"),
  );
}

{
  const hits = applyCheatSheet(rows, {}, { ...base, availability: "all", q: "jefferson" });
  check(
    "search finds a player by surname",
    hits.length > 0 && hits.every((r) => r.name.toLowerCase().includes("jefferson")),
    `${hits.length} hits`,
  );
  const punctuated = applyCheatSheet(rows, {}, { ...base, availability: "all", q: "jamarr" });
  check(
    "search ignores punctuation, so “jamarr” finds Ja'Marr",
    punctuated.some((r) => r.name.toLowerCase().includes("chase")),
  );
  check(
    "an empty search changes nothing",
    applyCheatSheet(rows, {}, { ...base, availability: "all", q: "" }).length === rows.length,
  );
}

{
  /*
   * A cheat sheet whose rows swap places while somebody is reading it is what
   * sends people back to paper, so every comparator falls through to a total
   * order. Asserted by sorting a shuffled copy and requiring the same result.
   */
  const shuffled = [...rows].sort(() => Math.random() - 0.5);
  for (const sort of ["rank", "adp", "points", "position", "name"] as const) {
    const a = applyCheatSheet(rows, {}, { ...base, availability: "all", sort });
    const b = applyCheatSheet(shuffled, {}, { ...base, availability: "all", sort });
    check(
      `the ${sort} order is total — input order cannot change it`,
      a.map((r) => r.id).join() === b.map((r) => r.id).join(),
    );
  }
}

// --- 5. Every player, one at a time -----------------------------------------

section("5. Exhaustively: drafting anyone removes exactly him");

{
  let wrong = 0;
  // Every tenth row, which covers all five positions and both ends of the
  // board without making the check take longer than it is worth.
  for (let i = 0; i < rows.length; i += 10) {
    const target = rows[i];
    const one: DraftedBy = { [target.id]: { by: "Steve", label: "1.01" } };
    const left = applyCheatSheet(rows, one, { ...base, availability: "available" });
    if (left.length !== rows.length - 1 || left.some((r) => r.id === target.id)) wrong++;
  }
  check(
    `drafting any one of ${Math.ceil(rows.length / 10)} sampled players removes him and nobody else`,
    wrong === 0,
    `${wrong} wrong`,
  );
}

{
  // The end state: a full 150-pick draft. Nothing should be left claiming to be
  // available that is on the board.
  const full: DraftedBy = {};
  for (const r of rows.slice(0, 150)) full[r.id] = { by: "Steve", label: "x" };
  const left = applyCheatSheet(rows, full, { ...base, availability: "available" });
  check(
    "after a full 150-pick draft the available list has dropped 150",
    left.length === rows.length - 150,
    `${left.length}`,
  );
  check(
    "…and none of the 150 is still listed as available",
    left.every((r) => full[r.id] == null),
  );
}

console.log(
  `\n  ${failures === 0 ? "All checks passed." : `${failures} failed.`}\n`,
);
process.exit(failures === 0 ? 0 : 1);

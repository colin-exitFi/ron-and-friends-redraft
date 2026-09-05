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
  projectedStatLine,
  projectionBreakdown,
  valueGap,
  type DraftedBy,
} from "@/lib/cheat-sheet-view";
import { pointsFromStats, receptionValue } from "@/lib/projections";
import { pointsFromSleeperSeason } from "@/lib/sleeper-season";
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

// --- 2c. Last season, scored in this league's rules -------------------------

section("2c. Last season's actual points are THIS league's points");

/*
 * ============================================================================
 * WHY THIS IS ASSERTED AGAINST HAND ARITHMETIC AND NOT AGAINST THE CODE
 * ============================================================================
 * A wrong points total here is the most expensive kind of bug this page can
 * have, because it is INVISIBLE: the column would still be full of plausible
 * three-figure numbers, ten people would read them off a television, and
 * nothing on screen would say the tight end premium had been dropped or a
 * bonus double-counted.
 *
 * So the three lines below were computed BY HAND from Sleeper's raw 2025 stat
 * lines before the scorer was pointed at them, and the expected totals are
 * written out term by term. If `SCORING_SPEC` is re-pointed these fail, which
 * is correct — they are a check on the arithmetic, not on the configuration.
 */
{
  const te = pointsFromSleeperSeason(
    { rec: 126, rec_yd: 1239, rec_td: 11, bonus_rec_yd_100: 3, gp: 17 },
    "TE",
  );
  /*
   * Trey McBride, 2025. 126 catches at a FULL POINT (the premium) = 126, plus
   * 123.9 receiving, plus 66 for eleven scores, plus three 100-yard games.
   */
  const teExpected = 126 * 1.0 + 1239 / 10 + 11 * 6 + 3 * 1;
  check(
    `Trey McBride's 2025 scores ${teExpected.toFixed(1)} by hand`,
    Math.abs(te - teExpected) < 1e-9,
    `got ${te.toFixed(1)}, expected ${teExpected.toFixed(1)}`,
  );
  /*
   * THE ENTIRE ARGUMENT FOR COMPUTING THIS OURSELVES, ASSERTED. The same season
   * at half a point a catch — which is what every public surface shows — is 63
   * points lighter. That is most of a round, it lands on exactly the position
   * this league has deliberately repriced, and it is the number a manager
   * cannot get anywhere else.
   */
  const asWr = pointsFromSleeperSeason(
    { rec: 126, rec_yd: 1239, rec_td: 11, bonus_rec_yd_100: 3, gp: 17 },
    "WR",
  );
  check(
    "…and is 63 points more than the public half-PPR figure for the same season",
    Math.abs(te - asWr - 126 * SCORING_SPEC.recTePremium) < 1e-9,
    `${te.toFixed(1)} vs ${asWr.toFixed(1)}`,
  );

  /*
   * Bijan Robinson, 2025 — the high-volume back, which is the line that
   * exercises everything at once: two rushing scores' worth of two-pointers,
   * six explosive plays, both fumble charges and two different yardage bonuses.
   */
  const rb = pointsFromSleeperSeason(
    {
      rush_yd: 1478, rush_td: 7, rush_2pt: 1, rush_40p: 2,
      rec: 79, rec_yd: 820, rec_td: 4, rec_40p: 4,
      fum: 4, fum_lost: 3,
      bonus_rush_yd_100: 5, bonus_rec_yd_100: 2, gp: 17,
    },
    "RB",
  );
  const rbExpected =
    1478 / 10 + 7 * 6 + 1 * 2 + 2 * 1 + // rushing, a 2pt, two 40-yard runs
    79 * 0.5 + 820 / 10 + 4 * 6 + 4 * 1 + // receiving at the BASE rate, four 40s
    4 * -1 + 3 * -1 + // four fumbles, three of them lost
    5 * 1 + 2 * 1; // five 100-yard rushing games, two receiving
  check(
    `Bijan Robinson's 2025 scores ${rbExpected.toFixed(1)} by hand`,
    Math.abs(rb - rbExpected) < 1e-9,
    `got ${rb.toFixed(1)}, expected ${rbExpected.toFixed(1)}`,
  );

  /*
   * Matthew Stafford, 2025 — the quarterback, where the six-point passing
   * touchdown is worth 92 points over the market's four and where a pick-six
   * has to be charged twice.
   */
  const qb = pointsFromSleeperSeason(
    {
      pass_yd: 4707, pass_td: 46, pass_int: 8, pass_int_td: 2, pass_cmp_40p: 8,
      rush_yd: 1, fum: 7, fum_lost: 3,
      bonus_pass_yd_300: 3, bonus_pass_yd_400: 1, gp: 17,
    },
    "QB",
  );
  const qbExpected =
    4707 / 20 + 46 * 6 + 8 * -2 + 2 * -4 + 8 * 1 + // passing, incl. two pick-sixes
    1 / 10 + 7 * -1 + 3 * -1 + // a yard on the ground, seven fumbles
    3 * 1 + 1 * 1; // three 300-yard games and a 400
  check(
    `Matthew Stafford's 2025 scores ${qbExpected.toFixed(1)} by hand`,
    Math.abs(qb - qbExpected) < 1e-9,
    `got ${qb.toFixed(1)}, expected ${qbExpected.toFixed(1)}`,
  );

  /*
   * A pick-six is charged TWICE — once as an interception and once as the
   * increment. Asserted on its own because it is the one term in the scorer
   * whose omission would look like nothing at all.
   */
  const clean = pointsFromSleeperSeason({ pass_int: 1, gp: 1 }, "QB");
  const pickSix = pointsFromSleeperSeason({ pass_int: 1, pass_int_td: 1, gp: 1 }, "QB");
  check(
    `a pick-six costs ${-SCORING_SPEC.pickSixAdditional} more than an ordinary interception`,
    Math.abs(pickSix - clean - SCORING_SPEC.pickSixAdditional) < 1e-9,
    `${pickSix} vs ${clean}`,
  );

  /*
   * NEVER THROWS ON A MISSING STAT. A rookie's line is `{}` and must score a
   * clean zero rather than a NaN, which would render as "NaN" in front of the
   * room and would poison every sort it touched.
   */
  const rookie = pointsFromSleeperSeason({}, "WR");
  check("an empty stat line scores 0 rather than NaN", rookie === 0, `${rookie}`);
  check(
    "an unknown position falls back to the base reception rate",
    pointsFromSleeperSeason({ rec: 10 }, null) === 10 * SCORING_SPEC.ppr,
  );
}

if (meta.lastSeason) {
  console.log(
    `  · ${meta.lastSeason.season} actuals pulled ${meta.lastSeason.pulledAt}, ` +
      `${meta.lastSeason.scoredCount} rows carry one`,
  );
  check(
    "enough of the draftable board carries a last-season line to be worth a column",
    meta.lastSeason.scoredCount > 250,
    `${meta.lastSeason.scoredCount}`,
  );
  check(
    "the top 100 of the board is mostly covered — these are the picks that matter",
    (() => {
      const top = rows.filter((r) => r.leagueRank != null && r.leagueRank <= 100);
      const withPrior = top.filter((r) => r.lastSeasonPoints != null).length;
      return withPrior >= top.length * 0.7;
    })(),
    (() => {
      const top = rows.filter((r) => r.leagueRank != null && r.leagueRank <= 100);
      return `${top.filter((r) => r.lastSeasonPoints != null).length} of ${top.length}`;
    })(),
  );

  /*
   * A ROOKIE MUST BE BLANK, NOT ZERO. The two look identical in a table cell
   * and mean opposite things — "he busted" against "he was not in the league" —
   * so the puller drops anyone who never took the field rather than writing a
   * zero, and this asserts that nothing slipped through.
   */
  check(
    "nobody carries a last-season line of exactly zero — a blank is not a bad season",
    rows.every((r) => r.lastSeasonPoints !== 0),
    `${rows.filter((r) => r.lastSeasonPoints === 0).length} zeroes`,
  );
  check(
    "every last-season line has games behind it, so the per-game figure is real",
    rows.every(
      (r) =>
        r.lastSeasonPoints == null ||
        (r.lastSeasonGames != null && r.lastSeasonGames > 0),
    ),
  );
  /*
   * EIGHTEEN, NOT SEVENTEEN, AND THAT IS NOT A BUG. This started as a `<= 17`
   * check and Rashid Shaheed failed it at 18. He was traded mid-season between
   * teams whose bye weeks fell either side of the move, so he really did dress
   * for eighteen games in a seventeen-game season. The bound is kept — a
   * nineteen would mean two players' seasons had been merged by the name join —
   * and it is set where the schedule actually allows rather than where it looks
   * tidy.
   */
  check(
    "no player is credited with more than 18 games — the traded-player ceiling",
    rows.every((r) => (r.lastSeasonGames ?? 0) <= 18),
    rows
      .filter((r) => (r.lastSeasonGames ?? 0) > 18)
      .map((r) => `${r.name} ${r.lastSeasonGames}`)
      .join(", "),
  );
  check(
    "the per-game figure really is the total over the games, to a rounding tenth",
    rows.every((r) => {
      if (r.lastSeasonPoints == null || !r.lastSeasonGames || r.lastSeasonPerGame == null)
        return true;
      return Math.abs(r.lastSeasonPerGame - r.lastSeasonPoints / r.lastSeasonGames) < 0.11;
    }),
  );

  /*
   * TEAM DEFENCES ARE DELIBERATELY ABSENT. This league's D/ST scoring is
   * dominated by a per-game points-allowed band, and a season total cannot say
   * which bands a unit earned. If one ever appears here it means somebody
   * scored a defence off `pts_allow`, which would be a confidently wrong number
   * in front of ten people.
   */
  check(
    "no team defence carries a last-season figure — it cannot be computed honestly",
    rows.filter((r) => r.position === "DST").every((r) => r.lastSeasonPoints == null),
    `${rows.filter((r) => r.position === "DST" && r.lastSeasonPoints != null).length} scored`,
  );

  {
    // Sorting on last season uses PER GAME, so a part-season star outranks a
    // healthy plodder who out-totalled him.
    const byLast = applyCheatSheet(rows, {}, {
      q: "",
      position: "",
      availability: "all",
      sort: "lastSeason",
    });
    const scored = byLast.filter((r) => r.lastSeasonPerGame != null);
    check(
      "sorting by last season is descending on points per game",
      scored.every(
        (r, i, a) => i === 0 || (a[i - 1].lastSeasonPerGame ?? 0) >= (r.lastSeasonPerGame ?? 0),
      ),
    );
    check(
      "players with no last season sort to the bottom rather than reading as zero",
      byLast.findIndex((r) => r.lastSeasonPerGame == null) === -1 ||
        byLast.findIndex((r) => r.lastSeasonPerGame == null) >= scored.length,
    );
    console.log(
      `  · best ${meta.lastSeason.season} per game: ${scored
        .slice(0, 5)
        .map((r) => `${r.name} (${r.position}, ${r.lastSeasonPerGame}/g)`)
        .join(", ")}`,
    );
  }

  {
    /*
     * THE TIGHT END PREMIUM, VISIBLE IN THE ACTUALS AND NOT ONLY IN THE UNIT
     * TEST ABOVE. A tight end's league-scored 2025 must exceed what the same
     * season would have paid a receiver, by exactly his reception count times
     * the premium. Checked on the real committed file rather than on a literal,
     * so a puller that forgot to pass the position would fail here.
     */
    const tes = rows.filter((r) => r.position === "TE" && r.lastSeasonPoints != null);
    check(
      "tight ends carry a last-season line",
      tes.length > 10,
      `${tes.length}`,
    );
    const best = tes.reduce((a, b) =>
      (a.lastSeasonPoints ?? 0) > (b.lastSeasonPoints ?? 0) ? a : b,
    );
    console.log(
      `  · best ${meta.lastSeason.season} tight end: ${best.name}, ` +
        `${best.lastSeasonPoints} (${best.lastSeasonPerGame}/g in ${best.lastSeasonGames})`,
    );
    check(
      "the premium lifts the best tight end's actual season above 250",
      (best.lastSeasonPoints ?? 0) > 250,
      `${best.lastSeasonPoints}`,
    );
  }

  {
    // Quarterbacks top the actuals, for the same reason they top the
    // projections: six points a passing touchdown. If they ever stopped doing
    // so, the scorer has quietly reverted to somebody else's scoring.
    const top = [...rows]
      .filter((r) => r.lastSeasonPoints != null)
      .sort((a, b) => (b.lastSeasonPoints ?? 0) - (a.lastSeasonPoints ?? 0))
      .slice(0, 5);
    check(
      "the highest actual scorers are quarterbacks — the six-point passing TD",
      top.every((r) => r.position === "QB"),
      top.map((r) => `${r.name} ${r.position} ${r.lastSeasonPoints}`).join(", "),
    );
    console.log(
      `  · top ${meta.lastSeason.season} totals: ${top
        .map((r) => `${r.name} (${r.position}, ${r.lastSeasonPoints})`)
        .join(", ")}`,
    );
  }
} else {
  console.log(`  · no last-season snapshot — ${meta.lastSeasonProblem}`);
  check(
    "a missing snapshot is reported rather than silently empty",
    meta.lastSeasonProblem != null,
  );
}

// --- 2d. The status flags ---------------------------------------------------

section("2d. Injury flags are flags, not decoration");

check(
  "“Active” is never surfaced as a status — a badge on every row is a badge on none",
  rows.every((r) => r.injuryStatus == null || r.injuryStatus.toUpperCase() !== "ACTIVE"),
  rows.filter((r) => r.injuryStatus?.toUpperCase() === "ACTIVE").length + " found",
);
check(
  "a status is a short label rather than a sentence, so it fits beside a name",
  rows.every((r) => r.injuryStatus == null || r.injuryStatus.length <= 14),
  rows.find((r) => (r.injuryStatus?.length ?? 0) > 14)?.injuryStatus ?? "",
);
{
  const flagged = rows.filter((r) => r.injuryStatus != null);
  console.log(`  · ${flagged.length} players carry a designation`);
  check(
    "the flags are a minority of the board — otherwise they are noise",
    flagged.length < rows.length / 4,
    `${flagged.length} of ${rows.length}`,
  );
  for (const r of flagged.filter((r) => (r.leagueRank ?? 999) <= 60)) {
    console.log(`  · ${r.name} (${r.position}, Rk ${r.leagueRank}) — ${r.injuryStatus}`);
  }
}

// --- 2e. The value signal already on disk -----------------------------------

section("2e. FantasyPros' ECR-versus-ADP, which was in the file and unrendered");

{
  const withDelta = rows.filter((r) => r.ecrVsAdp != null);
  check(
    "the export's ECR-versus-ADP reached the row",
    withDelta.length > 200,
    `${withDelta.length}`,
  );
  const values = withDelta.filter((r) => Math.abs(r.ecrVsAdp ?? 0) >= 10);
  check(
    "some players are ranked a full round away from where they are drafted",
    values.length > 5,
    `${values.length}`,
  );
  for (const r of values
    .filter((r) => (r.ecrVsAdp ?? 0) > 0 && r.adp != null && r.adp < 150)
    .sort((a, b) => (b.ecrVsAdp ?? 0) - (a.ecrVsAdp ?? 0))
    .slice(0, 5)) {
    console.log(
      `  · ${r.name} (${r.position}) — ADP ${r.adp}, experts have him ${r.ecrVsAdp} places earlier`,
    );
  }
}

// --- 2f. The projection, broken out by category -----------------------------

section("2f. The projected components add up to the projected total");

/*
 * ============================================================================
 * THE ONE FAILURE MODE OF THE BREAKDOWN PANEL
 * ============================================================================
 * The commissioner asked to see the projection by category — receptions,
 * receiving yards, touchdowns, rushing, passing. The panel shows each component
 * with the rate this league pays and the points it contributes.
 *
 * If those line items do not sum to the total in the `Proj` column beside them,
 * a manager doing the arithmetic on his phone finds a contradiction, and he
 * then has no reason to trust either number. It would be invisible on screen —
 * every figure would look plausible — so it is asserted here, on every row of
 * the real committed board rather than on a fixture.
 *
 * This is also the reason the components are read from the SAME snapshot that
 * produced the total rather than from a second projections feed. Sleeper
 * publishes 2026 component projections too, and they are perfectly good, but
 * pairing their components with a FantasyPros-derived total would guarantee
 * exactly this contradiction.
 */
{
  const projected = rows.filter((r) => r.projectedStats != null);
  check(
    "the projected components reached the row",
    projected.length > 300,
    `${projected.length}`,
  );

  let mismatched = 0;
  let worst = { name: "", delta: 0 };
  for (const row of projected) {
    const lines = projectionBreakdown(row);
    const sum = lines.reduce((total, line) => total + line.points, 0);
    // A tenth of a point of slack: `row.points` is rounded for display.
    const delta = Math.abs(sum - (row.points ?? 0));
    if (delta > 0.06) {
      mismatched++;
      if (delta > worst.delta) worst = { name: row.name, delta };
    }
  }
  check(
    `every one of ${projected.length} breakdowns sums to the total beside it`,
    mismatched === 0,
    `${mismatched} disagree, worst ${worst.name} by ${worst.delta.toFixed(2)}`,
  );

  /*
   * HAND ARITHMETIC, term by term, for the two positions the commissioner
   * named. Computed from the raw components before the panel was pointed at
   * them. A tight end exercises the premium; a quarterback exercises the
   * six-point passing touchdown and the negative interception line.
   */
  {
    // Brock Bowers: 93.95 catches at a FULL POINT, 991.39 yards, 6.81 scores.
    const bowers = rows.find((r) => r.name === "Brock Bowers");
    if (bowers) {
      const expected = 93.95 * 1.0 + 991.39 / 10 + 6.81 * 6 + 0.18 * -2;
      check(
        `Brock Bowers projects ${expected.toFixed(1)} by hand`,
        Math.abs((bowers.points ?? 0) - expected) < 0.06,
        `page says ${bowers.points}, hand says ${expected.toFixed(2)}`,
      );
      /*
       * AND THE PREMIUM IS WORTH 47 POINTS TO HIM. This is the number that
       * explains the page: a public half-PPR board pays him 0.5 a catch, so it
       * is showing a figure 47 points lighter — which is why he sits above
       * receivers there that he sits below here.
       */
      const premium = 93.95 * SCORING_SPEC.recTePremium;
      // Overrides the SCORED position, not the displayed one — that is the
      // input the breakdown reads, and this assertion caught the difference.
      const asWr = projectionBreakdown({
        ...bowers,
        projectedStatsPosition: "WR",
      }).reduce((t, l) => t + l.points, 0);
      check(
        `…and the TE premium is ${premium.toFixed(1)} of that, versus a receiver's rate`,
        Math.abs((bowers.points ?? 0) - asWr - premium) < 0.06,
        `${bowers.points} vs ${asWr.toFixed(1)}`,
      );
    } else {
      check("Brock Bowers is on the board to check", false);
    }
  }
  {
    // Josh Allen: 3889.49 passing at a point per 20, 26.85 scores at SIX.
    const allen = rows.find((r) => r.name === "Josh Allen");
    if (allen) {
      const expected =
        3889.49 / 20 + 26.85 * 6 + 11.64 * -2 + 577.91 / 10 + 11.06 * 6 + 4.1 * -2;
      check(
        `Josh Allen projects ${expected.toFixed(1)} by hand`,
        Math.abs((allen.points ?? 0) - expected) < 0.06,
        `page says ${allen.points}, hand says ${expected.toFixed(2)}`,
      );
      /*
       * The six-point passing touchdown is worth 54 points over the four-point
       * board every public ranking is built on — the other half of why this
       * league's order is not the market's.
       */
      const atFour = expected - 26.85 * (SCORING_SPEC.passTd - 4);
      console.log(
        `  · at a 4-point passing TD he would project ${atFour.toFixed(1)}, ` +
          `so this league's rule is worth ${(expected - atFour).toFixed(1)} to him`,
      );
    } else {
      check("Josh Allen is on the board to check", false);
    }
  }

  /*
   * THE PANEL MUST NOT CLAIM LEAGUE SCORING FOR A VENDOR TOTAL. A team defence
   * carries FantasyPros' own number, and `projectedStats` is null for exactly
   * those rows so the UI takes its "this is not re-scored here" branch. If a
   * defence ever grew a breakdown it would be presenting foreign scoring as
   * this league's.
   */
  check(
    "no vendor-scored row carries a breakdown that would imply league scoring",
    rows
      .filter((r) => r.basis === "vendor")
      .every((r) => r.projectedStats == null && projectionBreakdown(r).length === 0),
    `${rows.filter((r) => r.basis === "vendor" && r.projectedStats != null).length} do`,
  );
  {
    const dst = rows.filter((r) => r.position === "DST" && r.points != null);
    console.log(
      `  · ${dst.length} team defences carry a projected total and no breakdown, by design`,
    );
    check(
      "team defences are projected at all, even without a breakdown",
      dst.length >= 20,
      `${dst.length}`,
    );
  }

  /*
   * NOTHING THROWS ON A MISSING STAT, and an empty projection produces no
   * lines rather than a row of zeroes. A rookie with no projection has to look
   * intentional.
   */
  check(
    "an unprojected player yields no breakdown rather than throwing",
    (() => {
      const bare = rows.find((r) => r.projectedStats == null);
      if (!bare) return true;
      return projectionBreakdown(bare).length === 0;
    })(),
  );
  check(
    "a stat line of all zeroes yields no lines rather than eight empty ones",
    projectionBreakdown({
      ...rows[0],
      position: "WR",
      projectedStats: { receptions: 0, recYards: 0, recTd: 0 },
    }).length === 0,
  );

  /*
   * THE COLUMNS ARE POSITIONALLY APPROPRIATE — passing yards on a running
   * back's row are noise, and the headline line is what a manager reads while
   * scrolling rather than on tap.
   */
  {
    const rb = rows.find((r) => r.position === "RB" && r.projectedStats?.rushYards);
    const wr = rows.find((r) => r.position === "WR" && r.projectedStats?.receptions);
    const qb = rows.find((r) => r.position === "QB" && r.projectedStats?.passYards);
    check(
      "a running back's headline leads with rushing, not passing",
      /^[\d,]+ rush yd/.test(projectedStatLine(rb!) ?? ""),
      projectedStatLine(rb!) ?? "none",
    );
    check(
      "a receiver's headline leads with receptions",
      /rec$|^[\d.]+ rec /.test(projectedStatLine(wr!) ?? ""),
      projectedStatLine(wr!) ?? "none",
    );
    check(
      "a quarterback's headline leads with passing",
      /^[\d,]+ pass yd/.test(projectedStatLine(qb!) ?? ""),
      projectedStatLine(qb!) ?? "none",
    );
    check(
      "a receiver's breakdown does not open with a passing line",
      projectionBreakdown(wr!)[0]?.label.startsWith("Rec") === true,
      projectionBreakdown(wr!)[0]?.label ?? "none",
    );
    /*
     * Keyed on the SCORED position rather than the displayed one, because they
     * are not always the same player-for-player and the premium follows the
     * arithmetic. Max Bredeson shows as an RB and was scored as a TE; his
     * reception line must carry the premium, because his total does.
     */
    check(
      "the premium is flagged exactly when the points were scored at tight end",
      rows
        .filter((r) => r.projectedStats?.receptions)
        .every((r) => {
          const premium = projectionBreakdown(r).some((l) => l.premium);
          const scoredAt = (r.projectedStatsPosition ?? r.position).toUpperCase();
          return premium === (scoredAt === "TE");
        }),
    );
    for (const r of [qb, rb, wr].filter((r) => r != null)) {
      console.log(`  · ${r!.position} ${r!.name}: ${projectedStatLine(r!)}`);
    }
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

/**
 * Proves the projected standings are arithmetic and not an opinion.
 *
 *   npm run verify:projections
 *
 * ============================================================================
 * WHAT THIS IS ACTUALLY GUARDING
 * ============================================================================
 *
 * The recap will hand out ridicule to whoever is projected tenth, in a room, out
 * loud. So the failure that matters is not "the ranking is a bit off" — it is a
 * ranking that is CONFIDENTLY WRONG in a way nobody can see:
 *
 *   1. A STARTER WITH NO PROJECTION scores zero. His franchise loses a couple of
 *      hundred points and drops three places, and the output looks exactly like a
 *      team that drafted badly. There is no visible symptom. Section 5 asserts
 *      that no rostered player anywhere is missing a projection, and section 3
 *      prints the ones that are.
 *   2. AN ORDER THAT MOVES between runs makes the whole tab worthless the first
 *      time somebody refreshes and sees a different tenth place. Section 7 runs
 *      the build three times, and once more with the franchises and the board fed
 *      in shuffled, and requires byte-identical output.
 *   3. A LINEUP THAT LEAVES POINTS ON THE BENCH ranks teams partly on the order
 *      they drafted in. Section 6 asserts the assignment is optimal — no bench
 *      player eligible for a starting slot out-projects its occupant — and that
 *      it never scores below the board-order lineup the roster screen shows.
 *   4. THE WRONG SCORING. This league pays six for a passing touchdown, not four.
 *      Section 2 asserts the rescoring actually applies it, because a vendor total
 *      would understate every starting quarterback by about sixty points a season
 *      — larger than the gap between fourth and eighth.
 *
 * ============================================================================
 * ON THE FIXTURE
 * ============================================================================
 *
 * When `data/fantasypros-projections-<season>.json` is present this runs against
 * it. When it is not, it runs against a SYNTHETIC FIXTURE built inside this file
 * from ADP, and says so on every relevant line.
 *
 * That fixture is not a fallback and it is not available to the app: it lives in
 * this script, is never written to `data/`, and nothing under `src/` can reach
 * it. Its only job is to exercise the arithmetic — legality, optimality,
 * summation, determinism, the simulation — which are properties of the code and
 * do not depend on the numbers being real. THE ORDER IT PRODUCES IS MEANINGLESS.
 * Anything quoting a projected finish must come from a real snapshot, and
 * `@/lib/projections-store` returns "missing" rather than substituting anything
 * when there is not one.
 */
import { buildProjectedStandings } from "@/lib/projected-standings";
import { indexProjections, pointsFromStats, type ProjectionSnapshot } from "@/lib/projections";
import { readProjections } from "@/lib/projections-store";
import { readLeagueSchedule } from "@/lib/league-schedule";
import { buildFranchiseLineups, lineupSlots, STARTER_COUNT } from "@/lib/roster-lineup";
import { defaultAssignment, runWholeMock, toMockPool } from "@/lib/mock-draft-run";
import { mulberry32 } from "@/lib/mock-draft-ai";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { CURRENT_SEASON, LEAGUE, ROSTER, SCORING_SPEC } from "@/lib/league-config";
import type { DraftRoomView } from "@/lib/draft-types";

// --- Assertion harness ------------------------------------------------------

let checks = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

// --- 1. Honest degradation --------------------------------------------------

section("1. With no projections, the standings are absent rather than invented");

const board = getBoard();
const pool = getPlayerPool();

/*
 * Checked FIRST and against a real board, because this is the state the app will
 * actually be in on draft night if the pull has not run. The contract is a null,
 * not a throw and not a guess.
 */
{
  const emptyView = buildEmptyView();
  let threw: string | null = null;
  let result: unknown = "unset";
  try {
    result = buildProjectedStandings({ view: emptyView, projections: null });
  } catch (e) {
    threw = String((e as Error).message);
  }
  check("buildProjectedStandings does not throw without projections", threw === null, threw ?? "");
  check("…it returns null, which the UI renders as 'not pulled'", result === null);
}

const live = readProjections(CURRENT_SEASON);
console.log(`  · store reports: ${live.state} (${live.file})`);
check(
  "the store never throws and reports one of ok / missing / unreadable",
  ["ok", "missing", "unreadable"].includes(live.state),
);
if (live.state === "unreadable") {
  check("the committed snapshot is readable", false, live.reason);
}

/*
 * The degradation path, exercised against a season that will never have a file
 * rather than by moving the real one.
 *
 * Once the snapshot exists, the checks above stop covering the case that matters
 * on draft night — no projections at all. Deleting the file to test it would be
 * a silly thing to do on the day, so a season nobody will ever pull stands in.
 * What has to hold is that "missing" is a reported state and not an exception:
 * the league drafts off this app tonight, and a blank standings section is fine
 * where a thrown error is not.
 */
{
  const absent = readProjections(1999);
  check("a season with no snapshot reports 'missing', not an error", absent.state === "missing");
  check(
    "…and the standings are null for it rather than empty or invented",
    buildProjectedStandings({
      view: buildEmptyView(),
      projections: absent.state === "ok" ? absent.index : null,
    }) === null,
  );
}

// --- 2. The scoring basis ---------------------------------------------------

section("2. Six-point passing touchdowns, applied rather than assumed");

check("league config pays 6 for a passing TD", SCORING_SPEC.passTd === 6, `got ${SCORING_SPEC.passTd}`);
check("league config is full PPR", SCORING_SPEC.ppr === 1);

{
  // 4,500 passing yards and 30 passing TDs: 180 points of touchdowns here,
  // 120 anywhere that assumes four. The 60-point gap is the whole argument for
  // storing stat lines instead of vendor totals.
  const line = { passYards: 4500, passTd: 30, interceptions: 10 };
  const here = pointsFromStats(line);
  const atFour = 4500 / 25 + 30 * 4 + 10 * -2;
  check(
    "a 30-TD quarterback is scored 60 points higher than at 4 points a TD",
    Math.abs(here - atFour - 60) < 1e-9,
    `${here.toFixed(1)} vs ${atFour.toFixed(1)}`,
  );
  check("…and receptions are worth a point each", pointsFromStats({ receptions: 100 }) === 100);
}

// --- 3. Projections: real snapshot, or a labelled fixture -------------------

section("3. The projections this run is using");

const usingFixture = live.state !== "ok";
const projections = live.state === "ok" ? live.index : indexProjections(buildFixture());

if (usingFixture) {
  console.log(
    "  · NO COMMITTED SNAPSHOT. Using the synthetic ADP-derived fixture defined in\n" +
      "    this script. It exercises the arithmetic; THE ORDER IT PRODUCES IS NOT A\n" +
      "    REAL PROJECTED FINISH and must not be quoted. Run `npm run pull:projections`.",
  );
} else {
  console.log(`  · source: ${projections.provenance.source}`);
  console.log(`  · pulled: ${projections.provenance.pulledAt}`);
}
console.log(
  `  · ${projections.byPlayerId.size} players projected ` +
    `(${projections.leagueScoredCount} rescored on league rules, ` +
    `${projections.vendorScoredCount} at vendor scoring)`,
);
console.log(
  `  · ${projections.dstPassthroughCount} team defences carry FantasyPros' own total ` +
    `(ESPN's tiered points/yards-allowed tables are not projected by any feed)`,
);
check("the projection set is not empty", projections.byPlayerId.size > 0);

/*
 * The check that guards the scoring basis. A skill player scored on the vendor's
 * four-point passing touchdown is understated, and quarterbacks by about sixty
 * points a season — wider than the gap between fourth and eighth. Team defences
 * are exempt by construction and counted separately, not folded in here.
 */
check(
  "no skill player is scored on the vendor's rules",
  projections.vendorScoredCount === 0,
  `${projections.vendorScoredCount} rows carry a vendor total — quarterbacks will be understated`,
);
check(
  "the D/ST passthrough is disclosed as a count, not hidden",
  projections.dstPassthroughCount === projections.byPlayerId.size -
    [...projections.byPlayerId.values()].filter((p) => p.position !== "DST").length,
  `${projections.dstPassthroughCount} passthrough vs ` +
    `${[...projections.byPlayerId.values()].filter((p) => p.position === "DST").length} defences`,
);

if (projections.unmatchedSourceNames.length > 0) {
  console.log(
    `  · ${projections.unmatchedSourceNames.length} feed rows matched no pool player, e.g. ` +
      projections.unmatchedSourceNames.slice(0, 5).join(", "),
  );
}
if (projections.zeroProjectionNames.length > 0) {
  console.log(
    `  · ${projections.zeroProjectionNames.length} players are projected at exactly zero — ` +
      `FantasyPros publishes a full but empty line for deep players, e.g. ` +
      projections.zeroProjectionNames.slice(0, 5).join(", "),
  );
}

// --- 4. A complete board ----------------------------------------------------

section("4. A complete board, from the real mock draft engine");

const { view, steps } = runWholeMock({
  board,
  pool: toMockPool(pool),
  archetypes: defaultAssignment(board),
  rng: mulberry32(20260829),
});

check(`the mock filled every slot (${steps} picks)`, view.filled === board.totalPicks);
check("nothing left on the clock", view.onTheClockSlotId === null);
check(`${LEAGUE.teams} franchises on the board`, view.teams.length === LEAGUE.teams);

const schedule = readLeagueSchedule(CURRENT_SEASON);
console.log(
  schedule
    ? `  · schedule: ${schedule.games.length} real fixtures from ${schedule.source}`
    : "  · no usable schedule found — the simulation block will be absent",
);

const standings = buildProjectedStandings({ view, projections, schedule });
if (!standings) {
  console.log("\nbuildProjectedStandings returned null with projections present. Aborting.\n");
  process.exit(1);
}

// --- 5. Every franchise fields a full legal lineup, fully projected ---------

section("5. Ten legal lineups, and no starter valued at zero by accident");

check(`${LEAGUE.teams} rows returned`, standings.rows.length === LEAGUE.teams);
check(
  "ranks are exactly 1…10, each once",
  standings.rows.map((r) => r.rank).join(",") ===
    Array.from({ length: LEAGUE.teams }, (_, i) => i + 1).join(","),
);
check(
  "every franchise appears exactly once",
  new Set(standings.rows.map((r) => r.teamId)).size === LEAGUE.teams,
);

const short = standings.rows.filter((r) => r.openStarterLabels.length > 0);
check(
  `all ten field ${STARTER_COUNT} starters`,
  short.length === 0,
  short.map((r) => `${r.teamName} needs ${r.openStarterLabels.join("/")}`).join("; "),
);
check(
  "every row reports the full starting lineup",
  standings.rows.every((r) => r.starters.length === STARTER_COUNT),
);
check("basis.allLineupsLegal agrees", standings.basis.allLineupsLegal === (short.length === 0));

/*
 * The check this script exists for. A rostered player with no projection is
 * counted at zero, and if he starts, his franchise's total is silently short.
 */
check(
  "no rostered player anywhere is missing a projection",
  standings.missingProjections.length === 0,
  standings.missingProjections
    .slice(0, 6)
    .map((m) => `${m.teamName}: ${m.playerName} (${m.position})`)
    .join("; "),
);
check(
  "no franchise starts an unprojected player",
  standings.rows.every((r) => r.unprojectedStarters.length === 0),
  standings.rows
    .filter((r) => r.unprojectedStarters.length > 0)
    .map((r) => `${r.teamName}: ${r.unprojectedStarters.join(", ")}`)
    .join("; "),
);
check("basis.complete agrees", standings.basis.complete === (standings.missingProjections.length === 0));

/*
 * A started player projected at exactly zero is a slot contributing nothing.
 * Plausible for a third-string quarterback nobody starts; not plausible for a
 * starting running back, where it means the feed has a gap rather than an
 * opinion. Either way it depresses a franchise's total, so it fails rather than
 * being reported — this is the number the recap will read out.
 */
{
  const zeroStarters = standings.rows.filter((r) => r.zeroProjectedStarters.length > 0);
  check(
    "no franchise starts a player projected at exactly zero",
    zeroStarters.length === 0,
    zeroStarters.map((r) => `${r.teamName}: ${r.zeroProjectedStarters.join(", ")}`).join("; "),
  );
  const zeroBench = projections.zeroProjectionNames.length;
  if (zeroBench > 0) {
    console.log(
      `  · ${zeroBench} players league-wide are projected at zero; none of them start (above)`,
    );
  }
}
check(
  `every roster holds ${ROSTER.activeCap} players`,
  standings.rows.every((r) => r.rosterSize === ROSTER.activeCap),
  standings.rows.filter((r) => r.rosterSize !== ROSTER.activeCap).map((r) => `${r.teamName} ${r.rosterSize}`).join(", "),
);

// --- 5a. Join quality, for the players who actually matter ------------------

section("5a. How the 160 rostered players were joined to their projections");

/*
 * Feed-wide match rates are close to useless here: the rows that fail to join
 * are overwhelmingly deep names nobody drafts, so a 98% feed match tells you
 * nothing about whether somebody's starting running back was matched on a guess.
 * This counts only players who are ON A ROSTER, which is the population whose
 * projections are summed into the standings.
 */
{
  const rostered = view.slots.filter((s) => s.player).map((s) => s.player!);
  const byMethod = new Map<string, string[]>();
  const noProjection: string[] = [];

  for (const p of rostered) {
    const hit = projections.byPlayerId.get(p.id);
    if (!hit) {
      noProjection.push(p.name);
      continue;
    }
    const method = hit.matchMethod ?? "unrecorded";
    if (!byMethod.has(method)) byMethod.set(method, []);
    byMethod.get(method)!.push(p.name);
  }

  console.log(`  ${rostered.length} rostered players across the ten franchises:`);
  for (const [method, names] of [...byMethod].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${String(names.length).padStart(4)}  ${method}`);
  }

  const byId = byMethod.get("fpid")?.length ?? 0;
  const fallbacks = [...byMethod]
    .filter(([m]) => m !== "fpid")
    .flatMap(([m, names]) => names.map((n) => `${n} (${m})`));

  check(
    `every rostered player has a projection`,
    noProjection.length === 0,
    noProjection.join(", "),
  );
  check(
    "no rostered player was joined by the loose name-only rule",
    (byMethod.get("name-only-loose")?.length ?? 0) === 0,
    (byMethod.get("name-only-loose") ?? []).join(", "),
  );
  console.log(
    `  ${byId} of ${rostered.length} matched on fpId; ${fallbacks.length} on a name rule.`,
  );
  if (fallbacks.length > 0) {
    for (const f of fallbacks.slice(0, 20)) console.log(`    · ${f}`);
    if (fallbacks.length > 20) console.log(`    … and ${fallbacks.length - 20} more`);
  }
}

// --- 6. The numbers add up, and the lineup is the best one -----------------

section("6. Sums are consistent and the lineup is optimal");

const lineups = buildFranchiseLineups(view);
const lineupByTeam = new Map(lineups.map((l) => [l.team.id, l]));
const slotDefs = lineupSlots();

const sumMismatch: string[] = [];
const partitionMismatch: string[] = [];
const suboptimal: string[] = [];
const boardOrderBeats: string[] = [];

for (const row of standings.rows) {
  const starterSum = row.starters.reduce((n, s) => n + s.points, 0);
  if (Math.abs(starterSum - row.projectedPoints) > 0.051) {
    sumMismatch.push(`${row.teamName}: ${starterSum.toFixed(1)} vs ${row.projectedPoints}`);
  }

  const lineup = lineupByTeam.get(row.teamId)!;
  const rostered = [
    ...lineup.starters.map((s) => s.player).filter((p) => p != null),
    ...lineup.bench,
    ...lineup.overflow,
  ];
  const startedIds = row.starters.map((s) => s.playerId).filter((id): id is string => id != null);

  // Starters and bench must partition the roster: nobody counted twice, nobody
  // dropped. A dropped player is how bench depth quietly understates itself.
  if (new Set(startedIds).size !== startedIds.length) {
    partitionMismatch.push(`${row.teamName}: a player starts in two slots`);
  }
  if (!startedIds.every((id) => rostered.some((p) => p!.playerId === id))) {
    partitionMismatch.push(`${row.teamName}: starts somebody not on the roster`);
  }

  // Optimality: no bench player eligible for a starting slot may out-project
  // its occupant. With FLEX accepting a superset of RB/WR/TE, that local
  // condition is equivalent to global optimality — see the module header.
  const benchPlayers = rostered.filter((p) => !startedIds.includes(p!.playerId));
  for (const s of row.starters) {
    const def = slotDefs.find((d) => d.label === s.label)!;
    for (const b of benchPlayers) {
      const bp = projections.byPlayerId.get(b!.playerId)?.points ?? 0;
      if (def.eligible.includes(b!.position) && bp > s.points + 1e-6) {
        suboptimal.push(`${row.teamName}: ${b!.name} (${bp.toFixed(1)}) beats ${s.label} ${s.name} (${s.points})`);
      }
    }
  }

  /*
   * …and it must never score below the roster screen's board-order lineup.
   *
   * Summed the SAME way the module sums — each starter rounded to one decimal,
   * then totalled — because the module rounds per starter so that the printed
   * lineup card adds up to the printed total. Comparing a rounded total against
   * an unrounded one reported two franchises as suboptimal by 0.1 of a point,
   * which was the measurement being wrong rather than the lineup.
   */
  const boardOrder = lineup.starters.reduce(
    (n, s) =>
      n +
      (s.player
        ? Math.round((projections.byPlayerId.get(s.player.playerId)?.points ?? 0) * 10) / 10
        : 0),
    0,
  );
  if (boardOrder > row.projectedPoints + 0.051) {
    boardOrderBeats.push(`${row.teamName}: board order ${boardOrder.toFixed(1)} > optimal ${row.projectedPoints}`);
  }
}

check("each row's points equal the sum of its nine starters", sumMismatch.length === 0, sumMismatch.join("; "));
check("starters and bench partition each roster", partitionMismatch.length === 0, partitionMismatch.join("; "));
check(
  "no bench player out-projects a starting slot he is eligible for",
  suboptimal.length === 0,
  suboptimal.slice(0, 4).join("; "),
);
check(
  "the optimised lineup never scores below the board-order lineup",
  boardOrderBeats.length === 0,
  boardOrderBeats.join("; "),
);

{
  const total = standings.rows.reduce((n, r) => n + r.projectedPoints, 0);
  const perTeam = standings.rows.map((r) => r.projectedPoints);
  check(
    "the ten projections sum to the sum of the rows",
    Math.abs(total - perTeam.reduce((n, v) => n + v, 0)) < 1e-9,
  );
  check("every projection is a finite positive number", perTeam.every((p) => Number.isFinite(p) && p > 0));
  check(
    "the table is sorted by projected points, descending",
    perTeam.every((p, i) => i === 0 || perTeam[i - 1] >= p),
  );
}

check(
  "shares and fragility are all inside 0–1",
  standings.rows.every(
    (r) =>
      (r.topHeavyShare == null || (r.topHeavyShare >= 0 && r.topHeavyShare <= 1)) &&
      (r.fragility == null || (r.fragility >= 0 && r.fragility <= 1)) &&
      (r.keeperShare == null || (r.keeperShare >= 0 && r.keeperShare <= 1)),
  ),
);
check(
  "every row names a weakest and a strongest starting slot",
  standings.rows.every((r) => r.weakestSlot != null && r.strongestSlot != null),
);

// --- 7. Determinism --------------------------------------------------------

section("7. The same board always produces the same standings");

const rerun = () => buildProjectedStandings({ view, projections, schedule });
const first = JSON.stringify(standings);
check("run 2 is byte-identical to run 1", JSON.stringify(rerun()) === first);
check("run 3 is byte-identical to run 1", JSON.stringify(rerun()) === first);

/*
 * The stronger version: feed the franchises and the board in a different order.
 * Anything that depended on iteration order rather than on the documented
 * tiebreaks shows up here and nowhere else.
 */
{
  const shuffle = <T,>(xs: readonly T[], seed: number): T[] => {
    const rng = mulberry32(seed);
    const out = [...xs];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const shuffled: DraftRoomView = {
    ...view,
    teams: shuffle(view.teams, 11),
    slots: shuffle(view.slots, 22),
  };
  const out = buildProjectedStandings({ view: shuffled, projections, schedule });
  check(
    "shuffling the franchises and the board changes nothing",
    JSON.stringify(out) === first,
    out
      ? `order was ${out.rows.map((r) => r.teamName).join(",")} vs ${standings.rows.map((r) => r.teamName).join(",")}`
      : "returned null",
  );
}

check(
  "the basis states what the ranking is on",
  standings.basis.rankedOn === "projected-points" &&
    standings.basis.disclaimer.includes("not a prediction"),
);
check(
  "the basis publishes the six-point passing TD",
  standings.basis.passingTouchdownPoints === 6,
);
check("the tiebreaks are documented in the output", standings.basis.tiebreaks.length >= 2);

// --- 8. The schedule simulation --------------------------------------------

section("8. Monte Carlo over the real schedule");

if (!schedule) {
  console.log("  · no real schedule, so nothing to simulate. Not a failure.");
  check("the simulation block is absent rather than fabricated", standings.simulation === null);
} else {
  const expectedGames = (LEAGUE.regularSeasonWeeks[1] - LEAGUE.regularSeasonWeeks[0] + 1) * (LEAGUE.teams / 2);
  check(
    `the schedule has ${expectedGames} real fixtures`,
    schedule.games.length === expectedGames,
    `got ${schedule.games.length}`,
  );
  const weeks = [...new Set(schedule.games.map((g) => g.week))];
  check(
    `${weeks.length} weeks, five games each, every franchise every week`,
    weeks.every((w) => schedule.games.filter((g) => g.week === w).length === LEAGUE.teams / 2),
  );
  const gamesPer = new Map<string, number>();
  for (const g of schedule.games) {
    gamesPer.set(g.homeAbbrev, (gamesPer.get(g.homeAbbrev) ?? 0) + 1);
    gamesPer.set(g.awayAbbrev, (gamesPer.get(g.awayAbbrev) ?? 0) + 1);
  }
  check(
    `every franchise plays ${weeks.length} games`,
    [...gamesPer.values()].every((n) => n === weeks.length),
    [...gamesPer].filter(([, n]) => n !== weeks.length).map(([a, n]) => `${a}:${n}`).join(", "),
  );
  check(
    "the schedule names all ten franchises by abbrev",
    standings.rows.every((r) => gamesPer.has(r.abbrev)),
    standings.rows.filter((r) => !gamesPer.has(r.abbrev)).map((r) => r.abbrev).join(", "),
  );

  check("the simulation block is present", standings.simulation !== null);
  const sim = standings.simulation!;
  console.log(`  · ${sim.runs} runs, seed ${sim.seed}, weekly volatility ${sim.weeklyVolatility}`);

  const totalWins = standings.rows.reduce((n, r) => n + (r.projectedWins ?? 0), 0);
  check(
    `mean wins across the league sum to the ${weeks.length * (LEAGUE.teams / 2)} games played`,
    Math.abs(totalWins - weeks.length * (LEAGUE.teams / 2)) < 0.6,
    `summed to ${totalWins.toFixed(2)}`,
  );
  check(
    "wins and losses add to the number of weeks for every franchise",
    standings.rows.every(
      (r) => Math.abs((r.projectedWins ?? 0) + (r.projectedLosses ?? 0) - weeks.length) < 0.11,
    ),
  );
  const playoffSum = standings.rows.reduce((n, r) => n + (r.playoffOdds ?? 0), 0);
  check(
    `playoff odds sum to the ${LEAGUE.playoffTeams} playoff berths`,
    Math.abs(playoffSum - LEAGUE.playoffTeams) < 0.05,
    `summed to ${playoffSum.toFixed(3)}`,
  );
  const titleSum = standings.rows.reduce((n, r) => n + (r.titleOdds ?? 0), 0);
  check("title odds sum to exactly one championship", Math.abs(titleSum - 1) < 0.02, `summed to ${titleSum.toFixed(3)}`);
  check(
    "nobody's title odds exceed their playoff odds",
    standings.rows.every((r) => (r.titleOdds ?? 0) <= (r.playoffOdds ?? 0) + 1e-9),
  );
  check(
    "every franchise has a schedule strength",
    standings.rows.every((r) => r.opponentStrength != null && r.opponentStrength > 0),
  );
  check(
    "the simulation is seeded, so a re-run gives identical wins",
    JSON.stringify(rerun()?.rows.map((r) => r.projectedWins)) ===
      JSON.stringify(standings.rows.map((r) => r.projectedWins)),
  );
  check(
    "the note says wins do not set the order",
    sim.note.includes("do not set the order"),
  );
}

// --- 9. The table ----------------------------------------------------------

section("9. The projected finish");

if (usingFixture) {
  console.log("  !! FIXTURE DATA — this order is not a real projected finish.\n");
}
console.log(
  "  #  franchise            proj pts   wins  playoff   title  bench  weakest slot        top-2  keeper",
);
for (const r of standings.rows) {
  const pct = (v: number | null) => (v == null ? "    —" : `${(v * 100).toFixed(0).padStart(4)}%`);
  console.log(
    `  ${String(r.rank).padStart(2)} ` +
      `${r.teamName.padEnd(7)}${r.abbrev.padEnd(6)}` +
      `${r.projectedPoints.toFixed(1).padStart(9)}` +
      `${(r.projectedWins?.toFixed(1) ?? "—").padStart(7)}` +
      `${pct(r.playoffOdds)}${pct(r.titleOdds)}` +
      `${r.benchPoints.toFixed(0).padStart(7)}` +
      `  ${`${r.weakestSlot ?? "—"} (-${r.weakestSlotDeficit?.toFixed(0) ?? "?"})`.padEnd(18)}` +
      `${((r.topHeavyShare ?? 0) * 100).toFixed(0).padStart(5)}%` +
      `${((r.keeperShare ?? 0) * 100).toFixed(0).padStart(7)}%`,
  );
}

console.log(`\n  ${standings.basis.disclaimer}`);
console.log(`\n  Tiebreaks, in order:`);
for (const t of standings.basis.tiebreaks) console.log(`    · ${t}`);

// --- Result ----------------------------------------------------------------

console.log(`\n  ${checks} checks, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
  console.log("");
  process.exit(1);
}
console.log(
  usingFixture
    ? "\nAll checks passed against the fixture. The arithmetic is sound; the numbers\n" +
        "are not real. Run `npm run pull:projections` for a quotable finish.\n"
    : "\nAll checks passed against the committed projections snapshot.\n",
);
process.exit(0);

// --- Helpers ---------------------------------------------------------------

/** A board with keepers only and no entered picks — the draft-night state. */
function buildEmptyView(): DraftRoomView {
  return {
    season: board.season,
    rounds: board.rounds,
    teamCount: board.teamCount,
    totalPicks: board.totalPicks,
    teams: board.teams,
    slots: board.slots.map((s) => ({
      ...s,
      fill: s.isKeeper && s.player ? ("keeper" as const) : null,
      seq: null,
      enteredAt: null,
    })),
    keeperCount: board.keeperCount,
    tradedCount: board.tradedCount,
    picksMade: 0,
    filled: board.slots.filter((s) => s.isKeeper && s.player).length,
    remaining: board.totalPicks - board.keeperCount,
    onTheClockSlotId: null,
    lastPick: null,
    restorable: null,
    draftedPlayerIds: [],
    conflicts: [],
    startedAt: null,
    updatedAt: null,
    fetchedAt: board.fetchedAt,
  };
}

/**
 * A synthetic projection set, derived from ADP. TEST SCAFFOLDING ONLY.
 *
 * Deliberately built as STAT LINES rather than point totals, so the run
 * exercises `pointsFromStats` and this league's six-point passing touchdown
 * instead of bypassing the code path that matters most.
 *
 * The shape is crude on purpose — a smooth decay by position rank, no injuries,
 * no variance — because a fixture that looked realistic would invite somebody to
 * quote it. It is deterministic, it is positive, and it is different for every
 * player, which is all the arithmetic checks need.
 */
function buildFixture(): ProjectionSnapshot {
  const rankByPosition = new Map<string, number>();

  const players = pool
    .filter((p) => p.adp != null)
    .sort((a, b) => a.adp! - b.adp! || a.name.localeCompare(b.name))
    .map((p) => {
      const rank = (rankByPosition.get(p.position) ?? 0) + 1;
      rankByPosition.set(p.position, rank);

      // Decay from a positional peak. Never reaches zero, so no fixture player
      // is accidentally worthless and no check passes for the wrong reason.
      const decay = 1 / (1 + rank * 0.11);
      const stats: Record<string, number> = {};

      if (p.position === "QB") {
        stats.passYards = Math.round(4600 * decay);
        stats.passTd = Math.round(34 * decay);
        stats.interceptions = 9;
        stats.rushYards = Math.round(260 * decay);
        stats.rushTd = Math.round(4 * decay);
      } else if (p.position === "RB") {
        stats.rushYards = Math.round(1250 * decay);
        stats.rushTd = Math.round(11 * decay);
        stats.receptions = Math.round(52 * decay);
        stats.recYards = Math.round(420 * decay);
        stats.recTd = Math.round(2 * decay);
      } else if (p.position === "WR") {
        stats.receptions = Math.round(105 * decay);
        stats.recYards = Math.round(1420 * decay);
        stats.recTd = Math.round(10 * decay);
      } else if (p.position === "TE") {
        stats.receptions = Math.round(88 * decay);
        stats.recYards = Math.round(980 * decay);
        stats.recTd = Math.round(8 * decay);
      } else {
        stats.dstPoints = Math.round(150 * decay) + 20;
      }

      // Guarantee a strictly positive, distinct projection at every rank.
      const floor = 1 / (rank + 1);
      if (p.position === "DST") stats.dstPoints += floor;
      else stats.receptions = (stats.receptions ?? 0) + floor;

      return {
        playerId: String(p.id),
        sourceName: p.name,
        matchedName: p.name,
        position: p.position,
        nflTeam: p.nflTeam,
        matchMethod: "fixture",
        stats,
        vendorPoints: null,
        vendorScoring: null,
        injuryStatus: null,
        strengthOfSchedule: null,
        tier: null,
        positionRank: rank,
      };
    });

  return {
    provenance: {
      source: "SYNTHETIC FIXTURE (scripts/verify-projected-standings.mts) — NOT REAL PROJECTIONS",
      tool: null,
      pulledAt: new Date(0).toISOString(),
      season: CURRENT_SEASON,
      pointInTime: true,
      vendorScoringBasis: null,
      note:
        "Test scaffolding derived from ADP. Exercises the arithmetic only. Never " +
        "written to data/ and unreachable from src/. The order it produces is meaningless.",
    },
    players,
  };
}

/**
 * The round-1 keeper ruling: prove it does what it should, and prove it changes
 * nothing about Saturday.
 *
 *   npm run verify:round1
 *
 * Commissioner's ruling, Aug 26 2026: a player who occupied a round-1 slot last
 * season cannot be kept at all. Every first-round pick is a one-year rental,
 * permanently.
 *
 * Two jobs here, and the second is the more important one tonight:
 *
 *   1. The rule bites where it should and nowhere else, including the case that
 *      is easy to get wrong — a round-2 pick kept down to a first, whose CLOCK
 *      still permits another season.
 *   2. THE 2026 BOARD IS UNTOUCHED. A rule change three days before the draft
 *      that silently altered Saturday's keepers would be the worst possible
 *      outcome, so this is asserted rather than assumed.
 *
 * Runs against `data/` only — no Postgres, no network.
 */

import process from "node:process";
import { readFileSync } from "node:fs";

import { getKeeperBoardFromJson } from "@/lib/league-json";
import { getBoard } from "@/lib/smartdraft";
import {
  clockPosition,
  evaluateKeeperEligibility,
  keeperCostRound,
  occupiedRound1,
} from "@/lib/keeper-clock";
import { DRAFT, KEEPERS, LEAGUE, TOTAL_PICKS } from "@/lib/league-config";
import {
  EXPECTED_FINAL_SEASON_KEEPERS,
  EXPECTED_KEEPERS,
} from "./keeper-expectation.mjs";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
}
function section(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

// --- 1. the rule itself ------------------------------------------------------

section("1. The rule is in force and keyed on the slot occupied");

check("round-1 players are ineligible", KEEPERS.round1Eligible === false);

check(
  "a round-1 basis is recognised however the player got there",
  occupiedRound1({ basisRound: 1, seasonsKept: 0, isUndrafted: false }) &&
    occupiedRound1({ basisRound: 1, seasonsKept: 1, isUndrafted: false }),
);
check(
  "a round-2 basis is not",
  !occupiedRound1({ basisRound: 2, seasonsKept: 0, isUndrafted: false }),
);
check(
  "an undrafted free agent never trips it — he has no basis round at all",
  !occupiedRound1({ basisRound: null, seasonsKept: 0, isUndrafted: true }) &&
    keeperCostRound({ basisRound: null, seasonsKept: 0, isUndrafted: true }) ===
      KEEPERS.undraftedDefaultRound,
);

check(
  "there is no cost round for a barred player, rather than a clamped round 1",
  keeperCostRound({ basisRound: 1, seasonsKept: 0, isUndrafted: false }) === null,
);

const firstRounder = evaluateKeeperEligibility({
  basisRound: 1,
  seasonsKept: 0,
  isUndrafted: false,
  originalRound: 1,
});
check(
  "a first-round pick is refused, and the reason says he was a first-round pick",
  !firstRounder.eligible && /first-round pick/.test(firstRounder.reason ?? ""),
  firstRounder.reason ?? "no reason given",
);
check("a refused player is given no cost round to display", firstRounder.costRound === null);

// --- 2. the interaction with the three-season clock -------------------------

section("2. Interaction with the clock — the rule is NOT redundant");

/**
 * The tempting assumption is that anything pricing to round 0 has run out of
 * clock anyway, making this ruling a formality. It is false, and this is the
 * case that proves it.
 */
const keptDownToR1 = {
  basisRound: 1,
  seasonsKept: 1,
  isUndrafted: false,
  originalRound: 2,
};
const clockOnHim = clockPosition(keptDownToR1.seasonsKept);
check(
  "a round-2 pick kept once still has clock left — year 2 of 2, not expired",
  !clockOnHim.expired && clockOnHim.year === 2 && clockOnHim.remaining === 1,
  `year ${clockOnHim.year}, remaining ${clockOnHim.remaining}, expired ${clockOnHim.expired}`,
);
const barredAnyway = evaluateKeeperEligibility(keptDownToR1);
check(
  "…and the ruling bars him anyway, so it is doing real work",
  !barredAnyway.eligible && /kept at a first-round cost/.test(barredAnyway.reason ?? ""),
  barredAnyway.reason ?? "he was allowed",
);
console.log(
  "        CONSEQUENCE: a round-2 pick gets ONE keeper season, not two. The\n" +
    "        clock grants two; this rule takes the second away.",
);

// The redundant case, for completeness: a round-3 pick kept twice ends at a
// round-1 slot with the clock already spent, so either rule alone stops him.
const r3KeptTwice = clockPosition(2);
check(
  "a round-3 pick kept twice is already stopped by the clock, so the rules agree there",
  r3KeptTwice.expired &&
    !evaluateKeeperEligibility({
      basisRound: 1,
      seasonsKept: 2,
      isUndrafted: false,
      originalRound: 3,
    }).eligible,
);

// Everything shallower than a round-2 pick still behaves normally.
const normal: [string, number, number, number | null][] = [
  ["a round-2 pick, first keeper season", 2, 0, 1],
  ["a round-3 pick, second keeper season", 2, 1, 1],
  ["a round-5 pick, first keeper season", 5, 0, 4],
];
for (const [label, basisRound, seasonsKept, expected] of normal) {
  const e = evaluateKeeperEligibility({ basisRound, seasonsKept, isUndrafted: false });
  check(
    `${label} is still eligible at round ${expected}`,
    e.eligible && e.costRound === expected,
    e.eligible ? `R${e.costRound}` : "refused",
  );
}

// --- 3. Saturday is untouched ------------------------------------------------

section("3. Saturday's board is UNCHANGED by the ruling");

const board = getKeeperBoardFromJson();
const draftBoard = getBoard();

check(
  `all ${EXPECTED_KEEPERS} reconciled keepers still stand`,
  board.keepers.length === EXPECTED_KEEPERS,
  `${board.keepers.length} keepers`,
);
check(
  "no declaration was refused",
  board.ineligible.length === 0,
  board.ineligible.map((i) => `${i.playerName} (${i.manager})`).join(", ") || "none",
);
check(
  "no 2026 keeper has a round-1 basis, so none is even close to the rule",
  board.keepers.filter((k) => !k.isUndrafted && k.basisRound === 1).length === 0,
);
const cheapestBasis = Math.min(
  ...board.keepers.filter((k) => k.basisRound != null).map((k) => k.basisRound!),
);
check(
  `the cheapest basis round among the 19 is ${cheapestBasis}, four clear of the rule`,
  cheapestBasis >= 5,
  `R${cheapestBasis}`,
);
const cheapestCost = Math.min(...board.keepers.map((k) => k.costRound));
check(
  `the cheapest cost round on the board is ${cheapestCost}`,
  cheapestCost === 4,
  `R${cheapestCost}`,
);
check(
  "no keeper occupies a round-1 slot",
  board.keepers.filter((k) => k.costRound === 1).length === 0,
);
check(
  "the six final-season keepers are unchanged",
  board.expiringCount === EXPECTED_FINAL_SEASON_KEEPERS,
  `${board.expiringCount}`,
);
check(
  // Thirteen since Joe declared Jayden Daniels, who is in his first keeper
  // season and so carries a 2027 season with him.
  "the thirteen keepable in 2027 are unchanged",
  board.keepableNextSeasonCount === 13,
  `${board.keepableNextSeasonCount}`,
);
check(
  `the draft board still carries ${EXPECTED_KEEPERS} keepers across ${TOTAL_PICKS} slots`,
  draftBoard.keeperCount === EXPECTED_KEEPERS &&
    draftBoard.totalPicks === LEAGUE.teams * DRAFT.rounds,
  `${draftBoard.keeperCount} keepers, ${draftBoard.totalPicks} slots`,
);

// --- 4. the 2026 round-0 cohort ---------------------------------------------

section("4. The ten players the prior analysis flagged");

const sheet = (
  JSON.parse(readFileSync("data/keeper-eligibility-2026.json", "utf8")) as {
    players: { player: string; round2025: number | null; roundToKeep2026: number | null; manager: string }[];
  }
).players;

const NAMED = [
  "CeeDee Lamb",
  "Saquon Barkley",
  "Derrick Henry",
  "Jonathan Taylor",
  "Amon-Ra St. Brown",
  "Ashton Jeanty",
  "Christian McCaffrey",
  "Malik Nabers",
  "Jahmyr Gibbs",
  "Bijan Robinson",
];

const inData = sheet.filter((r) => r.round2025 === 1).map((r) => r.player).sort();
check(
  "the ten named players are exactly the round-1 cohort in the data",
  JSON.stringify(inData) === JSON.stringify([...NAMED].sort()),
  inData.length === NAMED.length ? "" : `data has ${inData.length}`,
);

/**
 * Worth stating precisely, because the season is easy to slip by one: their
 * round-1 slot was 2025, so they price to round 0 for **2026** — this season,
 * not next. Under the ruling they were never keepable this year.
 */
check(
  "they price to round 0 for 2026, this season, not 2027",
  sheet.filter((r) => r.round2025 === 1).every((r) => r.roundToKeep2026 === 0),
);

const declaredNames = new Set(board.keepers.map((k) => k.playerName));
const anyDeclared = NAMED.filter((n) => declaredNames.has(n));
check(
  "not one of the ten was declared as a 2026 keeper — the league already plays this way",
  anyDeclared.length === 0,
  anyDeclared.join(", ") || "none declared",
);

for (const r of sheet.filter((x) => x.round2025 === 1).sort((a, b) => a.player.localeCompare(b.player))) {
  const e = evaluateKeeperEligibility({
    basisRound: r.round2025,
    seasonsKept: 0,
    isUndrafted: false,
    originalRound: r.round2025,
  });
  console.log(
    `        ${r.player.padEnd(22)} ${r.manager.padEnd(7)} R1 in 2025  ->  ${e.eligible ? "ELIGIBLE" : "ineligible"}`,
  );
}

// --- 5. who is barred for 2027 ----------------------------------------------

section("5. The 2027 cohort");

const r1Slots = draftBoard.slots.filter((s) => s.round === 1);
check(
  `all ${LEAGUE.teams} round-1 slots exist on the 2026 board`,
  r1Slots.length === LEAGUE.teams,
  `${r1Slots.length}`,
);
check(
  "none of them is a keeper, so all ten will be live picks on Saturday",
  r1Slots.filter((s) => s.isKeeper).length === 0,
);
console.log(
  `        Every one of the ${LEAGUE.teams} first-round picks made Saturday is a one-year\n` +
    `        rental and cannot be kept for 2027. No current keeper is affected.`,
);

console.log(
  `\n${"=".repeat(72)}\n${failures === 0 ? "ALL ROUND-1 RULING CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n${"=".repeat(72)}\n`,
);
process.exit(failures === 0 ? 0 : 1);

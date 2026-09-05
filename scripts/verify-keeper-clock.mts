/**
 * Checks `@/lib/keeper-clock` against the league's real 2026 keepers.
 *
 *   npm run verify:keepers
 *
 * The keeper rules are only worth anything if the module reproduces the board the
 * league is actually drafting off, so this runs the real cost function over every
 * keeper in the live Smart Draft room and asserts it lands on the round the room
 * has him at. It also pins down the off-by-one that the two counting conventions
 * invite: the sheets number a player's TENURE from the season he was acquired,
 * while the module counts KEEPER SEASONS SERVED. Read a sheet's `3 of 3` straight
 * into `seasonsKept` and this year's five final-season keepers come out expired.
 *
 * Inputs:
 *   data/smartdraft-room-snapshot.json  — what the room will draft off (authority
 *                                         on owner and cost round)
 *   data/keeper-eligibility-2026.json   — `KEEPER LIST for 2026` (authority on
 *                                         last season's round and the clock)
 *
 * Exits non-zero on any mismatch. Nothing here adjusts an expectation to fit.
 */
import { readFileSync } from "node:fs";

import {
  SHEET_TENURE_TERM,
  clockPosition,
  keeperCostRound,
  seasonsKeptAfterSheetSeason,
  seasonsKeptEnteringSheetSeason,
  sheetTenureYearEnteringSeason,
} from "@/lib/keeper-clock";
import { KEEPERS } from "@/lib/league-config";

// --- Facts from data/DECISIONS.md -------------------------------------------

/**
 * The only 2026 keeper acquired as a free agent, so the only one priced by the
 * flat 9th-round rule rather than by decrementing last season's round. The sheet
 * cannot tell us this: it writes the literal number 9 in the round column for
 * both real round-9 picks and free-agent pickups, and 75 of its 80 nines are
 * placeholders. De'Von Achane and Trey McBride also sit at 9 and are genuinely
 * round-9, which is why the room has them at R8 and Loveland at R9.
 */
const FREE_AGENT_ACQUISITIONS = new Set(["colston loveland"]);

/** Kept in 2026 and out of keeper years afterwards — the sheets' `3 of 3`. */
const EXPECTED_FINAL_SEASON = [
  "Garrett Wilson",
  "Jaxon Smith-Njigba",
  "Brock Bowers",
  "Chase Brown",
  "Trey McBride",
];

/**
 * Nacua's clock is the one the sheet cannot answer: it has him on Greg, the room
 * has him on Scott, and the commissioner ruled he is Scott's with the trade
 * restarting his clock. So his clock comes from the ruling, not the sheet.
 */
const TRADE_RESET_KEEPERS: Record<string, { team: string; seasonsKept: number; why: string }> = {
  "puka nacua": {
    team: "Scott",
    seasonsKept: 0,
    why: "traded to Scott, which restarts keeper eligibility (contract recital 5)",
  },
};

// --- Data -------------------------------------------------------------------

const dataUrl = (f: string) => new URL(`../data/${f}`, import.meta.url);
const read = (f: string) => JSON.parse(readFileSync(dataUrl(f), "utf8"));

const normalise = (s: string) =>
  s.toLowerCase().replace(/\b(jr|sr|ii|iii)\b/g, "").replace(/[^a-z]/g, "");

type RoomKeeper = { player: string; team: string; costRound: number; slot: string };

function roomKeepers(): RoomKeeper[] {
  const state = read("smartdraft-room-snapshot.json").state;
  const teams = new Map<string, string>(
    state.teams.filter((t: { deletedAt: string | null }) => !t.deletedAt).map((t: { id: string; name: string }) => [t.id, t.name]),
  );
  return state.slots
    .filter((s: { pickType: string | null }) => s.pickType === "KEEPER")
    .map((s: Record<string, never> & { player: { name: string }; currentOwnerTeamId: string; displayRound: number; pickInRound: number; overallPick: number }) => ({
      player: s.player.name,
      team: teams.get(s.currentOwnerTeamId) ?? "?",
      costRound: s.displayRound,
      slot: `${s.displayRound}.${String(s.pickInRound).padStart(2, "0")}`,
      overall: s.overallPick,
    }))
    .sort((a: { overall: number }, b: { overall: number }) => a.overall - b.overall);
}

type SheetRow = {
  player: string;
  manager: string;
  round2025: number;
  status2026: string;
  eligible2026: boolean;
  clockYearIfKept2026: number | null;
};

const sheetByName = new Map<string, SheetRow>(
  read("keeper-eligibility-2026.json").players.map((p: SheetRow) => [normalise(p.player), p]),
);

// --- Checks -----------------------------------------------------------------

const failures: string[] = [];
const fail = (msg: string) => failures.push(msg);

function checkConventionMapping() {
  console.log("--- COUNTING CONVENTION ---");
  console.log(`keeper term: ${KEEPERS.maxConsecutiveSeasons} keeper seasons, written "N of ${SHEET_TENURE_TERM}" on the sheets`);
  if (SHEET_TENURE_TERM !== 3) {
    fail(`Sheet tenure term should be 3 to match the keeper sheets; got ${SHEET_TENURE_TERM}.`);
  }
  // The mapping the commissioner spelled out, which reads the tenure year of the
  // season the player has just FINISHED: 1 of 3 -> 0, 2 of 3 -> 1, 3 of 3 -> 2.
  console.log("\nfrom the season just FINISHED (e.g. status2025 when pricing 2026):");
  for (const [tenureYear, want] of [[1, 0], [2, 1], [3, 2]] as [number, number][]) {
    const got = seasonsKeptAfterSheetSeason(tenureYear);
    const label = `  "${tenureYear} of ${SHEET_TENURE_TERM}"`;
    if (got !== want) fail(`${label} finished should map to seasonsKept ${want}; got ${got}.`);
    console.log(`${label} -> seasonsKept ${got} -> ${describe(got)}`);
  }

  // The same relation read off the column for the season being ENTERED, which is
  // one higher, hence one less subtraction.
  console.log("from the season being ENTERED (e.g. status2026 when pricing 2026):");
  for (const [tenureYear, want] of [[2, 0], [3, 1]] as [number, number][]) {
    const got = seasonsKeptEnteringSheetSeason(tenureYear);
    const label = `  "${tenureYear} of ${SHEET_TENURE_TERM}"`;
    if (got !== want) fail(`${label} entered should map to seasonsKept ${want}; got ${got}.`);
    console.log(`${label} -> seasonsKept ${got} -> ${describe(got)}`);
  }

  // The two columns describe the same player one season apart, so reading either
  // must land on the same clock. This is the off-by-one, asserted.
  for (const finished of [1, 2]) {
    const viaFinished = seasonsKeptAfterSheetSeason(finished);
    const viaEntered = seasonsKeptEnteringSheetSeason(finished + 1);
    if (viaFinished !== viaEntered) {
      fail(
        `Sheet "${finished} of 3" finished and "${finished + 1} of 3" entered describe the same ` +
          `season but map to seasonsKept ${viaFinished} and ${viaEntered}.`,
      );
    }
  }

  // A player whose LAST season was 3 of 3 has served both keeper seasons.
  if (!clockPosition(seasonsKeptAfterSheetSeason(3)).expired) {
    fail(`A player who finished "3 of ${SHEET_TENURE_TERM}" should be expired.`);
  }
  if (!clockPosition(KEEPERS.maxConsecutiveSeasons).expired) {
    fail(`seasonsKept ${KEEPERS.maxConsecutiveSeasons} should be expired.`);
  }
  if (sheetTenureYearEnteringSeason(1) !== 3) fail("seasonsKept 1 should round-trip to sheet year 3.");
}

function describe(seasonsKept: number): string {
  const c = clockPosition(seasonsKept);
  if (c.expired) return "expired";
  return `keeper year ${c.year} of ${KEEPERS.maxConsecutiveSeasons}${c.isFinalSeason ? " (final)" : ""}`;
}

function checkKeepers() {
  const keepers = roomKeepers();
  console.log(`\n--- COST ROUNDS (${keepers.length} keepers in the live room) ---`);

  const finalSeason: string[] = [];
  const keepableIn2027: string[] = [];

  for (const k of keepers) {
    const sheet = sheetByName.get(normalise(k.player));
    if (!sheet) {
      fail(`${k.player} (${k.team}) is not on the 2026 keeper-eligibility sheet.`);
      continue;
    }

    const override = TRADE_RESET_KEEPERS[k.player.toLowerCase()];
    const isUndrafted = FREE_AGENT_ACQUISITIONS.has(k.player.toLowerCase());
    // `clockYearIfKept2026` is the tenure year of the season being ENTERED.
    const seasonsKept =
      override?.team === k.team
        ? override.seasonsKept
        : seasonsKeptEnteringSheetSeason(sheet.clockYearIfKept2026 ?? NaN);

    if (!Number.isFinite(seasonsKept)) {
      fail(`${k.player} (${k.team}) has no clock year on the sheet and no ruling to fall back on.`);
      continue;
    }

    const computed = keeperCostRound({
      // Last season's round. The sheet's number 9 doubles as the free-agent
      // placeholder, which is why `isUndrafted` is supplied separately.
      basisRound: isUndrafted ? null : sheet.round2025,
      seasonsKept,
      isUndrafted,
    });

    const clock = clockPosition(seasonsKept);
    const ok = computed === k.costRound;
    if (!ok) {
      fail(
        `${k.player} (${k.team}): module says R${computed}, the room has him at R${k.costRound} ` +
          `(last season R${sheet.round2025}, seasonsKept ${seasonsKept}, undrafted ${isUndrafted}).`,
      );
    }

    console.log(
      `${ok ? "ok  " : "FAIL"} ${k.player.padEnd(20)} ${k.team.padEnd(7)} ` +
        `prior R${String(sheet.round2025).padEnd(2)} -> R${String(computed).padEnd(2)} ` +
        `room R${String(k.costRound).padEnd(2)} slot ${k.slot.padEnd(5)} ${describe(seasonsKept)}` +
        (isUndrafted ? "  [free agent]" : "") +
        (override?.team === k.team ? `  [clock from ruling: ${override.why}]` : ""),
    );

    if (clock.isFinalSeason) finalSeason.push(k.player);
    else keepableIn2027.push(k.player);
  }

  return { finalSeason, keepableIn2027, total: keepers.length };
}

function checkFinalSeasons(finalSeason: string[], keepableIn2027: string[]) {
  console.log("\n--- FINAL KEEPER SEASON (expires after 2026) ---");
  const got = new Set(finalSeason.map(normalise));
  const want = new Set(EXPECTED_FINAL_SEASON.map(normalise));

  for (const name of EXPECTED_FINAL_SEASON) {
    const ok = got.has(normalise(name));
    if (!ok) fail(`${name} should be in his final keeper season but the module does not say so.`);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  }
  for (const name of finalSeason) {
    if (!want.has(normalise(name))) {
      fail(`${name} is marked final-season but is not one of the five expected.`);
      console.log(`FAIL ${name} — unexpected final season`);
    }
  }
  if (finalSeason.length !== EXPECTED_FINAL_SEASON.length) {
    fail(`Expected exactly ${EXPECTED_FINAL_SEASON.length} final-season keepers; got ${finalSeason.length}.`);
  }

  console.log(`\n--- KEEPABLE AGAIN IN 2027 (${keepableIn2027.length}) ---`);
  for (const name of keepableIn2027) {
    const seasonsKeptNext = 1;
    const ok = !clockPosition(seasonsKeptNext).expired;
    if (!ok) fail(`${name} should still be keepable in 2027.`);
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  }
}

// --- Run --------------------------------------------------------------------

checkConventionMapping();
const { finalSeason, keepableIn2027, total } = checkKeepers();
checkFinalSeasons(finalSeason, keepableIn2027);

console.log("\n--- RESULT ---");
console.log(`${total} keepers checked · ${finalSeason.length} final season · ${keepableIn2027.length} keepable in 2027`);
if (failures.length) {
  console.error(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("All checks passed.");

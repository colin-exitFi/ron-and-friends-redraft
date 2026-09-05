/**
 * TENURE AUDIT — does the app agree with the commissioner's three-season rule?
 *
 * The commissioner stated the rule, Aug 26 2026:
 *
 *   "It's a three-year clock, not a two-year clock. You get the player in year
 *    one, and then you can keep them for two years following."
 *
 *   "Trades, in-season drafted players, or free agent pickups count as one year
 *    and can be kept for two subsequent years after that season."
 *
 * And then the case that may be more than wording:
 *
 *   "If I trade somebody pre-draft, which we do in offseason trades, then I get
 *    them that year, and then I can keep them for two years later."
 *
 * So there are two shapes of acquisition and they are NOT symmetric:
 *
 *   IN-SEASON acquisition (draft pick, in-season trade, FA pickup)
 *     The acquisition season is played with the player on the roster but NOT in
 *     a keeper slot. Keeper slots consumed: 2 (the two seasons after).
 *
 *   PRE-DRAFT / OFFSEASON acquisition
 *     There is no season in which the player sat on the new roster outside a
 *     keeper slot. The acquisition season IS a keeper slot — "you technically
 *     use them as a keeper" — and two further keeper seasons follow. Keeper
 *     slots consumed: 3.
 *
 * Both are three seasons of TENURE. They differ in how many of those seasons
 * cost a keeper slot. This script asks whether the code models that.
 *
 * Reads files only — no database, no network.
 */

import process from "node:process";

import { getKeeperBoardFromJson } from "@/lib/league-json";
import { clockPosition, CLOCK_RULES, SHEET_TENURE_TERM } from "@/lib/keeper-clock";
import { LEAGUE } from "@/lib/league-config";
import eligibility from "../data/keeper-eligibility-2026.json" with { type: "json" };
import tradeLog from "../data/trade-log-2026-spreadsheet.json" with { type: "json" };

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const SEASON = LEAGUE.currentSeason;

type EligRow = {
  player: string;
  manager: string;
  round2025: number | string | null;
  status2025: string | null;
  status2026: string | null;
  status2027: string | null;
  roundToKeep2026: number | string | null;
  tradeFlag: string | null;
};

const eligByPlayer = new Map<string, EligRow[]>();
for (const raw of (eligibility as { players: EligRow[] }).players) {
  const list = eligByPlayer.get(raw.player) ?? [];
  list.push(raw);
  eligByPlayer.set(raw.player, list);
}

/*
 * Only the fields this audit reads; the spreadsheet export carries more. The
 * player entries are plain names today, and the object shape is kept because a
 * re-export that carries positions alongside them should widen this type
 * rather than start throwing at `p.name`.
 */
type TradeSide = {
  member: string;
  playersReceived?: (string | { name?: string; player?: string })[];
};
type TradeLogEntry = { tradeNumber: number; sideA: TradeSide; sideB: TradeSide };

/** Which keepers the trade log says changed hands, and in which trade. */
const tradedPlayers = new Map<string, string[]>();
const trades: TradeLogEntry[] = tradeLog.trades;
for (const t of trades) {
  for (const side of [t.sideA, t.sideB]) {
    for (const p of side.playersReceived ?? []) {
      const name = typeof p === "string" ? p : p.name ?? p.player ?? String(p);
      const list = tradedPlayers.get(name) ?? [];
      list.push(`#${t.tradeNumber} → ${side.member}`);
      tradedPlayers.set(name, list);
    }
  }
}

const board = getKeeperBoardFromJson();

console.log(`\n${"=".repeat(78)}`);
console.log(`TENURE AUDIT — ${board.keepers.length} keepers for ${SEASON}`);
console.log(`${"=".repeat(78)}`);
console.log(`\nThe code's current constants:`);
console.log(`  CLOCK_RULES.maxConsecutiveSeasons  ${CLOCK_RULES.maxConsecutiveSeasons}   (keeper seasons)`);
console.log(`  SHEET_TENURE_TERM                  ${SHEET_TENURE_TERM}   (total seasons of tenure)`);
console.log(`  tradeResetsClock                   ${CLOCK_RULES.tradeResetsClock}`);
console.log(
  `\nSo the code already models three seasons of TENURE = 1 acquisition + 2 keeper.\n` +
    `That matches the commissioner exactly for an IN-SEASON acquisition.\n` +
    `The question is the PRE-DRAFT case.\n`,
);

// ---------------------------------------------------------------------------
console.log(`${"-".repeat(78)}`);
console.log(`Every keeper: what the app says today`);
console.log(`${"-".repeat(78)}\n`);
console.log(
  `  ${"player".padEnd(22)}${"fr".padEnd(7)}${"cost".padEnd(6)}${"basis".padEnd(7)}` +
    `${"sheet26".padEnd(9)}${"kept".padEnd(6)}${"app says".padEnd(30)}trade?`,
);

type Row = {
  name: string;
  fr: string;
  cost: number | null;
  basis: number | null;
  sheet26: string;
  seasonsKept: number;
  clockLabel: string;
  finalSeason: boolean;
  appFinalSeasonYear: number;
  traded: string[];
  tradeFlag: string | null;
  clockResetByTrade: boolean;
  keepableIn2027: boolean;
};
const rows: Row[] = [];

for (const k of board.keepers) {
  const elig = (eligByPlayer.get(k.playerName) ?? []).find(
    (r) => r.manager === k.teamShortName,
  );
  const traded = tradedPlayers.get(k.playerName) ?? [];
  // The app's view: remaining keeper seasons from this one onward.
  const pos = clockPosition(k.seasonsKept);
  const appFinalSeasonYear = SEASON + pos.remaining - 1;
  const row: Row = {
    name: k.playerName,
    fr: k.teamShortName,
    cost: k.costRound,
    basis: k.basisRound,
    sheet26: elig?.status2026 ?? "—",
    seasonsKept: k.seasonsKept,
    clockLabel: k.clockLabel,
    finalSeason: k.finalSeason,
    appFinalSeasonYear,
    traded,
    tradeFlag: elig?.tradeFlag ?? null,
    clockResetByTrade: k.clockResetByTrade,
    keepableIn2027: k.keepableIn2027,
  };
  rows.push(row);
  console.log(
    `  ${row.name.padEnd(22)}${row.fr.padEnd(7)}` +
      `${(row.cost == null ? "—" : "R" + row.cost).padEnd(6)}` +
      `${(row.basis == null ? "FA" : "R" + row.basis).padEnd(7)}` +
      `${row.sheet26.padEnd(9)}${String(row.seasonsKept).padEnd(6)}` +
      `${row.clockLabel.padEnd(30)}${traded.length ? traded.join(", ") : row.tradeFlag ?? ""}`,
  );
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Can the app state a player's ACQUISITION SEASON? That is the fact the
// commissioner wants on screen, and it is derivable from the sheet's "N of 3":
// tenure year 2 in 2026 means acquired in 2025.
// ---------------------------------------------------------------------------
console.log(`\n${"-".repeat(78)}`);
console.log(`Acquisition season — is it derivable for all 18?`);
console.log(`${"-".repeat(78)}\n`);
let missingTenure = 0;
for (const k of board.keepers) {
  const t = k.sheetTenureYear;
  const acquired = t == null ? null : SEASON - (t - 1);
  if (t == null) missingTenure += 1;
  const finalUnderCurrentModel = SEASON + clockPosition(k.seasonsKept).remaining - 1;
  console.log(
    `  ${k.playerName.padEnd(22)}${k.teamShortName.padEnd(7)}` +
      `sheet ${t == null ? "null" : `${t} of 3`}`.padEnd(14) +
      `acquired ${acquired ?? "UNKNOWN"}`.padEnd(20) +
      `final ${finalUnderCurrentModel}` +
      `${acquired != null && acquired + SHEET_TENURE_TERM - 1 !== finalUnderCurrentModel ? "   <-- tenure and clock DISAGREE" : ""}`,
  );
}
console.log(
  `\n  keepers with no sheet tenure year: ${missingTenure}` +
    `${missingTenure ? " — acquisition season cannot be printed for these" : " — all 18 derivable"}`,
);

console.log(`\n${"-".repeat(78)}`);
console.log(`Final-season keepers per the app`);
console.log(`${"-".repeat(78)}\n`);
const finals = rows.filter((r) => r.finalSeason);
for (const r of finals) {
  console.log(
    `  ${r.name.padEnd(22)}${r.fr.padEnd(7)} released after ${r.appFinalSeasonYear}` +
      `${r.traded.length ? `   ACQUIRED BY TRADE: ${r.traded.join(", ")}` : ""}`,
  );
}
console.log(`\n  ${finals.length} final-season keeper(s).`);

// ---------------------------------------------------------------------------
// The pre-draft question. A keeper acquired in an OFFSEASON trade has no season
// on the new roster outside a keeper slot, so under the commissioner's rule the
// acquisition season must not count against the two keeper seasons.
// ---------------------------------------------------------------------------
console.log(`\n${"-".repeat(78)}`);
console.log(`The pre-draft / offseason acquisitions — where the rule may differ`);
console.log(`${"-".repeat(78)}\n`);

const acquiredByTrade = rows.filter(
  (r) => r.traded.length > 0 || r.tradeFlag || r.clockResetByTrade,
);
if (acquiredByTrade.length === 0) {
  console.log(`  none of the ${rows.length} keepers is flagged as acquired by trade`);
}
for (const r of acquiredByTrade) {
  console.log(`  ${r.name} (${r.fr})`);
  console.log(`      trade:          ${r.traded.join(", ") || r.tradeFlag}`);
  console.log(`      sheet 2026:     ${r.sheet26}`);
  console.log(`      app: kept ${r.seasonsKept}, ${r.clockLabel}`);
  console.log(`      app releases him after ${r.appFinalSeasonYear}`);
  console.log(
    `      if ${SEASON} is his ACQUISITION season (pre-draft trade), the` +
      ` commissioner's rule keeps him through ${SEASON + CLOCK_RULES.maxConsecutiveSeasons}`,
  );
  console.log(
    `      difference:     ${
      SEASON + CLOCK_RULES.maxConsecutiveSeasons - r.appFinalSeasonYear
    } season(s)\n`,
  );
}

// ---------------------------------------------------------------------------
console.log(`${"-".repeat(78)}`);
console.log(`Does any 2026 COST ROUND or 2026 ELIGIBILITY change? (the Saturday question)`);
console.log(`${"-".repeat(78)}\n`);
console.log(
  `  The pre-draft question is about how many seasons FOLLOW ${SEASON}. It cannot\n` +
    `  change a ${SEASON} cost round, which is basis − 1, nor whether a player is\n` +
    `  eligible in ${SEASON}, since every keeper here has at least one season left\n` +
    `  under either reading. Asserted rather than assumed:\n`,
);
const zeroRemaining = rows.filter((r) => clockPosition(r.seasonsKept).remaining < 1);
console.log(
  `  keepers with no ${SEASON} season left under the CURRENT model: ${zeroRemaining.length}`,
);
console.log(
  `  keepers whose ${SEASON} cost round depends on the clock at all: ` +
    `${rows.filter((r) => r.basis == null).length} (only the free agents, via undraftedYear2Round)`,
);
for (const r of rows.filter((r) => r.basis == null)) {
  console.log(`      ${r.name} — basis FA, cost R${r.cost}, year ${clockPosition(r.seasonsKept).year}`);
}

console.log(`\n${"=".repeat(78)}\n`);

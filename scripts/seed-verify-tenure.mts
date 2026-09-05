/**
 * TENURE DISPLAY GUARD — every keeper's displayed year must match the sheet.
 *
 * The league counts a keeper's tenure out of THREE, with the acquisition season
 * as year 1, and writes it in the `N of 3` column of `KEEPER LIST for 2026`.
 * The commissioner reads that convention natively and has rejected the
 * alternative twice:
 *
 *   "Realistically it's year two of three for all of those guys, because they
 *    were acquired already in the past season. ... You can have a player up to
 *    three years: the year you acquire him and then two keeper years."
 *
 * TWO INDEPENDENT AGENTS HAVE NOW RENDERED THIS WRONG, both by counting keeper
 * seasons ("Year 1 of 2") and hiding the acquisition season. That is what this
 * file exists to stop. It compares what the app would PRINT against the sheet
 * itself, so a regression fails here rather than on the commissioner's screen.
 *
 * Runs against the files in `data/` only — no Postgres, no network.
 *
 *   npm run verify:tenure
 */

import process from "node:process";

import { getKeeperBoardFromJson, getFranchisesFromJson } from "@/lib/league-json";
import { SHEET_TENURE_TERM, acquisitionSeason } from "@/lib/keeper-clock";
import { LEAGUE } from "@/lib/league-config";
import eligibility from "../data/keeper-eligibility-2026.json" with { type: "json" };

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const SEASON = LEAGUE.currentSeason;

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
}
function section(title: string) {
  console.log(`\n${title}`);
  console.log("-".repeat(title.length));
}

type EligRow = {
  player: string;
  manager: string;
  status2026: string | null;
};

/**
 * Player names differ in punctuation and generational suffix between the sheet
 * and the room — "Travis Etienne Jr" against "Travis Etienne". Matching on the
 * raw string silently skipped him, which left a hole in exactly the check the
 * commissioner asked about, so names are normalised the same way the data layer
 * does it.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The sheet's `N of 3` for 2026, by player and franchise short name. */
const sheetYear = new Map<string, number>();
for (const r of (eligibility as { players: EligRow[] }).players) {
  const m = /^(\d+)\s+of\s+(\d+)$/.exec((r.status2026 ?? "").trim());
  if (!m) continue;
  sheetYear.set(`${normalize(r.player)}|${r.manager}`, Number(m[1]));
}

/** Pull "Year 2 of 3" out of a rendered label. Null when it says something else. */
function displayedYear(label: string): { year: number; term: number } | null {
  const m = /Year\s+(\d+)\s+of\s+(\d+)/i.exec(label);
  return m ? { year: Number(m[1]), term: Number(m[2]) } : null;
}

const board = getKeeperBoardFromJson();

console.log(`\n${"=".repeat(74)}`);
console.log(`TENURE DISPLAY — ${board.keepers.length} keepers, ${SEASON}`);
console.log(`${"=".repeat(74)}`);

// ---------------------------------------------------------------------------
section("1. No surface may count keeper seasons out of two");

const offenders = board.keepers.filter((k) => {
  const d = displayedYear(k.clockLabel);
  return d != null && d.term !== SHEET_TENURE_TERM;
});
check(
  `every label counts out of ${SHEET_TENURE_TERM}, not ${SHEET_TENURE_TERM - 1}`,
  offenders.length === 0,
  offenders.map((o) => `${o.playerName}: "${o.clockLabel}"`).join("; ") || "no 'of 2' anywhere",
);

// ---------------------------------------------------------------------------
section("2. Every displayed year matches the sheet's own N of 3");

console.log(
  `\n  ${"player".padEnd(22)}${"fr".padEnd(8)}${"shown".padEnd(9)}${"sheet".padEnd(9)}acquired\n`,
);

let compared = 0;
const mismatches: string[] = [];
for (const k of board.keepers) {
  const sheet = sheetYear.get(`${normalize(k.playerName)}|${k.teamShortName}`);
  const shown = displayedYear(k.clockLabel);
  const acquired = acquisitionSeason(SEASON, k.seasonsKept, k.sheetTenureYear);

  // A disputed keeper deliberately shows no year — that is the point of the
  // dispute — so it is checked separately in section 4 rather than here.
  if (k.tenureDispute) {
    console.log(
      `  ${k.playerName.padEnd(22)}${k.teamShortName.padEnd(8)}` +
        `${"disputed".padEnd(9)}${(sheet == null ? "—" : `${sheet} of 3`).padEnd(9)}${acquired}`,
    );
    continue;
  }

  console.log(
    `  ${k.playerName.padEnd(22)}${k.teamShortName.padEnd(8)}` +
      `${(shown ? `${shown.year} of ${shown.term}` : "?").padEnd(9)}` +
      `${(sheet == null ? "—" : `${sheet} of 3`).padEnd(9)}${acquired}` +
      `${sheet != null && shown && sheet !== shown.year ? "   <-- MISMATCH" : ""}`,
  );

  if (sheet == null || !shown) continue;
  compared += 1;
  if (sheet !== shown.year) {
    mismatches.push(
      `${k.playerName} (${k.teamShortName}): app shows year ${shown.year}, sheet says ${sheet}`,
    );
  }
}

check(
  `all ${compared} keepers with a sheet row agree with it`,
  mismatches.length === 0,
  mismatches.join("; ") || "every one matches",
);

// ---------------------------------------------------------------------------
section("3. The three the commissioner named must read 2 of 3");

for (const name of ["Ladd McConkey", "De'Von Achane", "Tucker Kraft"]) {
  const k = board.keepers.find((x) => x.playerName === name);
  const shown = k ? displayedYear(k.clockLabel) : null;
  check(
    `${name} reads "Year 2 of ${SHEET_TENURE_TERM}"`,
    shown?.year === 2 && shown?.term === SHEET_TENURE_TERM,
    k ? `"${k.clockLabel}"` : "not found on the board",
  );
}

// ---------------------------------------------------------------------------
section("4. Nacua stays disputed — this convention change must not settle him");

const nacua = board.keepers.find((k) => k.playerName === "Puka Nacua");
check("Puka Nacua is on the board", nacua != null);
check(
  "his tenure is still marked disputed",
  nacua?.tenureDispute != null,
  nacua?.tenureDispute ? nacua.tenureDispute.badge : "NOT disputed",
);
check(
  "his label states no single tenure year",
  displayedYear(nacua?.clockLabel ?? "") == null,
  `"${nacua?.clockLabel ?? ""}"`,
);
check(
  "both readings are still offered",
  (nacua?.tenureDispute?.readings.length ?? 0) === 2,
  nacua?.tenureDispute?.readings.map((r) => r.finalSeason).join(" or ") ?? "",
);

// ---------------------------------------------------------------------------
section("5. /teams shows the same label as /keepers");

const franchises = getFranchisesFromJson();
const byPlayer = new Map(board.keepers.map((k) => [`${k.teamShortName}|${k.playerId}`, k]));
const drift: string[] = [];
let crossChecked = 0;
for (const f of franchises) {
  for (const k of f.keepers) {
    const onBoard = byPlayer.get(`${f.shortName}|${k.playerId}`);
    if (!onBoard) continue;
    crossChecked += 1;
    if (onBoard.clockLabel !== k.clockLabel) {
      drift.push(`${k.playerName}: /teams "${k.clockLabel}" vs /keepers "${onBoard.clockLabel}"`);
    }
  }
}
check(
  `all ${crossChecked} keepers carry an identical label on both pages`,
  drift.length === 0,
  drift.join("; ") || "identical",
);

// ---------------------------------------------------------------------------
section("6. The acquisition season is printable for every keeper");

const noAcquisition = board.keepers.filter((k) => k.sheetTenureYear == null);
check(
  "every keeper has a sheet tenure year, so 'acquired YYYY' is never a guess",
  noAcquisition.length === 0,
  noAcquisition.map((k) => k.playerName).join(", ") ||
    `all ${board.keepers.length} derivable`,
);

console.log(`\n${"=".repeat(74)}`);
console.log(
  failures === 0
    ? "ALL TENURE DISPLAY CHECKS PASSED"
    : `${failures} TENURE DISPLAY CHECK(S) FAILED`,
);
console.log(`${"=".repeat(74)}\n`);
process.exit(failures === 0 ? 0 : 1);

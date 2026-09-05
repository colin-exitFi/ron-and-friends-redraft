import "server-only";

/**
 * Everything the grade reads off disk: the confidence-marked league history, and
 * the positional price market computed from fifteen years of this league's own
 * draft sheets.
 *
 * `@/lib/recap-grade` is pure — it is exercised by a verification script and
 * builds payloads for historical boards that have no database behind them — so
 * the I/O lives here and the results are handed in as arguments, exactly as
 * `@/lib/recap-source` holds the whole of the dossier's I/O.
 *
 * ============================================================================
 * THE POSITIONAL PRICE TABLE IS NOT COMPUTED HERE ANY MORE
 * ============================================================================
 *
 * `@/lib/positional-norms` owns it. This module computed its own for a while —
 * over eight seasons rather than six, and identifying a keeper declaration by
 * the league's minus-one cost ratchet rather than by joining the keeper list —
 * and the two agreed on the figure that settles the question the table exists
 * for: the dearest quarterback anybody in this league has ever declared cost a
 * ROUND-6 pick, so a round-3 quarterback price is off the end of the record and
 * declining it is the obvious call.
 *
 * They disagreed by two rounds on the median. That is the whole reason one of
 * them had to go: a grade citing a round-12 median beside a blurb citing a
 * round-10 one, on the same card, is the failure this repository has already had
 * twice — on Greg's keepers and on Zach's fourth-rounders. The prose layer's
 * table shipped first and reaches the prompt, so the grade consumes it, and the
 * grade payload passes it through whole rather than restating any of it.
 *
 * WHAT IS STILL HERE is the sheet parser, and it is here for a different job:
 * `scripts/recap-history-drafts.mts` builds eight seasons' worth of dossier
 * FIXTURES from it to verify the grade against real boards with real gaps. That
 * is a test concern and no figure from it reaches a page, so it is not a second
 * source of truth for anything the room will read.
 *
 * MISSING IS NOT FATAL. An absent or malformed history file returns an empty
 * map, the grade payload reports `history: "absent"` in its coverage block, and
 * the recap is worth generating without it. History enriches a grade; it is
 * never required for one.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import type { HistoryConfidence, HistoryNote } from "@/lib/recap-grade";

const CONFIDENCES: HistoryConfidence[] = ["verified", "derived", "inferred", "unverified"];

function isConfidence(value: unknown): value is HistoryConfidence {
  return typeof value === "string" && (CONFIDENCES as string[]).includes(value);
}

// ── The draft sheets ────────────────────────────────────────────────────────

/** Rounds and teams every season in this league has run. */
const ROUNDS = 16;
const TEAMS = 10;

/**
 * The draft-result sheets, by season.
 *
 * 2016 and 2022 are absent from the commissioner's workbook. 2017 is a different
 * shape from the rest — a formatted "*** ROUND n RESULTS ***" listing rather
 * than a table — and is the only one that marks its keepers in text.
 */
export const DRAFT_SHEETS: Record<number, { file: string; layout: "table" | "listing" }> = {
  2017: { file: "2026-draft__by-round-2017", layout: "listing" },
  2018: { file: "2026-draft__2018-draft-by-round", layout: "table" },
  2019: { file: "2026-draft__2019-draft-by-round", layout: "table" },
  2020: { file: "2026-draft__2020-draft", layout: "table" },
  2021: { file: "2026-draft__2021-draft", layout: "table" },
  2023: { file: "2026-draft__2023-draft", layout: "table" },
  2024: { file: "2026-draft__2024-draft", layout: "table" },
  2025: { file: "2026-draft__2025-draft", layout: "table" },
};

export const DRAFT_SHEET_SEASONS: number[] = Object.keys(DRAFT_SHEETS)
  .map(Number)
  .sort((a, b) => a - b);

export type SheetPick = {
  season: number;
  round: number;
  /** Overall pick, 1-160. Derived where a sheet carries only one of the two. */
  overallPick: number;
  player: string;
  /** Normalised to the league's own labels. Empty when the cell was not one. */
  position: string;
  nflTeam: string | null;
  /** Short name the league uses. Former members keep their own name. */
  manager: string;
  /**
   * A kept player occupying this slot rather than a pick made on the day.
   *
   * Only ever true for 2017, whose sheet says so in text. False elsewhere means
   * "not known to be a keeper", NOT "was a pick" — the other sheets marked
   * keepers by highlighting and the JSON has none of it.
   */
  isKeeper: boolean;
};

/**
 * Sheet name to the short name the league uses.
 *
 * FOUR OF THE TEN SHARE A FIRST NAME AND TWO ARE CALLED SCOTT, which is why
 * `data/league-history.json` carries a whole `identityTrap` block about it.
 * Every mapping is explicit; nothing is matched on a first name.
 *
 * The 2020 sheet contains two typos of its own ("Merts", "Sefan") and the 2017
 * listing refers to Scott Johnston by his franchise. The three former members —
 * Andy Seibert, Josh Schaefer, Chad McCann — map to THEMSELVES rather than being
 * dropped: they held real picks and a table that silently loses them is
 * measuring a nine-team league.
 */
const MANAGER_ALIASES: Record<string, string> = {
  "zach rakowski": "Zach",
  "kyle witte": "Witte",
  "joe murray": "Joe",
  "joe murray via chad mccann": "Joe",
  "josh grainger": "Josh",
  "scott elbe": "Elbe",
  "kyle mertens": "Kyle",
  "scott johnston": "Scott",
  "stefan albers": "Stefan",
  "greg blome": "Greg",
  "colin tracy": "Colin",
  zach: "Zach",
  witte: "Witte",
  joe: "Joe",
  josh: "Josh",
  elbe: "Elbe",
  kyle: "Kyle",
  merts: "Kyle",
  scott: "Scott",
  stefan: "Stefan",
  sefan: "Stefan",
  greg: "Greg",
  colin: "Colin",
  "dhb sandmen (sj)": "Scott",
  "andy seibert": "Andy Seibert",
  "josh schaefer": "Josh Schaefer",
  "chad mccann": "Chad McCann",
  "ted buckman": "Zach",
};

export function toShortName(raw: string): string {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return MANAGER_ALIASES[key] ?? raw.trim();
}

/** Case-folded and suffix-stripped, for joining one sheet to another. */
export function normalizePlayerName(name: string): string {
  return String(name)
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The league's own position labels, and the sheet spellings that map onto them.
 *
 * A position cell is NOT always a position. Six rows across the eight sheets
 * carry an NFL team abbreviation where the position belongs — "MIN", "JAX",
 * "SEA" — and an earlier version of this table reported each of them as its own
 * position with a sample size of one. Unrecognised cells are dropped and COUNTED,
 * so the count can be asserted rather than a silent filter hiding a parse drift.
 */
const POSITIONS: Record<string, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DST: "DST",
  DEF: "DST",
  "D/ST": "DST",
  K: "K",
  PK: "K",
};

function toPosition(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return POSITIONS[raw.trim().toUpperCase()] ?? "";
}

type Sheet = { rows: unknown[][] };

function readSheet(file: string): Sheet | null {
  try {
    const full = path.join(process.cwd(), "data", "spreadsheets", `${file}.json`);
    return JSON.parse(readFileSync(full, "utf8")) as Sheet;
  } catch {
    return null;
  }
}

/**
 * One line of the 2017 listing.
 *
 *   "10.6 (96) --- Kyle Witte --- Marcus Mariota - QB (TEN) *K*"
 *
 * The trailing `*K*` is optional and is how that sheet marks a keeper. It was
 * briefly not in this pattern, which silently dropped all nineteen and left the
 * season looking like a 141-pick draft in which one manager held fifteen slots
 * and everybody else fourteen. An off-by-nineteen that looks like a plausible
 * board is exactly the fixture bug that makes a table worthless, so the count is
 * asserted downstream.
 */
const LISTING_ROW =
  /^(\d+)\.(\d+)\s*\((\d+)\)\s*---\s*(.+?)\s*---\s*(.+?)\s*-\s*([A-Za-z/]+)\s*\(([^)]*)\)\s*(\*K\*)?\s*$/;

/** Every slot of one season, in board order. Keepers included, flagged. */
export function loadDraftSheet(season: number): SheetPick[] {
  const spec = DRAFT_SHEETS[season];
  if (!spec) return [];
  const sheet = readSheet(spec.file);
  if (!sheet?.rows) return [];

  const picks =
    spec.layout === "listing" ? parseListing(season, sheet) : parseTable(season, sheet);
  return picks.sort((a, b) => a.overallPick - b.overallPick);
}

function parseListing(season: number, sheet: Sheet): SheetPick[] {
  const picks: SheetPick[] = [];
  for (const row of sheet.rows) {
    const cell = row.find((c) => typeof c === "string" && LISTING_ROW.test(c));
    if (typeof cell !== "string") continue;
    const m = cell.match(LISTING_ROW)!;
    picks.push({
      season,
      round: Number(m[1]),
      overallPick: Number(m[3]),
      player: m[5].trim(),
      position: toPosition(m[6]),
      nflTeam: m[7].trim() || null,
      manager: toShortName(m[4]),
      isKeeper: !!m[8],
    });
  }
  return picks;
}

function parseTable(season: number, sheet: Sheet): SheetPick[] {
  const headerIndex = sheet.rows.findIndex((row) =>
    row.some((c) => typeof c === "string" && c.trim().toLowerCase() === "league member"),
  );
  if (headerIndex === -1) return [];

  const header = sheet.rows[headerIndex].map((c) =>
    typeof c === "string" ? c.trim().toLowerCase() : "",
  );
  /*
   * FIRST MATCH ONLY. The 2018 sheet repeats "Pick" and "Round" in trailing
   * columns as a working area, and the 2024 sheet carries a second manager
   * column beside a pick-count tally. Taking the leftmost of each keeps the
   * parse on the real table.
   */
  const at = (name: string) => header.indexOf(name);
  const iPlayer = at("player");
  const iRound = at("round");
  const iPick = at("pick");
  const iManager = at("league member");
  const iPosition = at("position");
  const iTeam = at("team");

  const picks: SheetPick[] = [];
  for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i];
    const player = row[iPlayer];
    const round = Number(row[iRound]);
    const manager = row[iManager];
    if (typeof player !== "string" || !player.trim()) continue;
    if (!Number.isFinite(round) || round < 1 || round > ROUNDS) continue;
    if (typeof manager !== "string" || !manager.trim()) continue;

    const rawPick = Number(row[iPick]);
    /*
     * Sheets disagree about whether "Pick" is the overall number or the slot
     * within the round. A value inside 1..10 is a slot and is expanded; anything
     * larger is already an overall pick.
     */
    const overallPick =
      Number.isFinite(rawPick) && rawPick > TEAMS
        ? rawPick
        : Number.isFinite(rawPick)
          ? (round - 1) * TEAMS + rawPick
          : picks.length + 1;

    picks.push({
      season,
      round,
      overallPick,
      player: player.trim(),
      position: toPosition(row[iPosition]),
      nflTeam: typeof row[iTeam] === "string" && row[iTeam].trim() ? row[iTeam].trim() : null,
      manager: toShortName(manager),
      isKeeper: false,
    });
  }
  return picks;
}

// ── The confidence-marked history ───────────────────────────────────────────

/**
 * One note, or null if the row is not one.
 *
 * A row with no confidence mark is DROPPED rather than defaulted. Defaulting it
 * either way is a lie: `verified` would launder an unsourced claim into a fact,
 * and `unverified` would bury a real one. The file's own contract is that
 * nothing is asserted without a mark, so a row without one is a file that has
 * drifted, and `npm run verify:history` is what catches that.
 */
function toNote(raw: unknown): HistoryNote | null {
  const row = raw as { fact?: unknown; source?: unknown; confidence?: unknown };
  if (!row || typeof row.fact !== "string" || !row.fact.trim()) return null;
  if (!isConfidence(row.confidence)) return null;
  return {
    fact: row.fact.trim(),
    source: typeof row.source === "string" ? row.source : "data/league-history.json",
    confidence: row.confidence,
  };
}

/**
 * Per-manager notes, capped.
 *
 * FOUR, NOT EIGHT, AND THE REASON IS A DIVISION OF LABOUR RATHER THAN A BUDGET.
 * At eight the history was 19.8 KB of a 44.9 KB payload — nearly half of it,
 * beside a dossier that is already 69 KB — and most of the tail was banter: who
 * heckled whom in the 2024 draft, which is superb material for a blurb and no
 * evidence at all about whether a decision was good. The JOKES already reach the
 * model through `@/lib/league-lore` and the prompt. What this payload is for is
 * the small number of facts that change a VERDICT: a keeper in his final season,
 * a short list closed on purpose, a manager who has waited on a quarterback
 * every year of his life.
 *
 * Sorted verified-first below, so the four that survive are the four the file is
 * most confident about rather than the four that happen to be written first.
 */
const NOTES_PER_MANAGER = 3;

/**
 * Confidence-marked history for every manager, keyed by short name.
 *
 * Three sources inside the one file, in the order a grade wants them:
 *
 *   1.  `managers.<Short>.notes` — the per-manager facts, which is where the
 *       keeper-season expiries and the declaration status live.
 *   2.  `keeperCounterfactual.byManager.<Short>` — the roast and its mark. This
 *       is the block about what a manager kept and declined, which is the single
 *       most grading-relevant thing in the file.
 *   3.  `draftHistory.positionalPatterns` — per-manager tendencies, attributed
 *       by short name in the file itself.
 */
export function readGradeHistory(): Record<string, HistoryNote[]> {
  let parsed: unknown;
  try {
    const file = path.join(process.cwd(), "data", "league-history.json");
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }

  const doc = parsed as {
    managers?: Record<string, { notes?: unknown }>;
    keeperCounterfactual?: { byManager?: Record<string, Record<string, unknown>> };
    draftHistory?: { positionalPatterns?: unknown };
  };

  const byManager: Record<string, HistoryNote[]> = {};
  const push = (manager: string, note: HistoryNote | null) => {
    if (!note) return;
    (byManager[manager] ??= []).push(note);
  };

  for (const [manager, entry] of Object.entries(doc.managers ?? {})) {
    if (!Array.isArray(entry?.notes)) continue;
    for (const raw of entry.notes) push(manager, toNote(raw));
  }

  for (const [manager, entry] of Object.entries(doc.keeperCounterfactual?.byManager ?? {})) {
    if (!entry || typeof entry !== "object") continue;
    const confidence = entry.confidence;
    if (!isConfidence(confidence)) continue;
    /*
     * `theRoast` is the prose line and the only free text in the block; the rest
     * is the kept/declined tables, which the dossier already computes off the
     * board and which must not arrive here as a second copy.
     */
    if (typeof entry.theRoast === "string" && entry.theRoast.trim()) {
      push(manager, {
        fact: entry.theRoast.trim(),
        source: "data/league-history.json, keeperCounterfactual",
        confidence,
      });
    }
  }

  const patterns = doc.draftHistory?.positionalPatterns;
  if (Array.isArray(patterns)) {
    for (const raw of patterns) {
      const row = raw as {
        manager?: unknown;
        pattern?: unknown;
        source?: unknown;
        confidence?: unknown;
      };
      if (typeof row?.manager !== "string" || typeof row.pattern !== "string") continue;
      if (!isConfidence(row.confidence)) continue;
      push(row.manager, {
        fact: row.pattern.trim(),
        source:
          typeof row.source === "string"
            ? row.source
            : "data/league-history.json, draftHistory.positionalPatterns",
        confidence: row.confidence,
      });
    }
  }

  const rank: Record<HistoryConfidence, number> = {
    verified: 0,
    derived: 1,
    inferred: 2,
    unverified: 3,
  };
  for (const manager of Object.keys(byManager)) {
    byManager[manager] = byManager[manager]
      .sort((a, b) => rank[a.confidence] - rank[b.confidence])
      .slice(0, NOTES_PER_MANAGER);
  }

  return byManager;
}

/**
 * Ingests the commissioner's two FantasyPros exports into one committed file.
 *
 *   npm run pull:cheatsheet
 *
 * ============================================================================
 * WHY THERE ARE TWO FILES AND WHY THEY ARE NOT INTERCHANGEABLE
 * ============================================================================
 * The app's FantasyPros OAuth grant is not connected, so the live ranking feed
 * is a week old and scoped to full PPR. The commissioner worked around it by
 * exporting from FantasyPros by hand, and he exported twice:
 *
 *   `league-cheatsheet-2026.csv` — a grid export headed "Ron and Friends #2".
 *      Exported against HIS league's own FantasyPros configuration, so the
 *      ORDER RESPECTS THIS LEAGUE'S SCORING: half PPR, tight end premium, six
 *      points a passing touchdown.
 *
 *   `all-rankings-2026.csv` — the flat public board. Generic scoring.
 *
 * They disagree in exactly the way the league's scoring predicts, which is how
 * we know the first one is what it claims to be: Brock Bowers is TE1 and 13th
 * overall on the league export against 18th on the generic board, and Josh
 * Allen is 26th on the generic board. A full point per tight end reception and
 * a six-point passing touchdown inflate precisely those two positions.
 *
 * SO THE TWO FILES HAVE DIFFERENT JOBS, AND MIXING THEM UP WOULD REINTRODUCE
 * THE EXACT BIAS THIS LEAGUE EXISTS TO CORRECT FOR:
 *
 *   · the league export supplies the ORDER — `leagueRank`, and the positional
 *     ranks under it. This is the sequence to draft against.
 *   · the flat file supplies METADATA the grid does not carry — tiers, bye
 *     weeks, and FantasyPros' own expert-consensus-versus-ADP figure.
 *
 * THE TIERS COME FROM THE GENERIC BOARD AND ARE LABELLED AS SUCH. FantasyPros
 * draws tier boundaries against its own scoring, so they will not line up
 * perfectly with the league order — a tight end can sit in a tier the league
 * ranking has already moved him out of. They are still the most useful grouping
 * on a cheat sheet, because they say when a run is about to matter, so they are
 * kept and the UI says where they came from. Presenting them as league-specific
 * would be the dishonest option.
 *
 * ============================================================================
 * JOINING, AND WHY THE UNMATCHED ARE PRINTED
 * ============================================================================
 * Both files are joined to the Smart Draft pool on `joinKey(name)` plus team —
 * the same normaliser the rest of the app uses, which folds case, strips
 * accents and punctuation, and drops Jr/Sr/II/III/IV. That is what makes
 * "Ja'Marr Chase", "Amon-Ra St. Brown", "A.J. Brown", "Kenneth Walker III" and
 * "Kyle Pitts Sr." land on the right rows.
 *
 * Every failure is COUNTED AND NAMED. A player missing from the cheat sheet
 * because of an apostrophe is a player nobody can find at the table, and it
 * would look exactly like a player FantasyPros does not rank. Unsigned players
 * — team `FA` in the flat file, an empty team in the grid — are skipped
 * deliberately and reported separately, because those are not join failures.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getPlayerPool } from "@/lib/smartdraft";
import { joinKey } from "@/lib/fantasypros/players";
import { CURRENT_SEASON } from "@/lib/league-config";

const GRID = process.env.CHEATSHEET_GRID ?? "data/fantasypros-exports/league-cheatsheet-2026.csv";
const FLAT = process.env.CHEATSHEET_FLAT ?? "data/fantasypros-exports/all-rankings-2026.csv";
const OUT = `data/fantasypros-cheatsheet-${CURRENT_SEASON}.json`;

/** Minimal RFC4180 reader — these files quote names containing commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const clean = (s) => (s ?? "").trim();
const num = (s) => {
  const t = clean(s).replace(/^\+/, "");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
/** "3 out of 5" / "4 out of 5 stars" -> 3 / 4. */
const stars = (s) => {
  const m = /^(\d)\s+out of\s+5/.exec(clean(s));
  return m ? Number(m[1]) : null;
};

// --- The pool, indexed the way both files will be looked up in ---------------

const pool = getPlayerPool();
/** `name|TEAM|POS` — the strict key. */
const byExact = new Map();
/** `name|POS` — for a player whose team the export disagrees about. */
const byNamePos = new Map();
for (const p of pool) {
  const k = joinKey(p.name);
  byExact.set(`${k}|${p.nflTeam ?? ""}|${p.position}`, p);
  const np = `${k}|${p.position}`;
  // First writer wins; a duplicate name at one position is ambiguous and the
  // strict key is the one that should resolve it.
  if (!byNamePos.has(np)) byNamePos.set(np, p);
  else byNamePos.set(np, null);
}

const unmatched = [];
const skippedUnsigned = [];

/**
 * Names FantasyPros writes differently from the pool, beyond what `joinKey`
 * normalises away.
 *
 * Deliberately tiny and deliberately hand-checked. Fuzzy matching would close
 * these two and open the door to silently joining the wrong player, which is a
 * far worse failure on a cheat sheet than a missing row: a wrong row is
 * confidently wrong and nobody checks it.
 *
 *   · FantasyPros prints Marquise Brown by his nickname.
 *   · `joinKey` strips Jr/Sr/II/III/IV but not a bare V, and David Sills is
 *     the only player in either export who carries one. Fixing it here rather
 *     than in `joinKey` keeps a shared normaliser — used by the projections
 *     join and the league history — out of a last-minute change.
 */
const NAME_ALIASES = new Map([
  ["hollywood brown", "marquise brown"],
  ["david sills v", "david sills"],
]);

/** `joinKey`, plus this file's own two corrections. */
function exportKey(name) {
  const direct = NAME_ALIASES.get(name.trim().toLowerCase());
  return joinKey(direct ?? name);
}

/**
 * Resolve one export row to a pool player.
 *
 * Team first, then name-and-position. The second pass exists because a player
 * who changed clubs between the pool snapshot and today's export is a REAL
 * player the room will draft, and refusing him over a stale team code would
 * take him off the cheat sheet entirely. It is only allowed where the name and
 * position are unambiguous in the pool.
 */
function resolve(name, team, position, source, rank = null) {
  const k = exportKey(name);
  const exact = byExact.get(`${k}|${team}|${position}`);
  if (exact) return exact;
  const loose = byNamePos.get(`${k}|${position}`);
  if (loose) return loose;
  unmatched.push({ source, name, team, position, rank });
  return null;
}

// --- 1. The league-scoped grid: the ordering ---------------------------------

const gridRows = parseCsv(readFileSync(path.join(process.cwd(), GRID), "utf8"));
const leagueLabel = clean(gridRows[0]?.[0]);
const gridHeader = gridRows[1] ?? [];
/** Column index of each block's name column. */
const blocks = [];
for (let i = 0; i < gridHeader.length; i++) {
  const h = clean(gridHeader[i]);
  if (h && !["Bye Week", "Tags", "Expert Notes"].includes(h)) blocks.push({ label: h, col: i });
}

/** `Jahmyr Gibbs (RB - DET)` and `Jahmyr Gibbs - DET` and `Houston Texans`. */
function parseGridName(cell, blockLabel) {
  const s = clean(cell);
  if (!s) return null;
  const overall = /^(.*?)\s*\(([A-Z]+)\s*-\s*([A-Z]*)\)$/.exec(s);
  if (overall) {
    return { name: clean(overall[1]), position: overall[2], team: clean(overall[3]) };
  }
  /*
   * `Jahmyr Gibbs - DET`, and also `Miles Sanders -` for an unsigned player,
   * whose team code is simply absent. The trailing group must therefore be
   * allowed to be empty — matching only a non-empty code sent every free agent
   * down the team-defence branch below, where it became a join failure against
   * a name with a dangling hyphen still on the end of it.
   */
  const positional = /^(.*?)\s+-\s*([A-Z]*)$/.exec(s);
  if (positional) {
    return { name: clean(positional[1]), position: blockLabel, team: clean(positional[2]) };
  }
  // A team defence carries no team code in either format.
  return { name: s, position: blockLabel, team: null };
}

/** playerId -> record under construction. */
const players = new Map();
function upsert(player) {
  let row = players.get(player.id);
  if (!row) {
    row = {
      playerId: player.id,
      name: player.name,
      team: player.nflTeam,
      position: player.position,
      leagueRank: null,
      leaguePositionRank: null,
      bye: player.byeWeek ?? null,
      tier: null,
      genericRank: null,
      genericPositionRank: null,
      ecrVsAdp: null,
      avgDiff: null,
      upside: null,
      bust: null,
      sos: null,
    };
    players.set(player.id, row);
  }
  return row;
}

let gridRowsSeen = 0;
for (const { label, col } of blocks) {
  let rank = 0;
  for (let r = 2; r < gridRows.length; r++) {
    const parsed = parseGridName(gridRows[r]?.[col], label);
    if (!parsed) continue;
    rank++;
    gridRowsSeen++;
    /*
     * Unsigned. The grid writes `John Hurst (WR - )` in the overall block and
     * `Miles Sanders -` in a positional one. Not a join failure and not worth
     * a cheat sheet row: a player with no club cannot be drafted into a
     * starting lineup this season.
     */
    if (parsed.team === "") {
      skippedUnsigned.push({ source: `grid:${label}`, name: parsed.name });
      continue;
    }

    const player = resolve(
      parsed.name,
      parsed.team,
      parsed.position,
      `grid:${label}`,
      label === "Overall" ? rank : null,
    );
    if (!player) continue;

    const row = upsert(player);
    if (label === "Overall") row.leagueRank ??= rank;
    else row.leaguePositionRank ??= rank;

    const bye = num(gridRows[r]?.[col + 1]);
    if (bye != null) row.bye ??= bye;
  }
}

// --- 2. The generic flat board: tiers and metadata ---------------------------

const flatRows = parseCsv(readFileSync(path.join(process.cwd(), FLAT), "utf8"));
const flatHeader = flatRows[0].map((h) => clean(h));
const at = (name) => flatHeader.indexOf(name);
const C = {
  rk: at("RK"),
  tier: at("TIERS"),
  name: at("PLAYER NAME"),
  team: at("TEAM"),
  pos: at("POS"),
  bye: at("BYE WEEK"),
  upside: at("UPSIDE"),
  bust: at("BUST"),
  sos: at("SOS SEASON"),
  ecr: at("ECR VS. ADP"),
  diff: at("AVG. DIFF"),
};

let flatMatched = 0;
for (let r = 1; r < flatRows.length; r++) {
  const row = flatRows[r];
  const team = clean(row[C.team]);
  const name = clean(row[C.name]);
  if (!name) continue;
  if (team === "FA" || team === "") {
    skippedUnsigned.push({ source: "flat", name });
    continue;
  }
  // `RB1`, `WR32`, `DST5`.
  const posCell = clean(row[C.pos]);
  const m = /^([A-Z]+)(\d+)?$/.exec(posCell);
  const position = m ? m[1] : posCell;
  const positionRank = m && m[2] ? Number(m[2]) : null;

  const player = resolve(name, team, position, "flat");
  if (!player) continue;
  flatMatched++;

  const out = upsert(player);
  out.tier ??= num(row[C.tier]);
  out.genericRank ??= num(row[C.rk]);
  out.genericPositionRank ??= positionRank;
  out.bye ??= num(row[C.bye]);
  out.ecrVsAdp ??= num(row[C.ecr]);
  out.avgDiff ??= num(row[C.diff]);
  out.upside ??= stars(row[C.upside]);
  out.bust ??= stars(row[C.bust]);
  out.sos ??= stars(row[C.sos]);
}

// --- 3. Write it out ---------------------------------------------------------

const list = [...players.values()].sort(
  (a, b) => (a.leagueRank ?? Infinity) - (b.leagueRank ?? Infinity) || a.name.localeCompare(b.name),
);

const sha = (file) =>
  createHash("sha256").update(readFileSync(path.join(process.cwd(), file))).digest("hex").slice(0, 12);

const snapshot = {
  provenance: {
    source: "FantasyPros manual export by the commissioner",
    leagueLabel,
    /**
     * The claim this whole file rests on. The grid was exported against the
     * commissioner's own FantasyPros league configuration, so its ORDER already
     * prices the tight end premium and the six-point passing touchdown.
     */
    rankingScopedToLeague: true,
    rankingScopeNote:
      `Ordering is FantasyPros expert consensus exported against this league's own ` +
      `configuration (${leagueLabel}) — half PPR with a tight end premium and ` +
      `six-point passing touchdowns. It is not the generic public board.`,
    /** The tiers are NOT. Stated in the file, not only in the UI. */
    tierScope: "generic",
    tierScopeNote:
      "Tiers, ECR-vs-ADP and the star ratings come from FantasyPros' GENERIC board " +
      "and are drawn against generic scoring, so tier boundaries will not line up " +
      "exactly with the league-scoped order above.",
    exportedAt: new Date().toISOString(),
    season: CURRENT_SEASON,
    files: {
      grid: { path: GRID, sha256: sha(GRID) },
      flat: { path: FLAT, sha256: sha(FLAT) },
    },
  },
  players: list,
};

writeFileSync(path.join(process.cwd(), OUT), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

// --- 4. Say what happened ----------------------------------------------------

const ranked = list.filter((p) => p.leagueRank != null).length;
const tiered = list.filter((p) => p.tier != null).length;
const byes = list.filter((p) => p.bye != null).length;
const ecr = list.filter((p) => p.ecrVsAdp != null && p.ecrVsAdp !== 0).length;

console.log(`\nFantasyPros cheat sheet → ${OUT}`);
console.log(`  league export: ${leagueLabel}`);
console.log(`  ${list.length} players joined to the pool`);
console.log(`    ${ranked} with a league overall rank`);
console.log(`    ${tiered} with a tier (generic board)`);
console.log(`    ${byes} with a bye week`);
console.log(`    ${ecr} with a non-zero ECR-vs-ADP`);
console.log(`  ${gridRowsSeen} grid cells read, ${flatMatched} flat rows matched`);
console.log(`  ${skippedUnsigned.length} unsigned rows skipped (no team — not join failures)`);

/*
 * THE UNMATCHED, SPLIT BY WHETHER ANYBODY WOULD EVER DRAFT THEM.
 *
 * A raw count is close to useless here. The exports run 900 deep and this
 * league takes 150 players, so the tail is full of fullbacks and third-string
 * quarterbacks the pool has never carried — those are not defects. A name
 * missing from inside the first 250, on the other hand, is a player somebody
 * will look for tonight and fail to find, and it is the only number in this
 * report worth acting on.
 */
const DRAFT_RANGE = 250;
const missedInRange = unmatched.filter((u) => u.rank != null && u.rank <= DRAFT_RANGE);
const missedDeep = unmatched.length - missedInRange.length;

if (missedInRange.length === 0) {
  console.log(
    `\n  ✓ Every player in the top ${DRAFT_RANGE} of the league board matched the pool.`,
  );
} else {
  console.log(
    `\n  ✗ ${missedInRange.length} player(s) inside the top ${DRAFT_RANGE} did NOT match — ` +
      `these are draftable and somebody will look for them:`,
  );
  for (const u of missedInRange) {
    console.log(`    · #${u.rank} ${u.name} (${u.position} - ${u.team ?? "?"}) [${u.source}]`);
  }
}

if (missedDeep) {
  console.log(
    `\n  ${missedDeep} row(s) outside the top ${DRAFT_RANGE} did not match. Overwhelmingly\n` +
      `  fullbacks and camp bodies the pool has never carried; nobody drafts them.\n` +
      `  Set CHEATSHEET_VERBOSE=1 to list them.`,
  );
  if (process.env.CHEATSHEET_VERBOSE) {
    for (const u of unmatched.filter((x) => !missedInRange.includes(x))) {
      console.log(`    · ${u.name} (${u.position} - ${u.team ?? "?"}) [${u.source}]`);
    }
  }
}
console.log();

// A miss inside the draftable range is a real defect, so the script says so
// with its exit code rather than only in prose nobody reads twice.
process.exit(missedInRange.length === 0 ? 0 : 1);

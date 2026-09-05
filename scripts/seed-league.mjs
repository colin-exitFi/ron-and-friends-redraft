#!/usr/bin/env node
/**
 * Load the real 2026 league into the database.
 *
 * IDEMPOTENT BY DESIGN. The keeper room is not final — Zach's and Joe's
 * declarations are still outstanding — so this is built to be re-run every time
 * a new one arrives. Re-running never duplicates a row and never loses a
 * declaration made through the app.
 *
 * How that is achieved, per table:
 *
 *   leagues, teams, draft_order,      upserted on their natural keys.
 *   players, pick_ownership,
 *   draft_slots
 *
 *   keepers, trades, trade_assets,    the seed OWNS the rows it imported and
 *   traded_picks, commissioner_        replaces them wholesale, identified by
 *   actions                            their `source` column. Rows created in
 *                                      the app (source 'app') are left alone,
 *                                      so a manager's declaration is never
 *                                      wiped by a re-seed.
 *
 * SAFETY: refuses to touch a board once the draft is under way, unless --force.
 * The board is the one thing that must not change on draft night.
 *
 * Usage:
 *   node scripts/seed-league.mjs             # against .env.local
 *   node scripts/seed-league.mjs --dry-run   # report what would change
 *   node scripts/seed-league.mjs --force     # allow re-seeding a live draft
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { DB_SCHEMA } from "../src/lib/db-schema.mjs";

const ROOT = process.cwd();
const SEASON = 2026;
const NEXT_SEASON = SEASON + 1;

const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force");

/** Marks every row this script owns, so a re-run can replace exactly those. */
const SEED_SOURCES = ["smartdraft", "spreadsheet", "commissioner", "spreadsheet-trade-log"];

// --- env --------------------------------------------------------------------

/**
 * Read `.env.local` directly. Next.js loads it for the app, but a plain Node
 * script does not, and depending on a dotenv package for one file is not worth
 * the dependency.
 */
function loadEnvLocal() {
  const out = {};
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value && out[m[1]] === undefined) out[m[1]] = value;
    }
  }
  return out;
}

/**
 * A real environment variable wins over the file, but only if it has a value.
 * An exported-but-empty variable is what a shell leaves behind after sourcing
 * an env file that was blank at the time, and it must not mask the real value.
 */
function pick(name, fileEnv) {
  const fromProcess = process.env[name];
  if (fromProcess && fromProcess.length > 0) return fromProcess;
  return fileEnv[name];
}

const fileEnv = loadEnvLocal();
const SUPABASE_URL = pick("NEXT_PUBLIC_SUPABASE_URL", fileEnv);
const SERVICE_KEY = pick("SUPABASE_SERVICE_ROLE_KEY", fileEnv);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Fill them into .env.local. Retrieve the keys with:\n" +
      "  supabase projects api-keys --project-ref opxyeajywipsitwecgcz",
  );
  process.exit(1);
}

/*
 * `db.schema` is not optional here. This client holds the SERVICE-ROLE key, so
 * it bypasses RLS, and `public` on this project is the live backend for
 * ron-and-friends-fantasy.vercel.app. The seed upserts `teams`, `trades`,
 * `leagues` and more — all names that exist in BOTH schemas — so without this
 * the seed would not fail, it would overwrite the other league's rows.
 */
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  db: { schema: DB_SCHEMA },
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- data files -------------------------------------------------------------

function readData(file) {
  return JSON.parse(readFileSync(path.join(ROOT, "data", file), "utf8"));
}

const managersFile = readData("managers.json");
const room = readData("smartdraft-room-snapshot.json");
const resolvedKeepers = readData("keepers-2026-resolved.json");
const keeperSheet = readData("keeper-eligibility-2026.json");
const tradeLog = readData("trade-log-2026-spreadsheet.json");
const manualDeclarations = readData("keeper-declarations.json");
const playerPool = readData("smartdraft-players.json");

const espnTeams = readData("espn/espn-teams.json");
const espnRoster = readData("espn/espn-roster-settings.json");
const espnScoring = readData("espn/espn-scoring-settings.json");
const espnDraft = readData("espn/espn-draft-settings.json");
const espnTradeWaiver = readData("espn/espn-trade-waiver-settings.json");
const espnPlayoffs = readData("espn/espn-schedule-playoff-settings.json");

// --- helpers ----------------------------------------------------------------

const counts = {};
function record(label, n) {
  counts[label] = (counts[label] ?? 0) + n;
}

function normalizeName(name) {
  return String(name)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** `"2 of 3"` -> 2. Null for `"N/A"` or anything unparseable. */
function parseSheetTenure(status) {
  if (!status) return null;
  const m = /^\s*(\d+)\s+of\s+\d+\s*$/i.exec(status);
  return m ? Number(m[1]) : null;
}

/**
 * The sheets' "N of 3" -> keeper seasons already SERVED.
 *
 * The sheets count the acquisition season as year 1; the app counts keeper
 * seasons used. `2 of 3` therefore means nothing served yet. Mirrors
 * `seasonsKeptEnteringSheetSeason` in `src/lib/keeper-clock.ts`, and the
 * database enforces the same relation with a CHECK constraint, so getting this
 * wrong fails loudly rather than printing a wrong board.
 */
function seasonsKeptFromSheetTenure(tenure) {
  return Math.max(0, tenure - 2);
}

/**
 * The round a keeper occupies this season.
 *
 * Mirrors `keeperCostRound` in `src/lib/keeper-clock.ts`, which is the authority:
 * one round lower than the round the player occupied LAST season, applied once,
 * and clamped to the board. A free-agent acquisition has no round to his name
 * and prices at `leagues.undrafted_cost_round` (9) instead.
 *
 * `npm run db:verify` re-derives every stored cost round through the real
 * TypeScript function and fails on any disagreement, so this copy cannot drift.
 */
const UNDRAFTED_COST_ROUND = 9;
const UNDRAFTED_YEAR_2_ROUND = 8;
const COST_ROUND_STEP = 1;
const MAX_ROUND = 16;

function deriveCostRound({ basisRound, seasonsKept, isUndrafted }) {
  const clamp = (r) => Math.min(MAX_ROUND, Math.max(1, r));
  if (isUndrafted || basisRound == null) {
    return clamp(seasonsKept + 1 >= 2 ? UNDRAFTED_YEAR_2_ROUND : UNDRAFTED_COST_ROUND);
  }
  return clamp(basisRound - COST_ROUND_STEP);
}

async function step(label, fn) {
  if (DRY_RUN) {
    console.log(`  [dry-run] would ${label}`);
    return;
  }
  const { error } = await fn();
  if (error) {
    console.error(`\nFAILED while ${label}:\n  ${error.message}`);
    if (error.details) console.error(`  ${error.details}`);
    if (error.hint) console.error(`  hint: ${error.hint}`);
    process.exit(1);
  }
}

// ===========================================================================
// COMMISSIONER RULINGS (data/DECISIONS.md)
// ===========================================================================

/**
 * Nacua is Scott's at R11, and the trade restarted his clock.
 *
 * The keeper sheet has him on Greg at "2 of 3". The live room has him on Scott,
 * and the commissioner has ruled the room is right — the contingency protecting
 * against a Nacua injury has not triggered. Because a trade restarts keeper
 * eligibility while the price carries, 2026 is Scott's ACQUISITION season:
 * tenure "1 of 3", nothing served, keepable through 2028. DECISIONS.md flags
 * that as a loophole for the league to close, not a bug to work around here.
 */
const NACUA = {
  name: "Puka Nacua",
  sheetTenureYear: 1,
  acquiredByTrade: true,
  clockResetByTrade: true,
  notes:
    "Commissioner ruling: Nacua is Scott's at R11. The keeper sheet still has him " +
    "on Greg at 2 of 3. The trade restarted his clock, so 2026 is his acquisition " +
    "season and he stays keepable through 2028.",
};

/**
 * Loveland costs R9, not the sheet's R8. He was a free-agent acquisition, and a
 * free agent costs the 9th round. Stefan also holds no round-8 pick, having
 * traded it to Witte, so R8 is unusable regardless.
 */
const LOVELAND = {
  name: "Colston Loveland",
  costRound: 9,
  isUndrafted: true,
  notes:
    "Commissioner ruling: R9, not the sheet's R8. He was a free-agent acquisition " +
    "and a free agent costs the 9th round. Stefan holds no round-8 pick anyway.",
};

/**
 * DISPUTED DECLARATIONS — the lever for overriding the room's declarations.
 * ------------------------------------------------------------------------
 * THIS APP AND ITS DATABASE ARE THE SOURCE OF TRUTH FOR KEEPERS. Commissioner
 * ruling, Aug 28 2026: Smart Draft has not been updated since he began building
 * this app, so the room is a frozen historical import rather than a live feed.
 * There are 19 locked keepers and all ten teams have declared.
 *
 * The room supplies 16 of the 19 and `data/keeper-declarations.json` the other
 * three. Two of the room's 16 — Scott Elbe's Javonte Williams (R7) and Cam
 * Skattebo (R9) — arrived after `data/keepers-2026-resolved.json` was generated,
 * which is why that file lists only 14. They are corroborated independently by
 * the 2026 keeper sheet (both under "Scott Elbe") and, for Skattebo, by trade #9
 * in the commissioner's own trade log, so the seed treats them as real.
 *
 * That gap is also the trap: 14 + 3 = 17 is WRONG and has caught readers twice.
 * It drops Elbe's two, which are in the room but not the resolved file, and
 * never went through the declaration file. The board is 16 + 3 = 19. The
 * provenance line this script prints states all three numbers every run so the
 * arithmetic never has to be guessed.
 *
 * If the commissioner rules that a declaration in the room is NOT valid, add the
 * player's name here. The seed will skip it, and the franchise will show as
 * having that slot unfilled.
 *
 * Deliberately empty: no declaration has been ruled invalid.
 */
const DISPUTED_DECLARATIONS = [
  // e.g. "Javonte Williams", "Cam Skattebo",
];

/** Recorded in the decisions log so the league can see what was ruled and why. */
const RULINGS = [
  {
    source_ref: "ruling-nacua",
    type: "Keeper eligibility ruling — Puka Nacua",
    description:
      "Nacua is Scott Johnston's for 2026 and keepable at round 11. The executed " +
      "Johnston/Blome agreement states he retains 2026 R11 keeper eligibility " +
      "whether or not the contingent trade is consummated. The contingency is " +
      "downside protection against a six-week-plus injury and has not triggered.",
    disclosure_note:
      "Decided between two managers rather than by league vote. The commissioner's " +
      "position is that anything touching keeper eligibility should require " +
      "ratification; that is on the offseason agenda.",
  },
  {
    source_ref: "ruling-draft-order",
    type: "Draft order ruling — Smart Draft over ESPN",
    description:
      "ESPN had Colin 8th and Stefan 10th; the Smart Draft room has them swapped. " +
      "Every other slot agreed. The Smart Draft order is correct and ESPN's is stale.",
    disclosure_note: null,
  },
  {
    source_ref: "ruling-loveland",
    type: "Keeper cost ruling — Colston Loveland",
    description:
      "Loveland costs round 9, not the round 8 the keeper sheet computes. He was a " +
      "free-agent acquisition and the contract prices a free agent at the 9th round. " +
      "Stefan also owns no round-8 pick in 2026, having traded it to Witte.",
    disclosure_note: null,
  },
  {
    source_ref: "ruling-identity-zach",
    type: "Identity ruling — Ted Buckman is Zach Rakowski",
    description:
      "ESPN lists the Perpetually Impaired franchise under Ted Buckman; the keeper " +
      "sheets and Smart Draft say Zach Rakowski. Same person, an inside joke on the " +
      "ESPN account. The franchise is Zach's and the app uses Zach Rakowski.",
    disclosure_note: null,
  },
];

// ===========================================================================
// SEED
// ===========================================================================

async function seedLeague() {
  console.log("\nleagues");

  // Everything ESPN told us that has no column of its own. Read-only reference,
  // so the database can answer "what were the rules in 2026" on its own.
  const settings = {
    espn: {
      leagueName: espnTeams.leagueName,
      leagueId: espnTeams.leagueId,
      size: espnTeams.size,
      isPublic: espnTeams.isPublic,
      pulledAt: espnTeams._pulledAt ?? null,
      roster: espnRoster ?? null,
      scoring: espnScoring ?? null,
      draft: espnDraft ?? null,
      tradesAndWaivers: espnTradeWaiver ?? null,
      playoffs: espnPlayoffs ?? null,
    },
    smartDraft: {
      roomName: room.state?.name ?? null,
      draftFormat: room.state?.settings?.draftFormat ?? null,
      scoringFormat: room.state?.settings?.scoringFormat ?? null,
      // The room's BN:5 is misconfigured; ESPN's 7 is right, and 9 + 7 = 16 is
      // the only figure that reconciles with a 16-round draft.
      rosterConfigNote:
        "The room's BN:5 is wrong. ESPN has 7 bench, corroborated by the Roster sheet.",
    },
    provenance:
      "Rules from the executed Johnston/Blome trade agreement (Nov 12 2025) and " +
      "commissioner rulings in data/DECISIONS.md. Settings read from ESPN league 441239.",
  };

  await step("upsert the 2026 season", () =>
    db.from("leagues").upsert(
      {
        season: SEASON,
        name: "Ultimate Keeper League",
        espn_league_id: espnTeams.leagueId ?? null,
        team_count: managersFile.managers.length,
        draft_rounds: room.state.draftRoundCount || 16,
        snake_draft: (room.state?.settings?.draftFormat ?? "snake") === "snake",
        offline_draft: true,
        keepers_active: true,
        keepers_per_team: 2,
        // KEEPER seasons, excluding the acquisition season. The contract's "up
        // to three consecutive seasons" counts it, which is the same rule.
        max_keeper_seasons: 2,
        cost_round_step: 1,
        undrafted_cost_round: 9,
        trade_resets_keeper_clock: true,
        trade_deadline_week: 11,
        settings,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "season" },
    ),
  );
  record("leagues", 1);

  // 2027 exists so next year's picks are tradable today. The Johnston/Blome
  // 2027 legs cancel out entirely, so nothing there is traded.
  await step("upsert the 2027 season", () =>
    db.from("leagues").upsert(
      {
        season: NEXT_SEASON,
        name: "Ultimate Keeper League",
        espn_league_id: espnTeams.leagueId ?? null,
        team_count: managersFile.managers.length,
        draft_rounds: room.state.draftRoundCount || 16,
        settings: { note: "Placeholder season so 2027 picks can be traded." },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "season" },
    ),
  );
  record("leagues", 1);
}

// ===========================================================================
// MANAGER IDENTITY — FIRST NAMES ARE NOT UNIQUE IN THIS LEAGUE
// ===========================================================================
// Scott Elbe (short name "Elbe") and Scott Johnston (short name "Scott");
// Kyle Witte ("Witte") and Kyle Mertens ("Kyle"). Note the trap: "Scott" and
// "Kyle" are each BOTH a legitimate short name for one manager AND the first
// name of a different one, so a first-name match resolves to the wrong
// franchise silently rather than failing.
//
// THE RULE: key on the short name or on a stable id (`smartDraftTeamId`, the
// database `teams.id`). Never on a first name. Mirrored in
// `src/lib/league-json.ts`; keep the two in step.
// ===========================================================================

/** Smart Draft team id -> our teams.id. The safest key: an opaque UUID. */
const teamIdBySmartDraftId = new Map();
/** lowercase SHORT NAME -> our teams.id. Never a first or full name. */
const teamIdByShortName = new Map();
/** lowercase short name -> full manager name, for messages. */
const managerByShortName = new Map(
  managersFile.managers.map((m) => [m.shortName.trim().toLowerCase(), m.fullName]),
);

/**
 * Resolve a franchise from a name a data file supplied. Throws rather than guess
 * when the value is the first name of two managers.
 */
function teamIdFromName(supplied, context) {
  const key = String(supplied).trim().toLowerCase();
  const exact = teamIdByShortName.get(key);
  if (exact) return exact;

  const sharing = managersFile.managers.filter(
    (m) => m.fullName.split(/\s+/)[0].toLowerCase() === key,
  );
  if (sharing.length > 1) {
    throw new Error(
      `${context}: "${supplied}" is ambiguous — it is the first name of ` +
        sharing.map((m) => `${m.fullName} (short name "${m.shortName}")`).join(" and ") +
        ". Use the short name.",
    );
  }
  return null;
}

/** Short names are the join key for every source, so they must be unique. */
function assertShortNamesAreUnique() {
  const seen = new Map();
  for (const m of managersFile.managers) {
    const key = m.shortName.trim().toLowerCase();
    if (seen.has(key)) {
      console.error(
        `data/managers.json: "${m.shortName}" is the short name of both ` +
          `${seen.get(key)} and ${m.fullName}.`,
      );
      process.exit(1);
    }
    seen.set(key, m.fullName);
  }
}

async function seedTeams() {
  console.log("teams");
  assertShortNamesAreUnique();

  const rows = managersFile.managers.map((m) => ({
    short_name: m.shortName,
    franchise_name: m.franchiseName,
    // data/managers.json already carries the ruling that Ted Buckman is Zach
    // Rakowski, so no override is needed here.
    manager: m.fullName,
    abbrev: m.franchiseAbbrev ?? null,
    draft_slot: m.draftSlot2026 ?? null,
    espn_team_id: m.espnTeamId ?? null,
    smartdraft_team_id: m.smartDraftTeamId ?? null,
    updated_at: new Date().toISOString(),
  }));

  // Upserted on the short name, which is the stable handle every source joins
  // on. A rename in the room would create a new franchise rather than update
  // one, which is why the room's team id is stored alongside.
  await step(`upsert ${rows.length} franchises`, () =>
    db.from("teams").upsert(rows, { onConflict: "short_name" }),
  );
  record("teams", rows.length);

  if (DRY_RUN) return;

  const { data, error } = await db
    .from("teams")
    .select("id, short_name, smartdraft_team_id");
  if (error) {
    console.error(`Could not read franchises back: ${error.message}`);
    process.exit(1);
  }
  for (const t of data) {
    teamIdByShortName.set(t.short_name.toLowerCase(), t.id);
    if (t.smartdraft_team_id) teamIdBySmartDraftId.set(t.smartdraft_team_id, t.id);
  }

  if (data.length !== managersFile.managers.length) {
    console.error(
      `Expected ${managersFile.managers.length} franchises, found ${data.length}.`,
    );
    process.exit(1);
  }
}

async function seedDraftOrder() {
  console.log("draft_order");
  if (DRY_RUN) return;

  // The commissioner's ruling: the Smart Draft order wins. ESPN had Colin 8th
  // and Stefan 10th, which is stale.
  const rows = managersFile.managers
    .filter((m) => m.draftSlot2026 != null)
    .map((m) => ({
      season: SEASON,
      slot: m.draftSlot2026,
      team_id: teamIdByShortName.get(m.shortName.toLowerCase()),
      source: "smartdraft",
      locked: false,
    }));

  await step(`upsert ${rows.length} draft slots`, () =>
    db.from("draft_order").upsert(rows, { onConflict: "season,slot" }),
  );
  record("draft_order", rows.length);
}

/** Smart Draft numeric player id (as text) for everyone the seed references. */
async function seedPlayers() {
  console.log("players");

  // The whole draftable pool, so keepers, trades and board slots all have
  // something to reference. Kickers are excluded: ESPN has both the K lineup
  // slot and the K roster limit at zero, and the schema rejects them.
  const rows = playerPool.players
    .filter((p) => p.position !== "K")
    .map((p) => ({
      player_id: String(p.id),
      full_name: p.name,
      position: p.position,
      nfl_team: p.nflTeam ?? null,
      bye_week: p.byeWeek ?? null,
      adp: p.adp ?? null,
      source: "smartdraft",
      metadata: { sortAdp: p.sortAdp ?? null },
      refreshed_at: playerPool.fetchedAt ?? new Date().toISOString(),
    }));

  // Chunked: 1,200-odd rows in one request is a large body and a single failure
  // point, and PostgREST is happier with batches.
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = rows.slice(i, i + CHUNK);
    await step(`upsert players ${i + 1}-${i + batch.length}`, () =>
      db.from("players").upsert(batch, { onConflict: "player_id" }),
    );
  }
  record("players", rows.length);
}

/** Guard: never rewrite a board that the room is drafting off. */
async function assertBoardIsSafeToWrite() {
  if (DRY_RUN) return;
  const { data } = await db
    .from("draft_state")
    .select("status")
    .eq("season", SEASON)
    .maybeSingle();
  if (data && data.status !== "not_started" && !FORCE) {
    console.error(
      `\nThe ${SEASON} draft is "${data.status}". Re-seeding would rewrite the board ` +
        `the room is drafting off.\nRe-run with --force if that is genuinely what you want.`,
    );
    process.exit(1);
  }
}

async function seedBoard() {
  console.log("pick_ownership, draft_slots, traded_picks");
  if (DRY_RUN) return;

  const slots = [...room.state.slots].sort((a, b) => a.overallPick - b.overallPick);

  // pick_ownership: the pick as an ASSET, one row per (round, original owner).
  const ownership = slots.map((s) => ({
    season: SEASON,
    round: s.displayRound,
    original_team: teamIdBySmartDraftId.get(s.originalOwnerTeamId),
    current_team: teamIdBySmartDraftId.get(s.currentOwnerTeamId),
    updated_at: new Date().toISOString(),
  }));

  const missing = ownership.filter((o) => !o.original_team || !o.current_team);
  if (missing.length) {
    console.error(
      `${missing.length} board slots reference a franchise that is not in the room.`,
    );
    process.exit(1);
  }

  await step(`upsert ${ownership.length} 2026 pick-ownership rows`, () =>
    db
      .from("pick_ownership")
      .upsert(ownership, { onConflict: "season,round,original_team" }),
  );
  record("pick_ownership", ownership.length);

  // 2027: every franchise owns its own picks. The Johnston/Blome 2027 legs
  // cancel out, so there is nothing traded to record.
  const nextSeason = [];
  for (const m of managersFile.managers) {
    const id = teamIdByShortName.get(m.shortName.toLowerCase());
    for (let round = 1; round <= (room.state.draftRoundCount || 16); round++) {
      nextSeason.push({
        season: NEXT_SEASON,
        round,
        original_team: id,
        current_team: id,
        updated_at: new Date().toISOString(),
      });
    }
  }
  await step(`upsert ${nextSeason.length} 2027 pick-ownership rows`, () =>
    db
      .from("pick_ownership")
      .upsert(nextSeason, {
        onConflict: "season,round,original_team",
        // Do NOT overwrite a 2027 pick that has since been traded in the app.
        ignoreDuplicates: true,
      }),
  );
  record("pick_ownership (2027)", nextSeason.length);

  // draft_slots: the 160 board cells, with original and current ownership.
  const boardRows = slots.map((s) => ({
    season: SEASON,
    round: s.displayRound,
    pick_in_round: s.pickInRound,
    overall_pick: s.overallPick,
    original_team_id: teamIdBySmartDraftId.get(s.originalOwnerTeamId),
    current_team_id: teamIdBySmartDraftId.get(s.currentOwnerTeamId),
    player_id: s.player ? String(s.player.id) : null,
    is_keeper: s.pickType === "KEEPER",
    smartdraft_slot_key: s.slotKey,
    updated_at: new Date().toISOString(),
  }));

  const CHUNK = 80;
  for (let i = 0; i < boardRows.length; i += CHUNK) {
    const batch = boardRows.slice(i, i + CHUNK);
    await step(`upsert board slots ${i + 1}-${i + batch.length}`, () =>
      db
        .from("draft_slots")
        .upsert(batch, { onConflict: "season,round,original_team_id" }),
    );
  }
  record("draft_slots", boardRows.length);

  // traded_picks: the log. Seed-owned, so replaced wholesale on a re-run.
  await step("clear seeded traded-pick log", () =>
    db.from("traded_picks").delete().eq("season", SEASON).is("trade_id", null),
  );

  const tradedRows = slots
    .filter((s) => s.originalOwnerTeamId !== s.currentOwnerTeamId)
    .map((s) => ({
      season: SEASON,
      round: s.displayRound,
      original_team: teamIdBySmartDraftId.get(s.originalOwnerTeamId),
      // The room gives the net position, not each hop, so the immediate sender
      // is unknown. Left null rather than guessed at; the trade log carries the
      // narrative.
      from_team: null,
      current_team: teamIdBySmartDraftId.get(s.currentOwnerTeamId),
      trade_id: null,
    }));

  await step(`insert ${tradedRows.length} traded-pick log rows`, () =>
    db.from("traded_picks").insert(tradedRows),
  );
  record("traded_picks", tradedRows.length);

  await step("set the draft state to not_started", () =>
    db.from("draft_state").upsert(
      {
        season: SEASON,
        status: "not_started",
        clock_seconds: 120,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "season" },
    ),
  );
  record("draft_state", 1);
}

async function seedKeepers() {
  console.log("keepers, keeper_rights");
  if (DRY_RUN) return;

  const resolved = new Map(
    resolvedKeepers.keepers.map((k) => [normalizeName(k.player), k]),
  );
  const sheet = new Map(keeperSheet.players.map((p) => [normalizeName(p.player), p]));

  const keeperSlots = room.state.slots.filter((s) => s.pickType === "KEEPER" && s.player);

  const rows = [];
  const rights = [];
  const unresolved = [];
  /** Rows that came from data/keeper-declarations.json, for board placement. */
  const fromDeclarationFile = [];

  const disputed = new Set(DISPUTED_DECLARATIONS.map(normalizeName));
  const skipped = [];

  for (const slot of keeperSlots) {
    const player = slot.player;
    const key = normalizeName(player.name);

    if (disputed.has(key)) {
      skipped.push(player.name);
      continue;
    }
    const teamId = teamIdBySmartDraftId.get(slot.currentOwnerTeamId);
    if (!teamId) {
      console.error(`Keeper ${player.name} references an unknown franchise.`);
      process.exit(1);
    }

    // The room is authoritative for the cost round and the owner; the sheets are
    // authoritative for the clock — but ONLY where the sheet agrees about who
    // holds the player. A row belonging to another franchise describes that
    // franchise's tenure, so it is declined and reported rather than believed.
    // This is what stops one Scott's keeper being priced off the other's clock.
    const ownerShortName = (
      managersFile.managers.find((m) => m.smartDraftTeamId === slot.currentOwnerTeamId)
        ?.shortName ?? ""
    ).trim().toLowerCase();
    const rRow = resolved.get(key);
    const sRow = sheet.get(key);
    const r = rRow && String(rRow.owner).trim().toLowerCase() === ownerShortName ? rRow : undefined;
    const s = sRow && String(sRow.manager).trim().toLowerCase() === ownerShortName ? sRow : undefined;

    const declined = [];
    if (rRow && !r) declined.push(`reconciled list has him on ${rRow.owner}`);
    if (sRow && !s) declined.push(`keeper sheet has him under ${sRow.managerFullName ?? sRow.manager}`);

    let costRound = slot.displayRound;
    let sheetTenureYear = r?.clockYear2026 ?? parseSheetTenure(s?.status2026) ?? null;
    let basisRound = r?.priorSeasonCostRound ?? s?.round2025 ?? null;
    let isUndrafted = false;
    let acquiredByTrade = Boolean(r?.acquiredByTradePerSpreadsheet);
    let clockResetByTrade = false;
    let source = r || s ? "spreadsheet" : "smartdraft";
    let notes = r?.UNRESOLVED ?? null;
    if (declined.length) {
      notes = [
        `Ownership disagreement: the live room has him on ${managerByShortName.get(ownerShortName) ?? ownerShortName}, but the ${declined.join("; the ")}. The room wins; that source's clock was not used.`,
        notes,
      ]
        .filter(Boolean)
        .join(" ");
    }

    if (key === normalizeName(NACUA.name)) {
      sheetTenureYear = NACUA.sheetTenureYear;
      acquiredByTrade = NACUA.acquiredByTrade;
      clockResetByTrade = NACUA.clockResetByTrade;
      source = "commissioner";
      notes = NACUA.notes;
    }

    if (key === normalizeName(LOVELAND.name)) {
      costRound = LOVELAND.costRound;
      isUndrafted = LOVELAND.isUndrafted;
      basisRound = null; // an undrafted player has no round to his name
      source = "commissioner";
      notes = LOVELAND.notes;
    }

    if (sheetTenureYear == null) {
      unresolved.push(`${player.name} (${managerByShortName.get(ownerShortName) ?? ownerShortName})`);
    }

    const seasonsKept =
      sheetTenureYear == null ? 0 : seasonsKeptFromSheetTenure(sheetTenureYear);

    rows.push({
      season: SEASON,
      team_id: teamId,
      player_id: String(player.id),
      cost_round: costRound,
      basis_round: isUndrafted ? null : basisRound,
      is_undrafted: isUndrafted,
      // Written together from one value. The database CHECK holds them to
      // seasons_kept = max(0, sheet_tenure_year - 2).
      sheet_tenure_year: sheetTenureYear,
      seasons_kept: seasonsKept,
      acquired_by_trade: acquiredByTrade,
      clock_reset_by_trade: clockResetByTrade,
      status: "placed",
      source,
      notes,
      updated_at: new Date().toISOString(),
    });

    rights.push({
      player_id: String(player.id),
      is_undrafted: isUndrafted,
      original_round: null,
      basis_round: isUndrafted ? null : basisRound,
      current_team_id: teamId,
      consecutive_seasons: seasonsKept,
      last_team_id: null,
      prior_owner_clocks: {},
      updated_at: new Date().toISOString(),
    });
  }

  // ---------------------------------------------------------------------
  // Declarations the commissioner has received but the room does not show yet.
  // Priced from the eligibility sheet by the same rule as everything else — a
  // cost round is never taken from the declaration file.
  // ---------------------------------------------------------------------
  const inRoom = new Set(keeperSlots.map((s) => normalizeName(s.player.name)));
  const poolByName = new Map(
    playerPool.players.map((p) => [normalizeName(p.name), p]),
  );

  for (const decl of manualDeclarations.declarations ?? []) {
    const teamId = teamIdFromName(
      decl.managerShortName,
      `data/keeper-declarations.json declaration for "${decl.managerShortName}"`,
    );
    if (!teamId) {
      console.error(
        `data/keeper-declarations.json: "${decl.managerShortName}" is not a known ` +
          `short name. Use the short name from data/managers.json.`,
      );
      process.exit(1);
    }
    const ownerShort = decl.managerShortName.trim().toLowerCase();
    const ownerFull = managerByShortName.get(ownerShort) ?? decl.managerShortName;

    for (const playerName of decl.players ?? []) {
      const key = normalizeName(playerName);

      if (inRoom.has(key)) {
        console.log(
          `  note: ${playerName} is already a keeper in the room — ` +
            `ignoring the duplicate entry in keeper-declarations.json.`,
        );
        continue;
      }

      const poolPlayer = poolByName.get(key);
      if (!poolPlayer) {
        console.error(
          `\nCannot record ${ownerFull}'s keeper "${playerName}": no such player in ` +
            `data/smartdraft-players.json. Check the spelling against the pool.`,
        );
        process.exit(1);
      }

      // OWNER-MATCHED, as everywhere else: a sheet row belonging to another
      // franchise describes that franchise's tenure, not this one's.
      const sRow = sheet.get(key);
      if (!sRow) {
        console.error(
          `\nCannot price ${ownerFull}'s keeper ${playerName}: he has no row in ` +
            `data/keeper-eligibility-2026.json, so his 2025 round is unknown.\n` +
            `Refusing to guess a cost round — a wrong one is a wrong cell on the board.`,
        );
        process.exit(1);
      }
      if (String(sRow.manager).trim().toLowerCase() !== ownerShort) {
        console.error(
          `\nCannot price ${ownerFull}'s keeper ${playerName}: the eligibility sheet ` +
            `has him under ${sRow.managerFullName ?? sRow.manager}, not ${ownerFull}.\n` +
            `Refusing to price one franchise's keeper off another's tenure. If he was ` +
            `acquired, confirm the round he occupied in 2025 and record a ruling.`,
        );
        process.exit(1);
      }

      const sheetTenureYear = parseSheetTenure(sRow.status2026);
      if (sheetTenureYear == null) {
        console.error(
          `\nCannot price ${ownerFull}'s keeper ${playerName}: the eligibility sheet ` +
            `gives his 2026 clock as "${sRow.status2026}", which is not an "N of 3" ` +
            `value. He may be out of keeper seasons. Needs a ruling.`,
        );
        process.exit(1);
      }

      const seasonsKept = seasonsKeptFromSheetTenure(sheetTenureYear);
      const basisRound = sRow.round2025 ?? null;
      const isUndrafted = basisRound == null;
      const costRound = deriveCostRound({ basisRound, seasonsKept, isUndrafted });

      // A keeper occupies a pick the franchise HOLDS in that round. It does not
      // have to be its own: four of the room's existing keepers sit on acquired
      // picks (Kyle's Jaxon Smith-Njigba is on Elbe's R4, and so on).
      const holdsRound = room.state.slots.some(
        (slot) =>
          slot.displayRound === costRound &&
          teamIdBySmartDraftId.get(slot.currentOwnerTeamId) === teamId,
      );
      if (!holdsRound) {
        console.error(
          `\nCannot place ${ownerFull}'s keeper ${playerName} at R${costRound}: ` +
            `${ownerFull} holds no round-${costRound} pick in 2026, own or acquired.\n` +
            `This is the Colston Loveland situation and it needs a ruling, not a guess.`,
        );
        process.exit(1);
      }

      // Same-round conflicts within this franchise, resolved the expensive way
      // (bump earlier), matching `resolveSameRoundConflicts` in keeper-clock.
      const taken = new Set(rows.filter((r) => r.team_id === teamId).map((r) => r.cost_round));
      let finalRound = costRound;
      while (taken.has(finalRound) && finalRound > 1) finalRound -= 1;
      if (taken.has(finalRound)) {
        console.error(
          `\nCannot place ${ownerFull}'s keeper ${playerName}: every round at or ` +
            `below R${costRound} is already taken by another of his keepers.`,
        );
        process.exit(1);
      }

      rows.push({
        season: SEASON,
        team_id: teamId,
        player_id: String(poolPlayer.id),
        cost_round: finalRound,
        basis_round: isUndrafted ? null : basisRound,
        is_undrafted: isUndrafted,
        sheet_tenure_year: sheetTenureYear,
        seasons_kept: seasonsKept,
        acquired_by_trade: false,
        clock_reset_by_trade: false,
        status: "declared",
        source: "commissioner",
        notes:
          `Declared to the commissioner on ${decl.declaredAt ?? "an unrecorded date"} and ` +
          `not yet entered in the Smart Draft room. Cost round derived from the 2026 ` +
          `eligibility sheet: R${basisRound ?? "n/a"} in 2025 minus one = R${costRound}` +
          (finalRound !== costRound ? `, bumped to R${finalRound} to avoid a same-round clash` : "") +
          `.` + (decl.note ? ` ${decl.note}` : ""),
        updated_at: new Date().toISOString(),
      });

      rights.push({
        player_id: String(poolPlayer.id),
        is_undrafted: isUndrafted,
        original_round: null,
        basis_round: isUndrafted ? null : basisRound,
        current_team_id: teamId,
        consecutive_seasons: seasonsKept,
        last_team_id: null,
        prior_owner_clocks: {},
        updated_at: new Date().toISOString(),
      });

      fromDeclarationFile.push({
        playerId: String(poolPlayer.id),
        playerName,
        teamId,
        ownerFull,
        costRound: finalRound,
      });

      console.log(
        `  + ${ownerFull}: ${playerName} at R${finalRound} ` +
          `(R${basisRound} in 2025, ${sheetTenureYear} of 3) — from keeper-declarations.json`,
      );
    }
  }

  // Replace only what the seed owns, so a declaration made in the app survives.
  await step("clear seeded keeper declarations", () =>
    db.from("keepers").delete().eq("season", SEASON).in("source", SEED_SOURCES),
  );

  await step(`insert ${rows.length} keepers`, () => db.from("keepers").insert(rows));
  record("keepers", rows.length);

  await step(`upsert ${rights.length} keeper-rights rows`, () =>
    db.from("keeper_rights").upsert(rights, { onConflict: "player_id" }),
  );
  record("keeper_rights", rights.length);

  if (unresolved.length) {
    console.log(
      `  note: no keeper-sheet clock matched ${unresolved.join(", ")} — seeded at year 1.`,
    );
  }

  if (skipped.length) {
    console.log(
      `  note: skipped ${skipped.join(", ")} — listed in DISPUTED_DECLARATIONS.`,
    );
  }

  // The room is the source of truth for declarations, and it moves. Say plainly
  // where each row came from, so a stale reconciled file cannot pass unnoticed.
  const resolvedNames = new Set(
    resolvedKeepers.keepers.map((k) => normalizeName(k.player)),
  );
  const newInRoom = keeperSlots
    .filter((s) => !resolvedNames.has(normalizeName(s.player.name)))
    .map((s) => {
      const m = managersFile.managers.find(
        (x) => x.smartDraftTeamId === s.currentOwnerTeamId,
      );
      return `${s.player.name} (${m ? m.fullName : "?"}, R${s.displayRound})`;
    });
  const fromFile = fromDeclarationFile.map(
    (d) => `${d.playerName} (${d.ownerFull}, R${d.costRound})`,
  );

  console.log(
    `  provenance: ${rows.length} declarations total — ` +
      `${resolvedKeepers.keepers.length} in data/keepers-2026-resolved.json, ` +
      `${newInRoom.length} added to the room since that file was written, ` +
      `${fromFile.length} from data/keeper-declarations.json.`,
  );
  if (newInRoom.length) console.log(`    room, since the file: ${newInRoom.join("; ")}`);
  if (fromFile.length) console.log(`    declaration file:     ${fromFile.join("; ")}`);

  // The room already carries its own keepers on the board, but a declaration
  // that has not reached the room yet has to be placed here or the board would
  // show the slot as open. A keeper may occupy an ACQUIRED pick — four of the
  // room's own keepers do — so the target is any free slot the franchise holds
  // in that round, preferring its own.
  for (const d of fromDeclarationFile) {
    const { data: candidates, error } = await db
      .from("draft_slots")
      .select("id, original_team_id, player_id")
      .eq("season", SEASON)
      .eq("round", d.costRound)
      .eq("current_team_id", d.teamId);
    if (error) {
      console.error(`Could not read round-${d.costRound} slots: ${error.message}`);
      process.exit(1);
    }

    const free = (candidates ?? []).filter(
      (c) => !c.player_id || c.player_id === d.playerId,
    );
    if (!free.length) {
      console.error(
        `\nCannot place ${d.ownerFull}'s ${d.playerName} at R${d.costRound}: every ` +
          `round-${d.costRound} pick he holds is already occupied.`,
      );
      process.exit(1);
    }

    const target = free.find((c) => c.original_team_id === d.teamId) ?? free[0];
    await step(`place ${d.playerName} on the board at R${d.costRound}`, () =>
      db
        .from("draft_slots")
        .update({
          player_id: d.playerId,
          is_keeper: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", target.id),
    );

    const ownSlot = target.original_team_id === d.teamId;
    console.log(
      `    placed ${d.playerName} on ${ownSlot ? "his own" : "an acquired"} R${d.costRound} slot`,
    );
    record("draft_slots (keeper placements)", 1);
  }

  // ---------------------------------------------------------------------
  // CLOSED LISTS. A manager who declares fewer than the maximum has not
  // necessarily gone quiet — he may simply be keeping fewer, which is his
  // right. Only `teams.keeper_declarations_closed_at` can tell those apart,
  // and nothing in the room or the workbooks expresses it, so the
  // declaration file's `closesList` is the one place it is recorded.
  //
  // The timestamp is the manager's own `declaredAt`, not the time of the
  // seed run: re-seeding must not restate when he answered.
  // ---------------------------------------------------------------------
  for (const decl of manualDeclarations.declarations ?? []) {
    if (!decl.closesList) continue;

    const teamId = teamIdFromName(
      decl.managerShortName,
      `data/keeper-declarations.json closesList for "${decl.managerShortName}"`,
    );
    const ownerFull =
      managerByShortName.get(decl.managerShortName.trim().toLowerCase()) ??
      decl.managerShortName;

    const closedAt = decl.declaredAt
      ? new Date(`${decl.declaredAt}T00:00:00Z`).toISOString()
      : new Date().toISOString();

    await step(`close ${ownerFull}'s keeper list`, () =>
      db
        .from("teams")
        .update({ keeper_declarations_closed_at: closedAt })
        .eq("id", teamId),
    );
    console.log(
      `  ${ownerFull}'s keeper list is CLOSED as of ${decl.declaredAt ?? "now"} — ` +
        `unfilled slots are a deliberate pass, not an outstanding answer.`,
    );
  }
}

/**
 * Names the commissioner typed that no amount of fuzzy matching will resolve,
 * because they are misspellings rather than variants. Listed explicitly so the
 * trade log is complete and so a wrong guess is impossible.
 */
const PLAYER_NAME_ALIASES = {
  "puca nakua": "Puka Nacua",
  "treyveon henderson": "TreVeyon Henderson",
};

function buildPlayerIndex() {
  const index = new Map();
  for (const p of playerPool.players) {
    index.set(normalizeName(p.name), String(p.id));
    // The log writes "Packers D/ST"; the pool calls it "Green Bay Packers".
    if (p.position === "DST") {
      const nickname = p.name.split(/\s+/).slice(-1)[0];
      if (nickname) index.set(normalizeName(nickname), String(p.id));
    }
  }
  for (const [typed, real] of Object.entries(PLAYER_NAME_ALIASES)) {
    const id = index.get(normalizeName(real));
    if (id) index.set(normalizeName(typed), id);
  }
  return index;
}

/** Resolve a name from the trade log, allowing for "D/ST" suffixes. */
function resolvePlayerId(index, typedName) {
  const direct = index.get(normalizeName(typedName));
  if (direct) return direct;
  const withoutSuffix = String(typedName).replace(/\bD\/ST\b/i, "").trim();
  return index.get(normalizeName(withoutSuffix)) ?? null;
}

async function seedTrades() {
  console.log("trades, trade_assets");
  if (DRY_RUN) return;

  const players = buildPlayerIndex();
  const unmatched = [];

  // Seed-owned: replaced wholesale. Cascades to trade_assets.
  await step("clear imported trades", () =>
    db.from("trades").delete().eq("season", SEASON).eq("source", "spreadsheet-trade-log"),
  );

  let tradeCount = 0;
  let assetCount = 0;

  for (const t of tradeLog.trades) {
    const notes = t.notes ?? [];
    const contingent = notes.some((n) => /conting/i.test(n));

    // The log names managers by SHORT name: "Scott" is Johnston, "Elbe" is Elbe.
    const sideAId = teamIdFromName(t.sideA.member, `trade #${t.tradeNumber} side A`);
    const sideBId = teamIdFromName(t.sideB.member, `trade #${t.tradeNumber} side B`);
    if (!sideAId || !sideBId) {
      console.log(
        `  skipped trade #${t.tradeNumber}: unknown franchise ` +
          `(${t.sideA.member} / ${t.sideB.member})`,
      );
      continue;
    }

    const { data: trade, error } = await db
      .from("trades")
      .insert({
        season: SEASON,
        // Imported from the commissioner's log as history. Not 'accepted',
        // because accepting is what APPLIES a trade to the pick ledger, and the
        // room snapshot already reflects the net result — re-applying would
        // move the same picks twice.
        status: "proposed",
        notes: notes.length
          ? notes.join(" ")
          : `Imported from the commissioner's trade log, entry #${t.tradeNumber}.`,
        contingent,
        source: "spreadsheet-trade-log",
        source_ref: `Trade Log #${t.tradeNumber}`,
      })
      .select("id")
      .single();
    if (error) {
      console.error(`Could not insert trade #${t.tradeNumber}: ${error.message}`);
      process.exit(1);
    }
    tradeCount += 1;

    // Each side lists what that manager RECEIVED, so the counterparty is the
    // sender.
    const assets = [];
    for (const [side, fromId, toId] of [
      [t.sideA, sideBId, sideAId],
      [t.sideB, sideAId, sideBId],
    ]) {
      for (const typedName of side.playersReceived ?? []) {
        const playerId = resolvePlayerId(players, typedName);
        if (!playerId) {
          unmatched.push(`#${t.tradeNumber} "${typedName}"`);
          continue;
        }
        assets.push({
          trade_id: trade.id,
          from_team: fromId,
          to_team: toId,
          asset_type: "player",
          ref: playerId,
          keeper_clock_reset: true,
        });
      }
      for (const pick of side.picksReceived ?? []) {
        // The log writes some rounds as "1 (Stefan's)".
        const round =
          typeof pick.round === "number"
            ? pick.round
            : Number.parseInt(String(pick.round), 10);
        if (!round) continue;

        /**
         * That parenthetical is the pick's ORIGINAL owner, and it is the only
         * place the workbook records it. A round and a season do not identify a
         * pick once it has changed hands twice — trade #6 moves Stefan's R1 and
         * Colin's R4 through a third party — so the annotation is carried into
         * the asset ref rather than dropped. `parsePickRef` reads the third
         * segment; without it, `applyAsset` would resolve the sender's OWN pick
         * in that round and move the wrong one.
         */
        const via = /\(([^')]+)'s?\)/.exec(String(pick.round))?.[1];
        const originalTeamId = via
          ? teamIdFromName(via, `trade #${t.tradeNumber} pick annotation "${pick.round}"`)
          : null;
        if (via && !originalTeamId) {
          console.error(
            `Trade #${t.tradeNumber} names "${via}" as the original owner of a ` +
              `round-${round} pick and no franchise matches. Fix the log rather than ` +
              `importing a pick with no identity.`,
          );
          process.exit(1);
        }

        assets.push({
          trade_id: trade.id,
          from_team: fromId,
          to_team: toId,
          asset_type: "pick",
          ref: originalTeamId
            ? `${pick.year}:${round}:${originalTeamId}`
            : `${pick.year}:${round}`,
          keeper_clock_reset: false,
        });
      }
    }

    // The log records the same pick twice in a few places (a pick annotated as
    // someone else's, received alongside a plain one of the same round), and the
    // table is unique on the asset. Dedupe rather than fail.
    const seen = new Set();
    const deduped = assets.filter((a) => {
      const key = `${a.from_team}|${a.to_team}|${a.asset_type}|${a.ref}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (deduped.length) {
      await step(`insert assets for trade #${t.tradeNumber}`, () =>
        db.from("trade_assets").insert(deduped),
      );
      assetCount += deduped.length;
    }
  }

  record("trades", tradeCount);
  record("trade_assets", assetCount);

  if (unmatched.length) {
    console.log(
      `  note: ${unmatched.length} player names in the log did not match the pool ` +
        `and were skipped as assets: ${unmatched.join(", ")}`,
    );
  }
}

async function seedGovernance() {
  console.log("commissioner_actions, officers");
  if (DRY_RUN) return;

  const rows = RULINGS.map((r) => ({
    season: SEASON,
    type: r.type,
    description: r.description,
    disclosure_note: r.disclosure_note,
    source_ref: r.source_ref,
  }));

  await step(`upsert ${rows.length} commissioner rulings`, () =>
    db
      .from("commissioner_actions")
      .upsert(rows, { onConflict: "season,source_ref" }),
  );
  record("commissioner_actions", rows.length);

  // -------------------------------------------------------------------------
  // Officers. Kyle MERTENS is commissioner and the only officer — confirmed
  // Aug 26 2026. There is no vice commissioner and no CTO, so no rows for them:
  // an empty office is the truth, and inventing a holder would be worse than a
  // blank.
  //
  // `sba361`, the username the Smart Draft room gives its commissioner with no
  // mapping to a franchise, is Kyle Mertens. Recorded so nobody rediscovers it.
  //
  // KEYED ON THE FRANCHISE ID, NOT THE STRING "Kyle". This is the live
  // collision: "Kyle" is both Mertens' short name AND Witte's first name, so a
  // first-name match resolves silently to the wrong franchise. `teamIdFromName`
  // refuses a first name outright and `assertShortNamesAreUnique` has already
  // run, so the office cannot detach from the man.
  // -------------------------------------------------------------------------
  const commissionerTeamId = teamIdFromName(
    "Kyle",
    'officers: commissioner (Kyle Mertens, short name "Kyle")',
  );
  if (!commissionerTeamId) {
    throw new Error(
      'officers: could not resolve the franchise for short name "Kyle" (Kyle ' +
        "Mertens, the commissioner). Seed the teams first.",
    );
  }

  // Deterministic id rather than ON CONFLICT (season, role): that unique index
  // is PARTIAL (`where status <> 'removed'`), and Postgres will not accept a
  // partial index as a conflict target. A stable id gives idempotency without a
  // migration, and without flattening the index's intent.
  const officers = [
    {
      id: deterministicUuid(`officer:${SEASON}:commissioner`),
      season: SEASON,
      role: "commissioner",
      team_id: commissionerTeamId,
      manager: "Kyle Mertens",
      status: "active",
    },
  ];
  await step(`upsert ${officers.length} officer`, () =>
    db.from("officers").upsert(officers, { onConflict: "id" }),
  );
  record("officers", officers.length);

  // -------------------------------------------------------------------------
  // The league ballot — five items, seeded as motions at status 'proposed'.
  //
  // Ids are DETERMINISTIC (uuid v5 over a stable slug) so a re-seed updates the
  // same five rows instead of appending five more. `motions` has no natural
  // unique key, and adding one would need a migration for what is really just
  // idempotency.
  //
  // No proposer, no seconder and NO VOTES. Nobody has voted, and a seeded vote
  // would be fabricated. The proposer is left null because these were collected
  // from a conversation rather than formally moved by a franchise.
  // -------------------------------------------------------------------------
  const BALLOT = [
    {
      slug: "nacua-timeline",
      type: "Keeper eligibility — Puka Nacua timeline",
      threshold: "commissioner_ruling",
      effective_date: "2027-07-01",
      documentation:
        "When does Puka Nacua's keeper clock start with Scott? Counting from the " +
        "November 2025 in-season trade, his last season is 2027. Counting from the " +
        "pre-draft leg that returns him to Scott, it is 2028. Both arguments are " +
        "real: the keeper sheet records the 2025 reading, while Nacua genuinely was " +
        "off Scott's roster, which is the basis for the clock restarting in 2026. " +
        "TURNS ON: whether Scott keeps him in 2028. Nothing else — he is a legal " +
        "R11 keeper in 2026 under both readings. NOTE: this is an adjudication of " +
        "one case rather than a rule change, so Kyle may simply rule on it. " +
        "Recorded as disputed in the app rather than resolved. See data/DECISIONS.md.",
    },
    {
      slug: "trade-and-reset-loophole",
      type: "Major Structural Change — trade-and-reset loophole",
      threshold: "two_thirds",
      effective_date: "2027-07-01",
      documentation:
        "A trade restarts a player's keeper clock while his cost basis carries, so " +
        "two managers could swap a player to reset his tenure indefinitely at an " +
        "ever-cheaper round. TURNS ON: whether the three-season limit means " +
        "anything. DEADLINE IS BINDING — this must be settled BEFORE the 2027 " +
        "keeper clocks are computed, because changing it afterwards means " +
        "recomputing clocks managers have already planned their rosters around. " +
        "Not unprecedented: the same mechanism was used to hold Trey McBride a " +
        "third season, so any fix applies retroactively to everyone or to no one.",
    },
    {
      slug: "contingent-trades",
      type: "Major Structural Change — are contingent trades permitted",
      threshold: "two_thirds",
      effective_date: "2027-07-01",
      documentation:
        "The Johnston/Blome agreement is a contingent trade: it fires the day " +
        "before the draft unless Nacua is projected to miss six or more weeks. No " +
        "rule currently permits or forbids this, nor the related practice of an " +
        "in-season trade with a handshake to return the player next season. TURNS " +
        "ON: whether this class of deal is legal going forward. A rule is needed " +
        "before the next one is proposed. Does NOT unwind the existing trade — " +
        "Nacua is Scott's at R11 for 2026 by ruling.",
    },
    {
      slug: "future-season-picks",
      type: "Major Structural Change — trading future-season picks",
      threshold: "two_thirds",
      effective_date: "2027-07-01",
      documentation:
        "Trade #4 moves 2027 picks (R3 and R16) and the league never agreed rules " +
        "for trading into future seasons. Two sub-questions: how many seasons out " +
        "may a pick be traded, and is the ledger or the trade log authoritative " +
        "next year? The 2027 legs are in the log but not applied to the ledger, and " +
        "the log is now known to be incomplete. DEADLINE IS BINDING — the 2027 " +
        "rollover is computed from whichever source wins.",
    },
    {
      slug: "round-2-keeper-consequence",
      type: "Major Structural Change — round-2 keeper consequence",
      threshold: "two_thirds",
      effective_date: "2027-07-01",
      documentation:
        "Nobody decided this; it fell out of the round-1 ineligibility ruling. A " +
        "round-2 pick kept once prices to round 1, and a round-1 player cannot be " +
        "kept, so his second keeper season disappears even though the clock still " +
        "permits it. A round-2 pick therefore gets ONE keeper season, not two. " +
        "TURNS ON: whether that is accepted or an exception is carved out, which " +
        "requires deciding what a second keep would cost given there is no round " +
        "below 1. No precedent exists — the cheapest basis round among the 19 " +
        "keepers on the board is a 5th, so no manager has ever been in this position.",
    },
  ];

  const motionRows = BALLOT.map((m) => ({
    id: deterministicUuid(`ballot:${SEASON}:${m.slug}`),
    season: SEASON,
    type: m.type,
    status: "proposed",
    threshold: m.threshold,
    effective_date: m.effective_date,
    documentation: m.documentation,
  }));

  await step(`upsert ${motionRows.length} ballot motions`, () =>
    db.from("motions").upsert(motionRows, { onConflict: "id" }),
  );
  record("motions", motionRows.length);
  console.log(
    "  votes: left empty — nobody has voted, and a seeded vote would be fabricated",
  );
}

/**
 * A stable UUID for a stable string, so re-seeding a row that has no natural
 * unique key updates it instead of duplicating it. UUID v5 over the DNS
 * namespace; the value only has to be deterministic, not meaningful.
 */
function deterministicUuid(key) {
  const NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
  const hash = createHash("sha1");
  hash.update(Buffer.from(NAMESPACE.replace(/-/g, ""), "hex"));
  hash.update(key, "utf8");
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// --- run --------------------------------------------------------------------

async function main() {
  console.log(
    `Seeding ${SEASON} into ${SUPABASE_URL.replace(/https:\/\/([^.]+)\./, "https://$1.")}` +
      (DRY_RUN ? "  [DRY RUN]" : ""),
  );

  await seedLeague();
  await seedTeams();
  await seedDraftOrder();
  await seedPlayers();
  await assertBoardIsSafeToWrite();
  await seedBoard();
  await seedKeepers();
  await seedTrades();
  await seedGovernance();

  console.log("\nSeed complete.");
  for (const [label, n] of Object.entries(counts)) {
    console.log(`  ${label.padEnd(24)} ${n}`);
  }

  if (!DRY_RUN) {
    // A quick read-back, so the seed proves itself rather than just claiming to
    // have worked.
    const checks = await Promise.all([
      db.from("teams").select("id", { count: "exact", head: true }),
      db.from("draft_slots").select("id", { count: "exact", head: true }).eq("season", SEASON),
      db
        .from("draft_slots")
        .select("id", { count: "exact", head: true })
        .eq("season", SEASON)
        .eq("is_keeper", true),
      db.from("keepers").select("id", { count: "exact", head: true }).eq("season", SEASON),
      db.from("trades").select("id", { count: "exact", head: true }).eq("season", SEASON),
      db.from("players").select("player_id", { count: "exact", head: true }),
    ]);
    const [teams, slots, keeperSlotCount, keepers, trades, playerCount] = checks.map(
      (c) => c.count ?? 0,
    );

    console.log("\nRead-back from the database:");
    console.log(`  franchises               ${teams}`);
    console.log(`  board slots              ${slots}`);
    console.log(`  keeper slots on board    ${keeperSlotCount}`);
    console.log(`  keeper declarations      ${keepers}`);
    console.log(`  trades                   ${trades}`);
    console.log(`  players                  ${playerCount}`);
  }
}

main().catch((err) => {
  console.error(`\nSeed failed: ${err.message}`);
  process.exit(1);
});

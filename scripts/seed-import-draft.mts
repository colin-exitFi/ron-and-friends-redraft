/**
 * Import a finished draft into Postgres, so next August can price keepers.
 *
 *   npm run db:import:draft            # DRY RUN — prints every row it would write
 *   npm run db:import:draft -- --commit
 *
 * ============================================================================
 * WHY THIS IS A SCRIPT AND NOT A HOOK IN THE DRAFT ROOM
 * ============================================================================
 * `/draft` is deliberately file-backed: `draft-store.ts` writes
 * `data/draft-state-<season>.json` atomically, with a timestamped backup on
 * every pick, because the venue's wifi is not trusted. That is the right design
 * and this script does not change it. Nothing here runs on draft night and
 * nothing here is imported by the draft path, so the code the room executes on
 * Saturday is byte-for-byte the code that passed its verification suites.
 *
 * The state file persists, so the import can happen afterwards with identical
 * results. A database write wired into the pick handler would buy nothing and
 * would put a network call on the critical path of ten people waiting.
 *
 * ============================================================================
 * WHAT IT READS, AND WHY NOT THE CSV EXPORT
 * ============================================================================
 * Two file-backed sources, unioned to the full 160-slot board:
 *
 *   LIVE PICKS   `data/draft-state-<season>.json`, through the real
 *                `draftStore` so a corrupt file produces the store's own
 *                recovery message rather than a stack trace. Each pick carries
 *                `playerId` — the Smart Draft id, not a display name.
 *
 *   KEEPERS      the reconciled keeper layer, via `getBoard()`. Keepers are
 *                never written to the state file (see `draft-types.ts`), which
 *                is what lets a late declaration land without rewriting picks
 *                already entered. It also means the keeper half of the board
 *                has to come from the reconciled layer — which is the better
 *                source anyway, because it knows each keeper's 2025 basis and
 *                his 2026 cost round, and the basis walk needs both.
 *
 * NOT `/api/draft/export`. That CSV carries player NAMES and no ids, so
 * importing it would reintroduce the "Puca Nakua" class of error this project
 * has already been burned by once. The state file is id-keyed; the CSV is for
 * humans and printers.
 *
 * ============================================================================
 * IDEMPOTENT, AND DELIBERATELY NOT VIA `applyKeeperSeason`
 * ============================================================================
 * Every write is an ABSOLUTE value derived from the two files, never an
 * increment, so running this twice writes the same rows twice and changes
 * nothing the second time.
 *
 * That is why the keeper half does not call `applyKeeperSeason()`. That function
 * walks the cost basis down one round and advances the clock by one — correct
 * once, corrupting twice, and there is no season stamp on `keeper_rights` to
 * make it refuse a repeat (the roadmap's gap 4). A one-shot post-draft script
 * that might plausibly be run again "just to be sure" is exactly where that
 * would bite, so the post-2026 state is computed and written outright instead.
 *
 * Refuses loudly on anything ambiguous rather than guessing. Same discipline as
 * the keeper cost rounds: a wrong row here is a wrong price in August, argued
 * about with no way left to check.
 */

import process from "node:process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { boardFingerprint, buildRoomView, isDraftStateFile } from "@/lib/draft-engine";
import { draftStore } from "@/lib/draft-store";
import { getBoard } from "@/lib/smartdraft";
import { getKeeperBoardFromJson } from "@/lib/league-json";
import { CURRENT_SEASON, KEEPERS, TOTAL_PICKS } from "@/lib/league-config";
import type { KeeperEntry } from "@/lib/league-view";

// --- env --------------------------------------------------------------------

/**
 * `.env.local` into `process.env` before anything touches Supabase.
 * `@/lib/env` reads `process.env` lazily, so this is enough to make
 * `createServiceClient()` work outside Next — and it means pointing this script
 * at a scratch database is just an env override on the command line.
 */
function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(path.join(process.cwd(), file), "utf8");
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
      // A real environment variable wins, but only if it has a value: an
      // exported-but-empty one is what a shell leaves behind after sourcing a
      // file that was blank at the time, and it must not mask the real value.
      if (value && !process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}
loadEnvLocal();

// Imported after the env is in place — `keeper-rights` builds a client on call,
// not at module scope, but keeping the order explicit costs nothing.
const { recordDraftSelection } = await import("@/lib/keeper-rights");
const { createServiceClient } = await import("@/lib/supabase/server");

// --- arguments --------------------------------------------------------------

const argv = process.argv.slice(2);
const COMMIT = argv.includes("--commit");
/** Import a draft still in progress. For a mid-draft snapshot, not for the end. */
const ALLOW_INCOMPLETE = argv.includes("--allow-incomplete");
const SEASON = Number(
  argv.find((a) => a.startsWith("--season="))?.slice("--season=".length) ?? CURRENT_SEASON,
);

/**
 * Read a state file from somewhere other than `data/draft-state-<season>.json`.
 *
 * Two uses, both real:
 *
 *   RECOVERY   every save drops a timestamped copy in `data/draft-backups/`. If
 *              the live file is lost or the laptop dies, point this at the
 *              newest good backup and the import proceeds normally.
 *   TESTING    lets the verification script import a simulated 160-pick draft
 *              without going anywhere near the file the room is drafting off.
 */
const STATE_FILE = argv.find((a) => a.startsWith("--state-file="))?.slice("--state-file=".length);

if (!Number.isInteger(SEASON)) {
  console.error("--season must be a year, e.g. --season=2026");
  process.exit(1);
}

// --- refusals ---------------------------------------------------------------

const problems: string[] = [];
function refuse(what: string) {
  problems.push(what);
}

function bail(): never {
  console.error(
    `\n${"=".repeat(72)}\nREFUSING TO IMPORT — ${problems.length} problem(s)\n${"=".repeat(72)}`,
  );
  for (const p of problems) console.error(`\n  • ${p}`);
  console.error(
    `\nNothing was written. Every one of these is a wrong row in August if\n` +
      `guessed at, so fix the cause and re-run.\n`,
  );
  process.exit(1);
}

// --- read both artifacts ----------------------------------------------------

console.log(`\nImporting the ${SEASON} draft${COMMIT ? "" : " — DRY RUN, nothing will be written"}`);
console.log("─".repeat(72));

const board = getBoard();

/**
 * The default path goes through the real `draftStore`, so a corrupt file
 * produces the store's own recovery instructions. An explicit path is read
 * directly but validated by the same `isDraftStateFile` guard the store uses,
 * so neither route can accept a file that is merely valid JSON.
 */
const state = STATE_FILE
  ? (() => {
      const parsed: unknown = JSON.parse(readFileSync(STATE_FILE, "utf8"));
      if (!isDraftStateFile(parsed)) {
        console.error(`\n${STATE_FILE} is not a draft state file.`);
        process.exit(1);
      }
      return parsed;
    })()
  : await draftStore.read(SEASON, boardFingerprint(board));

const view = buildRoomView(board, state);

console.log(
  `  state file    ${state.picks.length} live picks, last saved ${state.updatedAt ?? "never"}` +
    (STATE_FILE ? `\n                from ${STATE_FILE}` : ""),
);
console.log(`  board         ${board.slots.length} slots, ${board.keeperCount} keepers`);
console.log(`  filled        ${view.filled} of ${TOTAL_PICKS}`);

if (state.season !== SEASON) {
  refuse(
    `The state file says season ${state.season} but this run is for ${SEASON}. ` +
      `Nothing about a draft is worth importing into the wrong year.`,
  );
}

if (state.picks.length === 0 && !ALLOW_INCOMPLETE) {
  refuse(
    `The state file holds no live picks, so there is no draft result to import — ` +
      `only the ${board.keeperCount} keepers the seed already loaded. If you meant to ` +
      `import a partial board, pass --allow-incomplete.`,
  );
}

/**
 * Conflicts mean the Smart Draft snapshot moved under a draft already entered —
 * a keeper landing on a slot that was picked, most plausibly. The engine can
 * render that for a human to resolve; an importer must not pick a side.
 */
if (view.conflicts.length) {
  refuse(
    `The board and the entered picks disagree in ${view.conflicts.length} place(s), so ` +
      `which player belongs in those slots is a question for the commissioner:\n` +
      view.conflicts.map((c) => `      ${c.label}: ${c.message}`).join("\n"),
  );
}

if (view.filled !== TOTAL_PICKS && !ALLOW_INCOMPLETE) {
  const open = view.slots.filter((s) => s.fill === null);
  refuse(
    `Only ${view.filled} of ${TOTAL_PICKS} slots hold a player — ${open.length} are still open ` +
      `(${open.slice(0, 6).map((s) => s.label).join(", ")}${open.length > 6 ? ", …" : ""}). ` +
      `Either the draft is not finished or the wrong state file was read. ` +
      `Pass --allow-incomplete to import a partial board on purpose.`,
  );
}

// --- assemble the 160-slot truth -------------------------------------------

/** One row per occupied board slot, with everything the database needs. */
type Selection = {
  /** Smart Draft slot key — matches `draft_slots.smartdraft_slot_key`. */
  slotKey: string;
  label: string;
  round: number;
  overallPick: number;
  playerId: string;
  playerName: string;
  /** Smart Draft team id of the franchise that ends up with the player. */
  teamKey: string;
  teamShortName: string;
  isKeeper: boolean;
  /** Keepers only: the reconciled row, which carries the clock. */
  keeper: KeeperEntry | null;
};

const reconciled = getKeeperBoardFromJson();
const keeperByPlayerId = new Map(reconciled.keepers.map((k) => [k.playerId, k]));

const livePickBySlot = new Map(state.picks.map((p) => [p.slotId, p]));
const boardSlotById = new Map(board.slots.map((s) => [s.id, s]));

// A live pick whose slot the board no longer knows about cannot be placed at
// all, and silently dropping a pick is the worst available outcome.
for (const pick of state.picks) {
  if (!boardSlotById.has(pick.slotId)) {
    refuse(
      `Entered pick ${pick.label} (${pick.playerName}) is on slot ${pick.slotId}, which is not ` +
        `on the current board. The snapshot changed shape after the pick was entered.`,
    );
  }
}

const selections: Selection[] = [];

for (const slot of board.slots) {
  const live = livePickBySlot.get(slot.id);

  if (slot.isKeeper && slot.player) {
    if (live) {
      refuse(
        `${slot.label} holds keeper ${slot.player.name} AND an entered pick ` +
          `(${live.playerName}). One of them is wrong and the importer cannot choose.`,
      );
      continue;
    }
    const keeper = keeperByPlayerId.get(slot.player.id);
    if (!keeper) {
      refuse(
        `${slot.label} holds ${slot.player.name} as a keeper, but the reconciled keeper layer ` +
          `has no row for him, so his clock and cost basis are unknown. ` +
          `He would be written as a fresh draft pick, which silently gives his owner ` +
          `two extra keeper seasons.`,
      );
      continue;
    }
    selections.push({
      slotKey: slot.id,
      label: slot.label,
      round: slot.round,
      overallPick: slot.overallPick,
      playerId: slot.player.id,
      playerName: slot.player.name,
      teamKey: slot.currentOwner.id,
      teamShortName: slot.currentOwner.name,
      isKeeper: true,
      keeper,
    });
    continue;
  }

  if (!live) continue; // Open slot. Already accounted for above.

  // Three independent statements of the round travel with every pick: the
  // slot's own, the label the room typed it under, and the overall number.
  // They are cross-checked rather than trusted, because the round IS the price
  // next August and there is no way to re-derive it later.
  const labelRound = Number(live.label.split(".")[0]);
  if (labelRound !== slot.round || live.overallPick !== slot.overallPick) {
    refuse(
      `Entered pick ${live.label} (${live.playerName}) disagrees with its board slot ` +
        `${slot.label}: round ${labelRound} vs ${slot.round}, overall ${live.overallPick} vs ` +
        `${slot.overallPick}.`,
    );
    continue;
  }

  // Whoever HOLDS the pick drafts the player. On 29 traded slots this differs
  // from the original owner, and crediting the wrong one misprices a keeper and
  // hands him to the wrong franchise.
  if (live.teamId !== slot.currentOwner.id) {
    refuse(
      `Entered pick ${live.label} (${live.playerName}) is credited to ${live.teamName}, but ` +
        `${slot.label} is held by ${slot.currentOwner.name}.`,
    );
    continue;
  }

  selections.push({
    slotKey: slot.id,
    label: slot.label,
    round: slot.round,
    overallPick: slot.overallPick,
    playerId: live.playerId,
    playerName: live.playerName,
    teamKey: slot.currentOwner.id,
    teamShortName: slot.currentOwner.name,
    isKeeper: false,
    keeper: null,
  });
}

// Nobody can be in two places. This is the one that catches a commissioner
// override: the engine lets the same player be entered twice on purpose, with a
// standing warning, and the database's partial unique index would reject the
// second row halfway through the import.
const byPlayer = new Map<string, Selection[]>();
for (const s of selections) {
  byPlayer.set(s.playerId, [...(byPlayer.get(s.playerId) ?? []), s]);
}
for (const [, dupes] of byPlayer) {
  if (dupes.length > 1) {
    refuse(
      `${dupes[0].playerName} is on the board ${dupes.length} times ` +
        `(${dupes.map((d) => d.label).join(", ")}). The room allows this as a deliberate ` +
        `override; the database does not, and neither does a keeper ledger. ` +
        `Undo the duplicate in the draft room first.`,
    );
  }
}

// Every keeper the reconciled layer knows must be ON the board. If one is not,
// the overlay failed to place him and his 2026 season would go unrecorded —
// leaving him a season of clock he has actually used.
const onBoard = new Set(selections.filter((s) => s.isKeeper).map((s) => s.playerId));
for (const k of reconciled.keepers) {
  if (k.playerId.startsWith("unmatched:")) {
    refuse(
      `Keeper "${k.playerName}" (${k.teamShortName}) never matched a player in the Smart Draft ` +
        `pool, so he has no id to store. Fix the spelling in the declaration file.`,
    );
    continue;
  }
  if (!onBoard.has(k.playerId)) {
    refuse(
      `Keeper ${k.playerName} (${k.teamShortName}, R${k.costRound}) is in the reconciled layer ` +
        `but not on the board, so his 2026 keeper season would go unrecorded.`,
    );
  }
}

if (problems.length) bail();

// --- resolve names to database keys ----------------------------------------

const db = createServiceClient();

const { data: teamRows, error: teamErr } = await db
  .from("teams")
  .select("id, short_name, smartdraft_team_id");
if (teamErr) {
  console.error(`\nCould not read teams: ${teamErr.message}`);
  process.exit(1);
}

const teamUuidByKey = new Map<string, string>();
for (const t of teamRows ?? []) {
  if (t.smartdraft_team_id) teamUuidByKey.set(t.smartdraft_team_id, t.id);
}

for (const key of new Set(selections.map((s) => s.teamKey))) {
  if (!teamUuidByKey.has(key)) {
    const name = selections.find((s) => s.teamKey === key)!.teamShortName;
    refuse(
      `Franchise "${name}" (Smart Draft id ${key}) has no row with a matching ` +
        `teams.smartdraft_team_id. Run \`npm run db:seed\` first.`,
    );
  }
}

const { data: slotRows, error: slotErr } = await db
  .from("draft_slots")
  .select("id, smartdraft_slot_key, player_id, is_keeper, round, overall_pick")
  .eq("season", SEASON);
if (slotErr) {
  console.error(`\nCould not read draft_slots: ${slotErr.message}`);
  process.exit(1);
}

const dbSlotByKey = new Map(
  (slotRows ?? []).filter((r) => r.smartdraft_slot_key).map((r) => [r.smartdraft_slot_key!, r]),
);

for (const s of selections) {
  const row = dbSlotByKey.get(s.slotKey);
  if (!row) {
    refuse(
      `Board slot ${s.label} has no draft_slots row for ${SEASON} with a matching ` +
        `smartdraft_slot_key. Run \`npm run db:seed\` first.`,
    );
    continue;
  }
  if (row.round !== s.round || row.overall_pick !== s.overallPick) {
    refuse(
      `Board slot ${s.label} maps to a database row at round ${row.round}, overall ` +
        `${row.overall_pick}. The stored board and the snapshot have diverged; re-seed.`,
    );
  }
}

// Every drafted player must already exist in `players`, which the FK on
// `keeper_rights.player_id` enforces anyway — better to say which ones and why
// than to surface a raw constraint violation partway through.
const playerIds = [...new Set(selections.map((s) => s.playerId))];
const known = new Set<string>();
for (let i = 0; i < playerIds.length; i += 200) {
  const { data, error } = await db
    .from("players")
    .select("player_id")
    .in("player_id", playerIds.slice(i, i + 200));
  if (error) {
    console.error(`\nCould not read players: ${error.message}`);
    process.exit(1);
  }
  for (const p of data ?? []) known.add(p.player_id);
}
const unknownPlayers = selections.filter((s) => !known.has(s.playerId));
if (unknownPlayers.length) {
  refuse(
    `${unknownPlayers.length} drafted player(s) are not in the players table: ` +
      `${unknownPlayers.slice(0, 8).map((s) => `${s.playerName} (${s.label})`).join(", ")}` +
      `${unknownPlayers.length > 8 ? ", …" : ""}. The pool was refreshed after the last seed. ` +
      `Run \`npm run db:seed\` and re-run this.`,
  );
}

if (problems.length) bail();

// --- what the keeper ledger should say afterwards --------------------------

/** The absolute post-draft `keeper_rights` state for one player. */
type RightsWrite = {
  playerId: string;
  playerName: string;
  label: string;
  teamShortName: string;
  teamUuid: string;
  isKeeper: boolean;
  /** Round he occupied in THIS season — next season prices off it. */
  basisRound: number;
  /** Keeper seasons served after this season. */
  consecutiveSeasons: number;
};

const rightsWrites: RightsWrite[] = [];

for (const s of selections) {
  const teamUuid = teamUuidByKey.get(s.teamKey)!;

  if (!s.isKeeper) {
    // A real draft selection resets everything: the basis becomes the round he
    // was just taken in and the clock starts over. `recordDraftSelection` does
    // exactly this, and does it as an absolute upsert.
    rightsWrites.push({
      playerId: s.playerId,
      playerName: s.playerName,
      label: s.label,
      teamShortName: s.teamShortName,
      teamUuid,
      isKeeper: false,
      basisRound: s.round,
      consecutiveSeasons: 0,
    });
    continue;
  }

  const k = s.keeper!;
  // He has now SERVED this keeper season, so the clock advances by one and the
  // basis becomes the round he actually occupied this year.
  const served = k.seasonsKept + 1;
  if (served > KEEPERS.maxConsecutiveSeasons) {
    refuse(
      `${k.playerName} (${k.teamShortName}) would finish ${SEASON} having served ${served} keeper ` +
        `seasons, and the limit is ${KEEPERS.maxConsecutiveSeasons}. He should not have been ` +
        `keepable this year — this needs a ruling, not an import.`,
    );
    continue;
  }
  if (s.round !== k.costRound) {
    refuse(
      `${k.playerName} sits at ${s.label} on the board but the reconciled layer prices him at ` +
        `R${k.costRound}. Next season prices off the round he actually occupied, so these ` +
        `must agree.`,
    );
    continue;
  }
  rightsWrites.push({
    playerId: s.playerId,
    playerName: s.playerName,
    label: s.label,
    teamShortName: s.teamShortName,
    teamUuid,
    isKeeper: true,
    basisRound: s.round,
    consecutiveSeasons: served,
  });
}

if (problems.length) bail();

// --- report -----------------------------------------------------------------

const keeperCount = selections.filter((s) => s.isKeeper).length;
const pickCount = selections.length - keeperCount;

console.log(`\nTo write`);
console.log("─".repeat(72));
console.log(`  draft_slots     ${selections.length} slots (${pickCount} picks, ${keeperCount} keepers)`);
console.log(`  keeper_rights   ${rightsWrites.length} rows`);

const changing = selections.filter((s) => {
  const row = dbSlotByKey.get(s.slotKey)!;
  return row.player_id !== s.playerId || row.is_keeper !== s.isKeeper;
});
console.log(`  of those, ${changing.length} board slot(s) actually change; the rest already match`);

if (!COMMIT) {
  console.log(`\nEvery row, in board order`);
  console.log("─".repeat(72));
  for (const s of [...selections].sort((a, b) => a.overallPick - b.overallPick)) {
    const w = rightsWrites.find((r) => r.playerId === s.playerId)!;
    console.log(
      `  ${s.label.padEnd(6)} ${s.playerName.padEnd(24)} ${s.teamShortName.padEnd(8)} ` +
        `${s.isKeeper ? "KEEPER" : "pick  "}  basis R${String(w.basisRound).padStart(2)} ` +
        `clock ${w.consecutiveSeasons}/${KEEPERS.maxConsecutiveSeasons}`,
    );
  }
  console.log(
    `\n${"=".repeat(72)}\nDRY RUN — nothing written. Re-run with --commit to apply.\n${"=".repeat(72)}\n`,
  );
  process.exit(0);
}

// --- write ------------------------------------------------------------------

console.log(`\nWriting`);
console.log("─".repeat(72));

/**
 * Two phases, because `draft_slots_player_unique` forbids one player in two
 * slots within a season. If a player moved slots since the last import, the new
 * row has to be written after the old one is cleared, or the update collides
 * with a row this same import is about to vacate.
 *
 * On a clean re-run both phases are no-ops, which is what makes this safe to
 * run twice.
 */
const desiredByKey = new Map(selections.map((s) => [s.slotKey, s]));
const toClear = (slotRows ?? []).filter((row) => {
  if (!row.player_id) return false;
  const desired = row.smartdraft_slot_key
    ? desiredByKey.get(row.smartdraft_slot_key)
    : undefined;
  return !desired || desired.playerId !== row.player_id;
});

if (toClear.length) {
  const { error } = await db
    .from("draft_slots")
    .update({ player_id: null, is_keeper: false, updated_at: new Date().toISOString() })
    .in(
      "id",
      toClear.map((r) => r.id),
    );
  if (error) {
    console.error(`  FAILED clearing ${toClear.length} stale slot(s): ${error.message}`);
    process.exit(1);
  }
  console.log(`  cleared         ${toClear.length} slot(s) whose player changed`);
}

let slotsWritten = 0;
for (const s of changing) {
  const row = dbSlotByKey.get(s.slotKey)!;
  const { error } = await db
    .from("draft_slots")
    .update({
      player_id: s.playerId,
      is_keeper: s.isKeeper,
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id);
  if (error) {
    console.error(`  FAILED ${s.label} ${s.playerName}: ${error.message}`);
    process.exit(1);
  }
  slotsWritten += 1;
}
console.log(`  draft_slots     ${slotsWritten} written, ${selections.length - slotsWritten} already correct`);

// keeper_rights. Drafted players go through `recordDraftSelection`, which is the
// function that has always been right and has never been called.
let rightsWritten = 0;
for (const w of rightsWrites.filter((r) => !r.isKeeper)) {
  await recordDraftSelection(w.playerId, w.basisRound, w.teamUuid);
  rightsWritten += 1;
}
console.log(`  keeper_rights   ${rightsWritten} drafted players (basis = round taken, clock 0)`);

/**
 * Keepers are UPDATED rather than upserted, so `original_round` and
 * `prior_owner_clocks` — history this import has no business inventing —
 * survive untouched. `is_undrafted` is cleared because a player who has now
 * occupied a real board round has a real basis, and the
 * `keeper_rights_undrafted_has_no_basis` check forbids holding both.
 */
let keeperRightsWritten = 0;
for (const w of rightsWrites.filter((r) => r.isKeeper)) {
  const { error } = await db
    .from("keeper_rights")
    .update({
      is_undrafted: false,
      basis_round: w.basisRound,
      current_team_id: w.teamUuid,
      consecutive_seasons: w.consecutiveSeasons,
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", w.playerId);
  if (error) {
    console.error(`  FAILED keeper rights for ${w.playerName}: ${error.message}`);
    process.exit(1);
  }
  keeperRightsWritten += 1;
}
console.log(
  `  keeper_rights   ${keeperRightsWritten} keepers (basis walked to the round they occupied, clock +1)`,
);

/**
 * Marking the draft complete is also a guard: `seed-league.mjs` refuses to
 * rewrite a board whose `draft_state` is anything but `not_started`, so after
 * this runs an accidental re-seed cannot overwrite the result.
 */
if (!ALLOW_INCOMPLETE) {
  const { error } = await db
    .from("draft_state")
    .upsert(
      {
        season: SEASON,
        status: "complete",
        current_overall_pick: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "season" },
    );
  if (error) {
    console.error(`  FAILED marking the draft complete: ${error.message}`);
    process.exit(1);
  }
  console.log(`  draft_state     ${SEASON} marked complete`);
}

// --- prove it landed --------------------------------------------------------

console.log(`\nVerifying`);
console.log("─".repeat(72));

let verifyFailures = 0;
function verify(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "OK  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) verifyFailures += 1;
}

const { data: after } = await db
  .from("draft_slots")
  .select("smartdraft_slot_key, player_id, is_keeper")
  .eq("season", SEASON);

const afterByKey = new Map(
  (after ?? []).filter((r) => r.smartdraft_slot_key).map((r) => [r.smartdraft_slot_key!, r]),
);
const slotMismatches = selections.filter((s) => {
  const row = afterByKey.get(s.slotKey);
  return !row || row.player_id !== s.playerId || row.is_keeper !== s.isKeeper;
});
verify(
  `all ${selections.length} slots hold the right player, keepers flagged as keepers`,
  slotMismatches.length === 0,
  slotMismatches.slice(0, 5).map((s) => `${s.label} ${s.playerName}`).join(", "),
);

const { count: keeperFlagged } = await db
  .from("draft_slots")
  .select("id", { count: "exact", head: true })
  .eq("season", SEASON)
  .eq("is_keeper", true);
verify(`${keeperCount} slots flagged as keepers`, keeperFlagged === keeperCount, `got ${keeperFlagged}`);

const { count: pickFlagged } = await db
  .from("draft_slots")
  .select("id", { count: "exact", head: true })
  .eq("season", SEASON)
  .eq("is_keeper", false)
  .not("player_id", "is", null);
verify(`${pickCount} slots hold a live pick`, pickFlagged === pickCount, `got ${pickFlagged}`);

const rightsAfter = new Map<string, { basis_round: number | null; consecutive_seasons: number; current_team_id: string | null }>();
for (let i = 0; i < playerIds.length; i += 200) {
  const { data } = await db
    .from("keeper_rights")
    .select("player_id, basis_round, consecutive_seasons, current_team_id")
    .in("player_id", playerIds.slice(i, i + 200));
  for (const r of data ?? []) rightsAfter.set(r.player_id, r);
}

const rightsMismatches = rightsWrites.filter((w) => {
  const r = rightsAfter.get(w.playerId);
  return (
    !r ||
    r.basis_round !== w.basisRound ||
    r.consecutive_seasons !== w.consecutiveSeasons ||
    r.current_team_id !== w.teamUuid
  );
});
verify(
  `all ${rightsWrites.length} keeper-rights rows carry the right basis, clock and franchise`,
  rightsMismatches.length === 0,
  rightsMismatches.slice(0, 5).map((w) => `${w.playerName} (${w.label})`).join(", "),
);

console.log(
  `\n${"=".repeat(72)}\n` +
    (verifyFailures === 0
      ? `IMPORTED — ${SEASON} pedigree is in the database. ${pickCount} drafted, ${keeperCount} kept.\n` +
        `Every one of those ${selections.length} players can now be priced as a ${SEASON + 1} keeper.`
      : `${verifyFailures} VERIFICATION FAILURE(S) — the write is partial. Re-run to converge.`) +
    `\n${"=".repeat(72)}\n`,
);

process.exit(verifyFailures === 0 ? 0 : 1);

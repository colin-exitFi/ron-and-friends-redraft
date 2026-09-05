/**
 * Prove the draft importer lands all 160 rows correctly, end to end.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/seed-verify-import.mts
 *
 * WHAT IT DOES
 *   1. Drives a complete draft through the REAL engine — the same
 *      `@/lib/draft-engine` the room uses — filling every slot the keepers do
 *      not already occupy.
 *   2. Writes that finished draft to a scratch file under `.local/`, never to
 *      `data/draft-state-2026.json`. The live board must be pristine on
 *      Saturday, and a test that borrows the real file to prove a point is one
 *      interrupted run away from destroying it.
 *   3. Runs the importer against it TWICE, then asserts the second run changed
 *      nothing. Idempotency claimed is not idempotency demonstrated.
 *   4. Reads every row back and checks the pedigree a 2027 keeper price depends
 *      on: the round, the franchise, the clock, and keeper-versus-live-pick.
 *
 * POINT IT AT A SCRATCH DATABASE. It fills the board, which is the one thing
 * that must not happen to the real project before Saturday. It refuses to run
 * against a database that already has live picks, but the honest protection is
 * the env override:
 *
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54330 \
 *   SUPABASE_SERVICE_ROLE_KEY=<local key> \
 *   node ... scripts/seed-verify-import.mts
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { applyPick, boardFingerprint, buildRoomView, emptyState } from "@/lib/draft-engine";
import { buildTeamRosters } from "@/lib/draft-roster";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { getKeeperBoardFromJson } from "@/lib/league-json";
import { CURRENT_SEASON, KEEPERS, ROSTER, TOTAL_PICKS } from "@/lib/league-config";
import type { DraftRoomView, DraftStateFile } from "@/lib/draft-types";
import type { PoolPlayer } from "@/lib/board-types";

const ROOT = process.cwd();
const SEASON = CURRENT_SEASON;
const SCRATCH_DIR = path.join(ROOT, ".local");
const SCRATCH_STATE = path.join(SCRATCH_DIR, `draft-import-test-${SEASON}.json`);

// --- env --------------------------------------------------------------------

function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
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
      if (value && !process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}
loadEnvLocal();

const { createServiceClient } = await import("@/lib/supabase/server");
const db = createServiceClient();

// --- harness ----------------------------------------------------------------

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

// --- guard: never fill the real board --------------------------------------

section("0. The target database is safe to fill");

/**
 * REFUSE TO FILL A HOSTED BOARD. The live-picks check below is not enough on its
 * own: the real 2026 board legitimately has zero live picks until Saturday, so
 * that guard would wave this straight through and write 142 simulated picks onto
 * the board the room is about to draft off. The target must be local.
 */
const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(target);
if (!isLocal && !process.argv.includes("--allow-remote")) {
  console.error(
    `\n  REFUSING to run against ${target || "an unset URL"}.\n\n` +
      `  This suite FILLS THE BOARD with a simulated draft. The real board has zero\n` +
      `  live picks until Saturday, so the "is it empty" check below cannot protect\n` +
      `  you here. Point it at a scratch stack:\n\n` +
      `    node scripts/seed-local-stack.mjs up\n` +
      `    # export the URL and keys it prints, then re-run\n\n` +
      `  Pass --allow-remote if you really mean to fill a hosted board.\n`,
  );
  process.exit(1);
}
console.log(`  target ${target} is local — safe to fill`);

const { count: existingPicks } = await db
  .from("draft_slots")
  .select("id", { count: "exact", head: true })
  .eq("season", SEASON)
  .eq("is_keeper", false)
  .not("player_id", "is", null);

if (existingPicks && existingPicks > 0) {
  console.error(
    `\n  REFUSING: ${process.env.NEXT_PUBLIC_SUPABASE_URL} already holds ${existingPicks} live pick(s) ` +
      `for ${SEASON}.\n  This test fills the board, so it will only run against one that is empty.\n`,
  );
  process.exit(1);
}
console.log(`  target ${process.env.NEXT_PUBLIC_SUPABASE_URL} has no live picks — safe to fill`);

// --- 1. simulate a complete draft ------------------------------------------

section("1. Driving a complete draft through the real engine");

const board = getBoard();
const pool = getPlayerPool();
const reconciled = getKeeperBoardFromJson();

const FLEX_ACCEPTS = ["RB", "WR", "TE"];

/** Best available, unless the franchise has to fill a starting slot. */
function choosePlayer(view: DraftRoomView, teamId: string): PoolPlayer {
  const taken = new Set(view.draftedPlayerIds);
  const roster = buildTeamRosters(view).find((r) => r.team.id === teamId)!;
  const available = pool.filter((p) => !taken.has(p.id));
  const underCap = available.filter(
    (p) => (roster.byPosition[p.position] ?? 0) < (ROSTER.positionalMax[p.position] ?? Infinity),
  );
  if (roster.picksRemaining <= roster.needs.length && roster.needs.length > 0) {
    const need = roster.needs[0];
    const accepts = need === "FLEX" ? FLEX_ACCEPTS : [need];
    const forced = underCap.find((p) => accepts.includes(p.position));
    if (forced) return forced;
  }
  const choice = underCap[0] ?? available[0];
  if (!choice) throw new Error("The player pool ran dry.");
  return choice;
}

let state: DraftStateFile = emptyState(SEASON, boardFingerprint(board));
let view = buildRoomView(board, state);

let guard = 0;
while (view.onTheClockSlotId && guard++ < TOTAL_PICKS + 10) {
  const slot = view.slots.find((s) => s.id === view.onTheClockSlotId)!;
  const player = choosePlayer(view, slot.currentOwner.id);
  state = applyPick(board, state, {
    slotId: slot.id,
    playerId: player.id,
    playerName: player.name,
    position: player.position,
    nflTeam: player.nflTeam,
    byeWeek: player.byeWeek,
  });
  view = buildRoomView(board, state);
}

check(`the board filled all ${TOTAL_PICKS} slots`, view.filled === TOTAL_PICKS, `got ${view.filled}`);
check(
  `${TOTAL_PICKS - board.keeperCount} live picks entered against ${board.keeperCount} keepers`,
  state.picks.length === TOTAL_PICKS - board.keeperCount,
  `got ${state.picks.length}`,
);

mkdirSync(SCRATCH_DIR, { recursive: true });
writeFileSync(SCRATCH_STATE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
check("the simulated draft was written to a scratch path, not the real one", existsSync(SCRATCH_STATE));
check(
  "the real state file was not touched",
  (() => {
    const live = path.join(ROOT, "data", `draft-state-${SEASON}.json`);
    if (!existsSync(live)) return true;
    const parsed = JSON.parse(readFileSync(live, "utf8")) as DraftStateFile;
    return parsed.picks.length === 0;
  })(),
  "data/draft-state-2026.json still has zero picks",
);

// --- 2. import, twice -------------------------------------------------------

function runImporter(...extra: string[]) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      "./scripts/seed-verify-loader.mjs",
      "scripts/seed-import-draft.mts",
      `--season=${SEASON}`,
      `--state-file=${SCRATCH_STATE}`,
      ...extra,
    ],
    {
      encoding: "utf8",
      cwd: ROOT,
      env: { ...process.env, __UKL_VERIFY_LOADER: undefined },
    },
  );
}

section("2. Dry run reports without writing");
const dry = runImporter();
check("the dry run exited cleanly", dry.status === 0, `exit ${dry.status}\n${dry.stderr ?? ""}`);
check(
  "it said it would write nothing",
  /DRY RUN — nothing written/.test(dry.stdout ?? ""),
);

const { count: afterDry } = await db
  .from("draft_slots")
  .select("id", { count: "exact", head: true })
  .eq("season", SEASON)
  .eq("is_keeper", false)
  .not("player_id", "is", null);
check("and it truly wrote nothing", afterDry === 0, `${afterDry} live picks in the database`);

section("3. First import");
const first = runImporter("--commit");
if (first.status !== 0) console.log(first.stdout, first.stderr);
check("the import exited cleanly", first.status === 0, `exit ${first.status}`);
check("it reported success", /IMPORTED/.test(first.stdout ?? ""));

section("4. Second import — idempotency");
const second = runImporter("--commit");
if (second.status !== 0) console.log(second.stdout, second.stderr);
check("re-running exited cleanly", second.status === 0, `exit ${second.status}`);
check(
  "the second run found every board slot already correct and changed none",
  /0 board slot\(s\) actually change/.test(second.stdout ?? ""),
  (second.stdout ?? "").split("\n").find((l) => l.includes("actually change"))?.trim(),
);

// --- 5. every row landed ----------------------------------------------------

section("5. All 160 rows are in the database and correct");

const { data: slotRows } = await db
  .from("draft_slots")
  .select("smartdraft_slot_key, player_id, is_keeper, round, overall_pick, current_team_id")
  .eq("season", SEASON);

const filled = (slotRows ?? []).filter((r) => r.player_id);
check(`${TOTAL_PICKS} slots hold a player`, filled.length === TOTAL_PICKS, `got ${filled.length}`);
check(
  `${board.keeperCount} of them are flagged as keepers`,
  filled.filter((r) => r.is_keeper).length === board.keeperCount,
  `got ${filled.filter((r) => r.is_keeper).length}`,
);
check(
  `${TOTAL_PICKS - board.keeperCount} are flagged as live picks`,
  filled.filter((r) => !r.is_keeper).length === TOTAL_PICKS - board.keeperCount,
  `got ${filled.filter((r) => !r.is_keeper).length}`,
);
check(
  "no player occupies two slots",
  new Set(filled.map((r) => r.player_id)).size === filled.length,
);

// Slot-by-slot against the board the simulation actually drafted.
const dbByKey = new Map(
  (slotRows ?? []).filter((r) => r.smartdraft_slot_key).map((r) => [r.smartdraft_slot_key!, r]),
);
const wrongSlot: string[] = [];
for (const s of view.slots) {
  if (!s.player) continue;
  const row = dbByKey.get(s.id);
  if (!row) {
    wrongSlot.push(`${s.label} missing`);
    continue;
  }
  if (row.player_id !== s.player.id) wrongSlot.push(`${s.label} has the wrong player`);
  if (row.is_keeper !== (s.fill === "keeper")) wrongSlot.push(`${s.label} keeper flag wrong`);
}
check(
  "every slot holds exactly the player the room entered there",
  wrongSlot.length === 0,
  wrongSlot.slice(0, 5).join(", "),
);

// The traded picks are where a misattribution would hide.
const teamRows = (await db.from("teams").select("id, short_name, smartdraft_team_id")).data ?? [];
const uuidByKey = new Map(
  teamRows.filter((t) => t.smartdraft_team_id).map((t) => [t.smartdraft_team_id!, t.id]),
);
const tradedWrong: string[] = [];
for (const s of board.slots.filter((x) => x.traded)) {
  const row = dbByKey.get(s.id);
  if (row && row.current_team_id !== uuidByKey.get(s.currentOwner.id)) {
    tradedWrong.push(s.label);
  }
}
check(
  `all ${board.slots.filter((s) => s.traded).length} traded slots sit with the acquiring franchise`,
  tradedWrong.length === 0,
  tradedWrong.join(", "),
);

// --- 6. the pedigree a 2027 price depends on -------------------------------

section("6. Keeper pedigree — the whole reason for the import");

const playerIds = filled.map((r) => r.player_id!);
const rights = new Map<
  string,
  { basis_round: number | null; original_round: number | null; consecutive_seasons: number; current_team_id: string | null; is_undrafted: boolean }
>();
for (let i = 0; i < playerIds.length; i += 200) {
  const { data } = await db
    .from("keeper_rights")
    .select(
      "player_id, basis_round, original_round, consecutive_seasons, current_team_id, is_undrafted",
    )
    .in("player_id", playerIds.slice(i, i + 200));
  for (const r of data ?? []) rights.set(r.player_id, r);
}

check(
  `all ${TOTAL_PICKS} players on the board have a keeper-rights row`,
  rights.size === TOTAL_PICKS,
  `got ${rights.size}`,
);

// Drafted players: basis is the round they were taken in, clock at zero.
const draftedWrong: string[] = [];
for (const pick of state.picks) {
  const slot = board.slots.find((s) => s.id === pick.slotId)!;
  const r = rights.get(pick.playerId);
  if (!r) {
    draftedWrong.push(`${pick.playerName} has no row`);
    continue;
  }
  if (r.basis_round !== slot.round) {
    draftedWrong.push(`${pick.playerName} basis R${r.basis_round} but drafted in R${slot.round}`);
  }
  if (r.original_round !== slot.round) {
    draftedWrong.push(`${pick.playerName} original_round R${r.original_round}`);
  }
  if (r.consecutive_seasons !== 0) {
    draftedWrong.push(`${pick.playerName} clock ${r.consecutive_seasons}, should be 0`);
  }
  if (r.current_team_id !== uuidByKey.get(slot.currentOwner.id)) {
    draftedWrong.push(`${pick.playerName} credited to the wrong franchise`);
  }
  if (r.is_undrafted) draftedWrong.push(`${pick.playerName} marked undrafted`);
}
check(
  `all ${state.picks.length} drafted players carry the round they were taken in, clock at zero`,
  draftedWrong.length === 0,
  draftedWrong.slice(0, 5).join("; "),
);

// Keepers: basis walked to the round they occupied, clock advanced by one.
const keeperWrong: string[] = [];
for (const k of reconciled.keepers) {
  const r = rights.get(k.playerId);
  if (!r) {
    keeperWrong.push(`${k.playerName} has no row`);
    continue;
  }
  if (r.basis_round !== k.costRound) {
    keeperWrong.push(`${k.playerName} basis R${r.basis_round}, occupied R${k.costRound}`);
  }
  if (r.consecutive_seasons !== k.seasonsKept + 1) {
    keeperWrong.push(
      `${k.playerName} clock ${r.consecutive_seasons}, expected ${k.seasonsKept + 1}`,
    );
  }
  if (r.consecutive_seasons > KEEPERS.maxConsecutiveSeasons) {
    keeperWrong.push(`${k.playerName} is over the ${KEEPERS.maxConsecutiveSeasons}-season limit`);
  }
}
check(
  `all ${reconciled.keepers.length} keepers had the basis walked to this year's round and the clock advanced`,
  keeperWrong.length === 0,
  keeperWrong.slice(0, 6).join("; "),
);

// The six final-season keepers must now read as expired, which is what stops
// them being offered again in 2027.
const EXPIRING = [
  "Garrett Wilson",
  "Jaxon Smith-Njigba",
  "Brock Bowers",
  "Chase Brown",
  "Trey McBride",
  "Justin Jefferson",
];
const expiredNow = reconciled.keepers
  .filter((k) => EXPIRING.includes(k.playerName))
  .filter((k) => (rights.get(k.playerId)?.consecutive_seasons ?? 0) >= KEEPERS.maxConsecutiveSeasons)
  .map((k) => k.playerName)
  .sort();
check(
  "the six final-season keepers now read as clock-expired",
  JSON.stringify(expiredNow) === JSON.stringify([...EXPIRING].sort()),
  expiredNow.join(", "),
);

// A keeper who is NOT in his final season must still have room left.
const stillKeepable = reconciled.keepers.filter((k) => !k.finalSeason);
check(
  `the other ${stillKeepable.length} keepers still have clock left for 2027`,
  stillKeepable.every(
    (k) => (rights.get(k.playerId)?.consecutive_seasons ?? 99) < KEEPERS.maxConsecutiveSeasons,
  ),
  stillKeepable
    .filter((k) => (rights.get(k.playerId)?.consecutive_seasons ?? 99) >= KEEPERS.maxConsecutiveSeasons)
    .map((k) => k.playerName)
    .join(", "),
);

section("7. The draft is marked complete, so a re-seed cannot overwrite it");
const { data: draftState } = await db
  .from("draft_state")
  .select("status")
  .eq("season", SEASON)
  .maybeSingle();
check(`draft_state is "complete"`, draftState?.status === "complete", `got ${draftState?.status}`);

// --- cleanup ----------------------------------------------------------------

rmSync(SCRATCH_STATE, { force: true });

console.log(
  `\n${"=".repeat(72)}\n${failures === 0 ? "ALL IMPORT CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n${"=".repeat(72)}\n`,
);
process.exit(failures === 0 ? 0 : 1);

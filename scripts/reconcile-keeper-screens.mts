/**
 * Same question as `reconcile-keepers.mts`, asked one layer up: not "which
 * source lists which keeper" but "what number does each SCREEN actually print".
 *
 * The two can disagree even when every source is correct, because each screen
 * reaches for data through its own builder:
 *
 *   /keepers      getKeeperBoard()   -> database, else the JSON overlay
 *   /draft        readRoom()         -> the assembled 160-slot board
 *   /draft/final  readRoom() + buildExpectedPicks()
 *
 * The JSON path matters even though the deployment has a database, because it
 * is the fallback that serves the room if Supabase is unreachable on draft
 * night. A fallback that quietly shows four fewer keepers is worse than an
 * error page.
 *
 *   node --env-file=.env.local --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/reconcile-keeper-screens.mts
 *
 * Read-only.
 */

import { readRoom } from "@/lib/draft-service";
import { buildExpectedPicks } from "@/lib/expected-pick";
import { getKeeperBoardFromJson } from "@/lib/league-json";
import { getKeeperBoard } from "@/lib/league-source";
import { readPool } from "@/lib/draft-service";

const label = (s: string) => `\n--- ${s} ---`;

// --- What /keepers prints --------------------------------------------------

console.log(label("/keepers  — the 'N declared' badge"));

const live = await getKeeperBoard();
console.log(`  getKeeperBoard()        ${live.keepers.length} declared` +
  `   (fromDatabase=${live.fromDatabase}${live.fallbackReason ? `, reason=${live.fallbackReason}` : ""})`);

const json = getKeeperBoardFromJson();
console.log(`  getKeeperBoardFromJson() ${json.keepers.length} declared   <- the draft-night fallback`);

let dbCount: number | string = "unreachable";
try {
  const { getKeeperBoardFromDb } = await import("@/lib/league-db");
  dbCount = (await getKeeperBoardFromDb()).keepers.length;
} catch (err) {
  dbCount = `unreachable (${err instanceof Error ? err.message : "?"})`;
}
console.log(`  getKeeperBoardFromDb()   ${dbCount} declared`);

// --- What /draft prints ---------------------------------------------------

console.log(label("/draft  — the assembled board"));

const view = await readRoom();
const keeperSlots = view.slots.filter((s) => s.isKeeper && s.player);
const totalSlots = view.slots.length;
const madePicks = view.slots.filter((s) => s.player && !s.isKeeper).length;
const open = view.slots.filter((s) => !s.player).length;

console.log(`  keeper slots            ${keeperSlots.length}`);
console.log(`  slots total             ${totalSlots}`);
console.log(`  picks made (non-keeper) ${madePicks}`);
console.log(`  open slots              ${open}`);
console.log(`  accounting              ${keeperSlots.length} + ${madePicks} + ${open} = ` +
  `${keeperSlots.length + madePicks + open}` +
  `${keeperSlots.length + madePicks + open === totalSlots ? "  balances" : "  DOES NOT BALANCE"}`);

// --- What /draft/final computes ------------------------------------------

console.log(label("/draft/final  — keeper-adjusted expected picks"));

const pool = await readPool();
const expected = buildExpectedPicks(pool, view.slots);

const keptIds = new Set(keeperSlots.map((s) => s.player!.id));
const leaked = [...keptIds].filter((id) => id in expected);

console.log(`  pool size               ${pool.length}`);
console.log(`  players given an expected pick   ${Object.keys(expected).length}`);
console.log(`  draftable (non-keeper) slots     ${view.slots.filter((s) => !s.isKeeper).length}`);
console.log(
  `  keepers leaking into the ranking  ${leaked.length}` +
    (leaked.length ? "  <- BUG: kept players must not consume a draftable slot" : "  correct"),
);

// --- Consistency verdict -------------------------------------------------

console.log(label("verdict"));

const counts = [
  ["/keepers live", live.keepers.length],
  ["/keepers json fallback", json.keepers.length],
  ["/keepers database", typeof dbCount === "number" ? dbCount : null],
  ["/draft board", keeperSlots.length],
] as const;

const nums = counts.filter(([, n]) => typeof n === "number").map(([, n]) => n as number);
const agree = nums.every((n) => n === nums[0]);

for (const [name, n] of counts)
  console.log(`  ${String(name).padEnd(24)}${n ?? "unreachable"}`);

console.log(
  agree
    ? `\n  All reachable screens agree on ${nums[0]} keepers.`
    : `\n  DISAGREEMENT: screens report ${[...new Set(nums)].sort((a, b) => a - b).join(" vs ")} keepers.`,
);

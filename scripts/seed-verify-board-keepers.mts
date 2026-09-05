/**
 * Prove the draft board carries every reconciled keeper, with no Smart Draft
 * step required and with no database.
 *
 * The board is the one screen ten people stare at on draft night, and until the
 * league adopts this app the commissioner maintains Smart Draft by hand. So the
 * board must not be the least correct view in the app: the room is an input feed
 * and the reconciled layer wins.
 *
 * Runs against the files in `data/` only — no Postgres, no network.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/seed-verify-board-keepers.mts
 */

import process from "node:process";

import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { getKeeperBoardFromJson } from "@/lib/league-json";
import { KEEPERS, LEAGUE, DRAFT } from "@/lib/league-config";
import {
  EXPECTED_FINAL_SEASON_KEEPERS,
  EXPECTED_KEEPERS,
  KEEPERS_FROM_DECLARATION_FILE,
  KEEPERS_IN_FROZEN_ROOM,
} from "./keeper-expectation.mjs";

// Deliberately blank so no database can be reached even by accident. This is
// the dead-network case.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
}

const board = getBoard();
const reconciled = getKeeperBoardFromJson();

console.log(`\nBoard: ${board.totalPicks} slots, ${board.keeperCount} keepers\n`);

const keeperSlots = board.slots.filter((s) => s.isKeeper && s.player);
for (const s of keeperSlots.sort((a, b) => a.overallPick - b.overallPick)) {
  const own = s.originalOwner.id === s.currentOwner.id;
  console.log(
    `  ${s.label.padEnd(6)} ${(s.player?.name ?? "").padEnd(20)} ` +
      `${s.currentOwner.name.padEnd(7)} ${own ? "own pick" : `on ${s.originalOwner.name}'s pick`}`,
  );
}

const div = board.keeperDivergence;
console.log(`\nDivergence from the Smart Draft room:`);
console.log(`  already in the room: ${div.inRoomCount}`);
for (const p of div.placed) {
  console.log(
    `  added by this app:   ${p.playerName} (${p.teamShortName}) at ${p.label}` +
      `${p.onOwnPick ? "" : " — on an acquired pick"}`,
  );
}
for (const u of div.unplaceable) {
  console.log(`  UNPLACEABLE:         ${u.playerName} (${u.teamShortName}) R${u.costRound} — ${u.reason}`);
}

console.log("");

check(
  "the board still has every slot",
  board.totalPicks === LEAGUE.teams * DRAFT.rounds,
  `${board.totalPicks}`,
);

check(
  `the board carries all ${EXPECTED_KEEPERS} reconciled keepers`,
  board.keeperCount === EXPECTED_KEEPERS &&
    reconciled.keepers.length === EXPECTED_KEEPERS,
  `board ${board.keeperCount}, reconciled layer ${reconciled.keepers.length}`,
);

check(
  "nothing was left unplaceable",
  div.unplaceable.length === 0,
  div.unplaceable.map((u) => u.playerName).join(", ") || "none",
);

// The two Zach declared to the commissioner and never keyed into Smart Draft.
const zach = keeperSlots.filter((s) => s.currentOwner.name === "Zach");
check(
  "Zach's two appear on the board with no Smart Draft step",
  JSON.stringify(zach.map((s) => `${s.player?.name} ${s.label}`).sort()) ===
    JSON.stringify(["Justin Jefferson 7.01", "Ladd McConkey 6.05"].sort()),
  zach.map((s) => `${s.player?.name} at ${s.label}`).join(", ") || "none",
);

// Joe declared Jayden Daniels verbally on Aug 27 and is keeping only him, so
// the app carries a third keeper the room has never seen.
const joe = keeperSlots.filter((s) => s.currentOwner.name === "Joe");
check(
  "Joe's single keeper appears on the board with no Smart Draft step",
  JSON.stringify(joe.map((s) => `${s.player?.name} ${s.label}`)) ===
    JSON.stringify(["Jayden Daniels 9.03"]),
  joe.map((s) => `${s.player?.name} at ${s.label}`).join(", ") || "none",
);

/*
 * The room is a frozen historical import, so its 16 is a constant. Asserting it
 * is what stops the overlay double-placing a keeper if the room were ever
 * updated behind the app's back: the divergence would shrink, and this fails
 * rather than the board quietly gaining a duplicate.
 */
check(
  "those three were the divergence, and it is reported rather than hidden",
  div.placed.length === KEEPERS_FROM_DECLARATION_FILE &&
    div.placed.every((p) => p.teamShortName === "Zach" || p.teamShortName === "Joe") &&
    div.inRoomCount === KEEPERS_IN_FROZEN_ROOM,
  `${div.placed.length} added, ${div.inRoomCount} already in the room`,
);

// The preference that survived from the placement fix.
const jefferson = keeperSlots.find((s) => s.player?.name === "Justin Jefferson");
const mcconkey = keeperSlots.find((s) => s.player?.name === "Ladd McConkey");
check(
  "Jefferson took Zach's own R7 rather than an acquired pick",
  jefferson?.originalOwner.name === "Zach" && jefferson?.round === 7,
  `${jefferson?.label} originally ${jefferson?.originalOwner.name}'s`,
);
check(
  "McConkey took an acquired R6, because Zach traded his own to Witte",
  mcconkey?.round === 6 && mcconkey?.originalOwner.name === "Kyle",
  `${mcconkey?.label} originally ${mcconkey?.originalOwner.name}'s`,
);

// No cell may hold two players, and nobody may be kept twice.
const cells = new Set<string>();
let duplicateCell = false;
for (const s of board.slots) {
  const key = `${s.round}:${s.column}`;
  if (cells.has(key)) duplicateCell = true;
  cells.add(key);
}
check("no two picks claim the same board cell", !duplicateCell);

const names = keeperSlots.map((s) => s.player!.id);
check(
  "no player is kept twice",
  new Set(names).size === names.length,
  `${new Set(names).size} distinct of ${names.length}`,
);

// Per-franchise limit, counted off the board rather than the declarations.
const perTeam = new Map<string, number>();
for (const s of keeperSlots) {
  perTeam.set(s.currentOwner.name, (perTeam.get(s.currentOwner.name) ?? 0) + 1);
}
const overLimit = [...perTeam.entries()].filter(([, n]) => n > KEEPERS.maxPerTeam);
check(
  `no franchise exceeds ${KEEPERS.maxPerTeam} keepers on the board`,
  overLimit.length === 0,
  overLimit.map(([t, n]) => `${t}=${n}`).join(", ") ||
    [...perTeam.entries()].sort().map(([t, n]) => `${t}:${n}`).join(" "),
);

// Six final-season keepers, Jefferson included.
const EXPIRING = [
  "Garrett Wilson",
  "Jaxon Smith-Njigba",
  "Brock Bowers",
  "Chase Brown",
  "Trey McBride",
  "Justin Jefferson",
];
const actual = reconciled.keepers.filter((k) => k.finalSeason).map((k) => k.playerName).sort();
check(
  `${EXPECTED_FINAL_SEASON_KEEPERS} keepers are in their final season, Jefferson included`,
  JSON.stringify(actual) === JSON.stringify([...EXPIRING].sort()),
  actual.join(", "),
);

// The pool must grey out everyone on the board, including the overlay's two.
const pool = getPlayerPool();
const kept = new Map(pool.filter((p) => p.keptBy).map((p) => [p.name, p.keptBy]));
check(
  "the player pool greys out the overlay's keepers too",
  kept.get("Justin Jefferson") === "Zach" && kept.get("Ladd McConkey") === "Zach",
  `Jefferson -> ${kept.get("Justin Jefferson") ?? "not marked"}, McConkey -> ${kept.get("Ladd McConkey") ?? "not marked"}`,
);

console.log(
  `\n${"=".repeat(64)}\n${failures === 0 ? "ALL BOARD CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n${"=".repeat(64)}`,
);
process.exit(failures === 0 ? 0 : 1);

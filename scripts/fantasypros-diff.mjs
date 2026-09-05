/**
 * Compares two FantasyPros pulls, player by player and value by value.
 *
 *   npm run diff:fantasypros                     # committed vs working tree
 *   npm run diff:fantasypros -- old.json new.json
 *
 * WHY THIS EXISTS, and it is not curiosity about ADP drift.
 *
 * The league signed in with the wrong FantasyPros account and pulled a full
 * player feed under it, and that file was committed and is what the draft board
 * reads. FantasyPros accounts differ by entitlement, so "sign in again with the
 * right account" is not on its own a safe operation: the correct account may
 * see a different set of players, different ADP, or a different scoring basis,
 * and ADP is what `@/lib/expected-pick` turns into every reach and steal number
 * the room reads. A silently different number there is worse than a visibly
 * missing one.
 *
 * So the two pulls are compared rather than assumed equivalent. Both files come
 * out of the same `npm run pull:fantasypros` pipeline, so the only variable
 * between them is the grant.
 *
 * Run with the loader — it uses the app's own join, so a match here is a match
 * on the board:
 *
 *   node --experimental-strip-types --import ./scripts/draft-loader.mjs \
 *        scripts/fantasypros-diff.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { joinKey } from "@/lib/fantasypros/players";
import { getPlayerPool } from "@/lib/smartdraft";

const COMMITTED = "data/fantasypros-players.json";
/** Below this an ADP move is rounding in FantasyPros' own average, not news. */
const NOISE = 0.05;

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));

function loadCommitted() {
  try {
    return {
      label: `${COMMITTED} at HEAD`,
      doc: JSON.parse(execFileSync("git", ["show", `HEAD:${COMMITTED}`], { encoding: "utf8" })),
    };
  } catch (err) {
    console.error(`Could not read ${COMMITTED} from git HEAD: ${err.message}`);
    process.exit(1);
  }
}

function loadFile(file) {
  return { label: file, doc: JSON.parse(readFileSync(file, "utf8")) };
}

const before = args.length === 2 ? loadFile(args[0]) : loadCommitted();
const after = args.length === 2 ? loadFile(args[1]) : loadFile(COMMITTED);

console.log(`Before  ${before.label}`);
console.log(`        pulled ${before.doc.fetchedAt}`);
console.log(`After   ${after.label}`);
console.log(`        pulled ${after.doc.fetchedAt}\n`);

if (before.doc.fetchedAt === after.doc.fetchedAt) {
  console.log(
    "Both sides are the same pull, so there is nothing to compare. Re-run\n" +
      "`npm run pull:fantasypros` first, or pass two files explicitly.\n",
  );
  process.exit(0);
}

// --- The basis the numbers are on ------------------------------------------

const material = [];

console.log("── Basis ──────────────────────────────────────────────────────");
for (const field of ["scoring", "adpType", "season"]) {
  const a = before.doc[field];
  const b = after.doc[field];
  const same = String(a) === String(b);
  console.log(`  ${field.padEnd(9)} ${String(a).padEnd(12)} → ${b}   ${same ? "same" : "CHANGED"}`);
  if (!same) {
    material.push(
      `The scoring basis changed: ${field} went from ${a} to ${b}. Every ADP on ` +
        `the board is now on a different footing and the snapshot must be re-pulled.`,
    );
  }
}

// --- Who is in the feed -----------------------------------------------------

const index = (doc) => {
  const map = new Map();
  for (const p of doc.players) map.set(`${joinKey(p.name, p.position)}`, p);
  return map;
};

const a = index(before.doc);
const b = index(after.doc);

const added = [...b.keys()].filter((k) => !a.has(k)).map((k) => b.get(k));
const removed = [...a.keys()].filter((k) => !b.has(k)).map((k) => a.get(k));

console.log("\n── Players ────────────────────────────────────────────────────");
console.log(`  total          ${before.doc.players.length} → ${after.doc.players.length}`);
console.log(`  with an id     ${before.doc.withFpId} → ${after.doc.withFpId}`);
console.log(`  with headshot  ${before.doc.withHeadshot} → ${after.doc.withHeadshot}`);
console.log(`  gained         ${added.length}`);
console.log(`  lost           ${removed.length}`);

const show = (list, what) => {
  if (!list.length) return;
  console.log(`\n  ${what}:`);
  for (const p of list.slice(0, 30)) {
    console.log(`    ${p.name} (${p.position})  adp ${p.adp ?? "—"}`);
  }
  if (list.length > 30) console.log(`    …and ${list.length - 30} more`);
};
show(removed, "in the old pull and not the new one");
show(added, "in the new pull and not the old one");

// A player the new account cannot see is the failure that matters: he would
// fall back to Smart Draft's ADP rather than vanish, but his price would
// silently stop tracking the market.
if (removed.length) {
  material.push(
    `${removed.length} player(s) present under the old grant are absent under the ` +
      `new one. They keep their Smart Draft ADP rather than disappearing, but they ` +
      `are no longer priced off the live market.`,
  );
}

// --- The numbers themselves -------------------------------------------------

const moved = [];
const idChanged = [];
const headshotChanged = [];

for (const [key, next] of b) {
  const prev = a.get(key);
  if (!prev) continue;

  const pa = prev.adp;
  const pb = next.adp;
  if (pa == null || pb == null) {
    if (pa !== pb) moved.push({ name: next.name, position: next.position, from: pa, to: pb, delta: Infinity });
  } else if (Math.abs(pa - pb) > NOISE) {
    moved.push({ name: next.name, position: next.position, from: pa, to: pb, delta: Math.abs(pa - pb) });
  }

  if ((prev.fpId ?? null) !== (next.fpId ?? null)) {
    idChanged.push(`${next.name} (${next.position}): ${prev.fpId ?? "none"} → ${next.fpId ?? "none"}`);
  }
  if ((prev.headshotUrl ?? null) !== (next.headshotUrl ?? null)) {
    headshotChanged.push(
      `${next.name} (${next.position}): ${prev.headshotUrl ? "had one" : "had none"} → ${next.headshotUrl ? "has one" : "has none"}`,
    );
  }
}

moved.sort((x, y) => y.delta - x.delta);

console.log("\n── ADP ────────────────────────────────────────────────────────");
console.log(`  players in both pulls   ${[...b.keys()].filter((k) => a.has(k)).length}`);
console.log(`  ADP moved by >${NOISE}      ${moved.length}`);
if (moved.length) {
  console.log("\n  largest moves:");
  for (const m of moved.slice(0, 25)) {
    const arrow = m.delta === Infinity ? "" : `  (${(m.to - m.from > 0 ? "+" : "")}${(m.to - m.from).toFixed(2)})`;
    console.log(`    ${m.name.padEnd(24)} ${m.position.padEnd(3)} ${String(m.from ?? "—").padStart(7)} → ${String(m.to ?? "—").padEnd(7)}${arrow}`);
  }
  if (moved.length > 25) console.log(`    …and ${moved.length - 25} more`);
}

console.log("\n── Identity and images ────────────────────────────────────────");
console.log(`  FantasyPros ids changed  ${idChanged.length}`);
for (const line of idChanged.slice(0, 15)) console.log(`    ${line}`);
console.log(`  headshots changed        ${headshotChanged.length}`);
for (const line of headshotChanged.slice(0, 15)) console.log(`    ${line}`);
if (headshotChanged.length > 15) console.log(`    …and ${headshotChanged.length - 15} more`);

// --- What the board actually ends up with -----------------------------------

/**
 * How much of the league's own pool each pull can price, using the app's join
 * rather than a second copy of it — the position-keyed lookup first and the
 * name-only fallback second, exactly as `@/lib/fantasypros/snapshot` does.
 */
function coverage(doc) {
  const byKey = new Map();
  const byName = new Map();
  for (const p of doc.players) {
    if (!p?.name || !p.position) continue;
    byKey.set(joinKey(p.name, p.position), p);
    if (!byName.has(joinKey(p.name))) byName.set(joinKey(p.name), p);
  }
  let priced = 0;
  for (const player of pool) {
    const hit = byKey.get(joinKey(player.name, player.position)) ?? byName.get(joinKey(player.name));
    if (hit?.adp != null) priced++;
  }
  return priced;
}

const pool = getPlayerPool();
const coverBefore = coverage(before.doc);
const coverAfter = coverage(after.doc);

console.log("\n── The league's pool ──────────────────────────────────────────");
console.log(`  pool size                       ${pool.length}`);
console.log(`  priced off live ADP, before     ${coverBefore}`);
console.log(`  priced off live ADP, after      ${coverAfter}`);

if (coverAfter < coverBefore) {
  material.push(
    `Live ADP coverage of the league's pool FELL from ${coverBefore} to ${coverAfter} ` +
      `players. The new grant prices less of the board than the old one did.`,
  );
}

// --- Verdict ----------------------------------------------------------------

console.log("\n═══════════════════════════════════════════════════════════════");
if (material.length) {
  console.log("MATERIAL DIFFERENCES. The committed numbers are not equivalent:\n");
  for (const line of material) console.log(`  • ${line}\n`);
} else if (moved.length === 0 && added.length === 0 && removed.length === 0) {
  console.log("IDENTICAL. Both grants see exactly the same players at the same ADP,");
  console.log("on the same scoring basis. Nothing committed needs regenerating for");
  console.log("correctness — though the newer pull is the one to keep, since its");
  console.log("provenance names the grant it actually came from.");
} else {
  console.log("NO MATERIAL DIFFERENCE. Same players, same basis, same coverage.");
  console.log(`${moved.length} ADP value(s) moved, which is the market moving between two`);
  console.log("pulls rather than the accounts disagreeing. Commit the newer pull.");
}
console.log("═══════════════════════════════════════════════════════════════\n");

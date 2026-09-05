/**
 * Pre-flight for a keeper declaration that has not arrived yet.
 *
 * ANSWERED FOR JOE — KEPT AS A TOOL, NOT AS AN OPEN QUESTION. This was written
 * when Joe was the last franchise outstanding and the board sat at 18. He has
 * since declared **one** keeper, Jayden Daniels at R9, placed at 9.03, and his
 * list is closed. All ten teams have declared and the board carries 19. Nothing
 * here is waiting on an answer.
 *
 * It still runs, and it generalises: change `MANAGER` to point it at whoever is
 * outstanding next preseason. Read the board count from
 * `npm run verify:board-keepers` rather than from this header.
 *
 * What it proves for a manager who has not declared: `npm run db:seed`
 * derives cost rounds and refuses to guess, failing if either
 *
 *   1. the rules give the player no cost round at all, or
 *   2. the franchise holds no free pick in the round the price lands on.
 *
 * Both are knowable before the declaration arrives, and the second is not a
 * per-player question: two keepers pricing to the same round collide, and
 * `resolveSameRoundConflicts` bumps one EARLIER into a more expensive round. So
 * a player who is placeable alone can be unplaceable as half of a pair. Joe had
 * eight players pricing to round 8 and holds one round-8 pick, which is what
 * made this worth running rather than a hypothetical — and in the event he
 * declared a single keeper, so the pair case never arose.
 *
 * Pricing here goes through the app's own `evaluateKeeperEligibility` rather
 * than the sheet's `eligible2026` column, because the two disagree: the sheet
 * calls Saquon Barkley eligible and the commissioner's round-1 ruling (R6) does
 * not. The app is right and the sheet column is stale.
 *
 *   node --env-file=.env.local --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/preflight-joe-keepers.mts
 *
 * Read-only.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { readRoom } from "@/lib/draft-service";
import {
  evaluateKeeperEligibility,
  resolveSameRoundConflicts,
  seasonsKeptEnteringSheetSeason,
  type KeeperSlotClaim,
} from "@/lib/keeper-clock";

const MANAGER = "Joe";

/** Mirrors the module-private helper of the same name in `league-json.ts`. */
const parseSheetTenure = (status: string | null | undefined): number | null => {
  if (!status) return null;
  const m = /^\s*(\d+)\s+of\s+\d+\s*$/i.exec(status);
  return m ? Number(m[1]) : null;
};

type SheetRow = {
  player: string;
  position: string | null;
  manager: string;
  round2025: number | null;
  status2026: string | null;
};

const sheet: SheetRow[] = JSON.parse(
  readFileSync(path.join(process.cwd(), "data", "keeper-eligibility-2026.json"), "utf8"),
).players.filter((p: SheetRow) => p.manager === MANAGER);

// --- Which rounds Joe can actually place a keeper in ----------------------

const view = await readRoom();
const openRounds = new Set<number>();
const roundDetail = new Map<number, string>();
for (const s of view.slots) {
  if (s.currentOwner.name !== MANAGER) continue;
  if (!s.player) openRounds.add(s.round);
  const prior = roundDetail.get(s.round);
  const entry = s.player ? `${s.label} taken` : `${s.label} open`;
  roundDetail.set(s.round, prior ? `${prior}, ${entry}` : entry);
}

console.log(`${MANAGER}'s picks, and where a keeper could sit`);
for (let r = 1; r <= 16; r++)
  console.log(
    `  R${String(r).padStart(2)}  ${(roundDetail.get(r) ?? "— does not hold a pick").padEnd(24)}` +
      (openRounds.has(r) ? "placeable" : ""),
  );

// --- Price every player on his roster through the app's own rules ---------

type Priced = { name: string; pos: string; basis: number | null; cost: number | null; reason?: string };

const priced: Priced[] = sheet.map((row) => {
  const tenure = parseSheetTenure(row.status2026);
  const seasonsKept = tenure == null ? 0 : seasonsKeptEnteringSheetSeason(tenure);
  const basisRound = row.round2025;
  const verdict = evaluateKeeperEligibility({
    basisRound,
    seasonsKept,
    isUndrafted: basisRound == null,
    originalRound: basisRound,
  });
  return {
    name: row.player,
    pos: row.position ?? "?",
    basis: basisRound,
    cost: verdict.eligible ? verdict.costRound : null,
    reason: verdict.eligible ? undefined : verdict.reason,
  };
});

const keepable = priced
  .filter((p): p is Priced & { cost: number } => p.cost != null)
  .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

console.log(`\npriced through the app's rules (${keepable.length} keepable of ${priced.length})`);
console.log(`${"player".padEnd(22)}${"pos".padEnd(6)}${"R2025".padEnd(7)}cost`);
for (const p of keepable)
  console.log(
    p.name.padEnd(22) + p.pos.padEnd(6) + String(p.basis ?? "und").padEnd(7) + `R${p.cost}`,
  );

for (const p of priced.filter((x) => x.cost == null))
  console.log(`\n  NOT KEEPABLE  ${p.name} (R${p.basis} in 2025) — ${p.reason}`);

// --- Every pair, through the real conflict resolver -----------------------

const claim = (p: Priced & { cost: number }): KeeperSlotClaim => ({
  playerId: p.name,
  playerName: p.name,
  baseCostRound: p.cost,
  eligible: true,
});

const bad: string[] = [];
let good = 0;

for (let i = 0; i < keepable.length; i++) {
  for (let j = i + 1; j < keepable.length; j++) {
    const a = keepable[i];
    const b = keepable[j];
    const { resolved, error } = resolveSameRoundConflicts([claim(a), claim(b)]);

    if (error) {
      bad.push(`${a.name} + ${b.name} — ${error}`);
      continue;
    }
    const unplaceable = resolved.filter((r) => !openRounds.has(r.costRound));
    if (unplaceable.length) {
      bad.push(
        `${a.name} (R${a.cost}) + ${b.name} (R${b.cost}) resolves to ` +
          resolved.map((r) => `${r.playerName}@R${r.costRound}`).join(" + ") +
          ` — Joe has no free ${unplaceable.map((r) => `R${r.costRound}`).join(" and ")} pick`,
      );
    } else good += 1;
  }
}

const total = (keepable.length * (keepable.length - 1)) / 2;
console.log(`\npairs: ${good} of ${total} can both be placed`);

if (bad.length) {
  console.log(`\n${bad.length} pair(s) the seed would REJECT:`);
  for (const b of bad) console.log(`  ${b}`);
} else {
  console.log("\nEvery pair of keepable players can be placed.");
}

// --- The round-8 cluster, called out explicitly --------------------------

const byRound = new Map<number, string[]>();
for (const p of keepable) {
  if (!byRound.has(p.cost)) byRound.set(p.cost, []);
  byRound.get(p.cost)!.push(p.name);
}
const crowded = [...byRound.entries()].filter(([, names]) => names.length > 1);
if (crowded.length) {
  console.log("\nrounds where two declarations would collide and bump one earlier");
  for (const [round, names] of crowded.sort((a, b) => a[0] - b[0]))
    console.log(
      `  R${round}  ${names.length} players — a second here is bumped to R${round - 1}` +
        `${openRounds.has(round - 1) ? " (held, fine)" : " (NOT held — would fail)"}`,
    );
}

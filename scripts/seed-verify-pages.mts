/**
 * Prove the four database-backed surfaces produce real data, by running the
 * exact modules the pages render from.
 *
 * This is not a re-implementation of the page logic — it imports
 * `@/lib/league-source`, which is what `/teams`, `/keepers` and `/trades` call,
 * and `@/lib/governance`, which is what `/governance` calls. Whatever this
 * prints is what those pages will render.
 *
 * It also checks the two guarantees that matter most:
 *
 *   1. With credentials present, the reads come from Postgres.
 *   2. With the database pointed somewhere invalid, the franchise, keeper and
 *      trade surfaces fall back to the snapshots in `data/` rather than failing.
 *      That is the Saturday guarantee, and the venue's wifi is not trusted.
 *
 * Usage:
 *   node --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/seed-verify-pages.mts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { keeperCostRound } from "@/lib/keeper-clock";
import {
  EXPECTED_FINAL_SEASON_KEEPERS,
  EXPECTED_KEEPERS,
  KEEPERS_FROM_DECLARATION_FILE,
  KEEPERS_IN_FROZEN_ROOM,
} from "./keeper-expectation.mjs";
import type {
  FranchiseView,
  KeeperEntry,
  PendingDeclaration,
  TradeLogEntry,
  TradeLogSide,
} from "@/lib/league-view";

// --- env --------------------------------------------------------------------
// Loaded before importing anything that reads it, because the Supabase client
// is constructed from `process.env` at call time.

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path.join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return out;
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (value) out[m[1]] = value;
  }
  return out;
}

const fileEnv = loadEnvLocal();
for (const [k, v] of Object.entries(fileEnv)) {
  // A real export wins, but only if it actually has a value — an exported-but-
  // empty variable is what a shell leaves behind after sourcing a blank file.
  if (!process.env[k]) process.env[k] = v;
}

const REAL_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;

function heading(text: string) {
  console.log(`\n${"=".repeat(72)}\n${text}\n${"=".repeat(72)}`);
}

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
}

/**
 * Imported dynamically so the env above is in place first. No cache-busting is
 * needed between phases: the Supabase client is constructed per query from
 * `process.env`, so changing the URL takes effect on the next call.
 */
async function loadSource() {
  return import("@/lib/league-source");
}

async function verifyLive() {
  heading("PHASE 1 — live database reads");

  const source = await loadSource();

  const { franchises, source: fSource } = await source.getFranchises();
  console.log(`\n/teams — ${franchises.length} franchises`);
  console.log(
    `  source: ${fSource.fromDatabase ? "DATABASE" : "JSON snapshots"}` +
      (fSource.fallbackReason ? ` (fallback: ${fSource.fallbackReason})` : ""),
  );
  for (const f of franchises as FranchiseView[]) {
    console.log(
      `  ${String(f.draftSlot).padStart(2)}  ${f.shortName.padEnd(7)} ` +
        `${f.franchiseName.padEnd(24)} ${f.manager.padEnd(16)} ` +
        `picks ${String(f.picksHeld).padStart(2)} (+${f.picksAcquired}/-${f.picksTradedAway})  ` +
        `keepers ${f.keepers.length}` +
        (f.keeperSlotsPending ? `  [${f.keeperSlotsPending} pending]` : ""),
    );
  }
  check("/teams reads the database", fSource.fromDatabase);
  check("/teams has all ten franchises", franchises.length === 10, `${franchises.length}`);
  const bySlot = (slot: number) =>
    (franchises as FranchiseView[]).find((f) => f.draftSlot === slot)?.shortName;
  check(
    "/teams shows real ESPN franchise names",
    (franchises as FranchiseView[]).some((f) => f.franchiseName === "Jimmy's Johnson"),
  );
  check(
    "/teams keeps Stefan 8th and Colin 10th",
    bySlot(8) === "Stefan" && bySlot(10) === "Colin",
    `slot 8 = ${bySlot(8)}, slot 10 = ${bySlot(10)}`,
  );

  const board = await source.getKeeperBoard();
  console.log(`\n/keepers — ${board.keepers.length} declared`);
  console.log(
    `  source: ${board.fromDatabase ? "DATABASE" : "JSON snapshots"}` +
      (board.fallbackReason ? ` (fallback: ${board.fallbackReason})` : ""),
  );
  for (const k of board.keepers as KeeperEntry[]) {
    console.log(
      `  ${k.boardLabel.padEnd(6)} R${String(k.costRound).padStart(2)}  ` +
        `${k.playerName.padEnd(20)} ${k.teamShortName.padEnd(7)} ` +
        `${k.clockLabel.padEnd(26)} ${k.keepableIn2027 ? "keepable 2027" : "EXPIRES after 2026"}` +
        (k.clockResetByTrade ? "  (clock reset by trade)" : ""),
    );
  }
  const pending = board.pending as PendingDeclaration[];
  console.log(
    `  short of a full slate: ${pending.map((p) => `${p.shortName} ${p.declared}/${p.allowed} ${p.status}`).join(", ") || "none"}`,
  );
  console.log(`  still awaiting an answer: ${board.awaitingCount}`);
  check("/keepers reads the database", board.fromDatabase);
  check(
    `/keepers has all ${EXPECTED_KEEPERS} declarations`,
    board.keepers.length === EXPECTED_KEEPERS,
    `${board.keepers.length}`,
  );
  check(
    `/keepers marks exactly ${EXPECTED_FINAL_SEASON_KEEPERS} as expiring`,
    board.expiringCount === EXPECTED_FINAL_SEASON_KEEPERS,
    `${board.expiringCount}`,
  );

  // Justin Jefferson joined this list when Zach declared: the sheet has him at
  // "3 of 3" for 2026, so 2026 is his second and final keeper season.
  const EXPECTED_EXPIRING = [
    "Garrett Wilson",
    "Jaxon Smith-Njigba",
    "Brock Bowers",
    "Chase Brown",
    "Trey McBride",
    "Justin Jefferson",
  ];
  const actualExpiring = (board.keepers as KeeperEntry[])
    .filter((k) => k.finalSeason)
    .map((k) => k.playerName)
    .sort();
  check(
    "/keepers names the right six",
    JSON.stringify(actualExpiring) === JSON.stringify([...EXPECTED_EXPIRING].sort()),
    actualExpiring.join(", "),
  );

  const nacua = (board.keepers as KeeperEntry[]).find((k) => k.playerName === "Puka Nacua");
  check(
    "Nacua is Scott's at R11 with a reset clock",
    !!nacua && nacua.teamShortName === "Scott" && nacua.costRound === 11 && nacua.clockResetByTrade,
    nacua ? `${nacua.teamShortName} R${nacua.costRound}` : "missing",
  );

  const loveland = (board.keepers as KeeperEntry[]).find(
    (k) => k.playerName === "Colston Loveland",
  );
  check(
    "Loveland costs R9 as a free-agent acquisition",
    !!loveland && loveland.costRound === 9 && loveland.isUndrafted,
    loveland ? `R${loveland.costRound}` : "missing",
  );

  const pendingNames = pending.map((p) => p.shortName).sort();
  check(
    "every franchise short of a full slate is listed",
    JSON.stringify(pendingNames) === JSON.stringify(["Joe"]),
    pendingNames.length
      ? pending.map((p) => `${p.shortName} ${p.declared}/${p.allowed} ${p.status}`).join(", ")
      : "none",
  );
  check(
    "awaiting is distinguished from a deliberately short list",
    pending.every((p) => p.status === "awaiting" || p.status === "final") &&
      board.awaitingCount === pending.filter((p) => p.status === "awaiting").length,
    `${board.awaitingCount} awaiting, ${pending.filter((p) => p.status === "final").length} closed`,
  );

  // Joe is keeping one, which is his right. His empty second slot is a settled
  // pass, so nothing may report him as an outstanding answer — every manager
  // has now replied and the keeper list is final for the draft.
  const joe = pending.find((p) => p.shortName === "Joe");
  check(
    "Joe's one-keeper list is recorded as closed, not as an unanswered manager",
    joe?.status === "final" && !!joe.declarationsClosedAt && board.awaitingCount === 0,
    `Joe ${joe ? `${joe.status} (closed ${joe.declarationsClosedAt ?? "never"})` : "absent"}, ` +
      `${board.awaitingCount} awaiting`,
  );

  check(
    "Zach's late declaration is stored with derived cost rounds",
    JSON.stringify(
      (board.keepers as KeeperEntry[])
        .filter((k) => k.teamShortName === "Zach")
        .map((k) => `${k.playerName} R${k.costRound}`)
        .sort(),
    ) === JSON.stringify(["Justin Jefferson R7", "Ladd McConkey R6"].sort()),
    (board.keepers as KeeperEntry[])
      .filter((k) => k.teamShortName === "Zach")
      .map((k) => `${k.playerName} R${k.costRound}`)
      .join(", ") || "none",
  );

  // Every stored cost round is re-derived through the real keeper-clock
  // function, so the seed's copy of the rule cannot drift from the authority.
  const mispriced = (board.keepers as KeeperEntry[]).filter((k) => {
    const expected = keeperCostRound({
      basisRound: k.basisRound,
      seasonsKept: k.seasonsKept,
      isUndrafted: k.isUndrafted,
    });
    // No expected round means the rule does not allow him to be kept at all, so
    // his presence on the board is a failure rather than a pricing difference.
    if (expected == null) return true;
    // A same-round clash legitimately bumps a keeper EARLIER than the rule says.
    return k.costRound > expected;
  });
  check(
    "every cost round matches keeper-clock's rule (or a documented bump)",
    mispriced.length === 0,
    mispriced.map((k) => `${k.playerName} R${k.costRound}`).join(", ") ||
      `all ${EXPECTED_KEEPERS} agree`,
  );

  // ---------------------------------------------------------------------
  // MANAGER IDENTITY. Four of the ten managers share a first name, and
  // "Scott" and "Kyle" are each a valid short name for one manager AND the
  // first name of another, so a first-name match silently resolves to the
  // wrong franchise. These are the regression checks for that.
  // ---------------------------------------------------------------------
  const keepersOf = (shortName: string) =>
    (board.keepers as KeeperEntry[])
      .filter((k) => k.teamShortName === shortName)
      .map((k) => k.playerName)
      .sort();

  check(
    "Scott Johnston (short name \"Scott\") holds only his own keepers",
    JSON.stringify(keepersOf("Scott")) === JSON.stringify(["Kyren Williams", "Puka Nacua"].sort()),
    keepersOf("Scott").join(", ") || "none",
  );
  check(
    "Scott Elbe (short name \"Elbe\") holds only his own keepers",
    JSON.stringify(keepersOf("Elbe")) === JSON.stringify(["Cam Skattebo", "Javonte Williams"].sort()),
    keepersOf("Elbe").join(", ") || "none",
  );
  check(
    "Kyle Mertens (short name \"Kyle\") holds only his own keepers",
    JSON.stringify(keepersOf("Kyle")) === JSON.stringify(["Chase Brown", "Jaxon Smith-Njigba"].sort()),
    keepersOf("Kyle").join(", ") || "none",
  );
  check(
    "Kyle Witte (short name \"Witte\") holds only his own keepers",
    JSON.stringify(keepersOf("Witte")) === JSON.stringify(["De'Von Achane", "Tucker Kraft"].sort()),
    keepersOf("Witte").join(", ") || "none",
  );

  const managerOf = (shortName: string) =>
    (franchises as FranchiseView[]).find((f) => f.shortName === shortName)?.manager;
  check(
    "the two Scotts and two Kyles map to distinct managers",
    managerOf("Scott") === "Scott Johnston" &&
      managerOf("Elbe") === "Scott Elbe" &&
      managerOf("Kyle") === "Kyle Mertens" &&
      managerOf("Witte") === "Kyle Witte",
    `Scott=${managerOf("Scott")}, Elbe=${managerOf("Elbe")}, Kyle=${managerOf("Kyle")}, Witte=${managerOf("Witte")}`,
  );

  // A keeper priced off another franchise's tenure is the failure mode. Every
  // remaining ownership disagreement must carry an explicit resolution.
  const unresolvedOwnership = (board.keepers as KeeperEntry[]).filter((k) =>
    k.conflicts.some((c) => /has him on|has him under/i.test(c.summary) && !c.resolution),
  );
  check(
    "no keeper's clock was taken from another franchise's row",
    unresolvedOwnership.length === 0,
    unresolvedOwnership.map((k) => k.playerName).join(", ") || "none outstanding",
  );

  const trades = await source.getTradeBoard();
  console.log(`\n/trades — ${trades.tradedPicks.length} picks moved, ${trades.log.length} trades`);
  console.log(
    `  source: ${trades.fromDatabase ? "DATABASE" : "JSON snapshots"}` +
      (trades.fallbackReason ? ` (fallback: ${trades.fallbackReason})` : ""),
  );
  const side = (s: TradeLogSide) =>
    `${s.manager}: ${[...s.playersReceived.map((p) => p.resolvedName ?? p.typedName), ...s.picksReceived.map((p) => p.label)].join(", ") || "—"}`;
  for (const t of (trades.log as TradeLogEntry[]).slice(0, 4)) {
    console.log(
      `  #${t.tradeNumber}${t.provisional ? " [PROVISIONAL]" : ""}  ${side(t.sideA)}  <->  ${side(t.sideB)}`,
    );
  }
  console.log(`  ... ${Math.max(0, trades.log.length - 4)} more`);
  check("/trades reads the database", trades.fromDatabase);
  check("/trades shows all 29 traded picks", trades.tradedPicks.length === 29, `${trades.tradedPicks.length}`);
  check("/trades shows all 12 logged trades", trades.log.length === 12, `${trades.log.length}`);
  check(
    "/trades flags the Nacua contingent trade as provisional",
    (trades.log as TradeLogEntry[]).filter((t) => t.provisional).length === 1,
  );

  check(
    // Zach's two and Joe's one arrived verbally and were never typed into the
    // room, and never will be — Smart Draft is a frozen historical import, so
    // it holds 16 of the 19 permanently rather than temporarily.
    "/keepers reports what Smart Draft is still missing",
    board.roomSync.inRoom === KEEPERS_IN_FROZEN_ROOM &&
      board.roomSync.missingFromRoom.length === KEEPERS_FROM_DECLARATION_FILE &&
      board.roomSync.missingFromRoom.every((m: { manager: string }) =>
        ["Zach Rakowski", "Joe Murray"].includes(m.manager),
      ),
    `${board.roomSync.inRoom} in the room, missing: ` +
      (board.roomSync.missingFromRoom
        .map((m: { playerName: string; costRound: number }) => `${m.playerName} R${m.costRound}`)
        .join(", ") || "none"),
  );

  const { getGovernance } = await import("@/lib/governance");
  const gov = await getGovernance(2026);
  console.log(`\n/governance`);
  console.log(`  franchises: ${gov.teams.length}, motions: ${gov.motions.length}, decisions logged: ${gov.actions.length}`);
  for (const a of gov.actions) console.log(`  · ${a.type}`);
  check("/governance reads the database", gov.teams.length === 10, `${gov.teams.length} franchises`);
  check("/governance has the four rulings logged", gov.actions.length === 4, `${gov.actions.length}`);
}

async function verifyFallback() {
  heading("PHASE 2 — database unreachable (the Saturday guarantee)");

  // Point at a host that cannot resolve. The keys stay present, so
  // `hasDatabase()` is still true and the database path is genuinely ATTEMPTED
  // and genuinely fails — which is the case that matters. `.env.local` is left
  // untouched; this only changes this process's environment.
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    "https://ukl-unreachable-host.invalid";

  const source = await loadSource();

  const { franchises, source: fSource } = await source.getFranchises();
  check(
    "/teams still renders from the snapshots",
    franchises.length === 10 && !fSource.fromDatabase,
    `${franchises.length} franchises, fallback reported: ${fSource.fallbackReason ? "yes" : "no"}`,
  );

  const board = await source.getKeeperBoard();
  check(
    "/keepers still renders from the snapshots, late declaration included",
    board.keepers.length === EXPECTED_KEEPERS &&
      !board.fromDatabase &&
      board.expiringCount === EXPECTED_FINAL_SEASON_KEEPERS,
    `${board.keepers.length} keepers, ${board.expiringCount} expiring`,
  );

  // With the database unreachable the commissioner must not be told to chase a
  // manager who has already answered. Joe declared one keeper and closed his
  // list, so the offline page has to reach the same verdict the database does.
  const joeOffline = (board.pending as PendingDeclaration[]).find((p) => p.shortName === "Joe");
  check(
    "/keepers calls Joe's short list a deliberate pass offline, not an unanswered one",
    joeOffline?.status === "final" && board.awaitingCount === 0,
    `Joe ${joeOffline ? joeOffline.status : "absent"}, ${board.awaitingCount} awaiting`,
  );

  const trades = await source.getTradeBoard();
  check(
    "/trades still renders from the snapshots",
    trades.tradedPicks.length === 29 && !trades.fromDatabase,
    `${trades.tradedPicks.length} traded picks`,
  );

  // The board and player pool never touch the database at all, which is why
  // they are the guarantee rather than merely the fallback.
  const { getBoard, getPlayerPool } = await import("@/lib/smartdraft");
  const draftBoard = getBoard();
  const pool = getPlayerPool();
  check(
    "/draft still renders the full board",
    draftBoard.slots.length === 160 && draftBoard.teams.length === 10,
    `${draftBoard.slots.length} slots, ${draftBoard.keeperCount} keepers, ${draftBoard.tradedCount} traded`,
  );
  check(
    `/draft carries all ${EXPECTED_KEEPERS} keepers with the database unreachable`,
    draftBoard.keeperCount === EXPECTED_KEEPERS &&
      draftBoard.keeperDivergence.placed.length === 3 &&
      draftBoard.keeperDivergence.unplaceable.length === 0,
    `${draftBoard.keeperCount} keepers, ${draftBoard.keeperDivergence.placed.length} added by the reconciled layer`,
  );
  check("/players still renders the pool", pool.length > 1000, `${pool.length} players`);

  process.env.NEXT_PUBLIC_SUPABASE_URL = REAL_URL;
}

async function verifyNameGuards() {
  heading("PHASE 3 — first-name matching is refused, not guessed");

  // `franchiseByName` is internal, so this exercises it the way the trade log
  // does: through the reader, with a first name where a short name belongs.
  const { getTradeBoardFromJson } = await import("@/lib/league-json");
  const board = getTradeBoardFromJson();
  const members = new Set(
    board.log.flatMap((t: TradeLogEntry) => [t.sideA.manager, t.sideB.manager]),
  );
  check(
    "every trade-log side resolved to a real franchise",
    [...members].every((m) => m !== "?"),
    [...members].sort().join(", "),
  );

  const sides = board.log.flatMap((t: TradeLogEntry) => [t.sideA, t.sideB]) as TradeLogSide[];
  const scott = sides.find((x) => x.manager === "Scott");
  const elbe = sides.find((x) => x.manager === "Elbe");
  check(
    "trade log \"Scott\" is Johnston and \"Elbe\" is Elbe",
    scott?.franchiseName === "DHB Sandmen" && elbe?.franchiseName === "A.D.B. Rombusters II",
    `Scott -> ${scott?.franchiseName}, Elbe -> ${elbe?.franchiseName}`,
  );
}

await verifyLive();
await verifyNameGuards();
await verifyFallback();

heading(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

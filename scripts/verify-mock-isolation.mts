/**
 * Proves that a complete mock draft cannot touch the live draft board.
 *
 *   npm run verify:mock
 *
 * ============================================================================
 * WHY THIS SCRIPT IS SHAPED THE WAY IT IS
 * ============================================================================
 *
 * A previous attempt at this guarded the mock with "refuse to run if the live
 * board already has picks". That check passed happily and proved nothing,
 * because the live board is legitimately empty right up until the draft starts.
 * The lesson is that a safety property has to be checked against the artefact,
 * not against a precondition that happens to be true.
 *
 * So section 1 hashes `data/draft-state-2026.json` byte for byte, section 4 runs
 * 142 mock picks through the exact code the browser runs, and section 5 hashes
 * the file again and requires the two digests to be equal. If a mock ever
 * learned to write there, this fails, whatever the board happened to contain
 * when it started.
 *
 * Section 2 is the other half, and the more important one: it reads the SOURCE
 * of every module in the mock feature and asserts that none of them imports the
 * live draft store, the live draft service, or Supabase. That is a structural
 * claim about the import graph — a mock pick has no code path to the live file
 * or to Postgres, rather than having one that is currently guarded.
 *
 * Nothing here is a stand-in. It loads the real Smart Draft snapshot, the real
 * player pool, the real `@/lib/draft-engine`, and the real mock AI.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import { boardFingerprint, isDraftStateFile } from "@/lib/draft-engine";
import { buildFranchiseLineups, STARTER_COUNT } from "@/lib/roster-lineup";
import { chooseMockPick, mulberry32 } from "@/lib/mock-draft-ai";
import {
  BOT_ARCHETYPES,
  BOT_LIMITS,
  archetypeByKey,
  defaultArchetypeFor,
} from "@/lib/mock-draft-bots";
import {
  botPickOnce,
  defaultAssignment,
  freshMockState,
  fromMockFile,
  runWholeMock,
  toMockFile,
  toMockPool,
  type ArchetypeAssignment,
} from "@/lib/mock-draft-run";
import { isMockDraftFile } from "@/lib/mock-draft-types";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { CURRENT_SEASON, DRAFT, FEATURES, LEAGUE, ROSTER, TOTAL_PICKS } from "@/lib/league-config";
import { DRAFTABLE_POSITIONS } from "@/lib/board-types";

const LIVE_STATE = path.join(process.cwd(), "data", `draft-state-${CURRENT_SEASON}.json`);
const MOCK_STATE = path.join(process.cwd(), "data", `mock-draft-state-${CURRENT_SEASON}.json`);

// --- Assertion harness ------------------------------------------------------

let checks = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  checks++;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

function sha256(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// --- 1. Fingerprint the live board ------------------------------------------

section("1. The live draft board, before any of this runs");

const liveExists = existsSync(LIVE_STATE);
check(`data/draft-state-${CURRENT_SEASON}.json exists`, liveExists);
if (!liveExists) {
  console.log("\nCannot verify isolation without the live board present.\n");
  process.exit(1);
}

const liveBefore = {
  sha: sha256(LIVE_STATE),
  bytes: statSync(LIVE_STATE).size,
  mtimeMs: statSync(LIVE_STATE).mtimeMs,
  text: readFileSync(LIVE_STATE, "utf8"),
};
const liveParsed: unknown = JSON.parse(liveBefore.text);
check("it is a valid live draft state file", isDraftStateFile(liveParsed));

const livePickCount = isDraftStateFile(liveParsed) ? liveParsed.picks.length : -1;
console.log(
  `  · sha256 ${liveBefore.sha.slice(0, 16)}…  ${liveBefore.bytes} bytes  ${livePickCount} entered picks`,
);
/*
 * Deliberately NOT asserted to be zero. "The board is empty" is exactly the
 * precondition that made the previous check worthless, and the commissioner may
 * legitimately have picks on it by the time anyone runs this. What is asserted
 * is that whatever it holds, a mock does not change it.
 */

// --- 2. The mock feature's import graph -------------------------------------

section("2. No module in the mock feature can reach the live board or the database");

/** Every file the mock feature is made of. */
const MOCK_FEATURE = [
  "src/lib/mock-draft-types.ts",
  "src/lib/mock-draft-bots.ts",
  "src/lib/mock-draft-ai.ts",
  "src/lib/mock-draft-run.ts",
  "src/components/mock-draft.tsx",
  "src/components/mock-draft-setup.tsx",
  "src/app/mock/page.tsx",
  "src/app/api/mock-draft/state/route.ts",
];

/**
 * Modules that can write the live board or the database. `mock-draft-store` is
 * exempt from nothing: it is checked separately below, because it is allowed to
 * do file I/O and is the one place that does.
 */
const FORBIDDEN = [
  { spec: "@/lib/draft-store", why: "writes the live draft state file" },
  { spec: "@/lib/draft-service", why: "reads and writes the live draft" },
  { spec: "@/lib/draft-store-db", why: "writes draft state to Postgres" },
  { spec: "@/lib/supabase", why: "talks to Postgres" },
];

for (const file of MOCK_FEATURE) {
  const full = path.join(process.cwd(), file);
  if (!existsSync(full)) {
    check(`${file} exists`, false);
    continue;
  }
  const source = readFileSync(full, "utf8");
  const offenders = FORBIDDEN.filter((f) =>
    new RegExp(`from\\s+["']${f.spec.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}`).test(source),
  );
  check(
    `${file} imports nothing that can write the live board or the DB`,
    offenders.length === 0,
    offenders.map((o) => `${o.spec} (${o.why})`).join(", "),
  );
}

/** The only module in the feature that performs I/O at all. */
const storeSource = readFileSync(
  path.join(process.cwd(), "src/lib/mock-draft-store.ts"),
  "utf8",
);
check(
  "mock-draft-store imports nothing that can write the live board or the DB",
  FORBIDDEN.every(
    (f) =>
      !new RegExp(`from\\s+["']${f.spec.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")}`).test(
        storeSource,
      ),
  ),
);
check(
  "mock-draft-store's only filename literal is the mock one",
  /mock-draft-state-\$\{season\}\.json/.test(storeSource),
);
check(
  "…and it refuses any target whose name is not a mock file",
  storeSource.includes('startsWith("mock-draft-state-")'),
);

/*
 * The mock UI must not POST to the live draft routes. Checked as text rather
 * than by types, because a wrong URL is a string, not a type error.
 *
 * Comments are stripped first. Without that, the file's own explanation of what
 * it does not call ("no fetch to /api/draft/pick") fails the check — which it
 * did on the first run, and which is a good reminder that a grep over source is
 * only as good as its idea of what counts as code.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const clientSource = codeOnly(
  readFileSync(path.join(process.cwd(), "src/components/mock-draft.tsx"), "utf8"),
);
const clientRoutes = [...new Set(clientSource.match(/\/api\/[a-z-]+\/?[a-z-]*/g) ?? [])];
check(
  "the mock client never calls /api/draft/*",
  !clientRoutes.some((u) => u.startsWith("/api/draft")),
  clientRoutes.join(", "),
);
check(
  "the mock client only ever calls /api/mock-draft/*",
  clientRoutes.length > 0 && clientRoutes.every((u) => u.startsWith("/api/mock-draft")),
  clientRoutes.join(", "),
);

/*
 * The setup screen sends nothing anywhere. It is the surface the page now opens
 * on, so the claim that landing on /mock changes no state on any machine rests
 * on this file having no request in it at all — not on the URLs being right.
 */
const setupSource = codeOnly(
  readFileSync(path.join(process.cwd(), "src/components/mock-draft-setup.tsx"), "utf8"),
);
check(
  "the setup screen makes no request of any kind",
  !/\bfetch\s*\(/.test(setupSource) && !/XMLHttpRequest|navigator\.sendBeacon/.test(setupSource),
);

// --- 3. The two file shapes are mutually unreadable -------------------------

section("3. A mock file and a live state file cannot be mistaken for each other");

const board = getBoard();
const pool = toMockPool(getPlayerPool());

const emptyMock = toMockFile({
  state: freshMockState(board),
  controlledTeamId: null,
  archetypes: defaultAssignment(board),
  sources: {},
  startedAt: new Date().toISOString(),
});

check("the live loader REFUSES a mock file", !isDraftStateFile(emptyMock));
check("the mock loader REFUSES live draft state", !isMockDraftFile(liveParsed));
check("a mock file is recognised as a mock file", isMockDraftFile(emptyMock));
check(
  'a mock file\'s version is the string "mock-1", not the number 1',
  emptyMock.version === "mock-1",
);
check(
  "a round trip through the mock file shape preserves the picks",
  fromMockFile(emptyMock).state.picks.length === 0,
);

// --- 4. Run a complete mock -------------------------------------------------

section("4. A complete mock draft, through the code the browser runs");

const keeperCount = board.keeperCount;
const expectedPicks = TOTAL_PICKS - keeperCount;
check(`the board matches the league: ${TOTAL_PICKS} slots`, board.slots.length === TOTAL_PICKS);
check(`${LEAGUE.teams} franchises`, board.teamCount === LEAGUE.teams);
check(`${DRAFT.rounds} rounds`, board.rounds === DRAFT.rounds);
/*
 * THE 29 TRADED PICKS AND THE PRE-PLACED KEEPERS BELONGED TO THE OTHER LEAGUE.
 * Ron and Friends is an inaugural redraft: `FEATURES.tradedPicks` is false, so
 * every slot is owned by the franchise it was born to, and the keeper files are
 * empty so nothing is pre-placed. Asserting the old numbers failed on the
 * league rather than on a bug. The redraft branch asserts the ABSENCE, which is
 * the check that the wipe actually took.
 */
check(
  FEATURES.tradedPicks
    ? `traded picks are on the board to follow (${board.tradedCount})`
    : "no traded picks on the board — this league does not trade them",
  FEATURES.tradedPicks ? board.tradedCount > 0 : board.tradedCount === 0,
  `got ${board.tradedCount}`,
);
check(
  keeperCount > 0
    ? `${keeperCount} keepers pre-placed, every one holding a player`
    : "no keepers pre-placed — every cell is open for a redraft",
  keeperCount > 0
    ? board.slots.filter((s) => s.isKeeper).every((s) => s.player != null)
    : board.slots.every((s) => !s.isKeeper),
);
check(
  "the player pool the mock is handed contains no kicker",
  !pool.some((p) => !(DRAFTABLE_POSITIONS as readonly string[]).includes(p.position)),
  [...new Set(pool.map((p) => p.position))].join(", "),
);

/** Keepers, recorded before the mock so availability can be checked after. */
const keeperPlayerIds = new Set(
  board.slots.filter((s) => s.isKeeper && s.player).map((s) => s.player!.id),
);
const keeperBySlot = new Map(
  board.slots.filter((s) => s.isKeeper && s.player).map((s) => [s.id, s.player!.id]),
);
const tradedSlots = board.slots.filter((s) => s.traded);

const archetypes: ArchetypeAssignment = defaultAssignment(board);
const rng = mulberry32(20260829);

/**
 * The live store drops a timestamped backup on every write, so a new one
 * appearing is a tripwire for "something wrote the live board".
 *
 * The window is deliberately tight — captured immediately before the mock runs
 * and compared immediately after, which is a few tens of milliseconds. A wider
 * window picks up any other process legitimately using the live store (another
 * verification script, or the commissioner's own dev server) and reports it as a
 * mock failure, which it is not.
 */
const BACKUP_DIR = path.join(process.cwd(), "data", "draft-backups");
function newestLiveBackupMs(): number {
  if (!existsSync(BACKUP_DIR)) return 0;
  let newest = 0;
  for (const f of readdirSync(BACKUP_DIR)) {
    if (!f.startsWith(`draft-state-${CURRENT_SEASON}-`)) continue;
    const m = statSync(path.join(BACKUP_DIR, f)).mtimeMs;
    if (m > newest) newest = m;
  }
  return newest;
}
const backupsBefore = newestLiveBackupMs();
const shaImmediatelyBefore = sha256(LIVE_STATE);

const offeredKeepers: string[] = [];
const misattributed: string[] = [];
const relaxed: string[] = [];
const dstRounds: number[] = [];
const positionSequence: string[] = [];

const { state: mockState, view: mockView, steps } = runWholeMock({
  board,
  pool,
  archetypes,
  rng,
  onStep: (step) => {
    if (step.choice.tier !== "preferred") {
      relaxed.push(`${step.slot.label} ${step.choice.tier}`);
    }
    // A keeper's player must never be offered to a bot.
    if (keeperPlayerIds.has(step.choice.player.id)) {
      offeredKeepers.push(`${step.choice.player.name} at ${step.slot.label}`);
    }
    const written = step.state.picks[step.state.picks.length - 1];
    if (written.teamId !== step.slot.currentOwner.id) {
      misattributed.push(
        `${step.slot.label} credited to ${written.teamName}, owned by ${step.slot.currentOwner.name}`,
      );
    }
    if (step.choice.player.position === "DST") dstRounds.push(step.slot.round);
    positionSequence.push(step.choice.player.position);
  },
});

const backupsAfter = newestLiveBackupMs();
const shaImmediatelyAfter = sha256(LIVE_STATE);

check(`${expectedPicks} picks made (160 slots − ${keeperCount} keepers)`, steps === expectedPicks, `got ${steps}`);
check(
  "the live board did not change while the mock ran",
  shaImmediatelyAfter === shaImmediatelyBefore,
);
check(
  "the live store wrote no backup while the mock ran",
  backupsAfter === backupsBefore,
  "a backup appeared inside the mock's execution window",
);
check("the board is full", mockView.filled === TOTAL_PICKS, `filled ${mockView.filled}`);
check("nothing is left on the clock", mockView.onTheClockSlotId === null);
check("the mock raised no conflicts", mockView.conflicts.length === 0);
check(
  "no bot ever needed a relaxed candidate set",
  relaxed.length === 0,
  relaxed.slice(0, 4).join("; "),
);

section("4a. No player twice, no keeper ever available, no kicker");
const allIds = mockView.slots.filter((s) => s.player).map((s) => s.player!.id);
const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
check(
  `${TOTAL_PICKS} slots hold ${TOTAL_PICKS} distinct players`,
  new Set(allIds).size === TOTAL_PICKS,
  dupes.length ? `duplicated: ${[...new Set(dupes)].join(", ")}` : "",
);
check(
  "no keeper was ever offered to a bot as available",
  offeredKeepers.length === 0,
  offeredKeepers.slice(0, 4).join("; "),
);
const keeperDamage = board.slots
  .filter((s) => s.isKeeper)
  .filter((s) => {
    const now = mockView.slots.find((v) => v.id === s.id)!;
    return now.fill !== "keeper" || now.player?.id !== keeperBySlot.get(s.id);
  })
  .map((s) => s.label);
check(
  `all ${keeperCount} keepers still hold their own player`,
  keeperDamage.length === 0,
  keeperDamage.join(", "),
);
check(
  "no kicker anywhere on the finished board",
  mockView.slots.every(
    (s) => !s.player || (DRAFTABLE_POSITIONS as readonly string[]).includes(s.player.position),
  ),
);

section("4b. Traded picks went to the franchise that acquired them");
check(
  FEATURES.tradedPicks
    ? `there are traded slots to check (${tradedSlots.length})`
    : "there are no traded slots to check — this league does not trade picks",
  FEATURES.tradedPicks ? tradedSlots.length > 0 : tradedSlots.length === 0,
  `got ${tradedSlots.length}`,
);
const tradedWrong: string[] = [];
for (const slot of tradedSlots) {
  const filled = mockView.slots.find((s) => s.id === slot.id)!;
  if (filled.currentOwner.id === slot.originalOwner.id) {
    tradedWrong.push(`${slot.label} still credited to its original owner`);
    continue;
  }
  if (filled.fill === "pick") {
    const record = mockState.picks.find((p) => p.slotId === slot.id);
    if (!record) {
      tradedWrong.push(`${slot.label} has no pick record`);
    } else if (record.teamId !== slot.currentOwner.id) {
      tradedWrong.push(`${slot.label} → ${record.teamName}, expected ${slot.currentOwner.name}`);
    }
  }
}
check(
  tradedSlots.length
    ? `all ${tradedSlots.length} landed with the acquiring franchise, not the original`
    : "no traded slot could land with the wrong franchise, because there are none",
  tradedWrong.length === 0,
  tradedWrong.slice(0, 4).join("; "),
);
check("no misattribution recorded during the run", misattributed.length === 0, misattributed.slice(0, 3).join("; "));

section("4c. All ten franchises finished with a legal, plausible roster");
const lineups = buildFranchiseLineups(mockView);
const short = lineups.filter((l) => l.openStarterLabels.length > 0);
const over = lineups.filter((l) => l.overflow.length > 0);
const wrongSize = lineups.filter((l) => l.rosterSize !== ROSTER.activeCap);
const overCap = lineups.filter((l) =>
  Object.entries(l.byPosition).some(([pos, n]) => n > (ROSTER.positionalMax[pos] ?? Infinity)),
);
const threeQb = lineups.filter((l) => (l.byPosition.QB ?? 0) > BOT_LIMITS.hardMax.QB);
const threeTe = lineups.filter((l) => (l.byPosition.TE ?? 0) > BOT_LIMITS.hardMax.TE);
const wrongDst = lineups.filter((l) => (l.byPosition.DST ?? 0) !== 1);
const noQb = lineups.filter((l) => (l.byPosition.QB ?? 0) < 1);

check(
  `all ten can field ${STARTER_COUNT} starters`,
  short.length === 0,
  short.map((l) => `${l.team.name} needs ${l.openStarterLabels.join("/")}`).join("; "),
);
check(
  `all ten hold exactly ${ROSTER.activeCap} players`,
  wrongSize.length === 0,
  wrongSize.map((l) => `${l.team.name} ${l.rosterSize}`).join(", "),
);
check("nobody is over a league position cap", overCap.length === 0);
check("nobody is over the active roster", over.length === 0);
check(
  `nobody sat on three quarterbacks (max ${BOT_LIMITS.hardMax.QB})`,
  threeQb.length === 0,
  threeQb.map((l) => `${l.team.name} QB${l.byPosition.QB}`).join(", "),
);
check(
  `nobody sat on three tight ends (max ${BOT_LIMITS.hardMax.TE})`,
  threeTe.length === 0,
  threeTe.map((l) => `${l.team.name} TE${l.byPosition.TE}`).join(", "),
);
check(
  "every franchise took exactly one defense",
  wrongDst.length === 0,
  wrongDst.map((l) => `${l.team.name} DST${l.byPosition.DST}`).join(", "),
);
check("every franchise has at least one quarterback", noQb.length === 0);
check(
  `every defense went in round ${BOT_LIMITS.dstEarliestRound} or later`,
  dstRounds.every((r) => r >= BOT_LIMITS.dstEarliestRound),
  `rounds: ${dstRounds.sort((a, b) => a - b).join(", ")}`,
);

console.log("\n  Finished rosters:");
for (const l of lineups) {
  const bp = l.byPosition;
  console.log(
    `    ${l.team.name.padEnd(7)} ${archetypeByKey(archetypes[l.team.id]).name.padEnd(13)}` +
      ` QB${bp.QB} RB${bp.RB} WR${bp.WR} TE${bp.TE} DST${bp.DST}  ${l.rosterSize}/${l.rosterCap}` +
      `  keepers ${l.keeperCount}`,
  );
}

// Positional runs, reported rather than asserted: they are an emergent property
// and pinning a number would make a tuning change look like a regression.
let longestRun = 1;
let current = 1;
let runsOfThree = 0;
for (let i = 1; i <= positionSequence.length; i++) {
  if (i < positionSequence.length && positionSequence[i] === positionSequence[i - 1]) {
    current++;
  } else {
    if (current > longestRun) longestRun = current;
    if (current >= 3) runsOfThree++;
    current = 1;
  }
}
console.log(
  `\n  Positional runs: ${runsOfThree} of three or more, longest ${longestRun}. ` +
    `Emergent from need-weighting, not injected.`,
);

// --- 4d. The archetype table is coherent ------------------------------------

section("4d. Every bot personality is internally consistent");
for (const a of BOT_ARCHETYPES) {
  const total = Object.values(a.target).reduce((n, v) => n + v, 0);
  check(
    `${a.name}: target roster sums to ${ROSTER.activeCap}`,
    total === ROSTER.activeCap,
    `sums to ${total}`,
  );
  const overHard = Object.entries(a.target).filter(
    ([pos, n]) => n > (BOT_LIMITS.hardMax[pos] ?? Infinity),
  );
  check(
    `${a.name}: no target exceeds a hard limit`,
    overHard.length === 0,
    overHard.map(([p, n]) => `${p} ${n}`).join(", "),
  );
}
check(
  "every franchise gets a real archetype by default",
  board.teams.every((t) => archetypeByKey(defaultArchetypeFor(t.slot)).key === defaultArchetypeFor(t.slot)),
);

// --- 4e. A human pick and an override behave like the live board ------------

section("4e. The commissioner's own pick, and the duplicate override");
{
  let s = freshMockState(board);
  const first = botPickOnce({ board, state: s, pool, archetypes, rng: mulberry32(7) })!;
  s = first.state;
  const view2 = first.view;
  const openSlot = view2.slots.find((x) => x.fill === null)!;
  const alreadyTaken = view2.slots.find((x) => x.player)!.player!;

  let refused = false;
  try {
    chooseMockPick({
      view: view2,
      pool,
      slot: openSlot,
      archetype: archetypeByKey("balanced"),
      rng: mulberry32(1),
    });
  } catch {
    refused = true;
  }
  check("the AI can always find a pick on a live board", !refused);

  const takenSlot = view2.slots.find((x) => x.player?.id === alreadyTaken.id)!;
  check(
    "a player already on the board is findable, so the duplicate moment can fire",
    takenSlot != null && view2.draftedPlayerIds.includes(alreadyTaken.id),
  );
}

// --- 5. THE LIVE BOARD IS BYTE-IDENTICAL ------------------------------------

section("5. The live draft board after a complete mock");

const liveAfter = {
  sha: sha256(LIVE_STATE),
  bytes: statSync(LIVE_STATE).size,
  text: readFileSync(LIVE_STATE, "utf8"),
};

check(
  "sha256 of data/draft-state-2026.json is unchanged",
  liveAfter.sha === liveBefore.sha,
  `${liveBefore.sha.slice(0, 16)}… → ${liveAfter.sha.slice(0, 16)}…`,
);
check(
  "byte length is unchanged",
  liveAfter.bytes === liveBefore.bytes,
  `${liveBefore.bytes} → ${liveAfter.bytes}`,
);
check("the file is byte-for-byte identical", liveAfter.text === liveBefore.text);
check(
  "the entered pick count is unchanged",
  isDraftStateFile(JSON.parse(liveAfter.text)) &&
    (JSON.parse(liveAfter.text) as { picks: unknown[] }).picks.length === livePickCount,
);

// --- 6. The mock's own file -------------------------------------------------

section("6. The mock's own storage");

const savedMock = toMockFile({
  state: mockState,
  controlledTeamId: board.teams[0].id,
  archetypes,
  sources: {},
  startedAt: new Date().toISOString(),
});
check(
  `a finished mock serialises to ${expectedPicks} mock picks`,
  savedMock.picks.length === expectedPicks,
);
check(
  "…and the live loader still refuses it",
  !isDraftStateFile(savedMock),
);
check(
  "…and it round-trips back to an identical board",
  fromMockFile(savedMock).state.picks.length === mockState.picks.length,
);
check(
  "the mock's filename is not the live board's",
  path.basename(MOCK_STATE) !== path.basename(LIVE_STATE),
  `${path.basename(MOCK_STATE)} vs ${path.basename(LIVE_STATE)}`,
);

/*
 * The store is exercised for real, then cleaned up — but only if the file did
 * not already exist, so running this does not throw away a mock in progress.
 */
{
  const preexisting = existsSync(MOCK_STATE);
  const { writeMockDraft, readMockDraft } = await import("@/lib/mock-draft-store");
  const probe = { ...savedMock, boardFingerprint: boardFingerprint(board) };
  writeMockDraft(probe);
  check("writing a mock lands in the mock file", existsSync(MOCK_STATE));
  const readBack = readMockDraft(CURRENT_SEASON);
  check(
    "reading it back gives the same number of picks",
    readBack?.picks.length === probe.picks.length,
  );
  check(
    "the live board is STILL byte-identical after the mock store wrote",
    sha256(LIVE_STATE) === liveBefore.sha,
  );
  if (!preexisting) rmSync(MOCK_STATE, { force: true });
}

// --- Result -----------------------------------------------------------------

console.log(`\n  ${checks} checks, ${failures.length} failed.`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  • ${f}`);
  console.log("");
  process.exit(1);
}
console.log("\nAll checks passed. A complete mock left the live board untouched.\n");
process.exit(0);

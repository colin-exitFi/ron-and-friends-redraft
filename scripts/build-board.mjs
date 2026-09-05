#!/usr/bin/env node
/**
 * Stamp out the draft board: one open cell per franchise per round, its shape
 * read from `LEAGUE.teams` and `DRAFT.rounds` rather than written down here.
 *
 * WHY A GENERATOR AND NOT A HAND-WRITTEN FILE
 * ============================================================================
 * The board this app renders is derived from one snapshot file, and that file
 * used to come out of another product (Smart Draft) for the previous league.
 * Ron and Friends drafts here and nowhere else, so there is no room to pull
 * from — the snapshot is ours to produce. Producing it with a script rather
 * than by hand matters for one specific reason: if the draft order or the round
 * count changes, re-running this is the whole fix. Editing a hundred and fifty
 * objects by hand at 6pm is not.
 *
 * DETERMINISTIC BY CONSTRUCTION
 * ============================================================================
 * Slot ids are a UUID v5 over (season, round, pick), so running this twice
 * produces a byte-identical file. That is load-bearing rather than tidy: the
 * board's fingerprint (`boardFingerprint` in src/lib/draft-engine.ts) is a hash
 * of the slot ids and their owners, a saved draft records the fingerprint it
 * was entered against, and a fingerprint that moved means "ownership changed",
 * which the app treats as alarming. A random id per run would raise that alarm
 * every time somebody re-stamped the board.
 *
 * WHAT IT DELIBERATELY DOES NOT PRODUCE
 * ============================================================================
 * No keepers and no traded picks. This is a redraft in its inaugural season:
 * every `pickType` is null, every cell's `player` is null, and every slot's
 * current owner is its original owner. Those are the three fields the board
 * reads to draw a padlock, a pre-placed player, or a traded-pick marker, so
 * writing them empty is what guarantees a clean board.
 *
 * Usage:
 *   npm run build:board
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/*
 * `league-config.ts` has no imports of its own, so Node's type stripping is all
 * that is needed to read it — no alias resolution to arrange. The npm script
 * passes `--experimental-strip-types` for this.
 */
import { DRAFT, LEAGUE, ROSTER } from "../src/lib/league-config.ts";

const ROOT = process.cwd();
const dataPath = (...p) => path.join(ROOT, "data", ...p);

function readJson(...p) {
  return JSON.parse(readFileSync(dataPath(...p), "utf8"));
}

/**
 * A stable UUID for a stable string. UUID v5 over the DNS namespace; the value
 * only has to be deterministic, not meaningful. Same helper as the seed uses.
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

const { managers } = readJson("managers.json");

const sleeperDraft = readJson("sleeper", "draft.json");
const sleeperLeague = readJson("sleeper", "league.json");

/*
 * THE LEAGUE CONFIG IS AUTHORITATIVE FOR THE BOARD'S SHAPE. SLEEPER IS NOT.
 *
 * This used to read `settings.rounds` straight out of the Sleeper pull, on the
 * reasoning that Sleeper owns the draft's shape. That broke the day the
 * commissioner changed the round count: he decides, then he edits Sleeper, and
 * in between the cached pull still says the old number. A generator that
 * believes the pull stamps the OLD board and looks like it worked.
 *
 * So the round count comes from `DRAFT.rounds` and the team count from
 * `LEAGUE.teams`, and Sleeper is CROSS-CHECKED rather than obeyed — a
 * disagreement is a warning naming which side has not caught up, not a failure
 * and not a silent overwrite.
 */
const ROUNDS = DRAFT.rounds;
const TEAMS = LEAGUE.teams;
const SEASON = Number(sleeperLeague.season);
const SNAKE = (sleeperDraft.type ?? "snake") === "snake";

// --- Checks that are worth failing on -------------------------------------

if (!ROUNDS || !TEAMS) {
  console.error("src/lib/league-config.ts has no round or team count. Fix DRAFT.rounds / LEAGUE.teams.");
  process.exit(1);
}

/*
 * Sleeper runs the clock in the room tonight, so a mismatch here is worth
 * saying out loud every single time the board is stamped.
 */
const sleeperRounds = sleeperDraft.settings?.rounds;
const sleeperTeams = sleeperDraft.settings?.teams ?? sleeperLeague.total_rosters;
const sleeperBench = sleeperDraft.settings?.slots_bn;
const drift = [];
if (sleeperRounds && sleeperRounds !== ROUNDS) {
  drift.push(`rounds: config says ${ROUNDS}, Sleeper's last pull says ${sleeperRounds}`);
}
if (sleeperTeams && sleeperTeams !== TEAMS) {
  drift.push(`teams: config says ${TEAMS}, Sleeper's last pull says ${sleeperTeams}`);
}
if (typeof sleeperBench === "number" && sleeperBench !== ROSTER.bench) {
  drift.push(`bench: config says ${ROSTER.bench}, Sleeper's last pull says ${sleeperBench}`);
}
if (drift.length) {
  console.warn("\n  ⚠ SLEEPER HAS NOT CAUGHT UP WITH THE LEAGUE CONFIG\n");
  for (const d of drift) console.warn(`    · ${d}`);
  console.warn(
    "\n    The board below is stamped from the CONFIG, which is the commissioner's\n" +
      "    decision and wins. But SLEEPER IS WHAT RUNS THE CLOCK IN THE ROOM, so it\n" +
      "    has to be changed there too before kickoff. If he has already saved it,\n" +
      "    re-run `npm run pull:sleeper` and this warning will go away.\n",
  );
}

if (managers.length !== TEAMS) {
  console.error(
    `data/managers.json lists ${managers.length} franchises but Sleeper says the ` +
      `league has ${TEAMS}. Re-run \`npm run pull:sleeper\` and reconcile before drafting.`,
  );
  process.exit(1);
}

const slots = new Set(managers.map((m) => m.draftSlot));
for (let s = 1; s <= TEAMS; s++) {
  if (!slots.has(s)) {
    console.error(`No franchise holds draft slot ${s}. Every slot 1..${TEAMS} must be filled.`);
    process.exit(1);
  }
}

const shortNames = managers.map((m) => m.shortName.trim().toLowerCase());
if (new Set(shortNames).size !== shortNames.length) {
  console.error(
    "Two franchises share a short name in data/managers.json. Short names are the " +
      "join key for every other source and the label the board prints, so they must be unique.",
  );
  process.exit(1);
}

if (sleeperDraft.settings?.reversal_round) {
  console.error(
    `Sleeper has reversal_round = ${sleeperDraft.settings.reversal_round} (a third-round ` +
      `reversal). This generator only produces a plain snake and would draw the wrong ` +
      `board. Teach it the reversal before drafting.`,
  );
  process.exit(1);
}

// --- The board -------------------------------------------------------------

const byDraftSlot = [...managers].sort((a, b) => a.draftSlot - b.draftSlot);

const teams = byDraftSlot.map((m) => ({
  id: m.sleeperUserId,
  // The board prints this in a 40px cell and `franchiseByShortName` joins on
  // it, so it must be the short name and nothing else.
  name: m.shortName,
  orderKey: m.draftSlot * 10,
  ownerName: m.fullName ?? null,
  claimed: true,
  claimedByUserId: m.sleeperUserId,
  deletedAt: null,
  invitePending: false,
  budgetOverride: null,
}));

const boardSlots = [];
for (let round = 1; round <= ROUNDS; round++) {
  // Snake: even rounds run right to left. `pickInRound` is the position in PICK
  // order, so the franchise it belongs to is what reverses, not the numbering.
  const reversed = SNAKE && round % 2 === 0;
  for (let pickInRound = 1; pickInRound <= TEAMS; pickInRound++) {
    const draftSlot = reversed ? TEAMS + 1 - pickInRound : pickInRound;
    const owner = byDraftSlot[draftSlot - 1];
    const overallPick = (round - 1) * TEAMS + pickInRound;

    boardSlots.push({
      slotKey: deterministicUuid(`ron-and-friends:${SEASON}:${round}:${pickInRound}`),
      section: "DRAFT",
      sectionRoundNumber: round,
      // Redraft, inaugural season: nothing has been traded, so the pick's
      // original owner and its current owner are the same franchise.
      originalOwnerTeamId: owner.sleeperUserId,
      currentOwnerTeamId: owner.sleeperUserId,
      // No keepers. `KEEPER` here is what draws a padlock and blocks the cell.
      pickType: null,
      player: null,
      displayRound: round,
      pickInRound,
      overallPick,
      isCurrent: overallPick === 1,
      price: null,
      bidHistory: null,
    });
  }
}

const snapshot = {
  _PROVENANCE: {
    generatedBy: "scripts/build-board.mjs",
    generatedAt: new Date().toISOString(),
    from: `src/lib/league-config.ts for the shape; Sleeper league ${sleeperLeague.league_id} (${sleeperLeague.name}) and data/managers.json for the franchises`,
    shape: `${TEAMS} teams x ${ROUNDS} rounds = ${boardSlots.length} slots`,
    shapeAuthority:
      "LEAGUE.teams and DRAFT.rounds in src/lib/league-config.ts. NOT the Sleeper pull — the " +
      "commissioner decides the round count and edits Sleeper afterwards, so the pull lags.",
    keepers: "None. Redraft — every cell is open.",
    tradedPicks: "None. Inaugural season — no pick has changed hands.",
    reRunWhen: "The draft order changes, a franchise changes its short name, or DRAFT.rounds changes.",
  },
  state: {
    roomId: deterministicUuid(`ron-and-friends:${SEASON}:room`),
    name: sleeperLeague.name,
    status: "pre_draft",
    settings: {
      draftFormat: SNAKE ? "snake" : "linear",
      rosterConfig: {
        QB: sleeperDraft.settings?.slots_qb ?? 0,
        RB: sleeperDraft.settings?.slots_rb ?? 0,
        WR: sleeperDraft.settings?.slots_wr ?? 0,
        TE: sleeperDraft.settings?.slots_te ?? 0,
        FLEX: sleeperDraft.settings?.slots_flex ?? 0,
        DST: sleeperDraft.settings?.slots_def ?? 0,
        K: sleeperDraft.settings?.slots_k ?? 0,
        // From the config, not the pull, for the same reason as the round
        // count: the sixth bench spot is the commissioner's decision and
        // Sleeper may not have been edited yet. The `drift` warning above says
        // so when they disagree.
        BN: ROSTER.bench,
      },
      scoringFormat: sleeperDraft.metadata?.scoring_type ?? null,
      pickTimerSeconds: sleeperDraft.settings?.pick_timer ?? null,
      boardLocked: false,
    },
    keeperRoundCount: 0,
    draftRoundCount: ROUNDS,
    teams,
    slots: boardSlots,
    draftedPlayerIds: [],
    mockConfig: null,
  },
};

writeFileSync(
  dataPath("smartdraft-room-snapshot.json"),
  `${JSON.stringify(snapshot, null, 1)}\n`,
);

console.log(`Board stamped: ${TEAMS} teams x ${ROUNDS} rounds = ${boardSlots.length} slots`);
console.log(`  league    ${sleeperLeague.name} (${SEASON})`);
console.log(`  format    ${SNAKE ? "snake" : "linear"}`);
console.log(`  keepers   0`);
console.log(`  traded    0`);
console.log(`\n  draft order:`);
for (const m of byDraftSlot) {
  console.log(`    ${String(m.draftSlot).padStart(2)}  ${m.shortName.padEnd(8)} ${m.franchiseName}`);
}
console.log(`\nWrote data/smartdraft-room-snapshot.json`);

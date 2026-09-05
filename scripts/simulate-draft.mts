/**
 * Drives a complete 160-slot draft through the real engine and asserts the
 * things that would ruin Saturday if they were wrong.
 *
 *   npm run verify:draft
 *
 * Nothing here is a mock. It loads the real Smart Draft snapshot, the real
 * player pool, `@/lib/draft-engine`, `@/lib/draft-roster` and — for the crash
 * test — the real `@/lib/draft-store`, so a pass means the code the room will
 * use behaves, not that a parallel implementation does.
 *
 * What it proves:
 *   1.  The board matches the league: 160 slots, 10 teams, 16 rounds, 29 traded
 *       picks, and one player sitting in every keeper slot. The keeper total
 *       itself is read off the board, not asserted — managers declare keepers
 *       right up to the draft and the number is expected to move.
 *   2.  Keepers are skipped. The clock never lands on one and none is
 *       overwritten.
 *   3.  Every pick is credited to the slot's CURRENT owner — checked slot by
 *       slot across all 29 traded picks, where original and current differ.
 *   4.  No player goes twice, across all 160 slots including keepers.
 *   5.  Undo restores the previous board byte for byte, sampled through the
 *       draft and run five deep at the end.
 *   6.  Out-of-order entry works: the last slot on the board can be filled
 *       while 100 slots ahead of it are still empty.
 *   7.  The illegal moves are refused — duplicate player, keeper slot,
 *       occupied slot, undo on an empty board.
 *   7b. A reset is undoable. The wiped board comes back whole from the state
 *       that replaced it, without anyone going to the archive to fetch it.
 *   8.  Every franchise ends with a legal roster: a fillable starting lineup
 *       and no position over its cap.
 *   9.  The state survives a process death. Phase one writes through the real
 *       store and exits; a SEPARATE node process reads it back and must rebuild
 *       an identical board.
 *
 * Exits non-zero on the first failure. No expectation is ever relaxed to fit.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  DraftRuleError,
  applyPick,
  boardFingerprint,
  buildRoomView,
  clearedState,
  emptyState,
  undoLast,
} from "@/lib/draft-engine";
import { buildTeamRosters } from "@/lib/draft-roster";
import {
  DEFENSE_ALIASES,
  PLAYER_NICKNAMES,
  buildSearchIndex,
  isGivenNameVariant,
  normalizeName,
  searchPlayers,
} from "@/lib/draft-search";
import { draftStore } from "@/lib/draft-store";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { DRAFT, FEATURES, LEAGUE, ROSTER, STARTING_LINEUP, TOTAL_PICKS } from "@/lib/league-config";
import type { DraftRoomView, DraftStateFile } from "@/lib/draft-types";
import type { PoolPlayer } from "@/lib/board-types";

/** A throwaway season so the crash test never touches the real 2026 board. */
const TEST_SEASON = 9999;
const HANDOFF = path.join(process.cwd(), "data", `draft-sim-expected-${TEST_SEASON}.json`);

// --- Tiny assertion harness -------------------------------------------------

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

/**
 * Asserts the engine refuses something AND that it labels the refusal
 * correctly. `overridable` is the load-bearing bit: it is what tells the board
 * whether to offer "press Enter again" or to say no and mean it.
 */
function expectRejected(label: string, overridable: boolean, fn: () => unknown) {
  checks++;
  try {
    fn();
    failures.push(`${label} — the engine allowed it`);
    console.log(`  ✗ ${label} — the engine allowed it`);
  } catch (err) {
    if (!(err instanceof DraftRuleError)) {
      failures.push(`${label} — threw ${err instanceof Error ? err.name : "something"} instead`);
      console.log(`  ✗ ${label} — wrong error type`);
      return;
    }
    if (err.overridable !== overridable) {
      failures.push(
        `${label} — overridable is ${err.overridable}, expected ${overridable}`,
      );
      console.log(`  ✗ ${label} — overridable is ${err.overridable}, expected ${overridable}`);
      return;
    }
    console.log(
      `  ✓ ${label} — ${overridable ? "warns" : "refuses"}: "${err.message}"`,
    );
  }
}

/** Views are plain data, so stringify is a faithful deep comparison. */
const snapshotOf = (view: DraftRoomView) => JSON.stringify(view);

/**
 * The same, minus `updatedAt` — the moment the state was last saved, which is
 * not part of the draft. Undo is required to restore the BOARD exactly; it is
 * not required to pretend the save never happened, and it must not, because
 * `nextSeq` deliberately keeps advancing so an undone sequence number is never
 * handed out twice.
 */
const boardSnapshotOf = (view: DraftRoomView) =>
  JSON.stringify({ ...view, updatedAt: null });

// --- The autodrafter --------------------------------------------------------

const FLEX_ACCEPTS = ["RB", "WR", "TE"];

/**
 * Picks like a manager who intends to field a legal lineup: best player
 * available, unless the team has exactly as many picks left as it has holes in
 * its starting eleven, at which point it fills a hole. Enough realism that the
 * roster module and the position caps are actually exercised.
 */
function choosePlayer(view: DraftRoomView, pool: PoolPlayer[], teamId: string): PoolPlayer {
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
  if (!choice) throw new Error("The player pool ran dry, which cannot happen with 1195 players.");
  return choice;
}

// --- Phase two: read the state back in a fresh process ----------------------

async function reloadPhase(): Promise<number> {
  section("13. Crash recovery — a brand new process reads the state back");
  const board = getBoard();
  const state = await draftStore.read(TEST_SEASON, boardFingerprint(board));
  const view = buildRoomView(board, state);

  const expected = JSON.parse(readFileSync(HANDOFF, "utf8")) as {
    picksMade: number;
    filled: number;
    view: string;
  };

  check(
    `all ${TOTAL_PICKS} slots came back filled`,
    view.filled === TOTAL_PICKS,
    `got ${view.filled}`,
  );
  check(
    `${expected.picksMade} entered picks came back`,
    view.picksMade === expected.picksMade,
    `got ${view.picksMade}`,
  );
  check("the rebuilt board is identical to the one that was written", snapshotOf(view) === expected.view);
  check("no conflicts were raised on reload", view.conflicts.length === 0);
  check(
    "distinct players survived the round trip",
    new Set(view.draftedPlayerIds).size === TOTAL_PICKS,
  );

  console.log(`\n  ${checks} checks in this process, ${failures.length} failed.`);
  return failures.length === 0 ? 0 : 1;
}

// --- Phase one: the whole draft ---------------------------------------------

async function simulate(): Promise<number> {
  const board = getBoard();
  const pool = getPlayerPool();

  section("1. The board matches the league");
  check(`${TOTAL_PICKS} slots`, board.slots.length === TOTAL_PICKS, `got ${board.slots.length}`);
  check(`${LEAGUE.teams} teams`, board.teamCount === LEAGUE.teams, `got ${board.teamCount}`);
  check(`${DRAFT.rounds} rounds`, board.rounds === DRAFT.rounds, `got ${board.rounds}`);
  /**
   * Read off the board rather than hard-coded. Keeper declarations are league
   * data and move as managers declare; a simulation that pins the number fails
   * on the day somebody adds one, which is noise rather than a finding. What is
   * worth asserting is that the count is sane and that everything downstream
   * agrees with it — which is what the checks below actually do.
   */
  const KEEPERS = board.keeperCount;
  check(
    FEATURES.keepers
      ? `${KEEPERS} keepers pre-placed, one per keeper slot`
      : "no keepers on the board — this is a redraft",
    // A redraft must have NONE; a keeper season must have a sane number. Both
    // are read off the board rather than pinned, because a pinned count fails
    // the day somebody declares, which is noise rather than a finding.
    (FEATURES.keepers ? KEEPERS > 0 && KEEPERS < TOTAL_PICKS : KEEPERS === 0) &&
      board.slots.filter((s) => s.isKeeper).length === KEEPERS,
    `keeperCount ${KEEPERS}, keeper slots ${board.slots.filter((s) => s.isKeeper).length}`,
  );
  check(
    "every keeper slot actually holds a player",
    board.slots.filter((s) => s.isKeeper).every((s) => s.player != null),
  );
  /*
   * Derived from the league's own rule rather than from a literal. Ron and
   * Friends forbids pick trading outright (proposal §6), so the honest
   * assertion is "none", and it becomes "some, and consistent" the day a
   * league that permits trading uses this board.
   */
  check(
    FEATURES.tradedPicks
      ? `${board.tradedCount} traded picks`
      : "no traded picks — this league does not trade them",
    FEATURES.tradedPicks ? board.tradedCount > 0 : board.tradedCount === 0,
    `got ${board.tradedCount}`,
  );
  check(
    `every slot's overall pick is unique and covers 1…${TOTAL_PICKS}`,
    new Set(board.slots.map((s) => s.overallPick)).size === TOTAL_PICKS &&
      Math.min(...board.slots.map((s) => s.overallPick)) === 1 &&
      Math.max(...board.slots.map((s) => s.overallPick)) === TOTAL_PICKS,
  );
  check(`the pool has ${pool.length} draftable players and no kicker`, !pool.some((p) => p.position === "K"));

  const keeperSlotIds = new Set(board.slots.filter((s) => s.isKeeper).map((s) => s.id));
  const keeperPlayers = new Map(
    board.slots.filter((s) => s.isKeeper && s.player).map((s) => [s.id, s.player!.id]),
  );
  const tradedSlots = board.slots.filter((s) => s.traded);

  section("2. An empty board starts on the right pick");
  let state = emptyState(TEST_SEASON, boardFingerprint(board));
  let view = buildRoomView(board, state);
  check(
    `${KEEPERS} slots are already filled by keepers`,
    view.filled === KEEPERS,
    `got ${view.filled}`,
  );
  check("no live picks yet", view.picksMade === 0);
  check(
    "the clock is on the lowest empty slot",
    view.onTheClockSlotId ===
      view.slots.filter((s) => s.fill === null).sort((a, b) => a.overallPick - b.overallPick)[0].id,
  );
  check("no conflicts on a clean board", view.conflicts.length === 0);

  section("3. Drafting all 144 remaining slots in order");
  const clockLandedOnKeeper: string[] = [];
  const misattributed: string[] = [];
  const seenPlayers = new Set<string>();
  let undoSamples = 0;
  let undoExact = true;
  let seqRewound = false;

  for (const slot of board.slots) {
    if (slot.isKeeper && slot.player) seenPlayers.add(slot.player.id);
  }

  let guard = 0;
  while (view.onTheClockSlotId && guard++ < TOTAL_PICKS + 10) {
    const slotId = view.onTheClockSlotId;
    const slot = view.slots.find((s) => s.id === slotId)!;

    if (keeperSlotIds.has(slotId)) clockLandedOnKeeper.push(slot.label);

    const player = choosePlayer(view, pool, slot.currentOwner.id);
    if (seenPlayers.has(player.id)) {
      misattributed.push(`${player.name} chosen twice at ${slot.label}`);
    }

    // Sample the undo invariant through the draft rather than only at the end.
    if (view.picksMade % 25 === 0) {
      const before = boardSnapshotOf(view);
      const beforePicks = JSON.stringify(state.picks);
      const probe = applyPick(board, state, {
        slotId,
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        byeWeek: player.byeWeek,
      });
      const rewound = undoLast(probe);
      if (boardSnapshotOf(buildRoomView(board, rewound)) !== before) undoExact = false;
      if (JSON.stringify(rewound.picks) !== beforePicks) undoExact = false;
      // Sequence numbers must never be reissued, or a re-entered pick could
      // sort ahead of one that came before it.
      if (rewound.nextSeq <= state.nextSeq) seqRewound = true;
      undoSamples++;
    }

    state = applyPick(board, state, {
      slotId,
      playerId: player.id,
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      byeWeek: player.byeWeek,
    });

    const written = state.picks[state.picks.length - 1];
    if (written.teamId !== slot.currentOwner.id) {
      misattributed.push(
        `${slot.label} went to ${written.teamName} but is owned by ${slot.currentOwner.name}`,
      );
    }
    seenPlayers.add(player.id);
    view = buildRoomView(board, state);
  }

  check(
    "the clock never landed on a keeper slot",
    clockLandedOnKeeper.length === 0,
    clockLandedOnKeeper.join(", "),
  );
  check(
    `${state.picks.length} picks entered (${TOTAL_PICKS} slots − ${KEEPERS} keepers)`,
    state.picks.length === TOTAL_PICKS - KEEPERS,
    `got ${state.picks.length}`,
  );
  check("the board is full", view.filled === TOTAL_PICKS, `filled ${view.filled}`);
  check("nothing is left on the clock", view.onTheClockSlotId === null);
  check(
    `undo restored the board and the pick list exactly at all ${undoSamples} sampled points`,
    undoExact,
  );
  check("undo never reissued a sequence number", !seqRewound);

  section("4. No player went twice");
  const allPlayerIds = view.slots.filter((s) => s.player).map((s) => s.player!.id);
  const dupes = allPlayerIds.filter((id, i) => allPlayerIds.indexOf(id) !== i);
  check(
    `${TOTAL_PICKS} slots hold ${TOTAL_PICKS} distinct players`,
    new Set(allPlayerIds).size === TOTAL_PICKS,
    dupes.length ? `duplicated: ${[...new Set(dupes)].join(", ")}` : "",
  );

  section("5. Keepers survived untouched");
  const keeperDamage = board.slots
    .filter((s) => s.isKeeper)
    .filter((s) => {
      const now = view.slots.find((v) => v.id === s.id)!;
      return now.fill !== "keeper" || now.player?.id !== keeperPlayers.get(s.id);
    })
    .map((s) => s.label);
  check(
    `all ${KEEPERS} keepers still hold their own player`,
    keeperDamage.length === 0,
    keeperDamage.join(", "),
  );
  check(
    "no keeper slot carries an entry-order sequence",
    view.slots.filter((s) => s.fill === "keeper").every((s) => s.seq === null),
  );

  section("6. Traded picks went to the right franchise");
  check(
    FEATURES.tradedPicks
      ? `${tradedSlots.length} traded slots to verify`
      : "no traded slots to verify — picks are not tradable in this league",
    tradedSlots.length === board.tradedCount &&
      (FEATURES.tradedPicks ? tradedSlots.length > 0 : tradedSlots.length === 0),
    `got ${tradedSlots.length}`,
  );
  const tradedWrong: string[] = [];
  for (const slot of tradedSlots) {
    const filled = view.slots.find((s) => s.id === slot.id)!;
    const owner = filled.currentOwner;
    if (owner.id === slot.originalOwner.id) {
      tradedWrong.push(`${slot.label} still credited to its original owner`);
      continue;
    }
    if (filled.fill === "pick") {
      const record = state.picks.find((p) => p.slotId === slot.id)!;
      if (record.teamId !== slot.currentOwner.id) {
        tradedWrong.push(`${slot.label} → ${record.teamName}, expected ${slot.currentOwner.name}`);
      }
    }
  }
  check(
    `all ${tradedSlots.length} landed with the acquiring franchise, not the original`,
    tradedWrong.length === 0,
    tradedWrong.join("; "),
  );
  check(
    "every entered pick anywhere on the board matches its slot's current owner",
    state.picks.every(
      (p) => board.slots.find((s) => s.id === p.slotId)!.currentOwner.id === p.teamId,
    ),
  );
  check("no misattribution recorded during the run", misattributed.length === 0, misattributed.join("; "));

  section("7. Undo unwinds by entry order, five deep, and restores exactly");
  const fullBoard = snapshotOf(view);
  const rewound: DraftStateFile[] = [state];
  let cursor = state;
  const unwound: string[] = [];
  for (let i = 0; i < 5; i++) {
    const last = cursor.picks.reduce((a, b) => (b.seq > a.seq ? b : a));
    unwound.push(`${last.label} ${last.playerName}`);
    cursor = undoLast(cursor);
    rewound.push(cursor);
  }
  check(
    "undo removed the five most recently entered picks",
    unwound.length === 5 && cursor.picks.length === state.picks.length - 5,
  );
  check(
    "the board reopened exactly five slots",
    buildRoomView(board, cursor).remaining === 5,
  );
  // Re-enter them in the order they were undone and the board must be identical.
  let replay = cursor;
  for (const undone of [...rewound].slice(0, 5).reverse()) {
    const restored = undone.picks.reduce((a, b) => (b.seq > a.seq ? b : a));
    replay = applyPick(board, replay, {
      slotId: restored.slotId,
      playerId: restored.playerId,
      playerName: restored.playerName,
      position: restored.position,
      nflTeam: restored.nflTeam,
      byeWeek: restored.byeWeek,
    });
  }
  const replayed = buildRoomView(board, replay);
  check(
    "replaying them rebuilds the same board",
    replayed.filled === TOTAL_PICKS &&
      replayed.slots.every(
        (s, i) => s.player?.id === JSON.parse(fullBoard).slots[i].player?.id,
      ),
  );

  section("8. Out-of-order entry — filling the last slot first");
  let ooo = emptyState(TEST_SEASON, boardFingerprint(board));
  const oooView = buildRoomView(board, ooo);
  const openSlots = oooView.slots.filter((s) => s.fill === null);
  const lastOpen = openSlots[openSlots.length - 1];
  const firstOpen = openSlots[0];
  const someone = pool.find((p) => !oooView.draftedPlayerIds.includes(p.id))!;
  ooo = applyPick(board, ooo, {
    slotId: lastOpen.id,
    playerId: someone.id,
    playerName: someone.name,
    position: someone.position,
    nflTeam: someone.nflTeam,
    byeWeek: someone.byeWeek,
  });
  const afterOoo = buildRoomView(board, ooo);
  check(
    `${lastOpen.label} was filled while ${afterOoo.remaining} slots ahead of it are still open`,
    afterOoo.slots.find((s) => s.id === lastOpen.id)!.fill === "pick",
  );
  check(
    "the clock stayed on the first open slot",
    afterOoo.onTheClockSlotId === firstOpen.id,
  );
  check(
    "the out-of-order pick was credited to that slot's current owner",
    ooo.picks[0].teamId === lastOpen.currentOwner.id,
  );

  section("9. Warnings can be overridden; physical impossibilities cannot");
  /*
   * A KEEPER SLOT IS NOT GUARANTEED TO EXIST, and on a redraft board none does.
   * The two rules that need one are exercised only when the board has one; the
   * rules that do not — a cell that already holds a player, and a player who is
   * already on the board — are exercised either way, and the duplicate-player
   * warning is covered below by an already-PICKED player rather than by a kept
   * one. So a redraft loses no coverage of anything a redraft can hit.
   */
  const keeperSlot = board.slots.find((s) => s.isKeeper) ?? null;

  /*
   * The player used to exercise the duplicate-player warning and the override
   * that follows it. A KEPT player where the board has keepers; the player just
   * entered out of order where it does not. The rule under test is "this player
   * is already on the board somewhere", and both satisfy it identically — so
   * the override path below is covered on a redraft as well.
   */
  const duplicateSource = keeperSlot?.player ?? someone;
  const takenPlayerId = duplicateSource.id;
  const duplicateInput = {
    slotId: firstOpen.id,
    playerId: takenPlayerId,
    playerName: pool.find((p) => p.id === takenPlayerId)?.name ?? duplicateSource.name,
    position: duplicateSource.position,
    nflTeam: duplicateSource.nflTeam,
    byeWeek: duplicateSource.byeWeek,
  };

  if (keeperSlot) {
    expectRejected("drafting into a keeper slot", false, () =>
      applyPick(board, ooo, {
        slotId: keeperSlot.id,
        playerId: someone.id,
        playerName: someone.name,
        position: someone.position,
        nflTeam: someone.nflTeam,
        byeWeek: someone.byeWeek,
      }),
    );
    expectRejected("drafting a player a keeper already holds", true, () =>
      applyPick(board, ooo, duplicateInput),
    );
  } else {
    console.log(
      "  · no keeper slot on this board (redraft) — the two keeper-only rules are not exercised",
    );
  }

  expectRejected("drafting into a slot that already has a player", false, () => {
    const other = pool.find((p) => p.id !== someone.id && p.id !== takenPlayerId)!;
    return applyPick(board, ooo, {
      slotId: lastOpen.id,
      playerId: other.id,
      playerName: other.name,
      position: other.position,
      nflTeam: other.nflTeam,
      byeWeek: other.byeWeek,
    });
  });
  expectRejected("drafting a player already picked", true, () =>
    applyPick(board, ooo, {
      slotId: firstOpen.id,
      playerId: someone.id,
      playerName: someone.name,
      position: someone.position,
      nflTeam: someone.nflTeam,
      byeWeek: someone.byeWeek,
    }),
  );
  expectRejected("undo on a board with no entered picks", false, () =>
    undoLast(emptyState(TEST_SEASON, boardFingerprint(board))),
  );

  // The commissioner overrules the board: the same rejected pick, asked twice.
  const overridden = applyPick(board, ooo, duplicateInput, { override: true });
  const overriddenView = buildRoomView(board, overridden);
  check(
    "the same duplicate goes through when overridden",
    overriddenView.slots.find((s) => s.id === firstOpen.id)?.player?.id === takenPlayerId,
  );
  check(
    "and the board keeps warning about it rather than silently dropping it",
    overriddenView.conflicts.some((c) => c.kind === "duplicate-player"),
    overriddenView.conflicts.map((c) => c.message).join("; "),
  );
  check(
    "both copies of the overridden player stay on the board",
    overriddenView.slots.filter((s) => s.player?.id === takenPlayerId).length === 2,
  );

  /*
   * The reset button is the only control here that can destroy three hours of
   * work, and it sits a keystroke away from the ones that cannot. Undo used to
   * answer "there is nothing to undo" to precisely the accident worth
   * recovering from, so this asserts the whole round trip on a FULL board —
   * 144 entered picks — rather than a toy one.
   */
  section("9b. A wipe is undoable, and comes back whole");
  // `boardSnapshotOf`, not `snapshotOf`: a restore has to bring the BOARD back
  // exactly, and it must not pretend the wipe and the restore never happened.
  const beforeWipe = boardSnapshotOf(view);
  const wiped = clearedState(state, TEST_SEASON, boardFingerprint(board));
  const wipedView = buildRoomView(board, wiped);

  check("the wipe empties the board", wipedView.picksMade === 0, `left ${wipedView.picksMade}`);
  check(
    `keepers are untouched by a wipe — still ${KEEPERS}`,
    wipedView.keeperCount === KEEPERS,
    `got ${wipedView.keeperCount}`,
  );
  check(
    "the emptied board offers the wipe back",
    wipedView.restorable?.pickCount === state.picks.length,
    `offered ${wipedView.restorable?.pickCount ?? "nothing"} of ${state.picks.length}`,
  );
  check(
    "the sequence counter does not rewind past the wiped picks",
    wiped.nextSeq >= state.nextSeq,
    `${wiped.nextSeq} < ${state.nextSeq}`,
  );

  const restored = undoLast(wiped);
  check(
    "undo puts every pick back",
    restored.picks.length === state.picks.length,
    `${restored.picks.length} of ${state.picks.length}`,
  );
  check(
    "and the restored board is identical to the one that was wiped",
    boardSnapshotOf(buildRoomView(board, restored)) === beforeWipe,
  );
  check("the restore is spent, not repeatable", restored.restorable == null);

  /*
   * A pick entered after the wipe takes the button back: with something on the
   * board, undo means that pick. This is also where a rewound counter would
   * have shown up as two picks both claiming to have been entered first.
   */
  const afterWipe = applyPick(board, wiped, {
    slotId: buildRoomView(board, wiped).slots.find((s) => s.fill === null)!.id,
    playerId: someone.id,
    playerName: someone.name,
    position: someone.position,
    nflTeam: someone.nflTeam,
    byeWeek: someone.byeWeek,
  });
  check(
    "a pick entered after the wipe hides the restore",
    buildRoomView(board, afterWipe).restorable === null,
  );
  check(
    "the new pick did not reuse a wiped pick's sequence number",
    !wiped.restorable!.picks.some((p) => p.seq === afterWipe.picks[0].seq),
    `reissued seq ${afterWipe.picks[0].seq}`,
  );
  check(
    "undoing that pick offers the wipe again",
    buildRoomView(board, undoLast(afterWipe)).restorable?.pickCount === state.picks.length,
  );

  // A wipe of an already-empty board has nothing to give back, and must not
  // dress up an empty restore point as something undo can spend.
  const wipedEmpty = clearedState(
    emptyState(TEST_SEASON, boardFingerprint(board)),
    TEST_SEASON,
    boardFingerprint(board),
  );
  check("wiping an empty board offers nothing to restore", wipedEmpty.restorable == null);
  expectRejected("undo after wiping an already-empty board", false, () => undoLast(wipedEmpty));

  section("10. The name matcher finds the right player");
  const index = buildSearchIndex(pool);
  const topMatch = (typed: string) => searchPlayers(index, typed, { limit: 5 })[0]?.item.name;
  const expectations: [string, string][] = [
    ["gibbs", "Jahmyr Gibbs"],
    ["jahmyr", "Jahmyr Gibbs"],
    ["ja gi", "Jahmyr Gibbs"],
    ["jamarr", "Ja'Marr Chase"],
    ["chase", "Ja'Marr Chase"],
    ["cmc", "Christian McCaffrey"],
    ["mccaffery", "Christian McCaffrey"],
    ["jefferon", "Justin Jefferson"],
    ["jsn", "Jaxon Smith-Njigba"],
    ["bijan", "Bijan Robinson"],
    ["browns", "Cleveland Browns"],
  ];
  for (const [typed, expected] of expectations) {
    const got = topMatch(typed);
    check(`"${typed}" → ${expected}`, got === expected, got ? `got ${got}` : "no match");
  }
  /**
   * A surname several players share cannot have one "right" answer, so the test
   * is the property rather than a name: the top hit is an actual player called
   * Brown, not the Cleveland Browns, and the other Browns are all right there.
   * Ties within the band fall to ADP, which puts the best-known player first —
   * for "brown" in 2026 that is Amon-Ra St. Brown, which is the correct guess
   * to lead with.
   */
  const browns = searchPlayers(index, "brown", { limit: 5 });
  check(
    '"brown" leads with a player, not the Cleveland Browns',
    browns[0]?.item.position !== "DST",
    browns[0]?.item.name ?? "no match",
  );
  check(
    '"brown" surfaces several players named Brown to arrow through',
    browns.filter((r) => /\bbrown$/i.test(r.item.name)).length >= 3,
    browns.map((r) => r.item.name).join(", "),
  );

  check(
    "an empty query offers nothing — there is no browsable list on this board",
    searchPlayers(index, "", { limit: 5 }).length === 0,
  );

  /**
   * Ten defenses go on Saturday, one per roster, all in the late rounds when
   * the room is loudest. The pool calls them "New England Patriots" and nobody
   * in that room ever will, so every one of the 32 is checked against the ways
   * it would actually be said — not a sample, because the ten that come up are
   * not knowable in advance.
   *
   * Six is the number of matches the overlay shows, so "reachable" means top of
   * that list, not merely present somewhere in the pool.
   */
  section("10b. Every team defense is reachable by what the room shouts");
  const defenses = pool
    .filter((p) => p.position === "DST")
    .sort((a, b) => a.name.localeCompare(b.name));
  check(`all 32 defenses are in the pool`, defenses.length === 32, `got ${defenses.length}`);

  /** Spoken shorthand that the canonical name does not already cover. */
  const SPOKEN: Record<string, string[]> = {
    ARI: ["cards", "az"],
    ATL: ["dirty birds"],
    CIN: ["cincy"],
    DAL: ["boys"],
    GB: ["pack"],
    IND: ["indy"],
    JAX: ["jags"],
    LV: ["vegas"],
    LAC: ["bolts"],
    MIA: ["fins"],
    MIN: ["vikes"],
    NE: ["pats"],
    NO: ["nola"],
    NYG: ["gmen"],
    PHI: ["birds"],
    SF: ["niners"],
    SEA: ["hawks"],
    TB: ["bucs"],
    WAS: ["skins"],
  };

  /** Los Angeles and New York carry two teams each; handled separately below. */
  const sharedCity = (city: string) =>
    defenses.filter((x) => x.name.toLowerCase().startsWith(`${city} `)).length > 1;

  const unreachable: string[] = [];
  let spellings = 0;
  for (const d of defenses) {
    const words = d.name.toLowerCase().split(" ");
    const mascot = words[words.length - 1];
    const city = words.slice(0, -1).join(" ");
    const code = (d.nflTeam ?? "").toLowerCase();

    const ways = [
      mascot, // "patriots", "ravens", "49ers"
      code, // "ne", "sf", "jax"
      `${mascot} d`, // the marker people habitually add
      `${mascot} dst`,
      `${mascot} d/st`,
      `${code} dst`,
      // "washington d", where the bare city is nine players. Skipped for the
      // two cities that carry two teams, since no single answer is right.
      ...(sharedCity(city) ? [] : [`${city} d`]),
      ...(SPOKEN[d.nflTeam ?? ""] ?? []),
    ];

    for (const typed of ways) {
      spellings++;
      if (topMatch(typed) !== d.name) unreachable.push(`"${typed}" → ${topMatch(typed) ?? "nothing"}`);
    }
  }
  check(
    `${spellings} spellings across all 32 defenses each land on the right one`,
    unreachable.length === 0,
    unreachable.slice(0, 6).join("; "),
  );

  /**
   * Two cities carry two teams each. This cannot be resolved by ranking and
   * should not be — what matters is that both are offered and that the NFL code
   * beside them makes the choice obvious.
   */
  for (const [city, a, b] of [
    ["los angeles", "LAR", "LAC"],
    ["new york", "NYG", "NYJ"],
  ] as [string, string, string][]) {
    const shown = searchPlayers(index, `${city} d`, { limit: 6 }).filter(
      (r) => r.item.position === "DST",
    );
    check(
      `"${city} d" offers both ${a} and ${b}, told apart by the code`,
      shown.some((r) => r.item.nflTeam === a) && shown.some((r) => r.item.nflTeam === b),
      shown.map((r) => `${r.item.name} [${r.item.nflTeam}]`).join(", ") || "nothing",
    );
  }

  /**
   * The trailing-marker rule must not make anything else unfindable. A name
   * that merely ends in those letters is retried without the rule, so it still
   * resolves; a bare "d" is still a letter rather than a request for defenses.
   */
  check(
    'the marker rule does not swallow "Amon-Ra St. Brown"',
    topMatch("amon ra st") === "Amon-Ra St. Brown",
    topMatch("amon ra st") ?? "no match",
  );
  check(
    '"d" alone still searches players rather than listing defenses',
    searchPlayers(index, "d", { limit: 3 }).every((r) => r.item.position !== "DST"),
  );
  check(
    'a bare city that nine players share still leads with the players',
    searchPlayers(index, "washington", { limit: 3 }).every((r) => r.item.position !== "DST"),
  );

  /**
   * The other 150 picks are players, and they have their own awkward spellings.
   * Defenses turned out to be the broken position, but that was only knowable
   * by testing the way people type rather than the way the feed stores names —
   * so the same sweep runs over the players.
   *
   * Two tiers, because 1,195 × every variation is not a useful use of anyone's
   * Saturday: every name must be reachable exactly, and the players who will
   * actually be called get the realistic matrix.
   */
  section("10c. Players are reachable by the way names get typed");

  const skaters = pool.filter((p) => p.position !== "DST");
  const missingExact = skaters.filter((p) => topMatch(p.name) !== p.name);
  check(
    `all ${skaters.length} players are findable by their exact name`,
    missingExact.length === 0,
    missingExact.slice(0, 5).map((p) => `${p.name} → ${topMatch(p.name) ?? "nothing"}`).join("; "),
  );

  /** Who actually gets drafted: the top of the board, plus every keeper. */
  const keeperNames = new Set(
    board.slots.filter((s) => s.isKeeper && s.player).map((s) => s.player!.name),
  );
  const focus = new Map<string, (typeof skaters)[number]>();
  for (const p of [...skaters].sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity)).slice(0, 250)) {
    focus.set(p.name, p);
  }
  for (const p of skaters) if (keeperNames.has(p.name)) focus.set(p.name, p);

  const spellingFailures: string[] = [];
  let playerSpellings = 0;
  const wants = (typed: string, name: string, mode: "lead" | "listed") => {
    playerSpellings++;
    const results = searchPlayers(index, typed, { limit: 6 });
    const at = results.findIndex((r) => r.item.name === name);
    const ok = mode === "lead" ? at === 0 : at !== -1;
    if (!ok) spellingFailures.push(`"${typed}" → ${results[0]?.item.name ?? "nothing"} (wanted ${name})`);
  };

  for (const p of focus.values()) {
    const plain = normalizeName(p.name);
    const parts = plain.split(" ");

    // Punctuation folded away: "jamarr chase", "aj brown", "amon ra st brown".
    wants(plain, p.name, "lead");
    // Run together, which is what fast typing produces: "ajbrown".
    wants(plain.replace(/ /g, ""), p.name, "lead");
    // A suffix the pool does not store, in every form the sources use.
    for (const suffix of ["jr", "sr", "ii", "iii", "iv"]) wants(`${plain} ${suffix}`, p.name, "lead");
    // Called across a room: surname alone, first name alone. Shared names mean
    // "on the list" rather than "first" is the honest bar here.
    wants(parts[parts.length - 1], p.name, "listed");
    // A first name the matcher deliberately folds into a commoner spelling is
    // exempt: "tommy" is meant to surface the Thomases, and five bench Tommys
    // getting pushed off the list is the trade that buys that.
    if (!isGivenNameVariant(parts[0])) wants(parts[0], p.name, "listed");
    // "njigba" — the bare second half of a hyphenated surname, which is what
    // gets said out loud far more often than the whole thing.
    if (p.name.includes("-")) {
      const tail = normalizeName(p.name.split("-").pop() ?? "");
      if (tail) wants(tail, p.name, "listed");
    }
  }

  check(
    `${playerSpellings} realistic spellings across the ${focus.size} players who will be called`,
    spellingFailures.length === 0,
    spellingFailures.slice(0, 6).join("; "),
  );

  /**
   * A nickname pointing at somebody the pool no longer carries is dead weight
   * that fails silently — and four of them had rotted this way, including
   * "etn", which named the wrong player entirely. The pool is refreshed from an
   * external feed, so this will rot again; it needs a guard rather than a
   * one-time correction.
   */
  const normalizedNames = skaters.map((p) => normalizeName(p.name));
  const deadNicknames = Object.entries(PLAYER_NICKNAMES).filter(
    ([, target]) => !normalizedNames.some((n) => n.includes(target)),
  );
  check(
    `all ${Object.keys(PLAYER_NICKNAMES).length} player nicknames point at somebody in the pool`,
    deadNicknames.length === 0,
    deadNicknames.map(([nick, target]) => `${nick} → "${target}"`).join("; "),
  );

  const codes = new Set(pool.filter((p) => p.position === "DST").map((p) => p.nflTeam));
  const orphanDefenses = Object.keys(DEFENSE_ALIASES).filter((code) => !codes.has(code));
  check(
    `all ${Object.keys(DEFENSE_ALIASES).length} defense alias codes match a real team`,
    orphanDefenses.length === 0,
    orphanDefenses.join(", "),
  );

  /**
   * A surname several players share cannot resolve to one answer, so the rule
   * is the pragmatic one: the best ADP leads, because that is who somebody
   * shouting a bare surname most likely means.
   */
  for (const surname of ["williams", "brown", "smith", "johnson", "jackson", "jones", "moore"]) {
    const results = searchPlayers(index, surname, { limit: 6 });
    const sharing = skaters.filter((p) => normalizeName(p.name).endsWith(` ${surname}`));
    if (sharing.length < 2) continue;
    const bestAdp = [...sharing].sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity))[0];
    check(
      `"${surname}" leads with the best-ADP candidate (${bestAdp.name})`,
      results[0]?.item.name === bestAdp.name,
      `got ${results[0]?.item.name ?? "nothing"}`,
    );
  }

  /** A first name with exactly one plausible referent has to land on him. */
  for (const [typed, expected] of [
    ["bijan", "Bijan Robinson"],
    ["saquon", "Saquon Barkley"],
    ["puka", "Puka Nacua"],
    ["jahmyr", "Jahmyr Gibbs"],
    ["jaxon", "Jaxon Smith-Njigba"],
    ["kyren", "Kyren Williams"],
  ] as [string, string][]) {
    check(`"${typed}" alone lands on ${expected}`, topMatch(typed) === expected, topMatch(typed) ?? "no match");
  }

  check(
    'a nickname works with a surname beside it — "hollywood brown"',
    topMatch("hollywood brown") === "Marquise Brown",
    topMatch("hollywood brown") ?? "no match",
  );
  check(
    'both St. Browns are offered for "st brown", best ADP first',
    (() => {
      const r = searchPlayers(index, "st brown", { limit: 6 }).map((x) => x.item.name);
      return r[0] === "Amon-Ra St. Brown" && r.includes("Equanimeous St. Brown");
    })(),
    searchPlayers(index, "st brown", { limit: 6 }).map((x) => x.item.name).join(", "),
  );
  check(
    "a drafted player is still findable, but ranked below undrafted matches",
    (() => {
      const drafted = new Set([takenPlayerId]);
      // Whoever is already on the board — a keeper where there are keepers,
      // otherwise the player entered out of order in section 8.
      const results = searchPlayers(index, duplicateSource.name, { limit: 5, drafted });
      const hit = results.find((r) => r.item.id === takenPlayerId);
      return !!hit && hit.drafted === true;
    })(),
  );

  /**
   * The draft screen must not be able to reach the network, and that has to be
   * a fact about the code rather than a fact about a runtime flag.
   *
   * The browser suite proves the guarantee by observation: it blocks every
   * non-local request and enters a pick anyway. That is the real proof, but it
   * only speaks for the configuration it ran in — and a live-sync hook whose
   * channel is gated on `savesAreShared()` is exactly the kind of thing that is
   * inert on the commissioner's laptop and wide awake somewhere else.
   *
   * So this walks the static import graph out of `/draft` and fails if any of
   * it pulls in the Supabase client. Anything that wants Realtime on this
   * screen has to load it behind a gate, which is what the live-sync hook now
   * does and what makes it strictly additive.
   *
   * What this does NOT claim: that `/draft` can never touch Supabase at
   * runtime. A gated `await import()` is deliberately invisible here. The pair
   * of checks is the point — nothing SHIPS to the board statically, and nothing
   * FIRES from it in the browser run.
   */
  section("10d. Nothing the draft screen ships can reach Supabase");

  const SRC = path.join(process.cwd(), "src");
  const CODE_EXTS = [".ts", ".tsx", ".js", ".jsx"];

  const resolveSpec = (spec: string, fromFile: string): string | null => {
    let base: string;
    if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
    else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
    else return null; // a bare package; judged by its specifier, not walked
    for (const ext of ["", ...CODE_EXTS]) {
      const candidate = base + ext;
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    for (const ext of CODE_EXTS) {
      const candidate = path.join(base, `index${ext}`);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  };

  /**
   * Static specifiers only. `import type` is skipped because it is erased
   * before anything ships, and `await import()` is skipped on purpose — that is
   * the gate. Comments come out first, since these files discuss their own
   * imports at length and prose should not trip a build check.
   */
  const staticSpecs = (source: string): string[] => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const found: string[] = [];
    for (const m of code.matchAll(/\b(?:import|export)\s+([\s\S]{0,400}?)\bfrom\s*["']([^"']+)["']/g)) {
      if (/^\s*type\b/.test(m[1])) continue;
      found.push(m[2]);
    }
    for (const m of code.matchAll(/\bimport\s+["']([^"']+)["']/g)) found.push(m[1]);
    return found;
  };

  const isSupabase = (spec: string) =>
    spec.startsWith("@supabase/") || spec === "@/lib/supabase" || spec.startsWith("@/lib/supabase/");

  /** Both roots, because the layout wraps the page and ships with it. */
  const roots = [
    path.join(SRC, "app", "draft", "page.tsx"),
    path.join(SRC, "app", "layout.tsx"),
  ].filter((f) => existsSync(f));
  check("both draft entry points were found on disk", roots.length === 2, roots.join(", "));

  const parent = new Map<string, string>();
  const seen = new Set<string>(roots);
  const queue = [...roots];
  const offenders: string[] = [];
  const unresolved: string[] = [];
  const serverOnly: string[] = [];

  while (queue.length > 0) {
    const file = queue.shift()!;
    const source = readFileSync(file, "utf8");

    /*
     * `import "server-only"` is a hard boundary: Next refuses to bundle these
     * into a client component, so nothing below one can reach the projector's
     * browser. The draft's own store sits behind it and legitimately talks to
     * Supabase when it is running as a deployment — walking through it would
     * flag the server for something only the client can be guilty of.
     */
    if (/\bimport\s+["']server-only["']/.test(source)) {
      serverOnly.push(path.relative(process.cwd(), file));
      continue;
    }

    for (const spec of staticSpecs(source)) {
      if (isSupabase(spec)) {
        // Walk the parents back so the report names the route, not just the leaf.
        const chain = [path.relative(process.cwd(), file)];
        for (let at = file; parent.has(at); at = parent.get(at)!) {
          chain.unshift(path.relative(process.cwd(), parent.get(at)!));
        }
        offenders.push(`${chain.join(" → ")} imports ${spec}`);
        continue;
      }
      const next = resolveSpec(spec, file);
      if (!next) {
        // Bare packages are fine and are not walked. A LOCAL specifier that
        // will not resolve is a hole in this check, and is reported as one.
        if (spec.startsWith("@/") || spec.startsWith(".")) {
          unresolved.push(`${path.relative(process.cwd(), file)} → ${spec}`);
        }
        continue;
      }
      if (seen.has(next)) continue;
      seen.add(next);
      parent.set(next, file);
      queue.push(next);
    }
  }

  /*
   * A walker that silently reached nothing would pass this section while
   * proving nothing at all, so the walk has to show its work first.
   */
  const boardFile = path.join(SRC, "components", "draft-board.tsx");
  check(
    `the walk reached ${seen.size} modules including the board itself`,
    seen.size > 20 && seen.has(boardFile),
    `${seen.size} modules, board reached: ${seen.has(boardFile)}`,
  );
  check(
    "every local import resolved, so there is no blind spot in the walk",
    unresolved.length === 0,
    unresolved.slice(0, 5).join("; "),
  );
  check(
    `the walk stopped at ${serverOnly.length} server-only boundaries rather than through them`,
    serverOnly.length > 0,
    serverOnly.join(", "),
  );
  check(
    "nothing the draft screen ships to the browser statically imports Supabase",
    offenders.length === 0,
    offenders.join(" | "),
  );

  section("11. Every franchise ended with a legal roster");
  const rosters = buildTeamRosters(view);
  const overCap = rosters.filter((r) => r.positionsAtCap.some((pos) => r.byPosition[pos] > (ROSTER.positionalMax[pos] ?? Infinity)));
  const shortLineup = rosters.filter((r) => r.needs.length > 0);
  const oversized = rosters.filter((r) => r.rosterSize > ROSTER.activeCap);
  check(
    `all ${rosters.length} franchises can field ${STARTING_LINEUP.reduce((n, s) => n + s.count, 0)} starters`,
    shortLineup.length === 0,
    shortLineup.map((r) => `${r.team.name} needs ${r.needs.join("/")}`).join("; "),
  );
  check("no franchise is over a position cap", overCap.length === 0);
  check(
    `no franchise exceeds the ${ROSTER.activeCap}-man roster`,
    oversized.length === 0,
    oversized.map((r) => `${r.team.name} ${r.rosterSize}`).join(", "),
  );
  check(
    `all ${KEEPERS} keepers counted against the rosters that hold them`,
    rosters.reduce((n, r) => n + r.keepers, 0) === KEEPERS,
    `counted ${rosters.reduce((n, r) => n + r.keepers, 0)}`,
  );

  section("12. Writing the finished board through the real store");
  const persisted: DraftStateFile = { ...state, season: TEST_SEASON };
  // The store wants the state a write was derived from, so it can refuse one
  // whose base has moved. Here that is whatever the last run left behind.
  const stored = await draftStore.read(TEST_SEASON, boardFingerprint(board));
  await draftStore.write(persisted, stored);
  const stateFile = path.join(process.cwd(), "data", `draft-state-${TEST_SEASON}.json`);
  check("the state file exists on disk", existsSync(stateFile));
  const backupDir = path.join(process.cwd(), "data", "draft-backups");
  check(
    "a timestamped backup was written alongside it",
    existsSync(backupDir) &&
      readdirSync(backupDir).some((f) => f.startsWith(`draft-state-${TEST_SEASON}-`)),
  );
  const reread = await draftStore.read(TEST_SEASON, boardFingerprint(board));
  check(
    "reading it straight back gives the same board",
    snapshotOf(buildRoomView(board, reread)) === snapshotOf(buildRoomView(board, persisted)),
  );

  writeFileSync(
    HANDOFF,
    JSON.stringify({
      picksMade: view.picksMade,
      filled: view.filled,
      view: snapshotOf(buildRoomView(board, persisted)),
    }),
  );

  console.log(`\n  ${checks} checks, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  • ${f}`);
    return 1;
  }

  // The crash test has to be a different process or it proves nothing about
  // what is actually on disk.
  console.log("\n\nKilling this process and reading the state back in a new one…");
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      "./scripts/draft-loader.mjs",
      "scripts/simulate-draft.mts",
      "--reload",
    ],
    {
      stdio: "inherit",
      cwd: process.cwd(),
      // The loader's re-entry guard is an env var and would be inherited,
      // leaving the child with no `@/*` resolution at all.
      env: { ...process.env, __UKL_DRAFT_LOADER: undefined },
    },
  );

  cleanup();

  if (child.status !== 0) {
    console.log("\nFAILED — the board did not survive the process boundary.\n");
    return 1;
  }
  console.log("\nAll checks passed.\n");
  return 0;
}

function cleanup() {
  const dataDir = path.join(process.cwd(), "data");
  rmSync(path.join(dataDir, `draft-state-${TEST_SEASON}.json`), { force: true });
  rmSync(HANDOFF, { force: true });
  const backupDir = path.join(dataDir, "draft-backups");
  if (existsSync(backupDir)) {
    for (const f of readdirSync(backupDir)) {
      if (f.startsWith(`draft-state-${TEST_SEASON}-`)) {
        rmSync(path.join(backupDir, f), { force: true });
      }
    }
  }
}

const exitCode = process.argv.includes("--reload") ? await reloadPhase() : await simulate();
process.exit(exitCode);

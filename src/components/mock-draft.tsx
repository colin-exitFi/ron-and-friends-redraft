"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  ChevronDown,
  FastForward,
  LayoutGrid,
  Lock,
  Pause,
  ScrollText,
  Play,
  RotateCcw,
  SkipForward,
  Timer,
  User,
  X,
} from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { LEAGUE } from "@/lib/league-config";
import { DraftRuleError, buildRoomView } from "@/lib/draft-engine";
import { buildFranchiseLineups } from "@/lib/roster-lineup";
import type { LineupProjectionPoints } from "@/lib/roster-lineup";
import {
  BOT_ARCHETYPES,
  DEFAULT_PACE_KEY,
  MOCK_PACES,
  archetypeByKey,
  paceByKey,
} from "@/lib/mock-draft-bots";
import type { MockChoice } from "@/lib/mock-draft-ai";
import {
  botPickOnce,
  defaultAssignment,
  freshMockState,
  fromMockFile,
  humanPickOnce,
  toMockFile,
  undoMockPick,
  type ArchetypeAssignment,
} from "@/lib/mock-draft-run";
import {
  OnTheClockRoster,
  OnTheClockRosterSheet,
} from "@/components/on-the-clock-roster";
import { RosterWall } from "@/components/roster-wall";
import {
  MockDraftSetup,
  type MockSettings,
} from "@/components/mock-draft-setup";
import { BoardReadout, TvSafeAreaOverlay } from "@/components/tv-safe-area-overlay";
import {
  BoardGrid,
  DuplicateWarning,
  FLASH_MS,
  FlashOverlay,
  FlashStyles,
  FollowPill,
  Kbd,
  TAP,
  TouchPickBar,
  MatchOverlay,
  Strip,
  ViewToggle,
  useDraftTyping,
  type Flash,
} from "@/components/draft-surface";
import { resetBoardDensity, useBoardDensityValue } from "@/lib/use-board-density";
import { useBoardFit } from "@/lib/use-board-fit";
import { useBoardFollow } from "@/lib/use-board-follow";
import { useBoardReadout } from "@/lib/use-board-readout";
import { useSafeAreaKeys } from "@/lib/use-safe-area";
import { useTvMode } from "@/lib/use-tv-mode";
import type { BoardView } from "@/lib/board-types";
import type { DraftStateFile } from "@/lib/draft-types";
import type {
  MockDraftFile,
  MockPickSource,
  MockPlayer,
} from "@/lib/mock-draft-types";

/**
 * Mock draft — rehearsal against the real board.
 *
 * The commissioner picks one franchise; seven heuristic bot personalities draft
 * the other nine. It runs against the ACTUAL board: the real draft order, all
 * 29 traded picks, and every keeper pre-placed at its cost round, because
 * mocking against a fake board tells him nothing.
 *
 * It reuses the live board's grid, its typing flow, its pick announcement and
 * its duplicate moment from `@/components/draft-surface`, so entering a pick
 * here is the same set of keystrokes as entering one on Saturday. That is the
 * point: the mock doubles as practice for the operator, not just for the room.
 *
 * ============================================================================
 * NOTHING RUNS UNTIL START IS PRESSED
 * ============================================================================
 *
 * Opening this route used to begin a draft. `MockRun` mounted immediately with
 * the bots already going and no franchise claimed, so the first bot pick landed
 * 420ms after the page did and there was no moment in which to say who you were
 * or what the room should be doing.
 *
 * The fix is that `MockRun` — and therefore the effect that ticks the bots — is
 * not mounted at all until Start is pressed. A `running` flag defaulting to
 * false would have stopped the picks, but the loop would still be sitting there
 * one state change away from starting itself. This way there is no loop to
 * start. `MockDraft` below is only the gate; everything that can advance a
 * draft lives inside `MockRun`.
 *
 * ============================================================================
 * IT CANNOT TOUCH THE LIVE BOARD
 * ============================================================================
 *
 * Every pick in here is applied by a pure function to React state. There is no
 * fetch in the pick path at all — not to `/api/draft/pick`, not to anything. A
 * whole 142-pick mock completes without a single request leaving the page.
 *
 * The only network call this component ever makes is a debounced snapshot to
 * `/api/mock-draft/state`, which writes `data/mock-draft-state-2026.json` — a
 * different filename and a different, mutually-unreadable file shape. The
 * reasoning is in `@/lib/mock-draft-types` and `@/lib/mock-draft-store`;
 * `verify:mock` proves the live file is byte-identical across a full mock.
 *
 * There is no cheat sheet here either. Same rule as the live board: the
 * autocomplete matches names as he types, and there is no browsable list of who
 * is still available.
 */

type Props = {
  board: BoardView;
  pool: MockPlayer[];
  /** A mock already in progress, if one was saved and still fits this board. */
  resumed: MockDraftFile | null;
  /** Where the mock is parked, shown small so it is obvious it is not the board. */
  stateFile: string;
  projectedPoints: LineupProjectionPoints;
};

type Surface = "board" | "rosters";

/** How long a bot pick stays announced. Shorter than the live board's beat. */
const BOT_FLASH_MS = Math.min(FLASH_MS, 900);

/**
 * The gate. Holds the settings and the mock that can be resumed, and mounts the
 * running draft only once he has asked for one.
 */
export function MockDraft({ board, pool, resumed, stateFile, projectedPoints }: Props) {
  const [phase, setPhase] = useState<"setup" | "running">("setup");
  /**
   * The mock that can be picked up again: the one saved to disk, or the one he
   * has just stepped away from.
   *
   * Parking it in memory is what makes "New mock" safe to press. The repo's rule
   * is recovery over prevention — leaving a running mock discards nothing and
   * offers it straight back on the setup screen, which is a better answer than a
   * confirmation dialog in front of ten people.
   */
  const [parked, setParked] = useState<MockDraftFile | null>(resumed);
  /** Which parked mock the next run should adopt. Null starts from pick one. */
  const [adopt, setAdopt] = useState<MockDraftFile | null>(null);
  const [settings, setSettings] = useState<MockSettings>(() => ({
    controlledTeamId: resumed?.controlledTeamId ?? null,
    archetypes: { ...defaultAssignment(board), ...(resumed?.archetypes ?? {}) },
    paceKey: DEFAULT_PACE_KEY,
  }));
  /** Bumped on every start so a new mock mounts a genuinely fresh run. */
  const [runId, setRunId] = useState(0);

  if (phase === "setup") {
    return (
      <MockDraftSetup
        board={board}
        parked={parked}
        initial={settings}
        stateFile={stateFile}
        onStart={(next) => {
          setSettings(next);
          setAdopt(null);
          setParked(null);
          setRunId((n) => n + 1);
          setPhase("running");
          /*
           * A new mock replaces the saved one. Without this the old file would
           * survive until the new mock's first pick — the autosave does not fire
           * on an empty board — and a reload before then would offer the mock he
           * just chose to throw away.
           */
          void fetch("/api/mock-draft/state", { method: "DELETE" }).catch(() => {});
        }}
        onResume={() => {
          if (!parked) return;
          setSettings((s) => ({
            ...s,
            controlledTeamId: parked.controlledTeamId,
            archetypes: { ...defaultAssignment(board), ...parked.archetypes },
          }));
          setAdopt(parked);
          setRunId((n) => n + 1);
          setPhase("running");
        }}
      />
    );
  }

  return (
    <MockRun
      key={runId}
      board={board}
      pool={pool}
      resumed={adopt}
      settings={settings}
      stateFile={stateFile}
      projectedPoints={projectedPoints}
      onExit={(left) => {
        setParked(left.file);
        setSettings({
          controlledTeamId: left.controlledTeamId,
          archetypes: left.archetypes,
          paceKey: left.paceKey,
        });
        setPhase("setup");
      }}
    />
  );
}

type RunProps = {
  board: BoardView;
  pool: MockPlayer[];
  /** A mock being picked up again, or null to start from pick one. */
  resumed: MockDraftFile | null;
  settings: MockSettings;
  stateFile: string;
  projectedPoints: LineupProjectionPoints;
  /** Hands the mock back to the setup screen so it can be resumed from there. */
  onExit: (left: {
    file: MockDraftFile | null;
    controlledTeamId: string | null;
    archetypes: ArchetypeAssignment;
    paceKey: string;
  }) => void;
};

function MockRun({
  board,
  pool,
  resumed,
  settings,
  stateFile,
  projectedPoints,
  onExit,
}: RunProps) {
  const [state, setState] = useState<DraftStateFile>(
    () => (resumed ? fromMockFile(resumed).state : freshMockState(board)),
  );
  const [sources, setSources] = useState<Record<string, MockPickSource>>(
    () => (resumed ? fromMockFile(resumed).sources : {}),
  );
  const [archetypes, setArchetypes] = useState<ArchetypeAssignment>(
    settings.archetypes,
  );
  const [controlledTeamId, setControlledTeamId] = useState<string | null>(
    settings.controlledTeamId,
  );
  const [startedAt] = useState(resumed?.startedAt ?? new Date().toISOString());
  /**
   * The beat between bot picks, and the one setting that is NOT persisted into
   * `MockDraftFile`. How fast a room wants to watch is a property of who is in
   * the room, not of the mock — a draft resumed alone at a laptop should not
   * inherit the projector pace it was started at — and keeping it out means the
   * saved file shape, and the guard that checks it, are untouched.
   */
  const [paceKey, setPaceKey] = useState(settings.paceKey);

  const [running, setRunning] = useState(true);
  const [surface, setSurface] = useState<Surface>("board");
  const [paneOpen, setPaneOpen] = useState(true);
  const [flash, setFlash] = useState<Flash | null>(null);
  /**
   * How long the current announcement stays up. A bot pick lands every ~420ms,
   * so nine of them at the live board's full beat would stack into a blur; the
   * commissioner's own picks get the full time, because those are the ones the
   * room is meant to read.
   */
  const [flashMs, setFlashMs] = useState(FLASH_MS);
  const [error, setError] = useState<string | null>(null);
  /*
   * Opens by saying whose picks these are. The setup screen has just been
   * dismissed, so the one thing worth restating on the board is the choice that
   * governs every keystroke from here.
   */
  const [notice, setNotice] = useState<string | null>(() => {
    const mine = settings.controlledTeamId
      ? board.teams.find((t) => t.id === settings.controlledTeamId)
      : null;
    return mine
      ? `You are drafting for ${mine.franchiseName}.`
      : "Watching — bots are drafting all ten.";
  });
  const [lastChoice, setLastChoice] = useState<MockChoice | null>(null);
  /** Which franchise's bot picker is open. Null when none is. */
  const [inspecting, setInspecting] = useState<string | null>(null);

  const flashSeq = useRef(0);
  const boardRef = useRef<HTMLElement>(null);

  /** The whole board, derived from the real engine. Never stored. */
  const view = useMemo(() => buildRoomView(board, state), [board, state]);

  const targetSlot = useMemo(
    () => view.slots.find((s) => s.id === view.onTheClockSlotId) ?? null,
    [view],
  );
  const draftedIds = useMemo(() => new Set(view.draftedPlayerIds), [view]);
  const lineups = useMemo(
    () => buildFranchiseLineups(view, projectedPoints),
    [view, projectedPoints],
  );

  const yourTurn = Boolean(
    targetSlot && controlledTeamId && targetSlot.currentOwner.id === controlledTeamId,
  );
  const done = targetSlot === null;

  const holderOf = useCallback(
    (playerId: string) => view.slots.find((s) => s.player?.id === playerId) ?? null,
    [view.slots],
  );

  const announce = useCallback(
    (opts: {
      name: string;
      position: string;
      nflTeam: string | null;
      byeWeek: number | null;
      team: string;
      label: string;
      duplicate?: boolean;
      headshotUrl?: string | null;
      ms: number;
    }) => {
      setFlashMs(opts.ms);
      setFlash({
        seq: ++flashSeq.current,
        name: opts.name,
        position: opts.position,
        nflTeam: opts.nflTeam,
        byeWeek: opts.byeWeek,
        team: opts.team,
        label: opts.label,
        duplicate: opts.duplicate,
        headshotUrl: opts.headshotUrl,
      });
    },
    [],
  );

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), flashMs);
    return () => clearTimeout(timer);
  }, [flash, flashMs]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // --- The commissioner's own pick -----------------------------------------

  const commit = useCallback(
    (player: MockPlayer, override: boolean) => {
      if (!targetSlot) return;
      try {
        const next = humanPickOnce({
          board,
          state,
          slotId: targetSlot.id,
          player,
          override,
        });
        setSources((s) => ({ ...s, [targetSlot.id]: "you" }));
        setState(next);
        setLastChoice(null);
        setError(null);
        announce({
          name: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          byeWeek: player.byeWeek,
          team: targetSlot.currentOwner.name,
          label: targetSlot.label,
          duplicate: override,
          headshotUrl: player.headshotUrl,
          ms: FLASH_MS,
        });
      } catch (err) {
        setError(
          err instanceof DraftRuleError
            ? err.message
            : "The mock board refused that pick.",
        );
      }
    },
    [announce, board, state, targetSlot],
  );

  const undo = useCallback(() => {
    if (state.picks.length === 0) {
      setNotice("Nothing to undo.");
      return;
    }
    /*
     * Unwinds to the commissioner's own last decision rather than one pick.
     * Undoing a single bot pick would be pointless: the clock would land back
     * on that bot and it would immediately pick again. What he actually means
     * by undo in a mock is "give me that pick back".
     */
    setFlash(null);
    let next = state;
    let removed = 0;
    for (let i = 0; i < board.totalPicks; i++) {
      if (next.picks.length === 0) break;
      next = undoMockPick(next);
      removed++;
      const at = buildRoomView(board, next);
      const clock = at.slots.find((s) => s.id === at.onTheClockSlotId);
      if (!controlledTeamId) break;
      if (clock && clock.currentOwner.id === controlledTeamId) break;
    }
    setState(next);
    setNotice(
      removed === 1 ? "Undid the last pick." : `Wound back ${removed} picks.`,
    );
  }, [board, controlledTeamId, state]);

  const toggleSurface = useCallback(
    () => setSurface((s) => (s === "board" ? "rosters" : "board")),
    [],
  );

  /*
   * THE SAME FOLLOW THE LIVE BOARD RUNS, wired to the same hook rather than to
   * a second copy of it. The mock is the rehearsal — the repo's own note on
   * `draft-surface.tsx` is that drift between the two gets discovered on the
   * night — and a mock that has to be scrolled by hand rehearses the wrong
   * evening. The clock is the cursor here: there is no aiming in a mock.
   */
  const tvMode = useTvMode();
  const { fit, toggle: toggleFit, reset: resetFit } = useBoardFit();
  const resetBoard = useCallback(() => {
    resetBoardDensity();
    resetFit();
  }, [resetFit]);
  const safe = useSafeAreaKeys(resetBoard);
  const density = useBoardDensityValue();
  const follow = useBoardFollow({
    boardRef,
    activeRound: targetSlot?.round ?? null,
    enabled: tvMode && !fit && surface === "board",
    safe,
  });
  useBoardReadout({
    boardRef,
    enabled: tvMode && surface === "board",
    fit,
    deps: [density, safe.top, safe.bottom, state.picks.length],
  });

  const typing = useDraftTyping<MockPlayer>({
    pool,
    draftedIds,
    // The box is dead while a bot is on the clock, so a name typed in the gap
    // between two bot picks cannot be entered for the wrong franchise.
    enabled: yourTurn && !done,
    holderOf,
    onCommit: commit,
    onUndo: undo,
    onClearAim: follow.resume,
    onToggleView: toggleSurface,
  });

  // --- The bots ------------------------------------------------------------

  const pace = paceByKey(paceKey);

  /**
   * An announcement has to clear before the next pick lands or the overlays
   * stack, so it follows the pace rather than the live board's beat. At Instant
   * it is barely a blink, which is the honest consequence of asking for instant.
   */
  const botFlashMs =
    pace.delayMs === 0
      ? 180
      : Math.max(180, Math.min(BOT_FLASH_MS, pace.delayMs * 2));

  /**
   * One bot pick, applied. Shared by the ticking chain below and the Step
   * button, so a pick taken one at a time cannot behave differently from one
   * taken at speed.
   */
  const botStep = useCallback(() => {
    try {
      const step = botPickOnce({ board, state, pool, archetypes });
      if (!step) return;
      setSources((s) => ({ ...s, [step.slot.id]: "ai" }));
      setState(step.state);
      setLastChoice(step.choice);
      announce({
        name: step.choice.player.name,
        position: step.choice.player.position,
        nflTeam: step.choice.player.nflTeam,
        byeWeek: step.choice.player.byeWeek,
        team: step.slot.currentOwner.name,
        label: step.slot.label,
        headshotUrl: step.choice.player.headshotUrl,
        ms: botFlashMs,
      });
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : "A bot could not make a pick.");
    }
  }, [announce, archetypes, board, botFlashMs, pool, state]);

  /**
   * One bot pick per effect run. Each pick changes `state`, which re-runs this
   * and schedules the next — a chain rather than a loop, so React stays in
   * control and pausing takes effect immediately.
   */
  useEffect(() => {
    if (!running || done) return;
    if (targetSlot && controlledTeamId && targetSlot.currentOwner.id === controlledTeamId) {
      return;
    }
    const timer = setTimeout(botStep, pace.delayMs);
    return () => clearTimeout(timer);
  }, [botStep, controlledTeamId, done, pace.delayMs, running, targetSlot]);

  /** One pick while paused, for talking the room through a round. */
  const stepOnce = useCallback(() => {
    if (done) return;
    if (yourTurn) {
      setNotice("That pick is yours — type a name and press Enter.");
      return;
    }
    botStep();
  }, [botStep, done, yourTurn]);

  const cyclePace = useCallback(() => {
    const at = MOCK_PACES.findIndex((p) => p.key === paceKey);
    setPaceKey(MOCK_PACES[(at + 1) % MOCK_PACES.length].key);
  }, [paceKey]);

  /** Runs the rest of the draft with no beat between picks. ~70ms for 142. */
  const finishNow = useCallback(() => {
    setRunning(false);
    setFlash(null);
    let next = state;
    const madeBy: Record<string, MockPickSource> = {};
    for (let i = 0; i < board.totalPicks + 10; i++) {
      const step = botPickOnce({ board, state: next, pool, archetypes });
      if (!step) break;
      madeBy[step.slot.id] = "ai";
      next = step.state;
    }
    setSources((s) => ({ ...s, ...madeBy }));
    setState(next);
    setSurface("rosters");
    setNotice("Autopicked the rest of the draft.");
  }, [archetypes, board, pool, state]);

  /**
   * Back to the setup screen — handing this mock over rather than throwing it
   * away. The board on screen survives in memory and is offered straight back
   * as "resume", so pressing this by accident in front of the room costs one
   * click to undo. Recovery rather than a confirmation gate, same bargain as
   * undo on the live board.
   */
  const newMock = useCallback(() => {
    onExit({
      file:
        state.picks.length > 0
          ? toMockFile({ state, controlledTeamId, archetypes, sources, startedAt })
          : null,
      controlledTeamId,
      archetypes,
      paceKey,
    });
  }, [archetypes, controlledTeamId, onExit, paceKey, sources, startedAt, state]);

  // --- Autosave, debounced, to the MOCK file only --------------------------

  useEffect(() => {
    if (state.picks.length === 0) return;
    const timer = setTimeout(() => {
      const file = toMockFile({
        state,
        controlledTeamId,
        archetypes,
        sources,
        startedAt,
      });
      void fetch("/api/mock-draft/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(file),
        // A mock that fails to save is not worth interrupting anyone over.
      }).catch(() => {});
    }, 900);
    return () => clearTimeout(timer);
  }, [archetypes, controlledTeamId, sources, startedAt, state]);

  // --- Render --------------------------------------------------------------

  const clockLineup = targetSlot
    ? lineups.find((l) => l.team.id === targetSlot.currentOwner.id) ?? null
    : null;

  /*
   * Flat `bg-background`, matching the live board — see the note in
   * `draft-board.tsx`. The mock is a rehearsal for draft night, so it has to look
   * like draft night.
   */
  return (
    /*
     * `h-[100dvh]` over `inset-0`, and bottom room for the touch name box —
     * both explained in `draft-board.tsx`, which does the same two things for
     * the same reasons.
     */
    <div className="bg-background text-foreground fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden touch:pb-12 portrait:touch:pb-[3.75rem]">
      <FlashStyles />

      {/*
        Wraps to a control row and a state line on a phone held upright, for
        the reason set out on the live board's header: the state line is a run
        of inline spans, and at 412px it wrapped to eight of them.
      */}
      <header className="bg-board-base border-primary mx-[0.5vw] mt-[0.5vh] flex shrink-0 flex-wrap items-center gap-[0.8vw] rounded-lg border-[0.08vw] px-[0.7vw] py-[0.55vh] max-md:mx-1 max-md:mt-1 max-md:gap-0.5 max-md:px-1 max-md:py-1">
        <span className="bg-primary text-primary-foreground shrink-0 rounded px-[0.6vw] py-[0.3vh] text-[clamp(0.55rem,0.8vw,1rem)] font-black tracking-[0.08em] uppercase max-md:px-1 max-md:py-0.5 max-md:text-[9px]">
          Mock
        </span>
        <span className="text-muted-foreground shrink-0 text-[clamp(0.5rem,0.68vw,0.9rem)] font-semibold max-md:hidden [@media(max-height:520px)]:hidden">
          {LEAGUE.name} &middot; real board, real order, real keepers
        </span>

        <ViewToggle
          view={surface}
          onChange={setSurface}
          options={["board", "rosters"]}
        />

        <div className="min-w-0 flex-1 truncate text-right max-md:order-last max-md:w-full max-md:flex-none max-md:basis-full max-md:text-left max-md:text-[10px] max-md:leading-[1.3]">
          {done ? (
            <span className="text-success text-[clamp(0.55rem,0.834vw,1.05rem)] font-black">
              THAT&apos;S THE MOCK.
            </span>
          ) : (
            <span className="text-[clamp(0.55rem,0.834vw,1.05rem)] font-extrabold">
              <span className="text-muted-foreground">
                {yourTurn ? "YOU ARE UP: " : "ON THE CLOCK: "}
              </span>
              <span className={yourTurn ? "text-primary font-black" : "text-live font-black"}>
                {targetSlot?.currentOwner.name.toUpperCase()}
              </span>
              <span className="text-muted-foreground">
                {" "}
                &middot; {targetSlot?.currentOwner.franchiseName.toUpperCase()} (
                {targetSlot?.label})
              </span>
            </span>
          )}
        </div>

        <div className="bg-live text-primary-foreground shrink-0 rounded px-[0.7vw] py-[0.3vh] text-[clamp(0.55rem,0.85vw,1.1rem)] font-black tabular-nums max-md:px-1 max-md:py-0.5 max-md:text-[10px]">
          {view.filled}
          <span className="opacity-70">/{view.totalPicks}</span>
        </div>

        <div className="flex shrink-0 items-center gap-[0.35vw] max-md:ml-auto max-md:gap-0.5">
          {surface === "board" && (
            <OnTheClockRosterSheet
              lineup={clockLineup}
              slot={targetSlot}
              eyebrow={yourTurn ? "You are up" : "On the clock"}
            />
          )}
          {!done && (
            <MockButton
              onClick={() => setRunning((r) => !r)}
              title={running ? "Pause the bots" : "Let the bots pick"}
            >
              {running ? (
                <Pause className="h-[1em] w-[1em]" />
              ) : (
                <Play className="h-[1em] w-[1em]" />
              )}
              <span className="max-md:hidden">{running ? "Pause" : "Resume"}</span>
            </MockButton>
          )}
          {!done && !running && (
            <MockButton
              onClick={stepOnce}
              title="Let one bot pick, then stop again"
              className="max-md:hidden"
            >
              <SkipForward className="h-[1em] w-[1em]" /> Step
            </MockButton>
          )}
          {!done && (
            <MockButton onClick={finishNow} title="Autopick every remaining pick at once">
              <FastForward className="h-[1em] w-[1em]" />{" "}
              <span className="max-md:hidden">Finish</span>
            </MockButton>
          )}
          {!done && (
            <MockButton
              onClick={cyclePace}
              title={`Bots pick every ${pace.delayMs}ms — ${pace.blurb}. Click for the next pace.`}
              className="max-md:hidden"
            >
              <Timer className="h-[1em] w-[1em]" /> {pace.name}
            </MockButton>
          )}
          {/* The same layout switch the live board carries, for the same
              reason the grid is shared: the mock is the rehearsal. */}
          {surface === "board" && (
            <MockButton
              onClick={toggleFit}
              title={
                fit
                  ? "Showing all sixteen rounds at once. Switch to Scroll for bigger type (⌘⇧F)"
                  : "Showing eleven rounds, following the pick. Switch to Fit for all sixteen (⌘⇧F)"
              }
              className="max-md:hidden"
            >
              {fit ? (
                <LayoutGrid className="h-[1em] w-[1em]" />
              ) : (
                <ScrollText className="h-[1em] w-[1em]" />
              )}
              {fit ? "Fit" : "Scroll"}
            </MockButton>
          )}
          <MockButton onClick={newMock} title="Back to setup — this mock is kept, and offered back there">
            <RotateCcw className="h-[1em] w-[1em]" />{" "}
            <span className="max-md:hidden">New mock</span>
          </MockButton>
          <Link
            href="/"
            title="Leave the mock"
            className={cn(
              "text-muted-foreground/40 hover:text-foreground flex items-center justify-center p-1",
              TAP,
            )}
          >
            <X className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* --- Who you are, and who the bots are ---------------------------- */}
      <TheRoom
        lineups={lineups}
        archetypes={archetypes}
        controlledTeamId={controlledTeamId}
        onControl={(id) => {
          setControlledTeamId(id);
          setInspecting(null);
          setNotice(
            id
              ? `You are drafting for ${lineups.find((l) => l.team.id === id)?.team.franchiseName}.`
              : "Watching — bots are drafting all ten.",
          );
        }}
        inspecting={inspecting}
        onInspect={setInspecting}
        onArchetype={(teamId, key) => {
          setArchetypes((a) => ({ ...a, [teamId]: key }));
          setInspecting(null);
        }}
        onTheClockId={targetSlot?.currentOwner.id ?? null}
      />

      {(error || notice) && (
        <div className="shrink-0">
          {error && (
            <Strip tone="destructive" onDismiss={() => setError(null)}>
              {error}
            </Strip>
          )}
          {notice && <Strip tone="muted">{notice}</Strip>}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        {surface === "board" ? (
          <>
            <BoardGrid
              slots={view.slots}
              teams={view.teams}
              rounds={view.rounds}
              teamCount={view.teamCount}
              aimedId={null}
              targetSlotId={targetSlot?.id ?? null}
              boardRef={boardRef}
              fit={fit}
            />
            {paneOpen && (
              <div className="my-[0.5vh] mr-[0.5vw] flex min-h-0">
                <OnTheClockRoster
                  lineup={clockLineup}
                  slot={targetSlot}
                  eyebrow={yourTurn ? "You are up" : "On the clock"}
                />
              </div>
            )}
          </>
        ) : (
          <RosterWall view={view} projectedPoints={projectedPoints} />
        )}
      </div>

      <footer className="border-border/60 text-muted-foreground/70 flex shrink-0 items-center gap-[1.2vw] border-t px-[1.2vw] py-[0.5vh] text-[clamp(0.5rem,0.72vw,0.9rem)] max-md:gap-2 max-md:px-2 max-md:text-[10px]">
        {lastChoice ? (
          <span className="min-w-0 truncate">
            <Bot className="mr-1 inline h-[1em] w-[1em]" />
            {lastChoice.reason}
          </span>
        ) : yourTurn ? (
          <span className="text-primary font-bold">
            <span className="touch:hidden">
              Type a name and press Enter — same as Saturday.
            </span>
            <span className="hidden touch:inline">
              Type a name below, then tap him.
            </span>
          </span>
        ) : (
          <span>Pick a franchise above to draft for, or watch all ten.</span>
        )}
        {/* Everything from here is the keyboard grammar and where the file is
            parked — neither is true or useful on a phone. */}
        <span className="ml-auto flex shrink-0 items-center gap-[1vw] max-md:hidden">
          <span className="flex items-center gap-[0.25vw]">
            <Lock className="h-[1em] w-[1em]" /> keeper
          </span>
          <span>
            <Kbd>Enter</Kbd> draft
          </span>
          <span>
            <Kbd>⌘Z</Kbd> back to your pick
          </span>
          <span>
            <Kbd>Tab</Kbd> {surface === "board" ? "rosters" : "board"}
          </span>
          <button
            type="button"
            onClick={() => setPaneOpen((p) => !p)}
            className="hover:text-foreground hidden lg:inline"
          >
            {paneOpen ? "hide pane" : "show pane"}
          </button>
          <span className="text-muted-foreground/40 font-mono">
            mock only &middot; {stateFile}
          </span>
        </span>
      </footer>

      {tvMode && surface === "board" && follow.suspended && (
        <FollowPill
          label={targetSlot?.label ?? null}
          seconds={follow.resumeIn}
          onResume={follow.resume}
        />
      )}

      <TvSafeAreaOverlay tvMode={tvMode} />
      <BoardReadout tvMode={tvMode} />

      {flash && <FlashOverlay key={flash.seq} flash={flash} />}

      {typing.query.length > 0 && !typing.pendingDuplicate && (
        <MatchOverlay<MockPlayer>
          query={typing.query}
          matches={typing.matches}
          selected={typing.selected}
          holderOf={holderOf}
          onPick={typing.attempt}
        />
      )}

      <TouchPickBar
        query={typing.query}
        onQuery={typing.setQuery}
        enabled={yourTurn && !done}
        waitingOn={
          done
            ? null
            : (targetSlot?.currentOwner.name ?? null)
        }
      />

      {typing.pendingDuplicate && (
        <DuplicateWarning
          player={typing.pendingDuplicate.player}
          holder={typing.pendingDuplicate.holder}
          target={targetSlot}
          onConfirm={typing.confirmDuplicate}
          onCancel={typing.dismissDuplicate}
        />
      )}
    </div>
  );
}

function MockButton({
  onClick,
  title,
  children,
  className,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "border-border/60 hover:bg-muted flex items-center justify-center gap-1 rounded border px-[0.55vw] py-[0.45vh] text-[clamp(0.55rem,0.75vw,0.95rem)] font-semibold max-md:px-2 max-md:text-[11px]",
        TAP,
        className,
      )}
    >
      {children}
    </button>
  );
}

// --- The room ---------------------------------------------------------------

/**
 * Ten franchises across the top: who you are drafting for, and what personality
 * each bot is running.
 *
 * The commissioner liked that Smart Draft lets you "click the bot label under
 * any team to see what it's doing and swap it for a different style". This is
 * that, moved above the grid instead of tucked under a column header — a
 * 40-pixel column cannot hold "Zero RB" at a size the room can read, and the
 * grid is not allowed to give up any more height than it has to.
 */
function TheRoom({
  lineups,
  archetypes,
  controlledTeamId,
  onControl,
  inspecting,
  onInspect,
  onArchetype,
  onTheClockId,
}: {
  lineups: ReturnType<typeof buildFranchiseLineups>;
  archetypes: ArchetypeAssignment;
  controlledTeamId: string | null;
  onControl: (id: string | null) => void;
  inspecting: string | null;
  onInspect: (id: string | null) => void;
  onArchetype: (teamId: string, key: string) => void;
  onTheClockId: string | null;
}) {
  return (
    <div className="relative mx-[0.5vw] mt-[0.35vh] shrink-0 [--room-cell:0px] max-md:mx-1 max-md:overflow-x-auto max-md:[--room-cell:5.1rem]">
      {/* Same floor as a board column, so the ten chips read as the ten columns
          underneath them rather than as a separate, denser row. */}
      <div
        className="grid gap-[0.25vw]"
        style={{
          gridTemplateColumns: `repeat(${lineups.length}, minmax(var(--room-cell), 1fr))`,
          minWidth: `calc(${lineups.length} * (var(--room-cell) + 0.25vw))`,
        }}
      >
        {lineups.map((l) => {
          const mine = l.team.id === controlledTeamId;
          const archetype = archetypeByKey(archetypes[l.team.id]);
          const open = inspecting === l.team.id;
          return (
            <div key={l.team.id} className="relative min-w-0 max-md:static">
              <div
                className={cn(
                  "flex min-w-0 flex-col rounded border",
                  mine
                    ? "border-primary bg-primary/10"
                    : l.team.id === onTheClockId
                      ? "border-live bg-board-base"
                      : "border-border/50 bg-board-base",
                )}
              >
                {/* Take this franchise over. */}
                <button
                  type="button"
                  onClick={() => onControl(mine ? null : l.team.id)}
                  title={
                    mine
                      ? `Stop drafting for ${l.team.franchiseName}`
                      : `Draft for ${l.team.franchiseName} (${l.team.manager})`
                  }
                  className="flex min-w-0 items-center gap-[0.2vw] px-[0.3vw] pt-[0.2vh] max-md:min-h-8 max-md:px-1"
                >
                  {mine ? (
                    <User className="text-primary h-[0.9em] w-[0.9em] shrink-0" />
                  ) : (
                    <Bot className="text-muted-foreground/60 h-[0.9em] w-[0.9em] shrink-0" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left text-[clamp(0.48rem,0.56vw,0.78rem)] font-black uppercase max-md:text-[10px]">
                    {l.team.name}
                  </span>
                  <span className="text-muted-foreground/70 shrink-0 font-mono text-[clamp(0.42rem,0.5vw,0.7rem)] tabular-nums max-md:text-[9px]">
                    {l.rosterSize}
                  </span>
                </button>

                {/* Swap this bot's personality. */}
                <button
                  type="button"
                  onClick={() => onInspect(open ? null : l.team.id)}
                  disabled={mine}
                  title={mine ? "You are drafting this one" : archetype.blurb}
                  className={cn(
                    "flex min-w-0 items-center gap-[0.15vw] px-[0.3vw] pb-[0.2vh] text-left max-md:min-h-8 max-md:px-1",
                    mine ? "opacity-40" : "hover:text-primary",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[clamp(0.44rem,0.52vw,0.72rem)] font-semibold max-md:text-[9px]">
                    {mine ? "you" : archetype.name}
                  </span>
                  {!mine && (
                    <ChevronDown className="h-[0.8em] w-[0.8em] shrink-0 opacity-50" />
                  )}
                </button>
              </div>

              {open && !mine && (
                <div className="surface-raised border-primary/60 absolute top-full left-0 z-[65] mt-1 w-[16vw] min-w-[190px] overflow-hidden rounded-lg border shadow-2xl max-md:right-0 max-md:w-auto max-md:min-w-0">
                  {BOT_ARCHETYPES.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => onArchetype(l.team.id, a.key)}
                      className={cn(
                        "block w-full px-2.5 py-1.5 text-left transition-colors",
                        TAP,
                        a.key === archetype.key
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted/60",
                      )}
                    >
                      <span className="block text-[11px] font-bold">{a.name}</span>
                      <span
                        className={cn(
                          "block text-[10px] leading-snug",
                          a.key === archetype.key
                            ? "opacity-80"
                            : "text-muted-foreground",
                        )}
                      >
                        {a.blurb}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  LayoutGrid,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Printer,
  ScrollText,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { LEAGUE } from "@/lib/league-config";

import { optimisticPick, optimisticUndo } from "@/lib/draft-view";
import { buildFranchiseLineups } from "@/lib/roster-lineup";
import {
  OnTheClockRoster,
  OnTheClockRosterSheet,
} from "@/components/on-the-clock-roster";
import { PickList } from "@/components/pick-list";
import { RosterWall } from "@/components/roster-wall";
import { BoardReadout, TvSafeAreaOverlay } from "@/components/tv-safe-area-overlay";
import { useDraftLiveSync, type LiveStatus } from "@/components/use-draft-live-sync";
import {
  BoardGrid,
  DeletePickWarning,
  DuplicateWarning,
  FLASH_MS,
  FlashOverlay,
  FlashStyles,
  FollowPill,
  MatchOverlay,
  PickMenu,
  Strip,
  TAP,
  TouchPickBar,
  ViewToggle,
  useDraftTyping,
  type DraftView,
  type Flash,
} from "@/components/draft-surface";
import { resetBoardDensity, useBoardDensityValue } from "@/lib/use-board-density";
import { useBoardFit } from "@/lib/use-board-fit";
import { useBoardFollow } from "@/lib/use-board-follow";
import { useBoardReadout } from "@/lib/use-board-readout";
import { useFullscreen } from "@/lib/use-fullscreen";
import { useSafeAreaKeys } from "@/lib/use-safe-area";
import { useTvMode } from "@/lib/use-tv-mode";
import type { FranchiseLineup, LineupProjectionPoints } from "@/lib/roster-lineup";
import type { ClientPlayer, DraftRoomView, LiveSlot } from "@/lib/draft-types";

/**
 * The draft board. This is the whole product.
 *
 * One screen on a TV, ten people in the room reading it from fifteen feet away,
 * and nobody browsing rankings in it. Most picks are called out loud and typed
 * by whoever is at the keyboard. Every decision follows from that:
 *
 *   FULL BLEED. The grid gets the entire viewport — it renders over the app
 *   shell rather than inside it, because a 64px sidebar is 64px of board.
 *
 *   TYPE ANYWHERE, ONE KEYSTROKE PER DECISION, UNDO ONLY AS A CHORD. The
 *   keyboard grammar lives in `useDraftTyping` in `@/components/draft-surface`,
 *   shared verbatim with the mock draft so that mocking is genuine rehearsal.
 *
 *   NO CHEAT SHEET. There is no browsable list of available players anywhere on
 *   this screen and there must never be one. The commissioner removed that from
 *   this league on purpose — "I didn't like people being able to see the cheat
 *   sheet as we entered picks. It felt like cheating." The autocomplete matches
 *   the pool as he types; that is all.
 *
 *   NO CLOCK. Not a countdown, not a count-up. He asked for neither and the
 *   board has no room for noise.
 *
 *   WARN, NEVER REFUSE. Drafting someone already taken raises the duplicate
 *   moment — which in this league is a forfeit and a running joke, not a
 *   validation error — and then does it anyway if he says so twice.
 *
 *   THE ROOM IS THE SPELLCHECK. A committed pick is announced across the board
 *   for about three seconds — long enough to be read and argued with — so a
 *   wrong entry is caught by ten people shouting rather than by one man reading
 *   a footer.
 *
 * Two things are new since the board was first built, both asked for after the
 * commissioner watched Smart Draft with a league member:
 *
 *   THE ON-THE-CLOCK ROSTER PANE, down the right-hand side. Whoever is up has
 *   their roster shown so the room can talk about it.
 *
 *   A BOARD / ROSTERS TOGGLE. Same screen, two views, one keystroke apart.
 *
 * ============================================================================
 * IT IS NO LONGER ONE KEYBOARD
 * ============================================================================
 * Two managers are remote and open this same board on the deployment to enter
 * their own picks. That breaks the assumption the board was built on — that the
 * only thing which can change the draft is the person typing — and it breaks it
 * silently, because a board rendered once on the server and run from browser
 * state will happily show a stale draft all night without a single error.
 *
 * So the board now listens. `useDraftLiveSync` reports that the saved draft
 * moved and this component re-fetches `/api/draft/state` and calls `setView`.
 * Deliberately NOT `router.refresh()`: the board data lives in `view` while the
 * half-typed name, the aimed cell and the open menu live in separate state, and
 * only the former is replaced. A remote pick can land mid-keystroke without
 * costing a character.
 *
 * This works only where picks are saved somewhere shared, so the subscription is
 * gated on `savesAreShared()`. On a laptop's file store there is no second
 * device to hear from and the board says nothing rather than showing a "live"
 * badge it cannot honour.
 *
 * Off the network it still needs nothing but a save. Run locally that save is a
 * write to the machine the board is on, so a dead wifi all evening goes
 * unnoticed — there is simply no live sync to be had.
 */

type Props = {
  initialView: DraftRoomView;
  pool: ClientPlayer[];
  /** Where a saved pick lands, shown small so he knows the board is saved. */
  stateFile: string;
  /**
   * Whether saved picks are visible to other devices — the database store. Only
   * then is there anything to subscribe to. See `savesAreShared`.
   */
  sharedSaves: boolean;
  projectedPoints: LineupProjectionPoints;
};

type ApiResponse = {
  ok: boolean;
  error?: string;
  code?: string;
  overridable?: boolean;
  view?: DraftRoomView;
};

type Surface = DraftView;

/**
 * The order the toggle reads in, and the order Tab cycles through. Picks sits
 * between the two grids because that is what it is between: the board's own
 * slots, re-sorted into one axis.
 */
const SURFACES: readonly Surface[] = ["board", "picks", "rosters"];

export function DraftBoard({
  initialView,
  pool,
  stateFile,
  sharedSaves,
  projectedPoints,
}: Props) {
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** A cell he stepped to with the arrow keys. Null means "follow the clock". */
  const [aimedSlotId, setAimedSlotId] = useState<string | null>(null);
  /** An entered pick right-clicked on, and where to draw its menu. */
  const [pickMenu, setPickMenu] = useState<{
    slot: LiveSlot;
    x: number;
    y: number;
  } | null>(null);
  /** The pick currently being announced to the room. Purely presentational. */
  const [flash, setFlash] = useState<Flash | null>(null);
  const [surface, setSurface] = useState<Surface>("board");
  /**
   * The pane can be put away. The grid is the primary object on this screen, so
   * if a smaller display needs the 12.5vw back it gets it in one click.
   */
  const [paneOpen, setPaneOpen] = useState(true);

  const inFlight = useRef(0);
  /**
   * `busy` again, readable synchronously. The latch below has to be set from
   * inside a callback that must not be rebuilt when `busy` changes, and a
   * callback closing over the state would read whatever `busy` was when it was
   * created — which during a save is exactly the stale value.
   */
  const busyRef = useRef(false);
  /**
   * A remote pick arrived while a local one was still in the air.
   *
   * The realtime handler consumes each Postgres event once and there is no
   * queue behind it, so a `pullRemote` that simply returned threw the event
   * away for good — and the fallback poll could not cover it, because the poll
   * is off whenever the socket is live. That is a remote manager's pick sitting
   * invisible on the projector, with the clock still naming him, until somebody
   * else picks. This records that there is a board to go and get; `send`
   * collects it as it finishes.
   */
  const pendingRemote = useRef(false);
  const flashSeq = useRef(0);
  /**
   * The newest saved pick this browser has observed.
   *
   * The initial pick is history, not an announcement. From then on this lets
   * the board announce from state changes — including realtime pulls on the
   * projector — while ignoring both the optimistic/server copies of a local
   * pick and an undo exposing an older `lastPick`.
   */
  const newestPickSeq = useRef(initialView.lastPick?.seq ?? 0);
  const announcedPick = useRef(
    initialView.lastPick?.player
      ? `${initialView.lastPick.id}:${initialView.lastPick.player.id}`
      : null,
  );
  /** The scrolling grid, so the live cell can be kept in view. */
  const boardRef = useRef<HTMLElement>(null);

  /**
   * Fullscreen is the BUTTON's state; TV mode is the LAYOUT's.
   *
   * They are usually the same thing and deliberately are not the same value.
   * The button has to latch to `document.fullscreenElement` because Esc leaves
   * fullscreen behind its back, while the layout also has to be right on a
   * kiosk-mode PC and under `?tv=1`. See `use-tv-mode.ts`.
   */
  const { active: fullscreen, toggle: toggleTvMode } = useFullscreen();
  const tvMode = useTvMode();
  /** As many rounds as fit at full size and a scroll, or all of them in the
      band at whatever size that leaves. ⌘⇧F. */
  const { fit, toggle: toggleFit, reset: resetFit } = useBoardFit();
  /**
   * ⌘⇧↑/⌘⇧↓ and ⌘⌥↑/⌘⌥↓, installed once for this surface — and ⌘⌥0, which is
   * the ONE reset: the band, the density and the layout all back to what
   * shipped. Three separate resets is three things to remember at exactly the
   * moment he has stopped wanting to think about any of it.
   */
  const resetBoard = useCallback(() => {
    resetBoardDensity();
    resetFit();
  }, [resetFit]);
  const safe = useSafeAreaKeys(resetBoard);
  /* Read-only: `BoardGrid` owns the density chords, and a second listener here
     would step the board twice on every press. */
  const density = useBoardDensityValue();

  const draftedIds = useMemo(
    () => new Set(view.draftedPlayerIds),
    [view.draftedPlayerIds],
  );

  /**
   * Every cell the cursor may land on. Keepers are excluded because they are
   * neither draftable nor deletable — they come from the Smart Draft snapshot,
   * so there is nothing here that could act on one.
   *
   * Empty AND entered cells, which is the change that makes a single pick
   * correctable: the arrow keys used to hop between open slots only, so the
   * cell holding a mis-entry was the one place on the board the keyboard could
   * not reach.
   */
  const cursorSlots = useMemo(
    () => view.slots.filter((s) => s.fill !== "keeper"),
    [view.slots],
  );
  /**
   * A slot he aimed at that has since become a keeper quietly stops counting,
   * rather than being cleared by an effect. Derivation means the board never
   * renders a frame pointing at a cell that is no longer his to act on.
   */
  const parkedId =
    aimedSlotId && cursorSlots.some((s) => s.id === aimedSlotId)
      ? aimedSlotId
      : null;
  const cursorSlot = useMemo(
    () =>
      cursorSlots.find((s) => s.id === (parkedId ?? view.onTheClockSlotId)) ??
      null,
    [cursorSlots, parkedId, view.onTheClockSlotId],
  );
  /**
   * The two things the cursor can be doing, and never both at once: sitting on
   * an empty cell waiting for a name, or sitting on an entered pick that Delete
   * would remove. Typing is disabled in the second case, so a name can never be
   * entered into a cell that already holds one.
   */
  const targetSlot = cursorSlot?.fill === null ? cursorSlot : null;
  const deletableSlot = cursorSlot?.fill === "pick" ? cursorSlot : null;
  /** True only when the cursor has been moved off the clock deliberately. */
  const parkedOffClock = parkedId !== null && parkedId !== view.onTheClockSlotId;

  /*
   * Keep the live cell on screen.
   *
   * The board scrolls when the screen cannot hold every round at a legible
   * size, which means by the late rounds the cell on the clock is below the fold
   * — and the operator would be scrolling with one hand while typing names with
   * the other. `block: "nearest"` so a cell already in view does not twitch.
   *
   * A BROWSER WINDOW ONLY. On the projector the board parks the whole ROUND in
   * the safe band instead, which is a different question with a different
   * answer — see `useBoardFollow`. Running both would have them fighting over
   * `scrollTop` on every pick.
   */
  const cursorSlotId = cursorSlot?.id ?? null;
  useEffect(() => {
    if ((tvMode && !fit) || !cursorSlotId) return;
    boardRef.current
      ?.querySelector(`[data-slot-id="${cursorSlotId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [cursorSlotId, fit, surface, tvMode]);

  /*
   * Nothing to follow in Fit mode — the whole draft is already on screen — so
   * the effect is switched off rather than left to fight a box that does not
   * scroll.
   */
  const follow = useBoardFollow({
    boardRef,
    activeRound: cursorSlot?.round ?? null,
    enabled: tvMode && !fit && surface === "board",
    safe,
  });

  useBoardReadout({
    boardRef,
    enabled: tvMode && surface === "board",
    fit,
    deps: [density, safe.top, safe.bottom, view.slots],
  });

  const holderOf = useCallback(
    (playerId: string) => view.slots.find((s) => s.player?.id === playerId) ?? null,
    [view.slots],
  );

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * Keyed on the flash object rather than a boolean, so committing a pick while
   * the previous one is still on screen tears down the old timer and starts a
   * new one. The new name replaces the old immediately; nothing queues.
   */
  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  /**
   * Announce the board changing, not the browser that submitted the mutation.
   * That makes a remote pick take the same path on the projector as a local
   * optimistic pick. Sequence rejects undo exposing an old pick; slot + player
   * identity dedupes the optimistic view from the authoritative response.
   */
  useEffect(() => {
    const last = view.lastPick;
    if (!last?.player || last.seq == null || last.seq <= newestPickSeq.current) return;

    newestPickSeq.current = last.seq;
    const identity = `${last.id}:${last.player.id}`;
    if (identity === announcedPick.current) return;
    announcedPick.current = identity;

    const player = pool.find((candidate) => candidate.id === last.player!.id);
    setFlash({
      seq: ++flashSeq.current,
      name: last.player.name,
      position: last.player.position,
      nflTeam: last.player.nflTeam,
      byeWeek: last.player.byeWeek,
      team: last.currentOwner.name,
      label: last.label,
      duplicate: view.slots.filter((slot) => slot.player?.id === last.player!.id).length > 1,
      headshotUrl: player?.headshotUrl,
    });
  }, [pool, view]);

  /**
   * Replaces what is on screen with what the server actually has saved, and
   * says so. Reached only after something failed, so the room is never left
   * reading a pick that did not land as though it had.
   */
  const resync = useCallback(async (ticket: number) => {
    try {
      const res = await fetch("/api/draft/state", { cache: "no-store" });
      const data = (await res.json()) as ApiResponse;
      if (ticket !== inFlight.current) return;
      if (!data.view) return;
      setView(data.view);
      setError((prev) =>
        `${prev ? `${prev} ` : "That pick did not save. "}` +
        "The board below is what is saved — re-enter it.",
      );
    } catch {
      setError("Lost contact with the app. Stop entering picks and reload this page.");
    }
  }, []);

  /**
   * A pick landed somewhere else. Take the board and nothing else.
   *
   * Unlike `resync` this is silent: it is the normal case, not a failure, and an
   * error banner every time another manager drafts would train the room to
   * ignore the banner that matters. Nothing about the typing state is touched,
   * so a remote pick arriving mid-name costs no keystrokes.
   *
   * Two guards, both about not fighting the local operator:
   *
   *   `busy` — a local pick is already in the air, so this fetch would only
   *   race it. It is DEFERRED rather than dropped: the local response was
   *   computed by the server from whatever it read, which on a store the remote
   *   pick has already reached is fine and on one it has not is a board missing
   *   a pick that nothing will come back for. The latch makes `send` fetch once
   *   on its way out, which costs one request per collision and cannot lose an
   *   event.
   *
   *   the ticket — a local pick STARTED while this fetch was in the air. That
   *   response is newer than this one by definition, so this one is dropped.
   *   Deliberately reads `inFlight.current` without incrementing it: taking a
   *   ticket here would invalidate the in-flight local mutation and leave `busy`
   *   stuck on, which is the board refusing to accept picks.
   */
  const pullRemote = useCallback(async () => {
    if (busyRef.current) {
      pendingRemote.current = true;
      return;
    }
    // Cleared on the way in, not on the way out: an event arriving during the
    // fetch below wants another fetch after it, and clearing at the end would
    // swallow that one instead.
    pendingRemote.current = false;
    const ticket = inFlight.current;
    try {
      const res = await fetch("/api/draft/state", { cache: "no-store" });
      const data = (await res.json()) as ApiResponse;
      if (ticket !== inFlight.current) return;
      if (data.view) setView(data.view);
    } catch {
      /*
       * Swallowed on purpose. A dropped poll is not news — the socket or the
       * next poll will bring the board along. The failure that DOES need saying
       * is a pick that would not save, and `send` says it.
       */
    }
  }, []);

  const liveStatus = useDraftLiveSync({ enabled: sharedSaves, onChanged: pullRemote });

  /**
   * Every mutation: show the predicted board at once, then reconcile with the
   * server. `inFlight` makes the newest response win so a slow reply cannot
   * overwrite a board that has moved on.
   */
  const send = useCallback(
    async (url: string, body: unknown, predicted: DraftRoomView | null) => {
      const ticket = ++inFlight.current;
      if (predicted) setView(predicted);
      setBusy(true);
      busyRef.current = true;
      setError(null);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as ApiResponse;
        if (ticket !== inFlight.current) return;
        if (data.view) setView(data.view);
        if (!data.ok) {
          // Announcing a name the board did not keep is worse than announcing
          // nothing, so the flash comes down with the pick.
          setFlash(null);
          setError(data.error ?? "The board refused that.");
          // A refusal that carries no board — a save that failed outright —
          // leaves the predicted pick sitting on screen looking drafted, which
          // is the one thing this board must never show. Go and get the truth.
          if (!data.view) await resync(ticket);
        }
      } catch {
        // An optimistic pick must never sit on screen looking saved when it is
        // not. Pull the real board back.
        if (ticket !== inFlight.current) return;
        setFlash(null);
        setError("Could not save that pick. Re-reading the saved board…");
        await resync(ticket);
      } finally {
        /*
         * Only the newest mutation clears `busy` — a superseded response must
         * not report the board idle while its replacement is still in the air.
         * Which also makes this the right place to collect a remote pick the
         * latch caught: a superseded response leaves the latch set and the
         * mutation that superseded it collects instead, so exactly one fetch
         * happens and it happens last.
         */
        if (ticket === inFlight.current) {
          setBusy(false);
          busyRef.current = false;
          if (pendingRemote.current) void pullRemote();
        }
      }
    },
    [pullRemote, resync],
  );

  const commit = useCallback(
    (player: ClientPlayer, override: boolean) => {
      if (!targetSlot) return;
      setAimedSlotId(null);
      void send(
        "/api/draft/pick",
        { slotId: targetSlot.id, playerId: player.id, override },
        optimisticPick(view, targetSlot.id, {
          id: player.id,
          name: player.name,
          position: player.position,
          nflTeam: player.nflTeam,
          byeWeek: player.byeWeek,
        }),
      );
    },
    [send, targetSlot, view],
  );

  /**
   * Takes back the last thing that happened. Usually that is the pick entered
   * most recently; on a board a reset emptied it is the reset, and the whole
   * wiped draft comes back.
   */
  const undo = useCallback(() => {
    // Kill the announcement on the way past, so the room is never left reading
    // a name that has just been taken back off the board.
    setFlash(null);

    const last = view.lastPick;
    if (!last) {
      const wiped = view.restorable;
      if (!wiped) {
        setNotice("Nothing to undo.");
        return;
      }
      // Nothing is predicted for a restore: the wiped picks are held on the
      // server and this browser was never told what they were. It arrives whole
      // on the reply rather than in two stages.
      setNotice(`Putting back the ${wiped.pickCount} picks that were cleared…`);
      void send("/api/draft/undo", {}, null);
      return;
    }

    setNotice(`Undid ${last.label} — ${last.player?.name}`);
    void send("/api/draft/undo", {}, optimisticUndo(view, last.id));
  }, [send, view]);

  /**
   * Removes ONE entered pick, wherever it is on the board.
   *
   * This is the correction path, and it is not undo: undo unwinds the pick
   * entered last, which is no help at all when the wrong name went in six picks
   * ago and five good picks are sitting on top of it. The server route is the
   * same one, told which slot to clear rather than left to work it out.
   *
   * The cursor stays on the cell it just emptied, because the reason a pick is
   * deleted is almost always that the right name is about to be typed into that
   * exact slot. He deletes, types, and the correction is done without ever
   * aiming again.
   */
  const deletePick = useCallback(
    (slot: LiveSlot) => {
      setPickMenu(null);
      setFlash(null);
      setAimedSlotId(slot.id);
      setNotice(`Deleted ${slot.label} — ${slot.player?.name}. Type a name to refill it.`);
      void send("/api/draft/undo", { slotId: slot.id }, optimisticUndo(view, slot.id));
    },
    [send, view],
  );

  /**
   * Moves the cursor one cell in the direction pressed — as the board is DRAWN,
   * not as the draft runs.
   *
   * This first stepped through pick order, which reads well on paper and badly
   * on a snake board: the order runs right-to-left through every even round, so
   * pressing ← walked the cursor visibly right on half the grid. An arrow key is
   * read as a direction on the thing you are looking at, and the thing being
   * looked at is a grid of franchises down and rounds across.
   *
   * So ← and → change franchise within the round, ↑ and ↓ change round within
   * the franchise's column, and the edges of the board simply stop it.
   */
  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      if (!cursorSlot) return;
      let round = cursorSlot.round;
      let column = cursorSlot.column;
      // Keepers are not his to act on, so the cursor steps OVER them and
      // carries on rather than stopping on a cell where every key is inert.
      for (;;) {
        round += dy;
        column += dx;
        if (round < 1 || round > view.rounds) return;
        if (column < 1 || column > view.teamCount) return;
        const next = view.slots.find(
          (s) => s.round === round && s.column === column,
        );
        if (!next) return;
        if (next.fill === "keeper") continue;
        setAimedSlotId(next.id === view.onTheClockSlotId ? null : next.id);
        return;
      }
    },
    [cursorSlot, view.onTheClockSlotId, view.rounds, view.slots, view.teamCount],
  );

  /**
   * Tab, and ⌘B. Cycles rather than swapping now that there are three: with the
   * board first, one press is always "off the grid" and a third press is always
   * back on it, which is the only move the operator makes under pressure.
   */
  const toggleSurface = useCallback(
    () =>
      setSurface((s) => SURFACES[(SURFACES.indexOf(s) + 1) % SURFACES.length]),
    [],
  );

  const typing = useDraftTyping<ClientPlayer>({
    pool,
    draftedIds,
    enabled: !busy && targetSlot !== null,
    // Separate from `enabled`, which is also false whenever the cursor is on an
    // entered pick — where ⌘Z must still work. This is only about a save being
    // in the air, and it is the same `busy` the header's two buttons use.
    busy,
    holderOf,
    onCommit: commit,
    onUndo: undo,
    onMoveCursor: moveCursor,
    /*
     * Escape already means "stop aiming out of order and follow the clock
     * again", which is the same sentence a suspended board needs to hear. So it
     * resumes following too: no new key, and it is already in his fingers.
     */
    onClearAim: () => {
      setAimedSlotId(null);
      follow.resume();
    },
    onToggleView: toggleSurface,
    // Nothing is deletable mid-save: a delete armed against a board that is
    // still settling would name one pick and remove whatever landed in its
    // place. It comes back the moment the write returns.
    deletable: busy ? null : deletableSlot,
    onDelete: deletePick,
  });

  /**
   * The roster behind the cell the cursor is on, for the side pane. Derived from
   * the same view the grid draws, so it can never disagree with the board.
   *
   * It follows the cursor rather than the clock, so parking on an old pick to
   * check it also answers the question that usually comes next — what else that
   * franchise has.
   */
  const cursorLineup = useMemo(() => {
    if (!cursorSlot) return null;
    const lineups = buildFranchiseLineups(view, projectedPoints);
    return lineups.find((l) => l.team.id === cursorSlot.currentOwner.id) ?? null;
  }, [cursorSlot, projectedPoints, view]);

  /*
   * Flat `bg-background`, deliberately *without* `bg-canvas` — the board is the
   * one surface that drops the app's texture.
   *
   * The overlay is opaque and covers the body, so it used to redraw the canvas
   * grid and washes to match the rest of the app. That stopped making sense once
   * the cells became opaque at the same value: the texture then only showed
   * through the ~5px seams between cells, which read as faintly lit gaps in the
   * grid rather than as a surface. The ambient washes also put a cyan gradient
   * behind an actual 160-cell grid, which is texture competing with data.
   */
  return (
    /*
     * `h-[100dvh]` over the top of `inset-0`, which is what a phone needs and
     * what nothing else notices: `inset-0` resolves against the LARGE viewport,
     * so on a mobile browser the bottom of the board sits underneath the URL
     * bar. `dvh` is the viewport as it currently stands, and on any desktop it
     * is identical to `100vh`.
     */
    <div className="bg-background text-foreground fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden touch:pb-12 portrait:touch:pb-[3.75rem]">
      <FlashStyles />

      <Header
        view={view}
        targetSlot={targetSlot}
        selectedPick={deletableSlot}
        aimed={parkedOffClock}
        onUndo={undo}
        onDeleteSelected={deletableSlot ? () => deletePick(deletableSlot) : undefined}
        busy={busy}
        tvMode={fullscreen}
        onToggleTvMode={toggleTvMode}
        fit={fit}
        onToggleFit={toggleFit}
        surface={surface}
        onSurfaceChange={setSurface}
        paneOpen={paneOpen}
        onTogglePane={() => setPaneOpen((p) => !p)}
        liveStatus={liveStatus}
        stateFile={stateFile}
        lineup={cursorLineup}
        cursorSlot={cursorSlot}
      />

      {(error || notice || view.conflicts.length > 0) && (
        <div className="shrink-0">
          {error && (
            <Strip tone="destructive" onDismiss={() => setError(null)}>
              {error}
            </Strip>
          )}
          {view.conflicts.map((c) => (
            <Strip key={`${c.kind}-${c.slotId}`} tone="warning">
              {c.message}
            </Strip>
          ))}
          {notice && <Strip tone="muted">{notice}</Strip>}
        </div>
      )}

      {/*
        The grid and the pane share one row. The grid is `flex-1 min-w-0` and the
        pane is a fixed `shrink-0` width, so the pane never grows and the grid
        takes everything else.
      */}
      <div className="flex min-h-0 min-w-0 flex-1">
        {surface === "board" ? (
          <>
            <BoardGrid
              slots={view.slots}
              teams={view.teams}
              rounds={view.rounds}
              teamCount={view.teamCount}
              aimedId={parkedOffClock ? cursorSlotId : null}
              /*
               * The ACTIVE cell falls back to the real clock while the cursor is
               * parked on an entered pick. The room is still reading this board
               * to see whose turn it is, and inspecting an old pick is not a
               * reason to take that off the screen.
               */
              targetSlotId={targetSlot?.id ?? view.onTheClockSlotId}
              onAim={(slotId) =>
                setAimedSlotId(slotId === view.onTheClockSlotId ? null : slotId)
              }
              onPickMenu={(slot, x, y) =>
                // Clamped here rather than in the menu: this is the only place
                // that knows the viewport at the moment of the click.
                setPickMenu({
                  slot,
                  x: Math.min(x, window.innerWidth - 260),
                  y: Math.min(y, window.innerHeight - 160),
                })
              }
              boardRef={boardRef}
              fit={fit}
            />
            {paneOpen && (
              <div className="mr-[0.5vw] my-[0.5vh] flex min-h-0">
                <OnTheClockRoster
                  lineup={cursorLineup}
                  slot={cursorSlot}
                  eyebrow={deletableSlot ? "Selected pick" : "On the clock"}
                />
              </div>
            )}
          </>
        ) : surface === "picks" ? (
          <PickList view={view} />
        ) : (
          <RosterWall view={view} projectedPoints={projectedPoints} />
        )}
      </div>

      {tvMode && surface === "board" && follow.suspended && (
        <FollowPill
          label={cursorSlot?.label ?? null}
          seconds={follow.resumeIn}
          onResume={follow.resume}
        />
      )}

      <TvSafeAreaOverlay tvMode={tvMode} />
      <BoardReadout tvMode={tvMode} />

      {/*
        Below the typing overlay in the stack and inert to the pointer, so it
        can never be the reason a keystroke or a click goes missing.
      */}
      {flash && <FlashOverlay key={flash.seq} flash={flash} />}

      {typing.query.length > 0 && !typing.pendingDuplicate && (
        <MatchOverlay<ClientPlayer>
          query={typing.query}
          matches={typing.matches}
          selected={typing.selected}
          holderOf={holderOf}
          onPick={typing.attempt}
        />
      )}

      {/*
        A phone has no keyboard for the document to capture, so without this
        there is no way to enter a pick from one at all. Renders on coarse
        pointers only — it does not exist on the laptop the board is run from.
      */}
      <TouchPickBar
        query={typing.query}
        onQuery={typing.setQuery}
        enabled={targetSlot !== null && !busy}
        waitingOn={deletableSlot ? "A pick you have selected" : null}
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

      {typing.pendingDelete && <DeletePickWarning slot={typing.pendingDelete} />}

      {pickMenu && (
        <PickMenu
          slot={pickMenu.slot}
          x={pickMenu.x}
          y={pickMenu.y}
          busy={busy}
          onDelete={() => deletePick(pickMenu.slot)}
          onClose={() => setPickMenu(null)}
        />
      )}
    </div>
  );
}

// --- Header -----------------------------------------------------------------

function Header({
  view,
  targetSlot,
  selectedPick,
  aimed,
  onUndo,
  onDeleteSelected,
  busy,
  tvMode,
  onToggleTvMode,
  fit,
  onToggleFit,
  surface,
  onSurfaceChange,
  paneOpen,
  onTogglePane,
  liveStatus,
  stateFile,
  lineup,
  cursorSlot,
}: {
  view: DraftRoomView;
  targetSlot: LiveSlot | null;
  /** An entered pick the cursor is parked on, which Delete would remove. */
  selectedPick: LiveSlot | null;
  aimed: boolean;
  onUndo: () => void;
  onDeleteSelected?: () => void;
  busy: boolean;
  tvMode: boolean;
  onToggleTvMode: () => void;
  fit: boolean;
  onToggleFit: () => void;
  surface: Surface;
  onSurfaceChange: (next: Surface) => void;
  paneOpen: boolean;
  onTogglePane: () => void;
  liveStatus: LiveStatus;
  stateFile: string;
  /** For the phone's roster drawer, which stands in for the side pane. */
  lineup: FranchiseLineup | null;
  cursorSlot: LiveSlot | null;
}) {
  /*
   * A wipe undo can still take back. Only ever offered on an empty board: with
   * a pick sitting there, that pick is what undo takes, and one button cannot
   * honestly advertise both.
   */
  const wiped = view.lastPick ? null : view.restorable;

  return (
    /*
     * One compact bar rather than a full-height masthead: the design spends the
     * reclaimed vertical space on the grid, which is what has to fit.
     * Accent-outlined so the room can find the state line without hunting.
     */
    /*
     * WHY THIS WRAPS ON A PHONE HELD UPRIGHT, AND ONLY THEN.
     *
     * One row is right on every screen this board was built for. At 412px it
     * was catastrophic: the state line below is a run of inline spans naming
     * the man, his franchise and the pick, and with nowhere to go it wrapped to
     * eight lines and stood the bar up 228px tall — a quarter of the phone
     * gone before a single cell of the board.
     *
     * So on a narrow screen the state line takes a row of its own and truncates
     * to one line, and everything that is not a control the room needs on a
     * phone — the wordmark, TV mode, the printer — steps out. That is `max-md`
     * throughout, which is width and not orientation: a phone turned sideways
     * is 915px wide, sits above the breakpoint, and keeps the desktop bar it
     * already renders correctly at 31px.
     */
    <header className="bg-board-base border-live mx-[0.5vw] mt-[0.5vh] flex shrink-0 items-center gap-[1.2vw] rounded-lg border-[0.08vw] px-[0.7vw] py-[0.55vh] max-md:mx-1 max-md:mt-1 max-md:flex-wrap max-md:gap-0.5 max-md:px-1 max-md:py-1">
      <div className="flex min-w-0 shrink-0 items-center gap-[0.8vw] max-md:hidden">
        <Image
          src="/brand/crest-v2-256.png"
          alt=""
          width={58}
          height={64}
          className="h-[2.4vh] w-[2.4vh] shrink-0 rounded object-contain max-md:h-4 max-md:w-4"
          priority
        />
        <span className="text-[clamp(0.6rem,0.94vw,1.2rem)] font-black tracking-[0.03em] whitespace-nowrap [@media(max-height:520px)]:hidden">
          {LEAGUE.name.toUpperCase()}
        </span>
      </div>

      <ViewToggle view={surface} onChange={onSurfaceChange} options={SURFACES} />

      {/*
        TWO LINES ARE RESERVED WHETHER OR NOT THE SECOND ONE IS USED.

        The state line is the widest thing in this bar and its width depends on
        what the cursor is sitting on: a traded pick adds "TRADED FROM ZACH",
        and a long franchise name pushes it further. At 1920x1080 it wants 667px
        and gets 635px, so it wraps — and the bar is `shrink-0` in a flex column
        above the board, so the board's scroll viewport LOST 9.7px every time
        the cursor moved onto a traded pick and got it back on the way off. At
        1280x720 the same move is 21.8px. Twenty-nine of this league's 160 picks
        are traded, so that is the grid stepping up and down all night on the
        one screen ten people are watching.

        Reserving the taller height costs nothing that is visible: the board
        already scrolls, so ten pixels of viewport become ten pixels of scroll
        range rather than a round nobody can reach. The alternative — forcing
        one line — either clips the franchise name or shrinks the type the room
        reads the clock off, and both are worse than empty space.

        `3em` against this element's own font size, which is the same clamp the
        spans inside it use, so the reservation tracks the type at every
        viewport instead of being a pixel guess at one of them. Above ~2560px
        the line fits on its own and the reservation is simply never reached.

        md and up only. On a phone the state line takes a row of its own and
        truncates to one line — see the note on the bar — so there is no second
        line to reserve and the space would come off a 412px screen.
      */}
      <div className="min-w-0 flex-1 text-right max-md:order-last max-md:w-full max-md:flex-none max-md:basis-full max-md:truncate max-md:text-left max-md:text-[10px] max-md:leading-[1.3] md:flex md:min-h-[3em] md:items-center md:justify-end md:text-[clamp(0.55rem,0.834vw,1.05rem)]">
        {selectedPick ? (
          /*
           * The cursor is on an entered pick rather than on a cell waiting for a
           * name. Saying so in the same place the clock is normally announced —
           * and in the destructive hue — is what stops the operator typing the
           * next name expecting it to land here.
           */
          <span className="text-[clamp(0.55rem,0.834vw,1.05rem)] font-extrabold">
            <span className="text-muted-foreground">SELECTED: </span>
            <span className="text-destructive font-black">
              {selectedPick.label} {selectedPick.player?.name?.toUpperCase()}
            </span>
            <span className="text-muted-foreground">
              {" "}
              ({selectedPick.currentOwner.name}) — Delete removes it
            </span>
          </span>
        ) : targetSlot ? (
          <span className="text-[clamp(0.55rem,0.834vw,1.05rem)] font-extrabold">
            <span className="text-muted-foreground">
              {aimed ? "OUT OF ORDER: " : "ON THE CLOCK: "}
            </span>
            {/*
              THE PERSON FIRST, the franchise second. The room shouts at a man,
              not at a team name, and half the franchise names are jokes that
              nobody maps back to their owner at a glance.
              The short handle, not the full name: "WITTE" and "KYLE" are what
              the league calls the two Kyles, and "ELBE" and "SCOTT" the two
              Scotts — the handles already disambiguate what full names do not.
            */}
            <span className="text-live font-black">
              {targetSlot.currentOwner.name.toUpperCase()}
            </span>
            <span className="text-muted-foreground">
              {" "}
              &middot; {targetSlot.currentOwner.franchiseName.toUpperCase()} (Pick{" "}
              {targetSlot.label})
            </span>
            {targetSlot.traded && (
              /* Says it in words. This read "VIA PI", which nobody decoded. */
              <span className="text-trade ml-[0.5vw] font-black">
                TRADED FROM {targetSlot.originalOwner.name.toUpperCase()}
              </span>
            )}
          </span>
        ) : (
          <span className="text-success text-[clamp(0.55rem,0.834vw,1.05rem)] font-black">
            THAT&apos;S THE DRAFT.
          </span>
        )}
      </div>

      {/*
        The design puts a pick clock here. This draft is run in person and
        nothing is auto-advanced, so the chip carries the one number the room
        actually asks for instead.
      */}
      <LiveDot status={liveStatus} stateFile={stateFile} />

      <div className="bg-live text-primary-foreground shrink-0 rounded px-[0.8vw] py-[0.35vh] text-[clamp(0.6rem,0.94vw,1.2rem)] font-black tabular-nums max-md:px-1.5 max-md:py-0.5 max-md:text-[11px]">
        {view.filled}
        <span className="opacity-70">/{view.totalPicks}</span>
      </div>

      <div className="flex shrink-0 items-center gap-[0.4vw] max-md:ml-auto max-md:gap-1">
        {/* The pane's replacement on a phone, where there is no room beside the
            grid for a permanent column. Only offered on the board, for the same
            reason the pane toggle is: the other two views are rosters already. */}
        {surface === "board" && (
          <OnTheClockRosterSheet
            lineup={lineup}
            slot={cursorSlot}
            eyebrow={selectedPick ? "Selected pick" : "On the clock"}
          />
        )}
        {/*
          Appears only while a pick is selected. Undo beside it is a different
          verb — it takes back the pick entered LAST — and two buttons that both
          read "remove something" would be picked between by guesswork, so the
          one that acts on a specific cell only exists while there is one.
        */}
        {onDeleteSelected && (
          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={busy}
            title={`Delete ${selectedPick?.label} — ${selectedPick?.player?.name} (Delete)`}
            className={cn(
              "border-destructive/60 text-destructive hover:bg-destructive/10 disabled:opacity-30 flex items-center justify-center gap-1 rounded border px-[0.6vw] py-[0.5vh] text-[clamp(0.6rem,0.8vw,1rem)] font-semibold max-md:px-2 max-md:text-[11px]",
              TAP,
            )}
          >
            <Trash2 className="h-[1em] w-[1em]" />{" "}
            <span className="max-md:hidden">Delete pick</span>
          </button>
        )}
        <button
          type="button"
          onClick={onUndo}
          disabled={busy || (!view.lastPick && !wiped)}
          title={
            view.lastPick
              ? `Undo the pick entered last — ${view.lastPick.label} ${view.lastPick.player?.name} (⌘Z)`
              : wiped
                ? `Put back the ${wiped.pickCount} picks the board was cleared of (⌘Z)`
                : "Nothing has been entered yet"
          }
          className={cn(
            "border-border/60 hover:bg-muted disabled:opacity-30 flex items-center justify-center gap-1 rounded border px-[0.6vw] py-[0.5vh] text-[clamp(0.6rem,0.8vw,1rem)] font-semibold max-md:px-2 max-md:text-[11px]",
            TAP,
          )}
        >
          {/*
            The word changes because the consequence does. After a wipe, a
            button reading "Undo" on a board showing nothing looks like it has
            nothing to act on, which is the moment the commissioner goes looking
            for a backup file instead of pressing it.
          */}
          <Undo2 className="h-[1em] w-[1em]" />{" "}
          <span className={wiped ? undefined : "max-md:hidden"}>
            {wiped ? `Restore ${wiped.pickCount}` : "Undo"}
          </span>
        </button>
        {surface === "board" && (
          <button
            type="button"
            onClick={onTogglePane}
            title={
              paneOpen
                ? "Hide the on-the-clock roster and give the space to the grid"
                : "Show the roster of whoever is on the clock"
            }
            className="border-border/60 hover:bg-muted hidden items-center rounded border px-[0.5vw] py-[0.5vh] lg:flex"
          >
            {paneOpen ? (
              <PanelRightClose className="h-[1.4vh] w-[1.4vh]" />
            ) : (
              <PanelRightOpen className="h-[1.4vh] w-[1.4vh]" />
            )}
            <span className="sr-only">
              {paneOpen ? "Hide roster pane" : "Show roster pane"}
            </span>
          </button>
        )}
        {/*
          SCROLL / FIT, and it says which one you are IN rather than which one
          the button would give you. Every other control in this bar is a verb —
          Undo, Delete pick, TV mode — and a two-state layout switch read as a
          verb is the one that gets pressed twice in front of the room.
        */}
        {surface === "board" && (
          <button
            type="button"
            onClick={onToggleFit}
            /*
             * THE ROUND COUNT IS THE BOARD'S, AND SCROLL'S IS NOT NAMED.
             *
             * This read "all sixteen rounds" and "eleven rounds" — the source
             * league's total and the count that fitted 1080p when it was
             * written. The total is now fifteen, so the first was simply
             * wrong on the screen the room is watching; and the second has no
             * fixed answer any more. What Scroll fits depends on the viewport
             * and on where the safe area's bottom edge has been put: at the
             * default band 1080p holds eleven, and two presses of ⌘⇧↓ hold all
             * fifteen at the same size. A tooltip that names a number the
             * board can disprove by being looked at is worse than one that
             * describes the trade.
             */
            title={
              fit
                ? `Showing all ${view.rounds} rounds at once, sized to fit. ` +
                  "Switch to Scroll for the board's full type size on the rounds around the pick (⌘⇧F)"
                : `Showing the rounds that fit at full size, following the pick. ` +
                  `Switch to Fit for all ${view.rounds} at once, smaller (⌘⇧F)`
            }
            className={cn(
              "border-border/60 hover:bg-muted flex items-center justify-center gap-1 rounded border px-[0.6vw] py-[0.5vh] text-[clamp(0.6rem,0.8vw,1rem)] font-semibold max-md:hidden",
              TAP,
            )}
          >
            {fit ? (
              <LayoutGrid className="h-[1em] w-[1em]" />
            ) : (
              <ScrollText className="h-[1em] w-[1em]" />
            )}
            {fit ? "Fit" : "Scroll"}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleTvMode}
          title={tvMode ? "Leave TV mode" : "TV mode — fill the whole screen"}
          className={cn(
            "border-border/60 hover:bg-muted flex items-center justify-center gap-1 rounded border px-[0.6vw] py-[0.5vh] text-[clamp(0.6rem,0.8vw,1rem)] font-semibold max-md:hidden",
            TAP,
          )}
        >
          {tvMode ? (
            <Minimize2 className="h-[1em] w-[1em]" />
          ) : (
            <Maximize2 className="h-[1em] w-[1em]" />
          )}
          TV mode
        </button>
        {/* Both step out on a phone: fullscreen is what a phone browser already
            is, and nobody prints a draft board from one. */}
        <Link
          href="/draft/export"
          target="_blank"
          title="Print or export the board"
          className="text-muted-foreground/50 hover:text-foreground p-1 max-md:hidden"
        >
          <Printer className="h-4 w-4" />
        </Link>
        <Link
          href="/"
          title="Leave the draft board"
          className={cn(
            "text-muted-foreground/40 hover:text-foreground flex items-center justify-center p-1",
            TAP,
          )}
        >
          <X className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}

/**
 * Whether picks are reaching the other boards, as a dot.
 *
 * ============================================================================
 * WHY THIS IS ALL THAT SURVIVED THE FOOTER
 * ============================================================================
 * The board used to end in a strip listing the keyboard grammar — Enter drafts,
 * ⌘Z undoes, arrows move, Tab toggles — plus a legend for the keeper padlock and
 * the traded-pick arrow. It went, on the grounds that it is self-explanatory,
 * and it was: nothing on it changed state, and a room that has watched two picks
 * entered has learnt all of it.
 *
 * This did not go with it, because it is not an instruction. It is the one fact
 * on the screen that a manager cannot work out by looking: whether the board
 * they are staring at is still being told about other people's picks. A stalled
 * board and a board where nobody has picked yet are pixel-identical, and the
 * whole point of the live sync is that a remote manager can trust the second
 * reading. Hover carries where picks are saved, which is the other thing there
 * is no way to infer.
 *
 * ============================================================================
 * AND WHY THERE IS STILL A CHIP ON THE FILE STORE
 * ============================================================================
 * No dot: there is no second device to hear from, so a status claiming
 * anything would be theatre. What replaces it is the one fact about the file
 * store that a laptop cannot show you and that the board's error messages only
 * mention on paths this failure does not take — WHERE THE BACKUPS ARE.
 *
 * `data/draft-state-2026.json` is a tracked file whose committed content is an
 * empty board. A `git checkout`, `stash` or `pull` touching the working tree
 * mid-draft therefore replaces N picks with a STRUCTURALLY VALID empty state:
 * nothing throws, `undoLast` has no restore point because the state that
 * carried it is the thing that was overwritten, and the two errors that name
 * `data/draft-backups/` are both parse failures that never fire. The board is
 * simply empty, and every save is sitting in a directory nothing on this
 * screen has ever mentioned.
 *
 * So the chip says there is a backup, and hover gives the directory and the
 * two steps. The word rather than the path, because the visible save location
 * was deliberately deleted from this board once already — see
 * `verify-footer-removal.mjs`, which asserts it stays gone — and a directory
 * name is reference material, not something the room reads from fifteen feet.
 * What the label has to do is be worth hovering over, and it is the one person
 * at the keyboard who can act on the answer.
 */
function LiveDot({
  status,
  stateFile,
}: {
  status: LiveStatus;
  stateFile: string;
}) {
  if (status === "off") {
    return (
      <span
        title={
          `Picks are saved to ${stateFile} on this laptop. Every save also drops a ` +
          `timestamped copy in data/draft-backups/ — if this board ever comes back ` +
          `empty, copy the newest file from there over ${stateFile} and reload.`
        }
        className="text-muted-foreground/70 hidden shrink-0 items-center gap-[0.35vw] text-[clamp(0.55rem,0.78vw,0.95rem)] lg:flex"
      >
        <span className="bg-muted-foreground/40 h-[0.5em] w-[0.5em] rounded-full" />
        backed up
      </span>
    );
  }

  const [dot, label] =
    status === "live"
      ? ["bg-success", "live"]
      : status === "polling"
        ? // Named for what the room can act on, not for the websocket being down.
          ["bg-warning", "syncing slowly"]
        : ["bg-muted-foreground/40", "connecting"];

  return (
    <span
      title={`Picks are saved to ${stateFile} and shared with every open board.`}
      className="text-muted-foreground/70 flex shrink-0 items-center gap-[0.35vw] text-[clamp(0.55rem,0.78vw,0.95rem)]"
    >
      <span className={`${dot} h-[0.5em] w-[0.5em] rounded-full`} />
      {label}
    </span>
  );
}

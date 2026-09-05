"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { SafeArea } from "@/lib/board-legibility";

/**
 * The board scrolls itself, so nobody has to stand at the keyboard doing it.
 *
 * 1080p holds eleven of sixteen rounds at a size the back of the room can read,
 * which means the board scrolls — and until now a human scrolled it, every
 * round, all night. That is the whole of what this replaces.
 *
 * ============================================================================
 * IT FOLLOWS THE CURSOR, NOT THE CLOCK
 * ============================================================================
 * `onTheClockSlotId` is the clock; `cursorSlot` is the clock UNLESS the
 * operator has deliberately arrow-keyed somewhere else. Following the cursor is
 * the right choice because the projector and the keyboard are the same machine:
 * when he walks back to round 3 to argue about a pick, the room has to see the
 * thing being argued about. The cursor clears itself on every commit and on
 * Escape, so it comes back to the clock without anyone asking it to.
 *
 * ============================================================================
 * IT FOLLOWS THE ROUND, NOT THE CELL
 * ============================================================================
 * Depending on `activeRound` rather than on the slot id is what makes this calm
 * by construction. Nine picks in ten happen inside a round that is already on
 * screen, and a board that re-aims on every one of them is a board that twitches
 * ten times a round in front of ten people. Rows carry `data-round` and have
 * stable height, so the round is a thing that can be measured.
 *
 * ============================================================================
 * WHERE IT PARKS, AND WHY NOT THE MIDDLE
 * ============================================================================
 * The active round's TOP EDGE goes 30% down the band. With about nine rounds in
 * the default band that is two rounds of history above and six upcoming below.
 * "Who's up next" is the question the room asks out loud, and next is below —
 * centring would spend three rows on history nobody asked about. Pinning to the
 * top edge instead would make the board jolt against a hard stop every round.
 */

/** The board's own curve, the one `FLASH_CSS` uses. Not the browser's. */
const EASE = [0.16, 1, 0.3, 1] as const;
/**
 * Short enough to be over before the eye leaves the announcement, long enough
 * not to read as a jump cut. `behavior: "smooth"` was the alternative and its
 * duration is not configurable: Chromium spends about 500ms on a long distance,
 * which on a twelve-foot screen reads as the board FALLING.
 */
const FOLLOW_MS = 360;
/** How far down the band the active round's top edge lands. */
const PARK = 0.3;
/**
 * The dead zone, as an inset on each end of the band. A round already sitting
 * inside the middle 80% is left exactly where it is — this is the general form
 * of the `block: "nearest"` intent the old scroll effect had.
 */
const DEAD_INSET = 0.1;
/**
 * Long enough to scroll back to round 3, look at it and say something about it.
 * Short enough that nobody has to remember to switch following back on — which
 * matters more, because a board that has silently stopped following is the exact
 * failure this whole feature exists to prevent.
 */
const SUSPEND_MS = 8000;

/** cubic-bezier(0.16, 1, 0.3, 1), solved for y at a given x. */
function ease(x: number): number {
  const [x1, y1, x2, y2] = EASE;
  const curve = (a: number, b: number, t: number) =>
    3 * a * (1 - t) * (1 - t) * t + 3 * b * (1 - t) * t * t + t * t * t;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let i = 0; i < 20; i++) {
    const at = curve(x1, x2, t);
    if (at < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return curve(y1, y2, t);
}

export type BoardFollow = {
  /** True while a manual scroll has the board parked where he left it. */
  suspended: boolean;
  /** Whole seconds until it resumes on its own, for the pill's countdown. */
  resumeIn: number;
  /** The pill's click, and Escape's spare meaning. */
  resume: () => void;
};

export function useBoardFollow({
  boardRef,
  activeRound,
  enabled,
  safe,
}: {
  boardRef: React.RefObject<HTMLElement | null>;
  /** The round the cursor is on. Null when the draft is over. */
  activeRound: number | null;
  /** TV mode, and the board actually being the surface on screen. */
  enabled: boolean;
  safe: SafeArea;
}): BoardFollow {
  const [suspendedAt, setSuspendedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const frame = useRef(0);

  const resume = useCallback(() => setSuspendedAt(null), []);

  /*
   * SUSPENSION IS DETECTED FROM INPUT, NEVER FROM `scroll`.
   *
   * A `scroll` listener fires from this hook's own tween, from a viewport
   * resize, and from the browser restoring a position after a re-render — so it
   * would suspend following at the exact moments following was working. What is
   * actually being asked is "did a person do that", and only an input event can
   * answer it. All four keys below are unbound on this board and stay unbound:
   * they do the browser's own scrolling, and this notices.
   */
  useEffect(() => {
    const board = boardRef.current;
    if (!board || !enabled) return;
    const touched = () => {
      setSuspendedAt(Date.now());
      setNow(Date.now());
    };
    const onKey = (event: KeyboardEvent) => {
      if (["PageUp", "PageDown", "Home", "End"].includes(event.key)) touched();
    };
    board.addEventListener("wheel", touched, { passive: true });
    board.addEventListener("touchmove", touched, { passive: true });
    board.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKey);
    return () => {
      board.removeEventListener("wheel", touched);
      board.removeEventListener("touchmove", touched);
      board.removeEventListener("keydown", onKey);
      window.removeEventListener("keydown", onKey);
    };
  }, [boardRef, enabled]);

  /* Ticks only while suspended, so the pill can count down and then stop. */
  useEffect(() => {
    if (suspendedAt == null) return;
    const timer = setInterval(() => {
      const elapsed = Date.now() - suspendedAt;
      if (elapsed >= SUSPEND_MS) setSuspendedAt(null);
      else setNow(Date.now());
    }, 250);
    return () => clearInterval(timer);
  }, [suspendedAt]);

  const suspended = suspendedAt != null;

  useEffect(() => {
    if (!enabled || suspended || activeRound == null) return;
    const board = boardRef.current;
    if (!board) return;
    const row = board.querySelector<HTMLElement>(`[data-round="${activeRound}"]`);
    if (!row) return;

    const boardBox = board.getBoundingClientRect();
    const header = board.firstElementChild?.getBoundingClientRect();
    /*
     * The band in WINDOW coordinates, because that is what the safe area is
     * about — inches of wall, not offsets inside a scroll box. Its top is the
     * safe edge or the bottom of the sticky franchise header, whichever is
     * lower: a round parked under that header is as unreadable as one on the
     * floor, and the header is what `SCROLL_CLEARANCE` used to be dodging.
     */
    const bandTop = Math.max(
      window.innerHeight * (safe.top / 100),
      header?.bottom ?? boardBox.top,
    );
    const bandBottom = window.innerHeight * (safe.bottom / 100);
    const bandHeight = bandBottom - bandTop;
    if (bandHeight <= 0) return;

    const rect = row.getBoundingClientRect();
    const inset = bandHeight * DEAD_INSET;
    if (rect.top >= bandTop + inset && rect.bottom <= bandBottom - inset) return;

    const max = board.scrollHeight - board.clientHeight;
    const to = Math.max(
      0,
      Math.min(max, board.scrollTop + rect.top - (bandTop + PARK * bandHeight)),
    );
    const from = board.scrollTop;
    if (Math.abs(to - from) < 1) return;

    cancelAnimationFrame(frame.current);
    /*
     * A long jump is cut rather than swept. It is the resume-from-round-3 case
     * or the first paint after a reload, and a cut is over before anyone
     * registers it where a half-screen sweep drags every eye in the room off
     * whatever was just announced. Reduced motion takes the same branch, which
     * is the same branch `FLASH_CSS` takes.
     */
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || Math.abs(to - from) > bandHeight / 2) {
      board.scrollTop = to;
      return;
    }

    const started = performance.now();
    const step = (at: number) => {
      const t = Math.min(1, (at - started) / FOLLOW_MS);
      board.scrollTop = from + (to - from) * ease(t);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [activeRound, boardRef, enabled, safe.bottom, safe.top, suspended]);

  return {
    suspended,
    resumeIn:
      suspendedAt == null
        ? 0
        : Math.max(0, Math.ceil((SUSPEND_MS - (now - suspendedAt)) / 1000)),
    resume,
  };
}

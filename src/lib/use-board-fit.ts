"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import { BOARD_FIT_KEY } from "@/lib/board-legibility";

/**
 * SCROLL or FIT — the two things the room means by "show me the board".
 *
 * "Is there a way to toggle the draft board to fit to screen??? Like Scrollable
 * / Fit to screen toggle while on TV mode?" They are two different questions
 * about the same grid and no single size answers both:
 *
 *   SCROLL is for reading from the table. Every round it can fit at the size
 *   that clears the arcminute floor from eighteen feet, and the board follows
 *   the pick so that nobody has to drive it. This is the DEFAULT, because it is
 *   the legible one and it is what somebody who touches nothing should get.
 *
 *   FIT is for standing up and looking at the whole draft. Every round at once,
 *   at whatever size dividing the band by that many leaves, which at 1080p is
 *   about two thirds of Scroll's and under the comfortable floor. That is the
 *   honest trade and it is his to make, so `scripts/verify-tv-follow.mjs`
 *   PRINTS the arcminutes Fit actually produces rather than this refusing to
 *   render it.
 *
 * HOW MANY ROUNDS SCROLL FITS IS NOT A CONSTANT, and this used to say eleven.
 * It depends on the viewport and on where the safe area's bottom edge is: at
 * 1920x1080 the default 72% band holds eleven of the fifteen, and moving the
 * edge to 94% — eleven presses of ⌘⇧↓, which is what a television wants and a
 * floor-to-ceiling projector does not — holds all fifteen at Scroll's full
 * size, with nothing to scroll and nothing given up. Worth knowing before
 * reaching for Fit: on a screen with no unreadable bottom edge, Fit is a trade
 * that may not need making.
 *
 * ⌘⇧F, and nothing else claims it: `useDraftTyping` discards every ⌘/Ctrl/Alt
 * chord but ⌘Z, ⌘B and ⌘K; the density control owns ⌘⇧− / ⌘⇧= / ⌘⇧0; the safe
 * area owns ⌘⇧↑ / ⌘⇧↓, their ⌥ versions, and ⌘⌥0. Chrome binds ⌘F to find and
 * leaves ⌘⇧F alone on every platform this runs on, and it is preventDefault'd
 * either way.
 *
 * Persisted for the reason the density is: the choice gets made once in the
 * room, and a refresh at pick 90 must not drop him into the other layout in
 * front of everybody. `localStorage` and not draft state — which of two layouts
 * this screen is showing is nobody else's business, least of all a remote
 * manager's laptop.
 *
 * A module store rather than one hook's `useState`, for the reason set out on
 * `use-safe-area.ts`: several things need the answer and only one of them
 * should be listening for the key.
 */

let current = false;
let loaded = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;
const serverSnapshot = () => false;

function set(next: boolean) {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function hydrate() {
  if (loaded) return;
  loaded = true;
  try {
    set(window.localStorage.getItem(BOARD_FIT_KEY) === "1");
  } catch {
    /* Private browsing. The board opens in Scroll, which is the default. */
  }
}

export function useBoardFit(): {
  fit: boolean;
  toggle: () => void;
  reset: () => void;
} {
  const fit = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(hydrate, []);

  const write = useCallback((next: boolean) => {
    set(next);
    try {
      window.localStorage.setItem(BOARD_FIT_KEY, next ? "1" : "0");
    } catch {
      /* It still switches; it just forgets. */
    }
  }, []);

  const toggle = useCallback(() => write(!current), [write]);
  /** Back to Scroll, which is what shipped. Part of the one-key reset. */
  const reset = useCallback(() => write(false), [write]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  return { fit, toggle, reset };
}

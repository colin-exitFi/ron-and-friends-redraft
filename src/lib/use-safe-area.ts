"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  SAFE_AREA_KEY,
  SAFE_AREA_STEP,
  SAFE_BOTTOM_DEFAULT,
  SAFE_TOP_DEFAULT,
  clampSafeArea,
  type SafeArea,
} from "@/lib/board-legibility";

/**
 * Where the readable part of the projected image starts and stops, in the room.
 *
 * The screen is floor-to-ceiling and its bottom edge is at floor level, below
 * every sightline at a bar-height table. What fraction of it is actually usable
 * is not knowable from here: it depends on the throw, the table, and where the
 * ten of them end up sitting. So it is two numbers the commissioner sets with
 * the keyboard while looking at the screen, and the board follows them.
 *
 *   ⌘⇧↑ / ⌘⇧↓   move the BOTTOM edge — the one that matters
 *   ⌘⌥↑ / ⌘⌥↓   move the TOP edge, which is 0 until a projector needs otherwise
 *   ⌘⌥0         both back to their defaults
 *
 * ⌘⇧0 is the density control's reset and stays that way, so the safe area's
 * reset takes the ⌥ chord its top-edge keys already use. The arrow points at
 * where the line goes, which is the whole mnemonic there is to learn.
 *
 * `localStorage`, NOT THE DRAFT STATE. This is a property of a display, not of
 * the league. Putting it in `data/draft-state-2026.json` would push the golf
 * simulator's geometry down the live sync and onto two remote managers' laptops,
 * where a 28% dead band at the bottom of a MacBook is simply a bug.
 *
 * A MODULE-LEVEL STORE rather than one hook's `useState`, because five things
 * read these two numbers — the grid's spacers, the sticky header, the follow
 * effect, the pick announcement and the typing overlay — and only one of them
 * should be listening for the keys. `useSyncExternalStore` gives every reader
 * the same value with one listener between them; `useSafeAreaKeys` is what
 * installs the chords, and it is mounted once per surface.
 *
 * READ FROM STORAGE IN AN EFFECT, NEVER DURING RENDER, so the server and the
 * client agree about the first paint. One consequence is load-bearing on the
 * follow effect: there is exactly one frame at the default before the stored
 * value lands, which is why the first scroll of a fresh page is instant rather
 * than tweened. A 360ms sweep from a band the room never saw reads as the board
 * losing its place.
 */

const DEFAULT: SafeArea = { top: SAFE_TOP_DEFAULT, bottom: SAFE_BOTTOM_DEFAULT };

/** Bumped on every adjustment, so the overlay can hold itself up and fade. */
type Snapshot = SafeArea & { seq: number };

let current: Snapshot = { ...DEFAULT, seq: 0 };
let loaded = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const SERVER: Snapshot = { ...DEFAULT, seq: 0 };
const snapshot = () => current;
const serverSnapshot = () => SERVER;

function hydrate() {
  if (loaded) return;
  loaded = true;
  try {
    const saved = window.localStorage.getItem(SAFE_AREA_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved) as Partial<SafeArea>;
    const next = clampSafeArea(parsed);
    if (next.top === current.top && next.bottom === current.bottom) return;
    current = { ...next, seq: current.seq };
    emit();
  } catch {
    /* Unparseable, or Safari private browsing refusing to read. The default is
       a perfectly good band; forgetting one is better than not drawing one. */
  }
}

/** `moved` is the edge the operator asked for; see `clampSafeArea`. */
function set(next: Partial<SafeArea>, moved: keyof SafeArea, announce: boolean) {
  const clamped = clampSafeArea({ ...current, ...next }, moved);
  current = { ...clamped, seq: announce ? current.seq + 1 : current.seq };
  emit();
  try {
    window.localStorage.setItem(SAFE_AREA_KEY, JSON.stringify(clamped));
  } catch {
    /* See above. The band still moves; it just does not survive a reload. */
  }
}

/** The two edges, as whole percentages of the window's height. */
export function useSafeArea(): SafeArea {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(hydrate, []);
  return { top: value.top, bottom: value.bottom };
}

/** The same, plus the counter the adjustment overlay lives off. */
export function useSafeAreaSnapshot(): Snapshot {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(hydrate, []);
  return value;
}

/**
 * Installs the chords. Mounted once per surface — the live board and the mock.
 *
 * ⌘⌥0 IS THE ONE RESET, and it puts the whole board back rather than only these
 * two edges: the density, the layout and the band, all to what shipped. In a
 * room, the ability to undo a fiddle in one keystroke is worth more than any
 * individual setting, and three separate resets is three things to remember at
 * the moment he has stopped wanting to think about it. ⌘⇧0 still resets the
 * density alone, for the fine adjustment on its own.
 *
 * `preventDefault` on all of them regardless of whether they moved anything:
 * Chrome binds none of these at application level, and a chord that sometimes
 * scrolls the page is worse than one that never does.
 */
export function useSafeAreaKeys(onResetAll?: () => void): SafeArea {
  const value = useSafeArea();

  const nudge = useCallback((edge: keyof SafeArea, steps: number) => {
    set({ [edge]: current[edge] + steps * SAFE_AREA_STEP }, edge, true);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const arrow =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      /*
       * `code`, not `key`, for the reset. Option on a Mac rewrites the
       * character the key reports — ⌥0 arrives as "º" — so the one chord in
       * this control that is a digit is the one that cannot be matched on it.
       */
      const zero = event.code === "Digit0" || event.code === "Numpad0";

      if (event.altKey && !event.shiftKey && zero) {
        event.preventDefault();
        set(DEFAULT, "bottom", true);
        onResetAll?.();
      } else if (arrow !== 0 && event.shiftKey && !event.altKey) {
        event.preventDefault();
        nudge("bottom", arrow);
      } else if (arrow !== 0 && event.altKey && !event.shiftKey) {
        event.preventDefault();
        nudge("top", arrow);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge, onResetAll]);

  return value;
}

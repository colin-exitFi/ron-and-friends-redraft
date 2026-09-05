"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  DENSITY_DEFAULT,
  DENSITY_KEY,
  DENSITY_STEP,
  clampDensity,
} from "@/lib/board-legibility";

/**
 * The board's own density control — what ⌘− would do if ⌘− did anything.
 *
 * IT DID NOTHING, AND THAT WAS STRUCTURAL. The grid was sized in `vw` and `vh`.
 * Browser zoom shrinks the CSS pixel and hands the viewport proportionally more
 * of them, so a cell measured in `vw` landed at exactly the same physical size
 * and the board did not move a hair. The commissioner reached for zoom because
 * he wanted density and it was the only lever he knew about.
 *
 * ⌘− WORKS AGAIN NOW, and this is no longer the only answer: the board's
 * governing type size is expressed in `rem`, which browser zoom does reach. See
 * `NAME_BASE_REM` in `board-legibility.ts`. The two compose rather than fight —
 * zoom moves the whole page, this moves the board within it — and this stays
 * because it is the finer instrument and the one that can be reset in a
 * keystroke without touching the browser.
 *
 * So: ⌘⇧− and ⌘⇧= step the whole board's type, and everything sized off it, in
 * 5% increments. The range runs from 0.4 to 1.25 — widened downward, because
 * "I prefer to see as much of the board as possible" and 0.45 is where all
 * sixteen rounds reach the band without Fit mode. Below the arcminute floor is
 * deliberately reachable and the readout says what it costs while he does it.
 *
 * PERSISTED, because the tuning happens once in the room and a refresh mid-draft
 * must not throw it away. `localStorage` rather than a cookie or the URL: it is
 * this browser's preference about this screen, not part of the draft.
 *
 * THE SERVER RENDERS THE DEFAULT, so the first paint matches the markup and
 * hydration does not warn. One frame at the default is imperceptible; a
 * hydration mismatch on the board is not. `useSyncExternalStore` is what makes
 * that safe rather than lucky — it is handed a separate server snapshot and
 * picks the stored value up itself once the client has hydrated.
 *
 * The chord is free: `useDraftTyping` discards every ⌘/Ctrl/Alt combination it
 * does not recognise, so nothing that types a pick can collide with this. ⌘⇧↑
 * and ⌘⇧↓ belong to the projector's safe-area control, ⌘⇧F to Scroll/Fit.
 *
 * A module store rather than one hook's `useState`, so ⌘⌥0 can put the density
 * back along with everything else without the board's one reset having to be
 * threaded through three components. See `use-safe-area.ts`.
 */

/*
 * `localStorage` IS the state, and the hook is a view onto it. Kept at module
 * scope because there is one board and one preference: two mounts of the hook
 * reading their own copies could disagree about the size of the same screen.
 */
const listeners = new Set<() => void>();
let cached: number | null = null;

function readStored(): number {
  try {
    const saved = window.localStorage.getItem(DENSITY_KEY);
    return saved == null ? DENSITY_DEFAULT : clampDensity(Number(saved));
  } catch {
    /* Private browsing, or a blocked store. The board still resizes. */
    return DENSITY_DEFAULT;
  }
}

/*
 * Cached because `useSyncExternalStore` calls this during render and compares
 * the result with the last one; recomputing off `localStorage` every time would
 * be a synchronous read on every paint of the board.
 */
function getDensity(): number {
  if (cached == null) cached = readStored();
  return cached;
}

/** What the server has to say, which is nothing. See the note above. */
function getServerDensity(): number {
  return DENSITY_DEFAULT;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function writeDensity(next: number): void {
  const clamped = clampDensity(next);
  if (clamped === cached) return;
  cached = clamped;
  try {
    window.localStorage.setItem(DENSITY_KEY, String(clamped));
  } catch {
    /* Private browsing, or a full quota. The board still resizes; it just
       forgets, which is better than refusing to resize. */
  }
  for (const onChange of listeners) onChange();
}

export function useBoardDensity(): {
  density: number;
  nudge: (steps: number) => void;
  reset: () => void;
} {
  const density = useSyncExternalStore(subscribe, getDensity, getServerDensity);

  const nudge = useCallback((steps: number) => {
    writeDensity(getDensity() + steps * DENSITY_STEP);
  }, []);

  const reset = useCallback(() => writeDensity(DENSITY_DEFAULT), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
      /*
       * `event.key` for `⌘⇧-` is "_" on a US layout and "-" on others, and for
       * `⌘⇧=` it is "+" or "=". Both are accepted rather than guessing which
       * keyboard is plugged into the machine running the board.
       */
      if (["-", "_"].includes(event.key)) {
        event.preventDefault();
        nudge(-1);
      } else if (["=", "+"].includes(event.key)) {
        event.preventDefault();
        nudge(1);
      } else if (event.key === "0") {
        event.preventDefault();
        reset();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge, reset]);

  return { density, nudge, reset };
}

/** The density half of ⌘⌥0, for a caller that is putting the whole board back. */
export function resetBoardDensity(): void {
  writeDensity(DENSITY_DEFAULT);
}

/**
 * The value alone, WITHOUT the chords.
 *
 * For a component that needs to know how dense the board is but is not the one
 * offering the control — the readout, which reports the number. Calling
 * `useBoardDensity` for it would register a second keydown listener and step
 * the density twice on every press.
 */
export function useBoardDensityValue(): number {
  return useSyncExternalStore(subscribe, getDensity, getServerDensity);
}

"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  CAP_RATIO,
  FURTHEST_VIEWER_IN,
  NAME_FLOOR_ARCMIN,
  PX_PER_INCH,
} from "@/lib/board-legibility";

/**
 * WHAT HE IS TRADING, WHILE HE IS TRADING IT.
 *
 * Three controls now change the size of this board — the density, the safe
 * area, and browser zoom — and he is tuning all three by eye, in a room, with
 * ten people watching. "The font size is something we just won't really know
 * for sure until it's up on the screen." A control he cannot see the effect of
 * is a control he has to guess at twice.
 *
 * So every adjustment publishes the one quantity he actually cares about —
 * HOW MANY ROUNDS ARE ON SCREEN — alongside the setting that produced it and
 * the name's angular size from the furthest seat. `DENSITY 0.70 · 15 ROUNDS ·
 * 12.6′` is a decision he can make in ten seconds; "density 0.70" on its own is
 * a number he has to go and look at the board to interpret.
 *
 * The arcminutes are INFORMATIVE AND NOT BLOCKING. Below the comfortable floor
 * the readout says so and keeps going: him choosing in the room with his own
 * eyes beats a calculation about a room nobody has measured with a projector
 * running in it.
 *
 * MEASURED OFF THE RENDERED BOARD, never recomputed from the settings. The
 * whole point is to report what the CSS actually did — the `vw` ceiling, the
 * `rem` base, the container queries in Fit mode and the browser's own zoom all
 * land in the number this reads back, and a second calculation out here would
 * be a second opinion rather than an answer.
 */

export type Readout = {
  /** Bumped when a displayed value changes, so the overlay can hold and fade. */
  seq: number;
  density: number;
  /** Rounds that fit the safe band. Always 16 in Fit mode, by construction. */
  rounds: number;
  /** The name's size as rendered, in CSS pixels. */
  namePx: number;
  /** …and what that subtends from the furthest seat. */
  arcmin: number;
  fit: boolean;
};

const EMPTY: Readout = {
  seq: 0,
  density: 1,
  rounds: 0,
  namePx: 0,
  arcmin: 0,
  fit: false,
};

let current = EMPTY;
/** The board arriving is not an adjustment, so the first read does not announce. */
let seeded = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;
const serverSnapshot = () => EMPTY;

/** Only a change the operator can SEE is worth putting the overlay up for. */
function publish(next: Omit<Readout, "seq">) {
  const same =
    current.density === next.density &&
    current.rounds === next.rounds &&
    current.namePx === next.namePx &&
    current.fit === next.fit;
  if (same) return;
  current = { ...next, seq: seeded ? current.seq + 1 : 0 };
  seeded = true;
  for (const listener of listeners) listener();
}

export function useReadout(): Readout {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/**
 * Measures the board after every change that could have resized it.
 *
 * Mounted once per surface, beside the controls it reports on. The `resize`
 * listener is what catches browser zoom: there is no zoom event, but changing
 * it changes the viewport, and that is the same signal a window resize gives.
 */
export function useBoardReadout({
  boardRef,
  enabled,
  fit,
  deps,
}: {
  boardRef: React.RefObject<HTMLElement | null>;
  enabled: boolean;
  fit: boolean;
  /** Anything that changes the board's size: density, safe area, fit, round. */
  deps: unknown[];
}): void {
  useEffect(() => {
    if (!enabled) return;
    const measure = () => {
      const board = boardRef.current;
      if (!board) return;
      const rows = board.querySelectorAll<HTMLElement>("[data-round]");
      const first = rows[0];
      const name = board.querySelector<HTMLElement>(
        "[data-slot-id] > div > div:first-child",
      );
      if (!first || !name) return;

      const style = getComputedStyle(board);
      const density = Number(style.getPropertyValue("--ukl-density")) || 1;
      const safeBottom = Number(style.getPropertyValue("--ukl-safe-bottom")) || 1;
      const rowHeight = first.getBoundingClientRect().height;
      const header = board.firstElementChild?.getBoundingClientRect();
      /*
       * The band below the sticky franchise header, which is what a round can
       * actually occupy — dividing the whole box by a row height overstates the
       * answer by most of a round.
       */
      const band = window.innerHeight * safeBottom - (header?.bottom ?? 0);
      /*
       * N rounds occupy `N × pitch − gap`, not `N × pitch`: there is no gap
       * after the last one. Charging for it loses a whole round exactly when
       * the board has been stepped down far enough to fit sixteen, which is the
       * one answer this readout exists to report — measured, it said 15 while
       * round 16 sat 0.01px inside the band.
       */
      const pitch =
        rows.length > 1
          ? rows[1].getBoundingClientRect().top - first.getBoundingClientRect().top
          : rowHeight;
      const fits = pitch > 0 ? Math.floor((band + (pitch - rowHeight)) / pitch) : 0;
      const namePx =
        Math.round(parseFloat(getComputedStyle(name).fontSize) * 100) / 100;

      publish({
        density: Math.round(density * 100) / 100,
        rounds: fit ? rows.length : Math.max(0, Math.min(rows.length, fits)),
        namePx,
        arcmin:
          Math.round(((namePx * CAP_RATIO) / PX_PER_INCH / FURTHEST_VIEWER_IN) * 3438 * 10) /
          10,
        fit,
      });
    };

    // After paint, so the measurement is of the layout the change produced
    // rather than of the one it replaced.
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardRef, enabled, fit, ...deps]);
}

/** Whether the room can still comfortably read it, in words rather than a number. */
export function legibilityNote(arcmin: number): string | null {
  if (arcmin >= NAME_FLOOR_ARCMIN) return null;
  return arcmin >= NAME_FLOOR_ARCMIN * 0.75 ? "tight from the back" : "front rows only";
}

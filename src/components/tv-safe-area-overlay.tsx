"use client";

import { useEffect, useReducer } from "react";

import { legibilityNote, useReadout } from "@/lib/use-board-readout";
import { useSafeAreaSnapshot } from "@/lib/use-safe-area";

/**
 * The two lines the safe area actually is, drawn while it is being moved.
 *
 * This is the LESSER half of the feedback and it is worth being clear about
 * that. The real feedback is that the follow effect depends on these two
 * numbers, so every press re-scrolls the board into the new band and he watches
 * the active round move to where he is putting it. The lines exist so that the
 * thing being moved is visible as a line rather than inferred from the board
 * jumping.
 *
 * THE EXCLUDED REGION IS WASHED, NOT LEFT EMPTY. A bare rule across an empty
 * screen reads as "the board ends here"; half-black over the region below it
 * reads as "this part is not for you", which is what the bottom of that
 * projection actually is. It is the difference between looking like the board
 * has stopped and looking like the board has been told where the floor is.
 *
 * z-[54]: over the board, under `FlashOverlay` at z-[55]. Adjusting the safe
 * area during a pick announcement is a real sequence — that is exactly when he
 * notices the flash is falling off the bottom — and the announcement is the
 * room's, so it wins.
 */

/** Held up for this long after the last press, then faded out. */
const HOLD_MS = 1600;
const FADE_MS = 300;

export function TvSafeAreaOverlay({ tvMode }: { tvMode: boolean }) {
  const { top, bottom, seq } = useSafeAreaSnapshot();
  /*
   * WHICH ADJUSTMENT HAS FINISHED, rather than two booleans saying whether the
   * overlay is up and whether it is fading. The timers record the press they
   * belong to — positive once it has been held long enough, negative once it
   * has faded — so both facts are derived from one number and cannot disagree,
   * and a press arriving mid-fade is a different `seq` that starts over.
   */
  const [settled, settle] = useReducer((_: number, next: number) => next, 0);

  useEffect(() => {
    if (seq === 0) return;
    const fade = setTimeout(() => settle(seq), HOLD_MS);
    const gone = setTimeout(() => settle(-seq), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [seq]);

  const shown = settled !== seq && settled !== -seq;

  if (!tvMode || seq === 0 || settled === -seq) return null;

  return (
    <div
      data-safe-area-overlay
      aria-hidden
      style={{ transitionDuration: `${FADE_MS}ms` }}
      className={`pointer-events-none fixed inset-0 z-[54] transition-opacity ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {top > 0 && (
        <div
          className="absolute inset-x-0 top-0 bg-black/50"
          style={{ height: `${top}vh` }}
        />
      )}
      <div
        className="absolute inset-x-0 bottom-0 bg-black/50"
        style={{ height: `${100 - bottom}vh` }}
      />

      <Edge at={top} label={`SAFE AREA · TOP ${top}%`} align="below" />
      <Edge at={bottom} label={`SAFE AREA · BOTTOM ${bottom}%`} align="above" />
    </div>
  );
}

/**
 * `DENSITY 0.70 · 15 ROUNDS · 12.6′ tight from the back`.
 *
 * The same hold-and-fade as the edge rules, but triggered by ANY change to the
 * board's size — the density, the safe area, Fit, and browser zoom, which has
 * no event of its own but resizes the viewport like everything else. Rounds
 * first among equals: it is the quantity he actually asked about.
 *
 * It reports the arcminutes without refusing anything. Below the comfortable
 * floor it says which it is in words, because "12.6′" is only a number to
 * somebody who has read `board-legibility.ts`.
 */
export function BoardReadout({ tvMode }: { tvMode: boolean }) {
  const { seq, density, rounds, arcmin, fit } = useReadout();
  const { top } = useSafeAreaSnapshot();
  const [settled, settle] = useReducer((_: number, next: number) => next, 0);

  useEffect(() => {
    if (seq === 0) return;
    const fade = setTimeout(() => settle(seq), HOLD_MS);
    const gone = setTimeout(() => settle(-seq), HOLD_MS + FADE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
  }, [seq]);

  if (!tvMode || seq === 0 || settled === -seq) return null;
  const shown = settled !== seq && settled !== -seq;
  const note = legibilityNote(arcmin);

  return (
    <div
      data-board-readout
      aria-hidden
      /* Inside the band, at the top: the safe area's own rules occupy the
         bottom edge, and a readout on the floor is not a readout. */
      style={{ transitionDuration: `${FADE_MS}ms`, top: `calc(${top}vh + 1vh)` }}
      className={`bg-background/95 border-live text-foreground pointer-events-none fixed left-1/2 z-[54] -translate-x-1/2 rounded-full border-2 px-[1.2vw] py-[0.5vh] text-[clamp(0.7rem,1.1vw,1.5rem)] font-black tracking-[0.06em] whitespace-nowrap uppercase shadow-2xl backdrop-blur-sm transition-opacity ${
        shown ? "opacity-100" : "opacity-0"
      }`}
    >
      {fit ? "FIT" : `DENSITY ${density.toFixed(2)}`}
      <span className="text-live"> · {rounds} ROUNDS</span>
      <span className={note ? "text-warning" : "text-muted-foreground"}>
        {" "}
        · {arcmin}′{note ? ` ${note}` : ""}
      </span>
    </div>
  );
}

/** A full-width rule in the board's own accent, with the number beside it. */
function Edge({
  at,
  label,
  align,
}: {
  at: number;
  label: string;
  align: "above" | "below";
}) {
  return (
    <div className="absolute inset-x-0" style={{ top: `${at}vh` }}>
      <div className="bg-live h-[2px] w-full" />
      <div
        data-safe-area-label
        className={`bg-live text-primary-foreground absolute left-[1vw] rounded px-[0.6vw] py-[0.3vh] text-[clamp(0.7rem,1.1vw,1.5rem)] font-black tracking-[0.08em] whitespace-nowrap tabular-nums ${
          align === "above" ? "bottom-[0.6vh]" : "top-[0.6vh]"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Lock, Trash2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { boardNameMode, splitBoardName } from "@/lib/board-name";
import { FIT_TYPE_CQH } from "@/lib/board-legibility";
import { FEATURES } from "@/lib/league-config";
import { useBoardDensity } from "@/lib/use-board-density";
import { useSafeArea } from "@/lib/use-safe-area";
import { useTvMode } from "@/lib/use-tv-mode";
import {
  EMPTY_CELL,
  positionCell,
  positionStyle,
  positionText,
} from "@/lib/positions";
import { buildSearchIndex, searchPlayers } from "@/lib/draft-search";
import type { LiveSlot } from "@/lib/draft-types";
import type { Searchable } from "@/lib/draft-search";

/**
 * The parts of the draft board that the live draft and a mock draft must share.
 *
 * Extracted out of `draft-board.tsx` rather than reimplemented, because the
 * commissioner's reason for wanting a mock is that it doubles as rehearsal: he
 * makes his picks on Saturday exactly the way he makes them in a mock. If the
 * two surfaces were separate implementations they would drift, and the drift
 * would be discovered on the night.
 *
 * So the grid, the cells, the typing overlay, the pick announcement and the
 * duplicate moment all live here and are rendered by both. What each caller
 * keeps for itself is only what genuinely differs: the live board saves picks
 * to a JSON file through an API route, while the mock runs entirely in the
 * browser and saves nothing.
 *
 * THE DOM SHAPE HERE IS UNDER TEST. `scripts/verify-draft-typing.mjs` drives a
 * real browser and reads specific things out of it:
 *
 *   · every cell carries `title="{label} — …"`, which is how the test finds one
 *   · every cell carries `data-slot-id`, which is how the board scrolls to it
 *   · `.ukl-flash` is the announcement; `[data-flash-name]` inside it is the
 *     player's name, which is measured for clipping, and
 *     `[data-flash-portrait]` is the headshot box, which is checked for its
 *     initials fallback with the CDN unreachable
 *   · the duplicate warning must contain the words "already drafted", the
 *     round, and the name of the franchise holding him
 *
 * None of that is incidental. Changing it silently turns six passing checks
 * into six checks that pass while testing nothing.
 *
 * WHAT IS DELIBERATELY ABSENT: any list of available players. The commissioner
 * removed that from this league years ago on purpose — "I didn't like people
 * being able to see the cheat sheet as we entered picks. It felt like
 * cheating." The autocomplete matches against the pool while he types, which is
 * how a name gets entered at all; there is no browsable list of who is left,
 * and there must never be one. If a future change makes the pool browsable, it
 * is a regression against league culture, not a feature.
 */

/** Matches shown at once. Six fits the overlay without crowding the board. */
export const MATCH_LIMIT = 6;

/**
 * How tall a control has to be on a device that is tapped rather than clicked.
 *
 * `pointer: coarse` and not a width breakpoint, because the question is what
 * the device has for an input, not how wide it is. A phone turned sideways is
 * 915px across — wider than the `md` breakpoint, wider than some laptops — and
 * still has nothing but a thumb. Nothing here ever applies to the projector or
 * to the laptop the board is run from.
 *
 * 44px upright and 36px sideways, and the split is not a compromise on the
 * guideline so much as a different constraint winning: held sideways the phone
 * has 412px of height for the entire board, and the commissioner was explicit
 * that the bar must not grow there. These controls render at about 21px on a
 * phone today, so 36px is still most of the way.
 */
export const TAP =
  "touch:min-h-9 touch:min-w-9 " +
  "portrait:touch:min-h-11 portrait:touch:min-w-11";

/**
 * How long a committed pick stays on screen.
 *
 * This was a second, and a second was wrong: "right now it's a split second
 * that needs to last a couple seconds, a few seconds." The announcement is the
 * room's chance to catch a wrong name, and ten people cannot look up, read five
 * facts and start arguing inside a beat. So it holds for about three seconds.
 *
 * It costs the operator nothing to make it long, because it never gates him —
 * the overlay is inert to the pointer, sits below the typing overlay, and the
 * next pick replaces it rather than queueing behind it. Slightly longer than the
 * CSS below, so the element unmounts after the fade rather than snapping out.
 */
export const FLASH_MS = 3400;

/**
 * The flash animation and the band's hue-driven trim, kept here rather than in
 * globals.css: that file is the shared token sheet. Nothing here introduces a
 * colour — every rule below resolves `--flash-hue`, which the overlay sets from
 * the drafted player's own position token.
 *
 * Reduced motion drops the scale and keeps the fade, so the pick is still
 * announced without anything moving.
 */
const FLASH_CSS = `
@keyframes ukl-flash-motion {
  0%   { opacity: 0; transform: scale(0.93); }
  4%   { opacity: 1; transform: scale(1); }
  88%  { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(1.02); }
}
@keyframes ukl-flash-plain {
  0%   { opacity: 0; }
  4%   { opacity: 1; }
  88%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes ukl-flash-portrait-motion {
  0%   { opacity: 0; transform: translateX(-1.4vw) scale(0.9); }
  11%  { opacity: 1; transform: none; }
  100% { opacity: 1; transform: none; }
}
.ukl-flash {
  /*
   * Arrives fast and leaves fast, and spends everything in between simply
   * being up: ~130ms in, held to about 2.9s, gone by 3.3s. The percentages are
   * tied to that duration — lengthening one without the other turns the hold
   * into a slow fade the room reads as the board glitching.
   */
  animation: ukl-flash-motion 3300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  will-change: opacity, transform;
  border-color: color-mix(in oklab, var(--flash-hue) 78%, transparent);
}
/*
 * A wash of the position's own hue behind the composition, so the band is not a
 * grey slab with a photograph dropped on it. Centred rather than pinned to the
 * portrait: the portrait and the type are one centred group whose width moves
 * with the length of the name, so there is no fixed point to anchor to.
 */
.ukl-flash-wash {
  background: radial-gradient(
    ellipse 62% 150% at 50% 50%,
    color-mix(in oklab, var(--flash-hue) 15%, transparent),
    transparent 72%
  );
}
/*
 * The portrait carries the hue at full strength — a hairline of it against the
 * photograph and a halo of it into the band — which is what stops a 280px face
 * reading as a rectangle someone pasted on.
 */
.ukl-flash-portrait {
  animation: ukl-flash-portrait-motion 3300ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
  will-change: opacity, transform;
  box-shadow:
    0 0 0 3px color-mix(in oklab, var(--flash-hue) 85%, transparent),
    0 0 0 7px color-mix(in oklab, var(--flash-hue) 16%, transparent),
    0 1.4vh 7vh -1.6vh color-mix(in oklab, var(--flash-hue) 70%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .ukl-flash {
    animation-name: ukl-flash-plain;
    animation-timing-function: linear;
  }
  .ukl-flash-portrait {
    animation: none;
  }
}
`;

export function FlashStyles() {
  return <style>{FLASH_CSS}</style>;
}

/** What the room needs to catch a wrong entry, not merely a mistyped one. */
export type Flash = {
  /** Bumped per commit, so a new pick remounts and restarts the animation. */
  seq: number;
  name: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
  team: string;
  label: string;
  /**
   * FantasyPros headshot, resolved for the whole pool before the draft and
   * carried on the player record the browser already has. Null when there is
   * no picture of him, which the announcement handles without asking.
   */
  headshotUrl?: string | null;
  /**
   * Set when the pick was made against a duplicate warning. The room's running
   * joke — drafting somebody already taken costs you a shot — so the
   * announcement says so instead of the board quietly allowing it.
   */
  duplicate?: boolean;
};

// --- The typing flow --------------------------------------------------------

/**
 * The keyboard, captured at the document — the whole interaction on both
 * surfaces.
 *
 * One practiced operator enters 160 picks while ten people call names across a
 * table. Every rule below follows from that:
 *
 *   TYPE ANYWHERE. Keystrokes are captured at the document, not by a focused
 *   input. There is nothing to click into and nothing that can steal focus, so
 *   he can never be typing into the void.
 *
 *   ONE KEYSTROKE PER DECISION. Enter drafts the top match. ⌘Z undoes. A
 *   duplicate warning clears with a second Enter. At 160 entries a wasted
 *   keystroke is 160 wasted keystrokes.
 *
 *   UNDO IS A CHORD, DELIBERATELY. Backspace is a reflex key and undo is
 *   destructive, so Backspace only ever edits the box. There is no cheaper
 *   undo, because the cheap one costs a pick the night it misfires.
 *
 *   DELETING ONE PICK IS AIMED, NOT REFLEXIVE. ⌘Z only ever unwinds the pick
 *   entered last, so correcting a mis-entry from six picks ago used to mean
 *   throwing away the five good picks on top of it. Instead the arrow keys walk
 *   the cursor onto any cell, and Delete removes the pick sitting in THAT one.
 *   It is destructive, so it asks once and only when the box is empty and the
 *   cursor has been deliberately parked on a filled cell — which is what keeps
 *   the rule above intact: while there is a name half-typed, Backspace is still
 *   nothing but the box's own edit key.
 *
 * Returns the box contents and the ranked matches; the caller owns the board.
 */
export function useDraftTyping<T extends Searchable>({
  pool,
  draftedIds,
  enabled = true,
  busy = false,
  holderOf,
  onCommit,
  onUndo,
  onMoveCursor,
  onClearAim,
  onToggleView,
  deletable,
  onDelete,
}: {
  pool: T[];
  /** Players already on the board — they sink in the list, never vanish. */
  draftedIds: ReadonlySet<string>;
  /** False while it is not the operator's turn to type (an AI is on the clock). */
  enabled?: boolean;
  /**
   * A save is in the air. Every key that CHANGES the board is inert while it
   * is, which `enabled` cannot express on its own: `enabled` is also false
   * whenever the cursor is parked on an entered pick, and undo has to keep
   * working there — that is half of what parking on a pick is for.
   *
   * The two chords are the ones this closes. The caller's buttons have been
   * `disabled={busy}` since they were written, and `deletable` is already
   * nulled mid-save, so without this ⌘Z was the one remaining way to start a
   * second mutation on top of an unfinished one. Overlapping an undo with a
   * pick can make the server unwind the WRONG pick and then discard the
   * refusal of the one that lost, which shows the room a success notice naming
   * a player the board does not have.
   */
  busy?: boolean;
  holderOf: (playerId: string) => LiveSlot | null;
  /** `override` is true on the second Enter over a duplicate warning. */
  onCommit: (player: T, override: boolean) => void;
  onUndo: () => void;
  /**
   * Arrow keys moving the cursor, in grid steps: `(-1, 0)` is one cell left,
   * `(0, 1)` one round down. Absent where the clock is not steerable.
   *
   * Deliberately a direction on the board rather than a step through the draft.
   * Pick order snakes, so "the next pick" runs right-to-left through every even
   * round — an arrow key wired to it sends the cursor the opposite way to the
   * one pressed, on half the board.
   */
  onMoveCursor?: (dx: number, dy: number) => void;
  /** Escape on an empty box: stop aiming out of order and follow the clock again. */
  onClearAim?: () => void;
  /** Tab, and ⌘B — the Board / Rosters switch. */
  onToggleView?: () => void;
  /**
   * The filled cell the cursor is parked on — the one pick Delete would remove.
   * Null whenever the cursor is on an empty cell, which is the whole of the
   * draft as it is normally run.
   */
  deletable?: LiveSlot | null;
  onDelete?: (slot: LiveSlot) => void;
}) {
  const [query, setQuery] = useState("");
  /**
   * The highlighted match, tied to the query it was chosen against. Storing the
   * query alongside the index means a new query resets the highlight by
   * derivation instead of by an effect that fires a render late — which would
   * leave one frame where Enter would draft the previous query's top match.
   */
  const [selection, setSelection] = useState({ query: "", index: 0 });
  /** A duplicate the operator has been warned about and not yet confirmed. */
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    player: T;
    holder: LiveSlot;
  } | null>(null);
  /** A pick Delete has been pressed over once, waiting on the second press. */
  const [pendingDelete, setPendingDelete] = useState<LiveSlot | null>(null);

  const index = useMemo(() => buildSearchIndex(pool), [pool]);
  const matches = useMemo(
    () => searchPlayers(index, query, { limit: MATCH_LIMIT, drafted: draftedIds }),
    [index, query, draftedIds],
  );

  const selected = selection.query === query ? selection.index : 0;
  const setSelected = useCallback(
    (next: (current: number) => number) =>
      setSelection((s) => ({
        query,
        index: next(s.query === query ? s.index : 0),
      })),
    [query],
  );

  /**
   * The armed delete counts only while the cursor is still on the pick it was
   * armed over. Deriving that rather than clearing it in every handler means
   * moving the cursor, or the board changing underneath it, disarms by
   * construction — there is no frame in which a second Delete could land on a
   * cell the operator was no longer looking at.
   */
  const armedDelete =
    pendingDelete && deletable && pendingDelete.id === deletable.id ? deletable : null;

  const reset = useCallback(() => {
    setQuery("");
    setSelection({ query: "", index: 0 });
    setPendingDuplicate(null);
    setPendingDelete(null);
  }, []);

  /*
   * The duplicate moment, as two functions rather than only as two keystrokes.
   *
   * Every path out of that panel used to be a key — Enter to overrule it, Esc
   * to back out — which is complete on a keyboard and a dead end on a phone,
   * where the panel is modal and neither key exists. These are the same two
   * branches the handler below takes, lifted out so a button can call them; the
   * keyboard still runs through the switch and behaves identically.
   */
  const confirmDuplicate = useCallback(() => {
    // `busy` and not `enabled`: the duplicate panel is open over a cell that is
    // still the target, and the only reason to refuse the confirmation is that
    // the previous mutation has not landed. `attempt` guards the same way one
    // step earlier, and the second Enter used to walk straight past it.
    if (!pendingDuplicate || busy) return;
    const { player } = pendingDuplicate;
    reset();
    onCommit(player, true);
  }, [busy, onCommit, pendingDuplicate, reset]);

  /** Clears the box as well as the panel: the name in there is the one he has
   *  just been told is wrong, so leaving it would silently append to it. */
  const dismissDuplicate = useCallback(() => {
    setPendingDuplicate(null);
    setQuery("");
  }, []);

  /** Enter on a match: warn about a duplicate first, draft on the second Enter. */
  const attempt = useCallback(
    (player: T) => {
      if (!enabled) return;
      const holder = holderOf(player.id);
      if (holder) {
        setPendingDuplicate({ player, holder });
        return;
      }
      reset();
      onCommit(player, false);
    },
    [enabled, holderOf, onCommit, reset],
  );

  const onKey = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // The command palette and any future input own their own keystrokes.
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        // Swallowed either way, so the browser's own undo can never surface on
        // a screen with no text field on it — but only acted on once the board
        // has settled.
        event.preventDefault();
        if (!busy) onUndo();
        return;
      }
      /*
       * ⌘B / Ctrl+B switches between the board and the rosters. A chord rather
       * than a letter because every printable key belongs to the name box, and
       * B for Board is the only mnemonic available that no browser claims.
       */
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        if (onToggleView) {
          event.preventDefault();
          onToggleView();
        }
        return;
      }
      // Leave every other chord alone — ⌘K still opens the palette.
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const wasEmpty = query.length === 0;

      switch (event.key) {
        case "Enter": {
          event.preventDefault();
          if (armedDelete) {
            // Enter is the most-pressed key on this screen, so over an armed
            // delete it is far likelier to be a reflex than an answer. It backs
            // out; only Delete itself deletes.
            setPendingDelete(null);
          } else if (pendingDuplicate) {
            confirmDuplicate();
          } else if (enabled && matches[selected]) {
            attempt(matches[selected].item);
          }
          return;
        }
        case "Escape": {
          event.preventDefault();
          if (pendingDuplicate) dismissDuplicate();
          else if (armedDelete) setPendingDelete(null);
          else if (query) setQuery("");
          else onClearAim?.();
          return;
        }
        case "Tab": {
          /*
           * Toggles the view, but only from an empty box — the same guard the
           * arrow keys use. With a name half-typed, Tab is far more likely to be
           * a reflex than a request to change screens, and swapping the board
           * out from under a half-entered pick is not recoverable in one key.
           */
          if (wasEmpty && !pendingDuplicate && onToggleView) {
            event.preventDefault();
            onToggleView();
          }
          return;
        }
        case "Backspace":
        case "Delete": {
          /*
           * Always swallowed, so neither key can navigate the page back.
           *
           * While there is anything in the box, both keys belong to the box and
           * nothing else — Backspace edits it and Delete is ignored. An empty
           * box still does not undo. The one destructive path is the aimed one:
           * the cursor parked on a filled cell, nothing typed, and a second
           * press over the warning below. Both keys are bound because the key
           * labelled "delete" on a Mac keyboard reports itself as Backspace.
           */
          event.preventDefault();
          if (pendingDuplicate) {
            dismissDuplicate();
            return;
          }
          if (!wasEmpty) {
            if (event.key === "Backspace") setQuery((q) => q.slice(0, -1));
            return;
          }
          if (armedDelete) {
            setPendingDelete(null);
            onDelete?.(armedDelete);
          } else if (deletable && onDelete) {
            setPendingDelete(deletable);
          }
          return;
        }
        /*
         * All four arrows do one of two jobs, decided by whether anything has
         * been typed. With a name in the box they belong to the match list —
         * there is no cursor worth thinking about while choosing between six
         * Browns. With an empty box they move the cursor around the grid.
         */
        case "ArrowDown":
          event.preventDefault();
          if (wasEmpty && onMoveCursor) onMoveCursor(0, 1);
          else setSelected((i) => Math.min(i + 1, matches.length - 1));
          return;
        case "ArrowUp":
          event.preventDefault();
          if (wasEmpty && onMoveCursor) onMoveCursor(0, -1);
          else setSelected((i) => Math.max(i - 1, 0));
          return;
        case "ArrowRight":
          if (wasEmpty && onMoveCursor) {
            event.preventDefault();
            onMoveCursor(1, 0);
          }
          return;
        case "ArrowLeft":
          if (wasEmpty && onMoveCursor) {
            event.preventDefault();
            onMoveCursor(-1, 0);
          }
          return;
        default:
          break;
      }

      /*
       * Anything printable is part of a player's name. Typing while the
       * duplicate warning is up means he has moved on to a different player, so
       * the warning goes and the letter starts a fresh name.
       *
       * Typing while the cursor sits on a filled cell means he is done looking
       * at it, so the cursor goes back to the clock on the same keystroke.
       * Otherwise the first name of the next pick would be typed at a cell that
       * cannot accept it — the one thing "type anywhere" promises cannot happen.
       */
      if (event.key.length === 1 && event.key !== " ") {
        if (deletable) {
          setPendingDelete(null);
          onClearAim?.();
        }
        if (pendingDuplicate) {
          setPendingDuplicate(null);
          setQuery(event.key);
        } else {
          setQuery((q) => q + event.key);
        }
      } else if (event.key === " " && query.length > 0 && !pendingDuplicate) {
        event.preventDefault();
        setQuery((q) => q + " ");
      }
    },
    [
      armedDelete,
      attempt,
      busy,
      confirmDuplicate,
      deletable,
      dismissDuplicate,
      enabled,
      matches,
      onClearAim,
      onDelete,
      onMoveCursor,
      onToggleView,
      onUndo,
      pendingDuplicate,
      query,
      selected,
      setSelected,
    ],
  );

  // Re-registered whenever the handler changes rather than held in a ref, so
  // the listener is never a render behind the query it is reading. Swapping a
  // listener costs nothing next to being wrong about what was typed.
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  return {
    query,
    setQuery,
    matches,
    selected,
    pendingDuplicate,
    /** The pick Delete has been pressed over once and is waiting to confirm. */
    pendingDelete: armedDelete,
    attempt,
    reset,
    confirmDuplicate,
    dismissDuplicate,
  };
}

// --- The grid ---------------------------------------------------------------

/*
 * Names are printed in full. A cell is ~170px wide at 1080p, which the design
 * sizes the name against directly: the type is small enough that the longest
 * real name ("Christian McCaffrey", "Washington Commanders") fits without being
 * abbreviated to an initial or clipped with an ellipsis. There is deliberately
 * no shortening helper here.
 */

/**
 * Room left around a cell when it is scrolled to.
 *
 * ABOVE: `scrollIntoView` knows nothing about the sticky franchise-name row, so
 * without this it parks the live cell exactly underneath it. Generous enough to
 * clear a two-line franchise name.
 *
 * BELOW: the same problem at the other end. `block: "nearest"` scrolls as little
 * as it can, so a cell reached from ABOVE lands flush against the bottom edge of
 * the board — measured at 1366x768 with the cursor on 16.10, the cell's bottom
 * and the footer's top were the same pixel. Legible, but it reads as clipped and
 * hides whether there is any board left underneath. Roughly half a row of margin
 * keeps the cell being typed into off the edge.
 *
 * Only has any effect where the board scrolls, which at sixteen rounds means
 * laptops and not the 1080p TV — and laptops are what the remote managers use.
 */
const SCROLL_CLEARANCE = "scroll-mt-[7vh] scroll-mb-[4vh]";

/**
 * The strip of the projected image the room can actually read, as CSS lengths.
 *
 * Outside TV mode this is the whole viewport and every consumer collapses back
 * to what it did before: no spacers, a header stuck to `top: 0`, overlays
 * against the window's own edges. In a browser window the bottom of the
 * viewport is at desk height and perfectly readable, and a third of a screen of
 * reserved space under the board would read as a bug.
 */
export function useBand(): {
  tvMode: boolean;
  /** Fractions, for the CSS custom properties the grid publishes. */
  top: number;
  bottom: number;
  /** What is excluded at each end, ready to drop into `top`/`bottom`. */
  topInset: string;
  bottomInset: string;
} {
  const tvMode = useTvMode();
  const safe = useSafeArea();
  const top = tvMode ? safe.top / 100 : 0;
  const bottom = tvMode ? safe.bottom / 100 : 1;
  return {
    tvMode,
    top,
    bottom,
    topInset: `${top * 100}vh`,
    bottomInset: `${(1 - bottom) * 100}vh`,
  };
}

export function BoardGrid({
  slots,
  teams,
  rounds,
  teamCount,
  aimedId,
  targetSlotId,
  onAim,
  onPickMenu,
  boardRef,
  fit = false,
}: {
  slots: LiveSlot[];
  /** `name` is the short handle the column is headed by; the rest is tooltip. */
  teams: {
    id: string;
    name: string;
    franchiseName: string;
    manager: string;
  }[];
  rounds: number;
  teamCount: number;
  aimedId: string | null;
  targetSlotId: string | null;
  /** Moves the cursor to a cell. Offered on every cell a keeper is not in. */
  onAim?: (slotId: string) => void;
  /** Right-click on an entered pick, at the pointer. Absent on the mock. */
  onPickMenu?: (slot: LiveSlot, x: number, y: number) => void;
  boardRef?: React.Ref<HTMLElement>;
  /**
   * All sixteen rounds inside the band at once rather than eleven and a
   * scroll. See `use-board-fit.ts` for what the two modes are for.
   */
  fit?: boolean;
}) {
  /*
   * ONE NAME DECISION FOR THE WHOLE BOARD, and one density for it.
   *
   * `boardNameMode` reads every name currently on the grid and answers with the
   * layout all 160 cells will use — one line or two, at what size. Uniformity is
   * the top constraint and this is where it is enforced: no cell gets to decide
   * anything about type on its own. See `board-name.ts`.
   *
   * The density is the operator's, ⌘⇧− and ⌘⇧=, because no static default
   * survives contact with a room. See `use-board-density.ts`.
   */
  const nameMode = useMemo(
    () =>
      boardNameMode(
        slots
          .filter((s) => s.player)
          .map((s) => ({ name: s.player!.name, position: s.player!.position })),
      ),
    [slots],
  );
  const { density } = useBoardDensity();
  /*
   * Whether the ownership strip is drawn AT ALL — and so whether every cell
   * gives up a line of its height to reserve room for one. See
   * `boardShowsOwnership`; the answer is one boolean for the whole grid,
   * because a strip on some cells and not others is the uniformity bug this
   * board has already been through once.
   */
  const ownership = useMemo(() => boardShowsOwnership(slots), [slots]);
  /*
   * TV mode read here rather than threaded down from `draft-board.tsx`, which
   * holds fullscreen for its own topbar and does not pass it on. `useTvMode`
   * answers for OS-level kiosk fullscreen and for `?tv=1` as well, so the mock
   * gets the same answer without a second prop through a second call site.
   */
  const band = useBand();

  const byRound = useMemo(() => {
    const map = new Map<number, LiveSlot[]>();
    for (const slot of slots) {
      const arr = map.get(slot.round) ?? [];
      arr.push(slot);
      map.set(slot.round, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.column - b.column);
    return map;
  }, [slots]);

  const positionCounts = useMemo(() => {
    const counts = new Map<string, Record<string, number>>();
    for (const team of teams) counts.set(team.id, {});
    for (const slot of slots) {
      if (!slot.player) continue;
      const row = counts.get(slot.currentOwner.id);
      if (row) row[slot.player.position] = (row[slot.player.position] ?? 0) + 1;
    }
    return counts;
  }, [slots, teams]);

  /*
   * `--ukl-cell` is the narrowest a column may be before the board gives up and
   * scrolls sideways instead. It is 0 everywhere except a phone, which leaves
   * the desktop and projector grid at exactly the `minmax(0, 1fr)` it has always
   * been — every column an equal share, nothing scrolling.
   *
   * 5.1rem is not a taste: it is what the longest single WORD in a name needs
   * at the phone type size below, which is the width a wrapped name cannot go
   * under — "Smith-Njigba" is 12 characters and 65px of 9px type. Ten of them
   * come to 816px, so a portrait phone shows five columns and swipes to the
   * rest. It used to be sized for a whole 15-character name on one line; names
   * wrap now, so what has to fit across is a word rather than a name.
   */
  const columns = {
    gridTemplateColumns: `repeat(${teamCount}, minmax(var(--ukl-cell), 1fr))`,
  };
  /* Holds the rows open to the scrollable width, since a flex child of a
   * column would otherwise be pinned to the viewport and simply clip. */
  const rowWidth = {
    minWidth: `calc(${teamCount} * (var(--ukl-cell) + 0.25vw) + var(--ukl-gutter))`,
  };
  /*
   * FIT MODE'S THREE TYPE SIZES, FROM THE BUDGET THAT DERIVES THEM.
   *
   * Written here rather than as Tailwind arbitrary values because Tailwind
   * cannot read a TypeScript constant: the shares were declared in
   * `board-legibility.ts` and RESTATED in a class string, which is two copies
   * of a budget that only balances if they agree. They did not have to drift
   * for that to be a problem — the derivation lives with the constants and the
   * board was sized by the copy.
   *
   * THE `vw` CEILING IS IN THE `min()` HERE TOO, which it was not before. It is
   * the width a column can actually hold the longest surname at, measured by
   * `verify-board-fit.mjs` against the real top-200, and it did not use to
   * matter in Fit only because the round's share was far below it. At 25cqh it
   * is close enough to matter on a wide, short screen, and the rule it buys is
   * what lets the harness go on covering both modes while only driving one:
   * Fit is now `min(share, ceiling, Scroll's own term)`, so it can never be
   * larger than Scroll, and a name proved to fit its column there fits here.
   */
  const shares = ownership ? FIT_TYPE_CQH.withOwnership : FIT_TYPE_CQH.plain;
  const fitType = {
    "--ukl-name": `min(${shares.name}cqh, var(--ukl-name-cap), calc(var(--ukl-name-base)*var(--ukl-name-scale,1)*var(--ukl-density,1)))`,
    "--ukl-pos": `min(${shares.pos}cqh, var(--ukl-pos-cap), calc(var(--ukl-pos-base)*var(--ukl-density,1)))`,
    "--ukl-meta": `min(${shares.meta}cqh, var(--ukl-meta-cap), calc(var(--ukl-meta-base)*var(--ukl-density,1)))`,
  } as React.CSSProperties;

  return (
    /*
     * A ROW IS AS TALL AS WHAT IS IN IT. THE BOARD SCROLLS.
     *
     * Fourth version of this, and the first that cannot lose a character.
     * `flex-1` fit any screen by shrinking the type to 6px on a laptop.
     * `basis-0` over a floor made all sixteen rows identical by refusing to ask
     * for what they contain — which is fine until the contents want more than
     * the share they are given, and then the ownership strip is sitting on the
     * name. That is the bug this replaced: `min(3.45rem, 5.2vh)` on a 780px
     * window is a 41px row, and a cell needs 47.
     *
     * `basis-auto shrink-0` asks for the content instead, so nothing on this
     * board is ever squeezed. The board is allowed to run off the bottom: the
     * commissioner's ruling is that every cell shows everything it holds, in
     * full, at every viewport, and that legibility beats fitting — the draft
     * runs on a floor-to-ceiling projector whose bottom edge is unviewable from
     * a seat anyway, so the one-screen fit was never buying what it cost.
     *
     * Uniformity is not given up with it, and it is not bought with arithmetic
     * either: every cell reserves two lines for a name and a line for the
     * ownership strip whether it holds them or not, so all 160 cells demand the
     * same height and the rows come out level by construction. See `Cell`.
     *
     * `grow` still fills a screen taller than the board needs.
     */
    <main
      ref={boardRef}
      /*
       * The three numbers a phone changes, declared here so the whole
       * responsive decision is in one place rather than spread over the cells.
       *
       * `--ukl-name-base` goes BELOW every clamp floor in this file, deliberately
       * and on the commissioner's instruction: a name that fits whole at 9px
       * beats the same name clipped to "J. S…" at 11px, and the room reads names
       * off this grid. It is overridden twice because a phone fails in two
       * different ways — upright it runs out of width, turned sideways it is
       * wide enough and only 412px tall.
       *
       * 0.84vw is 16.1px on the 1080p signal, an 11.3px cap, 1.13in on a 16ft
       * screen, and 18 arcminutes from the furthest seat at 18ft — inside the
       * 16–22 band that reads comfortably for sustained text, with the room to
       * spare going to rounds rather than to type. `--ukl-meta-base` at 0.58vw
       * is 12.4 arcminutes, which is reference detail read by whoever leans in.
       * The arithmetic, and the screen it assumes, is in `board-legibility.ts`.
       *
       * `--ukl-name` is that base times the board's two board-wide multipliers:
       * the density the operator set, and the step-down a freak name forces on
       * every cell at once.
       */
      /*
       * THE FLOOR. In TV mode the board's scroll box runs to the bottom edge of
       * a floor-to-ceiling screen, so "scrolled all the way down" used to leave
       * round 16 resting on the ground — unreadable at every scroll position
       * there was, rather than at some of them. The trailing space is what makes
       * the scroll range long enough to lift it clear.
       *
       * PADDING ON THE SCROLLER, not a margin under it: only padding inside the
       * scrolling box counts toward `scrollHeight`, and it is the scroll range
       * that is the actual defect. Derived from `--ukl-safe-bottom`, which the
       * ⌘⇧↑/⌘⇧↓ safe-area control sets and nothing else — see `use-safe-area.ts`.
       *
       * `100vh` is exact here rather than approximate: in TV mode this element's
       * bottom edge IS the bottom of the screen. On the mock, which keeps a hint
       * bar below the board, the same padding lifts the last round slightly
       * further than asked, which is the safe direction to be wrong in.
       *
       * THE LEADING SPACE IS THE SAME BARGAIN AT THE OTHER END, and it is a
       * no-op at the default top of 0. Without it a non-zero top inset would
       * push round one under the sticky header with nothing to scroll back to,
       * which is the top-edge version of round 16 resting on the floor.
       */
      /*
       * FIT MODE: THE SAME TWO SPACERS, DOING THE OPPOSITE JOB.
       *
       * Nothing about the padding changes between the modes, and that is the
       * point of putting the band on the scroller rather than anywhere else. In
       * Scroll the padding lengthens the scroll RANGE so maximum scroll lifts
       * round 16 clear of the floor; in Fit it shortens the CONTENT BOX so the
       * sixteen 1fr rows divide the band instead of the screen. One pair of
       * numbers, and the two modes cannot end up disagreeing about where the
       * readable part of the projection is.
       *
       * Fitting to the raw viewport would put the last rounds back on the
       * floor, which is the entire defect this projector work exists to fix.
       */
      style={
        {
          "--ukl-density": density,
          "--ukl-name-scale": nameMode.scale,
          "--ukl-name-lines": nameMode.lines,
          "--ukl-safe-top": band.top,
          "--ukl-safe-bottom": band.bottom,
          ...(band.tvMode
            ? {
                paddingTop: "calc(var(--ukl-safe-top) * 100vh)",
                paddingBottom: "calc((1 - var(--ukl-safe-bottom)) * 100vh)",
              }
            : null),
          ...(fit
            ? {
                /*
                 * `minmax(0, 1fr)` rather than the scrolling board's
                 * `basis-auto`: there a row asks for what its cells contain and
                 * the board is allowed to run past the fold, which is the whole
                 * disagreement between the two modes. Here the rounds divide
                 * what the band left behind, so the board fits by construction
                 * rather than by a size that happened to work once. The header
                 * keeps its `auto` row above them.
                 */
                gridTemplateRows: `auto repeat(${rounds}, minmax(0, 1fr))`,
              }
            : null),
        } as React.CSSProperties
      }
      className={cn(
        /*
         * `rem` GOVERNS, `vw` CAPS — which is what puts ⌘+ / ⌘− back in his
         * hands. Browser zoom shrinks the CSS pixel and hands the viewport more
         * of them, so a `vw`-sized cell lands at an identical physical size and
         * the board does not move; only root-relative lengths respond. The
         * `rem` figures are what the old `vw` expressions resolved to at 1080p,
         * so the calibrated board is unchanged at 100%. The `vw` term is now a
         * ceiling on the FINAL size, which is also what stops the density
         * control asking for type a column cannot hold. See `board-legibility.ts`.
         *
         * EVERY TYPE SIZE ON THE BOARD IS HERE, including the round rail and the
         * franchise header, and both of those had to move for the same reason
         * the cells did. Left in `vw` they were immune to zoom while the cells
         * were not, so at 50% the round numbers rendered LARGER than the player
         * names beside them. They were also immune to the density control, which
         * left the header holding ~100px of a 672px band however far the board
         * was stepped down — most of the reason the range could not reach all
         * sixteen rounds.
         */
        "min-h-0 min-w-0 flex-1 gap-[0.15vh] px-[0.5vw] py-[0.25vh] [--ukl-cell:0px] [--ukl-cell-gap:0.06vh] [--ukl-cell-pad:0.14vh] [--ukl-gutter:3.2vw] [--ukl-name-base:1.008rem] [--ukl-meta-base:0.696rem] [--ukl-pos-base:0.864rem] [--ukl-head-base:0.984rem] [--ukl-count-base:0.768rem] [--ukl-rail-base:0.96rem] [--ukl-name-cap:0.88vw] [--ukl-meta-cap:0.608vw] [--ukl-pos-cap:0.754vw] [--ukl-head-cap:0.86vw] [--ukl-count-cap:0.67vw] [--ukl-rail-cap:0.84vw] [--ukl-name:min(calc(var(--ukl-name-base)*var(--ukl-name-scale,1)*var(--ukl-density,1)),var(--ukl-name-cap))] [--ukl-meta:min(calc(var(--ukl-meta-base)*var(--ukl-density,1)),var(--ukl-meta-cap))] [--ukl-pos:min(calc(var(--ukl-pos-base)*var(--ukl-density,1)),var(--ukl-pos-cap))] [--ukl-head:min(calc(var(--ukl-head-base)*var(--ukl-density,1)),var(--ukl-head-cap))] [--ukl-count:min(calc(var(--ukl-count-base)*var(--ukl-density,1)),var(--ukl-count-cap))] [--ukl-rail:min(calc(var(--ukl-rail-base)*var(--ukl-density,1)),var(--ukl-rail-cap))] [--ukl-strip:calc(var(--ukl-meta)*1.17)] max-md:overflow-x-auto max-md:[--ukl-cell:5.1rem] max-md:[--ukl-gutter:2.15rem] max-md:[--ukl-name-base:9px] max-md:[--ukl-meta-base:0.5rem] max-md:[--ukl-pos-base:0.62rem] max-md:[--ukl-head-base:0.62rem] max-md:[--ukl-count-base:0.52rem] max-md:[--ukl-rail-base:0.5rem] max-md:[--ukl-name-cap:99px] max-md:[--ukl-meta-cap:99px] max-md:[--ukl-pos-cap:99px] max-md:[--ukl-head-cap:99px] max-md:[--ukl-count-cap:99px] max-md:[--ukl-rail-cap:99px] [@media(max-height:520px)]:[--ukl-name-base:9px]",
        fit ? "grid overflow-hidden" : "flex flex-col overflow-y-auto",
      )}
    >
      {/*
        Sticky, so the franchise names stay overhead when the board scrolls —
        and sticky to the top of the SAFE AREA rather than to the top of the
        scroll box, or a non-zero top inset would park the column headings in
        the strip of screen the room was just told it cannot read.
      */}
      <div
        className="bg-background/95 sticky top-[calc(var(--ukl-safe-top,0)*100vh)] z-10 flex shrink-0 gap-[0.25vw] pb-[0.25vh] backdrop-blur-sm"
        style={rowWidth}
      >
        {/* Sticky sideways as well as down, so the round numbers stay beside the
            cells they label once a phone starts swiping across the board. */}
        <div className="bg-background sticky left-0 z-[1] w-[var(--ukl-gutter)] shrink-0" />
        <div className="grid flex-1 gap-[0.25vw]" style={columns}>
          {teams.map((team) => (
            <div
              key={team.id}
              className="bg-board-base border-border rounded border px-1 py-[0.3vh] text-center"
              title={`${team.name} — ${team.franchiseName} · ${team.manager}`}
            >
              {/*
                THE MANAGER'S HANDLE, NOT THE FRANCHISE NAME.
                
                This was the franchise name, on the reasoning that a traded
                cell's strip has to be read against the column header and the
                two should be the same noun. Right principle, wrong direction:
                the strip already says "→ ZACH", so it was the *header* that
                disagreed. Now both say Zach.

                It also fixes the header row's shape. Franchise names run from
                "DHB Sandmen" to "Fingers are for painting" and wrapped to one,
                two or three lines depending on the name and the window, which
                left each column's position counts at a different height and
                read as ragged. Every handle in this league is three to six
                characters, so they are all exactly one line at any width — the
                raggedness is gone by construction rather than by reserving
                blank lines for it.

                The franchise name is not lost; it is in the tooltip, and nobody
                needed it to know whose column this is.
              */}
              <div className="text-[length:var(--ukl-head)] leading-[1.15] font-black uppercase">
                {team.name}
              </div>
              <PositionCounts counts={positionCounts.get(team.id) ?? {}} />
            </div>
          ))}
        </div>
      </div>

      {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => (
        <div
          key={round}
          /*
           * `data-round` is the handle the auto-follow scrolls to and the one
           * `scripts/verify-tv-follow.mjs` measures. A round, not a cell: rows
           * have stable height and the board is meant to move once a round
           * rather than once a pick. See `use-board-follow.ts`.
           */
          data-round={round}
          /*
           * The floor is only a floor now — the cells ask for what they need
           * and get it, so this binds on nothing but a round of empty cells on
           * a very small screen. It is kept for that case: a 30px row of pick
           * labels beside a 60px row of drafted players reads as a mistake.
           *
           * IT FOLLOWS THE DENSITY, or it is not a floor but a wall. A fixed
           * 3.45rem is 55px, and at 1080p sixteen of those do not fit the band
           * however small the type inside them gets — so the density control
           * bottomed out against this and could not reach all sixteen rounds,
           * which is the thing it was widened to be able to do.
           *
           * IN FIT MODE IT HAS TO GO, along with every other `rem` length in
           * the cell, and the row becomes a query container instead: the grid
           * above has already decided how tall this round is, and `cqh` is how
           * the type inside asks. A floor here would be a row refusing the
           * height it was given, which is a board that overflows the band.
           */
          className={cn(
            "flex shrink-0 grow basis-auto gap-[0.25vw]",
            fit
              ? "min-h-0 [--ukl-cell-gap:0.8cqh] [--ukl-cell-pad:1.6cqh] [--ukl-strip:calc(var(--ukl-meta)*1.17)] [container-type:size]"
              : "min-h-[calc(3.45rem*var(--ukl-density,1))]",
          )}
          style={fit ? { ...rowWidth, ...fitType } : rowWidth}
        >
          <div
            className={cn(
              "bg-board-base border-border text-muted-foreground sticky left-0 z-[1] flex w-[var(--ukl-gutter)] shrink-0 items-center justify-center rounded border font-black tabular-nums",
              // In Fit the round's own height decides, same as every other
              // length in the row; in Scroll it follows the board's type.
              fit ? "text-[length:var(--ukl-pos)]" : "text-[length:var(--ukl-rail)]",
            )}
          >
            RD {round}
          </div>
          <div className="grid flex-1 gap-[0.25vw]" style={columns}>
            {(byRound.get(round) ?? []).map((slot) => (
              <Cell
                key={slot.id}
                slot={slot}
                nameLines={nameMode.lines}
                ownership={ownership}
                aimed={slot.id === aimedId}
                isTarget={slot.id === targetSlotId}
                fit={fit}
                onAim={onAim ? () => onAim(slot.id) : undefined}
                onPickMenu={onPickMenu}
              />
            ))}
          </div>
        </div>
      ))}
    </main>
  );
}

/**
 * "WR2 TE1" — what this franchise holds so far, by position.
 *
 * Spells the position out rather than using a coloured dot and a bare number.
 * The dots were unreadable as data: they asked the room to learn five hues and
 * then guess what was being counted. The letters are the same shorthand every
 * fantasy manager already reads, and they keep the hue as reinforcement rather
 * than as the only signal.
 */
function PositionCounts({ counts }: { counts: Record<string, number> }) {
  const order = ["QB", "RB", "WR", "TE", "DST"].filter((p) => counts[p]);
  if (order.length === 0) {
    return (
      <div className="text-muted-foreground/25 text-[length:var(--ukl-count)]">—</div>
    );
  }
  return (
    <div
      title={`Drafted so far: ${order.map((p) => `${counts[p]} ${p}`).join(", ")}`}
      className="flex flex-wrap items-center justify-center gap-x-[0.35vw] text-[length:var(--ukl-count)] font-black tabular-nums"
    >
      {order.map((pos) => (
        <span key={pos} className={positionText(pos)}>
          {pos}
          {counts[pos]}
        </span>
      ))}
    </div>
  );
}

/**
 * ONE LAYOUT, EVERY CELL.
 *
 * Every cell on the board — drafted, kept, traded, empty, on the clock — is
 * drawn through the same slots in the same order, and each slot holds its
 * height whether or not it has anything in it:
 *
 *   1. THE NAME, top-aligned, two lines reserved.
 *   2. THE POSITION TAG on the left, with the keeper padlock attached to its
 *      right in the tag's own colour; the pick's own number on the right.
 *   3. CLUB on the left, BYE on the right.
 *   4. THE OWNERSHIP STRIP, full width — on a board that draws one at all.
 *
 * The commissioner asked for this in those terms — "I want the names normalized
 * in terms of alignment (top alignment) in all cells… this needs to look
 * uniform and clean as fuck with all metadata showing" — and the reserved slots
 * are what deliver it. Nothing about a cell's contents can move a field: a
 * one-line name does not pull the club up, a keeper's padlock does not push the
 * position across, and a pick that was never traded still gives the strip its
 * line. So the same fact is at the same height in every column of every round,
 * and the board does not jump as picks land.
 *
 * SLOT 4 IS THE ONE THAT CAN BE ABSENT, AND IT IS ABSENT FROM ALL OF THEM OR
 * FROM NONE. The uniformity above is a claim about cells on the SAME board, and
 * `boardShowsOwnership` is decided once for the whole grid — so a redraft draws
 * three slots in all 150 and a keeper season draws four in all 150. What is
 * never allowed is a board where the answer differs by cell.
 *
 * IT IS ALSO WHAT ENDS THE OVERLAP. The strip used to be the last child of a
 * column that was allowed to shrink, so on a short window it came up over the
 * name — the failure the commissioner reported from a MacBook Air. A slot that
 * is always there cannot be floated over anything.
 *
 * WHAT EACH STATE CHANGES IS INK, NOT SHAPE. A drafted cell is tinted and
 * outlined in its POSITION hue; a keeper shows a padlock in the slot the
 * padlock always occupies; a traded pick fills the strip that is always drawn;
 * the cell on the clock is a solid accent fill with a glow. Not one of them
 * alters a dimension.
 */
const CELL_SLOTS = {
  /*
   * The name's reserved height is `lines × 1.15em` of `--ukl-name`, and BOTH
   * numbers are set once for the whole board: `--ukl-name-lines` is the layout
   * every cell uses, so a cell can never be a different height from its
   * neighbours because of what happens to be in it.
   *
   * `1.15` rather than `leading-tight`'s 1.25. 1.15em is about what the font's
   * own ascent and descent occupy, so it is the tightest line box that does not
   * shave a descender — and 0.1em a line, twice, across sixteen rounds is most
   * of a round of board.
   */
  name: "min-h-[calc(var(--ukl-name-lines,2)*1.15*var(--ukl-name))] w-full text-[length:var(--ukl-name)] leading-[1.15] font-extrabold tracking-[-0.01em] break-words hyphens-none",
  /*
   * `min-h-[1.15em]` on a row whose own font size is set, so the row keeps its
   * line with nothing in it. `items-center` rather than a baseline, because a
   * baseline needs text to find and half these rows are legitimately empty.
   */
  row: "flex w-full min-w-0 items-center justify-between gap-[0.3vw] min-h-[1.15em]",
  /** The right-hand column: the board's own coordinates, quiet and monospaced. */
  aside: "shrink-0 font-mono tabular-nums font-bold",
} as const;

function Cell({
  slot,
  aimed,
  isTarget,
  nameLines,
  ownership,
  fit = false,
  onAim,
  onPickMenu,
}: {
  slot: LiveSlot;
  aimed: boolean;
  isTarget: boolean;
  /** Board-wide, never per cell. See `boardNameMode`. */
  nameLines: 1 | 2;
  /** Whether this board draws the ownership strip at all. Board-wide too. */
  ownership: boolean;
  fit?: boolean;
  onAim?: () => void;
  onPickMenu?: (slot: LiveSlot, x: number, y: number) => void;
}) {
  const empty = slot.fill === null;
  const player = slot.player;
  /* Forename over surname when the board is in two-line mode. */
  const name = player ? splitBoardName(player.name, player.position) : null;
  /*
   * A keeper is not the commissioner's to move: it comes from the Smart Draft
   * snapshot rather than from anything typed here, so the cursor skips it and
   * a right-click on it gets the browser's own menu rather than ours.
   */
  const selectable = Boolean(onAim) && slot.fill !== "keeper";
  const removable = Boolean(onPickMenu) && slot.fill === "pick";
  /*
   * The club, the bye and the pick number. Knocked out of the accent fill on the
   * cell that is on the clock, and off the muted token everywhere else.
   *
   * AT FULL STRENGTH, BECAUSE THE `/80` WAS FAILING AA ON ITS OWN BOARD. The
   * token is 7.8:1 on the plain canvas and the alpha threw that away against the
   * five tinted position fills — measured on this board, not assumed from
   * another: 4.38:1 over a WR mint cell and 4.41:1 over a TE amber one, both
   * under the 4.5 floor, with QB, DST and RB scraping past at 4.67 to 4.69.
   * Dropping the alpha is the whole fix; nothing about the token was wrong.
   *
   * It stays secondary by being SMALLER and LIGHTER IN WEIGHT than the name,
   * which is 15:1 or better on every fill and still dominates the cell by a
   * factor of two and a half. Fading a thing to the edge of legibility is not
   * hierarchy, and it is what was being corrected here.
   */
  const quiet = isTarget ? "text-primary-foreground" : "text-muted-foreground";

  return (
    <div
      data-slot-id={slot.id}
      onClick={selectable ? onAim : undefined}
      onContextMenu={
        removable
          ? (event) => {
              event.preventDefault();
              onAim?.();
              onPickMenu!(slot, event.clientX, event.clientY);
            }
          : undefined
      }
      /*
       * Every cell carries `title="{label} — …"`; the verify script finds cells
       * by that prefix. What follows it spells out the abbreviations the cell
       * prints, so "BYE 11" is decodable without asking anyone.
       */
      title={
        (slot.traded
          ? `${slot.label} — ${slot.originalOwner.name}'s pick, now ${slot.currentOwner.name}`
          : `${slot.label} — ${slot.currentOwner.name}`) +
        (isTarget ? " · on the clock" : "") +
        playerDetail(slot) +
        (removable ? " · right-click to delete this pick" : "")
      }
      /*
       * No `overflow-hidden`. Clipping is the one thing this cell must never do,
       * and a box that quietly hides what it cannot fit is how the strip came to
       * be sitting on a name for a week without anybody being able to point at
       * the cause. Everything here is sized to fit; if that ever stops being
       * true it will be visible instead of silent.
       */
      className={cn(
        "relative flex min-w-0 flex-col rounded border leading-none transition-colors",
        SCROLL_CLEARANCE,
        /*
         * The cell on the clock is the only mark on the board that fills a whole
         * cell and the only one that glows, so it stays first in the hierarchy
         * however bright anything else gets — which is load-bearing against
         * twenty-nine white ownership strips. It wins on treatment and area
         * rather than on hue, which is also what stops a solid accent cell being
         * mistaken for the WR cells that share the hue.
         *
         * A completed cell is tinted and outlined in its POSITION hue instead,
         * which is what lets a column be read positionally from across the room.
         */
        isTarget
          ? "border-live bg-live glow-live"
          : empty
            ? EMPTY_CELL
            : positionCell(player?.position),
        /*
         * In Fit mode the word ACTIVE is about seven pixels tall and the room
         * is not reading it — the solid fill is doing all the work, in a grid
         * that is now twice as dense. A ring outside the fill separates it from
         * its neighbours without costing the row any height, because a ring is
         * a shadow and does not lay out.
         */
        fit && isTarget && "ring-live ring-offset-background ring-2 ring-offset-1",
        // The cursor parked on an entered pick is aimed at deleting it, so it
        // is outlined in the destructive hue rather than the neutral accent.
        aimed &&
          (isTarget
            ? "ring-primary ring-2 ring-offset-2 ring-offset-background"
            : empty
              ? "ring-primary ring-2"
              : "ring-destructive ring-2"),
        selectable && "cursor-pointer",
      )}
    >
      {/*
        The vertical padding is measured DOWN and the horizontal padding ACROSS,
        which sounds obvious and was not: `0.3vw` on all four sides grew the top
        padding to 5.8px on a wide screen, on the axis that had none to spare.
      */}
      {/*
        THE CHROME IS WHERE THE ROUNDS WENT. At `0.3vh` a side this padding cost
        8.5px of every row on the 1080p signal, and the gaps between the slots
        another 6.5 — better than a fifth of a round of board, spent on space
        that carries nothing. The type is not what was making the board sparse.
      */}
      {/*
        The vertical padding and the gaps are measured off `--ukl-cell-pad` and
        `--ukl-cell-gap` rather than off the viewport, so Fit mode can hand them
        a share of the ROUND. `0.14vh` does not know how tall the round it is
        sitting in turned out to be, and at a 40px round it is most of a line.
      */}
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--ukl-cell-gap)] px-[0.35vw] py-[var(--ukl-cell-pad)] max-md:gap-[1px] max-md:px-[3px] max-md:py-[2px]">
        {/*
          SLOT 1 — THE NAME, IN FULL, ON TWO LINES.

          Forename over surname, split deliberately rather than left to word
          wrap, so a column can be read down the surnames. See `splitBoardName`.

          Nothing is shortened. It used to take an initial ("J. Smith-Njigba"),
          which bought uniform one-line cells back when sixteen rounds had to fit
          a 1080p screen; the projector turns out to be floor-to-ceiling with an
          unreadable bottom edge, TV mode is getting its own scroll, and the bar
          is now that nothing on the board is cut at all.

          The type is sized against the longest single TOKEN in the top 200 by
          ADP rather than the longest name in a 730-player pool, which is the
          commissioner's own scoping of the problem and where most of the size
          increase came from. `scripts/verify-board-fit.mjs` holds it to that
          against the real ADP file.
        */}
        <div
          className={cn(
            CELL_SLOTS.name,
            isTarget
              ? "text-primary-foreground tracking-[0.06em]"
              : "text-foreground",
          )}
        >
          {nameLines === 2 ? (
            <>
              <div>{isTarget ? "ACTIVE" : name?.first}</div>
              <div>{name?.last}</div>
            </>
          ) : (
            <div>{isTarget ? "ACTIVE" : player?.name}</div>
          )}
        </div>

        {/* SLOT 2 — position, and the pick's own number. */}
        <div className={cn(CELL_SLOTS.row, "text-[length:var(--ukl-pos)] font-black")}>
          {/*
            THE PADLOCK IS PART OF THE POSITION TAG, NOT A FIELD OF ITS OWN.

            It sits inside the tag's own span, immediately to its right, and
            takes its colour from `currentColor` — so it is green beside WR, gold
            beside TE, pink beside QB, and the two cannot drift apart, because
            there is only one colour being set. The commissioner asked for
            exactly that: "the lock to the right of the position tag, like right
            next to it, as the same color as the position tag… they need to be
            kinda evident."

            AFTER the tag rather than before it, which is what keeps the column
            alignment the last arrangement was protecting. A padlock in front of
            the letters indented "WR" past the name above it in nineteen cells
            and nowhere else; behind them, the tag still starts on the same pixel
            in all 160 and the lock spends the space the row had going spare.

            Reserved in every cell and hidden with `visibility` in the 141 that
            are not keepers, the same technique the ownership strip uses, so a
            keeper and an ordinary pick are the same shape to the pixel.

            IT IS THE STROKE THAT MAKES IT EVIDENT, NOT THE SIZE. At 1.05em and
            a 2.75 stroke it drew a 1.7px line beside letters whose own stems are
            2.2px, and from a seat it read as a smudge rather than as a mark. A
            3.2 stroke on lucide's 24-unit box is 2.1px here, which is the tag's
            own weight. `1.15em` is the row's own `min-h`, so the heavier lock
            costs the board no height at all — a larger one would grow all 160
            rows and the rounds are worth more than the millimetre.
          */}
          <span
            className={cn(
              "flex min-w-0 items-center gap-[0.3em]",
              isTarget ? "text-primary-foreground" : positionText(player?.position),
            )}
          >
            {player?.position}
            <Lock
              aria-label="Keeper"
              className={cn(
                "h-[1.15em] w-[1.15em] shrink-0",
                slot.fill !== "keeper" && "invisible",
              )}
              strokeWidth={3.2}
            />
          </span>
          {/*
            THE PICK NUMBER IS BACK ON FILLED CELLS. It was dropped from them as
            redundant — the row says "RD 4" and the column says whose it is — and
            for a while that was worth the ~22px it bought. It is not worth an
            empty cell and a drafted cell being different shapes, which is what
            printing it in only one of them means.
          */}
          <span className={cn(CELL_SLOTS.aside, "text-[0.8em]", quiet)}>
            {slot.label}
          </span>
        </div>

        {/*
          SLOT 3 — club and bye, asked for by a league member: "include the city
          abbreviation and the bye week for each player in the box." Both are
          things the room argues about mid-draft — three receivers on one bye, a
          third Chief in four rounds — and neither was anywhere on the screen.

          "BYE" is spelled out. A bare "· 11" under a pick number reading "1.04"
          is two numbers meaning different things, which is how a bye week gets
          read as a round from fifteen feet away.
        */}
        <div
          className={cn(
            CELL_SLOTS.row,
            "font-mono text-[length:var(--ukl-meta)] font-bold",
            quiet,
          )}
        >
          {/* "FA" rather than blank: several drafted players are genuinely unsigned. */}
          <span className="min-w-0 break-words">{player ? (player.nflTeam ?? "FA") : null}</span>
          <span className={cn(CELL_SLOTS.aside, "tabular-nums")}>
            {player?.byeWeek != null ? `BYE ${player.byeWeek}` : null}
          </span>
        </div>
      </div>

      {/*
        SLOT 4 — who actually owns the pick. Drawn in every cell, or in none of
        them: `ownership` is a board-wide answer, so the cells stay uniform
        whichever way it goes. See `TradeBanner` and `boardShowsOwnership`.
      */}
      {ownership && <TradeBanner owner={slot.currentOwner.name} traded={slot.traded} />}
    </div>
  );
}

/** The unabbreviated version of what a filled cell shows, for its tooltip. */
function playerDetail(slot: LiveSlot): string {
  const player = slot.player;
  if (!player) return "";
  const parts = [
    player.position,
    player.nflTeam ?? "free agent",
    player.byeWeek != null ? `bye week ${player.byeWeek}` : null,
    slot.fill === "keeper" ? "keeper" : null,
  ].filter(Boolean);
  return ` · ${player.name} (${parts.join(", ")})`;
}

/**
 * "SF · BYE 8" — the NFL club and the bye week, under the player's name.
 *
 * Asked for after a league member read the board: "include the city
 * abbreviation and the bye week for each player in the box." Both are things
 * the room argues about mid-draft — whether somebody has stacked three
 * receivers on one bye, or taken the third Chief in four rounds — and neither
 * was anywhere on the screen.
 *
 * THE ROSTER WALL'S VERSION. The board's grid cells carry the same two facts in
 * two slots of their own — club left, bye right — because there they have to
 * line up with 159 other cells. A roster row has no such neighbour and reads
 * better as one run of text.
 *
 * "BYE" is spelled out. A bare "· 11" under a pick number reading "1.04" is two
 * numbers meaning different things, which is how a bye week gets read as a round
 * from fifteen feet away.
 */
export function PlayerMeta({
  nflTeam,
  byeWeek,
}: {
  nflTeam: string | null;
  byeWeek: number | null;
}) {
  return (
    <span
      className={cn(
        /*
         * `leading-tight`, not `leading-none`. A line box of exactly 1em is
         * shorter than the font's own glyph box — ascent plus descent runs
         * about 1.15em — and this span carries `truncate`, so overflow is
         * hidden and the difference is a real 2px shave off the type rather
         * than harmless spill. It only became visible once the size went up
         * for the projector, but it was always wrong.
         */
        "text-muted-foreground/85 w-full min-w-0 truncate font-mono text-[clamp(0.5rem,0.58vw,0.9rem)] leading-tight font-bold tabular-nums",
      )}
    >
      {/* "FA" rather than blank: several drafted players are genuinely unsigned. */}
      {nflTeam ?? "FA"}
      {byeWeek != null && ` · BYE ${byeWeek}`}
    </span>
  );
}

/**
 * DOES THIS BOARD DRAW AN OWNERSHIP STRIP AT ALL.
 *
 * The strip is reserved in every cell so that a traded pick and an untraded one
 * are the same shape — and the reservation is worth having exactly as long as
 * some cell might use it. @fromProposal Section 6 forbids trading picks in this
 * league, so in 2026 no cell ever can, and the reserved line is a line of every
 * one of the 150 cells spent on a fact that cannot occur. At 1080p that is
 * 11.7px a round: better than two rounds of board.
 *
 * SO IT IS GATED, NOT DELETED. `FEATURES.tradedPicks` is the switch, the same
 * one `verify-board-fit.mjs` reads, and `TradeBanner` below is untouched: a
 * season that votes pick trading back in flips the flag and the layout returns
 * without anyone rebuilding it.
 *
 * THE DATA IS THE SECOND HALF OF THE ANSWER, and it is what stops the flag
 * hiding a fact. If any slot on this board really has changed hands — a stray
 * traded pick in a snapshot, a flag that got out of step with the file — the
 * strip comes back for all 150 cells rather than being suppressed on the one
 * cell that needed it. The board can be wrong about the league's rules; it must
 * never be wrong about who owns a pick.
 *
 * Board-wide, never per cell. A strip on some cells and not others is the exact
 * non-uniformity the reservation exists to prevent.
 */
function boardShowsOwnership(slots: LiveSlot[]): boolean {
  return FEATURES.tradedPicks || slots.some((slot) => slot.traded);
}

/**
 * Who actually owns this pick — the bottom slot of every cell on the board.
 *
 * The column header names the ORIGINAL owner, so without this a traded pick
 * reads as having gone to the wrong franchise. A full-width strip rather than a
 * badge because it reads as a property of the whole cell. Same treatment on
 * picked and unpicked slots: ownership does not change when the pick is made.
 *
 * DRAWN IN EVERY CELL OF A BOARD THAT DRAWS IT AT ALL, HIDDEN IN THE ONES IT
 * HAS NOTHING TO SAY ABOUT — see `boardShowsOwnership` for the "at all".
 * `invisible` is `visibility: hidden`, which keeps the box and its height, so a
 * traded cell and an untraded one are the same shape and every field above the
 * strip sits at the same offset in both. That is what the commissioner asked
 * for, and it is also the end of the bug he reported: the strip used to be
 * rendered only when it had something to say, into whatever space a shrinking
 * column had left over, which on a MacBook Air was the bottom of the name.
 *
 * Neutral, and not because ownership deserves to be quiet — see `--trade` in
 * `globals.css`. Hue on this board means POSITION, so the one mark that is not a
 * position is the one mark with no hue; that is what makes a strip unmistakable
 * over an orange QB cell and a violet DST cell alike.
 *
 * OFF-WHITE, NOT THE FULL `--trade` WHITE. The token is the board's brightest
 * ink, and twenty-nine strips of it read from the back of the room as flashes
 * going off across a black grid rather than as annotation — a league member's
 * first word for it was "aggressive". `neutral-200` is a tenth off it, which
 * keeps the bar unmistakable without the glare.
 *
 * It used to let a fifth of the cell through at `/80`, on the reasoning that
 * the translucency took more glare out. It did, and it also took the strip down
 * to a muddy #babcc0 that came out a different grey in every column, because
 * what showed through was the position fill — so the one mark on the board that
 * is deliberately hueless was picking up a hue from whatever it sat on. Opaque
 * is brighter, cleaner, and the same in all twenty-nine.
 *
 * It stays subordinate to the on-the-clock cell by being a thin strip against a
 * full-cell fill, and now by lightness as well.
 */
function TradeBanner({ owner, traded }: { owner: string; traded: boolean }) {
  return (
    <span
      className={cn(
        /*
         * The arrow is `1em`, the height of the words beside it. At `1.15em` it
         * was the tallest thing in the strip and stood the whole bar 4px taller
         * than it needed to be, on the axis the cell has least of.
         *
         * `rounded-b-[3px]` because the cell no longer clips its children: 3px
         * is what is left of the cell's 4px radius inside a 1px border.
         */
        /*
         * BIGGER TYPE IN THE SAME BOX. Who owns a traded pick is not reference
         * detail — a bye week is something you look up when you care, but a
         * pick that has changed hands is the single most confusing thing on a
         * board and the room scans for it live. So it does not belong on the
         * 12-arcminute floor that `--ukl-meta` sits on with the bye week; it
         * belongs up near the position tag's band.
         *
         * `--ukl-strip` is `--ukl-meta` × 1.17, which is 13px on the 1080p
         * signal and 14.5 arcminutes from the furthest seat, up from 11.1px and
         * 12.4. It is still a multiple of `--ukl-meta`, so it still follows the
         * density control and still cannot outgrow the row.
         *
         * AND IT COSTS THE BOARD NOTHING, which is the only reason it is
         * allowed. The old box was 1.05em of 11.14px — 11.69px holding a cap
         * just 8.1px tall, so a third of the bar was empty. `0.9` of the new
         * 13px is 11.70px: the same bar to a hundredth of a pixel, now holding a
         * 9.45px cap. A line box under 1em is safe here and only here, because
         * these handles are uppercase and there is no descender to protect.
         * The arrow comes down to `0.85em` for the same reason — at `1em` it
         * would be 13px and would stand the bar 1.3px taller on its own, which
         * across sixteen rounds is most of the round this change refuses to
         * spend. Rounds-visible is asserted, not assumed.
         *
         * OPAQUE, WHICH IS WHERE THE BRIGHTNESS CAME FROM. At `/80` a fifth of
         * the cell came through, so the bar landed near #babcc0 — and landed on
         * a DIFFERENT grey in every column, tinted by the position fill behind
         * it: #babcc0 over an RB, #bbbfbc over a WR, #c0babd over a QB. Muddy,
         * and inconsistent across a board whose whole argument is uniformity.
         * Opaque `neutral-200` is one clean #e5e5e5 in all twenty-nine, which is
         * the "touch more brightness" that was asked for and takes the ink from
         * 10.5:1 to about 15:1 against it. Still `neutral-200` rather than the
         * full `--trade` white, which is the token that read as glare.
         *
         * `rounded-b-[3px]` because the cell no longer clips its children: 3px
         * is what is left of the cell's 4px radius inside a 1px border.
         */
        "text-background flex min-w-0 shrink-0 items-center justify-center gap-[0.2vw] rounded-b-[3px] bg-neutral-200 px-[0.25vw] text-[length:var(--ukl-strip)] leading-[0.9] font-black tracking-[0.03em] uppercase max-md:px-[2px]",
        !traded && "invisible",
      )}
    >
      <ArrowRight className="h-[0.85em] w-[0.85em] shrink-0" strokeWidth={3} />
      {/* Wraps rather than shortens: these are three-to-six character handles,
          and the column floor is wide enough for the arrow and the longest of
          them — but a handle is a name, and names are not cut on this board. */}
      <span className="min-w-0 break-words">{owner}</span>
    </span>
  );
}

/**
 * The board has stopped following, and it is going to start again on its own.
 *
 * The countdown is the load-bearing part. A board that has silently stopped
 * following is the exact failure auto-follow exists to prevent, and in a room
 * of ten nobody is going to hunt for a control to switch it back on — so the
 * eight seconds are the mechanism and this only says so out loud. Clicking it,
 * or pressing Escape, is the shortcut for somebody who is already done looking.
 *
 * INSIDE THE BAND, not at the bottom of the viewport. A notice about the board
 * that is printed on the part of the screen nobody can read is not a notice.
 */
export function FollowPill({
  label,
  seconds,
  onResume,
}: {
  /** The pick it will go back to — "4.06" — so the promise is specific. */
  label: string | null;
  seconds: number;
  onResume: () => void;
}) {
  const band = useBand();
  return (
    <button
      type="button"
      data-follow-pill
      onClick={onResume}
      style={{ bottom: `calc(${band.bottomInset} + 1vh)` }}
      className="border-warning/70 bg-background/95 text-warning fixed left-[1vw] z-[54] flex items-center gap-[0.5vw] rounded-full border-2 px-[0.9vw] py-[0.4vh] text-[clamp(0.6rem,0.9vw,1.15rem)] font-black tracking-[0.06em] uppercase shadow-2xl backdrop-blur-sm"
    >
      Not following
      <span className="text-muted-foreground font-semibold tabular-nums">
        {label ? `· back to ${label} in ${seconds}s` : `· resuming in ${seconds}s`}
      </span>
    </button>
  );
}

// --- Pick announcement ------------------------------------------------------

/**
 * A band across the middle of the board for about a second after a pick lands.
 *
 * This is the confirmation step, moved off the operator and onto the room. He
 * is looking at his hands; the other nine are looking at the TV, and one of
 * them knows which Williams was called. So it carries the four facts that
 * separate a right entry from a plausible wrong one — who, what, where he
 * plays, and who just got him — at a size that argues from fifteen feet.
 *
 * When the pick was a knowing duplicate it says so, because in this league that
 * is not an error condition, it is a forfeit: pick somebody already taken and
 * you take a shot. The board announcing it to the room is the point.
 */
export function FlashOverlay({ flash }: { flash: Flash }) {
  /*
   * CENTRED IN THE BAND, NOT IN THE SCREEN. `inset-0` centres against the whole
   * projection, whose bottom third is on the floor — so at a tight safe area
   * the lower half of the announcement, which is the position, the club, the
   * bye and the franchise that just picked, falls below every sightline in the
   * room. The announcement is the room's; it goes where the room is looking.
   */
  const band = useBand();
  return (
    <div
      aria-live="polite"
      style={{ top: band.topInset, bottom: band.bottomInset }}
      className="pointer-events-none fixed inset-x-0 z-[55] flex items-center justify-center"
    >
      <div
        className={cn(
          "ukl-flash bg-background/92 relative w-full overflow-hidden border-y-4 py-[3vh] shadow-2xl backdrop-blur-[3px] max-md:py-4",
          // Drives the trim, the wash and the portrait's ring and halo. A
          // knowing duplicate takes the warning hue instead: the position is
          // not the story when the story is that he is already gone.
          flash.duplicate ? "[--flash-hue:var(--color-warning)]" : flashHue(flash.position),
        )}
      >
        <div className="ukl-flash-wash absolute inset-0" />

        {/*
          PORTRAIT AND TYPE ARE ONE CENTRED GROUP, not a centred paragraph with
          a picture floating beside it. The group grows to the right as the name
          gets longer, which is why the wash behind it is centred too.
        */}
        <div className="relative mx-auto flex max-w-[95vw] items-center justify-center gap-[2.2vw]">
          {/*
            Keyed on the pick, so a new announcement gets a new component and
            cannot inherit the previous player's failed-image state.
          */}
          <PickHeadshot key={flash.seq} flash={flash} />

          {/*
            `min-w-0` is what makes the truncation below able to fire at all: a
            flex item defaults to its content's minimum width, so without this
            a long name would push the group off both edges rather than shrink.
          */}
          <div className="min-w-0 text-left max-md:text-center">
            <div
              data-flash-label
              className={cn(
                "text-eyebrow text-[clamp(0.7rem,1.2vw,1.6rem)] tabular-nums",
                flash.duplicate ? "text-warning" : "text-primary/85",
              )}
            >
              {flash.duplicate ? `${flash.label} · already gone · that's a shot` : flash.label}
            </div>

            {/*
              `data-flash-name` is the handle `scripts/verify-draft-typing.mjs`
              measures for clipping. It is an attribute rather than a position
              in the child list precisely so this composition can be rearranged
              without the test quietly starting to measure the wrong element.
            */}
            <div
              data-flash-name
              className={cn(
                "font-display mt-[0.5vh] truncate font-bold uppercase",
                // A phone is narrow enough that the clamp floors — set for a
                // projector — would print the announcement past both edges.
                nameSize(flash.name),
                /*
                 * AFTER the size, and that is not arbitrary. `text-*` and
                 * `leading-*` are one conflict group to tailwind-merge, because
                 * Tailwind's named text sizes carry a line height — so a size
                 * class listed later silently deletes the leading. It did: this
                 * band spent its whole life setting `leading-none` ahead of the
                 * size and rendering at the 1.5 default, which is where the
                 * dead air above and below the name came from.
                 *
                 * `leading-tight`, not `leading-none`, for the reason spelled
                 * out on `PlayerMeta` — a 1em line box is shorter than the
                 * font's own glyph box, and this element clips.
                 */
                "leading-tight",
              )}
            >
              {flash.name}
            </div>

            {/*
              The header behind this has already moved on to the next franchise,
              so the flash is the only thing on screen naming the one that just
              picked. It is sized to be argued with from the back of the room,
              not read.
            */}
            <div
              data-flash-meta
              className="mt-[1.5vh] flex flex-wrap items-center gap-[0.9vw] text-[clamp(0.95rem,1.9vw,2.4rem)] leading-none font-bold max-md:justify-center max-md:gap-2 max-md:text-[12px]"
            >
              <span
                className={cn(
                  "rounded px-[0.7vw] py-[0.35vh] ring-1 max-md:px-1.5 max-md:py-0.5",
                  positionStyle(flash.position),
                )}
              >
                {flash.position}
              </span>
              <span className="text-muted-foreground font-mono">
                {flash.nflTeam ?? "FA"}
              </span>
              {/* The bye the board cells now print, said once at announcement size. */}
              {flash.byeWeek != null && (
                <span className="text-muted-foreground/70 tabular-nums">
                  BYE {flash.byeWeek}
                </span>
              )}
              {/* Who just got him is the punchline, so it is the one thing in
                  this row set above the row's own size. */}
              <span className="text-muted-foreground/30">→</span>
              <span className="text-primary font-display text-[1.2em] uppercase">
                {flash.team}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The band's accent, taken from the position the pick just filled.
 *
 * Hue means POSITION everywhere else on this board, and the announcement had
 * been the one place it meant nothing — every pick framed in the same accent
 * cyan. Tying the trim, the wash and the portrait's ring to the position hue
 * makes the band say "a running back went" before a word of it is read, and it
 * introduces no colour: these are the same five tokens the cells are drawn in.
 *
 * The pick number and the drafting franchise stay cyan. Those are league facts
 * rather than player facts, and leaving them on the accent keeps the band from
 * turning into a single-colour wash.
 */
const FLASH_HUE: Record<string, string> = {
  QB: "[--flash-hue:var(--color-pos-qb)]",
  RB: "[--flash-hue:var(--color-pos-rb)]",
  WR: "[--flash-hue:var(--color-pos-wr)]",
  TE: "[--flash-hue:var(--color-pos-te)]",
  DST: "[--flash-hue:var(--color-pos-dst)]",
  DEF: "[--flash-hue:var(--color-pos-dst)]",
};

function flashHue(pos: string | null | undefined): string {
  return FLASH_HUE[pos ?? ""] ?? "[--flash-hue:var(--color-primary)]";
}

/**
 * How big the name can be printed, given how much of it there is.
 *
 * The portrait takes about 280px off the middle of a 1080p band, so the name no
 * longer has the whole width to spend and a single clamp cannot serve both
 * "CJ Stroud" and "Washington Commanders" — the longest thing in the pool at
 * twenty-one characters. Four steps rather than the two this used to have,
 * each sized so the worst name in its band still clears the type by a margin at
 * 1920: the widest case lands near 1,400px of a 1,480px allowance.
 *
 * `truncate` is the backstop and must never actually fire. An ellipsis on this
 * band is a failure, not a fallback, and `verify-draft-typing.mjs` asserts it
 * on the longest defense for exactly that reason.
 */
function nameSize(name: string): string {
  if (name.length <= 14) return "text-[clamp(2.2rem,7.4vw,9.2rem)] max-md:text-[30px]";
  if (name.length <= 19) return "text-[clamp(1.9rem,5.6vw,7rem)] max-md:text-[26px]";
  if (name.length <= 24) return "text-[clamp(1.6rem,4.4vw,5.5rem)] max-md:text-[22px]";
  return "text-[clamp(1.4rem,3.6vw,4.5rem)] max-md:text-[19px]";
}

/**
 * The player's face, at the size the band is now built around.
 *
 * IT IS THE FOCAL POINT, NOT AN AVATAR. This was an 11vh square parked in the
 * left margin — 118px against a 157px name, which is how it came to read as a
 * thumbnail somebody had bolted on. At 26vh it stands taller than the name is
 * tall and it sits in flow beside it, so the band is a portrait with the pick
 * written next to it rather than a headline with a stamp in the corner.
 *
 * IT ALWAYS OCCUPIES ITS BOX, and that is what replaces the absolute
 * positioning this used to need. The requirement has not changed — a missing or
 * slow image must never move the type — but a flex item at a fixed size in the
 * band's own vh units reserves the space before the image exists just as
 * completely as taking it out of flow did, and unlike absolute positioning it
 * lets the portrait and the name actually be composed together.
 *
 * Hidden below `md`. On a phone the band is 30px of name across the whole
 * screen and there is no room beside it; the projector, which is what this
 * feature is for, has room to spare.
 *
 * The fallback is his initials in the position's own colour — the same
 * treatment the position chip gets two lines down — rather than a broken image
 * or a stranger's grey silhouette. FantasyPros has a headshot for most of the
 * board but not all of it, and the ones it lacks are exactly the late-round
 * names nobody expects a picture of anyway. Nothing about the box changes when
 * it draws: same size, same ring, same halo.
 */
function PickHeadshot({ flash }: { flash: Flash }) {
  const [failed, setFailed] = useState(false);

  const initials = flash.name
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");

  const show = flash.headshotUrl && !failed;

  return (
    <div
      aria-hidden
      /*
       * `data-flash-portrait` is how `scripts/verify-draft-typing.mjs` finds
       * this box to prove the initials draw with the CDN unreachable. It used
       * to find it as the band's only `aria-hidden` descendant, which was true
       * by accident and stopped being true the moment the band grew a
       * decorative layer.
       */
      data-flash-portrait
      className={cn(
        "ukl-flash-portrait hidden shrink-0 overflow-hidden rounded-2xl md:block",
        "h-[clamp(6rem,26vh,17rem)] w-[clamp(6rem,26vh,17rem)]",
        // The tint under the picture, and the whole of it when there is no
        // picture: the position's own hue, as everywhere else on the board.
        positionStyle(flash.position),
      )}
    >
      {show ? (
        /*
          A plain <img>, not next/image, and this is the one place in the app
          that is true.

          next/image would route every headshot through the optimizer, which is
          a server round trip on first sight of each player. That is free on a
          page that renders before it is read; it is not free here, where the
          image has about three seconds to appear and the draft has 160 picks
          of players nobody has requested before. The URL is already an
          optimised 250px PNG from FantasyPros' own CDN, displayed at roughly
          that size, so there is nothing for the optimizer to save — and going
          direct removes our own deployment from the path between the board and
          the picture.

          Nothing here can block or delay the pick: the box holds its size
          whether or not the image ever arrives, decoding is async, and a
          failure swaps in the initials that were the fallback anyway.
        */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={flash.headshotUrl!}
          alt=""
          decoding="async"
          className="h-full w-full object-cover object-top"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="font-display flex h-full w-full items-center justify-center text-[clamp(2rem,9vh,6rem)] leading-none font-bold">
          {initials}
        </span>
      )}
    </div>
  );
}

// --- Typing overlay ---------------------------------------------------------

/**
 * The name box and its ranked matches.
 *
 * Appears only once something has been typed and shows only what matched.
 * It is NOT a player list — see the note at the top of this file.
 */
export function MatchOverlay<T extends Searchable>({
  query,
  matches,
  selected,
  holderOf,
  onPick,
}: {
  query: string;
  matches: ReturnType<typeof searchPlayers<T>>;
  selected: number;
  holderOf: (playerId: string) => LiveSlot | null;
  onPick: (player: T) => void;
}) {
  /* Sits on the band's bottom edge in TV mode, where it is read, rather than on
     the viewport's, where it is on the floor. */
  const band = useBand();
  return (
    /* Lifted clear of `TouchPickBar` where there is one, so the box a phone is
       typing into is never the thing covering its own results. */
    <div
      style={band.tvMode ? { bottom: band.bottomInset } : undefined}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-[2vw] pb-[1vh] touch:bottom-12 touch:px-2 portrait:touch:bottom-[3.75rem]"
    >
      <div className="surface-raised border-primary/60 pointer-events-auto w-full max-w-[70vw] overflow-hidden rounded-xl border-2 shadow-2xl max-md:max-w-full">
        <div className="border-border/60 bg-background/80 flex items-baseline gap-[1vw] border-b px-[1.2vw] py-[0.8vh] max-md:px-3 max-md:py-1.5">
          <span className="text-primary font-display text-[clamp(1.4rem,2.6vw,3rem)] leading-none font-bold">
            {query}
            <span className="animate-pulse">▌</span>
          </span>
          {/* The keyboard grammar is the only thing here that is untrue on a
              phone, so it is the only thing a phone drops. */}
          <span className="text-muted-foreground/60 ml-auto shrink-0 text-[clamp(0.55rem,0.75vw,0.95rem)] touch:hidden">
            Enter drafts · ↑↓ choose · Esc clears
          </span>
          <span className="text-muted-foreground/60 ml-auto hidden shrink-0 text-[11px] touch:inline">
            Tap a name to draft him
          </span>
        </div>

        {matches.length === 0 ? (
          <p className="text-muted-foreground px-[1.2vw] py-[1.5vh] text-[clamp(0.8rem,1.2vw,1.5rem)] max-md:px-3 max-md:py-3 max-md:text-[13px]">
            No player matches that.
          </p>
        ) : (
          <ul>
            {matches.map((match, i) => {
              const holder = match.drafted ? holderOf(match.item.id) : null;
              return (
                <li key={match.item.id}>
                  <button
                    type="button"
                    onClick={() => onPick(match.item)}
                    className={cn(
                      // 44px of row on a touch screen: this is the one control
                      // that actually enters a pick, so it is the last place
                      // worth saving height on.
                      `flex w-full items-center gap-[0.8vw] px-[1.2vw] text-left transition-colors max-md:gap-2 max-md:px-3 ${TAP}`,
                      i === selected
                        ? "bg-primary text-primary-foreground py-[0.9vh]"
                        : "hover:bg-muted/50 py-[0.6vh]",
                    )}
                  >
                    <span
                      className={cn(
                        "w-[3.5vw] shrink-0 rounded px-[0.3vw] py-[0.1vh] text-center text-[clamp(0.55rem,0.8vw,1rem)] font-bold ring-1 max-md:w-9 max-md:py-0.5 max-md:text-[11px]",
                        i === selected
                          ? "bg-primary-foreground/15 ring-primary-foreground/30"
                          : positionStyle(match.item.position),
                      )}
                    >
                      {match.item.position}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate font-bold",
                        i === selected
                          ? "text-[clamp(1.3rem,2.3vw,2.6rem)] max-md:text-[15px]"
                          : "text-[clamp(0.9rem,1.4vw,1.7rem)] max-md:text-[13px]",
                      )}
                    >
                      {match.item.name}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[clamp(0.6rem,0.9vw,1.1rem)] max-md:text-[11px]",
                        i === selected ? "opacity-80" : "text-muted-foreground/70",
                      )}
                    >
                      {match.item.nflTeam ?? "FA"}
                    </span>
                    {holder && (
                      <span className="bg-destructive/20 text-destructive shrink-0 rounded px-[0.4vw] py-[0.1vh] text-[clamp(0.55rem,0.78vw,0.95rem)] font-bold max-md:px-1 max-md:text-[10px]">
                        TAKEN · {holder.label} {holder.currentOwner.name}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * The name box, for a device that has no keyboard to capture.
 *
 * The whole board is built on `useDraftTyping` listening at the document, which
 * is right for the one practiced operator at the keyboard on Saturday and is
 * simply unusable on a phone: there is nothing focusable, so there is no way to
 * raise the soft keyboard, so a league member running a mock from their sofa
 * cannot enter a single pick.
 *
 * So this is an actual `<input>`, and it drives the SAME state — it calls the
 * hook's `setQuery`, and the results are the hook's own ranked matches in
 * `MatchOverlay`, which are already tappable. Nothing about the keyboard
 * grammar is reimplemented or forked; `onKey` bails out on any event whose
 * target is an input, so the two paths cannot fight over a keystroke.
 *
 * `pointer: coarse` rather than a width breakpoint, because the thing being
 * asked is not "is this screen narrow" but "does this device have a keyboard".
 * A phone turned sideways is 915px wide and still has no keys. On any laptop or
 * the projector this never renders at all.
 */
export function TouchPickBar({
  query,
  onQuery,
  enabled,
  waitingOn,
}: {
  query: string;
  onQuery: (next: string) => void;
  /** False while it is not this device's turn — a bot is on the clock. */
  enabled: boolean;
  /** Who the board is waiting for, when it is not this device. */
  waitingOn?: string | null;
}) {
  return (
    <div className="bg-background/95 border-border/60 fixed inset-x-0 bottom-0 z-[62] hidden shrink-0 items-center gap-2 border-t px-2 py-1.5 backdrop-blur-sm touch:flex portrait:py-2">
      <input
        type="text"
        value={query}
        disabled={!enabled}
        onChange={(event) => onQuery(event.target.value)}
        placeholder={
          enabled
            ? "Type a player's name…"
            : waitingOn
              ? `${waitingOn} is on the clock`
              : "Not your pick"
        }
        // No autocorrect: it rewrites surnames, and the board's own matcher is
        // already forgiving about spelling.
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        className="border-border bg-card text-foreground placeholder:text-muted-foreground/70 focus:border-primary disabled:opacity-50 h-9 min-w-0 flex-1 rounded-lg border px-3 text-[15px] font-semibold outline-none portrait:h-11"
      />
      {query.length > 0 && (
        <button
          type="button"
          onClick={() => onQuery("")}
          aria-label="Clear the name box"
          className="border-border/60 text-muted-foreground flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border portrait:h-11 portrait:w-11"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// --- Duplicate moment -------------------------------------------------------

/**
 * Somebody called a name that is already on the board.
 *
 * This is NOT a validation error and must never read like one. The commissioner:
 * "The fun has always been if you pick somebody who had already been picked,
 * you have to take a shot. We will still be calling up picks live, so Joe will
 * still be picking people already drafted." So the panel does two jobs at once
 * — it settles the argument by naming who holds him and in what round, which is
 * the fact the room needs, and it calls the forfeit.
 *
 * It never refuses. A second Enter drafts him anyway and the board keeps
 * flagging the duplicate afterwards.
 *
 * The words "already drafted", the round number and the holding franchise are
 * all asserted by scripts/verify-draft-typing.mjs. Reword around them.
 */
export function DuplicateWarning({
  player,
  holder,
  target,
  onConfirm,
  onCancel,
}: {
  player: { name: string };
  holder: LiveSlot;
  target: LiveSlot | null;
  /** The same two branches Enter and Esc take, for a device with neither. */
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-[3vw] max-md:p-4">
      <div className="border-warning bg-card max-h-[88dvh] w-full max-w-[60vw] overflow-y-auto rounded-2xl border-4 p-[2.5vw] text-center shadow-2xl max-md:max-w-full max-md:p-4">
        <AlertTriangle className="text-warning mx-auto mb-[1vh] h-[6vh] w-[6vh] max-md:h-8 max-md:w-8" />
        <p className="text-warning text-eyebrow text-[clamp(0.7rem,1.2vw,1.6rem)]">
          That&apos;s a shot
        </p>
        <p className="font-display mt-[0.6vh] text-[clamp(1.4rem,3vw,3.4rem)] leading-tight font-bold">
          {player.name} is already drafted
        </p>
        <p className="mt-[1.2vh] text-[clamp(1rem,1.9vw,2.2rem)] leading-snug">
          Taken at <span className="font-bold">{holder.label}</span> in{" "}
          <span className="font-bold">round {holder.round}</span> by{" "}
          <span className="text-primary font-bold">{holder.currentOwner.name}</span>
          <span className="text-muted-foreground">
            {" "}
            ({holder.currentOwner.franchiseName})
          </span>
          {holder.fill === "keeper" && (
            <span className="text-keeper font-bold"> — as a keeper</span>
          )}
        </p>
        <p className="text-muted-foreground mt-[1.8vh] text-[clamp(0.85rem,1.4vw,1.6rem)] touch:hidden">
          Press <Kbd>Enter</Kbd> again to draft him anyway
          {target && (
            <>
              {" "}
              to {target.label}, {target.currentOwner.name}
            </>
          )}{" "}
          · <Kbd>Esc</Kbd> to cancel
        </p>

        {/*
          The same sentence as two buttons, on a device with no Enter and no
          Esc. Without them this panel is modal with no way out — the phone
          equivalent of the board refusing the pick, which is the one thing the
          duplicate moment must never do.
        */}
        {onConfirm && onCancel && (
          <div className="mt-4 hidden gap-2 touch:flex">
            <button
              type="button"
              onClick={onCancel}
              className="border-border text-muted-foreground h-11 flex-1 rounded-lg border text-[14px] font-semibold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="bg-warning text-background h-11 flex-1 rounded-lg text-[14px] font-black"
            >
              Draft him anyway
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Deleting one pick ------------------------------------------------------

/**
 * The cursor is parked on an entered pick and Delete has been pressed once.
 *
 * Deliberately shaped like the duplicate moment rather than like an alert: same
 * size, same place, same "press it again" grammar, because it is the same kind
 * of moment — the board has understood him and wants one confirmation before
 * doing something it cannot take back. It names the player, the slot and the
 * franchise, which is what makes "wrong cell" obvious before the key lands.
 *
 * Nothing here is a rejection. The pick will go if he says so again.
 */
export function DeletePickWarning({ slot }: { slot: LiveSlot }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-[3vw] max-md:p-4">
      <div className="border-destructive bg-card max-h-[88dvh] w-full max-w-[60vw] overflow-y-auto rounded-2xl border-4 p-[2.5vw] text-center shadow-2xl max-md:max-w-full max-md:p-4">
        <Trash2 className="text-destructive mx-auto mb-[1vh] h-[6vh] w-[6vh] max-md:h-8 max-md:w-8" />
        <p className="text-destructive text-eyebrow text-[clamp(0.7rem,1.2vw,1.6rem)]">
          Delete this pick
        </p>
        <p className="font-display mt-[0.6vh] text-[clamp(1.4rem,3vw,3.4rem)] leading-tight font-bold">
          {slot.player?.name}
        </p>
        <p className="mt-[1.2vh] text-[clamp(1rem,1.9vw,2.2rem)] leading-snug">
          Entered at <span className="font-bold">{slot.label}</span> in{" "}
          <span className="font-bold">round {slot.round}</span> for{" "}
          <span className="text-primary font-bold">{slot.currentOwner.name}</span>
          <span className="text-muted-foreground">
            {" "}
            ({slot.currentOwner.franchiseName})
          </span>
        </p>
        <p className="text-muted-foreground mt-[1.8vh] text-[clamp(0.85rem,1.4vw,1.6rem)]">
          Press <Kbd>Delete</Kbd> again to remove it and reopen {slot.label} ·{" "}
          <Kbd>Esc</Kbd> to cancel
        </p>
      </div>
    </div>
  );
}

/**
 * Right-click on an entered pick.
 *
 * The mouse gets a one-click delete where the keyboard gets two, because the
 * gesture already carries what the keyboard's second press is for: he pointed
 * at one specific cell and the menu names the player in it. There is nothing
 * left to confirm that the menu has not already said out loud.
 *
 * Positioned at the pointer and clamped by the caller, which is the only place
 * that knows the viewport at the moment of the click.
 */
export function PickMenu({
  slot,
  x,
  y,
  busy = false,
  onDelete,
  onClose,
}: {
  slot: LiveSlot;
  x: number;
  y: number;
  /**
   * A save is in the air. Same reason the header's Delete button and the
   * keyboard's `deletable` are both closed mid-save: a delete aimed at a board
   * that is still settling can be applied by the server AHEAD of the pick it
   * was aimed past, which removes the wrong player and then loses the refusal
   * of the pick that lost the race.
   */
  busy?: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") onClose();
        return;
      }
      // Asked of the DOM rather than answered by stopping propagation in the
      // menu's own handler: these listeners run in the capture phase, so by the
      // time the event reached the button the menu would already have closed
      // and taken the click with it.
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };
    // Capture, so the menu closes before a click can land on a cell behind it.
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", dismiss, true);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", dismiss, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ left: x, top: y }}
      className="surface-raised border-border fixed z-[80] w-[15rem] overflow-hidden rounded-lg border shadow-2xl"
    >
      <div className="border-border/60 text-muted-foreground border-b px-3 py-2 text-xs">
        <span className="font-mono font-bold">{slot.label}</span>{" "}
        <span className="text-foreground font-bold">{slot.player?.name}</span>
        <div className="mt-0.5">{slot.currentOwner.name}</div>
      </div>
      <button
        type="button"
        role="menuitem"
        disabled={busy}
        onClick={() => {
          onClose();
          onDelete();
        }}
        className={cn("text-destructive hover:bg-destructive/10 disabled:opacity-30 disabled:hover:bg-transparent flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold", TAP)}
      >
        <Trash2 className="h-4 w-4" />{" "}
        {busy ? "Saving — try again in a moment" : "Delete this pick"}
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onClose}
        className={cn("text-muted-foreground hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm", TAP)}
      >
        Cancel
      </button>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="border-border bg-muted text-foreground rounded border px-[0.5vw] py-[0.2vh] font-mono font-bold">
      {children}
    </kbd>
  );
}

// --- Chrome -----------------------------------------------------------------

export function Strip({
  tone,
  children,
  onDismiss,
}: {
  tone: "destructive" | "warning" | "muted";
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const styles = {
    destructive: "bg-destructive/20 text-destructive",
    warning: "bg-warning/20 text-warning",
    muted: "bg-muted text-muted-foreground",
  }[tone];
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-[1.2vw] py-[0.5vh] text-[clamp(0.65rem,0.95vw,1.2rem)] font-semibold max-md:px-3 max-md:text-[12px]",
        styles,
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className={cn("flex shrink-0 items-center justify-center", TAP)}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

/**
 * Every view the toggle can offer. Not every caller offers all of them — the
 * recap and the mock have no picks list — so which appear is the caller's
 * `options`.
 */
export type DraftView = "board" | "picks" | "rosters";

/**
 * Why each one exists, on hover. Kept beside the toggle rather than passed in,
 * so two surfaces showing the same button cannot describe it differently.
 */
const VIEW_TITLES: Record<DraftView, string> = {
  board: "The draft board (Tab, or ⌘B)",
  picks: "Every pick in order, 1 to 160 (Tab, or ⌘B)",
  rosters: "All ten rosters (Tab, or ⌘B)",
};

/**
 * The Board / Picks / Rosters switch.
 *
 * A genuine toggle rather than a link: same screen, one grid of views. He liked
 * Smart Draft's version of this, and it is also the navigation answer to his
 * friend being unable to find rosters at all.
 */
export function ViewToggle<T extends DraftView>({
  view,
  onChange,
  options,
}: {
  view: T;
  onChange: (next: T) => void;
  /** In the order they should read left to right. */
  options: readonly T[];
}) {
  return (
    <div
      className="border-border/60 flex shrink-0 items-center gap-[0.15vw] rounded border p-[0.15vw]"
      role="group"
      aria-label="Which view of the draft"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={view === option}
          title={VIEW_TITLES[option]}
          className={cn(
            `rounded px-[0.7vw] py-[0.35vh] text-[clamp(0.6rem,0.8vw,1rem)] font-bold capitalize transition-colors max-md:px-1.5 max-md:text-[10px] touch:px-1.5 touch:text-[11px] ${TAP}`,
            view === option
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

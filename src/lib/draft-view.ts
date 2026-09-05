/**
 * Client-side view patches.
 *
 * DISPLAY ONLY. Every one of these is a guess about what the server is about to
 * say, applied so the screen moves on the same frame as the keystroke instead
 * of a round trip later. The server's response always replaces the result, and
 * the server is the only thing that decides whether a pick is legal. Nothing
 * here is ever persisted.
 *
 * The reason this exists at all: the commissioner types a name while somebody
 * reads it out, hits Enter, and immediately starts typing the next one. If the
 * input does not clear and the list does not drop the player until the fetch
 * resolves, he types the next name into a stale list.
 */

import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";
import type { BoardPlayer } from "@/lib/board-types";

function recount(slots: LiveSlot[], base: DraftRoomView): DraftRoomView {
  const cleared = slots.map((s) => (s.onTheClock ? { ...s, onTheClock: false } : s));
  const onClock = cleared.find((s) => s.fill === null) ?? null;
  const next = onClock
    ? cleared.map((s) => (s.id === onClock.id ? { ...s, onTheClock: true } : s))
    : cleared;

  const live = next.filter((s) => s.fill === "pick");
  const filled = next.filter((s) => s.fill !== null).length;

  return {
    ...base,
    slots: next,
    picksMade: live.length,
    filled,
    remaining: next.length - filled,
    onTheClockSlotId: onClock?.id ?? null,
    lastPick:
      live.length > 0 ? live.reduce((a, b) => ((b.seq ?? 0) > (a.seq ?? 0) ? b : a)) : null,
    draftedPlayerIds: next.filter((s) => s.player).map((s) => s.player!.id),
  };
}

/** Predicts the board after a pick lands. */
export function optimisticPick(
  view: DraftRoomView,
  slotId: string,
  player: BoardPlayer,
): DraftRoomView {
  // A sequence number above every existing one, so "last pick" points here.
  const nextSeq = view.slots.reduce((max, s) => Math.max(max, s.seq ?? 0), 0) + 1;
  const slots = view.slots.map((s) =>
    s.id === slotId
      ? {
          ...s,
          player,
          fill: "pick" as const,
          seq: nextSeq,
          enteredAt: new Date().toISOString(),
        }
      : s,
  );
  return recount(slots, view);
}

/** Predicts the board after the most recently entered pick is removed. */
export function optimisticUndo(view: DraftRoomView, slotId: string): DraftRoomView {
  const slots = view.slots.map((s) =>
    s.id === slotId ? { ...s, player: null, fill: null, seq: null, enteredAt: null } : s,
  );
  return recount(slots, view);
}

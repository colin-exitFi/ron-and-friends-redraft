/**
 * Finished boards of a chosen shape, for testing what the recap does with one.
 *
 * ============================================================================
 * WHY A BOARD IS REDEALT RATHER THAN A STANDINGS TABLE INVENTED
 * ============================================================================
 *
 * The question these fixtures exist to answer is whether a stratified ROSTER
 * survives the lineup optimiser and the Monte Carlo as a stratified TABLE. A
 * hand-written set of standings rows would skip both and test three lines of
 * `projectedSpread` in isolation, which is not where the doubt is: weekly
 * volatility of 30% of the mean over fourteen games compresses win totals hard,
 * and the pack test is denominated in wins. A board that looks obviously
 * separated in points can come back inside the band.
 *
 * So a real finished board is redealt. `reshape` takes the drafted players,
 * groups them by position, and hands them back to the same franchises in an
 * order the caller chooses. Two properties are held deliberately:
 *
 *   · POSITIONAL COMPOSITION IS PRESERVED EXACTLY. A franchise that drafted two
 *     tight ends still holds two tight ends, so every lineup stays legal and no
 *     franchise's projection is depressed by an empty starting slot rather than
 *     by the quality of who is in it. This is the whole reason the deal is done
 *     per position instead of by handing the top sixteen players to one team.
 *   · KEEPERS DO NOT MOVE. Their slots carry a declared keeper cost and a round
 *     it was paid in, and shuffling players through them would make the dossier
 *     quote a price nobody paid. It also keeps the fixtures honest: the
 *     nineteen kept players stay where the league actually put them, so the
 *     separation these boards show is separation the DRAFT created — which is
 *     exactly what tonight will decide.
 *
 * Everything downstream is then computed by the shipping code from the reshaped
 * board. Nothing here reimplements a projection, a lineup or a classifier.
 *
 * Used by `verify:recap:spread`, which asserts what shape each one produces,
 * and by `experiment:recap --shape=<key>`, which sends one to the live model so
 * a human can read what the prose does with it.
 */

import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";

/**
 * Franchises grouped into tiers, best first.
 *
 * Tiers are dealt in order and exhausted before the next one starts, which is
 * what creates a cliff. Inside a tier the deal snakes, which is what stops one.
 * So `[[all ten]]` is a scrum and `[[one], [nine]]` is a runaway leader, and
 * the two extremes are the same code path with a different partition.
 */
export type Tiers = string[][];

/**
 * The same board with its DRAFTED players redealt to the tiers given.
 *
 * `pointsOf` is injected rather than read here so that this module stays free
 * of I/O and the caller decides what "better" means — in practice it is always
 * the projection the standings rank on.
 */
export function reshape(
  view: DraftRoomView,
  tiers: Tiers,
  pointsOf: (playerId: string) => number,
): DraftRoomView {
  const ranked = new Set(tiers.flat());
  const ungrouped = view.teams.filter((t) => !ranked.has(t.id)).map((t) => t.name);
  if (ungrouped.length) throw new Error(`reshape: no tier for ${ungrouped.join(", ")}`);

  /** Every redealable slot and the players in them, by position. */
  const openByPosition = new Map<string, LiveSlot[]>();
  const playersByPosition = new Map<string, string[]>();
  for (const slot of view.slots) {
    if (slot.isKeeper || !slot.player) continue;
    const pos = slot.player.position;
    (openByPosition.get(pos) ?? openByPosition.set(pos, []).get(pos)!).push(slot);
    (playersByPosition.get(pos) ?? playersByPosition.set(pos, []).get(pos)!).push(slot.player.id);
  }

  const byId = new Map(view.slots.filter((s) => s.player).map((s) => [s.player!.id, s.player!]));
  const reassigned = new Map<string, LiveSlot["player"]>();

  for (const [pos, slots] of openByPosition) {
    /* Ties broken on id so two runs cannot deal the same board differently. */
    const candidates = [...playersByPosition.get(pos)!].sort(
      (a, b) => pointsOf(b) - pointsOf(a) || a.localeCompare(b),
    );

    /*
     * How many of this position each franchise holds. Fixed, so the deal can
     * only change WHO a franchise gets and never HOW MANY — the guarantee that
     * keeps every reshaped lineup legal.
     */
    const quota = new Map<string, number>();
    for (const s of slots) {
      quota.set(s.currentOwner.id, (quota.get(s.currentOwner.id) ?? 0) + 1);
    }

    /* Tier by tier, snaking within a tier, skipping anyone already full. */
    const takeOrder: string[] = [];
    for (const tier of tiers) {
      const left = new Map(tier.map((id) => [id, quota.get(id) ?? 0]));
      for (let round = 0; [...left.values()].some((n) => n > 0); round++) {
        for (const id of round % 2 === 0 ? tier : [...tier].reverse()) {
          if ((left.get(id) ?? 0) <= 0) continue;
          takeOrder.push(id);
          left.set(id, left.get(id)! - 1);
        }
      }
    }

    /*
     * Within a franchise the best player it was dealt goes in the earliest slot
     * it owns. Cosmetic to the projection — the optimiser re-picks the lineup
     * regardless — but it keeps the board readable if anybody prints one.
     */
    const slotsFor = new Map<string, LiveSlot[]>();
    for (const s of [...slots].sort((a, b) => a.overallPick - b.overallPick)) {
      const owner = s.currentOwner.id;
      (slotsFor.get(owner) ?? slotsFor.set(owner, []).get(owner)!).push(s);
    }
    const nextSlot = new Map<string, number>();

    takeOrder.forEach((teamId, i) => {
      const n = nextSlot.get(teamId) ?? 0;
      nextSlot.set(teamId, n + 1);
      reassigned.set(slotsFor.get(teamId)![n].id, byId.get(candidates[i])!);
    });
  }

  return {
    ...view,
    slots: view.slots.map((s) =>
      reassigned.has(s.id) ? { ...s, player: reassigned.get(s.id)! } : s,
    ),
  };
}

/**
 * The partitions worth testing, as functions of the franchise ids in slot
 * order.
 *
 * Each is a claim about what the room could look like at midnight, and between
 * them they cover the range: nobody separated, everybody separated, and the
 * three lopsided cases where one franchise is doing all the work at one end of
 * the table. Those three are the ones that used to defeat the classifier — a
 * bunched middle with a cliff hanging off it.
 */
export const BOARD_SHAPES: Record<
  string,
  { label: string; tiers: (ids: string[]) => Tiers }
> = {
  bunched: {
    label: "a scrum — every franchise dealt in one snake, like the pre-draft board",
    tiers: (ids) => [ids],
  },
  stratified: {
    label: "two real tiers — the top five take every position before the bottom five pick",
    tiers: (ids) => [ids.slice(0, 5), ids.slice(5)],
  },
  "outlier-low": {
    label: "one franchise far below an otherwise tight pack",
    tiers: (ids) => [ids.slice(0, 9), ids.slice(9)],
  },
  runaway: {
    label: "a runaway leader above a tight pack",
    tiers: (ids) => [ids.slice(0, 1), ids.slice(1)],
  },
  "tie-then-cliff": {
    label: "a near-tie at the top with the cliff below it",
    tiers: (ids) => [ids.slice(0, 2), ids.slice(2)],
  },
  sequential: {
    label: "maximum separation — every franchise its own tier",
    tiers: (ids) => ids.map((id) => [id]),
  },
};

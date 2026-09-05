/**
 * Where a player was actually expected to go ON THIS BOARD, which is not what
 * consensus ADP says.
 *
 * WHY RAW ADP CANNOT BE COMPARED TO A PICK NUMBER HERE.
 *
 * Consensus ADP answers "in a generic redraft league, roughly which pick does
 * this player go at". Two things make that number the wrong yardstick for this
 * board, and they compound:
 *
 * 1. KEEPERS ARE NOT IN THE DRAFT. Every kept player is already assigned to a
 *    franchise at a cost round, and the draftable slots are whatever is left of
 *    the 160. They never enter the pool, so every player behind them moves up —
 *    and the slots those keepers occupy cannot be drafted into either. Both
 *    sides of the comparison shift, which is why correcting only one of them is
 *    not enough. The count is deliberately not written down here: it moves
 *    whenever a declaration lands, and this argument does not depend on it.
 *    `npm run verify:expected` prints the live figures.
 * 2. THE BASIS IS NOT THIS LEAGUE. The feeds are a blend of formats and league
 *    sizes, and this is a ten-team league paying six points for a passing
 *    touchdown. Even with zero keepers the numbers would not line up: the
 *    earliest keeper here sits at overall pick 32, so rounds 1-3 contain no
 *    keepers at all, and raw ADP is still off by +1.6 by the fourth pick.
 *
 * Measured against the real pool, raw ADP sits ABOVE the pick a player could
 * actually be taken at, and the gap widens with rank — currently around ten
 * picks averaged over the top fifty. The reach/steal gap is
 * `expected - overallPick` and positive means reach, so an uncorrected number
 * inflates every gap in the same direction: the board systematically calls
 * fair-value picks reaches and hides real steals, by a margin that is several
 * picks wide before the second round is out.
 *
 * The size of that bias tracks the keeper count, so specific deltas are not
 * quoted here — they were, and they went stale the moment three more
 * declarations landed. `npm run verify:expected` prints the current mean and a
 * rank-by-rank table.
 *
 * THE FIX, AND WHY IT IS A RANKING PROBLEM RATHER THAN AN ARITHMETIC ONE.
 *
 * Do not subtract a keeper count. That would fix (1) approximately and (2) not
 * at all. Instead throw away ADP's absolute scale and keep only the thing it is
 * actually good at — the ORDER it puts players in:
 *
 *   1. Rank the pool by ADP with kept players removed.
 *   2. List the board slots a pick can actually land in, in board order.
 *   3. The nth-ranked available player is expected at the nth draftable slot.
 *
 * So the answer is always a real slot on this board, which is the same unit as
 * `overallPick`. That is what makes the subtraction meaningful. It also fixes
 * both problems at once and needs no new data.
 *
 * Pure and I/O-free.
 */

/** Expected pick number by player id. Only ever a slot on this board. */
export type ExpectedPicks = Record<string, number>;

/*
 * Structural parameters rather than `PoolPlayer` / `BoardSlot`, because the two
 * callers hold different shapes — the final board has the client-trimmed
 * `ClientPlayer`, a verification script has the full pool record — and this
 * only ever needs the three fields it ranks and counts by.
 */
type Rankable = { id: string; name: string; adp: number | null };
type Slot = {
  overallPick: number;
  isKeeper: boolean;
  player: { id: string } | null;
};

export function buildExpectedPicks(
  pool: readonly Rankable[],
  slots: readonly Slot[],
): ExpectedPicks {
  /*
   * Keepers are read off the BOARD rather than from the pool's `keptBy`, so
   * there is one source of truth for which players are out of the draft.
   *
   * This is not pedantry: the upstream sources genuinely disagree, and each is
   * a different age. The Smart Draft room marks only what has been keyed into
   * it, `keepers-2026-resolved.json` is a point-in-time join that is older
   * still, and `keeper-declarations.json` holds what arrived after both. The
   * reconciliation overlay is what closes the gap, and the assembled board is
   * the result. The board is what the draft is run from, so it wins.
   *
   * No count is asserted here on purpose — any figure written into this comment
   * is wrong the next time a manager declares. `npm run verify:board-keepers`
   * prints the current tally per source.
   */
  const keptIds = new Set(
    slots.filter((s) => s.isKeeper && s.player).map((s) => s.player!.id),
  );

  const draftable = slots
    .filter((s) => !s.isKeeper)
    .map((s) => s.overallPick)
    .sort((a, b) => a - b);

  /*
   * Ties broken by name so the mapping is deterministic. Several players share
   * an ADP, and without a stable tiebreak two runs could hand the same rank to
   * different players and move a reach mark around for no reason.
   */
  const ranked = pool
    .filter((p) => p.adp != null && !keptIds.has(p.id))
    .sort((a, b) => a.adp! - b.adp! || a.name.localeCompare(b.name));

  const lastSlot = slots.reduce((max, s) => Math.max(max, s.overallPick), 0);

  const expected: ExpectedPicks = {};
  ranked.forEach((p, i) => {
    /*
     * More ranked players than slots, always — several hundred have an ADP and
     * only ~144 slots are draftable. Past the end of the board the expectation
     * keeps counting upward rather than clamping, so a genuinely deep reach
     * still reads as one instead of flattening to "expected at the last pick".
     */
    expected[p.id] =
      i < draftable.length ? draftable[i] : lastSlot + (i - draftable.length + 1);
  });

  return expected;
}

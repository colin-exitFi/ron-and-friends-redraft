/**
 * THE KEEPER CLOCK — the one place this league's keeper semantics live.
 *
 * Everything about how long a player can be kept, what he costs, and what a
 * trade does to his clock is decided here. No other module should encode keeper
 * rules; they call into this one.
 *
 * The rules below are no longer assumptions. They are the recitals of the
 * executed Johnston/Blome trade agreement of Nov 12 2025, which states the
 * League's keeper rules directly, as recorded in `data/DECISIONS.md`:
 *
 *  R1. TWO KEEPERS PER TEAM, automatically redrafted from last year's roster.
 *
 *  R2. COST is one round lower than the round the player occupied the PREVIOUS
 *      SEASON. R12 in 2025 becomes R11 in 2026. The decrement is applied once
 *      per season against last season's round — it is NOT the original draft
 *      round minus the number of keeper seasons served, because a trade rebases
 *      the player onto his new franchise (see R5) without resetting his price.
 *
 *  R3. A FREE-AGENT ACQUISITION costs the 9th round in his first keeper season,
 *      which is the same thing as treating him as a round-10 pick and applying
 *      R2 once. Colston Loveland at R9 in 2026 is the live example.
 *
 *  R4. TERM is THREE SEASONS OF TENURE: the season the player is acquired, then
 *      two keeper seasons. That holds however he was acquired — drafted, traded
 *      in-season, picked off free agency, or acquired in an offseason trade.
 *      Internally that is two KEEPER seasons; every label says three. See the
 *      counting note directly below, which is the single most dangerous thing in
 *      this file to get wrong.
 *
 *  R5. A TRADE RESTARTS the player's keeper eligibility with his new team, but
 *      he retains his previous season's draft-round value. Clock resets, cost
 *      basis carries: `tradeResetsClock = true`.
 *
 * ============================================================================
 * TWO WAYS OF COUNTING. DO NOT CONFLATE THEM.
 * ============================================================================
 * The league's spreadsheets and this module count different things, and the gap
 * between them is two.
 *
 *   TENURE, as the keeper sheets write it: `"N of 3"`. N counts every season the
 *   franchise has held the player, INCLUDING the season he was acquired. So
 *   `1 of 3` is the draft/pickup season — not a keeper season at all — `2 of 3`
 *   is his first keeper season, and `3 of 3` is his second and last.
 *
 *   `seasonsKept`, as this module counts it: keeper seasons ALREADY SERVED,
 *   excluding the acquisition season. This is why `maxConsecutiveSeasons` is
 *   **2** and not 3. The contract's looser phrase "up to three (3) consecutive
 *   seasons" is tenure, not keeper seasons: you get the player the year you
 *   draft him, then you may keep him for the two following seasons.
 *
 * The sheets carry one tenure column PER SEASON (`status2025`, `status2026`, …),
 * and which column you read changes the arithmetic by one. Both directions are
 * spelled out as separate functions below so a call site has to say which it
 * means:
 *
 *   the season just FINISHED was `1 of 3`  →  seasonsKept 0  →  entering 2 of 3
 *   the season just FINISHED was `2 of 3`  →  seasonsKept 1  →  entering 3 of 3, final
 *   the season just FINISHED was `3 of 3`  →  seasonsKept 2  →  expired
 *
 *   the season being ENTERED is  `2 of 3`  →  seasonsKept 0  →  shown as 2 of 3
 *   the season being ENTERED is  `3 of 3`  →  seasonsKept 1  →  shown as 3 of 3, final
 *
 * NOTE WHAT IS DISPLAYED: every user-facing label counts TENURE out of three, not
 * keeper seasons out of two. `seasonsKept` remains the internal arithmetic
 * because the cost and eligibility rules are written in keeper seasons, but it
 * must never reach a screen. See `describeClock`.
 *
 * Use `seasonsKeptAfterSheetSeason` or `seasonsKeptEnteringSheetSeason` rather
 * than subtracting by hand. Reading a `3` off a sheet straight into `seasonsKept`
 * marks this year's five final-season keepers as already expired and quietly
 * prints a wrong draft board — Garrett Wilson, Jaxon Smith-Njigba, Brock Bowers,
 * Chase Brown and Trey McBride would all silently fall off.
 * ============================================================================
 */

import { DRAFT, KEEPERS } from "@/lib/league-config";

export const CLOCK_RULES = {
  /** R4: KEEPER seasons, not seasons of tenure. See the counting note above. */
  maxConsecutiveSeasons: KEEPERS.maxConsecutiveSeasons,
  /** R2: rounds gained per season, applied to LAST season's round. */
  costRoundEscalationPerSeason: KEEPERS.costRoundEscalationPerSeason,
  /** R5: a trade restarts eligibility with the new team; the price carries. */
  tradeResetsClock: true,
  round1Eligible: KEEPERS.round1Eligible,
  undraftedDefaultRound: KEEPERS.undraftedDefaultRound,
  undraftedYear2Round: KEEPERS.undraftedYear2Round,
  maxRound: DRAFT.rounds,
} as const;

// --- Converting to and from the keeper sheets' "N of 3" ----------------------

/**
 * Seasons of tenure the sheets count before the first keeper season: just the
 * one in which the player was acquired.
 */
const ACQUISITION_SEASONS_IN_TENURE = 1;

/**
 * The `3` in the sheets' `"N of 3"`. Derived rather than written down so it can
 * never drift away from the keeper term it is describing.
 */
export const SHEET_TENURE_TERM: number =
  ACQUISITION_SEASONS_IN_TENURE + CLOCK_RULES.maxConsecutiveSeasons;

/**
 * `"N of 3"` for a season the player has ALREADY FINISHED → `seasonsKept` going
 * into the next one. Read this off `status2025` when pricing 2026.
 *
 * Only the acquisition season comes off, because every tenure season after it
 * that has been played is a keeper season served. `1 of 3` means he was merely
 * acquired, so nothing has been served yet.
 */
export function seasonsKeptAfterSheetSeason(sheetTenureYear: number): number {
  return Math.max(0, sheetTenureYear - ACQUISITION_SEASONS_IN_TENURE);
}

/**
 * `"N of 3"` for the season the player is ABOUT TO PLAY → `seasonsKept` entering
 * it. Read this off `status2026` when pricing 2026. One lower than the function
 * above, because the season being named has not been served yet.
 *
 * `1 of 3` here is not a keeper season at all — it is the season he was acquired
 * — so it collapses to 0 alongside `2 of 3`. Prefer the ALREADY-FINISHED form
 * where both columns are available; it distinguishes the two.
 */
export function seasonsKeptEnteringSheetSeason(sheetTenureYear: number): number {
  return Math.max(0, sheetTenureYear - ACQUISITION_SEASONS_IN_TENURE - 1);
}

/** Inverse of the above: `seasonsKept` → the `"N of 3"` for the season entered. */
export function sheetTenureYearEnteringSeason(seasonsKept: number): number {
  return Math.max(0, seasonsKept) + ACQUISITION_SEASONS_IN_TENURE + 1;
}

/** Where a player sits on his clock. `year` is the season he is ENTERING. */
export type ClockPosition = {
  /**
   * Consecutive KEEPER seasons this franchise has already served with him. The
   * season he was acquired does not count — see the counting note at the top.
   */
  seasonsKept: number;
  /** The keeper year he would be entering if kept now (seasonsKept + 1). */
  year: number;
  /** Keeper seasons left before he must return to the pool, this one included. */
  remaining: number;
  /**
   * Keeping him now uses up the clock: he is on the board this season and must
   * be released afterwards. What the sheets mean by `3 of 3`.
   */
  isFinalSeason: boolean;
  /** True when the clock is used up and he cannot be kept at all. */
  expired: boolean;
};

export function clockPosition(seasonsKept: number): ClockPosition {
  const kept = Math.max(0, seasonsKept);
  const remaining = Math.max(0, CLOCK_RULES.maxConsecutiveSeasons - kept);
  return {
    seasonsKept: kept,
    year: kept + 1,
    remaining,
    isFinalSeason: remaining === 1,
    expired: remaining === 0,
  };
}

/**
 * The tenure year a player is ENTERING, counted the way the league counts it:
 * out of three, with the acquisition season as year 1.
 *
 * Prefers the sheet's own `N of 3` where it exists, because that column IS this
 * convention and is authoritative. Falls back to deriving it from `seasonsKept`,
 * which gives the same answer for every current keeper — the derivation is the
 * inverse of the one that produced `seasonsKept` in the first place.
 */
export function tenureYearEntering(
  seasonsKept: number,
  sheetTenureYear?: number | null,
): number {
  return sheetTenureYear ?? sheetTenureYearEnteringSeason(seasonsKept);
}

/**
 * Human-readable clock state, e.g. "Year 2 of 3 — first keeper season".
 *
 * ============================================================================
 * COUNTED IN SEASONS OF TENURE, OUT OF THREE. NOT IN KEEPER SEASONS.
 * ============================================================================
 * This label used to say "Year 1 of 2", counting keeper seasons and hiding the
 * acquisition season. **The commissioner rejected that twice**, in his words:
 *
 *   "Realistically it's year two of three for all of those guys, because they
 *    were acquired already in the past season. ... You can have a player up to
 *    three years: the year you acquire him and then two keeper years."
 *
 * So: **the acquisition season is year 1**, however the player was acquired —
 * drafted, traded in-season, picked off free agency, or acquired in an
 * offseason/pre-draft trade. Two keeper seasons follow. Three seasons of tenure.
 *
 * This is not a new counting system. It is the one the league's own keeper
 * sheets already use in their `N of 3` column, which is why that column is
 * preferred as the source. Do not reintroduce an "of 2" label: two independent
 * agents have now rendered this wrong, and `npm run verify:tenure` asserts every
 * keeper's displayed year against the sheet to stop a third.
 */
export function describeClock(
  seasonsKept: number,
  sheetTenureYear?: number | null,
): string {
  const pos = clockPosition(seasonsKept);
  if (pos.expired) {
    return `Clock expired — must return to the draft pool`;
  }
  const year = tenureYearEntering(seasonsKept, sheetTenureYear);
  const suffix =
    pos.remaining === 1
      ? " — final season"
      : year === 1
        ? " — acquisition season"
        : " — first keeper season";
  return `Year ${year} of ${SHEET_TENURE_TERM}${suffix}`;
}

/**
 * The season a player was acquired, given where he sits on his tenure. Useful
 * as supporting detail next to the label: "Year 2 of 3 · acquired 2025" cannot
 * be misread the way a bare year number can.
 */
export function acquisitionSeason(
  currentSeason: number,
  seasonsKept: number,
  sheetTenureYear?: number | null,
): number {
  return currentSeason - (tenureYearEntering(seasonsKept, sheetTenureYear) - 1);
}

// --- Cost -------------------------------------------------------------------

export type CostInput = {
  /**
   * The round this player OCCUPIED LAST SEASON — his draft round if he was
   * drafted, or the keeper cost round he was held at if he was kept. Null if he
   * was never drafted and has no round to his name.
   *
   * Not the original draft round. R2 walks the price down one round at a time
   * from wherever the player sat last year, and a trade moves that price to the
   * new franchise untouched while resetting the clock, so the original round
   * stops being a usable basis the moment a player changes hands.
   */
  basisRound: number | null;
  /** Consecutive KEEPER seasons already served for this franchise. */
  seasonsKept: number;
  isUndrafted: boolean;
};

/**
 * R6. A PLAYER WHO OCCUPIED A ROUND-1 SLOT LAST SEASON CANNOT BE KEPT.
 *
 * Commissioner's ruling, Aug 26 2026, codifying existing practice rather than
 * introducing a rule: asked to choose between flooring the cost at a 1st,
 * making round-1 players ineligible, and a forfeit penalty, he chose
 * ineligible, and separately confirmed the full consequence — **every
 * first-round pick is a one-year rental, permanently**, not merely expensive.
 *
 * It keys on the SLOT OCCUPIED, not on how the player came to occupy it, so it
 * catches both cases:
 *
 *   drafted in round 1        basis 1 with no keeper seasons served. Ineligible
 *                             immediately: the one-year rental.
 *   kept down TO round 1      a round-2 pick kept once prices to round 1, and
 *                             after that season his basis is 1. Ineligible for
 *                             his second keeper season EVEN THOUGH THE CLOCK
 *                             STILL ALLOWS IT — see the note below.
 *
 * An undrafted player never trips this: he has no basis round at all and prices
 * off `undraftedDefaultRound`, which is 9.
 *
 * ---------------------------------------------------------------------------
 * THIS RULE IS NOT REDUNDANT WITH THE CLOCK. It was tempting to assume the two
 * rules already agreed — that anything pricing to round 0 had run out of clock
 * anyway — and that is NOT true. Worked through:
 *
 *   drafted round 2, 2025     acquisition season, seasonsKept 0
 *   2026, keeper season 1     cost 2 − 1 = round 1. Legal: round 1 exists.
 *                             afterwards basis 1, seasonsKept 1
 *   2027, keeper season 2     clockPosition(1) → year 2 of 2, remaining 1,
 *                             NOT expired. The clock permits this season.
 *                             Cost would be 1 − 1 = round 0, which does not
 *                             exist.
 *
 * So round 0 is reachable inside the clock, and before this ruling the code
 * quietly clamped it back to round 1 — letting a player be kept a second time
 * at the same price. The consequence of the ruling is therefore real: **a
 * round-2 pick gets one keeper season, not two.** The clock says two; this rule
 * takes the second away.
 * ---------------------------------------------------------------------------
 */
export function occupiedRound1({ basisRound, isUndrafted }: CostInput): boolean {
  return !isUndrafted && basisRound === 1;
}

/**
 * The round a keeper would occupy if kept now (R2, R3), or NULL when there is no
 * such round because he is not keepable at all (R6).
 *
 * Nullable on purpose rather than clamped. It used to floor at round 1, which
 * turned an impossible round 0 into a legal-looking round 1 and was the single
 * most misleading line in this file: it made an ineligible player render as a
 * cheap keeper. A null forces every call site to decide what to show, and the
 * compiler finds the ones that would otherwise print a nonsense round.
 */
export function keeperCostRound({
  basisRound,
  seasonsKept,
  isUndrafted,
}: CostInput): number | null {
  if (isUndrafted || basisRound == null) {
    const year = clockPosition(seasonsKept).year;
    const round =
      year >= 2 ? CLOCK_RULES.undraftedYear2Round : CLOCK_RULES.undraftedDefaultRound;
    return clampRound(round);
  }

  if (occupiedRound1({ basisRound, seasonsKept, isUndrafted })) return null;

  return clampRound(basisRound - CLOCK_RULES.costRoundEscalationPerSeason);
}

/**
 * Only ever narrows a round DOWN into the board, never up off round 0 — the
 * round-0 case is handled as ineligibility above, so nothing reaches here below
 * 1 any more.
 */
function clampRound(round: number): number {
  if (round > CLOCK_RULES.maxRound) return CLOCK_RULES.maxRound;
  return round;
}

// --- Eligibility ------------------------------------------------------------

export type KeeperEligibility = {
  eligible: boolean;
  reason?: string;
  /** Null when there is no round he could be kept at. Never a nonsense round. */
  costRound: number | null;
  /** Keeper year he'd be entering. */
  year: number;
  clock: ClockPosition;
};

export type EligibilityInput = CostInput & {
  /** Round the player was ORIGINALLY drafted in, for the round-1 rule. */
  originalRound?: number | null;
};

/** Can this franchise keep this player next season, and at what cost? */
export function evaluateKeeperEligibility(input: EligibilityInput): KeeperEligibility {
  const clock = clockPosition(input.seasonsKept);
  const costRound = keeperCostRound(input);
  const base = { costRound, year: clock.year, clock };

  if (clock.expired) {
    return {
      ...base,
      eligible: false,
      reason: `Kept ${CLOCK_RULES.maxConsecutiveSeasons} consecutive seasons — the clock is up, he returns to the draft pool.`,
    };
  }

  /**
   * R6. Keyed on the round he OCCUPIED last season, which is `basisRound` —
   * deliberately not `originalRound`. A trade carries the basis across
   * untouched, so the original draft round stops describing where a player sits
   * the moment he changes hands, and pricing or barring him off it would be
   * wrong for exactly the players who move most.
   */
  if (!CLOCK_RULES.round1Eligible && occupiedRound1(input)) {
    const how =
      input.originalRound === 1
        ? "He was a first-round pick"
        : "He was kept at a first-round cost last season";
    return {
      ...base,
      eligible: false,
      reason:
        `${how}, and a player who occupied a round-1 slot cannot be kept — ` +
        `there is no cheaper round to keep him at. He returns to the draft pool.`,
    };
  }

  return { ...base, eligible: true };
}

// --- Same-round conflicts ---------------------------------------------------

export type KeeperSlotClaim = {
  playerId: string;
  playerName: string;
  /** Cost round before conflict resolution. */
  baseCostRound: number;
  eligible: boolean;
};

export type ResolvedSlotClaim = KeeperSlotClaim & { costRound: number };

/**
 * Two keepers on one franchise can compute to the same cost round, but a
 * franchise only has one pick per round. The cheaper (later-round) keeper keeps
 * his round; the other is bumped EARLIER to the next free round, which is the
 * more expensive direction and therefore the safe default.
 */
export function resolveSameRoundConflicts(claims: KeeperSlotClaim[]): {
  resolved: ResolvedSlotClaim[];
  error?: string;
} {
  const withRounds: ResolvedSlotClaim[] = claims.map((c) => ({
    ...c,
    costRound: c.baseCostRound,
  }));

  const eligible = withRounds.filter((c) => c.eligible);
  if (eligible.length <= 1) return { resolved: withRounds };

  const used = new Set<number>();
  // Later rounds first, so the cheapest keeper settles before the expensive one.
  const order = [...eligible].sort((a, b) => b.baseCostRound - a.baseCostRound);
  const assigned = new Map<string, number>();

  for (const claim of order) {
    let round = claim.baseCostRound;
    while (used.has(round) && round > 1) round -= 1;
    if (used.has(round)) {
      return {
        resolved: withRounds,
        error:
          "Two keepers need the same draft round and there is no earlier round free. Drop one keeper or pick a different player.",
      };
    }
    used.add(round);
    assigned.set(claim.playerId, round);
  }

  return {
    resolved: withRounds.map((c) => ({
      ...c,
      costRound: assigned.get(c.playerId) ?? c.costRound,
    })),
  };
}

/**
 * What a trade does to the clock (R5). Returns the seasons-kept count the
 * receiving franchise inherits — zero, because the contract restarts keeper
 * eligibility with the new team.
 *
 * The cost basis is deliberately NOT touched here: the player "retains his
 * previous season's draft-round value", so he arrives cheap and with a full
 * clock. That combination lets a player be passed around and held indefinitely
 * at an ever-cheaper round. It is what the contract says, so it is what this
 * implements; `data/DECISIONS.md` flags it as a loophole for the league to close
 * rather than a bug to work around here.
 */
export function seasonsKeptAfterTrade(currentSeasonsKept: number): number {
  return CLOCK_RULES.tradeResetsClock ? 0 : currentSeasonsKept;
}

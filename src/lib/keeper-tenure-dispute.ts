/**
 * KEEPER TENURE DISPUTES — where the app must refuse to answer.
 *
 * A keeper's final season is normally arithmetic: the clock says how many keeper
 * seasons remain and that is that. Occasionally the arithmetic depends on a
 * question of FACT or of RULE that the league has not settled, and then any
 * single number the app prints is a guess dressed as a fact.
 *
 * This module records those cases so that every surface says the same
 * unresolved thing rather than each computing its own confident answer. That
 * failure mode is not hypothetical: before this existed, `/keepers` derived Puka
 * Nacua's tenure from the sheet's "1 of 3" (implying a last season of 2028)
 * while his clock label said "Year 1 of 2" (implying 2027). Two surfaces, two
 * answers, no warning — the worst of both.
 *
 * ============================================================================
 * THE APP DOES NOT ADJUDICATE. IT REPORTS.
 * ============================================================================
 * Nothing here picks a winner, and nothing here should. These entries are
 * removed only when the league votes, at which point the outcome becomes an
 * ordinary rule and the clock computes it like any other.
 *
 * A dispute deliberately does NOT affect the current season. Every entry is
 * required to be moot for the season being drafted — see `seasonUnaffected` —
 * because a contested rule must never change what is on the board tonight. If a
 * dispute ever *did* bind the current season it would need a ruling before the
 * draft, not a note in a file.
 *
 * File-backed and dependency-free, so this survives a dead network alongside
 * everything else the board needs.
 */

import { LEAGUE } from "@/lib/league-config";

/** One side of the argument, and what it implies. */
export type TenureReading = {
  /** The acquisition event this reading counts tenure from. */
  countsFrom: string;
  /** The season the player would have to be released after. */
  finalSeason: number;
  /** Why this reading is credible. Both sides get a real argument. */
  argument: string;
};

export type TenureDispute = {
  playerName: string;
  /** Franchise short name, never a first name — four managers share one. */
  teamShortName: string;
  /** Short enough for a badge next to a player's name. */
  badge: string;
  /** The question, stated so that neither side is the default. */
  question: string;
  /** The competing readings, earliest final season first. */
  readings: TenureReading[];
  /** How this gets settled, and by whom. */
  resolution: string;
  /**
   * The season this dispute provably does NOT affect — the player is a legal
   * keeper at the same cost under every reading. Asserted so a dispute can never
   * quietly change the board it is recorded against.
   */
  seasonUnaffected: number;
};

/**
 * Puka Nacua — when does Scott's clock start?
 *
 * Recorded Aug 26 2026. Scott held Nacua in 2023, 2024 and 2025, which exhausted
 * his clock. The Johnston/Blome agreement then moved him to Greg in November
 * 2025 — mid-season — and the contingent leg returns him to Scott the day before
 * the 2026 draft. A trade restarts a player's keeper eligibility, so the clock
 * restarts; the question is *which* trade starts it, and the two answers differ
 * by a season.
 *
 * The commissioner of this app is a PARTY to this dispute rather than its
 * adjudicator: he has said the actual league commissioner must decide or throw
 * it to the group, he holds the 2027 view himself, and he concedes the opposing
 * argument has merit because Nacua genuinely was off Scott's roster. So his
 * preference is recorded as one reading among two, not as the rule.
 */
const NACUA_TENURE: TenureDispute = {
  playerName: "Puka Nacua",
  teamShortName: "Scott",
  badge: "Final season disputed",
  question:
    "Which acquisition starts Puka Nacua's keeper clock with Scott — the " +
    "in-season trade to Greg in November 2025, or the contingent leg that " +
    "returns him to Scott the day before the 2026 draft?",
  readings: [
    {
      countsFrom: "the November 2025 in-season trade",
      finalSeason: 2027,
      argument:
        "Tenure ran 2025, 2026, 2027 with the 2025 season as year 1, exactly as " +
        "the keeper sheet records it. Holders of this view also argue the " +
        "arrangement was engineered to extend a clock that had already expired, " +
        "so it should not be rewarded with a further season.",
    },
    {
      countsFrom: "the pre-draft leg that returns him to Scott",
      finalSeason: 2028,
      argument:
        "Nacua was genuinely off Scott's roster for the rest of 2025, so 2026 is " +
        "Scott's acquisition season. A pre-draft acquisition consumes a keeper " +
        "slot in the acquisition season and two further keeper seasons follow, " +
        "which is the rule as stated for every other pre-draft trade.",
    },
  ],
  resolution:
    "Goes to a league ballot. The commissioner declined to settle it himself " +
    "because opinions are mixed and he is one of the parties.",
  seasonUnaffected: 2026,
};

const DISPUTES: readonly TenureDispute[] = [NACUA_TENURE];

/**
 * The dispute touching this keeper, or null. Matched on player name AND
 * franchise short name, because a dispute belongs to a specific franchise's
 * clock — the same player under a different franchise is a different question.
 */
export function findTenureDispute(
  playerName: string,
  teamShortName: string,
): TenureDispute | null {
  const name = playerName.trim().toLowerCase();
  return (
    DISPUTES.find(
      (d) =>
        d.playerName.toLowerCase() === name && d.teamShortName === teamShortName,
    ) ?? null
  );
}

/** Every recorded dispute, for a governance or ballot surface. */
export function allTenureDisputes(): readonly TenureDispute[] {
  return DISPUTES;
}

/**
 * The clock label for a disputed keeper.
 *
 * Says the part that is settled — he is a keeper this season, and which keeper
 * year he is in for THIS season — and stops short of the part that is not. The
 * ordinary label ends in "of 2", which silently asserts the earlier of the two
 * readings, so it must not be used here.
 */
export function describeDisputedClock(dispute: TenureDispute): string {
  const seasons = dispute.readings.map((r) => r.finalSeason).sort((a, b) => a - b);
  return `Kept in ${dispute.seasonUnaffected} · final season disputed (${seasons.join(" or ")})`;
}

/**
 * Sanity check, run at import: a dispute must not bind the season being played.
 * If one ever does, it needs a ruling before the draft rather than a note here,
 * and failing loudly is the only way that gets noticed.
 */
for (const d of DISPUTES) {
  if (d.seasonUnaffected !== LEAGUE.currentSeason) {
    throw new Error(
      `Tenure dispute for ${d.playerName} is recorded against season ` +
        `${d.seasonUnaffected}, but the current season is ${LEAGUE.currentSeason}. ` +
        `A dispute may only be carried when it does not affect the season being ` +
        `drafted; this one needs a ruling instead.`,
    );
  }
  if (d.readings.length < 2) {
    throw new Error(
      `Tenure dispute for ${d.playerName} has fewer than two readings, so it is ` +
        `not a dispute. Record it as a ruling instead.`,
    );
  }
}

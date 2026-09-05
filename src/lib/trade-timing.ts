import { CLOCK_RULES } from "@/lib/keeper-clock";
import { DRAFT, LEAGUE, TRADES } from "@/lib/league-config";

/**
 * WHEN a trade happened, and what that does to a keeper clock.
 *
 * ============================================================================
 * WHY A DATE IS LOAD-BEARING AND NOT METADATA
 * ============================================================================
 * This league's keeper term is an acquisition season plus two keeper seasons.
 * The date of a trade decides which season is which, and therefore how long the
 * receiving franchise can hold the player:
 *
 *   IN-SEASON. He finishes the current season on his new roster without
 *   occupying a keeper slot — somebody else drafted him, and the new franchise
 *   is simply rostering him for the rest of the year. That season is his
 *   acquisition season, and his first KEEPER season is the next one.
 *
 *   PRE-DRAFT. There is no such season. A player acquired between the end of one
 *   season and the next draft has to be declared as a keeper to be rostered at
 *   all, so the very next season is itself a keeper season.
 *
 * The clock arithmetic is identical in both cases — a trade resets
 * `seasonsKept` to zero, per rule R5 — but the season that count runs FROM
 * differs by one, and one season is the whole disagreement in the Nacua case.
 *
 * ============================================================================
 * WHAT THIS MODULE DELIBERATELY DOES NOT DECIDE
 * ============================================================================
 * Whether a pre-draft acquisition ALSO consumes a keeper season, or whether the
 * arriving season is a free acquisition season that happens to require a keeper
 * slot, is the contested reading behind the Nacua timeline. The commissioner has
 * put it to a league vote rather than ruling on it, and `data/DECISIONS.md`
 * records the related trade-and-reset loophole as going to a vote as well.
 *
 * So this module states BOTH candidate outcomes for the pre-draft case and
 * changes no stored number. That is not fence-sitting: the reason the vote is
 * hard is that the timing was never recorded, and the fix available to code is
 * to record it so the clocks can be recomputed under whichever reading wins.
 * Legislating a reading here would bake one answer into data the league has not
 * agreed on yet — the exact mistake that produced two disagreeing records of
 * Nacua in the first place.
 *
 * Nothing in `@/lib/keeper-clock` is touched. It owns the clock semantics and
 * this module reads them.
 */

export type TradePhase = "pre_draft" | "in_season";

export type TradeTiming = {
  /** The date as given, `YYYY-MM-DD`. */
  date: string;
  /** The league season this date belongs to. */
  season: number;
  phase: TradePhase;
  /** The draft that bounds the season, `YYYY-MM-DD`. */
  draftDate: string;
  /**
   * True when the draft date for this season is not configured and has been
   * taken as the same day of the year as the one that is.
   *
   * Surfaced rather than hidden: it is the one approximation in here, and it
   * only bites on a trade back-dated into a season the config does not describe.
   */
  draftDateAssumed: boolean;
  /** "in-season (after the Aug 29 draft)" — for stating the classification. */
  label: string;
};

/**
 * The month from which a calendar year belongs to its own league season.
 *
 * March is chosen because it is comfortably inside the offseason everywhere: the
 * Super Bowl is done, and no draft in this league's history has been held
 * earlier. So a January date belongs to the season that started the previous
 * autumn, which is what a manager means by "the 2026 season" in January 2027.
 */
const SEASON_START_MONTH = 3;

/** Today, as `YYYY-MM-DD` in local time — which is what a date picker gives. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIsoDate(value: string): { y: number; m: number; d: number } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    throw new Error(
      `Invalid date "${value}" — use YYYY-MM-DD, the date the trade actually happened.`,
    );
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // Round-tripped through Date so 2026-02-31 is rejected rather than rolled
  // forward into March, which would silently reclassify the season.
  const probe = new Date(y, mo - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== mo - 1 || probe.getDate() !== d) {
    throw new Error(`"${value}" is not a real date.`);
  }
  return { y, m: mo, d };
}

/** The season a date belongs to. See `SEASON_START_MONTH`. */
export function seasonForDate(date: string): number {
  const { y, m } = parseIsoDate(date);
  return m >= SEASON_START_MONTH ? y : y - 1;
}

/**
 * Draft day for a season.
 *
 * Only the current season's date is configured, so any other season is taken as
 * the same day of the year. Flagged as assumed rather than presented as fact.
 */
function draftDateForSeason(season: number): { date: string; assumed: boolean } {
  if (season === LEAGUE.currentSeason) return { date: DRAFT.date, assumed: false };
  const [, month, day] = DRAFT.date.split("-");
  return { date: `${season}-${month}-${day}`, assumed: true };
}

function monthDayLabel(date: string): string {
  const { y, m, d } = parseIsoDate(date);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Classify a trade date: which season, and which side of that season's draft. */
export function classifyTradeDate(date: string): TradeTiming {
  const season = seasonForDate(date);
  const { date: draftDate, assumed } = draftDateForSeason(season);
  const phase: TradePhase = date < draftDate ? "pre_draft" : "in_season";

  return {
    date,
    season,
    phase,
    draftDate,
    draftDateAssumed: assumed,
    label:
      phase === "pre_draft"
        ? `pre-draft for ${season} (before the ${monthDayLabel(draftDate)} draft)`
        : `in-season ${season} (after the ${monthDayLabel(draftDate)} draft)`,
  };
}

// --- What the timing does to a keeper clock ---------------------------------

export type KeeperTimingConsequence = {
  timing: TradeTiming;
  /** The season the app records as this player's acquisition by the new team. */
  acquisitionSeason: number;
  /** First season the receiving franchise could keep him. */
  firstKeeperSeason: number;
  /** Last season he can be kept, under the rule as the app implements it. */
  lastKeeperSeason: number;
  /** Keeper seasons the receiving franchise gets. */
  keeperSeasons: number;
  /**
   * Set only for a pre-draft trade: the terminal season under the OTHER reading
   * of the rule, the one going to a league vote. Null when the timing raises no
   * question.
   */
  disputedLastKeeperSeason: number | null;
  /** Plain-language statement of the consequence, for the preview. */
  summary: string;
  /** Present when the outcome turns on the unresolved rule. */
  disputeNote: string | null;
};

/**
 * What a trade on this date does to the clock of a player it moves.
 *
 * Takes no view on the disputed reading — see the module note. The numeric
 * result matches what the code already stores (`seasonsKeptAfterTrade` resets
 * the count to zero); what the date adds is knowing which season that count runs
 * from, which is exactly what nobody could establish for Nacua.
 */
export function keeperConsequenceOfTrade(date: string): KeeperTimingConsequence {
  const timing = classifyTradeDate(date);
  const term = CLOCK_RULES.maxConsecutiveSeasons;

  // A trade resets the clock (R5), so the receiving franchise gets the full
  // term. The date decides only where the term starts.
  const firstKeeperSeason =
    timing.phase === "pre_draft" ? timing.season : timing.season + 1;
  const lastKeeperSeason = firstKeeperSeason + term - 1;

  const acquisitionSeason = timing.season;

  const disputedLastKeeperSeason =
    timing.phase === "pre_draft" ? lastKeeperSeason + 1 : null;

  const summary =
    timing.phase === "pre_draft"
      ? `Acquired before the ${timing.season} draft, so ${timing.season} is itself a ` +
        `keeper season: keepable ${firstKeeperSeason}–${lastKeeperSeason}, through ` +
        `${lastKeeperSeason}.`
      : `Acquired during the ${timing.season} season, which he finishes without ` +
        `occupying a keeper slot, so ${timing.season} is his acquisition season: ` +
        `keepable ${firstKeeperSeason}–${lastKeeperSeason}, through ${lastKeeperSeason}.`;

  const disputeNote =
    timing.phase === "pre_draft"
      ? `Whether a pre-draft acquisition also uses up a keeper season is the ` +
        `unresolved point behind the Puka Nacua timeline, and the commissioner has ` +
        `put it to a league vote. If the league rules that the arriving season is a ` +
        `free acquisition season, this becomes through ${disputedLastKeeperSeason} ` +
        `instead. The date is recorded either way, so the clock can be recomputed ` +
        `once the league decides — which is precisely what could not be done for ` +
        `Nacua.`
      : null;

  return {
    timing,
    acquisitionSeason,
    firstKeeperSeason,
    lastKeeperSeason,
    keeperSeasons: term,
    disputedLastKeeperSeason,
    summary,
    disputeNote,
  };
}

/**
 * Whether a date falls after ESPN's trade deadline.
 *
 * Reported, never enforced. ESPN already blocks trades past its own deadline, so
 * the only thing this app could achieve by policing it is refusing a legitimate
 * late-logged trade at the moment someone is trying to do the right thing.
 */
export function isAfterTradeDeadline(date: string): boolean {
  const timing = classifyTradeDate(date);
  if (timing.phase !== "in_season") return false;
  // Week 1 starts the Thursday after the draft in practice; the deadline week is
  // all this needs, and an approximate week number is fine for a note that
  // decides nothing.
  const draft = new Date(timing.draftDate);
  const weeks = Math.floor(
    (new Date(date).getTime() - draft.getTime()) / (7 * 86_400_000),
  );
  return weeks > TRADES.deadlineWeek;
}

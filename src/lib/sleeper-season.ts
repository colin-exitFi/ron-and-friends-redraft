import { SCORING_SPEC } from "@/lib/league-config";
import { receptionValue } from "@/lib/projections";

/**
 * Last season's ACTUAL production, re-scored under this league's rules.
 *
 * ============================================================================
 * WHY A LEAGUE-SCORED 2025 TOTAL IS WORTH MORE THAN THE ONE ON HIS PHONE
 * ============================================================================
 * Every app in the room can show a manager what a player scored last year, and
 * every one of them shows it at somebody else's scoring — full PPR on ESPN,
 * half PPR on Sleeper's own player card, four points a passing touchdown almost
 * everywhere. This league pays SIX for a passing touchdown and a FULL POINT per
 * tight end reception, and no public surface prices either.
 *
 * The difference is not cosmetic and it lands on exactly the positions this
 * league has deliberately mispriced relative to the market. A 90-catch tight
 * end is 45 points better here than the number on his phone says, which is
 * most of a round; a 40-touchdown quarterback is 80 points better. Those are
 * precisely the two calls his managers will not intuit, which is the whole
 * argument for computing it ourselves.
 *
 * ============================================================================
 * WHY THIS SCORER EXISTS ALONGSIDE `pointsFromStats`
 * ============================================================================
 * `@/lib/projections` scores a PROJECTED line and documents, at length, that it
 * cannot apply the milestone and explosive bonuses: those are per-GAME events
 * and a season projection only publishes a season total, so there is no way to
 * recover "how many 100-yard games" from "1,400 receiving yards".
 *
 * An ACTUAL season does not have that problem. Sleeper's season stat line
 * carries the bonus counts as counting stats — `bonus_rec_yd_100` is the number
 * of games he cleared it in — so last season's points can be scored completely,
 * bonuses and explosive plays included, in a way a projection never can. That
 * is why this is a second scorer and not a call into the first one: the input
 * shape is genuinely richer, and pretending otherwise would silently drop the
 * bonuses that `SCORING_SPEC` says this league pays.
 *
 * ============================================================================
 * SLEEPER'S BONUS STATS ARE BANDS, NOT CUMULATIVE COUNTS. MEASURED.
 * ============================================================================
 * `league-config.ts` documents the SETTINGS as six independent one-point
 * payments that stack, so that a 410-yard passing game "clears 300 for +1 and
 * clears 400 for another +1". That is a correct description of the settings and
 * it is NOT how the season stat fields are bucketed, which matters here because
 * this module multiplies the two together.
 *
 * The 2025 payload settles it: Russell Wilson has `bonus_pass_yd_400` 1 and no
 * `bonus_pass_yd_300` key at all. A 400-yard game therefore lands in the 400
 * bucket ONLY — the buckets are mutually exclusive, so each qualifying game is
 * counted once and earns the one point its own band pays.
 *
 * The consequence is that scoring is a plain dot product: every Sleeper stat key
 * multiplied by its coefficient, which is exactly the model Sleeper itself uses.
 * Nothing here needs to know about stacking, and nothing here should "correct"
 * for it — doing so would double-count every 100-yard game in the league.
 *
 * VERIFIED AGAINST SLEEPER'S OWN ARITHMETIC. The field model below was checked
 * by reproducing Sleeper's published `pts_half_ppr` from these same keys at
 * Sleeper's default coefficients, to the penny, for both a quarterback
 * (Matthew Stafford, 358.38) and a tight end (155.2). The keys mean what this
 * module assumes they mean; only the coefficients differ.
 *
 * Pure and I/O-free. `@/lib/last-season-store` does the reading.
 */

/**
 * The subset of a Sleeper season stat line this league scores.
 *
 * Every field optional — Sleeper omits a key entirely rather than writing a
 * zero, so a receiver's line genuinely has no `pass_yd` at all. Absent is
 * treated as zero, which is correct for a counting stat.
 *
 * Named in SLEEPER'S OWN KEYS rather than translated into friendlier ones. The
 * translation layer is where a scoring bug hides: `fum` and `fum_lost` are two
 * different events paid two different ways, and any renaming that blurs them
 * into "fumbles" changes the answer. Keeping the vendor's names means a reader
 * can diff this type against the raw JSON.
 */
export type SleeperSeasonStats = {
  gp?: number;
  pass_yd?: number;
  pass_td?: number;
  pass_int?: number;
  pass_int_td?: number;
  pass_2pt?: number;
  pass_cmp_40p?: number;
  rush_yd?: number;
  rush_td?: number;
  rush_2pt?: number;
  rush_40p?: number;
  rec?: number;
  rec_yd?: number;
  rec_td?: number;
  rec_2pt?: number;
  rec_40p?: number;
  fum?: number;
  fum_lost?: number;
  bonus_pass_yd_300?: number;
  bonus_pass_yd_400?: number;
  bonus_rush_yd_100?: number;
  bonus_rush_yd_200?: number;
  bonus_rec_yd_100?: number;
  bonus_rec_yd_200?: number;
};

/**
 * Last season's fantasy points under THIS league's scoring.
 *
 * Reads every coefficient from `SCORING_SPEC`, so re-pointing the league's
 * scoring re-points this with it. The reception rate comes from
 * `receptionValue`, which is the one place the tight end premium is decided —
 * a second copy of that rule here is how the two surfaces would come to
 * disagree about Brock Bowers.
 *
 * TEAM DEFENCES ARE NOT SCORABLE FROM A SEASON TOTAL and must not be passed in.
 * This league's D/ST scoring is dominated by the points-allowed ladder, which is
 * a PER-GAME band: a unit that allowed 295 points across 17 games did not
 * "allow 295" for scoring purposes, it collected seventeen separate band
 * payments, and no season total recovers which bands. `@/lib/last-season-store`
 * therefore carries no defences, and the UI shows them blank rather than wrong.
 */
export function pointsFromSleeperSeason(
  stats: SleeperSeasonStats,
  position?: string | null,
): number {
  const s = SCORING_SPEC;
  const n = (v: number | undefined) => v ?? 0;

  return (
    // Passing. The six-point touchdown is the whole reason this is recomputed.
    n(stats.pass_yd) / s.passYardsPerPoint +
    n(stats.pass_td) * s.passTd +
    n(stats.pass_int) * s.interceptionThrown +
    // A pick-six costs the quarterback the interception AND this increment.
    n(stats.pass_int_td) * s.pickSixAdditional +
    n(stats.pass_2pt) * s.twoPointConversion +
    // Rushing.
    n(stats.rush_yd) / s.rushRecYardsPerPoint +
    n(stats.rush_td) * s.rushTd +
    n(stats.rush_2pt) * s.twoPointConversion +
    // Receiving. `receptionValue` is where the TE premium lives.
    n(stats.rec) * receptionValue(position) +
    n(stats.rec_yd) / s.rushRecYardsPerPoint +
    n(stats.rec_td) * s.recTd +
    n(stats.rec_2pt) * s.twoPointConversion +
    /*
     * Ball security, as TWO events rather than one. Sleeper charges `fum` for
     * any credited fumble and `fum_lost` again for losing it, which is why the
     * league's ordinary lost fumble costs 2 — and why using the derived
     * `fumbleLost` coefficient here would double the penalty on a recovered
     * fumble and halve it on a lost one.
     */
    n(stats.fum) * s.fumble +
    n(stats.fum_lost) * s.fumbleLostAdditional +
    // Yardage milestones. Banded, so each qualifying game is counted once.
    n(stats.bonus_pass_yd_300) * s.bonusPass300 +
    n(stats.bonus_pass_yd_400) * s.bonusPass400 +
    n(stats.bonus_rush_yd_100) * s.bonusRush100 +
    n(stats.bonus_rush_yd_200) * s.bonusRush200 +
    n(stats.bonus_rec_yd_100) * s.bonusRec100 +
    n(stats.bonus_rec_yd_200) * s.bonusRec200 +
    // Explosive plays. A 40-yard catch pays the passer and the receiver both.
    (n(stats.pass_cmp_40p) + n(stats.rush_40p) + n(stats.rec_40p)) * s.bonusPlay40
  );
}

/** One player's finished season, scored and ready to render. */
export type LastSeasonLine = {
  /** Sleeper player id, kept so a suspect row can be looked up at the source. */
  sleeperId: string;
  /** Sleeper's own spelling of the name. What to search for when a join fails. */
  name: string;
  position: string;
  /** The team he played for LAST season, which is often not this season's. */
  team: string | null;
  /** Season points in this league's scoring. Rounded to a tenth. */
  points: number;
  /** Games played. The denominator, and a fact in its own right. */
  games: number;
  /**
   * Points per game, or null when he did not play.
   *
   * Carried because a season total silently punishes a missed month, and the
   * two numbers answer different questions: the total is what he actually
   * delivered, the average is what he delivered when he was on the field. A
   * manager choosing between a 17-game plodder and a 9-game star needs both.
   */
  perGame: number | null;
  /**
   * A one-line stat line, pre-formatted, so the UI does not reimplement "what
   * matters for a running back" in JSX. Null when nothing stood out.
   */
  line: string | null;
  /**
   * Sleeper's CURRENT injury designation — `Out`, `IR`, `Questionable`,
   * `Sus`. Null for anybody healthy, which is nearly everyone.
   *
   * NOT last season's, and the only forward-looking field on this type. It
   * rides along because it comes out of the same player map the join needs and
   * a manager drafting somebody who is on IR today is the most expensive
   * mistake this page could fail to prevent.
   */
  injuryStatus: string | null;
};

export type LastSeasonSnapshot = {
  provenance: {
    source: string;
    /** The season these are the ACTUALS for. Not the current season. */
    season: number;
    pulledAt: string;
    scoring: string;
    note: string;
    /** How many players carry a scored line. */
    playerCount: number;
  };
  /**
   * Keyed by `joinKey(name, position)` from `@/lib/fantasypros/players` — the
   * same key `/players` already uses for the live ADP overlay.
   *
   * NOT by Sleeper id, because nothing else in this repo holds one: the pool,
   * the board and the projections all key on a Smart Draft id, and Sleeper's
   * player map carries no Smart Draft id to join on. Name-and-position is the
   * only bridge available, so it is the one the file is written for, and the
   * matching is done ONCE here rather than on a render path.
   */
  players: Record<string, LastSeasonLine>;
};

/** Shape check for a file read off disk, so a truncated pull fails loudly. */
export function isLastSeasonSnapshot(value: unknown): value is LastSeasonSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<LastSeasonSnapshot>;
  if (typeof v.players !== "object" || v.players === null) return false;
  const p = v.provenance;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.season === "number" &&
    typeof p.pulledAt === "string"
  );
}

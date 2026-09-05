/**
 * Season-long player projections, and the one thing that makes them usable
 * here: they are scored on THIS league's rules rather than on the vendor's.
 *
 * ============================================================================
 * WHY THE SNAPSHOT STORES STAT LINES AND NOT FANTASY POINTS
 * ============================================================================
 *
 * Every projection feed publishes a fantasy-point total, and that total is the
 * wrong number for this league. It is computed on the publisher's default
 * scoring, and this league pays **six points for a passing touchdown** where
 * essentially every public feed assumes four. A quarterback throwing 30
 * touchdowns is worth 60 points more here than the feed says — roughly a
 * fifth of his season — and the error is not noise, it is a systematic bias
 * that lands on exactly one position.
 *
 * That matters more than it sounds. Projected standings are decided by gaps of
 * a few dozen points between franchises. A per-QB error of sixty points is
 * larger than the gap between fourth and eighth, so ranking teams on vendor
 * points would not be a slightly worse ranking — it would be a ranking of who
 * drafted a quarterback, wearing the clothes of a ranking of who drafted well.
 *
 * So the snapshot records the STAT LINE — passing yards, passing touchdowns,
 * receptions and the rest — and `pointsFromStats` applies
 * `SCORING_SPEC` from `@/lib/league-config`. The league's own scoring is the
 * only scoring this module will rank on, and it is read from the one place the
 * league's configuration lives rather than restated here.
 *
 * WHEN THE FEED WILL ONLY GIVE POINTS. Some tools return a computed total and
 * no stat line. Those rows are kept, because a projection nobody can rescore
 * is still better than a hole in a franchise's lineup, but they are marked:
 * `basis` says `"vendor"` instead of `"league"`, and
 * `ProjectionIndex.vendorScoredCount` counts them so a caller can say out loud
 * how much of the ranking rests on foreign scoring. `verify:projections`
 * prints that count. It is a disclosure, not a fallback that hides.
 *
 * ============================================================================
 * WHY EVERY ROW CARRIES A RESOLVED PLAYER ID
 * ============================================================================
 *
 * Matching a feed's "Marvin Harrison Jr." to the pool's "Marvin Harrison" is a
 * fuzzy problem, and fuzzy problems must not be re-run on a render path: the
 * same board would then be free to produce two different standings depending on
 * which way a near-tie broke, and a projected finish that moves between page
 * loads is worthless.
 *
 * So a `PlayerProjection` carries `playerId` — the Smart Draft id the board, the
 * pool and the draft state all already use — and everything downstream joins on
 * that, exactly. Resolving it is the job of whatever produced the rows: the live
 * FantasyPros client, or `scripts/fantasypros-pull.mjs` writing the committed
 * snapshot. `matchMethod` records how the match was made so a bad join can be
 * audited after the fact rather than guessed at.
 *
 * What is left here is the CHECK, not the match. `indexProjections` names every
 * row it could not use — unmatched, or matched but unscorable — because the
 * failure this module exists to prevent is a missing projection reading as a low
 * one. A starter silently valued at zero costs a franchise several places and
 * looks exactly like a bad draft, so it has to be reported rather than absorbed.
 *
 * Pure and I/O-free. `@/lib/projections-store` does the reading.
 */

import { SCORING_SPEC } from "@/lib/league-config";

/**
 * A projected stat line for one season.
 *
 * Every field optional: feeds differ in what they publish, and a receiver's
 * row legitimately carries no passing attempts. Absent is treated as zero by
 * `pointsFromStats`, which is correct for a counting stat and is why these are
 * counts rather than rates.
 */
export type ProjectedStats = {
  passYards?: number;
  passTd?: number;
  interceptions?: number;
  rushYards?: number;
  rushTd?: number;
  receptions?: number;
  recYards?: number;
  recTd?: number;
  fumblesLost?: number;
  twoPointConversions?: number;
  /**
   * Team defence points, which no stat line reconstructs. ESPN's D/ST scoring
   * is two tiered tables plus four counting stats, and a projection feed
   * publishes the total rather than the ingredients. Recorded as a total on
   * purpose and scored as one.
   */
  dstPoints?: number;
};

/** How a row's fantasy points were arrived at. */
export type ProjectionBasis =
  /** Rescored from a stat line under this league's rules. Trustworthy. */
  | "league"
  /** The feed's own total, on the feed's own scoring. Disclosed, not hidden. */
  | "vendor";

export type PlayerProjection = {
  /**
   * Smart Draft player id — the id the board, the pool and the draft state all
   * use. Resolved by the puller. Null for a feed row that matched nobody, kept
   * in the file so an unmatched player is visible rather than deleted.
   */
  playerId: string | null;
  /**
   * FantasyPros' own id, kept so a suspect row can be looked up at the source.
   * Not the join key here — `playerId` is — but it is what the join was MADE on
   * when `matchMethod` is `"fpid"`, and having it in the file is the difference
   * between auditing a bad projection and guessing at it.
   */
  fpId?: number | null;
  /** The feed's own name, verbatim. What to search for when a join fails. */
  sourceName: string;
  /** The pool's name for the same player, once matched. */
  matchedName: string | null;
  position: string;
  nflTeam: string | null;
  /** How the puller matched him — "exact", "suffix", "dst-team"… */
  matchMethod: string | null;
  stats: ProjectedStats | null;
  /** The feed's own total, when it published one. Never ranked on directly. */
  vendorPoints: number | null;
  /** What scoring `vendorPoints` is on, as the feed describes it. */
  vendorScoring: string | null;
  /** ACTIVE | QUESTIONABLE | OUT | IR | SUSPENDED, as the feed reports it. */
  injuryStatus: string | null;
  /** Strength of schedule, feed's own scale. Descriptive only; never scored. */
  strengthOfSchedule: number | null;
  /** Feed tier within position. Descriptive. */
  tier: number | null;
  positionRank: number | null;
};

export type ProjectionProvenance = {
  source: string;
  /** MCP tool the rows came out of, so a re-pull can be reproduced exactly. */
  tool: string | null;
  /** ISO timestamp. This file is a POINT-IN-TIME SNAPSHOT, not a live feed. */
  pulledAt: string;
  season: number;
  /**
   * Always true, and stated in the file rather than only in a comment. A
   * projection pulled in August is not what the feed says in December, and
   * anything quoting this file should be able to say when it was taken.
   */
  pointInTime: true;
  /** What the vendor's own point totals are computed on, if known. */
  vendorScoringBasis: string | null;
  note: string;
};

export type ProjectionSnapshot = {
  provenance: ProjectionProvenance;
  players: PlayerProjection[];
};

/**
 * What a reception is worth to a player at this position.
 *
 * ============================================================================
 * THE TIGHT END PREMIUM, WHICH THIS FILE USED TO DROP ON THE FLOOR
 * ============================================================================
 * `SCORING_SPEC.recTePremium` has been 0.5 since the scoring was rebuilt off
 * the live Sleeper pull, and until now NOTHING READ IT. `pointsFromStats` took
 * a stat line and no position, so it had no way to tell a tight end's catch
 * from a receiver's and paid every one of them the base 0.5.
 *
 * That is not a rounding error. Sleeper pays a tight end a full point per
 * reception, so a 100-catch tight end was being valued fifty points light —
 * about a fifth of his season, landing on exactly one position, in the one
 * league where that position is deliberately mispriced relative to the market.
 * The projected standings ranked "TE" as a franchise's weakest slot partly
 * because of it, and the whole reason the league carries a TE premium is that
 * it is supposed to change who you draft.
 *
 * Position is optional so a caller holding a bare stat line still gets the
 * base rate, which is the honest answer when nobody has said who caught them.
 */
export function receptionValue(position?: string | null): number {
  const s = SCORING_SPEC;
  return position?.toUpperCase() === "TE" ? s.ppr + s.recTePremium : s.ppr;
}

/**
 * Season fantasy points under THIS league's scoring.
 *
 * Reads every coefficient from `SCORING_SPEC`. Nothing about six-point passing
 * touchdowns or the tight end premium is written down here, so re-pointing the
 * league's scoring re-points this with it.
 *
 * WHAT A SEASON TOTAL CANNOT CARRY. The milestone and explosive bonuses —
 * `bonusPass300`, `bonusRec100`, `bonusPlay40` and the rest — are per-GAME
 * events, and a season projection publishes only the season total. There is no
 * way to recover "how many 100-yard games" from "1,400 receiving yards" without
 * inventing a distribution, so they are deliberately not applied here. Every
 * player is understated by the same handful of points and the ORDER, which is
 * the only thing anything ranks on, is unaffected. Stated so the omission is a
 * decision on the record rather than a gap somebody later reads as a bug.
 */
export function pointsFromStats(stats: ProjectedStats, position?: string | null): number {
  const s = SCORING_SPEC;
  const n = (v: number | undefined) => v ?? 0;

  return (
    n(stats.passYards) / s.passYardsPerPoint +
    n(stats.passTd) * s.passTd +
    n(stats.interceptions) * s.interceptionThrown +
    n(stats.rushYards) / s.rushRecYardsPerPoint +
    n(stats.rushTd) * s.rushTd +
    n(stats.receptions) * receptionValue(position) +
    n(stats.recYards) / s.rushRecYardsPerPoint +
    n(stats.recTd) * s.recTd +
    n(stats.fumblesLost) * s.fumbleLost +
    n(stats.twoPointConversions) * s.twoPointConversion +
    n(stats.dstPoints)
  );
}

/**
 * Whether a row has a stat line this league can score.
 *
 * PRESENCE of the fields, not non-zero values — and that distinction is the
 * whole point. FantasyPros returns a complete but all-zero line for around forty
 * deep players (third-string quarterbacks, fifth running backs): every key is
 * there and every value is 0.
 *
 * An earlier version required a non-zero value somewhere, which classified those
 * rows as "no stat line" and routed them to the vendor total instead. The points
 * were identical — zero either way — so nothing was misranked, but the
 * BOOKKEEPING lied: forty rows were reported as scored on FantasyPros' four-point
 * passing touchdown, and `verify:projections` duly raised "quarterbacks will be
 * understated", which was not what had happened at all. A false alarm in the one
 * check that exists to catch a real scoring mismatch is worse than no check.
 *
 * So a present line is scorable, even at zero. A row projected at zero is a real
 * projection of zero and is counted in `zeroProjectionNames`, which is a
 * different and more useful thing to know. A defence with only `dstPoints` also
 * counts: that IS its whole line here, with nothing further to rescore.
 */
function hasScorableStats(stats: ProjectedStats | null): stats is ProjectedStats {
  if (!stats) return false;
  return Object.keys(stats).length > 0;
}

/** One player's projection, resolved to a number this league can rank on. */
export type ScoredProjection = {
  playerId: string;
  name: string;
  position: string;
  points: number;
  basis: ProjectionBasis;
  /**
   * How the row was joined to this player — `"fpid"` for an exact id match,
   * a name rule otherwise.
   *
   * Carried through so join quality can be reported for the players who
   * actually matter: the ones on a roster. A feed-wide match rate is reassuring
   * and close to useless, because the rows that fail are overwhelmingly deep
   * names nobody drafts. What matters is whether the sixteen players on a
   * franchise's roster were matched on an id or on a guess.
   */
  matchMethod: string | null;
  injuryStatus: string | null;
  strengthOfSchedule: number | null;
  tier: number | null;
  positionRank: number | null;
};

/**
 * A projection lookup, plus everything a caller needs to be honest about it.
 *
 * The counts are not decoration. `vendorScoredCount` is how much of a ranking
 * is standing on foreign scoring, and `unmatchedSourceNames` is the list a
 * human has to look at when a franchise's projection seems too low.
 */
export type ProjectionIndex = {
  provenance: ProjectionProvenance;
  byPlayerId: Map<string, ScoredProjection>;
  /** Rows rescored from a stat line under this league's rules. */
  leagueScoredCount: number;
  /** Rows carried at the vendor's own total because no stat line came back. */
  vendorScoredCount: number;
  /**
   * Rows whose whole line is `dstPoints` — a team defence carrying the feed's
   * own total.
   *
   * Counted separately from `vendorScoredCount` because it is a different claim.
   * A vendor-scored skill player is a row this league COULD have rescored and
   * did not, which is a gap. A defence is a row nobody can rescore: ESPN's D/ST
   * scoring is dominated by tiered points-allowed and yards-allowed tables, and
   * no feed projects the buckets those tables read. Disclosed as a number so the
   * distinction is auditable rather than buried in a comment, and harmless in
   * ranking terms — the six-point passing touchdown does not touch D/ST, and
   * every franchise starts exactly one.
   */
  dstPassthroughCount: number;
  /** Feed rows that matched no pool player, by the feed's own name. */
  unmatchedSourceNames: string[];
  /** Rows that matched but carried neither a stat line nor a vendor total. */
  unscoredNames: string[];
  /**
   * Players the feed projects at exactly zero.
   *
   * Worth naming rather than counting silently. FantasyPros publishes a full but
   * empty line for deep players, and while a genuine zero is plausible for a
   * third-string quarterback it is NOT plausible for a rostered starter — so a
   * name appearing here that a franchise actually starts is a signal to go and
   * look, not a number to quote. `verify:projections` fails if one is started
   * and merely reports the rest.
   */
  zeroProjectionNames: string[];
};

/**
 * Turns a snapshot into a lookup, discarding nothing quietly.
 *
 * Rows with no id and rows with no number are both counted and named rather
 * than filtered away, because the failure mode this module exists to prevent
 * is a missing projection reading as a low one.
 *
 * Ties in the (impossible but cheap to defend against) case of two rows
 * claiming the same player id resolve to the FIRST row in file order, so the
 * index is a function of the file rather than of iteration luck.
 */
export function indexProjections(snapshot: ProjectionSnapshot): ProjectionIndex {
  const byPlayerId = new Map<string, ScoredProjection>();
  const unmatchedSourceNames: string[] = [];
  const unscoredNames: string[] = [];
  const zeroProjectionNames: string[] = [];
  let leagueScoredCount = 0;
  let vendorScoredCount = 0;
  let dstPassthroughCount = 0;

  for (const row of snapshot.players) {
    if (!row.playerId) {
      unmatchedSourceNames.push(row.sourceName);
      continue;
    }
    if (byPlayerId.has(row.playerId)) continue;

    let points: number;
    let basis: ProjectionBasis;
    if (hasScorableStats(row.stats)) {
      points = pointsFromStats(row.stats, row.position);
      basis = "league";
      leagueScoredCount++;
      const keys = Object.keys(row.stats);
      if (keys.length === 1 && keys[0] === "dstPoints") dstPassthroughCount++;
    } else if (row.vendorPoints != null) {
      points = row.vendorPoints;
      basis = "vendor";
      vendorScoredCount++;
    } else {
      unscoredNames.push(row.matchedName ?? row.sourceName);
      continue;
    }

    if (points === 0) zeroProjectionNames.push(row.matchedName ?? row.sourceName);

    byPlayerId.set(row.playerId, {
      playerId: row.playerId,
      name: row.matchedName ?? row.sourceName,
      position: row.position,
      points,
      basis,
      matchMethod: row.matchMethod,
      injuryStatus: row.injuryStatus,
      strengthOfSchedule: row.strengthOfSchedule,
      tier: row.tier,
      positionRank: row.positionRank,
    });
  }

  return {
    provenance: snapshot.provenance,
    byPlayerId,
    leagueScoredCount,
    vendorScoredCount,
    dstPassthroughCount,
    unmatchedSourceNames: unmatchedSourceNames.sort((a, b) => a.localeCompare(b)),
    unscoredNames: unscoredNames.sort((a, b) => a.localeCompare(b)),
    zeroProjectionNames: zeroProjectionNames.sort((a, b) => a.localeCompare(b)),
  };
}

/** Shape check for a file read off disk, so a truncated pull fails loudly. */
export function isProjectionSnapshot(value: unknown): value is ProjectionSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ProjectionSnapshot>;
  if (!Array.isArray(v.players)) return false;
  const p = v.provenance;
  return (
    typeof p === "object" &&
    p !== null &&
    typeof p.source === "string" &&
    typeof p.pulledAt === "string" &&
    typeof p.season === "number"
  );
}

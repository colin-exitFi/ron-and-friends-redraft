import type { DraftRoomView } from "@/lib/draft-types";
import type { ProjectedStats } from "@/lib/projections";
import { SCORING_SPEC } from "@/lib/league-config";

/**
 * The client-side half of the cheat sheet: its row shape, and the pure
 * functions that turn a pool into what is on screen.
 *
 * SEPARATE FROM `@/lib/cheat-sheet` BECAUSE THAT ONE IS `server-only`. The
 * builder reads the pool and the projections snapshot off disk and must never
 * reach a browser bundle; the sorting and filtering must, because they run on
 * every keystroke and a round trip to the server for each one is exactly the
 * lag that makes a research tool feel worse than a sheet of paper.
 *
 * Everything here is pure. That is deliberate and not just tidiness — it means
 * `verify:cheat-sheet` can assert that a drafted player really does leave the
 * available list, without a browser, which is the one behaviour the whole page
 * exists to provide.
 */

/** How a row's projected points were arrived at, for the UI to disclose. */
export type CheatSheetBasis =
  /** Rescored from a raw stat line under this league's rules. */
  | "league"
  /** The feed's own total on the feed's scoring — disclosed, never hidden. */
  | "vendor";

export type CheatSheetRow = {
  /** Smart Draft id. The join key for the pool, projections and the board. */
  id: string;
  name: string;
  position: string;
  team: string | null;
  bye: number | null;
  /**
   * Overall rank on the FantasyPros board the commissioner exported against
   * THIS LEAGUE's configuration, so it already prices the tight end premium
   * and the six-point passing touchdown. The default ordering.
   */
  leagueRank: number | null;
  /** Rank within position on that same league-scoped export. */
  leaguePositionRank: number | null;
  /** FantasyPros tier — from the GENERIC board, not the league one. */
  tier: number | null;
  /** Consensus ADP — the market's price, not this league's. Null if unranked. */
  adp: number | null;
  /** Rank within position by ADP. */
  positionRank: number | null;
  /** FantasyPros' expert-consensus-versus-ADP, in places. Positive = liked. */
  ecrVsAdp: number | null;
  /** Projected season points in THIS league's scoring. Null if unprojected. */
  points: number | null;
  basis: CheatSheetBasis | null;
  /** Rank within position by projected points — this league's own rank. */
  pointsPositionRank: number | null;
  /**
   * THE RAW 2026 COMPONENTS `points` WAS COMPUTED FROM — projected receptions,
   * receiving yards, touchdowns, rushing and passing.
   *
   * This is the same object the total was derived from, which is the property
   * that makes it safe to show: a breakdown and a total that came from two
   * different feeds would not add up, and a panel whose figures contradict the
   * column beside it destroys confidence in both numbers.
   *
   * Null for a team defence, which carries the feed's own total and has no
   * components to break out. See `projectionBreakdown`.
   */
  projectedStats: ProjectedStats | null;
  /**
   * The position the PROJECTION was scored at, which is not always the position
   * this row displays.
   *
   * THE TWO SOURCES DISAGREE ABOUT A HANDFUL OF PLAYERS. The pool lists Max
   * Bredeson as a running back and FantasyPros projects him as a tight end;
   * `pointsFromStats` was therefore given "TE" and paid his catches the premium,
   * while a breakdown computed from the displayed "RB" paid them half. The two
   * differed by 2.25 points and `verify:cheat-sheet` failed on it.
   *
   * A breakdown exists to explain a total, so it has to be computed from the
   * total's own inputs. This field carries them. Null falls back to the row's
   * position, which is right for the 531 players the two feeds agree about.
   */
  projectedStatsPosition: string | null;
  /**
   * LAST SEASON'S ACTUAL POINTS, in this league's scoring. Null for a rookie,
   * for a team defence, and for anyone who did not take the field.
   *
   * A DIFFERENT KIND OF NUMBER FROM `points`, AND THE UI MUST NOT BLUR THEM.
   * `points` is a projection — somebody's opinion about a season that has not
   * happened. This is a fact about one that did, re-scored under the rules this
   * league actually plays, which is the version no public cheat sheet shows:
   * Trey McBride's 126 catches are worth 126 points here and 63 anywhere else.
   */
  lastSeasonPoints: number | null;
  /**
   * Last season's points per game.
   *
   * Carried alongside the total because the total quietly punishes a missed
   * month, and the two answer different questions. Brock Bowers played twelve
   * games; his season total says he was ordinary and his average says he was
   * not, and a manager deciding in ninety seconds needs to see both at once.
   */
  lastSeasonPerGame: number | null;
  lastSeasonGames: number | null;
  /** Pre-formatted stat line — "126 rec, 1,239 yd, 11 TD". */
  lastSeasonLine: string | null;
  /**
   * Sleeper's CURRENT injury designation — `Out`, `IR`, `Questionable`, `Sus`.
   * Null for anybody healthy, which is nearly everyone.
   */
  injuryStatus: string | null;
};

/** Everything the page needs to be honest about where the numbers came from. */
export type CheatSheetMeta = {
  scoringFormat: string;
  /** When the projections were pulled. Null when there are none. */
  projectionsPulledAt: string | null;
  projectionSeason: number | null;
  /** How many rows carry a projection at all. */
  projectedCount: number;
  /** Rows carried at the vendor's own total because no stat line came back. */
  vendorScoredCount: number;
  /** Why there are no projections, when there are none. */
  projectionsProblem: string | null;
  /** A reception is worth this to a tight end here, and 0.5 to everyone else. */
  tePremiumReception: number;
  passTd: number;
  /**
   * The hand-exported FantasyPros board that supplies the default ordering.
   * Null when there isn't one and the sheet has fallen back to ADP order.
   */
  board: {
    /** The FantasyPros league the export was configured against. */
    leagueLabel: string;
    exportedAt: string;
    /** Whether the ORDER respects this league's scoring. The whole point. */
    scopedToLeague: boolean;
    /** `generic` — tiers are not league-scoped, and the UI must say so. */
    tierScope: string;
    rankedCount: number;
  } | null;
  /** Why there is no league-scoped board, when there isn't one. */
  boardProblem: string | null;
  /**
   * Last season's actuals, re-scored in this league's rules. Null when the
   * snapshot is missing, in which case the 2025 column simply is not drawn.
   */
  lastSeason: {
    /** The season the numbers are the actuals FOR — 2025, not the current one. */
    season: number;
    pulledAt: string;
    /** How many rows on the sheet carry a 2025 line. */
    scoredCount: number;
  } | null;
  /** Why there are no last-season numbers, when there are none. */
  lastSeasonProblem: string | null;
};

/**
 * One category of a projection, with the arithmetic that turned it into points.
 *
 * The `rate` and `points` fields are the reason this type exists rather than a
 * bare stat line. The commissioner's ask was to break the projection out by
 * category, and the useful version of that is not "94 receptions" — it is "94
 * receptions, at a full point each here, is 94 points". The second one shows a
 * manager WHERE the number came from and, incidentally, shows him the tight end
 * premium doing its work, which is the intuition the display exists to correct.
 */
export type ProjectionLine = {
  label: string;
  /** The projected component, formatted for display — "94", "991", "6.8". */
  display: string;
  /** What this league pays for it — "×1.0 each", "1 pt / 20 yd". */
  rate: string;
  /** Points this category contributes. Signed; interceptions are negative. */
  points: number;
  /**
   * True for the tight end reception line only. The UI highlights it, because
   * it is the single line on the panel that explains why this league's board
   * disagrees with every public one.
   */
  premium?: boolean;
};

/** Rounds for display without letting `-0` through. */
function tenth(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return rounded === 0 ? 0 : rounded;
}

/**
 * A projection broken out by category, in this league's scoring.
 *
 * ============================================================================
 * WHY THE ORDER DEPENDS ON THE POSITION
 * ============================================================================
 * Passing yards on a running back's row are noise, and a receiver's row led by
 * rushing attempts buries the two numbers that decide his value. So each
 * position leads with what it is drafted for: a quarterback with passing, a
 * back with rushing, a receiver and a tight end with receptions. Categories the
 * player does not register in are omitted entirely rather than printed as
 * zeroes — a wideout with no passing line should not carry three empty rows.
 *
 * PURE, SO THE ARITHMETIC CAN BE VERIFIED WITHOUT A BROWSER. The sum of the
 * `points` fields must equal the row's total, and `verify:cheat-sheet` asserts
 * exactly that against every row on the board. A breakdown that does not add up
 * to the column beside it is the one failure mode of this panel, and it would be
 * invisible on screen.
 *
 * Returns an empty array for a team defence, whose points are the feed's own
 * total with no components published, and for anyone unprojected. Never throws
 * on a missing stat: an absent category is simply not a line.
 */
export function projectionBreakdown(row: CheatSheetRow): ProjectionLine[] {
  const s = row.projectedStats;
  if (!s) return [];

  // The position the POINTS were computed at, not necessarily the one on
  // screen. See `projectedStatsPosition` for the player who proved it matters.
  const scoredAt = (row.projectedStatsPosition ?? row.position).toUpperCase();
  const isTe = scoredAt === "TE";
  const perReception = isTe ? SCORING_SPEC.ppr + SCORING_SPEC.recTePremium : SCORING_SPEC.ppr;

  const passing: ProjectionLine[] = [
    s.passYards
      ? {
          label: "Passing yards",
          display: Math.round(s.passYards).toLocaleString(),
          rate: `1 pt / ${SCORING_SPEC.passYardsPerPoint} yd`,
          points: s.passYards / SCORING_SPEC.passYardsPerPoint,
        }
      : null,
    s.passTd
      ? {
          label: "Passing TD",
          display: tenth(s.passTd).toString(),
          // Named as the league's own rate because it is the headline
          // difference from every four-point board a manager has seen.
          rate: `×${SCORING_SPEC.passTd} each`,
          points: s.passTd * SCORING_SPEC.passTd,
        }
      : null,
    s.interceptions
      ? {
          label: "Interceptions",
          display: tenth(s.interceptions).toString(),
          rate: `×${SCORING_SPEC.interceptionThrown} each`,
          points: s.interceptions * SCORING_SPEC.interceptionThrown,
        }
      : null,
  ].filter((l): l is ProjectionLine => l !== null);

  const rushing: ProjectionLine[] = [
    s.rushYards
      ? {
          label: "Rushing yards",
          display: Math.round(s.rushYards).toLocaleString(),
          rate: `1 pt / ${SCORING_SPEC.rushRecYardsPerPoint} yd`,
          points: s.rushYards / SCORING_SPEC.rushRecYardsPerPoint,
        }
      : null,
    s.rushTd
      ? {
          label: "Rushing TD",
          display: tenth(s.rushTd).toString(),
          rate: `×${SCORING_SPEC.rushTd} each`,
          points: s.rushTd * SCORING_SPEC.rushTd,
        }
      : null,
  ].filter((l): l is ProjectionLine => l !== null);

  const receiving: ProjectionLine[] = [
    s.receptions
      ? {
          label: "Receptions",
          display: tenth(s.receptions).toString(),
          rate: isTe
            ? `×${perReception.toFixed(1)} each — TE premium`
            : `×${perReception} each`,
          points: s.receptions * perReception,
          premium: isTe,
        }
      : null,
    s.recYards
      ? {
          label: "Receiving yards",
          display: Math.round(s.recYards).toLocaleString(),
          rate: `1 pt / ${SCORING_SPEC.rushRecYardsPerPoint} yd`,
          points: s.recYards / SCORING_SPEC.rushRecYardsPerPoint,
        }
      : null,
    s.recTd
      ? {
          label: "Receiving TD",
          display: tenth(s.recTd).toString(),
          rate: `×${SCORING_SPEC.recTd} each`,
          points: s.recTd * SCORING_SPEC.recTd,
        }
      : null,
  ].filter((l): l is ProjectionLine => l !== null);

  const other: ProjectionLine[] = [
    s.twoPointConversions
      ? {
          label: "2-point conversions",
          display: tenth(s.twoPointConversions).toString(),
          rate: `×${SCORING_SPEC.twoPointConversion} each`,
          points: s.twoPointConversions * SCORING_SPEC.twoPointConversion,
        }
      : null,
    s.fumblesLost
      ? {
          label: "Fumbles lost",
          display: tenth(s.fumblesLost).toString(),
          rate: `×${SCORING_SPEC.fumbleLost} each`,
          points: s.fumblesLost * SCORING_SPEC.fumbleLost,
        }
      : null,
  ].filter((l): l is ProjectionLine => l !== null);

  const position = row.position.toUpperCase();
  if (position === "QB") return [...passing, ...rushing, ...receiving, ...other];
  if (position === "RB") return [...rushing, ...receiving, ...passing, ...other];
  // WR, TE and anything unexpected lead with what they are drafted for.
  return [...receiving, ...rushing, ...passing, ...other];
}

/**
 * The two or three projected numbers worth putting ON the row, by position.
 *
 * The full breakdown is a tap away; this is what a manager reads while
 * scrolling. Positional by the same argument as `projectionBreakdown` — a
 * back's receptions matter and his passing yards do not — and capped at three
 * so it stays one short line on a 390px screen rather than wrapping into three.
 *
 * Null when there is nothing to say, so the UI renders no line at all rather
 * than an empty one.
 */
export function projectedStatLine(row: CheatSheetRow): string | null {
  const s = row.projectedStats;
  if (!s) return null;

  const yd = (v: number) => Math.round(v).toLocaleString();
  const one = (v: number) => tenth(v).toString();
  const parts: string[] = [];
  const position = row.position.toUpperCase();

  if (position === "QB") {
    if (s.passYards) parts.push(`${yd(s.passYards)} pass yd`);
    if (s.passTd) parts.push(`${one(s.passTd)} pass TD`);
    // A rushing quarterback is worth flagging; a pocket one gets no clause.
    if (s.rushYards && s.rushYards >= 150) parts.push(`${yd(s.rushYards)} rush yd`);
  } else if (position === "RB") {
    if (s.rushYards) parts.push(`${yd(s.rushYards)} rush yd`);
    if (s.rushTd) parts.push(`${one(s.rushTd)} rush TD`);
    if (s.receptions) parts.push(`${one(s.receptions)} rec`);
  } else {
    if (s.receptions) parts.push(`${one(s.receptions)} rec`);
    if (s.recYards) parts.push(`${yd(s.recYards)} rec yd`);
    if (s.recTd) parts.push(`${one(s.recTd)} rec TD`);
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Who has a player, and at which pick. Keyed by Smart Draft player id. */
export type DraftedBy = Record<string, { by: string; label: string }>;

/**
 * The drafted layer, reduced to the two facts a cheat sheet row needs.
 *
 * Derived from the room view rather than from `draftedPlayerIds` alone, because
 * "gone" is not quite enough: the first thing anybody asks is who took him, and
 * the board already knows. Keepers count as drafted — a keeper is off the board
 * in exactly the way a pick is — though this league has none in 2026.
 *
 * Runs on the CLIENT, against the same `/api/draft/state` payload the draft
 * board re-syncs from. One endpoint, one shape, so a remote phone and the board
 * in the room cannot come to different conclusions about who is available.
 */
export function draftedFromView(view: DraftRoomView): DraftedBy {
  const drafted: DraftedBy = {};
  for (const slot of view.slots) {
    if (!slot.player) continue;
    drafted[slot.player.id] = {
      by: slot.currentOwner.name,
      label: slot.isKeeper ? "kept" : slot.label,
    };
  }
  return drafted;
}

/**
 * The projected-stat columns the sheet shows, in the order they appear.
 *
 * A SPREADSHEET, WHICH MEANS EVERY ROW HAS EVERY COLUMN. A quarterback's
 * receptions cell is blank rather than absent, because the uniform grid is what
 * makes reading down a column mean anything — and reading down a column is what
 * a manager does with this.
 */
export const STAT_COLUMNS = [
  "passYards",
  "passTd",
  "interceptions",
  "rushYards",
  "rushTd",
  "receptions",
  "recYards",
  "recTd",
  "fumblesLost",
] as const;

export type StatColumn = (typeof STAT_COLUMNS)[number];

/** Sort keys the header offers — one per column, including every stat column. */
export type SortKey =
  | "rank"
  | "adp"
  | "points"
  | "lastSeason"
  | "position"
  | "name"
  | StatColumn;

const STAT_KEYS = new Set<string>(STAT_COLUMNS);
export type Availability = "available" | "all" | "drafted";

export type CheatSheetQuery = {
  q: string;
  /** "" for every position, `FLEX_FILTER` for the combined RB/WR/TE pool. */
  position: string;
  availability: Availability;
  sort: SortKey;
};

/**
 * Case- and punctuation-insensitive substring match on the name.
 *
 * Deliberately NOT the fuzzy subsequence matcher `@/lib/player-search` uses for
 * the draft room's autocomplete. That one is tuned to find one player from a
 * few typed letters under time pressure, and it is right there. Here the reader
 * is browsing, the list stays sorted by whatever column he chose, and a fuzzy
 * match would quietly pull in players who look nothing like what he typed and
 * leave him unsure whether the list is still complete.
 */
function matches(query: string, name: string): boolean {
  if (!query) return true;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  return normalize(name).includes(normalize(query));
}

const POSITION_ORDER = ["QB", "RB", "WR", "TE", "DST"];

/**
 * The `position` value that means "the whole flex pool", not one position.
 *
 * Late in a draft the question stops being "which receiver" and becomes "who is
 * the best player I would actually start", and the answer can be a back, a
 * receiver or a tight end. That is not a position filter, so it is not a
 * position — it is a sentinel `applyCheatSheet` widens into the three.
 */
export const FLEX_FILTER = "FLEX";

/**
 * What this league's two FLEX slots accept — @fromConfig `STARTING_LINEUP`'s
 * `{ slot: "FLEX", note: "RB / WR / TE" }`.
 *
 * Kicked out to a constant so the filter cannot drift from the lineup card. A
 * flex filter that quietly included quarterbacks would put four names nobody
 * can start at the top of the list at the exact moment a manager is trusting
 * the order.
 */
export const FLEX_POSITIONS = ["RB", "WR", "TE"] as const;

/** Whether a row survives the position filter. `""` admits everybody. */
function positionMatches(filter: string, position: string): boolean {
  if (!filter) return true;
  if (filter === FLEX_FILTER) {
    return (FLEX_POSITIONS as readonly string[]).includes(position);
  }
  return position === filter;
}

/**
 * Apply the filters and the sort. Pure; the single source of what is on screen.
 *
 * A DRAFTED PLAYER IS FILTERED OUT AT `available`, NOT DIMMED. The complaint
 * this page answers is "I cannot see who is gone", and the two honest answers
 * to that are to remove him or to strike him through. Both are offered because
 * they serve different moments: `available` is what you want while deciding,
 * and `all` — which keeps him in place with a line through him — is what you
 * want when you are checking whether the guy you were waiting on has just gone.
 *
 * THE SORT IS APPLIED AFTER THE FILTER, ACROSS WHATEVER SURVIVED IT, which is
 * what makes `FLEX_FILTER` worth having rather than merely present. A flex list
 * is only useful if it is ordered: a back, a receiver and a tight end ranked
 * against each other on the league's own board — or on projected points, where
 * the tight end premium shows up — is the answer to "best player available".
 * The same three positions in an arbitrary order is three lists stapled
 * together.
 */
export function applyCheatSheet(
  rows: CheatSheetRow[],
  drafted: DraftedBy,
  { q, position, availability, sort }: CheatSheetQuery,
): CheatSheetRow[] {
  const filtered = rows.filter((row) => {
    if (!positionMatches(position, row.position)) return false;
    const isDrafted = drafted[row.id] != null;
    if (availability === "available" && isDrafted) return false;
    if (availability === "drafted" && !isDrafted) return false;
    return matches(q, row.name);
  });

  /*
   * Every sort falls back to ADP and then to name, so the order is TOTAL. A
   * partial comparator leaves rows that tie free to swap places between
   * renders, and a cheat sheet whose rows move while you are reading it is the
   * thing that makes people go back to paper.
   */
  const byAdp = (a: CheatSheetRow, b: CheatSheetRow) =>
    (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.name.localeCompare(b.name);

  const sorted = [...filtered];
  if (sort === "rank") {
    // The league-scoped export's order, with anyone it does not rank falling
    // through to ADP rather than to the top.
    sorted.sort(
      (a, b) => (a.leagueRank ?? Infinity) - (b.leagueRank ?? Infinity) || byAdp(a, b),
    );
  } else if (sort === "adp") {
    sorted.sort(byAdp);
  } else if (sort === "points") {
    // Unprojected players go to the bottom rather than reading as zero.
    sorted.sort(
      (a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity) || byAdp(a, b),
    );
  } else if (sort === "lastSeason") {
    /*
     * Sorts on POINTS PER GAME, not on the season total, and that is the whole
     * reason the sort is worth offering. A total ranks a healthy plodder above
     * a star who missed five games, which is the exact mistake a manager makes
     * unaided; the per-game figure is the one that answers "who was actually
     * good last year". The total is still on the row and still rendered.
     *
     * Rookies and defences have no 2025 season and sort to the bottom rather
     * than reading as zero — a blank is not a bad season.
     */
    sorted.sort(
      (a, b) =>
        (b.lastSeasonPerGame ?? -Infinity) - (a.lastSeasonPerGame ?? -Infinity) ||
        byAdp(a, b),
    );
  } else if (STAT_KEYS.has(sort)) {
    /*
     * A stat column, sorted the way a spreadsheet sorts: biggest first, blanks
     * at the bottom. Descending even for interceptions and fumbles — "most
     * turnovers" is a real question and a column that reversed its own
     * direction depending on which one you tapped would be a surprise.
     */
    const stat = (row: CheatSheetRow) =>
      row.projectedStats?.[sort as StatColumn] ?? -Infinity;
    sorted.sort((a, b) => stat(b) - stat(a) || byAdp(a, b));
  } else if (sort === "position") {
    sorted.sort((a, b) => {
      const pa = POSITION_ORDER.indexOf(a.position);
      const pb = POSITION_ORDER.indexOf(b.position);
      return (
        (pa < 0 ? POSITION_ORDER.length : pa) - (pb < 0 ? POSITION_ORDER.length : pb) ||
        byAdp(a, b)
      );
    });
  } else {
    sorted.sort((a, b) => a.name.localeCompare(b.name) || byAdp(a, b));
  }
  return sorted;
}

/**
 * How far the market's price is from this league's valuation, in ADP places.
 *
 * Positive means the league values him HIGHER than the room will pay — the
 * tight ends the premium creates, and the quarterbacks the six-point passing
 * touchdown creates. This is the number that justifies the page existing, so it
 * is computed once here rather than eyeballed off two columns.
 *
 * Null unless both ranks exist, because a gap computed against a missing rank
 * is a guess wearing a number's clothes.
 */
export function valueGap(row: CheatSheetRow): number | null {
  if (row.positionRank == null || row.pointsPositionRank == null) return null;
  return row.positionRank - row.pointsPositionRank;
}

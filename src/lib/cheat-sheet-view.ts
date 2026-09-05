import type { DraftRoomView } from "@/lib/draft-types";

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

/** Sort keys the header offers. */
export type SortKey = "rank" | "adp" | "points" | "lastSeason" | "position" | "name";
export type Availability = "available" | "all" | "drafted";

export type CheatSheetQuery = {
  q: string;
  /** "" for every position. */
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
 * Apply the filters and the sort. Pure; the single source of what is on screen.
 *
 * A DRAFTED PLAYER IS FILTERED OUT AT `available`, NOT DIMMED. The complaint
 * this page answers is "I cannot see who is gone", and the two honest answers
 * to that are to remove him or to strike him through. Both are offered because
 * they serve different moments: `available` is what you want while deciding,
 * and `all` — which keeps him in place with a line through him — is what you
 * want when you are checking whether the guy you were waiting on has just gone.
 */
export function applyCheatSheet(
  rows: CheatSheetRow[],
  drafted: DraftedBy,
  { q, position, availability, sort }: CheatSheetQuery,
): CheatSheetRow[] {
  const filtered = rows.filter((row) => {
    if (position && row.position !== position) return false;
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

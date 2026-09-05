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
  /** Consensus ADP — the market's price, not this league's. Null if unranked. */
  adp: number | null;
  /** Rank within position by ADP. */
  positionRank: number | null;
  /** Projected season points in THIS league's scoring. Null if unprojected. */
  points: number | null;
  basis: CheatSheetBasis | null;
  /** Rank within position by projected points — this league's own rank. */
  pointsPositionRank: number | null;
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
export type SortKey = "adp" | "points" | "position" | "name";
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
  if (sort === "adp") {
    sorted.sort(byAdp);
  } else if (sort === "points") {
    // Unprojected players go to the bottom rather than reading as zero.
    sorted.sort(
      (a, b) => (b.points ?? -Infinity) - (a.points ?? -Infinity) || byAdp(a, b),
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

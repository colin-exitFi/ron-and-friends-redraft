import "server-only";

import { getPlayerPool } from "@/lib/smartdraft";
import { DRAFTABLE_POSITIONS, type PoolPlayer } from "@/lib/board-types";

/**
 * Search over the Smart Draft player pool.
 *
 * The pool is a local snapshot, so this is all in-memory: there is no query
 * budget to respect and the whole pool can be re-ranked per keystroke.
 */

export type PlayerHit = {
  id: string;
  name: string;
  position: string;
  team: string | null;
  bye: number | null;
  adp: number | null;
  positionRank: number | null;
  /** Franchise holding him as a 2026 keeper — he is off the board. */
  keptBy: string | null;
  /** Already locked to a board slot, so not selectable in the draft room. */
  drafted: boolean;
};

const POSITION_PRIORITY = new Map(DRAFTABLE_POSITIONS.map((p, i) => [p as string, i]));

/** Lightweight fuzzy/subsequence match — every query char appears in order. */
function subsequenceScore(query: string, target: string): number | null {
  if (!query) return 0;
  let qi = 0;
  let gaps = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      if (lastIdx >= 0) gaps += ti - lastIdx - 1;
      lastIdx = ti;
      qi++;
    }
  }
  if (qi < query.length) return null; // not all chars matched
  return gaps;
}

/** Relevance score — lower is better. */
function rank(query: string, name: string): number | null {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;

  if (n.startsWith(q)) return 0;

  // word-boundary prefix (e.g. "jeff" matches "Justin Jefferson")
  const words = n.split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return 5;

  const idx = n.indexOf(q);
  if (idx >= 0) return 10 + idx * 0.01;

  const fuzzy = subsequenceScore(q, n);
  if (fuzzy != null) return 40 + fuzzy * 0.1;

  return null;
}

function toHit(p: PoolPlayer): PlayerHit {
  return {
    id: p.id,
    name: p.name,
    position: p.position,
    team: p.nflTeam,
    bye: p.byeWeek,
    adp: p.adp,
    positionRank: p.positionRank,
    keptBy: p.keptBy,
    drafted: p.keptBy != null,
  };
}

export type SearchPlayersInput = {
  q?: string;
  pos?: string;
  excludeDrafted?: boolean;
  limit?: number;
};

export function searchPlayers({
  q = "",
  pos,
  excludeDrafted = false,
  limit = 30,
}: SearchPlayersInput): PlayerHit[] {
  const candidates = pos
    ? getPlayerPool().filter((p) => p.position === pos)
    : getPlayerPool();

  const scored: { p: PoolPlayer; score: number }[] = [];
  for (const p of candidates) {
    if (excludeDrafted && p.keptBy) continue;
    const score = rank(q, p.name);
    if (score != null) scored.push({ p, score });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    // Ties break toward the player the room would actually take next.
    const ra = a.p.adp ?? Number.POSITIVE_INFINITY;
    const rb = b.p.adp ?? Number.POSITIVE_INFINITY;
    if (ra !== rb) return ra - rb;
    const pa = POSITION_PRIORITY.get(a.p.position) ?? 9;
    const pb = POSITION_PRIORITY.get(b.p.position) ?? 9;
    if (pa !== pb) return pa - pb;
    return a.p.name.localeCompare(b.p.name);
  });

  return scored.slice(0, limit).map(({ p }) => toHit(p));
}

export type BrowsePlayersInput = {
  q?: string;
  pos?: string;
  /** Only players Smart Draft has a consensus ADP for — the real draft pool. */
  rankedOnly?: boolean;
  limit?: number;
};

/**
 * The `/players` table: ADP order rather than match order, so browsing reads
 * like a cheat sheet. A query still narrows it, but does not resort it.
 */
export function browsePlayers({
  q = "",
  pos,
  rankedOnly = false,
  limit = 300,
}: BrowsePlayersInput): { rows: PlayerHit[]; matched: number } {
  const needle = q.trim().toLowerCase();
  const filtered = getPlayerPool().filter((p) => {
    if (pos && p.position !== pos) return false;
    if (rankedOnly && p.adp == null) return false;
    if (needle && rank(needle, p.name) == null) return false;
    return true;
  });
  return { rows: filtered.slice(0, limit).map(toHit), matched: filtered.length };
}

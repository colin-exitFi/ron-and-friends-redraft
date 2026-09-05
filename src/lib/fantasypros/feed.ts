import "server-only";

import { cached, forgetMemo, type CacheOutcome } from "@/lib/fantasypros/cache";
import { withFantasyPros, type FantasyProsClient } from "@/lib/fantasypros/client";
import { fetchPlayerFeed, type FantasyProsPlayer } from "@/lib/fantasypros/players";
import { fantasyProsOverlay } from "@/lib/fantasypros/snapshot";

/**
 * The live FantasyPros layer, and the rule that keeps it from ever mattering
 * that it failed.
 *
 * WHAT HAPPENS WHEN FANTASYPROS IS UNAVAILABLE, in order:
 *
 *   1. the process memo answers, if this instance has already asked;
 *   2. the shared cache row answers, even past its TTL — an expired row is
 *      still last-known-good and is served with `source: "stale"` and the
 *      reason attached, never silently;
 *   3. the committed snapshot in `data/` answers, which ships inside the
 *      deployment and therefore cannot be missing;
 *   4. and if somehow none of those exist, the caller gets an empty feed with
 *      an explanation — never an exception.
 *
 * Nothing in this module is on the pick path. The board, the search and the
 * expectation all read the synchronous pool in `@/lib/smartdraft`, which is
 * built from the committed snapshot; this is what makes that snapshot fresher
 * between drafts. A caller here is a page that can afford to await, or the
 * refresh route, or the cron.
 */

/** Short enough to feel live in the hours before a draft; long enough that ten
 *  people refreshing /players does not become ten calls to FantasyPros. */
const PLAYER_TTL_MS = 10 * 60_000;

/** The whole exchange, including both tool calls. Well past the ~1.2s observed. */
const FEED_TIMEOUT_MS = 15_000;

const PLAYER_KEY = "nfl:players:ppr";

export type FeedSource = "fresh" | "cache" | "stale" | "snapshot" | "unavailable";

export type LivePlayerFeed = {
  players: FantasyProsPlayer[];
  /** When the data was actually fetched from FantasyPros. */
  fetchedAt: string | null;
  source: FeedSource;
  /** Why this is not fresh. Present for `stale`, `snapshot` and `unavailable`. */
  reason?: string;
  scoring: string | null;
};

type CachedFeed = {
  fetchedAt: string;
  scoring: string;
  players: FantasyProsPlayer[];
};

/**
 * The floor: whatever `npm run pull:fantasypros` last committed.
 *
 * Read through the same parsed overlay the pool uses, so there is one copy of
 * the file in memory rather than two.
 */
function fromSnapshot(reason: string): LivePlayerFeed {
  const overlay = fantasyProsOverlay();
  if (!overlay) {
    return {
      players: [],
      fetchedAt: null,
      source: "unavailable",
      reason:
        `${reason} There is also no committed snapshot — run \`npm run pull:fantasypros\`. ` +
        `The draft board is unaffected; it reads the Smart Draft pool.`,
      scoring: null,
    };
  }
  // The overlay is indexed for joining rather than kept as a list, so this
  // reconstructs the rows. Only reached on a failure path, so the cost is
  // irrelevant and not duplicating the parsed file is worth more.
  const players: FantasyProsPlayer[] = [];
  for (const [key, entry] of overlay.byKey) {
    const [name, position] = key.split("|");
    players.push({
      fpId: entry.fpId,
      name,
      position: position ?? "",
      team: null,
      adp: entry.adp,
      rank: entry.rank,
      posRank: null,
      byeWeek: null,
      ecrRank: entry.ecrRank,
      headshotUrl: entry.headshotUrl,
    });
  }
  return {
    players,
    fetchedAt: overlay.fetchedAt,
    source: "snapshot",
    reason,
    scoring: overlay.scoring,
  };
}

/**
 * ADP and expert consensus, as fresh as is safely available.
 *
 * Never throws. See the note at the top of the file for what it does instead.
 */
export async function getLivePlayerFeed(
  options: { force?: boolean } = {},
): Promise<LivePlayerFeed> {
  let outcome: CacheOutcome<CachedFeed> | null;
  try {
    outcome = await cached<CachedFeed>(
      PLAYER_KEY,
      PLAYER_TTL_MS,
      async () => {
        const feed = await withFantasyPros((client) => fetchPlayerFeed(client), {
          timeoutMs: FEED_TIMEOUT_MS,
        });
        return {
          fetchedAt: feed.fetchedAt,
          scoring: feed.scoring,
          // Headshots are resolved by the pull script, not here: probing 500
          // URLs is a minute of work and has no business on a request path.
          // The committed snapshot supplies them, joined by the pool.
          players: feed.players,
        };
      },
      options,
    );
  } catch (err) {
    // `cached` is written not to throw; this is belt and braces, because the
    // one thing this module must never do is become a new way for a page to
    // 500 the night before a draft.
    return fromSnapshot(
      `The FantasyPros cache itself failed: ${err instanceof Error ? err.message : String(err)}.`,
    );
  }

  if (!outcome) {
    return fromSnapshot("FantasyPros could not be reached and nothing was cached.");
  }

  return {
    players: outcome.value.players,
    fetchedAt: outcome.value.fetchedAt,
    source: outcome.source,
    reason: outcome.staleReason,
    scoring: outcome.value.scoring,
  };
}

/** Forces the next read to go upstream. Used by the manual refresh route. */
export function forgetPlayerFeed(): void {
  forgetMemo(PLAYER_KEY);
}

/**
 * Calls any FantasyPros tool through the cache, timeout and fallback.
 *
 * THIS IS THE ENTRY POINT OTHER FEATURES SHOULD USE — the projections work in
 * particular. Calling `withFantasyPros` directly is supported but skips the
 * cache, which means a cold page can spend a second waiting and a bad
 * afternoon can spend it repeatedly.
 *
 * Returns null rather than throwing when the call fails and nothing is
 * cached, so a caller's own fallback is a null check rather than a try/catch.
 *
 *   const proj = await cachedTool<Doc>("qb-projections", "get_projections",
 *     { sport: "nfl", position: "QB", limit: 60 });
 *   if (!proj) return localProjections();
 */
export async function cachedTool<T>(
  key: string,
  tool: string,
  args: Record<string, unknown> = {},
  options: { ttlMs?: number; force?: boolean; timeoutMs?: number } = {},
): Promise<CacheOutcome<T> | null> {
  return cached<T>(
    `tool:${key}`,
    options.ttlMs ?? PLAYER_TTL_MS,
    () =>
      withFantasyPros((client: FantasyProsClient) => client.callTool<T>(tool, args), {
        timeoutMs: options.timeoutMs ?? FEED_TIMEOUT_MS,
      }),
    { force: options.force },
  );
}

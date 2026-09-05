import "server-only";

import { hasDatabase } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Last-known-good storage for FantasyPros answers.
 *
 * THREE LAYERS, AND THE ORDER MATTERS ON DRAFT NIGHT:
 *
 *   1. an in-process memo, so a page that reads the pool four times in one
 *      render costs one upstream call;
 *   2. this table, shared by every instance and surviving a deploy, so the
 *      cron warmer's fetch is already there for the first request after a push
 *      and one cold instance cannot stampede FantasyPros;
 *   3. the committed snapshot in `data/`, which is not here — it is the floor,
 *      and it ships inside the deployment so it cannot be unavailable.
 *
 * WHY POSTGRES RATHER THAN VERCEL'S RUNTIME CACHE. Runtime Cache is per-region,
 * best-effort and evictable; it is a cache in the strict sense, and a cache is
 * allowed to be empty. What this needs is not only "avoid a round trip" but
 * "still have Tuesday's numbers when FantasyPros is down on Saturday", which is
 * a durability requirement, not a caching one. An evicted entry the moment the
 * upstream goes down is precisely the case the fallback exists for. Postgres is
 * already the answer this project gives to "the deployment has no disk", it is
 * where the cron warmer can leave something that is certainly still there, and
 * a stale row is kept on purpose rather than deleted at TTL — expiry decides
 * whether to REFETCH, never whether the row may still be served.
 */

export type CacheOutcome<T> = {
  value: T;
  /** When the upstream call that produced this value succeeded. */
  fetchedAt: string;
  /**
   * `fresh` — just fetched. `cache` — within TTL, no call made.
   * `stale` — TTL passed and the refetch failed, so this is last-known-good.
   */
  source: "fresh" | "cache" | "stale";
  /** Why the value is stale. Shown in the UI; never swallowed. */
  staleReason?: string;
};

type Entry = { payload: unknown; fetchedAt: string };

/**
 * `fantasypros_cache` is not in `@/lib/supabase/types` until its migration is
 * pushed, so the client is narrowed to the calls made here rather than widened
 * to `any` — the same shim `@/lib/recap-store` uses. See the note there.
 */
type CacheRow = { key: string; payload: unknown; fetched_at: string; updated_at: string };
type CacheTable = {
  select(columns: string): {
    eq(
      column: string,
      value: string,
    ): { maybeSingle(): Promise<{ data: CacheRow | null; error: { message: string } | null }> };
  };
  upsert(
    row: CacheRow,
    options: { onConflict: string },
  ): Promise<{ error: { message: string } | null }>;
  delete(): {
    neq(column: string, value: string): Promise<{ error: { message: string } | null }>;
  };
};

function cacheTable(): CacheTable {
  return (
    createServiceClient() as unknown as { from(table: string): CacheTable }
  ).from("fantasypros_cache");
}

/** Per-instance memo. Bounded by the number of distinct keys, which is small. */
const memo = new Map<string, Entry>();

async function readShared(key: string): Promise<Entry | null> {
  if (!hasDatabase()) return null;
  try {
    const { data, error } = await cacheTable()
      .select("key, payload, fetched_at, updated_at")
      .eq("key", key)
      .maybeSingle();
    if (error || !data) return null;
    return { payload: data.payload, fetchedAt: data.fetched_at };
  } catch {
    // A cache that cannot be read is a cache miss, never an error the caller
    // has to handle. The whole point of this module is to not be a new way for
    // the draft board to break.
    return null;
  }
}

async function writeShared(key: string, entry: Entry): Promise<void> {
  if (!hasDatabase()) return;
  try {
    await cacheTable().upsert(
      {
        key,
        payload: entry.payload,
        fetched_at: entry.fetchedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {
    // Same reasoning: failing to cache a value we already have in hand is not
    // a reason to fail the request that fetched it.
  }
}

function isFresh(entry: Entry, ttlMs: number): boolean {
  const at = Date.parse(entry.fetchedAt);
  return Number.isFinite(at) && Date.now() - at < ttlMs;
}

/**
 * Fetches through the cache, and NEVER throws when there is anything at all to
 * serve.
 *
 * Returns null only when the upstream failed and nothing has ever been cached
 * — which is the caller's cue to fall back to the committed snapshot.
 *
 * `force` skips the freshness check but not the fallback: a manual refresh that
 * cannot reach FantasyPros still hands back what was there rather than
 * emptying the board.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  produce: () => Promise<T>,
  options: { force?: boolean } = {},
): Promise<CacheOutcome<T> | null> {
  const local = memo.get(key);
  if (!options.force && local && isFresh(local, ttlMs)) {
    return { value: local.payload as T, fetchedAt: local.fetchedAt, source: "cache" };
  }

  const shared = await readShared(key);
  if (shared) memo.set(key, shared);
  if (!options.force && shared && isFresh(shared, ttlMs)) {
    return { value: shared.payload as T, fetchedAt: shared.fetchedAt, source: "cache" };
  }

  try {
    const value = await produce();
    const entry: Entry = { payload: value, fetchedAt: new Date().toISOString() };
    memo.set(key, entry);
    await writeShared(key, entry);
    return { value, fetchedAt: entry.fetchedAt, source: "fresh" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const fallback = shared ?? local ?? null;
    if (!fallback) {
      console.error(`[fantasypros] ${key} failed with nothing cached to fall back to: ${reason}`);
      return null;
    }
    console.error(`[fantasypros] ${key} failed; serving the cached copy instead: ${reason}`);
    return {
      value: fallback.payload as T,
      fetchedAt: fallback.fetchedAt,
      source: "stale",
      staleReason: reason,
    };
  }
}

/** Drops the per-instance memo. Used by the manual refresh path and by tests. */
export function forgetMemo(key?: string): void {
  if (key) memo.delete(key);
  else memo.clear();
}

/**
 * Empties the shared cache as well as the memo.
 *
 * ONLY FOR A CHANGE OF ACCOUNT, and it is the step that is easy to forget. When
 * the grant is reset because it was for the wrong FantasyPros account, deleting
 * the credential does not delete the ANSWERS it fetched — those rows sit in
 * `fantasypros_cache` and are served for their whole TTL, and are served past
 * it indefinitely if the upstream is unreachable. A reset that leaves them
 * behind quietly keeps the wrong account's data live.
 *
 * Not a routine operation: this deliberately removes the last-known-good rows
 * that make an outage survivable, so the committed snapshot becomes the only
 * floor until something repopulates them.
 */
export async function clearSharedCache(): Promise<boolean> {
  memo.clear();
  if (!hasDatabase()) return false;

  // `neq` on the primary key against a value no key uses is how PostgREST
  // spells "every row"; an unfiltered delete is rejected outright.
  const { error } = await cacheTable().delete().neq("key", "");
  if (error) throw new Error(`Clearing the FantasyPros cache failed: ${error.message}`);
  return true;
}

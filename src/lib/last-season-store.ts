import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import {
  isLastSeasonSnapshot,
  type LastSeasonLine,
  type LastSeasonSnapshot,
} from "@/lib/sleeper-season";

/**
 * Last season's league-scored production, read off disk.
 *
 * ============================================================================
 * WHY THIS IS A COMMITTED FILE AND NOT A FETCH
 * ============================================================================
 * The commissioner's one hard requirement for `/players` is that it stays live
 * and stays fast on a phone on a venue's wifi. Sleeper's stats endpoint is
 * free, public and unauthenticated — but the player map it has to be joined
 * against is FOURTEEN MEGABYTES, and the two together take a couple of seconds
 * on a good connection. Nothing that size belongs on a request path, and it
 * absolutely does not belong on a per-row one.
 *
 * So `npm run pull:last-season` does the fetch, the join and the scoring once,
 * ahead of the draft, and writes a ~200KB file. The page then pays a synchronous
 * read of a cached parse, which is the same deal `@/lib/cheatsheet-export` and
 * `@/lib/smartdraft` already strike. Last season's numbers are finished — they
 * cannot change during the draft — so there is nothing a live fetch would buy.
 *
 * NEVER THROWS, AND A MISSING FILE IS A NORMAL STATE. The snapshot is generated
 * by a script that talks to a third party, so "there isn't one" has to render.
 * The sheet then shows every row without a 2025 column and says why, which is
 * the behaviour the page had this morning rather than a broken page.
 */

export type LastSeasonState =
  | {
      state: "ok";
      snapshot: LastSeasonSnapshot;
      /** Keyed by `joinKey(name, position)`. See `LastSeasonSnapshot.players`. */
      byJoinKey: Map<string, LastSeasonLine>;
    }
  | { state: "missing"; file: string }
  | { state: "unreadable"; file: string; reason: string };

/**
 * The season these are the actuals for.
 *
 * A LITERAL, NOT `CURRENT_SEASON - 1`. The derived version would silently start
 * looking for a file that does not exist the moment the league rolls over to
 * 2027, and the failure would be a quietly empty column rather than an error.
 * The file is a deliberate artifact of one draft; the day there is a 2026 season
 * to look back on, somebody re-pulls and changes this line.
 */
export const LAST_SEASON = 2025;

let cache: { season: number; result: LastSeasonState } | null = null;

/** The snapshot, or a stated reason there isn't one. Never throws. */
export function readLastSeason(season: number = LAST_SEASON): LastSeasonState {
  if (cache && cache.season === season) return cache.result;

  const file = path.join(process.cwd(), `data/sleeper-season-${season}.json`);
  let result: LastSeasonState;
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    result = isLastSeasonSnapshot(parsed)
      ? {
          state: "ok",
          snapshot: parsed,
          byJoinKey: new Map(Object.entries(parsed.players)),
        }
      : {
          state: "unreadable",
          file,
          reason: "not a last-season snapshot — re-run `npm run pull:last-season`",
        };
  } catch (cause) {
    result =
      (cause as { code?: string })?.code === "ENOENT"
        ? { state: "missing", file }
        : { state: "unreadable", file, reason: String((cause as Error)?.message ?? cause) };
  }

  cache = { season, result };
  return result;
}

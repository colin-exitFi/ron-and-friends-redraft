import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { CURRENT_SEASON } from "@/lib/league-config";
import {
  indexProjections,
  isProjectionSnapshot,
  type ProjectionIndex,
} from "@/lib/projections";
import type { LineupProjectionPoints } from "@/lib/roster-lineup";

/**
 * The committed projections snapshot — the floor under the live integration.
 *
 * ============================================================================
 * WHAT THIS IS FOR
 * ============================================================================
 *
 * FantasyPros is being wired in as a live, first-class integration: a
 * server-side MCP client under `src/lib/fantasypros/` holds a refreshable token
 * and serves fresh projections. This module is NOT that, and is not a competitor
 * to it. It reads a snapshot committed to `data/`, and it exists for one reason:
 *
 *   **The league drafts off the production app, and the recap runs the moment
 *   the draft ends.** At that exact moment a projected finish has an audience of
 *   ten. If the live path is down — expired grant, FantasyPros rate limit, a
 *   CloudFront hiccup, or simply a network the venue does not have — the
 *   standings should come up on last-committed numbers with a visible "as of"
 *   date, not come up empty.
 *
 * So the intended order of preference is live first, this second, nothing third.
 * `scripts/fantasypros-pull.mjs` (`npm run pull:projections`) is what refreshes
 * the floor, and it goes through the live client rather than authenticating
 * itself — one OAuth implementation in this repo, and it is not this one.
 *
 * ============================================================================
 * MISSING IS A NORMAL STATE AND NEVER AN ERROR
 * ============================================================================
 *
 * `readProjections` returns a state, never throws, and has no fallback of its
 * own. There is deliberately no "derive something from ADP" path. A ranked
 * 1-to-10 finish built from a substitute looks exactly like a real one, and the
 * recap hands out ridicule on the strength of it — so a blank section, which is
 * recoverable with one command, beats a fabricated order, which nobody knows to
 * doubt.
 *
 * An unreadable file is reported as `unreadable` rather than folded into
 * `missing`, because those need different responses from a human: one is "run
 * the pull", the other is "the puller wrote garbage". Neither is worth throwing
 * for on draft night.
 *
 * Read with `fs` rather than imported, for the reasons `@/lib/smartdraft` gives:
 * the snapshot never lands in a client bundle, and a re-pull takes effect on the
 * next request without a rebuild.
 */

export type ProjectionsState =
  | { state: "ok"; index: ProjectionIndex; file: string }
  | { state: "missing"; file: string }
  | { state: "unreadable"; file: string; reason: string };

function snapshotFile(season: number): string {
  return `data/fantasypros-projections-${season}.json`;
}

let cache: { season: number; result: ProjectionsState } | null = null;

/** The committed snapshot, scored on this league's rules. Never throws. */
export function readProjections(season: number = CURRENT_SEASON): ProjectionsState {
  if (cache && cache.season === season) return cache.result;

  const file = snapshotFile(season);
  let result: ProjectionsState;

  try {
    const text = readFileSync(path.join(process.cwd(), file), "utf8");
    const parsed: unknown = JSON.parse(text);
    result = isProjectionSnapshot(parsed)
      ? { state: "ok", index: indexProjections(parsed), file }
      : {
          state: "unreadable",
          file,
          reason: "not a projections snapshot — re-run `npm run pull:projections`",
        };
  } catch (cause) {
    const code = (cause as { code?: string })?.code;
    result =
      code === "ENOENT"
        ? { state: "missing", file }
        : { state: "unreadable", file, reason: String((cause as Error)?.message ?? cause) };
  }

  cache = { season, result };
  return result;
}

/**
 * Just the index, or null. For callers that only need "have we got numbers",
 * which is most of them — `buildProjectedStandings` takes exactly this.
 */
export function readProjectionIndex(season: number = CURRENT_SEASON): ProjectionIndex | null {
  const result = readProjections(season);
  return result.state === "ok" ? result.index : null;
}

/** Serializable points lookup for pure server/client lineup rendering. */
export function readLineupProjectionPoints(
  season: number = CURRENT_SEASON,
): LineupProjectionPoints {
  const index = readProjectionIndex(season);
  return index
    ? Object.fromEntries([...index.byPlayerId].map(([id, projection]) => [id, projection.points]))
    : {};
}

/** Where the snapshot lives, for a UI naming the file a human has to refresh. */
export function projectionSnapshotFile(season: number = CURRENT_SEASON): string {
  return snapshotFile(season);
}

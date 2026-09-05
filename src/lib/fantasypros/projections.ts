import "server-only";

import { cached, type CacheOutcome } from "@/lib/fantasypros/cache";
import { withFantasyPros } from "@/lib/fantasypros/client";
import { cachedTool } from "@/lib/fantasypros/feed";

/**
 * Full-season projections from FantasyPros, typed.
 *
 * THE DOOR THE PROJECTED-STANDINGS WORK NEEDS. Before this, the only way in
 * was `withFantasyPros` plus `listTools`, discovering the projections tool by
 * name-matching — which is a reasonable thing to do while the tool inventory is
 * unknown and a bad thing to keep doing once it is known. The tool is
 * `get_projections`, it is verified live on the league's account, and this
 * module is the typed accessor for it. `scripts/fantasypros-pull.mjs` keeps its
 * `--list` and `--tool=NAME` escapes: they exist so a rename shows up as "here
 * is what the server actually offers" rather than an empty file, and that is
 * still the right behaviour for a snapshot script.
 *
 * WHY THIS MATTERS MORE THAN THE OTHER FEEDS. This league pays SIX points for a
 * passing touchdown. No FantasyPros scoring option prices that, so every ADP
 * and every ranking the app reads is systematically cheap on quarterbacks and
 * cannot be corrected. Projections are the exception: each row carries the raw
 * stat line — `pass_tds`, `rush_yds`, `rec_rec` — so league-correct points can
 * be COMPUTED here rather than taken from someone else's scoring. Use the raw
 * stats. `points_ppr` is FantasyPros' four-point-passing-touchdown answer and
 * is the wrong number for this league.
 *
 * THE DEFAULT LIMIT IS 25. The tool's schema defaults `limit` to 25 rows, so a
 * call that does not pass one silently returns the top quarter of a position
 * and looks like a complete answer. Everything here passes a limit past the
 * largest position.
 */

/** What FantasyPros projects, in the positions this league drafts. */
export const PROJECTION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;
export type ProjectionPosition = (typeof PROJECTION_POSITIONS)[number];

/**
 * A projected stat line.
 *
 * The three `points_*` fields are FantasyPros' own scoring and are present for
 * every position. The rest vary by position — a DST row has `def_sack` and no
 * `pass_att` — so they are optional, and the index signature carries whatever
 * else the server adds without this type needing a release.
 */
export type ProjectionStats = {
  points: number;
  points_ppr: number;
  points_half: number;
  pass_att?: number;
  pass_cmp?: number;
  pass_yds?: number;
  /** The six-point touchdown this league scores. Multiply it yourself. */
  pass_tds?: number;
  pass_ints?: number;
  rush_att?: number;
  rush_yds?: number;
  rush_tds?: number;
  /** Receptions. Note the doubled prefix — it is `rec_rec`, not `rec`. */
  rec_rec?: number;
  rec_yds?: number;
  rec_tds?: number;
  fumbles?: number;
  ret_tds?: number;
  "2pt_tds"?: number;
  [stat: string]: number | undefined;
};

export type ProjectedPlayer = {
  /** FantasyPros player id — the same id `get_ecr` returns and headshots use. */
  fpId: number | null;
  name: string;
  team: string | null;
  position: string;
  stats: ProjectionStats;
};

export type ProjectionSet = {
  season: number | null;
  /** `draft` for full-season. */
  type: string;
  position: string;
  players: ProjectedPlayer[];
  /** When FantasyPros was really called. */
  fetchedAt: string;
  /** `fresh` | `cache` | `stale`. Stale is last-known-good, never silent. */
  source: CacheOutcome<unknown>["source"];
  /** Set when `source` is `stale`. */
  staleReason?: string;
};

/** Projections move on a scale of days, not minutes. */
const PROJECTION_TTL_MS = 6 * 60 * 60_000;

/** Past the largest position (WR, ~200) with room to spare. */
const ROW_LIMIT = 500;

/** Six positions in one session. */
const ALL_TIMEOUT_MS = 30_000;

type RawRow = {
  name?: string;
  team?: string;
  position?: string;
  fpid?: number;
  stats?: Record<string, unknown>;
};

type RawDoc = {
  season?: string | number;
  type?: string;
  position?: string;
  count?: string | number;
  projections?: RawRow[];
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toStats(raw: Record<string, unknown> | undefined): ProjectionStats {
  const stats: ProjectionStats = { points: 0, points_ppr: 0, points_half: 0 };
  for (const [key, value] of Object.entries(raw ?? {})) {
    const n = toNumber(value);
    if (n !== null) stats[key] = n;
  }
  return stats;
}

function toPlayers(doc: RawDoc): ProjectedPlayer[] {
  return (doc.projections ?? [])
    .filter((row): row is RawRow & { name: string } => typeof row.name === "string")
    .map((row) => ({
      fpId: toNumber(row.fpid),
      name: row.name,
      team: row.team ?? null,
      position: (row.position ?? doc.position ?? "").toUpperCase(),
      stats: toStats(row.stats),
    }));
}

function toSet(doc: RawDoc, outcome: CacheOutcome<unknown>, position: string): ProjectionSet {
  return {
    season: toNumber(doc.season),
    type: doc.type ?? "draft",
    position: doc.position ?? position,
    players: toPlayers(doc),
    fetchedAt: outcome.fetchedAt,
    source: outcome.source,
    staleReason: outcome.staleReason,
  };
}

/**
 * Season projections for one position.
 *
 * Returns null when FantasyPros could not be reached AND nothing has ever been
 * cached — the caller's cue to use its own numbers. Never throws, and never
 * blocks longer than the client's timeout.
 *
 *   const qb = await getSeasonProjections("QB");
 *   if (!qb) return localProjections();
 *   for (const p of qb.players) score(p.stats.pass_tds ?? 0);
 */
export async function getSeasonProjections(
  position: ProjectionPosition,
  options: { season?: number; force?: boolean; ttlMs?: number; limit?: number } = {},
): Promise<ProjectionSet | null> {
  const outcome = await cachedTool<RawDoc>(
    `nfl:projections:${position.toLowerCase()}${options.season ? `:${options.season}` : ""}`,
    "get_projections",
    {
      // Lowercase for this tool. `get_ecr` wants uppercase; the server
      // validates them differently and rejects the other case.
      sport: "nfl",
      projection_type: "draft",
      position,
      limit: options.limit ?? ROW_LIMIT,
      ...(options.season ? { season: options.season } : {}),
    },
    { ttlMs: options.ttlMs ?? PROJECTION_TTL_MS, force: options.force },
  );

  return outcome ? toSet(outcome.value, outcome, position) : null;
}

export type AllProjections = {
  /** Every position's players in one list. */
  players: ProjectedPlayer[];
  byPosition: Record<string, ProjectedPlayer[]>;
  season: number | null;
  fetchedAt: string;
  source: CacheOutcome<unknown>["source"];
  staleReason?: string;
  /** Positions FantasyPros refused or returned nothing for. Empty is the norm. */
  missing: string[];
};

/**
 * Every position in ONE session and ONE cache entry.
 *
 * Six separate `getSeasonProjections` calls would be six MCP sessions and six
 * cache rows; a whole-league projection wants all of it or none of it, so it is
 * fetched and cached as one thing. A position that fails is reported in
 * `missing` rather than failing the set — five positions of real projections
 * beats an exception.
 */
export async function getAllSeasonProjections(
  options: { season?: number; force?: boolean; ttlMs?: number } = {},
): Promise<AllProjections | null> {
  const key = `nfl:projections:all${options.season ? `:${options.season}` : ""}`;

  const outcome = await cached<{ docs: Record<string, RawDoc>; missing: string[] }>(
    key,
    options.ttlMs ?? PROJECTION_TTL_MS,
    () =>
      withFantasyPros(
        async (client) => {
          const docs: Record<string, RawDoc> = {};
          const missing: string[] = [];
          for (const position of PROJECTION_POSITIONS) {
            try {
              docs[position] = await client.callTool<RawDoc>("get_projections", {
                sport: "nfl",
                projection_type: "draft",
                position,
                limit: ROW_LIMIT,
                ...(options.season ? { season: options.season } : {}),
              });
            } catch {
              missing.push(position);
            }
          }
          if (Object.keys(docs).length === 0) {
            throw new Error("FantasyPros returned projections for no position at all.");
          }
          return { docs, missing };
        },
        { timeoutMs: ALL_TIMEOUT_MS },
      ),
    { force: options.force },
  );

  if (!outcome) return null;

  const byPosition: Record<string, ProjectedPlayer[]> = {};
  const players: ProjectedPlayer[] = [];
  let season: number | null = null;

  for (const [position, doc] of Object.entries(outcome.value.docs)) {
    const parsed = toPlayers(doc);
    byPosition[position] = parsed;
    players.push(...parsed);
    season ??= toNumber(doc.season);
  }

  return {
    players,
    byPosition,
    season,
    fetchedAt: outcome.fetchedAt,
    source: outcome.source,
    staleReason: outcome.staleReason,
    missing: outcome.value.missing,
  };
}

import "server-only";

import { withFantasyPros, type FantasyProsClient } from "@/lib/fantasypros/client";
import { SCORING_FORMAT } from "@/lib/league-config";

/**
 * The draft-relevant slice of FantasyPros: who is being drafted, where, and
 * which FantasyPros player each one is.
 *
 * TWO TOOLS, BECAUSE NEITHER ALONE IS ENOUGH.
 *
 *   `get_adp` carries the market price — average pick, overall rank, position
 *   rank and bye week — but no player id, only a name.
 *   `get_ecr` carries the expert consensus AND `player_id`, which is the
 *   FantasyPros id everything else keys on, including the headshot CDN.
 *
 * So they are fetched together and joined on name, and the join failures are
 * counted rather than swallowed. See `docs/FANTASYPROS-MCP.md`.
 *
 * SCORING BASIS. Both calls are made at `PPR`, which is this league's format
 * (`SCORING_FORMAT`). It is not the default for either tool — `get_adp`
 * defaults to `STD` and `get_ecr` to `HALF` — and a half-PPR pull would look
 * identical here while quietly undervaluing every high-volume receiver, which
 * is the same trap `scripts/smartdraft-players.mjs` documents. The basis is
 * recorded in the snapshot so a mis-scoped pull is visible in the file rather
 * than only in the numbers.
 *
 * THE ONE THING NO FEED PRICES IN, and it is not fixable here: this league pays
 * six points for a passing touchdown rather than four. FantasyPros has no
 * scoring option for that, so quarterbacks are systematically cheap on this
 * ADP exactly as they were on the previous one. Unchanged, not newly wrong.
 */

/** FantasyPros' scoring keys. `PPR` is the one this league drafts on. */
const FP_SCORING = SCORING_FORMAT === "PPR" ? "PPR" : "HALF";

/** Redraft ADP. The other variants — dynasty, rookie, best_ball — are not this league. */
const ADP_TYPE = "standard";

/** Comfortably past the ~690 ADP rows and ~520 ECR rows the server returns. */
const ROW_LIMIT = 1000;

export type FantasyProsPlayer = {
  /** FantasyPros player id. Null when only ADP knew about him. */
  fpId: number | null;
  name: string;
  position: string;
  team: string | null;
  /** Average pick across real drafts, at PPR. */
  adp: number | null;
  /** Overall ADP rank. */
  rank: number | null;
  /** "WR1", "RB12". */
  posRank: string | null;
  byeWeek: number | null;
  /** Expert consensus rank, at PPR. Null when ECR did not list him. */
  ecrRank: number | null;
  /**
   * FantasyPros' own headshot, or null when they do not have one for him.
   *
   * NOT resolved at request time — see `scripts/fantasypros-players.mjs`. The
   * CDN answers a missing headshot with a 302 to a generic silhouette rather
   * than a 404, so "has an image" cannot be detected in the browser at all;
   * it is settled once, ahead of the draft, and a null here means the UI draws
   * its own fallback instead of a stranger's grey outline.
   */
  headshotUrl: string | null;
};

export type FantasyProsFeed = {
  fetchedAt: string;
  season: number | null;
  scoring: string;
  adpType: string;
  /** Names ADP listed that ECR did not, so they carry no FantasyPros id. */
  unmatchedAgainstEcr: string[];
  players: FantasyProsPlayer[];
};

/** FantasyPros' headshot CDN, keyed on the id `get_ecr` returns. */
export function headshotUrlFor(fpId: number, size: 250 | 90 | 70 = 250): string {
  return `https://images.fantasypros.com/images/players/nfl/${fpId}/headshot/${size}x${size}.png`;
}

type AdpRow = {
  player_name?: string;
  position?: string;
  team?: string;
  adp?: number;
  rank?: number;
  pos_rank?: string;
  bye_week?: string | number;
};

type EcrRow = {
  player_id?: number;
  player_name?: string;
  position?: string;
  team?: string;
  pos_rank?: string;
  rank_ecr?: number;
};

/**
 * The join key between the two tools, and later between FantasyPros and this
 * app's own pool. Case-folded, accent-stripped, punctuation-stripped, suffix
 * dropped — the sources disagree about "Brian Thomas Jr." vs "Brian Thomas Jr",
 * and about "Aaron Jones Sr.". Same treatment `@/lib/league-json` applies for
 * the same reason.
 */
export function joinKey(name: string, position?: string | null): string {
  const normalized = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return position ? `${normalized}|${position.toUpperCase()}` : normalized;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Pulls ADP and ECR and merges them.
 *
 * Both calls go out at once: they are independent, each takes about a second,
 * and the whole thing sits behind one timeout.
 */
export async function fetchPlayerFeed(client: FantasyProsClient): Promise<FantasyProsFeed> {
  const [adpDoc, ecrDoc, context] = await Promise.all([
    client.callTool<{ players?: AdpRow[]; year?: number; scoring?: string }>("get_adp", {
      sport: "nfl",
      adp_type: ADP_TYPE,
      scoring: FP_SCORING,
      limit: ROW_LIMIT,
    }),
    client.callTool<{ rankings?: EcrRow[] }>("get_ecr", {
      sport: "NFL",
      ranking_type: "DRAFT",
      scoring: FP_SCORING,
      limit: ROW_LIMIT,
    }),
    client.readResource<{ season?: number }>("ff://nfl/context").catch(() => ({ season: null })),
  ]);

  // ECR first: it is the side that carries the id.
  const byKey = new Map<string, EcrRow>();
  const byName = new Map<string, EcrRow>();
  for (const row of ecrDoc.rankings ?? []) {
    if (!row.player_name) continue;
    byKey.set(joinKey(row.player_name, row.position), row);
    // Position-free fallback: FantasyPros itself disagrees with itself about a
    // handful of positions between the two feeds (a WR listed at TE in one).
    // Matching on the name alone recovers the id without inventing a player.
    byName.set(joinKey(row.player_name), row);
  }

  const players: FantasyProsPlayer[] = [];
  const unmatchedAgainstEcr: string[] = [];
  const usedEcr = new Set<EcrRow>();

  for (const row of adpDoc.players ?? []) {
    if (!row.player_name || !row.position) continue;
    const ecr = byKey.get(joinKey(row.player_name, row.position)) ?? byName.get(joinKey(row.player_name));
    if (ecr) usedEcr.add(ecr);
    else unmatchedAgainstEcr.push(`${row.player_name} (${row.position})`);

    const fpId = ecr?.player_id ?? null;
    players.push({
      fpId,
      name: row.player_name,
      position: row.position.toUpperCase(),
      team: row.team ?? null,
      adp: toNumber(row.adp),
      rank: toNumber(row.rank),
      posRank: row.pos_rank ?? null,
      byeWeek: toNumber(row.bye_week),
      ecrRank: ecr?.rank_ecr ?? null,
      // Left null here and filled in by the pull script, which is the only
      // place a headshot is ever probed. Never on a request path.
      headshotUrl: null,
    });
  }

  // Anyone ECR ranks that ADP never listed. Rare, but they are draftable
  // players and dropping them would shrink the pool without saying so.
  for (const ecr of ecrDoc.rankings ?? []) {
    if (usedEcr.has(ecr) || !ecr.player_name || !ecr.position) continue;
    players.push({
      fpId: ecr.player_id ?? null,
      name: ecr.player_name,
      position: ecr.position.toUpperCase(),
      team: ecr.team ?? null,
      adp: null,
      rank: null,
      posRank: ecr.pos_rank ?? null,
      byeWeek: null,
      ecrRank: ecr.rank_ecr ?? null,
      headshotUrl: null,
    });
  }

  return {
    fetchedAt: new Date().toISOString(),
    season: toNumber(context?.season) ?? toNumber(adpDoc.year),
    scoring: FP_SCORING,
    adpType: ADP_TYPE,
    unmatchedAgainstEcr,
    players,
  };
}

/** Convenience for callers that do not already hold a client. */
export async function pullPlayerFeed(options: { timeoutMs?: number } = {}): Promise<FantasyProsFeed> {
  return withFantasyPros((client) => fetchPlayerFeed(client), options);
}

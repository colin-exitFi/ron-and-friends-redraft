import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { joinKey, type FantasyProsPlayer } from "@/lib/fantasypros/players";

/**
 * The committed FantasyPros snapshot, and the join from it onto this league's
 * own player pool.
 *
 * READ SYNCHRONOUSLY AND FROM DISK, deliberately. Every draft surface — the
 * board, the search, the expectation that drives every reach and steal number
 * — reads the pool through a synchronous call, and making that path async so it
 * could await an API is precisely the change that turns "FantasyPros is slow"
 * into "the board hangs while ten people watch". The live path is a layer above
 * this (`@/lib/fantasypros/feed`) and can only ever improve on what is here.
 *
 * THE JOIN NEVER REMOVES ANYBODY. It overlays ADP, the FantasyPros id and the
 * headshot onto players this league already has, and a player FantasyPros does
 * not list simply keeps the Smart Draft numbers he already had. There is no
 * arrangement of a bad or empty snapshot that can shrink the draft pool, which
 * is the one failure that would actually ruin the night.
 */

const SNAPSHOT_FILE = "fantasypros-players.json";

export type FantasyProsSnapshot = {
  fetchedAt: string;
  season: number | null;
  scoring: string;
  adpType: string;
  total: number;
  withHeadshot: number;
  players: FantasyProsPlayer[];
};

export type FantasyProsOverlayEntry = {
  fpId: number | null;
  adp: number | null;
  rank: number | null;
  ecrRank: number | null;
  headshotUrl: string | null;
};

export type FantasyProsOverlay = {
  fetchedAt: string;
  season: number | null;
  scoring: string;
  adpType: string;
  /** Keyed by `joinKey(name, position)` and by `joinKey(name)` as a fallback. */
  byKey: Map<string, FantasyProsOverlayEntry>;
  byName: Map<string, FantasyProsOverlayEntry>;
  total: number;
  withHeadshot: number;
};

function snapshotPath(): string {
  return path.join(process.cwd(), "data", SNAPSHOT_FILE);
}

/**
 * Builds the lookup, or returns null when there is no snapshot.
 *
 * Null is a supported state, not an error: a checkout that has never run
 * `npm run pull:fantasypros` draws exactly the board it drew before this
 * feature existed.
 */
function buildOverlay(): FantasyProsOverlay | null {
  let snapshot: FantasyProsSnapshot;
  try {
    snapshot = JSON.parse(readFileSync(snapshotPath(), "utf8")) as FantasyProsSnapshot;
  } catch {
    return null;
  }
  if (!Array.isArray(snapshot.players)) return null;

  const byKey = new Map<string, FantasyProsOverlayEntry>();
  const byName = new Map<string, FantasyProsOverlayEntry>();
  for (const p of snapshot.players) {
    if (!p?.name || !p.position) continue;
    const entry: FantasyProsOverlayEntry = {
      fpId: p.fpId ?? null,
      adp: p.adp ?? null,
      rank: p.rank ?? null,
      ecrRank: p.ecrRank ?? null,
      headshotUrl: p.headshotUrl ?? null,
    };
    byKey.set(joinKey(p.name, p.position), entry);
    // First writer wins on the position-free key, and the feed is in ADP order,
    // so a duplicated surname resolves to the more-drafted player.
    if (!byName.has(joinKey(p.name))) byName.set(joinKey(p.name), entry);
  }

  return {
    fetchedAt: snapshot.fetchedAt,
    season: snapshot.season ?? null,
    scoring: snapshot.scoring,
    adpType: snapshot.adpType,
    byKey,
    byName,
    total: snapshot.players.length,
    withHeadshot: snapshot.withHeadshot ?? 0,
  };
}

let cache: FantasyProsOverlay | null | undefined;

export function fantasyProsOverlay(): FantasyProsOverlay | null {
  if (cache === undefined) cache = buildOverlay();
  return cache;
}

/** Drops the parsed snapshot so a re-pull takes effect without a restart. */
export function forgetOverlay(): void {
  cache = undefined;
}

/** Looks a player up the way the pool join does — position first, then name. */
export function overlayFor(
  overlay: FantasyProsOverlay,
  name: string,
  position: string,
): FantasyProsOverlayEntry | null {
  return overlay.byKey.get(joinKey(name, position)) ?? overlay.byName.get(joinKey(name)) ?? null;
}

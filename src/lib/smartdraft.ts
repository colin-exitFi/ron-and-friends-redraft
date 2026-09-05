import "server-only";

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  CURRENT_SEASON,
  DRAFT,
  LEAGUE,
  TOTAL_PICKS,
  franchiseByShortName,
} from "@/lib/league-config";
import { applyKeeperOverlay } from "@/lib/keeper-overlay";
import { fantasyProsOverlay, overlayFor } from "@/lib/fantasypros/snapshot";
import {
  isDraftablePosition,
  type BoardPlayer,
  type BoardSlot,
  type BoardTeam,
  type BoardTeamSummary,
  type BoardView,
  type PoolPlayer,
} from "@/lib/board-types";

/**
 * The league's data, read out of the Smart Draft snapshots in `data/`.
 *
 * This is the ONLY module that knows the Smart Draft JSON shape. Everything
 * upstream consumes `@/lib/board-types`, so pointing the league at Supabase is
 * a matter of writing a second implementation of `getBoard` / `getPlayerPool`
 * and leaving the UI alone.
 *
 * The files are read with `fs` rather than imported so the 1,233-player pool
 * (840 KB) never lands in a bundle, and so a re-pull of the snapshot takes
 * effect on the next request without a rebuild in dev.
 */

const ROOM_FILE = "smartdraft-room-snapshot.json";
const PLAYERS_FILE = "smartdraft-players.json";

// --- Raw snapshot shapes ----------------------------------------------------

type RawTeam = {
  id: string;
  name: string;
  ownerName: string | null;
  orderKey: number;
  deletedAt: string | null;
};

type RawPlayer = {
  id: number;
  name: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
};

type RawSlot = {
  slotKey: string;
  originalOwnerTeamId: string;
  currentOwnerTeamId: string;
  pickType: string | null;
  player: RawPlayer | null;
  displayRound: number;
  pickInRound: number;
  overallPick: number;
  isCurrent: boolean;
};

type RawRoom = {
  state: {
    name: string;
    status: string;
    draftRoundCount: number;
    teams: RawTeam[];
    slots: RawSlot[];
  };
};

type RawPoolPlayer = RawPlayer & {
  adp: number | null;
  sortAdp: number | null;
};

type RawPool = {
  fetchedAt: string;
  total: number;
  /**
   * Scope the ADP was pulled at. Smart Draft defaults to half-PPR and this league
   * is full PPR, so a pool without "PPR" here is mis-scoped and undervalues
   * receivers. Absent in snapshots taken before the puller recorded it.
   */
  scoringFormat?: string;
  players: RawPoolPlayer[];
};

function snapshotPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}

function readSnapshot<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(snapshotPath(file), "utf8")) as T;
  } catch (cause) {
    throw new Error(
      `Could not read the Smart Draft snapshot at data/${file}. ` +
        `Re-pull it with the scripts in scripts/smartdraft-*.mjs.`,
      { cause },
    );
  }
}

/** The room snapshot carries no timestamp of its own, so the file's is it. */
function snapshotMtime(file: string): string | null {
  try {
    return statSync(snapshotPath(file)).mtime.toISOString();
  } catch {
    return null;
  }
}

// --- Board ------------------------------------------------------------------

function toBoardPlayer(raw: RawPlayer): BoardPlayer {
  return {
    id: String(raw.id),
    name: raw.name,
    position: raw.position,
    nflTeam: raw.nflTeam,
    byeWeek: raw.byeWeek,
  };
}

function buildBoard(): BoardView {
  const { state } = readSnapshot<RawRoom>(ROOM_FILE);

  // `orderKey` is Smart Draft's ordering field (10, 20, 30…), not a slot number.
  const ordered = state.teams
    .filter((t) => !t.deletedAt)
    .sort((a, b) => a.orderKey - b.orderKey);

  if (ordered.length !== LEAGUE.teams) {
    throw new Error(
      `The Smart Draft room has ${ordered.length} active teams but the league is configured for ${LEAGUE.teams}.`,
    );
  }

  // The room's team name is a short handle ("Greg", "Witte") and every team's
  // `ownerName` is null, so franchise and manager names come from the ESPN-backed
  // roster in league-config, joined on that handle.
  const teams: BoardTeam[] = ordered.map((t, i) => {
    const franchise = franchiseByShortName(t.name);
    return {
      id: t.id,
      slot: i + 1,
      name: t.name,
      franchiseName: franchise?.franchiseName ?? t.name,
      abbrev: franchise?.abbrev ?? t.name.slice(0, 4).toUpperCase(),
      manager: franchise?.manager ?? t.ownerName ?? t.name,
    };
  });
  const byId = new Map(teams.map((t) => [t.id, t]));

  const slots: BoardSlot[] = state.slots
    .map((raw) => {
      const originalOwner = byId.get(raw.originalOwnerTeamId);
      const currentOwner = byId.get(raw.currentOwnerTeamId);
      if (!originalOwner || !currentOwner) {
        throw new Error(
          `Slot ${raw.displayRound}.${raw.pickInRound} references a team that is not in the room.`,
        );
      }
      return {
        id: raw.slotKey,
        round: raw.displayRound,
        pickInRound: raw.pickInRound,
        overallPick: raw.overallPick,
        label: `${raw.displayRound}.${String(raw.pickInRound).padStart(2, "0")}`,
        // A franchise owns one column for the whole draft, so the column is the
        // slot of whoever the pick STARTED with, not of whoever holds it now.
        column: originalOwner.slot,
        originalOwner,
        currentOwner,
        traded: originalOwner.id !== currentOwner.id,
        isKeeper: raw.pickType === "KEEPER",
        player: raw.player ? toBoardPlayer(raw.player) : null,
        onTheClock: raw.isCurrent,
      };
    })
    .sort((a, b) => a.overallPick - b.overallPick);

  assertGridIsRenderable(slots);

  // The Smart Draft room is an INPUT FEED, not the authority. Declarations the
  // commissioner has taken but not yet keyed into Smart Draft, and any ruling
  // that overrides the room, are applied here — so the board shows all of this
  // league's keepers whether or not the other product has caught up. File-backed
  // and database-free, so it holds with the network down.
  //
  // Deliberately the only place this happens: `getBoard` is the single funnel
  // every draft surface reads through, so the room view, the roster panel, the
  // export and the player pool all pick it up without knowing about it.
  const keeperDivergence = applyKeeperOverlay(slots);
  backfillByeWeeks(slots);

  const summaries: BoardTeamSummary[] = teams.map((team) => {
    const held = slots.filter((s) => s.currentOwner.id === team.id);
    return {
      ...team,
      picks: held.length,
      keepers: held.filter((s) => s.isKeeper).length,
      acquired: held.filter((s) => s.originalOwner.id !== team.id).length,
      tradedAway: slots.filter(
        (s) => s.originalOwner.id === team.id && s.currentOwner.id !== team.id,
      ).length,
    };
  });

  return {
    season: CURRENT_SEASON,
    rounds: state.draftRoundCount || DRAFT.rounds,
    teamCount: teams.length,
    totalPicks: slots.length,
    teams: summaries,
    slots,
    keeperCount: slots.filter((s) => s.isKeeper).length,
    tradedCount: slots.filter((s) => s.traded).length,
    fetchedAt: snapshotMtime(ROOM_FILE),
    keeperDivergence,
  };
}

/**
 * Fill in bye weeks the keeper overlay could not supply.
 *
 * The board cells print the bye, and a keeper placed by the reconciled layer is
 * built from a declaration rather than from a snapshot row — so Zach's
 * Jefferson and McConkey would be the only two cells on the board with a blank
 * where every other cell has a number. The player snapshot has the bye for
 * every id, so it is read here instead of being threaded through the keeper
 * types, which the database path shares.
 *
 * Costs a parse of the pool file only when something is actually missing, and
 * `getBoard` caches, so at most once per process.
 */
function backfillByeWeeks(slots: BoardSlot[]) {
  const gaps = slots.filter((s) => s.player && s.player.byeWeek == null);
  if (gaps.length === 0) return;

  const byes = new Map<string, number | null>();
  for (const p of readSnapshot<RawPool>(PLAYERS_FILE).players) {
    byes.set(String(p.id), p.byeWeek);
  }
  for (const slot of gaps) {
    const bye = byes.get(slot.player!.id);
    if (bye != null) slot.player = { ...slot.player!, byeWeek: bye };
  }
}

/**
 * The grid puts one cell per (round, column). Two picks landing in the same
 * cell would silently hide one, so a snapshot that breaks the snake invariant
 * has to fail loudly rather than render a board the room would draft off.
 */
function assertGridIsRenderable(slots: BoardSlot[]) {
  const seen = new Set<string>();
  for (const s of slots) {
    const cell = `${s.round}:${s.column}`;
    if (seen.has(cell)) {
      throw new Error(
        `Two picks claim round ${s.round}, column ${s.column} in the Smart Draft snapshot. ` +
          `The draft order no longer matches snake order and the board cannot be drawn.`,
      );
    }
    seen.add(cell);
  }
  if (slots.length !== TOTAL_PICKS) {
    throw new Error(
      `The snapshot has ${slots.length} pick slots; ${LEAGUE.teams} teams × ${DRAFT.rounds} rounds is ${TOTAL_PICKS}.`,
    );
  }
}

// --- Player pool ------------------------------------------------------------

function buildPool(): {
  players: PoolPlayer[];
  fetchedAt: string;
  scoringFormat: string | null;
  fantasyPros: PoolProvenance["fantasyPros"];
} {
  const raw = readSnapshot<RawPool>(PLAYERS_FILE);
  const board = getBoard();

  const keptBy = new Map<string, string>();
  for (const slot of board.slots) {
    if (slot.isKeeper && slot.player) {
      keptBy.set(slot.player.id, slot.currentOwner.name);
    }
  }

  // No kicker in this league. Players with a null nflTeam are kept: they are
  // free agents, and several of them (Tyreek Hill, Austin Ekeler) are drafted.
  const drafted = raw.players.filter((p) => isDraftablePosition(p.position));

  /*
   * FantasyPros, where it has a number for him.
   *
   * PURELY ADDITIVE. This overlays a fresher ADP, a FantasyPros id and a
   * headshot onto players the pool already contains; it can neither add a
   * player nor remove one, so no arrangement of a stale, empty or missing
   * snapshot can change who is draftable. `data/fantasypros-players.json` is
   * committed, so this is available inside the deployment with no network call
   * on any request path.
   *
   * Mixing the two ADPs is sound because they are not two measurements: Smart
   * Draft's default consensus already carries FantasyPros' PPR feed (see the
   * `FANTASYPROS:PPR` key in its own snapshot), and the two agree to the
   * decimal at the top of the board. What this buys is freshness, and it stops
   * at the point FantasyPros stops ranking players — roughly ADP 270, a hundred
   * picks past the end of a 160-pick draft.
   */
  const overlay = fantasyProsOverlay();
  const overlaid = drafted.map((p) => {
    const hit = overlay ? overlayFor(overlay, p.name, p.position) : null;
    return {
      raw: p,
      adp: hit?.adp ?? p.adp,
      sortAdp: hit?.adp ?? p.sortAdp,
      adpSource: (hit?.adp != null ? "fantasypros" : "smartdraft") as PoolPlayer["adpSource"],
      fpId: hit?.fpId ?? null,
      headshotUrl: hit?.headshotUrl ?? null,
    };
  });

  const ranked = overlaid
    .filter((p) => p.sortAdp != null)
    .sort((a, b) => a.sortAdp! - b.sortAdp!);
  const positionRank = new Map<number, number>();
  const seenPerPosition = new Map<string, number>();
  for (const p of ranked) {
    const next = (seenPerPosition.get(p.raw.position) ?? 0) + 1;
    seenPerPosition.set(p.raw.position, next);
    positionRank.set(p.raw.id, next);
  }

  const players: PoolPlayer[] = overlaid
    .map((p) => ({
      ...toBoardPlayer(p.raw),
      adp: p.adp,
      positionRank: positionRank.get(p.raw.id) ?? null,
      keptBy: keptBy.get(String(p.raw.id)) ?? null,
      adpSource: p.adpSource,
      fpId: p.fpId,
      headshotUrl: p.headshotUrl,
    }))
    // ADP order is the draft-day order; everyone unranked falls in behind it.
    .sort((a, b) => {
      const ra = a.adp ?? Number.POSITIVE_INFINITY;
      const rb = b.adp ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });

  const fromFantasyPros = players.filter((p) => p.adpSource === "fantasypros").length;

  return {
    players,
    fetchedAt: raw.fetchedAt,
    scoringFormat: raw.scoringFormat ?? null,
    fantasyPros: overlay
      ? {
          fetchedAt: overlay.fetchedAt,
          scoring: overlay.scoring,
          adpType: overlay.adpType,
          season: overlay.season,
          playersWithLiveAdp: fromFantasyPros,
          playersWithHeadshot: players.filter((p) => p.headshotUrl != null).length,
        }
      : null,
  };
}

// --- Cached accessors -------------------------------------------------------

/**
 * Where the pool's numbers came from, so a surface can say so rather than
 * implying everything is equally fresh.
 */
export type PoolProvenance = {
  /** When the Smart Draft pool was pulled. */
  fetchedAt: string;
  /** The scope the Smart Draft ADP was pulled at. */
  scoringFormat: string | null;
  /** Null when no FantasyPros snapshot has been pulled in this checkout. */
  fantasyPros: {
    fetchedAt: string;
    scoring: string;
    adpType: string;
    season: number | null;
    playersWithLiveAdp: number;
    playersWithHeadshot: number;
  } | null;
};

let boardCache: BoardView | null = null;
let poolCache: {
  players: PoolPlayer[];
  fetchedAt: string;
  scoringFormat: string | null;
  fantasyPros: PoolProvenance["fantasyPros"];
} | null = null;

export function getBoard(): BoardView {
  boardCache ??= buildBoard();
  return boardCache;
}

export function getPlayerPool(): PoolPlayer[] {
  poolCache ??= buildPool();
  return poolCache.players;
}

/** ISO timestamp of the player snapshot, for "as of" copy in the UI. */
export function getPoolFetchedAt(): string {
  poolCache ??= buildPool();
  return poolCache.fetchedAt;
}

/**
 * Scope the ADP in the pool was pulled at, so the UI can show it and a
 * half-PPR pull cannot pass for a full-PPR one unnoticed. Null for older
 * snapshots that did not record it.
 */
export function getPoolScoringFormat(): string | null {
  poolCache ??= buildPool();
  return poolCache.scoringFormat;
}

/**
 * Everything a surface needs to state where its numbers came from — including
 * whether the live FantasyPros ADP is in play and how much of the pool it
 * covers. Read by `/players`; see `@/components/data-source-note`.
 */
export function getPoolProvenance(): PoolProvenance {
  poolCache ??= buildPool();
  return {
    fetchedAt: poolCache.fetchedAt,
    scoringFormat: poolCache.scoringFormat,
    fantasyPros: poolCache.fantasyPros,
  };
}

/** Drops the memoised pool so a re-pull takes effect on the next request. */
export function forgetPool(): void {
  poolCache = null;
}

export function getTeams(): BoardTeamSummary[] {
  return getBoard().teams;
}

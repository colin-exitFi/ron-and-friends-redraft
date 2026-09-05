import "server-only";

import { CURRENT_SEASON } from "@/lib/league-config";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { draftStore, draftStateLocation, draftStoreIsShared } from "@/lib/draft-store";
import {
  DraftRuleError,
  applyPick,
  boardFingerprint,
  buildRoomView,
  removePick,
  undoLast,
} from "@/lib/draft-engine";
import type { ClientPlayer, DraftRoomView } from "@/lib/draft-types";
import type { ApplyPickOptions } from "@/lib/draft-engine";

/**
 * The one server-side entry point for the draft room. The page and every API
 * route go through here, so there is exactly one place where the board, the
 * player pool and the saved picks are combined.
 *
 * Every mutation goes through `draftStore.mutate`, which reads the board,
 * applies the change and saves the result under ONE turn of the store's queue.
 * Two picks arriving at once therefore queue rather than race, and the second
 * one sees the first — which matters because "already drafted" is checked
 * against the state that was just written, not the one the browser had.
 *
 * This used to be a `read` and a `write` here, with the claim above resting on
 * the store serialising. It does — but per call, not per mutation, so
 * `readA readB writeA writeB` was reachable and B saved a board computed before
 * A's pick existed. On the database store the conditional write caught it and
 * refused B. On the file store, which is the laptop the draft is actually run
 * from, `base` is ignored and A's pick vanished after A's caller had already
 * been told it saved. The lock now spans the read and the write, which is what
 * the paragraph above always said and did not do.
 *
 * Each write still names the state it was derived from. Within one process the
 * queue guarantees the base is current; across two instances of a deployment it
 * is the only thing that does, and the database store refuses a write whose
 * base has moved rather than overwriting the pick that moved it.
 */

function fingerprint(): string {
  return boardFingerprint(getBoard());
}

/**
 * The fingerprint of the board as it stands, for anything that stores a
 * document alongside the board it was derived from and later has to say whether
 * that board has moved. The recap does exactly this — see `recapStaleness`.
 */
export function currentBoardFingerprint(): string {
  return fingerprint();
}

export async function readRoom(season: number = CURRENT_SEASON): Promise<DraftRoomView> {
  const board = getBoard();
  const state = await draftStore.read(season, fingerprint());
  return buildRoomView(board, state);
}

/** The pool, trimmed to what the browser's autocomplete needs. */
export function readPool(): ClientPlayer[] {
  return getPlayerPool().map((p) => ({
    id: p.id,
    name: p.name,
    position: p.position,
    nflTeam: p.nflTeam,
    byeWeek: p.byeWeek,
    adp: p.adp,
    headshotUrl: p.headshotUrl,
  }));
}

export async function makePick(
  slotId: string,
  playerId: string,
  options: ApplyPickOptions = {},
  season: number = CURRENT_SEASON,
): Promise<DraftRoomView> {
  const board = getBoard();
  // The client sends an id and nothing else; name, position and bye are read
  // from the pool here so a stale browser tab cannot write a wrong player row.
  const player = getPlayerPool().find((p) => p.id === playerId);
  if (!player) throw new DraftRuleError(`No player ${playerId} in the pool.`);

  const next = await draftStore.mutate(season, fingerprint(), (state) =>
    applyPick(
      board,
      state,
      {
        slotId,
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        nflTeam: player.nflTeam,
        byeWeek: player.byeWeek,
      },
      options,
    ),
  );
  return buildRoomView(board, next);
}

export async function undoLastPick(season: number = CURRENT_SEASON): Promise<DraftRoomView> {
  const board = getBoard();
  const next = await draftStore.mutate(season, fingerprint(), undoLast);
  return buildRoomView(board, next);
}

export async function clearSlot(
  slotId: string,
  season: number = CURRENT_SEASON,
): Promise<DraftRoomView> {
  const board = getBoard();
  const next = await draftStore.mutate(season, fingerprint(), (state) =>
    removePick(state, slotId),
  );
  return buildRoomView(board, next);
}

export async function resetDraft(season: number = CURRENT_SEASON): Promise<DraftRoomView> {
  const board = getBoard();
  const fresh = await draftStore.clear(season, fingerprint());
  return buildRoomView(board, fresh);
}

/** Where saved picks land — a file path or the database — shown in the UI. */
export function saveLocation(season: number = CURRENT_SEASON): string {
  return draftStateLocation(season);
}

/**
 * Whether other devices can see the picks this board saves, which is what
 * decides if the board subscribes for remote picks. See `draftStoreIsShared`.
 */
export function savesAreShared(): boolean {
  return draftStoreIsShared();
}

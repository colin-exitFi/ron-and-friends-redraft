import "server-only";

import { getKeeperBoardFromJson } from "@/lib/league-json";
import type { BoardSlot, KeeperDivergence } from "@/lib/board-types";

/**
 * The reconciled keeper layer, applied to the board the Smart Draft room feeds.
 *
 * THE ARCHITECTURE, per the commissioner's ruling: Smart Draft remains the
 * league's operational system for now, and this app is on a path to replace it.
 * So the room is an INPUT FEED and this app's reconciled data is the AUTHORITY.
 * The room supplies the base board; declarations recorded here and commissioner
 * rulings overlay on top and win.
 *
 * Concretely: Zach declared Justin Jefferson and Ladd McConkey to the
 * commissioner and they were never keyed into Smart Draft, so the room shows
 * 7.01 and 6.05 as open picks. The board is the one screen ten people stare at
 * on draft night; it must not be the least correct view in the app, and it must
 * not depend on anyone remembering to key something into another product.
 *
 * FILE-BACKED ON PURPOSE. This reads `data/` through `@/lib/league-json` and
 * never touches Postgres, so the board is correct with the database unreachable
 * and the venue's wifi down. That is the Saturday guarantee, and a reconciled
 * layer only reachable through the database would be the wrong layer.
 */

/** A keeper the reconciled layer knows about, ready to place on the board. */
type OverlayKeeper = {
  playerId: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  /** Smart Draft team id of the franchise keeping him. */
  teamId: string;
  teamShortName: string;
  costRound: number;
};

/**
 * Place the reconciled keepers the room does not have onto the board, and
 * report what diverged.
 *
 * Mutates `slots` in place, which is why it is called once inside the board
 * builder rather than by consumers. Returns the divergence summary so the UI
 * can show the commissioner what still needs keying into Smart Draft — that
 * reconciliation is work he is currently doing by hand.
 */
export function applyKeeperOverlay(slots: BoardSlot[]): KeeperDivergence {
  const board = getKeeperBoardFromJson();

  const onBoard = new Set(
    slots.filter((s) => s.isKeeper && s.player).map((s) => s.player!.id),
  );

  const missing: OverlayKeeper[] = [];
  for (const k of board.keepers) {
    if (onBoard.has(k.playerId)) continue;
    // An unmatched declaration has no pool id and so no player to place. It is
    // reported as unplaceable rather than dropped.
    if (k.playerId.startsWith("unmatched:")) {
      continue;
    }
    missing.push({
      playerId: k.playerId,
      playerName: k.playerName,
      position: k.position,
      nflTeam: k.nflTeam,
      teamId: k.teamId,
      teamShortName: k.teamShortName,
      costRound: k.costRound,
    });
  }

  const unplaceable = board.keepers
    .filter((k) => k.playerId.startsWith("unmatched:"))
    .map((k) => ({
      playerName: k.playerName,
      teamShortName: k.teamShortName,
      costRound: k.costRound,
      reason: "No matching player in the Smart Draft pool — check the spelling.",
    }));

  const placed: KeeperDivergence["placed"] = [];

  // Cheapest round first, so a franchise's later-round keeper settles before an
  // earlier-round one competes for the same cell. Matches the bump direction in
  // `resolveSameRoundConflicts`.
  for (const k of [...missing].sort((a, b) => b.costRound - a.costRound)) {
    const candidates = slots.filter(
      (s) =>
        s.round === k.costRound &&
        s.currentOwner.id === k.teamId &&
        !s.player,
    );

    if (!candidates.length) {
      unplaceable.push({
        playerName: k.playerName,
        teamShortName: k.teamShortName,
        costRound: k.costRound,
        reason:
          `${k.teamShortName} holds no free round-${k.costRound} pick, own or acquired. ` +
          `Needs a ruling on the cost round.`,
      });
      continue;
    }

    // Prefer the franchise's OWN pick so a keeper does not consume an acquired
    // one while its own sits empty in the same round.
    const target =
      candidates.find((s) => s.originalOwner.id === k.teamId) ?? candidates[0];

    target.isKeeper = true;
    target.player = {
      id: k.playerId,
      name: k.playerName,
      position: k.position,
      nflTeam: k.nflTeam,
      byeWeek: null,
    };

    placed.push({
      playerName: k.playerName,
      teamShortName: k.teamShortName,
      costRound: k.costRound,
      label: target.label,
      onOwnPick: target.originalOwner.id === k.teamId,
    });
  }

  return {
    placed,
    unplaceable,
    /** Keepers the room already carries — nothing to key in for these. */
    inRoomCount: onBoard.size,
  };
}

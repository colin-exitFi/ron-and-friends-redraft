/**
 * A franchise's roster laid out the way a lineup card is: every starting slot
 * named, with whoever fills it, and the bench underneath.
 *
 * `@/lib/draft-roster` already answers "how many holes are left", which is the
 * question the draft board asks. This answers the different question the roster
 * screen asks — "which player is in which slot" — and it has to name the slots
 * individually (RB1, RB2, FLEX1) rather than count them, because the whole
 * point of the screen is telling a real team from a pile of running backs.
 *
 * Pure, no I/O, no `server-only`: the same function serves the real board on
 * the server and a mock draft in the browser. That symmetry is deliberate — a
 * mock's finished roster has to be judged by exactly the same layout as the
 * real one or it tells you nothing.
 *
 * Every count comes from `@/lib/league-config`. Nothing about 9 starters, 7
 * bench or a 16-man cap is written down here.
 */

import { ROSTER, STARTING_LINEUP } from "@/lib/league-config";
import type { BoardTeamSummary } from "@/lib/board-types";
import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";

/**
 * Which positions each lineup slot accepts.
 *
 * FLEX is the only slot that takes more than its own name, and it takes the
 * same three `@/lib/draft-roster` gives it. Kept as a map rather than derived
 * from the config's prose `note` field, because parsing "RB / WR / TE" out of a
 * human-readable string is a silent breakage waiting for somebody to reword it.
 */
const SLOT_ELIGIBILITY: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  DST: ["DST"],
};

function eligibleFor(slot: string): string[] {
  return SLOT_ELIGIBILITY[slot] ?? [slot];
}

/** One rostered player, flattened out of the board slot that holds him. */
export type LineupPlayer = {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
  /** Where he came from. Keepers are pre-placed by the snapshot, not entered. */
  source: "keeper" | "pick";
  /** The board cell — "6.05". For a keeper this is also what he cost. */
  label: string;
  round: number;
  overallPick: number;
  /**
   * The franchise the pick originally belonged to, when it was acquired in a
   * trade. Null for a franchise's own pick. Worth showing: a third of this
   * league's board changed hands and "where did that come from" is a real
   * question about a roster.
   */
  acquiredFrom: string | null;
};

export type LineupSlot = {
  /** "QB", "RB", "FLEX"… as the config names it. */
  slot: string;
  /** "RB2" — the slot's name with its index, or just "QB" where there is one. */
  label: string;
  eligible: string[];
  player: LineupPlayer | null;
};

export type FranchiseLineup = {
  team: BoardTeamSummary;
  /** All nine, in config order, filled or not. */
  starters: LineupSlot[];
  bench: LineupPlayer[];
  /**
   * Rostered players beyond the active cap. Should always be empty; rendered
   * when it is not, because silently hiding the 17th man would make an illegal
   * roster look legal.
   */
  overflow: LineupPlayer[];
  byPosition: Record<string, number>;
  keeperCount: number;
  rosterSize: number;
  rosterCap: number;
  benchSize: number;
  /** Board slots this franchise still holds with nobody in them. */
  picksRemaining: number;
  /** Starting slots with nobody in them, by label — "RB2", "FLEX1". */
  openStarterLabels: string[];
  /** Positions already at the league's roster limit. */
  positionsAtCap: string[];
};

/** Projected season points keyed by Smart Draft player id. */
export type LineupProjectionPoints = Readonly<Record<string, number | null | undefined>>;

function toLineupPlayer(slot: LiveSlot): LineupPlayer {
  return {
    playerId: slot.player!.id,
    name: slot.player!.name,
    position: slot.player!.position,
    nflTeam: slot.player!.nflTeam,
    byeWeek: slot.player!.byeWeek,
    source: slot.fill === "keeper" ? "keeper" : "pick",
    label: slot.label,
    round: slot.round,
    overallPick: slot.overallPick,
    acquiredFrom: slot.traded ? slot.originalOwner.name : null,
  };
}

/** The nine starting slots, expanded from the config's counts and named. */
export function lineupSlots(): LineupSlot[] {
  const slots: LineupSlot[] = [];
  for (const { slot, count } of STARTING_LINEUP) {
    for (let i = 1; i <= count; i++) {
      slots.push({
        slot,
        // "QB" rather than "QB1" where the league starts exactly one: nobody
        // calls it QB1 and the index is noise on a card with nine rows.
        label: count === 1 ? slot : `${slot}${i}`,
        eligible: eligibleFor(slot),
        player: null,
      });
    }
  }
  return slots;
}

/**
 * Fills the lineup card for one franchise.
 *
 * Players are placed in projected-points order when projections are supplied.
 * Missing projections rank behind projected players and retain board order
 * among themselves. With no projection lookup, the whole roster therefore
 * keeps the previous board-order behaviour.
 *
 * Dedicated slots are tried before FLEX. Greedy is safe for the same reason it
 * is safe in `@/lib/draft-roster`: FLEX accepts a superset of the RB, WR and TE
 * slots, so taking a narrow slot first can never strand somebody who had
 * nowhere else to go.
 */
function fillLineup(players: LineupPlayer[]): {
  starters: LineupSlot[];
  bench: LineupPlayer[];
  overflow: LineupPlayer[];
} {
  const starters = lineupSlots();
  const leftovers: LineupPlayer[] = [];

  for (const player of players) {
    const dedicated = starters.find(
      (s) => s.player === null && s.eligible.length === 1 && s.eligible[0] === player.position,
    );
    const flex =
      dedicated ??
      starters.find((s) => s.player === null && s.eligible.includes(player.position));
    if (flex) {
      flex.player = player;
    } else {
      leftovers.push(player);
    }
  }

  return {
    starters,
    bench: leftovers.slice(0, ROSTER.bench),
    overflow: leftovers.slice(ROSTER.bench),
  };
}

/**
 * One lineup card per franchise, in draft-slot order.
 *
 * Reads the same `DraftRoomView` the board renders from, so it works identically
 * on a board holding only keepers and no picks, a board mid-draft, and a
 * finished mock.
 */
export function buildFranchiseLineups(
  view: DraftRoomView,
  projectedPoints: LineupProjectionPoints = {},
): FranchiseLineup[] {
  return view.teams.map((team) => {
    const held = view.slots.filter((s) => s.currentOwner.id === team.id);
    const players = held
      .filter((s) => s.player)
      .sort((a, b) => {
        const aPoints = projectedPoints[a.player!.id];
        const bPoints = projectedPoints[b.player!.id];
        if (aPoints != null && bPoints != null && aPoints !== bPoints) {
          return bPoints - aPoints;
        }
        if (aPoints != null && bPoints == null) return -1;
        if (aPoints == null && bPoints != null) return 1;
        return a.overallPick - b.overallPick;
      })
      .map(toLineupPlayer);

    const byPosition: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
    for (const p of players) byPosition[p.position] = (byPosition[p.position] ?? 0) + 1;

    const { starters, bench, overflow } = fillLineup(players);

    return {
      team,
      starters,
      bench,
      overflow,
      byPosition,
      keeperCount: players.filter((p) => p.source === "keeper").length,
      rosterSize: players.length,
      rosterCap: ROSTER.activeCap,
      benchSize: ROSTER.bench,
      picksRemaining: held.filter((s) => s.fill === null).length,
      openStarterLabels: starters.filter((s) => s.player === null).map((s) => s.label),
      positionsAtCap: Object.entries(byPosition)
        .filter(([pos, n]) => n >= (ROSTER.positionalMax[pos] ?? Infinity))
        .map(([pos]) => pos),
    };
  });
}

/** Total starting slots the league fields. Derived; used for "6 / 9 starters". */
export const STARTER_COUNT: number = STARTING_LINEUP.reduce((n, s) => n + s.count, 0);

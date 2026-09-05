/**
 * "What do I still need?" — the question the commissioner will field all day.
 *
 * Pure: takes the room view, returns per-franchise roster state. Keepers count
 * against the roster exactly like picks do, because they are picks.
 *
 * The lineup is 1 QB / 2 RB / 2 WR / 1 TE / 2 FLEX / 1 DST = 9 starters, plus 7
 * bench, for 16 — which is also the round count, so a franchise that holds all
 * its picks fills the roster exactly.
 */

import { ROSTER, STARTING_LINEUP } from "@/lib/league-config";
import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";
import type { BoardTeamSummary } from "@/lib/board-types";

/** Positions the two FLEX slots accept. */
const FLEX_POSITIONS = ["RB", "WR", "TE"] as const;

export type StarterSlotState = {
  /** "QB", "RB", "WR", "TE", "FLEX", "DST". */
  slot: string;
  required: number;
  filled: number;
  missing: number;
};

export type TeamRoster = {
  team: BoardTeamSummary;
  /** Everyone rostered, keepers first then by pick order. */
  players: LiveSlot[];
  keepers: number;
  /** Head count by position. */
  byPosition: Record<string, number>;
  starters: StarterSlotState[];
  /** Starting slots still empty, in lineup order — the actual answer to "what do I need". */
  needs: string[];
  benchFilled: number;
  benchSize: number;
  rosterSize: number;
  rosterCap: number;
  /** Slots this franchise still holds, keeper slots excluded. */
  picksRemaining: number;
  /**
   * Positions already at the league cap (QB 4, RB 8, WR 9, TE 3, DST 3), so the
   * board can refuse to recommend a player it cannot legally roster.
   */
  positionsAtCap: string[];
};

function emptyCounts(): Record<string, number> {
  return { QB: 0, RB: 0, WR: 0, TE: 0, DST: 0 };
}

/**
 * Greedy allocation: dedicated slots first, then whatever is left over spills
 * into FLEX. Greedy is correct here because FLEX accepts a superset of the RB,
 * WR and TE slots, so filling the narrow slots first can never strand a player.
 */
function allocateStarters(byPosition: Record<string, number>): StarterSlotState[] {
  const spare = { ...byPosition };
  const states: StarterSlotState[] = [];

  for (const { slot, count } of STARTING_LINEUP) {
    if (slot === "FLEX") continue;
    const have = spare[slot] ?? 0;
    const used = Math.min(have, count);
    spare[slot] = have - used;
    states.push({ slot, required: count, filled: used, missing: count - used });
  }

  const flexRequired = STARTING_LINEUP.find((s) => s.slot === "FLEX")?.count ?? 0;
  const flexPool = FLEX_POSITIONS.reduce((sum, p) => sum + (spare[p] ?? 0), 0);
  const flexUsed = Math.min(flexPool, flexRequired);

  // Report in lineup order rather than the order they were computed in.
  const ordered: StarterSlotState[] = [];
  for (const { slot, count } of STARTING_LINEUP) {
    if (slot === "FLEX") {
      ordered.push({
        slot: "FLEX",
        required: count,
        filled: flexUsed,
        missing: count - flexUsed,
      });
    } else {
      ordered.push(states.find((s) => s.slot === slot)!);
    }
  }
  return ordered;
}

export function buildTeamRosters(view: DraftRoomView): TeamRoster[] {
  return view.teams.map((team) => {
    const held = view.slots.filter((s) => s.currentOwner.id === team.id);
    const players = held
      .filter((s) => s.player)
      .sort((a, b) => {
        if (a.fill !== b.fill) return a.fill === "keeper" ? -1 : 1;
        return a.overallPick - b.overallPick;
      });

    const byPosition = emptyCounts();
    for (const s of players) {
      const pos = s.player!.position;
      byPosition[pos] = (byPosition[pos] ?? 0) + 1;
    }

    const starters = allocateStarters(byPosition);
    const startersFilled = starters.reduce((sum, s) => sum + s.filled, 0);
    const needs = starters.flatMap((s) => Array.from({ length: s.missing }, () => s.slot));

    return {
      team,
      players,
      keepers: players.filter((s) => s.fill === "keeper").length,
      byPosition,
      starters,
      needs,
      benchFilled: Math.max(0, players.length - startersFilled),
      benchSize: ROSTER.bench,
      rosterSize: players.length,
      rosterCap: ROSTER.activeCap,
      picksRemaining: held.filter((s) => s.fill === null).length,
      positionsAtCap: Object.entries(byPosition)
        .filter(([pos, n]) => n >= (ROSTER.positionalMax[pos] ?? Infinity))
        .map(([pos]) => pos),
    };
  });
}

/** One-line answer for the team currently on the clock. */
export function describeNeeds(roster: TeamRoster): string {
  if (roster.needs.length === 0) {
    return `Starting lineup complete · ${roster.picksRemaining} picks left for the bench`;
  }
  const counted = new Map<string, number>();
  for (const slot of roster.needs) counted.set(slot, (counted.get(slot) ?? 0) + 1);
  return Array.from(counted, ([slot, n]) => (n > 1 ? `${n}× ${slot}` : slot)).join(", ");
}

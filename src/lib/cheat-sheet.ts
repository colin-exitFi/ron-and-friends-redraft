import "server-only";

import { getPlayerPool } from "@/lib/smartdraft";
import { readProjections } from "@/lib/projections-store";
import { joinKey } from "@/lib/fantasypros/players";
import { SCORING_FORMAT, SCORING_SPEC } from "@/lib/league-config";
import type { CheatSheetMeta, CheatSheetRow } from "@/lib/cheat-sheet-view";

/**
 * The player pool as a cheat sheet: every draftable player, priced in THIS
 * league's points, next to the market's ADP.
 *
 * ============================================================================
 * WHY THIS EXISTS AT ALL
 * ============================================================================
 * Two managers in this league have never drafted off a board in a room, and
 * what they are actually missing is not the board — it is the research surface
 * ESPN and Sleeper put next to it. The specific complaint is the one this
 * module is built around: **they cannot see who is gone.** Everything else here
 * is in service of that.
 *
 * The pieces were nearly all already in the repo and none of them were joined:
 * `@/lib/smartdraft` has the pool and its ADP, `@/lib/projections-store` has a
 * committed stat-line snapshot scored on league rules, and `DraftRoomView`
 * knows which players are on the board. All three key on the SAME Smart Draft
 * player id, so the join is exact — no name matching happens here, and none
 * should. Fuzzy matching was already done once by the puller and written into
 * the snapshot as `playerId`; redoing it on a render path is how the same
 * player ends up with two different projections on two different screens.
 *
 * ============================================================================
 * WHY THE POINTS COLUMN IS NOT ANYBODY ELSE'S POINTS COLUMN
 * ============================================================================
 * This league pays SIX for a passing touchdown and a FULL POINT per tight end
 * reception. No public cheat sheet prices either, so every ranking a manager
 * can find on his phone is systematically cheap on quarterbacks and much too
 * cheap on tight ends. The projection here is computed from raw projected stat
 * lines through `SCORING_SPEC` — the league's own scoring — which is the one
 * number on draft night that ESPN cannot show him.
 *
 * That makes the ADP column and the points column disagree, and the
 * disagreement is the useful part rather than a defect to be reconciled. ADP is
 * what the ROOM will pay; projected points are what the player is WORTH here.
 * A tight end the board calls a reach is frequently not one. Both columns are
 * therefore shown, always, and the UI says which is which.
 *
 * Pure and synchronous. The projections snapshot is read off disk and cached by
 * `projections-store`; the pool is a committed file. Nothing here awaits.
 */

export type CheatSheet = {
  rows: CheatSheetRow[];
  meta: CheatSheetMeta;
};

/**
 * Build the sheet.
 *
 * `liveAdp` is the FantasyPros live consensus keyed by `joinKey(name, pos)` —
 * the key `/players` already used — and wins over the pool's own number where
 * it has one, which is the precedence the page applied before this module
 * existed. Keyed by name rather than by id because it comes from FantasyPros'
 * ranking feed, which does not carry a Smart Draft id to join on.
 *
 * KICKERS ARE DROPPED. This league has no K slot at all, so a kicker cannot be
 * started and cannot be drafted; the pool still carries 51 of them and putting
 * them on a cheat sheet would be actively misleading.
 *
 * UNRANKED AND UNPROJECTED PLAYERS ARE DROPPED. A player nobody has an ADP for
 * and nobody projects is not a draft consideration, he is 600 rows of scrolling
 * between a manager and the players he might actually take.
 */
export function buildCheatSheet(liveAdp?: Map<string, number>): CheatSheet {
  const projections = readProjections();
  const index = projections.state === "ok" ? projections.index : null;

  const rows: CheatSheetRow[] = [];
  for (const p of getPlayerPool()) {
    if (p.position === "K") continue;

    const projection = index?.byPlayerId.get(p.id) ?? null;
    const adp = liveAdp?.get(joinKey(p.name, p.position)) ?? p.adp;
    if (adp == null && projection == null) continue;

    rows.push({
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.nflTeam,
      bye: p.byeWeek,
      adp,
      positionRank: p.positionRank,
      points: projection ? Math.round(projection.points * 10) / 10 : null,
      basis: projection?.basis ?? null,
      pointsPositionRank: null,
    });
  }

  /*
   * The position rank THIS LEAGUE would give him, which is the whole argument
   * for the page. A manager reading "TE4 by ADP, TE2 by our points" has been
   * told something no other cheat sheet can tell him, and it is a far more
   * direct way to say it than asking him to compare two point totals.
   *
   * Computed after the loop because it is a rank over the assembled set, not a
   * property of a row.
   */
  const byPosition = new Map<string, CheatSheetRow[]>();
  for (const row of rows) {
    if (row.points == null) continue;
    const bucket = byPosition.get(row.position);
    if (bucket) bucket.push(row);
    else byPosition.set(row.position, [row]);
  }
  for (const bucket of byPosition.values()) {
    bucket.sort((a, b) => (b.points ?? 0) - (a.points ?? 0));
    bucket.forEach((row, i) => {
      row.pointsPositionRank = i + 1;
    });
  }

  // Default order is ADP, so the sheet reads like a draft board before anybody
  // touches a sort control. Unranked-but-projected players fall to the bottom.
  rows.sort(
    (a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.name.localeCompare(b.name),
  );

  return {
    rows,
    meta: {
      scoringFormat: SCORING_FORMAT,
      projectionsPulledAt: index?.provenance.pulledAt ?? null,
      projectionSeason: index?.provenance.season ?? null,
      projectedCount: rows.filter((r) => r.points != null).length,
      vendorScoredCount: index?.vendorScoredCount ?? 0,
      projectionsProblem:
        projections.state === "missing"
          ? `No projections snapshot at ${projections.file} — run \`npm run pull:projections\`.`
          : projections.state === "unreadable"
            ? `The projections snapshot at ${projections.file} could not be read: ${projections.reason}`
            : null,
      tePremiumReception: SCORING_SPEC.ppr + SCORING_SPEC.recTePremium,
      passTd: SCORING_SPEC.passTd,
    },
  };
}
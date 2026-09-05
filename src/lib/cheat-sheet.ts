import "server-only";

import { getPlayerPool } from "@/lib/smartdraft";
import { readProjections } from "@/lib/projections-store";
import { readCheatSheetExport } from "@/lib/cheatsheet-export";
import { readLastSeason } from "@/lib/last-season-store";
import type { ProjectedStats } from "@/lib/projections";
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
 * Designations that mean HE CANNOT PLAY. Everything else is discarded.
 *
 * ============================================================================
 * WHY `QUESTIONABLE` IS NOT ON THIS LIST
 * ============================================================================
 * A status is worth a badge only if it can stop somebody wasting a pick. Read
 * in early September, both feeds carry `Questionable` on around eighty-five of
 * the six hundred players this league can draft — Ja'Marr Chase at overall rank
 * 3, Puka Nacua at 4, Christian McCaffrey at 7. That is preseason paperwork
 * rather than a game-day report and nearly all of them will play in week one.
 *
 * Showing it would be wrong twice: an amber badge on a fifth of the board is
 * noise, which teaches the room to ignore the badge that also means "this man
 * is on injured reserve" — and it would cast doubt over the first three names a
 * manager reads. `ACTIVE` is dropped for the same reason in reverse.
 *
 * Matched case-insensitively because the two feeds disagree about it: the
 * projections snapshot shouts `OUT` and Sleeper's map writes `Out`.
 */
const BLOCKING_DESIGNATIONS = new Set([
  "OUT",
  "IR",
  "PUP",
  "NFI",
  "SUS",
  "SUSPENDED",
  "DOUBTFUL",
]);

/**
 * The stat line, but only when there is genuinely something to break out.
 *
 * ============================================================================
 * `dstPoints` IS A TOTAL WEARING A COMPONENT'S CLOTHES
 * ============================================================================
 * A team defence's whole projected line is `{ dstPoints: 120.34 }` — the feed's
 * own number, passed straight through, because ESPN and FantasyPros both
 * publish a D/ST total and neither publishes the parts this league scores. The
 * projections index classifies it as league-scored, which is defensible for a
 * total that needs no rescoring, and it counts them in `dstPassthroughCount`
 * for exactly this reason.
 *
 * But it is NOT a component, and letting it through here caused the one bug the
 * breakdown panel must never have: thirty-two rows whose line items summed to
 * zero against a total of 120. `verify:cheat-sheet` caught it. Stripping it
 * sends those rows down the panel's "there is nothing to break out, and here is
 * why" branch, which is the honest presentation — a defence's points here are
 * mostly a per-game points-allowed ladder no feed projects.
 */
function breakableComponents(stats: ProjectedStats | null): ProjectedStats | null {
  if (!stats) return null;
  const keys = Object.keys(stats).filter((k) => k !== "dstPoints");
  return keys.length > 0 ? stats : null;
}

/** A designation worth a badge, or null. Normalised, never throws. */
function blockingStatus(status: string | null | undefined): string | null {
  if (!status) return null;
  const trimmed = status.trim();
  return BLOCKING_DESIGNATIONS.has(trimmed.toUpperCase()) ? trimmed : null;
}

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
  const exported = readCheatSheetExport();
  const board = exported.state === "ok" ? exported.byPlayerId : null;
  /*
   * Last season's actuals, scored in this league's rules. Joined on
   * name-and-position because Sleeper carries no Smart Draft id — the same
   * bridge the live ADP overlay two lines below already crosses, and the
   * matching itself was done once by the puller rather than here.
   */
  const lastSeason = readLastSeason();
  const finished = lastSeason.state === "ok" ? lastSeason.byJoinKey : null;

  const rows: CheatSheetRow[] = [];
  for (const p of getPlayerPool()) {
    if (p.position === "K") continue;

    const projection = index?.byPlayerId.get(p.id) ?? null;
    const ranked = board?.get(p.id) ?? null;
    const key = joinKey(p.name, p.position);
    const adp = liveAdp?.get(key) ?? p.adp;
    if (adp == null && projection == null && ranked?.leagueRank == null) continue;

    /*
     * A miss here is a NORMAL, EXPECTED outcome and never an error: a rookie
     * has no 2025 season, and a team defence deliberately has none because this
     * league's points-allowed ladder is a per-game band that no season total
     * recovers. Both render blank, which is the honest answer.
     */
    const prior = finished?.get(key) ?? null;

    rows.push({
      id: p.id,
      name: p.name,
      position: p.position,
      team: p.nflTeam,
      // The export carries a bye for players the pool snapshot does not.
      bye: p.byeWeek ?? ranked?.bye ?? null,
      leagueRank: ranked?.leagueRank ?? null,
      leaguePositionRank: ranked?.leaguePositionRank ?? null,
      tier: ranked?.tier ?? null,
      adp,
      positionRank: p.positionRank,
      ecrVsAdp: ranked?.ecrVsAdp ?? null,
      points: projection ? Math.round(projection.points * 10) / 10 : null,
      basis: projection?.basis ?? null,
      pointsPositionRank: null,
      /*
       * The components the total was computed from, so the sheet can show the
       * breakdown the commissioner asked for.
       */
      projectedStats: breakableComponents(projection?.stats ?? null),
      projectedStatsPosition: projection?.position ?? null,
      lastSeasonPoints: prior?.points ?? null,
      lastSeasonPerGame: prior?.perGame ?? null,
      lastSeasonGames: prior?.games ?? null,
      lastSeasonLine: prior?.line ?? null,
      /*
       * The projections feed's status wins where it has one — it is pulled for
       * this season and is what the rest of the app reads. Sleeper's is the
       * fallback, and it covers the players the projections snapshot does not.
       *
       * Filtered to the designations that actually cost a pick — see
       * `BLOCKING_DESIGNATIONS`, which is where the reasoning lives.
       */
      injuryStatus:
        blockingStatus(projection?.injuryStatus) ?? blockingStatus(prior?.injuryStatus),
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

  /*
   * Default order is THE LEAGUE-SCOPED BOARD, falling through to ADP for anyone
   * it does not rank. This is the whole reason the export is worth having: the
   * order a manager reads before he touches a control is the one that already
   * prices the tight end premium, rather than the market's, which does not.
   */
  rows.sort(
    (a, b) =>
      (a.leagueRank ?? Infinity) - (b.leagueRank ?? Infinity) ||
      (a.adp ?? Infinity) - (b.adp ?? Infinity) ||
      a.name.localeCompare(b.name),
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
      board:
        exported.state === "ok"
          ? {
              leagueLabel: exported.export.provenance.leagueLabel,
              exportedAt: exported.export.provenance.exportedAt,
              scopedToLeague: exported.export.provenance.rankingScopedToLeague,
              tierScope: exported.export.provenance.tierScope,
              rankedCount: rows.filter((r) => r.leagueRank != null).length,
            }
          : null,
      lastSeason:
        lastSeason.state === "ok"
          ? {
              season: lastSeason.snapshot.provenance.season,
              pulledAt: lastSeason.snapshot.provenance.pulledAt,
              scoredCount: rows.filter((r) => r.lastSeasonPoints != null).length,
            }
          : null,
      lastSeasonProblem:
        lastSeason.state === "missing"
          ? "No last-season snapshot — run `npm run pull:last-season`."
          : lastSeason.state === "unreadable"
            ? `Last season's numbers could not be read: ${lastSeason.reason}`
            : null,
      boardProblem:
        exported.state === "missing"
          ? "No league-scoped FantasyPros export — run `npm run pull:cheatsheet`. Ordering falls back to market ADP, which underprices tight ends and quarterbacks here."
          : exported.state === "unreadable"
            ? `The FantasyPros export could not be read: ${exported.reason}`
            : null,
    },
  };
}
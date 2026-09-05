import "server-only";

/**
 * The one file the recap reads that the draft board does not.
 *
 * `@/lib/recap-dossier` is pure and stays that way — it is exercised by a
 * verification script and could be exercised in a browser — so the disk read
 * for the keeper counterfactual lives here and the rows are handed in as an
 * argument. This module is the whole of the recap's I/O.
 *
 * WHY THE KEEPER SHEET AND NOT THE RESOLVED KEEPER FILE. The question the
 * counterfactual answers is "who COULD you have kept", and only the full
 * post-2025 sheet knows that: `keepers-2026-resolved.json` lists the players
 * who were actually declared, which is precisely the set the counterfactual is
 * measuring the alternatives against.
 *
 * MISSING IS NOT FATAL. An absent or malformed sheet returns an empty list and
 * the dossier simply carries no counterfactual. The recap is worth generating
 * without it, and a page that cannot draw because a supplementary file moved is
 * a worse failure than a recap with one section fewer.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { buildProjectedStandings } from "@/lib/projected-standings";
import { readProjectionIndex } from "@/lib/projections-store";
import { readLeagueSchedule } from "@/lib/league-schedule";
import type { ProjectedStandingsRow } from "@/lib/projected-standings";
import type { DraftRoomView } from "@/lib/draft-types";
import type { ProjectedBasis } from "@/lib/recap-dossier";

/**
 * A franchise that deliberately left a keeper slot empty.
 *
 * The distinction this carries is the whole point of it. `closesList` is set
 * when a manager has given his FINAL answer and is choosing not to fill every
 * slot — as against a short list that simply means he has not replied yet. One
 * of those is a decision worth arguing about and the other is a man who has not
 * texted back, and a recap that confuses them accuses somebody of missing a
 * deadline he did not miss.
 */
export type ClosedKeeperList = {
  /** Short name from `data/managers.json`. */
  manager: string;
  declaredAt: string | null;
};

/** A player a franchise was entitled to keep, and what he would have cost. */
export type KeeperOption = {
  /** Short name from `data/managers.json` — "Elbe", not "Scott Elbe". */
  manager: string;
  player: string;
  position: string;
  /** Sheet-derived 2026 cost round: last season's round minus one. */
  costRound: number;
};

type RawRow = {
  player?: unknown;
  position?: unknown;
  manager?: unknown;
  roundToKeep2026?: unknown;
  eligible2026?: unknown;
};

/**
 * Every player who could legally have been kept in 2026, by manager.
 *
 * TWO FILTERS, AND THE SECOND ONE IS A RULING RATHER THAN A FIELD.
 * `eligible2026` in the sheet predates the commissioner's Aug 26 ruling that a
 * player who occupied a round-1 slot cannot be kept at all, so the sheet still
 * marks Saquon Barkley and Christian McCaffrey as eligible. What it does encode
 * is their price: `roundToKeep2026` comes out as 0, because round 1 minus one
 * round is not a round. So a cost round below 1 is exactly the set of one-year
 * rentals `keeperCostRound` returns null for, and dropping them here keeps this
 * module agreeing with `@/lib/keeper-clock` without importing its machinery.
 *
 * Getting this wrong would put "you could have kept Bijan Robinson" in a blurb
 * about a man who could not have, which is the sort of thing that gets checked.
 */
/**
 * The projected 1-to-10 finish.
 *
 * NULL IS A FIRST-CLASS ANSWER and the path is kept working deliberately. The
 * projections are pulled into the repo rather than fetched at runtime — the
 * FantasyPros source is OAuth-protected and a deployment has no browser to
 * renew a personal grant with — so "nobody has run the pull on this checkout"
 * is an ordinary state of this page, not a failure. When it happens the
 * standings section says so and the blurbs still generate. Nothing about the
 * recap may ever be blocked on a projection existing, and no fabricated order
 * may ever stand in for a real one.
 *
 * The schedule is separately optional. `buildProjectedStandings` omits the
 * simulation block without one rather than inventing fixtures, so wins and
 * playoff odds simply come back null and the table shows points alone.
 */
export function readProjectedStandings(
  view: DraftRoomView,
): { basis: ProjectedBasis; rows: ProjectedStandingsRow[] } | null {
  const standings = buildProjectedStandings({
    view,
    projections: readProjectionIndex(),
    schedule: readLeagueSchedule(),
  });
  if (!standings) return null;

  return {
    basis: {
      rankedOn: standings.basis.rankedOn,
      disclaimer: standings.basis.disclaimer,
      projectionsSource: standings.basis.projectionsSource,
      projectionsPulledAt: standings.basis.projectionsPulledAt,
      complete: standings.basis.complete,
      simulation: standings.simulation
        ? {
            source: standings.simulation.source,
            weeks: standings.simulation.weeks,
            games: standings.simulation.games,
            runs: standings.simulation.runs,
          }
        : null,
    },
    rows: standings.rows,
  };
}

export function readKeeperOptions(): KeeperOption[] {
  let parsed: unknown;
  try {
    const file = path.join(process.cwd(), "data", "keeper-eligibility-2026.json");
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }

  const rows = (parsed as { players?: unknown })?.players;
  if (!Array.isArray(rows)) return [];

  const options: KeeperOption[] = [];
  for (const raw of rows as RawRow[]) {
    const costRound = Number(raw?.roundToKeep2026);
    if (
      raw?.eligible2026 !== true ||
      !Number.isFinite(costRound) ||
      costRound < 1 ||
      typeof raw.player !== "string" ||
      typeof raw.manager !== "string"
    ) {
      continue;
    }
    options.push({
      manager: raw.manager,
      player: raw.player,
      position: typeof raw.position === "string" ? raw.position : "",
      costRound,
    });
  }

  return options;
}

/**
 * Managers who closed their keeper list short of the maximum on purpose.
 *
 * Read from the declarations overflow rather than inferred from a keeper count,
 * because the two look identical on the board and mean opposite things. Joe
 * kept one of a permitted two and said so — that is a judgement the room can
 * argue with. Inferring it instead would eventually accuse somebody of blowing
 * a deadline on the strength of a file not having caught up yet.
 */
export function readClosedKeeperLists(): ClosedKeeperList[] {
  let parsed: unknown;
  try {
    const file = path.join(process.cwd(), "data", "keeper-declarations.json");
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return [];
  }

  const rows = (parsed as { declarations?: unknown })?.declarations;
  if (!Array.isArray(rows)) return [];

  return (rows as Record<string, unknown>[])
    .filter((d) => d?.closesList === true && typeof d.managerShortName === "string")
    .map((d) => ({
      manager: String(d.managerShortName),
      declaredAt: typeof d.declaredAt === "string" ? d.declaredAt : null,
    }));
}

import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { CURRENT_SEASON, FRANCHISES, LEAGUE } from "@/lib/league-config";
import type { LeagueSchedule, ScheduleGame } from "@/lib/projected-standings";

/**
 * The league's regular-season fixtures, when there are any.
 *
 * ============================================================================
 * RON AND FRIENDS HAS NO SCHEDULE YET, AND THIS RETURNS NULL FOR IT
 * ============================================================================
 *
 * Read this before assuming the loader is broken. The only extract on disk,
 * `data/espn/espn-league-2026-raw.json`, belongs to the ESPN league this app
 * was forked from. This league is on Sleeper and has never been on ESPN, and
 * Sleeper does not post matchups until the draft is done — so the correct
 * answer for 2026 is "no schedule", and the simulation block is omitted rather
 * than computed over somebody else's fixtures. The guard that enforces that is
 * in `load`.
 *
 * Everything below describes what the loader does WHEN a real schedule exists,
 * which is what it was built for and what it will do again once Sleeper has
 * fixtures.
 *
 * A real extract carries a `schedule` array for the season: 70 fixtures across
 * 14 matchup periods, five games a week, all ten franchises playing every week.
 * That is a complete round-robin-plus and it is the schedule the league plays.
 *
 * It matters because it is the only thing that lets the projected standings say
 * anything about WINS. Projected points measure roster strength; they cannot see
 * that a franchise draws the three strongest teams in the last three weeks. With
 * the real fixtures in hand, `buildProjectedStandings` can run a Monte Carlo and
 * report projected wins and playoff odds alongside the points.
 *
 * NOTHING HERE INVENTS A FIXTURE. If the extract is missing, unparseable, or
 * does not name all ten franchises, this returns null and the standings simply
 * omit the simulation. A synthesised schedule would produce plausible-looking
 * playoff odds with no relationship to the season, which is precisely the sort
 * of number that gets quoted once and believed forever.
 *
 * ============================================================================
 * THE JOIN
 * ============================================================================
 *
 * ESPN identifies teams by an integer `teamId` that means nothing to the Smart
 * Draft board. The one identifier both products carry is the franchise
 * ABBREVIATION — "TBB", "HOJO" — so the games are emitted in abbreviations and
 * `@/lib/projected-standings` joins them to `view.teams[].abbrev`. Same choice,
 * for the same reason, as joining the room's short name in
 * `@/lib/league-config`: use the field that exists on both sides rather than
 * inventing a crosswalk that has to be maintained.
 *
 * Weeks are filtered to `LEAGUE.regularSeasonWeeks`. ESPN's array would happily
 * include playoff matchups once they exist, and those are simulated from the
 * bracket rather than replayed as fixtures.
 */

type RawScheduleSide = { teamId?: number } | null | undefined;

type RawScheduleGame = {
  matchupPeriodId?: number;
  playoffTierType?: string | null;
  home?: RawScheduleSide;
  away?: RawScheduleSide;
};

type RawEspnLeague = {
  seasonId?: number;
  teams?: { id?: number; abbrev?: string }[];
  schedule?: RawScheduleGame[];
};

function extractPath(season: number): string {
  return path.join(process.cwd(), "data", "espn", `espn-league-${season}-raw.json`);
}

let cache: { season: number; schedule: LeagueSchedule | null } | null = null;

/**
 * The regular-season fixtures, or null when there is no usable schedule.
 *
 * Never throws. A malformed extract is a reason to skip the simulation, not a
 * reason to take down a page the league is drafting off.
 */
export function readLeagueSchedule(season: number = CURRENT_SEASON): LeagueSchedule | null {
  if (cache && cache.season === season) return cache.schedule;

  const schedule = load(season);
  cache = { season, schedule };
  return schedule;
}

function load(season: number): LeagueSchedule | null {
  let raw: RawEspnLeague;
  try {
    raw = JSON.parse(readFileSync(extractPath(season), "utf8")) as RawEspnLeague;
  } catch {
    return null;
  }

  const abbrevById = new Map<number, string>();
  for (const t of raw.teams ?? []) {
    if (typeof t.id === "number" && typeof t.abbrev === "string") {
      abbrevById.set(t.id, t.abbrev);
    }
  }
  if (abbrevById.size !== LEAGUE.teams) return null;

  /*
   * THE FIXTURES MUST BELONG TO THIS LEAGUE, NOT MERELY BE TEN TEAMS LONG.
   *
   * `data/espn/espn-league-2026-raw.json` is the PREVIOUS league's extract.
   * Ron and Friends has never been on ESPN — it is a Sleeper league, and
   * Sleeper posts no matchups before a draft, so there is no schedule for 2026
   * yet and that is the honest answer.
   *
   * The count check above passed anyway, because that league also had ten
   * franchises. So 70 real fixtures loaded between teams that do not exist
   * here, and the mismatch only showed up later as a join that produced
   * nothing. Checking the abbreviations against `FRANCHISES` is what makes the
   * refusal explicit and keeps this loader honest if a Sleeper schedule is
   * wired in later: an extract naming anybody this league does not have is not
   * this league's schedule.
   *
   * Returning null omits the simulation block. `buildProjectedStandings` still
   * reports projected POINTS; it just declines to report projected WINS and
   * playoff odds, which is right, because odds computed over another league's
   * fixtures would look plausible and mean nothing.
   */
  const known = new Set(FRANCHISES.map((f) => f.abbrev.toUpperCase()));
  const foreign = [...abbrevById.values()].filter((a) => !known.has(a.toUpperCase()));
  if (foreign.length > 0) return null;

  const [firstWeek, lastWeek] = LEAGUE.regularSeasonWeeks;

  const games: ScheduleGame[] = [];
  for (const g of raw.schedule ?? []) {
    const week = g.matchupPeriodId;
    if (typeof week !== "number" || week < firstWeek || week > lastWeek) continue;
    if (g.playoffTierType) continue;

    const home = g.home?.teamId;
    const away = g.away?.teamId;
    if (typeof home !== "number" || typeof away !== "number") continue;

    const homeAbbrev = abbrevById.get(home);
    const awayAbbrev = abbrevById.get(away);
    if (!homeAbbrev || !awayAbbrev) continue;

    games.push({ week, homeAbbrev, awayAbbrev });
  }

  if (games.length === 0) return null;

  /*
   * Every franchise must play every week. A partial schedule would hand some
   * teams fewer games than others, and a win total is only comparable across a
   * league where everybody played the same number of times.
   */
  const weeks = [...new Set(games.map((g) => g.week))];
  const expectedPerWeek = LEAGUE.teams / 2;
  if (weeks.some((w) => games.filter((g) => g.week === w).length !== expectedPerWeek)) {
    return null;
  }

  return {
    season: raw.seasonId ?? season,
    source: `ESPN league extract, data/espn/espn-league-${season}-raw.json`,
    games: games.sort(
      (a, b) => a.week - b.week || a.homeAbbrev.localeCompare(b.homeAbbrev),
    ),
  };
}

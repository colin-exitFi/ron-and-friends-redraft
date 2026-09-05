/**
 * Pulls last season's actual production from Sleeper and scores it in THIS
 * league's rules.
 *
 *   npm run pull:last-season
 *
 * ============================================================================
 * WHAT THIS BUYS THE ROOM
 * ============================================================================
 * Every manager can already look up what a player scored last year, and every
 * app shows it at somebody else's scoring. This league pays six for a passing
 * touchdown and a full point per tight end reception, and no public surface
 * prices either — so the number on his phone is systematically wrong about
 * exactly the two positions this league has deliberately moved. Computing it
 * here is the one 2025 total that is right for Ron and Friends.
 *
 * ============================================================================
 * WHY IT IS A SCRIPT AND NOT A REQUEST-TIME FETCH
 * ============================================================================
 * The stats endpoint is 1.9MB and the player map it must be joined against is
 * 14MB. That is not something to put behind a page a remote family member opens
 * on cellular, and the data is FINISHED — 2025 cannot change during tonight's
 * draft. So the fetch, the join and the arithmetic all happen once, here, and
 * the app reads a ~200KB committed file. See `@/lib/last-season-store`.
 *
 * ============================================================================
 * BOTH ENDPOINTS ARE PUBLIC AND UNAUTHENTICATED
 * ============================================================================
 *   https://api.sleeper.app/v1/stats/nfl/regular/2025  — raw season stat lines
 *   https://api.sleeper.app/v1/players/nfl             — the id → player map
 *
 * No key, no token, nothing to leak. Sleeper asks that the player map not be
 * called more than once a day, which is another reason it is a script.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY LEFT OUT
 * ============================================================================
 * TEAM DEFENCES. This league's D/ST scoring is dominated by the points-allowed
 * ladder, which is a per-GAME band. Houston allowed 295 points across 17 games
 * and did NOT score the "35+" band once for it — they collected seventeen
 * separate band payments, and no season total says which. Scoring a defence off
 * `pts_allow: 295` would produce a confident, badly wrong number in front of
 * ten people, so defences carry no 2025 line at all and the column renders
 * blank for them. Weekly stat pulls would fix it and are not worth 45 minutes.
 *
 * KICKERS, for the reason the rest of the app drops them: the league has no K
 * slot, so one cannot be started.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import { joinKey } from "@/lib/fantasypros/players";
import { pointsFromSleeperSeason } from "@/lib/sleeper-season";
import { SCORING_FORMAT } from "@/lib/league-config";

const SEASON = Number(process.argv[2] ?? 2025);
const STATS_URL = `https://api.sleeper.app/v1/stats/nfl/regular/${SEASON}`;
const PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

/** The positions this league can start. `DEF` is excluded on purpose — see above. */
const SCORED_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

/**
 * Designations that mean HE CANNOT PLAY, and nothing else.
 *
 * ============================================================================
 * WHY `Questionable` IS THROWN AWAY, WHICH IS EIGHTY-FIVE OF THE HUNDRED
 * ============================================================================
 * The point of surfacing a status at all is to stop somebody spending a pick on
 * a player who is unavailable. Sleeper's map, read in early September, carries
 * `Questionable` on 85 of the 600 players this league can draft — including
 * Ja'Marr Chase at overall rank 3, Puka Nacua at 4 and Christian McCaffrey at
 * 7. That is preseason paperwork, not a game-day report, and nearly all of
 * those men will play in week one.
 *
 * Rendering it would put an amber badge on a fifth of the board and on several
 * of the first names a manager reads, which is worse than showing nothing twice
 * over: it is noise, so it trains the room to ignore the badge, AND it is
 * actively misleading about the top of the first round. `IR`, `PUP`, `NFI`,
 * `Out` and `Sus` are the ones that actually cost a pick, so they are the ones
 * kept. `NA` is dropped as meaningless.
 */
const BLOCKING_DESIGNATIONS = new Set(["Out", "IR", "PUP", "NFI", "Sus", "COV", "DNR"]);

/** Fails loudly. A half-written snapshot is worse than none. */
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${res.statusText}`);
  return res.json();
}

/**
 * The stat line as a sentence, built from what the player actually did.
 *
 * Pre-formatted here rather than in the component because "what matters for a
 * running back" is a data question, not a rendering one, and doing it once in a
 * script keeps the decision out of a hot render path. Only categories he
 * registered in appear, so a receiving back reads as a receiving back and a
 * pocket quarterback does not carry an empty rushing clause.
 */
function statLine(s) {
  const parts = [];
  const yd = (v) => Math.round(v).toLocaleString();
  if (s.pass_yd) parts.push(`${yd(s.pass_yd)} pass yd, ${s.pass_td ?? 0} TD`);
  if (s.rush_att >= 20 || s.rush_yd >= 200) parts.push(`${yd(s.rush_yd ?? 0)} rush yd, ${s.rush_td ?? 0} TD`);
  if (s.rec) parts.push(`${s.rec} rec, ${yd(s.rec_yd ?? 0)} yd, ${s.rec_td ?? 0} TD`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

console.log(`Pulling ${SEASON} actuals from Sleeper…`);
const [stats, players] = await Promise.all([getJson(STATS_URL), getJson(PLAYERS_URL)]);
console.log(
  `  · ${Object.keys(stats).length.toLocaleString()} stat lines, ` +
    `${Object.keys(players).length.toLocaleString()} players in the map`,
);

const out = {};
let skippedNoMap = 0;
let skippedPosition = 0;
let collisions = 0;

for (const [sleeperId, line] of Object.entries(stats)) {
  const player = players[sleeperId];
  if (!player) {
    skippedNoMap++;
    continue;
  }

  const position = (player.position ?? player.fantasy_positions?.[0] ?? "").toUpperCase();
  if (!SCORED_POSITIONS.has(position)) {
    skippedPosition++;
    continue;
  }

  const name = player.full_name ?? `${player.first_name ?? ""} ${player.last_name ?? ""}`.trim();
  if (!name) {
    skippedNoMap++;
    continue;
  }

  const games = line.gp ?? 0;
  const points = Math.round(pointsFromSleeperSeason(line, position) * 10) / 10;

  /*
   * A player who never took the field is dropped rather than written as a zero.
   * "0.0 points" and "no 2025 season" look identical in a table cell and mean
   * completely different things — the first is a warning about a player who
   * busted, the second is a rookie. A rookie must read as blank.
   */
  if (games <= 0) continue;

  /*
   * SO IS A PLAYER WHO DRESSED AND PRODUCED NOTHING, and that is a judgement
   * rather than an oversight. Sixty-eight players — blocking tight ends,
   * special-teams receivers, third-string backs — were active in a game and
   * recorded no stat this league scores. A literal "0.0" against their name
   * reads as a scoring bug rather than as a fact, and it is indistinguishable
   * on screen from the far more interesting "he was not in the league".
   *
   * A NEGATIVE TOTAL IS KEPT. A quarterback who threw two interceptions and
   * nothing else really did cost his manager points, and that is information.
   * Only an exact zero — meaning no scoring event of any kind — is dropped.
   */
  if (points === 0) continue;

  const key = joinKey(name, position);

  /*
   * Two players sharing a normalised name and position. `joinKey` strips
   * suffixes, so a father-and-son pair at the same position collides. Keep the
   * one who actually produced: the alternative is a starter's season being
   * overwritten by a practice-squad namesake, which would be invisible on
   * screen and wrong in the one direction that matters.
   */
  const existing = out[key];
  if (existing) {
    collisions++;
    if (existing.points >= points) continue;
  }

  out[key] = {
    sleeperId,
    name,
    position,
    team: player.team ?? null,
    points,
    games,
    perGame: games > 0 ? Math.round((points / games) * 10) / 10 : null,
    line: statLine(line),
    /*
     * Today's designation, not last season's — the only forward-looking field
     * in the file. See `BLOCKING_DESIGNATIONS` for why most of them are thrown
     * away rather than shown.
     */
    injuryStatus: BLOCKING_DESIGNATIONS.has((player.injury_status ?? "").trim())
      ? player.injury_status.trim()
      : null,
  };
}

const snapshot = {
  provenance: {
    source: "Sleeper — api.sleeper.app/v1/stats/nfl/regular + /players/nfl (public, unauthenticated)",
    season: SEASON,
    pulledAt: new Date().toISOString(),
    scoring: SCORING_FORMAT,
    note:
      `Actual ${SEASON} production, re-scored under this league's own rules via SCORING_SPEC — ` +
      "six-point passing touchdowns, a full point per tight end reception, and the yardage and " +
      "explosive-play bonuses, which an actual season can apply and a projection cannot. " +
      "Team defences are excluded: this league's points-allowed ladder is a per-game band and no " +
      "season total recovers which bands a unit earned. Kickers are excluded — no K slot exists.",
    playerCount: Object.keys(out).length,
  },
  players: out,
};

const file = path.join(process.cwd(), `data/sleeper-season-${SEASON}.json`);
writeFileSync(file, `${JSON.stringify(snapshot, null, 2)}\n`);

console.log(
  `  · ${Object.keys(out).length.toLocaleString()} scored ` +
    `(${skippedPosition.toLocaleString()} off-position incl. defences, ` +
    `${skippedNoMap.toLocaleString()} not in the map, ${collisions} name collisions)`,
);

// The top of the board, printed so a mis-scoped pull is obvious immediately
// rather than after it has reached the page.
const top = Object.values(out)
  .sort((a, b) => b.points - a.points)
  .slice(0, 8);
console.log(`\n  Top ${SEASON} scorers in ${SCORING_FORMAT}:`);
for (const p of top) {
  console.log(
    `    ${p.points.toFixed(1).padStart(7)}  ${p.perGame?.toFixed(1).padStart(5)}/g  ` +
      `${p.position} ${p.name}`,
  );
}
console.log(`\nWrote ${file}\n`);

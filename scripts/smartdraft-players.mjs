/**
 * Pulls the full Smart Draft player pool (ADP + rankings) into
 * `data/smartdraft-players.json`.
 *
 *   npm run pull:players
 *
 * Smart Draft is the league's agreed ranking source, so this snapshot is what
 * the draft room searches against. Re-run it any time up to draft day.
 *
 * SCOPE MATTERS. Smart Draft defaults to half-PPR, and this league is full PPR,
 * so `scoringFormat=PPR` is not optional — without it the ADP understates every
 * high-volume receiver. The parameter name comes from the site's own query
 * builder in `_next/static/chunks/app/page-*.js`; `GET /api/adp/sources` lists
 * which feeds publish which scopes.
 *
 * Asking for PPR also widens the pool: CBS and MyFantasyLeague publish STD and
 * PPR but no half-PPR, so they only appear in this scope.
 *
 * One thing no feed can price in: this league pays 6 points per passing
 * touchdown rather than the standard 4, which lifts quarterbacks well above
 * where any public ADP puts them. Worth eyeballing the QB tier before printing.
 */
import { writeFileSync } from "node:fs";

const API = "https://api.smartdraft.app/api/players";
const PAGE_SIZE = 200;
/** Full PPR — matches ESPN's reception value of 1.0. */
const SCORING_FORMAT = "PPR";

const players = [];
let page = 1;
let total = Infinity;

while (players.length < total) {
  const url = `${API}?page=${page}&pageSize=${PAGE_SIZE}&scoringFormat=${SCORING_FORMAT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Smart Draft players ${res.status} on page ${page}`);
  const body = await res.json();
  total = body.total ?? body.players.length;
  players.push(...body.players);
  if (!body.players.length) break;
  page += 1;
}

// Which feed:scope pairs actually came back, so a future scope regression is
// visible in the file itself rather than only in the ADP numbers.
const feeds = [...new Set(players.flatMap((p) => Object.keys(p.values ?? {})))].sort();
const offScope = feeds.filter((f) => !f.endsWith(`:${SCORING_FORMAT}`) && !f.endsWith(":ANY"));

const out = {
  fetchedAt: new Date().toISOString(),
  source: "smartdraft.app",
  scoringFormat: SCORING_FORMAT,
  feeds,
  total: players.length,
  players,
};

writeFileSync(
  new URL("../data/smartdraft-players.json", import.meta.url),
  JSON.stringify(out, null, 2),
);

console.log(`Wrote ${players.length} players (reported total ${total}) at ${SCORING_FORMAT}.`);
console.log(`Feeds: ${feeds.join(", ")}`);
if (offScope.length) {
  console.warn(
    `WARNING: these feeds came back outside ${SCORING_FORMAT} scope: ${offScope.join(", ")}`,
  );
}

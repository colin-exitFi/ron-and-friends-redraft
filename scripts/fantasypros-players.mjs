/**
 * Pulls the live FantasyPros draft board into `data/fantasypros-players.json`.
 *
 *   npm run pull:fantasypros
 *
 * THIS FILE IS THE FLOOR. It is committed, so it ships inside the deployment
 * and cannot be unavailable: if FantasyPros is down, rate-limits us, or the
 * grant expires at 8pm on draft night, every surface still has real ADP,
 * real FantasyPros ids and real headshot URLs, and the draft carries on. The
 * live path in `@/lib/fantasypros/feed` sits ABOVE this and can only ever
 * improve on it.
 *
 * It also does the one thing that must not happen at request time: settling
 * which players FantasyPros actually has a headshot for. Their CDN answers a
 * missing headshot with a 302 to a generic silhouette rather than a 404, so
 * "is there a picture of this man" is not a question the browser can answer —
 * an <img> would simply show a stranger's grey outline and no error would ever
 * fire. It is answered once, here, ahead of the draft.
 *
 * Re-run any time up to draft day. Takes about a minute, almost all of it the
 * headshot probe.
 */
import { writeFileSync } from "node:fs";

import { pullPlayerFeed, headshotUrlFor } from "@/lib/fantasypros/players";

/** Polite to their CDN and still finishes the probe in well under a minute. */
const PROBE_CONCURRENCY = 8;
const PROBE_TIMEOUT_MS = 6_000;

console.log("Pulling ADP and expert consensus from the FantasyPros MCP server…");
const feed = await pullPlayerFeed({ timeoutMs: 30_000 });

console.log(`  ${feed.players.length} players at ${feed.scoring}, ${feed.adpType} ADP, season ${feed.season}`);
const withId = feed.players.filter((p) => p.fpId != null);
console.log(`  ${withId.length} carry a FantasyPros id; ${feed.players.length - withId.length} do not`);
if (feed.unmatchedAgainstEcr.length) {
  console.log(
    `  ${feed.unmatchedAgainstEcr.length} ADP rows had no expert-consensus row to take an id from:`,
  );
  console.log(`    ${feed.unmatchedAgainstEcr.slice(0, 25).join(", ")}`);
  if (feed.unmatchedAgainstEcr.length > 25) {
    console.log(`    …and ${feed.unmatchedAgainstEcr.length - 25} more`);
  }
}

/**
 * A 200 means a real headshot. A 302 is the CDN redirecting to
 * `/missing/headshot/…`, which is FantasyPros' silhouette, and is recorded as
 * "no image" so the board draws its own initials instead.
 */
async function hasHeadshot(url) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.status === 200;
  } catch {
    // A probe that could not complete is treated as "no image": a headshot the
    // board is unsure about is not worth a hole in the banner on the night.
    return false;
  }
}

console.log(`\nChecking which of the ${withId.length} have a real headshot…`);
let checked = 0;
let found = 0;
const queue = [...withId];

await Promise.all(
  Array.from({ length: PROBE_CONCURRENCY }, async () => {
    for (;;) {
      const player = queue.pop();
      if (!player) return;
      const url = headshotUrlFor(player.fpId);
      if (await hasHeadshot(url)) {
        player.headshotUrl = url;
        found++;
      }
      checked++;
      if (checked % 100 === 0) process.stdout.write(`  ${checked}/${withId.length}\r`);
    }
  }),
);

console.log(`  ${found} of ${withId.length} have a headshot.            `);

const out = {
  fetchedAt: feed.fetchedAt,
  source: "api.fantasypros.com/mcp",
  tools: ["get_adp", "get_ecr"],
  season: feed.season,
  scoring: feed.scoring,
  adpType: feed.adpType,
  total: feed.players.length,
  withFpId: withId.length,
  withHeadshot: found,
  unmatchedAgainstEcr: feed.unmatchedAgainstEcr,
  players: feed.players,
};

writeFileSync(
  new URL("../data/fantasypros-players.json", import.meta.url),
  `${JSON.stringify(out, null, 2)}\n`,
);

console.log(`\nWrote data/fantasypros-players.json.`);
console.log(
  `Commit it — it is what the board falls back to when FantasyPros cannot be reached.`,
);

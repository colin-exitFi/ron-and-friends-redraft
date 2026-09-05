#!/usr/bin/env node
/**
 * Pull the Ron and Friends league out of Sleeper and write clean snapshots into
 * `data/sleeper/`.
 *
 * WHY THIS EXISTS, AND WHAT IT DELIBERATELY DOES NOT DO
 * ============================================================================
 * The Sleeper API is READ-ONLY. There is no endpoint that records a pick, so
 * Sleeper cannot be the backend for a draft board — it can only tell us what
 * the league IS. That split is the whole architecture:
 *
 *   Sleeper   the league's settings, its ten managers, the draft order, and
 *             the scoring. Authoritative, and re-pullable at any time.
 *   This app  the picks. Authoritative, and the only thing that writes.
 *
 * So this script never writes to Sleeper and nothing downstream expects it to.
 * It is the same shape as the FantasyPros and Smart Draft pullers next to it:
 * fetch, normalise, write to disk, and let the app read the disk.
 *
 * No token and no auth. Sleeper's read API is public, which is why the draft
 * board can be re-pointed at a different league with one id and no secrets.
 *
 * Usage:
 *   npm run pull:sleeper
 *   npm run pull:sleeper -- 1394372619427381248
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { SLEEPER_LEAGUE_ID } from "../src/lib/sleeper-league-id.mjs";

const API = "https://api.sleeper.app/v1";
const OUT = path.join(process.cwd(), "data", "sleeper");

const leagueId = process.argv[2] ?? process.env.SLEEPER_LEAGUE_ID ?? SLEEPER_LEAGUE_ID;

if (!/^\d+$/.test(leagueId)) {
  console.error(
    `"${leagueId}" is not a Sleeper league id. It is the long number in the ` +
      `league URL: sleeper.com/leagues/<id>.`,
  );
  process.exit(1);
}

async function get(pathname) {
  const res = await fetch(`${API}${pathname}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status} ${res.statusText}`);
  const body = await res.json();
  if (body === null) {
    throw new Error(
      `GET ${pathname} returned null. Sleeper answers null rather than 404 for ` +
        `an id it does not know, so check the league id.`,
    );
  }
  return body;
}

/** Written with a trailing newline and stable spacing so diffs stay readable. */
function write(file, value) {
  const target = path.join(OUT, file);
  writeFileSync(target, `${JSON.stringify(value, null, 1)}\n`);
  return target;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pulledAt = new Date().toISOString();

  console.log(`Pulling Sleeper league ${leagueId}\n`);

  const league = await get(`/league/${leagueId}`);
  const users = await get(`/league/${leagueId}/users`);
  const rosters = await get(`/league/${leagueId}/rosters`);

  // A league always has a draft; `league.draft_id` is the current one. Pulled
  // separately because the draft carries the ROUND COUNT and the DRAFT ORDER,
  // and neither is on the league object.
  const draft = league.draft_id ? await get(`/draft/${league.draft_id}`) : null;
  const picks = league.draft_id ? await get(`/draft/${league.draft_id}/picks`) : [];

  write("league.json", { _pulledAt: pulledAt, ...league });
  write("users.json", { _pulledAt: pulledAt, users });
  write("rosters.json", { _pulledAt: pulledAt, rosters });
  if (draft) write("draft.json", { _pulledAt: pulledAt, ...draft });

  /*
   * Picks made IN SLEEPER, which for an offline draft should stay empty all
   * night — the room drafts here, not there. Written anyway so that if anybody
   * does start picking in the Sleeper app, the divergence is visible on disk
   * rather than being a surprise.
   */
  write("draft-picks.json", { _pulledAt: pulledAt, count: picks.length, picks });

  const settings = draft?.settings ?? {};
  const rounds = settings.rounds ?? null;
  const teams = settings.teams ?? league.total_rosters ?? null;

  console.log(`  league          ${league.name} (${league.season}, ${league.status})`);
  console.log(`  teams           ${teams}`);
  console.log(`  rounds          ${rounds}`);
  console.log(`  board           ${rounds && teams ? rounds * teams : "?"} slots`);
  console.log(`  draft type      ${draft?.type ?? "?"}`);
  console.log(`  scoring         ${draft?.metadata?.scoring_type ?? "?"}`);
  console.log(`  roster          ${(league.roster_positions ?? []).join(", ")}`);
  console.log(`  managers        ${users.length}`);
  console.log(`  picks in Sleeper ${picks.length}`);
  console.log(`\nWrote ${OUT}/`);

  if (picks.length > 0) {
    console.log(
      `\n  NOTE: Sleeper already holds ${picks.length} picks for this draft. This ` +
        `app is the record for an offline draft; two boards with picks on them is ` +
        `the one situation that loses work. Decide which is real before drafting.`,
    );
  }
}

main().catch((err) => {
  console.error(`\nSleeper pull failed: ${err.message}`);
  process.exit(1);
});

/**
 * Materialises the committed projections snapshot — the floor under the live
 * FantasyPros integration.
 *
 *   npm run pull:projections
 *   npm run pull:projections -- --list              # what the server offers
 *   npm run pull:projections -- --tool=get_ecr      # raw tool, for diagnosis
 *
 * ============================================================================
 * WHAT THIS IS AND IS NOT
 * ============================================================================
 *
 * FantasyPros is a live, first-class integration. `@/lib/fantasypros/projections`
 * is its typed door — `getAllSeasonProjections` fetches all six positions in one
 * session through the shared cache, timeout and stale-fallback. THIS SCRIPT DOES
 * NOT AUTHENTICATE and no longer discovers the tool by name: the tool is
 * `get_projections`, that is settled, and searching for it every run was a
 * reasonable thing to do only while the inventory was unknown.
 *
 * The `--list` and `--tool=` escapes survive as DIAGNOSTICS, not as the normal
 * path. They earn their place: if the server renames something, `--list` shows
 * what it actually offers instead of leaving somebody guessing at an empty file.
 *
 * The snapshot exists because **the league drafts off the production app and the
 * recap runs the moment the draft ends.** At that moment a projected finish has
 * an audience of ten. If the live path is unavailable then — revoked grant, rate
 * limit, or a venue with no usable network — the standings should come up on
 * last-committed numbers with a visible "as of" date rather than come up blank.
 * Live first, this second, nothing third.
 *
 * ============================================================================
 * POINTS ARE COMPUTED HERE, NEVER TAKEN
 * ============================================================================
 *
 * `points_ppr` IS THE WRONG NUMBER FOR THIS LEAGUE AND IS NEVER RANKED ON.
 * Measured against the live feed, FantasyPros scores a passing touchdown at four
 * and an interception at −1; this league pays six and −2. On Josh Allen's 2026
 * line that is 372.5 on their basis against 416.1 on ours — a 43.7-point gap on
 * one quarterback, which is wider than the gap between fourth and eighth in a
 * ten-team league, and it lands on one position.
 *
 * So the snapshot stores the RAW STAT LINE and `@/lib/projections` rescores it
 * through `SCORING_SPEC`. `vendorPoints` is recorded for auditing only.
 *
 * Two mapping traps, both confirmed against the live payload:
 *   · receptions are `rec_rec`, not `rec`
 *   · `pass_ints` is the interception count; FantasyPros prices it at −1 and
 *     this league at −2, so it has to come through as a STAT and not as points
 *
 * The `pass_yds_300`, `rush_yds_100` and `scrimage_yards_*` fields are milestone
 * bonus flags, and they are deliberately ignored: ESPN carries no yardage
 * milestone bonuses in any season checked, which `@/lib/league-config` records as
 * confirmed-empty rather than unknown. They come back as zero anyway.
 *
 * ============================================================================
 * THE JOIN IS ON AN ID
 * ============================================================================
 *
 * Every projection row carries `fpId`, the same id `get_ecr` returns. The
 * committed FantasyPros player snapshot already maps those ids onto this
 * league's pool — that join is what puts live ADP on the board — so this script
 * inverts it and matches projections to pool players by ID.
 *
 * That is strictly better than matching names, and not only because it is exact:
 * it means a player resolves the SAME WAY for his projection as for his ADP,
 * because both go through one join maintained in one place. Two independent name
 * ladders would eventually disagree about somebody, and the symptom would be a
 * franchise's projection quietly missing a starter.
 *
 * The name ladder is kept as a FALLBACK for rows the id cannot place — the pool
 * carries about twice as many players as the ADP snapshot, so deep names have no
 * id bridge. Every fallback is counted and reported, because a name match is the
 * weaker claim and should be visible as one.
 *
 * NOTHING IS DROPPED SILENTLY. Unmatched rows are written with a null `playerId`
 * and printed; loose matches are printed; and the script lists any of the top 200
 * by ADP with no projection, because an unmatched starter zeroes out part of a
 * franchise's total and reads as a bad draft rather than as a broken join.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PLAYER_NICKNAMES, normalizeName } from "@/lib/draft-search";
import { getAllSeasonProjections } from "@/lib/fantasypros/projections";
import { fantasyProsOverlay, overlayFor } from "@/lib/fantasypros/snapshot";

const args = process.argv.slice(2);
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return null;
  const eq = hit.indexOf("=");
  return eq === -1 ? true : hit.slice(eq + 1);
};

const SEASON = Number(flag("season") ?? process.env.UKL_SEASON ?? 2026);
const FORCED_TOOL = typeof flag("tool") === "string" ? flag("tool") : null;
const LIST_ONLY = flag("list") === true;

const OUT = new URL(`../data/fantasypros-projections-${SEASON}.json`, import.meta.url);
const POOL = new URL("../data/smartdraft-players.json", import.meta.url);

// --- Stat mapping -----------------------------------------------------------

/**
 * FantasyPros stat key → the field `@/lib/projections` scores.
 *
 * Exact keys, taken from the live payload rather than from documentation, which
 * was wrong about `rec_rec`. Anything absent stays absent: `pointsFromStats`
 * treats a missing counting stat as zero, which is correct, whereas inventing a
 * default would turn a mapping miss into a plausible-looking projection.
 */
const STAT_MAP = {
  pass_yds: "passYards",
  pass_tds: "passTd",
  pass_ints: "interceptions",
  rush_yds: "rushYards",
  rush_tds: "rushTd",
  rec_rec: "receptions",
  rec_yds: "recYards",
  rec_tds: "recTd",
  fumbles: "fumblesLost",
  "2pt_tds": "twoPointConversions",
};

/**
 * Builds the league-scorable stat line for one row.
 *
 * Team defences are the one position that cannot be rescored, and that is a
 * property of the data rather than a shortcut. ESPN's D/ST scoring is dominated
 * by two TIERED tables — points allowed and yards allowed — and the feed returns
 * its `def_pa_*` buckets as zeroes, so the tiers are simply not projected. The
 * counting stats that ARE projected (sacks, takeaways, defensive scores) make up
 * well under half of a defence's real total, so scoring only those would
 * understate every defence by more than using FantasyPros' own number does.
 *
 * So a defence carries FantasyPros' total, passed through untouched and counted
 * in `dstPassthrough` so the disclosure is a number rather than a comment. This
 * costs nothing in ranking terms: the six-point passing touchdown — the whole
 * reason vendor totals are refused elsewhere — does not touch D/ST at all, and
 * every franchise starts exactly one.
 */
function toStats(position, stats) {
  if (position === "DST") {
    const total = stats.points ?? stats.points_ppr ?? null;
    return total != null ? { stats: { dstPoints: total }, dstPassthrough: true } : { stats: null, dstPassthrough: false };
  }

  const out = {};
  for (const [from, to] of Object.entries(STAT_MAP)) {
    const v = stats[from];
    if (typeof v === "number" && Number.isFinite(v)) out[to] = v;
  }
  return { stats: Object.keys(out).length > 0 ? out : null, dstPassthrough: false };
}

// --- Position normalisation -------------------------------------------------

/** Feeds spell team defence four ways and this league has no kicker at all. */
function normalizePosition(raw) {
  const p = String(raw ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (p === "DEF" || p === "DST" || p === "DEFENSE" || p === "TEAMDEFENSE") return "DST";
  if (p === "PK") return "K";
  return p;
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/** Normalised name with a generational suffix removed. "Etienne Jr" → "etienne". */
function withoutSuffix(name) {
  return normalizeName(name)
    .split(" ")
    .filter((t) => t && !SUFFIXES.has(t))
    .join(" ");
}

// --- Build the pool indexes -------------------------------------------------

const pool = JSON.parse(readFileSync(POOL, "utf8"));

/**
 * fpId → pool player, inverted out of the committed FantasyPros overlay.
 *
 * The overlay is the join the board already trusts for ADP, so reusing it means
 * projections and ADP agree about who a player is by construction. First writer
 * wins, and the pool is in ADP order, so a collision resolves to the
 * more-drafted player.
 */
const overlay = fantasyProsOverlay();
const poolByFpId = new Map();
if (overlay) {
  for (const p of pool.players) {
    const entry = overlayFor(overlay, p.name, p.position);
    if (entry?.fpId != null && !poolByFpId.has(entry.fpId)) poolByFpId.set(entry.fpId, p);
  }
}

/** Name keys, for the rows the id cannot place. Position is part of the key so
 * a running back cannot inherit a receiver's projection. */
const byNameAndPos = new Map();
const byName = new Map();
const bySuffixlessAndPos = new Map();
const dstByTeam = new Map();

for (const p of pool.players) {
  const pos = normalizePosition(p.position);
  const norm = normalizeName(p.name);
  const suffixless = withoutSuffix(p.name);

  if (!byNameAndPos.has(`${norm}|${pos}`)) byNameAndPos.set(`${norm}|${pos}`, p);
  if (!byName.has(norm)) byName.set(norm, p);
  if (!bySuffixlessAndPos.has(`${suffixless}|${pos}`)) {
    bySuffixlessAndPos.set(`${suffixless}|${pos}`, p);
  }
  if (pos === "DST" && p.nflTeam && !dstByTeam.has(p.nflTeam.toUpperCase())) {
    dstByTeam.set(p.nflTeam.toUpperCase(), p);
  }
}

/**
 * Resolves one projection row to a pool player. ID FIRST, always.
 *
 * The name rules that follow are ordered most-specific first and stop at the
 * first hit, so a looser rule can never override a tighter one.
 */
function resolve(fpId, sourceName, position, nflTeam) {
  if (fpId != null) {
    const byId = poolByFpId.get(fpId);
    if (byId) return { player: byId, method: "fpid" };
  }

  const pos = normalizePosition(position);
  const norm = normalizeName(sourceName);

  if (pos === "DST" && nflTeam) {
    const hit = dstByTeam.get(String(nflTeam).toUpperCase());
    if (hit) return { player: hit, method: "dst-team-code" };
  }

  const exact = byNameAndPos.get(`${norm}|${pos}`);
  if (exact) return { player: exact, method: "name-and-position" };

  const suffixless = bySuffixlessAndPos.get(`${withoutSuffix(sourceName)}|${pos}`);
  if (suffixless) return { player: suffixless, method: "suffix-stripped" };

  if (pos === "DST") {
    // "Texans D/ST" → drop the marker and try the mascot against the full name.
    const mascot = norm.replace(/\b(d|st|dst|def|defense)\b/g, " ").trim();
    for (const [, p] of dstByTeam) {
      if (mascot && normalizeName(p.name).includes(mascot)) {
        return { player: p, method: "dst-mascot" };
      }
    }
  }

  /*
   * The room's nickname table, reused rather than restated.
   *
   * FantasyPros lists Marquise Brown as "Hollywood Brown", and the pool calls
   * him Marquise — a real player at a real ADP who would otherwise be valued at
   * zero if drafted. `PLAYER_NICKNAMES` in `@/lib/draft-search` already maps
   * `hollywood` to `marquise brown` so the draft room resolves him when someone
   * shouts it across the table, and there is no reason for this script to keep a
   * second list that can drift from that one.
   *
   * Position must still agree: the table maps a nickname to a name fragment, and
   * a fragment plus the wrong position is how a projection ends up on the wrong
   * player.
   */
  for (const token of norm.split(" ")) {
    const target = PLAYER_NICKNAMES[token];
    if (!target) continue;
    for (const [key, candidate] of byNameAndPos) {
      if (key.endsWith(`|${pos}`) && normalizeName(candidate.name).includes(target)) {
        return { player: candidate, method: "nickname-alias" };
      }
    }
  }

  /*
   * Name only, position ignored, LAST. The rule most likely to be wrong, so it
   * records itself as loose: a mismatched position is then visible in the file
   * rather than indistinguishable from a clean match.
   */
  const loose = byName.get(norm);
  if (loose) return { player: loose, method: "name-only-loose" };

  return null;
}

// --- Diagnostics: --list and --tool ----------------------------------------

if (LIST_ONLY || FORCED_TOOL) {
  const { withFantasyPros } = await import("@/lib/fantasypros/client");
  try {
    await withFantasyPros(async (client) => {
      const tools = await client.listTools();
      console.log(`\nFantasyPros MCP exposes ${tools.length} tools:`);
      for (const t of tools) {
        const params = Object.keys(t.inputSchema?.properties ?? {});
        console.log(`  · ${t.name}${params.length ? `(${params.join(", ")})` : "()"}`);
        if (t.description) console.log(`      ${t.description.slice(0, 140)}`);
      }
      if (FORCED_TOOL) {
        /*
         * `limit` is passed even here. The tool's schema defaults it to 25, so a
         * raw call without one returns the top quarter of a position and looks
         * like a complete answer — which is exactly the trap this escape hatch
         * exists to help somebody diagnose.
         */
        console.log(`\nRaw call to \`${FORCED_TOOL}\`:`);
        const payload = await client.callTool(FORCED_TOOL, {
          sport: "nfl",
          projection_type: "draft",
          position: "QB",
          limit: 500,
          season: SEASON,
        });
        console.log(JSON.stringify(payload, null, 2).slice(0, 4000));
      }
    });
  } catch (cause) {
    explainAndExit(cause);
  }
  process.exit(0);
}

// --- Pull through the typed accessor ---------------------------------------

/**
 * Turns a failure from the auth layer into something actionable.
 *
 * Without this the script exits on a raw stack trace out of the token store — a
 * Supabase "relation does not exist" or an OAuth error, neither of which reads
 * as "you have not signed in yet". Each cause below has a different one-line fix.
 *
 * Nothing is written on any of these paths. A failed pull must leave the last
 * known-good snapshot exactly where it was: that file is the floor the recap
 * falls back to on draft night, and replacing it with a partial write would take
 * away the thing this script exists to protect.
 */
function explainAndExit(cause) {
  const message = String(cause?.message ?? cause);
  const hint = /fantasypros_oauth|schema cache|does not exist|relation/i.test(message)
    ? "The token table has not been migrated. Run `npm run db:push`, then `npm run auth:fantasypros`."
    : /no grant|not signed in|no stored|revoked|401|403|invalid_grant/i.test(message)
      ? "There is no usable grant. Run `npm run auth:fantasypros` to sign in."
      : "Check that the FantasyPros integration is configured and reachable.";

  console.error(
    `\nCould not reach FantasyPros.\n\n  ${message}\n\n${hint}\n\n` +
      `Nothing was written — the existing snapshot, if any, is untouched. The projected\n` +
      `standings will report "not available" until a pull succeeds, which is the\n` +
      `intended behaviour rather than a fabricated order.\n`,
  );
  process.exit(1);
}

console.log(`Fetching ${SEASON} season projections via @/lib/fantasypros/projections…`);

let all;
try {
  all = await getAllSeasonProjections({ season: SEASON, force: true });
} catch (cause) {
  explainAndExit(cause);
}

/*
 * The accessor returns null rather than throwing when FantasyPros cannot be
 * reached and nothing has ever been cached, so the null is a real branch and not
 * defensive padding.
 */
if (!all || all.players.length === 0) {
  console.error(
    "\nFantasyPros served no projections, and nothing was cached.\n\n" +
      "Refusing to write an empty snapshot over a good one — downstream treats an\n" +
      "empty file and a missing one identically, so overwriting would throw away the\n" +
      "last known-good floor.\n",
  );
  process.exit(1);
}

if (all.missing.length > 0) {
  console.warn(`\nWARNING: no projections came back for ${all.missing.join(", ")}.`);
}
if (all.source === "stale") {
  console.warn(
    `\nWARNING: these are STALE cached projections (${all.staleReason ?? "reason not given"}).\n` +
      `They are last-known-good rather than fresh, and the snapshot will record the\n` +
      `original fetch time so nothing downstream can mistake them for current.`,
  );
}

// --- Normalise, join, write ------------------------------------------------

const players = [];
const unmatched = [];
const looseMatches = [];
const nameFallbacks = [];
let skippedKickers = 0;
let dstPassthroughCount = 0;
let matchedByFpId = 0;

for (const row of all.players) {
  const pos = normalizePosition(row.position);

  // No kicker in this league — ESPN has both the K lineup slot and the K roster
  // limit at zero, so a kicker cannot be rostered and his projection is noise.
  if (pos === "K") {
    skippedKickers++;
    continue;
  }

  const hit = resolve(row.fpId, row.name, pos, row.team);
  if (!hit) {
    unmatched.push(`${row.name} (${pos}${row.team ? ` ${row.team}` : ""}) fpId=${row.fpId ?? "none"}`);
  } else if (hit.method === "fpid") {
    matchedByFpId++;
  } else {
    nameFallbacks.push(`${row.name} (${pos}) → ${hit.player.name} via ${hit.method}`);
    if (hit.method === "name-only-loose") {
      looseMatches.push(`${row.name} (${pos}) → ${hit.player.name} (${hit.player.position})`);
    }
  }

  const { stats, dstPassthrough } = toStats(pos, row.stats);
  if (dstPassthrough) dstPassthroughCount++;

  players.push({
    playerId: hit ? String(hit.player.id) : null,
    fpId: row.fpId ?? null,
    sourceName: row.name,
    matchedName: hit ? hit.player.name : null,
    position: pos,
    nflTeam: row.team ?? hit?.player.nflTeam ?? null,
    matchMethod: hit ? hit.method : null,
    stats,
    /*
     * Recorded for auditing and NEVER ranked on. FantasyPros scores a passing
     * touchdown at four and an interception at −1; this league pays six and −2.
     */
    vendorPoints: row.stats.points_ppr ?? row.stats.points ?? null,
    vendorScoring: dstPassthrough
      ? "FantasyPros D/ST total, passed through — ESPN's tiered points/yards-allowed tables are not projected"
      : "FantasyPros PPR (4-point passing TD, −1 interception) — not used",
    injuryStatus: null,
    strengthOfSchedule: null,
    tier: null,
    positionRank: null,
  });
}

const snapshot = {
  provenance: {
    source: "FantasyPros MCP get_projections via @/lib/fantasypros/projections",
    tool: "get_projections",
    pulledAt: new Date().toISOString(),
    /** When FantasyPros itself was called, which a stale cache makes differ. */
    fetchedAt: all.fetchedAt,
    cacheSource: all.source,
    season: all.season ?? SEASON,
    pointInTime: true,
    vendorScoringBasis:
      "FantasyPros PPR — 4 points per passing TD, −1 per interception. NOT this league's scoring.",
    note:
      "POINT-IN-TIME SNAPSHOT. Committed as the fallback floor for the projected " +
      "standings so they still compute when the live FantasyPros integration is " +
      "unavailable — the league drafts off production and the recap runs the moment " +
      "the draft ends. Refresh with `npm run pull:projections`. Fantasy points are " +
      "NOT taken from `vendorPoints`: src/lib/projections.ts rescores the raw stat " +
      "lines under this league's own scoring, which pays six points for a passing " +
      "touchdown and −2 per interception rather than four and −1. Team defences are " +
      "the one exception and carry FantasyPros' own total, because ESPN's tiered " +
      "points-allowed and yards-allowed tables are not projected by any feed.",
  },
  players,
};

writeFileSync(OUT, JSON.stringify(snapshot, null, 2));

// --- Report ----------------------------------------------------------------

const withStats = players.filter((p) => p.stats).length;
const matched = players.filter((p) => p.playerId).length;

console.log(`\nWrote data/fantasypros-projections-${SEASON}.json`);
console.log(`  season ${all.season ?? SEASON}, fetched ${all.fetchedAt} (${all.source})`);
console.log(`  ${players.length} projections (${skippedKickers} kickers skipped — no K in this league)`);
console.log(`  ${matched} joined to the pool: ${matchedByFpId} by fpId, ${nameFallbacks.length} by name fallback`);
console.log(`  ${unmatched.length} unmatched`);
console.log(`  ${withStats} carry a scorable line; ${dstPassthroughCount} are D/ST passthrough totals`);

if (nameFallbacks.length > 0) {
  console.warn(
    `\n${nameFallbacks.length} rows had no fpId bridge and fell back to a name match.\n` +
      `The pool carries about twice as many players as the ADP snapshot, so deep names\n` +
      `have no id to join on. Worth a glance, but only matters if one gets drafted:`,
  );
  for (const m of nameFallbacks.slice(0, 15)) console.warn(`  · ${m}`);
  if (nameFallbacks.length > 15) console.warn(`  … and ${nameFallbacks.length - 15} more`);
}

if (looseMatches.length > 0) {
  console.warn(`\n${looseMatches.length} LOOSE (name-only, position ignored) matches — check these:`);
  for (const m of looseMatches.slice(0, 20)) console.warn(`  · ${m}`);
}

if (unmatched.length > 0) {
  console.warn(`\n${unmatched.length} projection rows matched no pool player:`);
  for (const u of unmatched.slice(0, 20)) console.warn(`  · ${u}`);
  if (unmatched.length > 20) console.warn(`  … and ${unmatched.length - 20} more`);
}

/*
 * The reverse direction, and the one that actually costs a franchise points: a
 * DRAFTABLE player with no projection. He will be picked, he will start, and he
 * will be valued at zero. Limited to the top of the ADP board because the tail
 * is hundreds of players nobody will roster.
 */
const projectedIds = new Set(players.filter((p) => p.playerId).map((p) => p.playerId));
const draftableGaps = pool.players
  .filter((p) => normalizePosition(p.position) !== "K")
  .filter((p) => p.sortAdp != null)
  .sort((a, b) => a.sortAdp - b.sortAdp)
  .slice(0, 200)
  .filter((p) => !projectedIds.has(String(p.id)));

if (draftableGaps.length > 0) {
  console.warn(
    `\n${draftableGaps.length} of the top 200 players by ADP have NO projection.\n` +
      `Any of these who gets drafted is valued at zero, and \`npm run verify:projections\`\n` +
      `will report it:`,
  );
  for (const p of draftableGaps.slice(0, 30)) {
    console.warn(`  · ${p.name} (${p.position}, ADP ${p.sortAdp})`);
  }
  if (draftableGaps.length > 30) console.warn(`  … and ${draftableGaps.length - 30} more`);
} else {
  console.log("\nEvery one of the top 200 players by ADP has a projection.");
}

console.log("\nNow run `npm run verify:projections`.\n");

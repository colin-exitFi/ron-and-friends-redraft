#!/usr/bin/env node
/**
 * Pull the Ultimate Keeper League's real settings out of ESPN and write clean,
 * decoded JSON into data/espn/.
 *
 * The league is private, so this needs two browser cookies from the
 * commissioner's logged-in ESPN session, in .env.local at the repo root:
 *
 *   ESPN_S2=<the espn_s2 cookie value>
 *   ESPN_SWID=<the SWID cookie value, including the surrounding braces>
 *
 * To get them: log in at fantasy.espn.com, open DevTools -> Application ->
 * Cookies -> https://fantasy.espn.com, and copy the `espn_s2` and `SWID` values.
 *
 * Usage:
 *   node data/espn/pull-espn-league.mjs            # pull the real league (needs cookies)
 *   node data/espn/pull-espn-league.mjs --preset   # no cookies; decode ESPN's public PPR preset
 *
 * This script never prints or writes the cookie values.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const OUT = HERE;

const API = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl";
const VIEWS = ["mSettings", "mTeam", "mRoster", "mDraftDetail", "mMatchup", "mNav"];

const statMap = JSON.parse(readFileSync(resolve(HERE, "espn-stat-id-map.json"), "utf8"));
const slotMap = JSON.parse(readFileSync(resolve(HERE, "espn-lineup-slot-map.json"), "utf8"));

const STAT_LABELS = new Map();
for (const [group, rows] of Object.entries(statMap)) {
  if (!Array.isArray(rows)) continue;
  for (const row of rows) STAT_LABELS.set(row.statId, { ...row, group });
}

function env() {
  const out = {};
  try {
    for (const line of readFileSync(resolve(REPO, ".env.local"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no .env.local yet */
  }
  return { ...out, ...process.env };
}

async function get(url, cookie) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36",
    Accept: "application/json",
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    let type = "";
    try {
      type = JSON.parse(text)?.details?.[0]?.type ?? "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`HTTP ${res.status} from ESPN${type ? ` (${type})` : ""}`);
  }
  return JSON.parse(text);
}

/** Decode scoringSettings.scoringItems into readable rows. */
function decodeScoring(scoringSettings) {
  const items = (scoringSettings?.scoringItems ?? [])
    .map((item) => {
      const known = STAT_LABELS.get(item.statId);
      const dstOverride = item.pointsOverrides?.["16"];
      return {
        statId: item.statId,
        category: known?.category ?? `UNKNOWN statId ${item.statId}`,
        group: known?.group ?? "unknown",
        confidence: known?.verification ?? "unmapped",
        points: item.points,
        dstSlotOverride: dstOverride ?? null,
        effectivePoints: dstOverride ?? item.points,
        isReverseItem: item.isReverseItem ?? false,
        note: known?.note,
      };
    })
    .sort((a, b) => a.statId - b.statId);

  const reception = items.find((i) => i.statId === 53);
  const kicking = items.filter((i) => i.group === "kicking" && i.effectivePoints !== 0);

  return {
    scoringType: scoringSettings?.scoringType ?? null,
    matchupTiebreaker: scoringSettings?.matchupTieRule ?? null,
    playerRankType: scoringSettings?.playerRankType ?? null,
    homeTeamBonus: scoringSettings?.homeTeamBonus ?? null,
    derived: {
      pointsPerReception: reception?.effectivePoints ?? 0,
      pprFormat:
        reception == null || reception.effectivePoints === 0
          ? "STANDARD (no PPR)"
          : reception.effectivePoints === 1
            ? "FULL PPR"
            : reception.effectivePoints === 0.5
              ? "HALF PPR"
              : `CUSTOM (${reception.effectivePoints} per reception)`,
      kickerScoringActive: kicking.length > 0,
    },
    scoringItemsWithPoints: items.filter((i) => i.effectivePoints !== 0),
    allScoringItems: items,
  };
}

function decodeRoster(rosterSettings) {
  const counts = rosterSettings?.lineupSlotCounts ?? {};
  const decoded = Object.entries(counts)
    .map(([id, count]) => ({ slotId: Number(id), slot: slotMap.slots[id] ?? `slot ${id}`, count }))
    .sort((a, b) => a.slotId - b.slotId);
  const used = decoded.filter((s) => s.count > 0);
  const bench = counts["20"] ?? 0;
  const ir = counts["21"] ?? 0;
  const starters = used
    .filter((s) => s.slotId !== 20 && s.slotId !== 21)
    .reduce((n, s) => n + s.count, 0);
  return {
    startingLineup: used.filter((s) => s.slotId !== 20 && s.slotId !== 21),
    starters,
    bench,
    irSlots: ir,
    totalRosterSlots: starters + bench,
    kickerSlotCount: counts["17"] ?? 0,
    positionLimits: rosterSettings?.positionLimits ?? null,
    lineupLocktimeType: rosterSettings?.lineupLocktimeType ?? null,
    isBenchUnlimited: rosterSettings?.isBenchUnlimited ?? null,
    moveLimit: rosterSettings?.moveLimit ?? null,
    isUsingUndroppableList: rosterSettings?.isUsingUndroppableList ?? null,
    allSlotCounts: decoded,
  };
}

const asDate = (ms) => (ms ? new Date(ms).toISOString() : null);

function decodeSchedule(s) {
  return {
    regularSeasonMatchupPeriods: s?.matchupPeriodCount ?? null,
    matchupPeriodLength: s?.matchupPeriodLength ?? null,
    regularSeasonWeeks: s?.matchupPeriodCount ? [1, s.matchupPeriodCount] : null,
    playoffWeeks: s?.matchupPeriodCount ? [s.matchupPeriodCount + 1, 17] : null,
    playoffTeamCount: s?.playoffTeamCount ?? null,
    playoffMatchupPeriodLength: s?.playoffMatchupPeriodLength ?? null,
    playoffReseed: s?.playoffReseed ?? null,
    playoffSeedingRule: s?.playoffSeedingRule ?? null,
    divisions: s?.divisions ?? null,
    matchupPeriods: s?.matchupPeriods ?? null,
  };
}

function decodeKeepers(draftSettings, draftDetail) {
  const picks = draftDetail?.picks ?? [];
  const keeperPicks = picks.filter((p) => p.keeper === true);
  const byTeam = {};
  for (const p of keeperPicks) {
    byTeam[p.teamId] = (byTeam[p.teamId] ?? 0) + 1;
  }
  return {
    keeperCount: draftSettings?.keeperCount ?? null,
    keeperCountFuture: draftSettings?.keeperCountFuture ?? null,
    keeperOrderType: draftSettings?.keeperOrderType ?? null,
    keepersEnabled: (draftSettings?.keeperCount ?? 0) > 0,
    keeperPicksFound: keeperPicks.length,
    keeperPicksByTeamId: byTeam,
    keeperPicks: keeperPicks.map((p) => ({
      teamId: p.teamId,
      playerId: p.playerId,
      roundId: p.roundId,
      roundPickNumber: p.roundPickNumber,
      overallPickNumber: p.overallPickNumber,
    })),
    HOW_LONG_A_PLAYER_MAY_BE_KEPT:
      "NOT AVAILABLE FROM ESPN. ESPN's data model has no field for keeper duration or a consecutive-seasons clock. The only keeper fields ESPN stores are keeperCount, keeperCountFuture and keeperOrderType. The league's two-year clock is a house rule that ESPN cannot represent, so it can only come from the commissioner or the league's own spreadsheets.",
  };
}

function decodeDraft(draftSettings, draftDetail, teamNames) {
  return {
    type: draftSettings?.type ?? null,
    isSnake: draftSettings?.type === "SNAKE",
    orderType: draftSettings?.orderType ?? null,
    pickOrderTeamIds: draftSettings?.pickOrder ?? null,
    pickOrderTeamNames: (draftSettings?.pickOrder ?? []).map((id) => teamNames[id] ?? `team ${id}`),
    timePerSelectionSeconds: draftSettings?.timePerSelection ?? null,
    draftDate: asDate(draftSettings?.date),
    availableDate: asDate(draftSettings?.availableDate),
    isTradingEnabledDuringDraft: draftSettings?.isTradingEnabled ?? null,
    auctionBudget: draftSettings?.auctionBudget ?? null,
    drafted: draftDetail?.drafted ?? null,
    inProgress: draftDetail?.inProgress ?? null,
    totalPicks: draftDetail?.picks?.length ?? 0,
    roundsFound: draftDetail?.picks?.length
      ? Math.max(...draftDetail.picks.map((p) => p.roundId))
      : null,
  };
}

function decodeTrades(tradeSettings, acquisitionSettings) {
  return {
    tradeDeadline: asDate(tradeSettings?.deadlineDate),
    maxTradesPerTeam: tradeSettings?.max ?? null,
    tradeReviewHours: tradeSettings?.revisionHours ?? null,
    vetoVotesRequired: tradeSettings?.vetoVotesRequired ?? null,
    waivers: {
      acquisitionType: acquisitionSettings?.acquisitionType ?? null,
      waiverHours: acquisitionSettings?.waiverHours ?? null,
      waiverProcessDays: acquisitionSettings?.waiverProcessDays ?? null,
      waiverProcessHour: acquisitionSettings?.waiverProcessHour ?? null,
      waiverOrderReset: acquisitionSettings?.waiverOrderReset ?? null,
      isUsingWaiverOrder: acquisitionSettings?.isUsingWaiverOrder ?? null,
      isUsingAcquisitionBudget: acquisitionSettings?.isUsingAcquisitionBudget ?? null,
      acquisitionBudget: acquisitionSettings?.acquisitionBudget ?? null,
      acquisitionLimit: acquisitionSettings?.acquisitionLimit ?? null,
    },
  };
}

/**
 * ESPN member ids ARE SWID cookie values, and the commissioner's own SWID is
 * among them. Replace every SWID-shaped GUID with a stable opaque label so no
 * credential-shaped value is ever written to disk. Manager names are kept.
 */
const SWID_RE = /\{?\b[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\b\}?/g;

function redactSwids(value) {
  const seen = new Map();
  return JSON.parse(
    JSON.stringify(value).replace(SWID_RE, (match) => {
      if (!seen.has(match)) seen.set(match, `MEMBER-${String(seen.size + 1).padStart(2, "0")}`);
      return seen.get(match);
    }),
  );
}

function write(name, data) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, name), `${JSON.stringify(redactSwids(data), null, 2)}\n`);
  console.log(`  wrote data/espn/${name}`);
}

async function pullPreset() {
  console.log("Decoding ESPN's built-in 2026 'FFL PPR Scoring' preset (no cookies needed)...");
  const raw = await get(`${API}/seasons/2026/segments/0/leaguedefaults/3?view=mSettings`);
  write("espn-ppr-preset-2026-decoded.json", {
    _about:
      "ESPN's own built-in 2026 'FFL PPR Scoring' preset, decoded. This is the PLATFORM DEFAULT, not the Ultimate Keeper League's real settings. It is here as a reference for what 'PPR' means on ESPN, and as the most likely shape of the league's scoring if the commissioner started from the PPR preset.",
    _source: `${API}/seasons/2026/segments/0/leaguedefaults/3?view=mSettings`,
    _pulledAt: new Date().toISOString(),
    _warning:
      "DO NOT treat these values as confirmed league settings. They are ESPN defaults. The real league (id 441239) is private and could not be read.",
    presetName: raw.settings?.name ?? null,
    scoring: decodeScoring(raw.settings?.scoringSettings),
    roster: decodeRoster(raw.settings?.rosterSettings),
    schedule: decodeSchedule(raw.settings?.scheduleSettings),
    draft: decodeDraft(raw.settings?.draftSettings, raw.draftDetail, {}),
  });
}

async function pullLeague() {
  const e = env();
  const leagueId = e.ESPN_LEAGUE_ID || "441239";
  const season = e.ESPN_SEASON || "2026";
  const s2 = e.ESPN_S2;
  const swid = e.ESPN_SWID;

  if (!s2 || !swid) {
    console.error(
      [
        "",
        "ESPN cookies are missing.",
        "",
        "League 441239 is private: ESPN returns 401 AUTH_LEAGUE_NOT_VISIBLE without them.",
        "Add these two lines to .env.local at the repo root and re-run:",
        "",
        "  ESPN_S2=<espn_s2 cookie value>",
        "  ESPN_SWID=<SWID cookie value, keep the {braces}>",
        "",
        "Get them from a logged-in ESPN session: DevTools -> Application -> Cookies",
        "-> https://fantasy.espn.com -> copy `espn_s2` and `SWID`.",
        "",
        "Or run with --preset to decode ESPN's public PPR preset instead.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const cookie = `espn_s2=${s2}; SWID=${swid}`;
  const url = `${API}/seasons/${season}/segments/0/leagues/${leagueId}?${VIEWS.map((v) => `view=${v}`).join("&")}`;
  console.log(`Pulling ESPN league ${leagueId}, season ${season} (authenticated)...`);

  const raw = await get(url, cookie);
  const settings = raw.settings ?? {};
  const teams = raw.teams ?? [];
  const members = raw.members ?? [];

  const memberById = {};
  for (const m of members) {
    memberById[m.id] = [m.firstName, m.lastName].filter(Boolean).join(" ") || m.displayName || m.id;
  }
  const teamNames = {};
  for (const t of teams) {
    teamNames[t.id] = t.name ?? [t.location, t.nickname].filter(Boolean).join(" ").trim();
  }

  const meta = {
    _source: url.replace(/(espn_s2|SWID)=[^;&]*/g, "$1=<redacted>"),
    _pulledAt: new Date().toISOString(),
    leagueId: Number(leagueId),
    season: Number(season),
    leagueName: settings.name ?? null,
    size: settings.size ?? teams.length,
    isPublic: settings.isPublic ?? null,
  };

  write(`espn-league-${season}-raw.json`, raw);
  write("espn-scoring-settings.json", { ...meta, ...decodeScoring(settings.scoringSettings) });
  write("espn-roster-settings.json", { ...meta, ...decodeRoster(settings.rosterSettings) });
  write("espn-schedule-playoff-settings.json", {
    ...meta,
    ...decodeSchedule(settings.scheduleSettings),
  });
  write("espn-keeper-settings.json", {
    ...meta,
    ...decodeKeepers(settings.draftSettings, raw.draftDetail),
  });
  write("espn-draft-settings.json", {
    ...meta,
    ...decodeDraft(settings.draftSettings, raw.draftDetail, teamNames),
  });
  write("espn-trade-waiver-settings.json", {
    ...meta,
    ...decodeTrades(settings.tradeSettings, settings.acquisitionSettings),
    financeSettings: settings.financeSettings ?? null,
  });
  write("espn-teams.json", {
    ...meta,
    teams: teams.map((t) => ({
      teamId: t.id,
      name: teamNames[t.id],
      abbrev: t.abbrev ?? null,
      owners: (t.owners ?? []).map((id) => memberById[id] ?? id),
      divisionId: t.divisionId ?? null,
      draftDayProjectedRank: t.draftDayProjectedRank ?? null,
      playoffSeed: t.playoffSeed ?? null,
      record: t.record?.overall ?? null,
    })),
  });
  write("espn-rosters.json", {
    ...meta,
    rosters: teams.map((t) => ({
      teamId: t.id,
      name: teamNames[t.id],
      players: (t.roster?.entries ?? []).map((en) => ({
        playerId: en.playerId,
        name: en.playerPoolEntry?.player?.fullName ?? null,
        lineupSlotId: en.lineupSlotId,
        lineupSlot: slotMap.slots[String(en.lineupSlotId)] ?? null,
        acquisitionType: en.acquisitionType ?? null,
        keeperValue: en.playerPoolEntry?.keeperValue ?? null,
        keeperValueFuture: en.playerPoolEntry?.keeperValueFuture ?? null,
      })),
    })),
  });

  console.log("\nHeadlines:");
  const sc = decodeScoring(settings.scoringSettings);
  const ro = decodeRoster(settings.rosterSettings);
  const ke = decodeKeepers(settings.draftSettings, raw.draftDetail);
  const sch = decodeSchedule(settings.scheduleSettings);
  console.log(`  league name        : ${settings.name}`);
  console.log(`  teams              : ${meta.size}`);
  console.log(`  PPR                : ${sc.derived.pprFormat} (${sc.derived.pointsPerReception}/rec)`);
  console.log(`  kicker slot        : ${ro.kickerSlotCount}`);
  console.log(`  lineup             : ${ro.startingLineup.map((s) => `${s.count} ${s.slot}`).join(", ")}`);
  console.log(`  bench / IR         : ${ro.bench} / ${ro.irSlots}`);
  console.log(`  regular season     : weeks ${sch.regularSeasonWeeks?.join("-")}`);
  console.log(`  playoff teams      : ${sch.playoffTeamCount}`);
  console.log(`  keeperCount        : ${ke.keeperCount} (future ${ke.keeperCountFuture}, order ${ke.keeperOrderType})`);
  console.log("\nNow re-check the ESPN section of data/RECONCILIATION.md against these values.");
}

const mode = process.argv.includes("--preset") ? pullPreset : pullLeague;
mode().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  if (String(err.message).includes("401")) {
    console.error(
      "A 401 with valid-looking cookies usually means the cookies have expired.\n" +
        "Log in to ESPN again in the browser and copy fresh espn_s2 / SWID values.",
    );
  }
  process.exitCode = 1;
});

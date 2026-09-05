#!/usr/bin/env node
/**
 * Dump the database's pick ownership to a temp file for the independent
 * traded-pick verifier.
 *
 *   node scripts/seed-dump-db-picks.mjs        # writes /tmp/ukl-db-dump.json
 *
 * Deliberately a separate process from the verifier, which is Python. A defect
 * was found where a traded pick was resolved from the SENDER rather than from
 * the franchise the pick was born to, and that defect lived in the code path
 * every traded pick flows through. Checking it with the same TypeScript modules
 * would be circular — the seed and the reader would agree with each other
 * whether or not either agreed with the commissioner's workbook.
 *
 * So this does one thing: turn rows into names and write them out. All comparison
 * happens in `scripts/seed-verify-traded-picks.py`, which reads the workbook and
 * the room with nothing but the Python standard library.
 *
 * If the database is unreachable it writes nothing and exits 0 with a notice —
 * the verifier's source-to-source checks are the important half and still run.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const OUT = "/tmp/ukl-db-dump.json";
const SEASON = 2026;

function loadEnvLocal() {
  const out = {};
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(path.join(process.cwd(), file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v && out[m[1]] === undefined) out[m[1]] = v;
    }
  }
  return out;
}

const fileEnv = loadEnvLocal();
const pick = (n) => (process.env[n]?.length ? process.env[n] : fileEnv[n]);
const url = pick("NEXT_PUBLIC_SUPABASE_URL");
const key = pick("SUPABASE_SERVICE_ROLE_KEY");

if (!url || !key) {
  console.log("no database credentials — skipping the dump; source checks will still run");
  process.exit(0);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: teams, error } = await db
  .from("teams")
  .select("id, short_name, smartdraft_team_id");
if (error || !teams) {
  console.log(`database unreachable (${error?.message ?? "no teams"}) — skipping the dump`);
  process.exit(0);
}

const name = new Map(teams.map((t) => [t.id, t.short_name]));

const [slots, own26, own27, hops] = await Promise.all([
  db
    .from("draft_slots")
    .select("round, pick_in_round, overall_pick, original_team_id, current_team_id, smartdraft_slot_key")
    .eq("season", SEASON),
  db.from("pick_ownership").select("round, original_team, current_team").eq("season", SEASON),
  db.from("pick_ownership").select("round, original_team, current_team").eq("season", SEASON + 1),
  db.from("traded_picks").select("season, round, original_team, from_team, current_team"),
]);

writeFileSync(
  OUT,
  JSON.stringify(
    {
      dumpedAt: new Date().toISOString(),
      teams: teams.map((t) => ({ id: t.id, shortName: t.short_name, sdId: t.smartdraft_team_id })),
      slots: (slots.data ?? []).map((s) => ({
        round: s.round,
        pickInRound: s.pick_in_round,
        overallPick: s.overall_pick,
        originalOwner: name.get(s.original_team_id),
        currentOwner: name.get(s.current_team_id),
        slotKey: s.smartdraft_slot_key,
      })),
      ownership2026: (own26.data ?? []).map((o) => ({
        round: o.round,
        originalOwner: name.get(o.original_team),
        currentOwner: name.get(o.current_team),
      })),
      ownership2027: (own27.data ?? []).map((o) => ({
        round: o.round,
        originalOwner: name.get(o.original_team),
        currentOwner: name.get(o.current_team),
      })),
      tradedPicks: (hops.data ?? []).map((h) => ({
        season: h.season,
        round: h.round,
        originalOwner: name.get(h.original_team),
        fromOwner: h.from_team ? name.get(h.from_team) : null,
        currentOwner: name.get(h.current_team),
      })),
    },
    null,
    2,
  ),
);

console.log(
  `dumped ${slots.data?.length ?? 0} slots, ${own26.data?.length ?? 0} 2026 ledger rows, ` +
    `${own27.data?.length ?? 0} 2027 ledger rows, ${hops.data?.length ?? 0} traded-pick rows`,
);

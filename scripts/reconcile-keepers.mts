/**
 * One table answering "who is a keeper", across every source that claims to know.
 *
 * WHY THIS EXISTS. Counting keepers gave three different answers on the same
 * afternoon — 14, 16 and 18 — because keepers were declared through the day and
 * each source was written at a different moment. That is staleness rather than
 * corruption, but it is indistinguishable from corruption without a cross-tab,
 * and something downstream reading the stale copy would be a real bug.
 *
 * SETTLED SINCE, and this table is how you check it: the commissioner ruled on
 * Aug 28 2026 that this app and its database are the source of truth for
 * keepers, and that Smart Draft has not been updated since he began building
 * it. So SNAP and RESOLVED below are FROZEN historical imports that will stay
 * behind the board for good, rather than sources catching up. The board is 19.
 * Do not reconcile by adding two source counts together — see the note on
 * RESOLVED.
 *
 * THE SIX SOURCES, and what each one is for:
 *
 *   BOARD     the assembled 160-slot board — what the draft actually runs on,
 *             and therefore the authority every other source is judged against
 *   SNAP      `smartdraft-room-snapshot.json`, slots marked pickType KEEPER.
 *             A frozen historical import — 16, permanently behind the board
 *   RESOLVED  `keepers-2026-resolved.json`, keeper clocks joined from the room
 *             on 2026-08-26, when the room held 14. Frozen and older than SNAP.
 *             NOT a source to add to DECL: RESOLVED's 14 + DECL's 3 = 17 is
 *             wrong, because it drops Scott Elbe's two twice — they are in SNAP
 *             but not RESOLVED, and never went through DECL
 *   DECL      `keeper-declarations.json`, the declarations that never reached
 *             Smart Draft and never will. SNAP + DECL is the board
 *   DB-K      Supabase `keepers` rows
 *   DB-S      Supabase `draft_slots` with `is_keeper`
 *
 * BOARD = SNAP + DECL + whatever the reconciliation overlay places. So BOARD
 * being larger than SNAP is expected and healthy; BOARD disagreeing with DB is
 * not, because the deployment serves from the database.
 *
 *   node --env-file=.env.local --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/reconcile-keepers.mts
 *
 * Read-only. Touches nothing.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { readRoom } from "@/lib/draft-service";
import { CURRENT_SEASON } from "@/lib/league-config";

const DATA = path.join(process.cwd(), "data");
const read = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), "utf8"));

/** Names arrive from a spreadsheet, an API and a hand-kept file. Compare loosely. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .replace(/\bjr\b|\bsr\b|\biii\b|\bii\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

type Row = {
  name: string;
  board?: { team: string; costRound: number; label: string };
  snap?: { team: string; label: string };
  resolved?: { team: string; costRound: number };
  decl?: { team: string };
  dbK?: { team: string; costRound: number | null };
  dbS?: { label: string };
};

const rows = new Map<string, Row>();
const at = (name: string): Row => {
  const k = norm(name);
  if (!rows.has(k)) rows.set(k, { name });
  return rows.get(k)!;
};

// --- BOARD (authority) -----------------------------------------------------

const view = await readRoom();
for (const s of view.slots) {
  if (!s.isKeeper || !s.player) continue;
  at(s.player.name).board = {
    team: s.currentOwner.name,
    costRound: s.round,
    label: s.label,
  };
}

// --- SNAP ------------------------------------------------------------------

const snap = read("smartdraft-room-snapshot.json");
const snapSlots = snap?.state?.slots ?? snap?.slots ?? [];
const snapTeams = new Map<string, string>();
for (const t of snap?.state?.teams ?? snap?.teams ?? [])
  snapTeams.set(String(t.id ?? t.teamId), t.shortName ?? t.name ?? "?");
for (const s of snapSlots) {
  if (s.pickType !== "KEEPER" || !s.player) continue;
  const nm = s.player.name ?? s.player.fullName;
  if (!nm) continue;
  at(nm).snap = {
    team: snapTeams.get(String(s.teamId)) ?? "?",
    label: s.label ?? String(s.overallPick),
  };
}

// --- RESOLVED --------------------------------------------------------------

for (const k of read("keepers-2026-resolved.json").keepers ?? [])
  at(k.player).resolved = { team: k.owner, costRound: k.costRound };

// --- DECL ------------------------------------------------------------------

for (const d of read("keeper-declarations.json").declarations ?? [])
  for (const p of d.players ?? [])
    at(typeof p === "string" ? p : (p.player ?? p.name)).decl = {
      team: d.managerShortName,
    };

// --- DB --------------------------------------------------------------------

let dbReached = false;
let dbError = "";
try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase env vars not loaded (use --env-file=.env.local)");
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: teams } = await db.from("teams").select("id, short_name");
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.short_name]));

  const { data: keepers, error: kErr } = await db
    .from("keepers")
    .select("cost_round, season, team_id, players(full_name)")
    .eq("season", CURRENT_SEASON);
  if (kErr) throw kErr;
  for (const k of keepers ?? []) {
    const nm = (k as { players?: { full_name?: string } }).players?.full_name;
    if (!nm) continue;
    at(nm).dbK = {
      team: teamName.get(k.team_id) ?? "?",
      costRound: k.cost_round ?? null,
    };
  }

  const { data: slots, error: sErr } = await db
    .from("draft_slots")
    .select("round, pick_in_round, is_keeper, season, players(full_name)")
    .eq("season", CURRENT_SEASON)
    .eq("is_keeper", true);
  if (sErr) throw sErr;
  for (const s of slots ?? []) {
    const nm = (s as { players?: { full_name?: string } }).players?.full_name;
    if (!nm) continue;
    at(nm).dbS = { label: `${s.round}.${String(s.pick_in_round).padStart(2, "0")}` };
  }
  dbReached = true;
} catch (err) {
  /*
   * Supabase rejects with a PostgrestError, which is a plain object — `String()`
   * on it yields "[object Object]" and hides the actual cause.
   */
  dbError =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null
        ? JSON.stringify(err)
        : String(err);
}

// --- Report ----------------------------------------------------------------

const all = [...rows.values()].sort((a, b) => {
  const ra = a.board?.costRound ?? a.resolved?.costRound ?? 99;
  const rb = b.board?.costRound ?? b.resolved?.costRound ?? 99;
  return ra - rb || a.name.localeCompare(b.name);
});

const tick = (v: unknown) => (v ? "y" : "·");

console.log("counts by source");
console.log(`  BOARD    ${all.filter((r) => r.board).length}   <- authority`);
console.log(`  SNAP     ${all.filter((r) => r.snap).length}`);
console.log(`  RESOLVED ${all.filter((r) => r.resolved).length}`);
console.log(`  DECL     ${all.filter((r) => r.decl).length}`);
console.log(
  `  DB-K     ${dbReached ? all.filter((r) => r.dbK).length : "unreachable"}`,
);
console.log(
  `  DB-S     ${dbReached ? all.filter((r) => r.dbS).length : "unreachable"}`,
);
if (!dbReached) console.log(`  (database not read: ${dbError})`);

console.log(
  `\n${"player".padEnd(24)}${"team".padEnd(8)}${"cell".padEnd(7)}` +
    "BOARD SNAP RESOLVED DECL DB-K DB-S",
);
for (const r of all) {
  const team = r.board?.team ?? r.resolved?.team ?? r.decl?.team ?? r.dbK?.team ?? "?";
  const cell = r.board?.label ?? r.dbS?.label ?? "—";
  console.log(
    r.name.padEnd(24) +
      team.padEnd(8) +
      cell.padEnd(7) +
      `${tick(r.board)}     ${tick(r.snap)}    ${tick(r.resolved)}        ` +
      `${tick(r.decl)}    ${tick(r.dbK)}    ${tick(r.dbS)}`,
  );
}

// --- Divergences that matter ----------------------------------------------

const problems: string[] = [];
for (const r of all) {
  if (!r.board && (r.resolved || r.decl))
    problems.push(
      `NOT ON BOARD: ${r.name} is declared/resolved but occupies no keeper slot`,
    );
  if (r.board && dbReached && !r.dbS)
    problems.push(
      `DB MISSING: ${r.name} is a keeper on the board but not a keeper slot in the database`,
    );
  if (r.board && r.resolved && r.board.costRound !== r.resolved.costRound)
    problems.push(
      `COST MISMATCH: ${r.name} board R${r.board.costRound} vs resolved R${r.resolved.costRound}`,
    );
  if (r.board && r.dbK?.costRound != null && r.board.costRound !== r.dbK.costRound)
    problems.push(
      `COST MISMATCH: ${r.name} board R${r.board.costRound} vs database R${r.dbK.costRound}`,
    );
  if (r.board && r.resolved && r.board.team !== r.resolved.team)
    problems.push(
      `OWNER MISMATCH: ${r.name} board ${r.board.team} vs resolved ${r.resolved.team}`,
    );
}

console.log(
  problems.length
    ? `\n${problems.length} divergences that would change what a screen shows:\n  ${problems.join("\n  ")}`
    : "\nNo divergence that changes what a screen shows.",
);

// --- Per franchise, and who still owes a declaration ----------------------

console.log(`\nkeepers per franchise (max ${2} by rule)`);
const perTeam = new Map<string, string[]>();
for (const t of view.teams) perTeam.set(t.name, []);
for (const r of all)
  if (r.board) perTeam.get(r.board.team)?.push(`${r.name} (R${r.board.costRound})`);

for (const [team, list] of perTeam) {
  const flag = list.length === 2 ? "" : list.length === 0 ? "  <- none declared" : "  <- one short";
  console.log(`  ${team.padEnd(8)}${list.length}${flag}`);
  for (const p of list) console.log(`      ${p}`);
}

const short = [...perTeam.entries()].filter(([, l]) => l.length < 2);
console.log(
  short.length
    ? `\nStill owed: ${short.map(([t, l]) => `${t} (${2 - l.length})`).join(", ")}`
    : "\nEvery franchise has declared two.",
);

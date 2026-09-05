/**
 * One pick, and every surface that reports on the draft asked whether it can
 * see it.
 *
 *   BASE=http://127.0.0.1:3399 npm run verify:draft:read-paths
 *
 * ============================================================================
 * THE FAILURE THIS EXISTS TO CATCH
 * ============================================================================
 * There are two data sources in this codebase — the JSON snapshots in `data/`
 * and Supabase — and the draft has two stores behind the same interface. The
 * expensive way for that to go wrong is not a crash. It is a SPLIT BRAIN: picks
 * land in Postgres all evening while the recap, the final board or the rosters
 * view read a snapshot on disk. Nothing looks broken during the draft. The board
 * fills up, the phones follow along, and then the recap is opened in front of
 * ten people and describes an empty draft.
 *
 * Reading the code is not enough to rule it out, because every one of these
 * surfaces is server-rendered from its own call and the store is chosen at
 * runtime, per process, by whether `data/` happens to be writable. A deployment
 * and a laptop resolve that question differently and both are correct. So the
 * question is asked of a running server instead: enter a pick through the API,
 * then fetch each surface and look for the player's name in the HTML.
 *
 * `readRoom()` is the single funnel today and every surface below goes through
 * it. That is exactly why this is worth pinning down — the guarantee is one
 * import away from being broken by a well-meaning change, and the symptom would
 * not show up until the draft was over.
 *
 * Note that `@/lib/league-json` has its own private `readRoom()` that reads the
 * Smart Draft room file. That one is the board's SHAPE — slots, draft order,
 * traded picks — which is snapshot data and belongs on disk. Entered picks are
 * the only thing this script is talking about.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 * Run with `DRAFT_STORE=database` there is no test season to hide in: it is the
 * real `draft_live_state` row for the real season, and `BASE` makes no
 * difference to that because a local build reads the same Supabase project the
 * deployment does. So, the same shape as `verify-draft-two-clients.mjs`:
 *
 *   1. It REFUSES TO RUN if the board has any entered pick on it.
 *   2. The stored board is read before anything is written and put back on
 *      every exit path, verified by SHA-256 rather than assumed.
 *
 * The restore is a plain update rather than a reset, so nothing is archived and
 * no restore point is fabricated — an `undoLast` on somebody else's device is
 * not spent by having run this.
 *
 * Run it against a production build, not `next dev`: HMR makes the first render
 * of each page slow enough to race the fetch.
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

import { DB_SCHEMA } from "../src/lib/db-schema.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3399";
const SEASON = Number(process.env.SEASON ?? 2026);

/**
 * The surfaces that report on the draft after it is over, which is when a split
 * brain would finally be noticed. `/draft` itself is deliberately not in the
 * list: it is the page the pick was entered on, so it proves nothing.
 */
const SURFACES = [
  ["the final board", "/draft/final"],
  ["the rosters view", "/rosters"],
  ["the recap tab", "/draft/recap"],
  ["the export view", "/draft/export"],
];

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
};
const section = (t) => console.log(`\n${t}\n${"─".repeat(t.length)}`);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !service) {
  console.error(
    "This test enters a real pick into the shared draft board, and it will not\n" +
      "do that without the credentials to put the board back. Set\n" +
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (they are in\n" +
      ".env.local, which the npm script already loads) and run it again.",
  );
  process.exit(1);
}

/*
 * `db.schema`: this snapshots and RESTORES the real board, so a client left on
 * the default schema would read an empty snapshot out of the live companion
 * app's `public`, "restore" that over the live row, and report success.
 */
const db = createClient(url, service, {
  db: { schema: DB_SCHEMA },
  auth: { persistSession: false },
});

const sha = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** The stored board, straight from Postgres — not the API's view of it. */
async function storedState() {
  const { data, error } = await db
    .from("draft_live_state")
    .select("state")
    .eq("season", SEASON)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.state ?? null;
}

async function serverView() {
  const res = await fetch(`${BASE}/api/draft/state`, { cache: "no-store" });
  const body = await res.json();
  if (!body.ok) throw new Error(body.error ?? "the board would not load");
  return body.view;
}

const view = await serverView().catch((err) => {
  console.error(`Could not read ${BASE}/api/draft/state: ${err.message}`);
  console.error(
    "Start the production build this test needs first, on a port nobody else is\n" +
      "using, and pass it as BASE:\n\n" +
      "  NEXT_DIST_DIR=.next-verify npm run build\n" +
      "  NEXT_DIST_DIR=.next-verify DRAFT_STORE=database npx next start -p 3399\n",
  );
  process.exit(1);
});

if (view.picksMade > 0) {
  console.error(
    `REFUSING TO RUN. The board has ${view.picksMade} entered pick(s) on it.\n\n` +
      "This test enters a pick into the real board and then puts the whole row\n" +
      "back as it found it. That is safe on an empty board and it is not\n" +
      "something to be doing to a draft in progress — the restore would take the\n" +
      "real picks with it.",
  );
  process.exit(1);
}

const before = await storedState();
const beforeSha = sha(before);
console.log(`Live board sha256 before: ${beforeSha.slice(0, 16)}… (season ${SEASON})`);

const slot = view.slots.find((s) => s.round === 1 && !s.player);
const search = await (
  await fetch(`${BASE}/api/players/search?q=lamar`, { cache: "no-store" })
).json();
const player = (search.players ?? search.results ?? [])[0];

if (!slot || !player) {
  console.error("No open round-1 slot, or no player matched — cannot run.");
  process.exit(1);
}

/*
 * A surname, not the full name. The board's cells are 40px wide and draw the
 * surname alone, so matching the full string would fail on the one surface most
 * worth checking.
 */
const surname = player.name.split(" ").pop();

section(`Setup — one pick, entered through the ${DB_SCHEMA} draft store`);
console.log(`  entering: ${player.name} at ${slot.label ?? slot.id}`);

try {
  const res = await (
    await fetch(`${BASE}/api/draft/pick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slotId: slot.id, playerId: String(player.id) }),
    })
  ).json();
  check("the pick was accepted", res.ok === true, res.error);

  /*
   * Asserted against Postgres rather than the API's own response. A store that
   * echoed the pick back without saving it would pass every check below on the
   * strength of one process's memory.
   */
  const stored = await storedState();
  check(
    "the pick is IN POSTGRES, not just in the response",
    (stored?.picks ?? []).length === 1,
    `picks=${(stored?.picks ?? []).length}`,
  );
  check(
    "the stored pick names the player that was entered",
    (stored?.picks ?? [])[0]?.playerId === String(player.id),
  );

  section("Every surface that reports on the draft reads the same store");
  for (const [label, path] of SURFACES) {
    const html = await (await fetch(`${BASE}${path}`, { cache: "no-store" })).text();
    check(
      `${label} (${path}) sees the pick`,
      html.toUpperCase().includes(surname.toUpperCase()),
      "it is reading a different store than the pick went to — SPLIT BRAIN",
    );
  }

  section("Undo takes it back out of the same store");
  const undo = await (await fetch(`${BASE}/api/draft/undo`, { method: "POST" })).json();
  check("undo was accepted", undo.ok === true, undo.error);
  check(
    "undo emptied the board in Postgres",
    ((await storedState())?.picks ?? []).length === 0,
  );
} finally {
  section("The live draft board is back exactly as it was");
  const { error } = await db
    .from("draft_live_state")
    .update({ state: before })
    .eq("season", SEASON);
  check("the stored board was restored", !error, error?.message);
  check(
    "sha256 of the stored draft board is unchanged by the whole run",
    sha(await storedState()) === beforeSha,
  );
  const final = await serverView().catch(() => null);
  check("no test pick left on the board", final?.picksMade === 0);
}

console.log(failures ? `\n${failures} check(s) FAILED.` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);

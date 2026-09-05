/**
 * Proves a pick entered on one device reaches another device's board.
 *
 * This is the chain draft night depends on and the one part of it that cannot
 * be verified by reading code, because it runs through Postgres logical
 * replication, the Realtime server, RLS as the anon role, and a websocket.
 * Every link is configuration rather than application logic.
 *
 * It reports which columns arrive, which is how the shape of the publication is
 * checked rather than assumed — 20260827000001 narrowed it to a column list and
 * 20260827000002 widened it back, so "what does a subscriber actually receive"
 * is a question this file should answer out loud rather than leave to the
 * migration history.
 *
 * Read the wait after SUBSCRIBED before trusting a failure from this script. It
 * has produced one false accusation already, and the migration history carries
 * the scar.
 *
 * WHAT IT TOUCHES. Season 1999, never 2026. `draft_live_state` deliberately has
 * no foreign key to `leagues` ("an unseeded season is not a reason to refuse to
 * save a pick"), so a throwaway season row is legal, is what the test writes,
 * and is deleted at the end. The live board is only ever read.
 *
 *   node --env-file=.env.local scripts/verify-draft-realtime.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !service) {
  console.error("Missing Supabase env. Run with --env-file=.env.local");
  process.exit(1);
}

const TEST_SEASON = 1999;
const TIMEOUT_MS = 15_000;

/** Subscribes as a BROWSER would: anon key, no service privileges. */
const watcher = createClient(url, anon, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 20 } },
});
const writer = createClient(url, service, { auth: { persistSession: false } });

const received = [];
let resolveFirst;
const firstEvent = new Promise((r) => {
  resolveFirst = r;
});

const channel = watcher.channel("verify-draft-live");
channel.on(
  "postgres_changes",
  { event: "*", schema: "public", table: "draft_live_state" },
  (payload) => {
    received.push(payload);
    resolveFirst?.(payload);
  },
);

const subscribed = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve("TIMED_OUT_SUBSCRIBING"), TIMEOUT_MS);
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      clearTimeout(timer);
      resolve(status);
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      clearTimeout(timer);
      resolve(status);
    }
  });
});

console.log(`1. anon subscription ....... ${subscribed}`);
if (subscribed !== "SUBSCRIBED") {
  console.error("\nFAILED: a browser cannot even open the channel.");
  process.exit(1);
}

/*
 * SUBSCRIBED IS NOT THE SAME AS LISTENING, and skipping this wait is how this
 * script spent an afternoon accusing the database of a fault it did not have.
 *
 * `SUBSCRIBED` means the channel joined. Delivery needs one more thing to have
 * happened: Realtime records the subscription in `realtime.subscription` and the
 * replication pipeline only matches WAL records against it once that row is
 * committed and picked up. Writing immediately lands the change in the gap — the
 * event is not "late", it is never matched — and the script then reports "no
 * event in 15s", which reads exactly like a broken publication.
 *
 * It sent a real investigation down the wrong path: a correct publication was
 * dropped and re-added, the column list was blamed and reverted, and the
 * migration history now carries 20260827000002 because of it. The publication
 * was never the problem. Three seconds is far longer than the registration
 * needs, and this script is not on any hot path.
 *
 * A board on draft night never meets this: it subscribes when the page opens and
 * the first pick is minutes later, not milliseconds.
 */
await new Promise((r) => setTimeout(r, 3000));

// --- Does the live 2026 row exist, and is it the DB store's? --------------

const { data: live, error: liveErr } = await writer
  .from("draft_live_state")
  .select("season, revision, updated_at")
  .eq("season", 2026)
  .maybeSingle();

console.log(
  `2. live 2026 row .......... ${
    liveErr
      ? `error: ${liveErr.message}`
      : live
        ? `revision ${live.revision}, updated ${live.updated_at}`
        : "none yet — no pick has been entered through the database store"
  }`,
);

// --- Write a throwaway row and see whether the watcher hears it -----------

const { error: insErr } = await writer.from("draft_live_state").insert({
  season: TEST_SEASON,
  state: { version: 1, season: TEST_SEASON, picks: [], nextSeq: 1 },
  revision: 1,
});
if (insErr) {
  console.error(`3. test write .............. FAILED: ${insErr.message}`);
  await cleanup();
  process.exit(1);
}
console.log("3. test write .............. inserted season 1999");

const winner = await Promise.race([
  firstEvent,
  new Promise((r) => setTimeout(() => r(null), TIMEOUT_MS)),
]);

if (!winner) {
  console.error(
    `4. delivery ................ FAILED: no event in ${TIMEOUT_MS / 1000}s\n\n` +
      "Check the publication before concluding Realtime is at fault:\n\n" +
      "  select c.relname, pr.prattrs from pg_publication_rel pr\n" +
      "    join pg_class c on c.oid = pr.prrelid\n" +
      "    join pg_publication p on p.oid = pr.prpubid\n" +
      "   where p.pubname = 'supabase_realtime' and c.relname = 'draft_live_state';\n\n" +
      "One row with a null `prattrs` is correct — published, no column list. If\n" +
      "that is what you see, the fault is not in the publication, and the wait\n" +
      "above is the first thing to suspect rather than the last.",
  );
  await cleanup();
  process.exit(1);
}

console.log(`4. delivery ................ event received: ${winner.eventType}`);
console.log(`   columns delivered ....... ${Object.keys(winner.new ?? {}).join(", ") || "(none)"}`);

/*
 * `state` arriving is expected. 20260827000001 tried to exclude it with a
 * publication column list and Realtime then delivered nothing at all, so
 * 20260827000002 publishes the table whole. The board ignores the payload and
 * re-fetches the assembled view, so this costs a sub-30KB message per pick.
 */
const cols = Object.keys(winner.new ?? {});
if (!cols.includes("state"))
  console.log("   NOTE: `state` absent — a column list is back on the publication.");

// --- An UPDATE too, which is what a real pick does -----------------------

const before = received.length;
const { error: updErr } = await writer
  .from("draft_live_state")
  .update({ revision: 2, updated_at: new Date().toISOString() })
  .eq("season", TEST_SEASON);

/*
 * The INSERT above only proves the channel is open at all: the row is created
 * once, before anybody drafts. Every actual pick is an UPDATE to that one row,
 * so this step — not step 4 — is the one that decides whether the projector and
 * the phones follow along. It used to print its own failure and exit 0 anyway,
 * which meant the script's closing promise that "a pick will reach the others"
 * survived the discovery that it would not.
 */
let updateDelivered = false;
if (updErr) {
  console.error(`5. test update ............. FAILED: ${updErr.message}`);
} else {
  await new Promise((r) => setTimeout(r, 3000));
  updateDelivered = received.slice(before).some((p) => p.eventType === "UPDATE");
  console.log(
    `5. update delivery ......... ${updateDelivered ? "event received" : "NO UPDATE EVENT — a pick would not propagate"}`,
  );
}

await cleanup();

if (!updateDelivered) {
  console.error(
    `\n${received.length} event(s) total, but no UPDATE among them.\n` +
      "FAILED: a pick entered on one device would NOT reach the others.",
  );
  process.exit(1);
}

console.log(
  `\n${received.length} event(s) total. A pick entered on one device will reach the others.`,
);
process.exit(0);

async function cleanup() {
  await writer.from("draft_live_state").delete().eq("season", TEST_SEASON);
  await watcher.removeChannel(channel);
  await watcher.realtime.disconnect();
}

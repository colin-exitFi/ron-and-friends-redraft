/**
 * How fast a pick reaches a phone when the websocket is NOT working.
 *
 *   BASE=http://127.0.0.1:3133 npm run verify:draft:poll
 *
 * ============================================================================
 * WHY THIS EXISTS SEPARATELY FROM `verify:draft:realtime`
 * ============================================================================
 * That script proves the happy path: the publication, RLS as anon, the socket,
 * the delivery. It needs the real database and it answers "does Realtime work".
 *
 * This one answers the question the commissioner actually asked, which is the
 * opposite one. He watched the board and the cheat sheet sit on "syncing
 * slowly" and said "I need that to be more real-time". Realtime being down is
 * not a hypothetical on venue wifi — it is the condition the room was in — so
 * how quickly a pick arrives WITHOUT it is a number this repo should assert
 * rather than hope about. It used to be ten seconds.
 *
 * It needs no credentials, and that is the point: it runs the app with a
 * Supabase URL that cannot be reached, which is the same thing the browser sees
 * when the socket is dead. `DRAFT_STORE=database` makes the app believe saves
 * are shared, so the client opens a channel and falls back exactly as it would
 * in the room.
 *
 * RUN IT AGAINST A SERVER STARTED LIKE THIS — no `.env.local`, on purpose:
 *
 *   NEXT_DIST_DIR=.next-poll npm run build
 *   DRAFT_STORE=database \
 *     NEXT_PUBLIC_SUPABASE_URL=https://unreachable.invalid \
 *     NEXT_PUBLIC_SUPABASE_ANON_KEY=not-a-key \
 *     NEXT_DIST_DIR=.next-poll npx next start -p 3133
 *
 * The API routes 500 under that arrangement, which is fine and is not what is
 * being measured: this counts REQUESTS. Whether the answer comes back is the
 * database's problem and `verify:draft:read-paths`' subject.
 *
 * ============================================================================
 * WHY IT CHECKS THE CHEAT SHEET AND NOT THE BOARD
 * ============================================================================
 * `/draft` will not render at all against a database it cannot reach — it says
 * "the board cannot be drawn" and stops, by design — so `DraftBoard` never
 * mounts and there is no interval to measure. `/players` was built to degrade
 * instead: a failed board read leaves everyone showing as available and the
 * page still comes up, which is what makes it testable here.
 *
 * That is a smaller loss than it looks. Both surfaces call the same
 * `useDraftLiveSync` with the same default, so the interval proved here is the
 * interval the board runs; and the phone is where the commissioner reported
 * this, because the board is on a television with a cable. The board's own
 * sync, end to end against a real database, is `verify:draft:remote`.
 */
import { chromium } from "playwright";

import { POLL_SECONDS } from "../src/lib/poll-interval.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3133";
const POLL_MS = POLL_SECONDS * 1000;
/** Long enough for several ticks, short enough to stay a quick check. */
const WINDOW_MS = POLL_MS * 4;

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

const browser = await chromium.launch();

/** Every request the page makes to the endpoint that carries picks. */
function watch(page, route) {
  const at = [];
  page.on("request", (req) => {
    if (req.url().includes(route)) at.push(Date.now());
  });
  return at;
}

/** Gaps between consecutive requests, in ms. */
const gaps = (at) => at.slice(1).map((t, i) => t - at[i]);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

try {
  section(`0. A board that believes its saves are shared, on a socket that is not`);
  console.log(`  · ${BASE}`);
  console.log(`  · poll interval under test: ${POLL_SECONDS}s`);

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const polls = watch(page, "/api/players/drafted");
  await page.goto(`${BASE}/players`, { waitUntil: "domcontentloaded" });

  /*
   * The indicator has to reach the fallback before the interval means anything.
   * A page still on "Connecting…" polls at the same rate, so asserting the
   * interval without this would pass on a build that never falls back at all.
   */
  const indicator = page.locator("text=/Live —|Syncing every|Connecting/").first();
  await indicator.waitFor({ timeout: 30_000 });
  await page
    .locator("text=/Syncing every/")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  const label = (await indicator.innerText()).trim();
  console.log(`  · the page says “${label}”`);

  section("1. It says so, and it names the interval");

  check(
    "the socket failed and the page fell back rather than claiming to be live",
    /Syncing every/.test(label),
    `it says “${label}” — a reachable Supabase URL would make this a live board`,
  );
  check(
    `…and it tells the room the interval, not that it is “slowly”`,
    new RegExp(`Syncing every ${POLL_SECONDS}s`).test(label) && !/slowly/i.test(label),
    label,
  );

  section(`2. It asks again every ${POLL_SECONDS}s`);

  polls.length = 0;
  const started = Date.now();
  await page.waitForTimeout(WINDOW_MS);
  const elapsed = Date.now() - started;
  const observed = gaps(polls);
  console.log(
    `  · ${polls.length} request(s) in ${(elapsed / 1000).toFixed(1)}s, gaps ${observed
      .map((g) => `${(g / 1000).toFixed(1)}s`)
      .join(" ")}`,
  );

  /*
   * Asserted as a band rather than an equality. `setInterval` on a real browser
   * drifts, and the fetch itself takes time. The band is wide enough not to
   * flake and narrow enough that the old ten-second interval could not pass it,
   * which is the regression worth catching.
   */
  const mid = observed.length ? median(observed) : Infinity;
  check(
    `the gap between requests is about ${POLL_SECONDS}s`,
    mid > POLL_MS * 0.5 && mid < POLL_MS * 1.6,
    `median gap ${(mid / 1000).toFixed(1)}s`,
  );
  check(
    "…which is at least three requests in the window, not one",
    polls.length >= 3,
    `${polls.length} in ${(elapsed / 1000).toFixed(1)}s`,
  );

  section("3. Coming back to the page does not wait for the next tick");

  /*
   * The failure being covered: a phone in a pocket. Mobile browsers throttle a
   * backgrounded tab's timers to roughly one a minute and suspend its sockets,
   * so the manager unlocks his phone and reads a pool that is a minute stale
   * while the dot claims otherwise. Returning to the page has to re-ask at once.
   *
   * Driven with a real `focus` event, which is what the browser dispatches on a
   * return to the tab. Playwright cannot background a page without CDP, and the
   * handler's own guard is `document.visibilityState`, so a foreground focus is
   * the same code path a genuine wake-up takes.
   */
  polls.length = 0;
  await page.waitForTimeout(600);
  const before = polls.length;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(700);
  const woke = polls.length - before;
  check(
    "a return to the page asks immediately",
    woke >= 1,
    `${woke} request(s) inside 700ms of the wake-up — the next tick was ${POLL_SECONDS}s away`,
  );

  polls.length = 0;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(400);
  check(
    "…and three wake-up events from one return count as one",
    polls.length === 1,
    `${polls.length} request(s) — focus and visibilitychange both fire on every return`,
  );

  await page.close();
} finally {
  await browser.close();
}

console.log(
  failures ? `\n  ${failures} check(s) FAILED\n` : "\n  All checks passed.\n",
);
process.exit(failures ? 1 : 0);

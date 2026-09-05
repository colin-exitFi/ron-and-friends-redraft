/**
 * Drives the mock draft in a real browser, end to end, with the keyboard.
 *
 *   BASE=http://127.0.0.1:3210 node scripts/verify-mock-browser.mjs
 *
 * `verify-mock-isolation.mts` proves the engine and the file isolation. This
 * proves the thing the engine is wrapped in: that the commissioner can set the
 * board up before it runs, take a franchise over, type a pick the way he will on
 * Saturday, watch nine bots answer, flip to the rosters view, and finish a
 * draft — and that while all of that happens the page never sends a request to
 * the live draft API.
 *
 * The first section is the regression that prompted the setup screen: opening
 * /mock used to start drafting on its own, so "the board is still empty after
 * sitting on the page" is now asserted rather than assumed.
 *
 * The network assertion is the important one and it is done by recording every
 * request the page makes, not by reading the source.
 *
 * Screenshots land in `screenshots/`.
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3210";
const OUT = path.join(process.cwd(), "screenshots");
/** 1080p, because that is what it will be plugged into. */
const VIEWPORT = { width: 1920, height: 1080 };
const LIVE_STATE = path.join(process.cwd(), "data", "draft-state-2026.json");

mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

const sha = () => createHash("sha256").update(readFileSync(LIVE_STATE)).digest("hex");

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    → ${path.relative(process.cwd(), file)}`);
  return file;
}

/** Types at the document with no element focused, one key at a time. */
async function typeAtDocument(page, text) {
  for (const char of text) {
    await page.keyboard.press(char === " " ? "Space" : char);
    await page.waitForTimeout(12);
  }
}

/**
 * How many keepers the assembled board carries, asked of the app itself.
 *
 * `/draft/export` prints `view.keeperCount`, which is the board's own
 * `slots.filter(isKeeper).length`. Nothing here duplicates the reconciliation —
 * the number is whatever the board says today, so a new declaration moves this
 * and the mock grid together and the assertion below keeps its teeth.
 *
 * The comment and tag stripping is not cosmetic: React SSR separates adjacent
 * text nodes with `<!-- -->`, so the count and the word "keepers" arrive with
 * markup between them and a naive regex over raw HTML silently finds nothing.
 */
async function liveBoardKeeperCount() {
  const html = await (await fetch(`${BASE}/draft/export`)).text();
  const text = html.replace(/<!--.*?-->/g, "").replace(/<[^>]+>/g, " ");
  return Number(text.match(/no kicker\s*·\s*([0-9]+)\s*keepers/)?.[1]);
}

/** The mock's own board state, read out of the DOM rather than from an API. */
async function boardCounts(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll("[data-slot-id]")];
    const filled = cells.filter((c) => !/^\s*\d+\.\d+\s*$/.test(c.innerText.trim()));
    return { cells: cells.length, filled: filled.length };
  });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

const consoleProblems = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") consoleProblems.push(`${m.type()}: ${m.text()}`);
});
page.on("pageerror", (e) => consoleProblems.push(`pageerror: ${e.message}`));

/** Every request the page makes, so the live draft API can be ruled out. */
const requests = [];
page.on("request", (r) => requests.push(`${r.method()} ${r.url()}`));

try {
  const liveBefore = sha();
  console.log(`Live board sha256 before: ${liveBefore.slice(0, 16)}…`);

  /*
   * Discard any saved mock first, so this script starts from pick one every
   * time. It is not merely hygiene: the previous run of this script left a mock
   * in progress, the next run correctly RESUMED it, and the test then failed
   * looking for a "draft for this franchise" button that had already become
   * "stop drafting for this franchise". Which is a good sign for the feature and
   * a bad one for the test.
   */
  await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });

  section("Landing on /mock does not start a draft");
  await page.goto(`${BASE}/mock`, { waitUntil: "networkidle" });
  /*
   * Long enough that the old behaviour would have made three or four picks: the
   * bot beat was 420ms and the loop used to be mounted and running on arrival.
   */
  await page.waitForTimeout(1800);

  /*
   * Detect another process writing the live board.
   *
   * The mock has not interacted with anything yet, so if the file has already
   * moved, something outside this browser is writing it — another verification
   * script, or a concurrent agent. In that case a whole-session before/after
   * comparison proves nothing either way, so it is reported rather than
   * asserted, and the CAUSAL check below (no request to the live draft API ever
   * left this page) carries the claim instead.
   */
  const liveAfterIdle = sha();
  const concurrentWriter = liveAfterIdle !== liveBefore;
  if (concurrentWriter) {
    console.log(
      `  ! another process is writing data/draft-state-2026.json ` +
        `(${liveBefore.slice(0, 12)}… → ${liveAfterIdle.slice(0, 12)}… before the mock did anything)`,
    );
  }

  const idle = await boardCounts(page);
  check(
    "no board is on screen and no pick has been made",
    idle.cells === 0 && idle.filled === 0,
    `${idle.cells} cells, ${idle.filled} filled`,
  );
  check(
    "nothing was saved — the mock file was not written just by opening the page",
    requests.filter((r) => /PUT .*\/api\/mock-draft\//.test(r)).length === 0,
  );

  const setupBody = await page.textContent("body");
  check("the setup screen asks him to set the board first", setupBody.includes("Set the board"));
  check(
    "it says it is running against the real board",
    setupBody.includes("real board, real order, real keepers"),
  );
  check(
    "the real bot personalities are offered with what they do",
    /Zero RB/.test(setupBody) && setupBody.includes("Will not touch a running back"),
  );
  check("watching all ten is an explicit choice", setupBody.includes("Watch only"));
  check(
    "it says what the board holds — keepers and traded picks",
    /Keepers placed/.test(setupBody) && /Traded picks/.test(setupBody),
  );
  await shot(page, "mock-00-setup");

  section("Setting the board, then starting it");
  // Colin is the commissioner's own franchise ("Flurp McDerp").
  await page.getByTitle(/^Draft for Flurp McDerp/).click();
  await page.waitForTimeout(150);
  const chosen = await page.textContent("body");
  check(
    "choosing a franchise shows which picks it actually owns",
    /owns \d+ picks/.test(chosen),
  );
  /*
   * Picked by the label the room reads, not by the title. `MOCK_PACES` puts a
   * pace's BLURB in `title`, and `/^Quick/` was matching "Quick — for rehearsing
   * your own picks", which is Fast's blurb — the right chip, reached by
   * coincidence. Reword that blurb and this becomes a 30-second click timeout
   * that aborts the run before a single board assertion is reached.
   *
   * Fast rather than Instant, deliberately. Instant's delay is 0ms, so the bots
   * reach this franchise's first pick and STOP before the `start` count is taken
   * below — "bots have made picks on their own" then compares a board against
   * itself and fails. Fast is quick enough for a whole draft to fit inside this
   * script's patience and slow enough to still be visibly working.
   */
  await page.getByRole("button", { name: "Fast", exact: true }).click();
  await page.waitForTimeout(100);
  await page.getByTitle("Begin the mock with these settings").click();
  await page.waitForTimeout(700);

  const body0 = await page.textContent("body");
  check("the mock page rendered", body0.includes("Mock"));
  check(
    "the board opens by saying which franchise is yours",
    body0.includes("You are drafting for"),
  );
  check(
    "it says it is running against the real board",
    body0.includes("real board, real order, real keepers"),
  );

  const start = await boardCounts(page);
  check(`the grid draws all 160 cells`, start.cells === 160, `got ${start.cells}`);

  /*
   * The keeper count is DERIVED, not written down. It was `>= 18` here, which
   * was both stale and toothless: it kept passing while the real figure moved
   * to 19, and a `>=` could not have caught a keeper going missing anyway.
   *
   * `/draft/export` prints `view.keeperCount`, which is the assembled board's
   * own `slots.filter(isKeeper).length` — the same board the mock renders. So
   * this asserts equality against the board rather than against a number
   * somebody remembered, and a new declaration moves both sides at once.
   */
  const boardKeepers = await liveBoardKeeperCount();
  check(
    "the live board reports a keeper count at all",
    Number.isInteger(boardKeepers) && boardKeepers > 0,
    `parsed ${boardKeepers}`,
  );
  /*
   * Counted off the cells that SAY keeper, not off `filled`. An empty traded
   * slot prints the acquiring franchise on its bottom edge, so it fails the
   * "cell contains nothing but its label" test that `filled` uses: on this board
   * a fresh grid reads as the keepers plus all 29 trade strips. Reading the
   * title is exact, and it also asserts the keeper is MARKED as one rather than
   * merely occupied.
   */
  const keeperCells = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-slot-id][title]")].filter((c) =>
        /, keeper\)$/.test(c.getAttribute("title") ?? ""),
      ).length,
  );
  check(
    `every keeper the board carries is pre-placed before anything is drafted (${boardKeepers})`,
    keeperCells === boardKeepers,
    `board says ${boardKeepers}, mock grid marks ${keeperCells}`,
  );

  // Nothing focused: the mock captures keystrokes at the document, same as the
  // live board. If this were wrong, no pick below could be entered.
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "NONE");
  check("nothing is focused — keystrokes are captured at the document", activeTag === "BODY");

  section("No cheat sheet — the pool is never browsable");
  check(
    "no list of available players is on screen",
    !/best available|available players|cheat sheet/i.test(body0),
  );

  section("The bots draft, and the pane follows the clock");
  await page.waitForTimeout(2600);
  const mid = await boardCounts(page);
  check(
    "bots have made picks on their own",
    mid.filled > start.filled,
    `${start.filled} → ${mid.filled}`,
  );
  const body2 = await page.textContent("body");
  check(
    "the on-the-clock pane names a franchise and shows its roster",
    /On the clock|You are up/.test(body2),
  );
  check(
    "the pane prints every position, so an empty QB row is visible",
    /\bQB\b/.test(body2) && /\bDST\b/.test(body2),
  );
  await shot(page, "mock-01-bots-drafting");

  section("Bot personalities are labelled and swappable");
  check(
    "archetype names appear under the franchises",
    /Balanced|Value hunter|Zero RB|Robust RB|Hero RB|Early QB|Streamer/.test(body2),
  );
  // Open one bot's picker and switch it, which is the "click the bot label" flow.
  const zeroRbLabels = page.locator("button", { hasText: /^Zero RB$/ });
  const zeroRbBefore = await zeroRbLabels.count();
  if (zeroRbBefore > 0) {
    await zeroRbLabels.first().click();
    await page.waitForTimeout(350);
    await shot(page, "mock-02-bot-picker");
    const menu = await page.textContent("body");
    check(
      "the picker explains what each personality does",
      menu.includes("Will not touch a running back") || menu.includes("takes whoever has fallen"),
    );
    /*
     * Match the option by its blurb, not by `/^Robust RB$/`. A franchise's label
     * button holds the archetype name and nothing else, while a menu option holds
     * the name *and* the blurb — so an anchored match on the name alone selects
     * the label of whichever franchise is already Robust RB, and clicking that
     * just opens a second picker. That is what this step did while its result was
     * hardcoded to pass: the swap it claimed to prove was never once performed.
     */
    await page
      .locator("button", { hasText: "Backs up the truck on running backs early" })
      .first()
      .click();
    await page.waitForTimeout(400);
    const zeroRbAfter = await zeroRbLabels.count();
    check(
      "a personality can be swapped from the UI",
      zeroRbAfter === zeroRbBefore - 1,
      `${zeroRbBefore} → ${zeroRbAfter} franchise(s) labelled Zero RB`,
    );
  } else {
    check("a bot label was available to click", false);
  }

  section("Entering your own pick, the Saturday way");
  // Wait for the clock to reach the controlled franchise.
  let yourTurn = false;
  for (let i = 0; i < 60; i++) {
    const t = await page.textContent("body");
    if (t.includes("YOU ARE UP")) {
      yourTurn = true;
      break;
    }
    await page.waitForTimeout(400);
  }
  check("the clock reached your franchise", yourTurn);

  if (yourTurn) {
    const before = await boardCounts(page);
    // A misspelling, to prove the mock shares the live board's name matcher.
    await typeAtDocument(page, "mccaffery");
    await page.waitForTimeout(250);
    const typed = await page.textContent("body");
    const matched = typed.includes("Christian McCaffrey");
    /*
     * Not a check: by the time the clock comes round a bot may legitimately have
     * taken him, and both outcomes are proven below — the match path asserts the
     * pick landed, the other asserts the duplicate warning fires. Stating it as a
     * check that was hardcoded to pass only made the run's tally look bigger.
     */
    console.log(`  · "mccaffery" ${matched ? "surfaced Christian McCaffrey" : "found him already drafted"}`);
    await shot(page, "mock-03-typing");

    if (matched) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(500);
      const after = await boardCounts(page);
      check(
        "Enter entered the pick with no mouse involved",
        after.filled > before.filled,
        `${before.filled} → ${after.filled}`,
      );
      const flashed = await page.textContent("body");
      check("the pick was announced to the room", flashed.includes("MCCAFFREY") || flashed.includes("McCaffrey"));
    } else {
      // He was already drafted by a bot, so prove the duplicate moment instead.
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      const warn = await page.textContent("body");
      check("the duplicate moment fired and calls the forfeit", warn.includes("already drafted"));
      check("…and it says it is a shot, not a validation error", /that\u2019s a shot|that's a shot/i.test(warn));
      await shot(page, "mock-03b-duplicate-shot");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(200);
    }
  }

  section("Board / Rosters toggle");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(600);
  const rosterBody = await page.textContent("body");
  check("Tab switched to the rosters view", rosterBody.includes("Bench"));
  /*
   * Matched on the roster head's whole title shape — `HANDLE — Franchise ·
   * Manager` — and asserted at exactly ten. A bare `·` test also caught the
   * keeper-clock legend, so eleven elements matched and `>= 10` kept passing
   * with a franchise column missing.
   */
  const heads = await page.evaluate(
    () =>
      [...document.querySelectorAll("[title]")].filter((e) =>
        / — .+ · /.test(e.getAttribute("title") ?? ""),
      ).length,
  );
  check("all ten franchises are on one screen", heads === 10, `${heads} roster heads`);
  const fits = await page.evaluate(() => {
    const main = document.querySelector("main");
    return main ? main.scrollHeight <= main.clientHeight + 4 : false;
  });
  check("the roster wall fits one 1080p screen without scrolling", fits);
  await shot(page, "mock-04-roster-wall");

  await page.keyboard.press("Tab");
  await page.waitForTimeout(500);
  check(
    "Tab switched back to the board",
    (await page.textContent("body")).includes("RD 1"),
  );

  /*
   * The recovery half of the start gate. "New mock" throws a board away, so the
   * repo's rule is that it has to be takeable back rather than guarded by a
   * confirmation — this asserts the mock is still there afterwards.
   */
  section("New mock hands the board back rather than binning it");
  const beforePark = await boardCounts(page);
  await page.getByTitle(/^Back to setup/).click();
  await page.waitForTimeout(400);
  const parkedBody = await page.textContent("body");
  check("it goes back to the setup screen", parkedBody.includes("Set the board"));
  check(
    "and offers the mock in progress back, with where it stopped",
    parkedBody.includes("Mock in progress") && /Round \d+, pick \d+\.\d+/.test(parkedBody),
  );
  await shot(page, "mock-04b-parked-mock");
  await page.getByTitle("Pick the mock up where it stopped").click();
  await page.waitForTimeout(700);
  const resumedCounts = await boardCounts(page);
  check(
    "resuming returns to that board, not a fresh one",
    resumedCounts.filled >= beforePark.filled,
    `${beforePark.filled} filled before, ${resumedCounts.filled} after`,
  );

  section("Finishing the whole draft");
  await page.getByTitle("Autopick every remaining pick at once").click();
  await page.waitForTimeout(1500);

  /*
   * Counted off the ROSTERS view, which is where finishing lands. Ten columns of
   * sixteen filled slots is the same fact as "160 cells filled" and is the more
   * useful one: it says every franchise ended with a full, legal roster.
   */
  const rosterFill = await page.evaluate(() => {
    const open = [...document.querySelectorAll("main div")].filter(
      (d) => d.textContent?.trim() === "open",
    ).length;
    const players = [...document.querySelectorAll("main [title]")].filter((d) =>
      /— (QB|RB|WR|TE|DST),/.test(d.getAttribute("title") ?? ""),
    ).length;
    return { open, players };
  });
  check(
    "all ten rosters are completely full — 160 players, no open slot",
    rosterFill.players === 160 && rosterFill.open === 0,
    `players ${rosterFill.players}, open slots ${rosterFill.open}`,
  );

  const endBody = await page.textContent("body");
  check("the mock declares itself finished", endBody.includes("THAT'S THE MOCK") || endBody.includes("THAT’S THE MOCK"));
  check("it lands on the rosters view so the result is readable", endBody.includes("Bench"));
  const finishedFits = await page.evaluate(() => {
    const main = document.querySelector("main");
    return main ? main.scrollHeight <= main.clientHeight + 4 : false;
  });
  check("the finished roster wall still fits one screen", finishedFits);
  await shot(page, "mock-05-finished-rosters");

  section("It never talked to the live draft");
  const liveApi = requests.filter((r) => /\/api\/draft\//.test(r));
  check(
    "not one request went to /api/draft/*",
    liveApi.length === 0,
    liveApi.slice(0, 3).join(" | "),
  );
  const mockApi = requests.filter((r) => /\/api\/mock-draft\//.test(r));
  console.log(`    (${mockApi.length} requests to /api/mock-draft/state, which is the mock's own file)`);
  const offsite = [...new Set(requests)].filter(
    (r) => !r.includes(BASE) && !r.includes("data:") && !r.includes("blob:"),
  );
  /*
   * ONE EXCEPTION, NAMED RATHER THAN WAIVED — the same allowance, for the same
   * reason, as `verify-draft-typing.mjs`. The mock announces a pick with the
   * same band the live board uses, so it asks FantasyPros' CDN for a headshot
   * and asks for nothing else off this machine. The list below is the whole
   * allowance, so any other host appearing still fails, and in particular the
   * claim this check exists for — that the bots are local and no LLM is
   * involved — is unchanged.
   */
  const ALLOWED_OFFSITE = ["https://images.fantasypros.com/"];
  // Entries here are `${method} ${url}`, not bare URLs, so this matches on
  // containment the way the `offsite` filter above already does.
  const unexpected = offsite.filter((r) => !ALLOWED_OFFSITE.some((a) => r.includes(a)));
  check(
    "it asked for nothing off this machine but player headshots — no LLM, no network dependency",
    unexpected.length === 0,
    unexpected.slice(0, 3).join(" | "),
  );

  section("The live draft board is untouched");
  const liveAfter = sha();
  if (concurrentWriter) {
    console.log(
      "  – whole-session digest comparison SKIPPED: another process was already " +
        "writing data/draft-state-2026.json before this mock started.",
    );
    console.log(
      "    The causal check above stands on its own: this page never asked the " +
        "live draft API to do anything, so it cannot have caused a write.",
    );
    console.log(
      `    (for the record: ${liveBefore.slice(0, 12)}… → ${liveAfter.slice(0, 12)}…)`,
    );
  } else {
    check(
      "sha256 of data/draft-state-2026.json is unchanged by the whole session",
      liveAfter === liveBefore,
      `${liveBefore.slice(0, 12)}… → ${liveAfter.slice(0, 12)}…`,
    );
  }

  section("Console health");
  const other = consoleProblems.filter(
    (m) =>
      !m.includes("nativeButton") &&
      !m.includes("Download the React DevTools") &&
      !m.includes("Failed to load resource"),
  );
  check("no console errors or warnings", other.length === 0, other.slice(0, 3).join(" | "));

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);

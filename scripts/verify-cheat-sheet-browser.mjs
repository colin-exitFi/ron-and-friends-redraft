/**
 * The cheat sheet, in a phone, while a pick is entered somewhere else.
 *
 *   BASE=http://127.0.0.1:3131 npm run verify:cheat-sheet:browser
 *
 * ============================================================================
 * THE ONE CLAIM WORTH PROVING
 * ============================================================================
 * The commissioner's requirement for this page was a single sentence: somebody
 * on his phone has to see the pool stay current with what has actually been
 * drafted, without touching anything. Everything else about the page — the
 * sorting, the league-scored projections — is worth nothing if it is showing a
 * player who went four minutes ago, because a manager will plan around him.
 *
 * `verify:cheat-sheet` proves the arithmetic and the filtering as pure
 * functions. It cannot prove this. This can, and only this way: enter a pick
 * through the API, the way the person at the table will, and watch the row
 * leave a real browser that nobody touched.
 *
 * It also asserts the thing a naive implementation gets wrong. Calling
 * `router.refresh()` on every pick would pass a propagation test and would
 * throw away whatever the manager was halfway through typing — during a draft,
 * constantly. So the search box is left holding a half-typed name while the
 * pick lands, and it has to still be there afterwards.
 *
 * RUN AGAINST A PRODUCTION BUILD with DRAFT_STORE=database:
 *
 *   NEXT_DIST_DIR=.next-verify npm run build
 *   DRAFT_STORE=database NEXT_DIST_DIR=.next-verify \
 *     node --env-file=.env.local ./node_modules/.bin/next start -p 3131
 *
 * Not `next dev` — HMR navigates the page on its own, which breaks the "nobody
 * touched it" claim outright. Not the file store, which is one process's disk
 * with nothing to synchronise and no channel to subscribe to.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 * `DRAFT_STORE=database` means the real `draft_live_state` row for the real
 * season — the same one the deployment reads. There is no test season to hide
 * in. So, the same discipline `verify-draft-two-clients.mjs` uses:
 *
 *   1. It REFUSES TO RUN if the board has any entered pick on it. That covers
 *      both "the draft has started" and "another harness is mid-run".
 *   2. Its own pick is cleared by slot id on every exit path, and the board is
 *      re-read afterwards to confirm it went back to empty rather than assumed.
 *
 * Clearing one named slot rather than calling undo, because undo unwinds the
 * most recently entered pick — which is only this script's pick if nothing else
 * wrote in between, and "probably nothing else wrote" is not good enough for a
 * cleanup step that runs against the live board.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3131";
const OUT = path.join(process.cwd(), "screenshots");
/** A phone, because that is where the two managers this page is for will be. */
const PHONE = { width: 390, height: 844 };
/** Generous: a websocket round trip plus a fetch on a cold serverless route. */
const PROPAGATION_MS = 25_000;

mkdirSync(OUT, { recursive: true });

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

const api = async (route, init) => {
  const res = await fetch(`${BASE}${route}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let placedSlotId = null;

async function restore() {
  if (!placedSlotId) return;
  const { body } = await api("/api/draft/undo", {
    method: "POST",
    body: JSON.stringify({ slotId: placedSlotId }),
  });
  const after = await api("/api/draft/state");
  const picks = after.body?.view?.picksMade ?? -1;
  check(
    "the board was put back exactly as it was found",
    body?.ok === true && picks === 0,
    `picksMade ${picks}`,
  );
  placedSlotId = null;
}

const run = async () => {
  section("0. The board this is about to borrow");

  const state = await api("/api/draft/state");
  if (state.body?.ok !== true) {
    console.log(`\n  Cannot read ${BASE}/api/draft/state — is the server up?\n`);
    process.exit(1);
  }
  const view = state.body.view;
  console.log(`  · ${BASE}`);
  console.log(`  · ${view.picksMade} picks entered, ${view.filled} slots filled`);

  if (view.picksMade > 0) {
    console.log(
      `\n  REFUSING TO RUN. The board has ${view.picksMade} entered pick(s) on it.\n` +
        `  This script enters one of its own and clears it again, which is safe on an\n` +
        `  empty board and is not something to do to a draft in progress — or on top of\n` +
        `  another harness that is mid-run. Nothing has been written.\n`,
    );
    process.exit(1);
  }
  check("the board is empty, so borrowing it is safe", view.picksMade === 0);

  const slot = view.slots.find((s) => !s.player);
  check("there is an empty slot to draft into", Boolean(slot), "board is full");
  if (!slot) return;

  const browser = await chromium.launch();
  /*
   * `hasTouch` matters and is not decoration. The app sizes its controls with
   * Tailwind `touch:` variants, which resolve through a pointer media query —
   * so a desktop Chromium at phone dimensions renders 16px tap targets and
   * looks like a bug that does not exist on a phone. Emulating touch is what
   * makes the tap-target assertion below mean anything.
   */
  const page = await browser.newPage({
    viewport: PHONE,
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });

  /*
   * Every main-frame navigation after the initial load. A `router.refresh()`
   * does not show up here, so this is not the whole keystroke story — but a
   * full page load absolutely would, and that is worth catching on its own.
   */
  let navigations = -1;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });

  try {
    section("1. The page on a phone");

    await page.goto(`${BASE}/players`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-player-id]");

    const rowCount = await page.locator("[data-player-id]").count();
    check("the pool renders", rowCount > 50, `${rowCount} rows`);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    check(
      "nothing runs off the side of a 390px screen",
      overflow <= 1,
      `${overflow}px of horizontal overflow`,
    );

    for (const label of ["Available", "All", "Gone"]) {
      check(
        `the “${label}” filter is reachable`,
        await page.getByRole("button", { name: label, exact: true }).isVisible(),
      );
    }
    check(
      "the projection column is sortable",
      await page.getByRole("button", { name: "Proj", exact: true }).isVisible(),
    );

    // Tap targets. The league's own `touch:` utilities put these at 44px; a
    // control that is technically present and too small to hit is not present.
    const smallest = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")].filter(
        (b) => b.offsetParent !== null,
      );
      return Math.min(...buttons.map((b) => b.getBoundingClientRect().height));
    });
    check("every visible control is at least 40px tall", smallest >= 40, `${smallest}px`);

    await page.screenshot({ path: path.join(OUT, "cheat-sheet-phone.png") });

    section("2. The live indicator tells the truth");

    const liveText = await page
      .locator("text=/Live —|Syncing slowly|Connecting|saving to this machine/")
      .first()
      .innerText();
    console.log(`  · “${liveText.trim()}”`);
    check(
      "the page claims a live connection, because saves are shared here",
      /Live —|Syncing slowly|Connecting/.test(liveText),
      "it thinks the store is a local file — is DRAFT_STORE=database set?",
    );
    // Give the channel a moment to actually subscribe.
    await page
      .locator("text=/Live —/")
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => {});
    const settled = await page
      .locator("text=/Live —|Syncing slowly|Connecting/")
      .first()
      .innerText();
    check(
      "the realtime channel subscribes against the redraft schema",
      /Live —/.test(settled),
      `settled on “${settled.trim()}” — a subscription that never opens falls back to polling`,
    );

    section("3. A pick entered elsewhere reaches the phone, untouched");

    // The player at the top of the sheet, who is definitely on screen.
    const target = page.locator("[data-player-id]").first();
    const targetId = await target.getAttribute("data-player-id");
    const targetName = (await target.locator("td").nth(1).innerText()).split("\n")[0];
    console.log(`  · target: ${targetName} (${targetId})`);

    /*
     * A half-typed name left in the search box. This is the part a
     * `router.refresh()` implementation loses, and it is left deliberately
     * incomplete — the state that only exists in the browser.
     */
    const search = page.getByPlaceholder("Search players…");
    const halfTyped = targetName.slice(0, 4);
    await search.click();
    await search.type(halfTyped, { delay: 30 });
    await page.waitForTimeout(300);
    check(
      "the search box narrows the sheet as it is typed into",
      (await page.locator("[data-player-id]").count()) < rowCount,
    );

    const navigationsBefore = navigations;

    // The pick, entered the way the person at the table enters it — through the
    // API, from outside this browser entirely.
    const pick = await api("/api/draft/pick", {
      method: "POST",
      body: JSON.stringify({ slotId: slot.id, playerId: targetId, override: true }),
    });
    check(
      `a pick of ${targetName} into ${slot.label} was accepted`,
      pick.body?.ok === true,
      JSON.stringify(pick.body?.error ?? pick.status),
    );
    if (pick.body?.ok !== true) return;
    placedSlotId = slot.id;

    // NOTHING IS CLICKED HERE. This is the whole test: the row has to go on its
    // own, off the realtime channel, with the browser sitting idle.
    const vanished = await page
      .locator(`[data-player-id="${targetId}"]`)
      .waitFor({ state: "detached", timeout: PROPAGATION_MS })
      .then(() => true)
      .catch(() => false);
    check(
      "the drafted player leaves the available list with nobody touching the phone",
      vanished,
      `still listed after ${PROPAGATION_MS / 1000}s`,
    );

    check(
      "…and the page never navigated to find that out",
      navigations === navigationsBefore,
      `${navigations - navigationsBefore} navigation(s)`,
    );

    check(
      "…and the half-typed search survived the pick",
      (await search.inputValue()) === halfTyped,
      `expected “${halfTyped}”, found “${await search.inputValue()}”`,
    );

    const stamp = await page.locator("text=/Updated /").first().isVisible();
    check("…and the page says when it last heard from the board", stamp);

    await page.screenshot({ path: path.join(OUT, "cheat-sheet-after-pick.png") });

    section("4. He is not hidden, he is struck through");

    await search.fill("");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.waitForTimeout(400);

    const row = page.locator(`[data-player-id="${targetId}"]`);
    check("“All” shows him again", (await row.count()) === 1);
    check(
      "…marked as taken",
      (await row.getAttribute("data-taken")) === "true",
      "the row is not flagged drafted",
    );
    const struck = await row
      .locator("td")
      .nth(1)
      .evaluate((td) => {
        const span = td.querySelector("span");
        return span ? getComputedStyle(span).textDecorationLine : "";
      });
    check("…with a line through his name", struck.includes("line-through"), struck);

    await page.getByRole("button", { name: "Gone", exact: true }).click();
    await page.waitForTimeout(400);
    check(
      "“Gone” lists exactly the one pick that has been made",
      (await page.locator("[data-player-id]").count()) === 1,
    );

    await page.screenshot({ path: path.join(OUT, "cheat-sheet-gone.png") });

    section("5. Undo reaches the phone too");

    const cleared = await api("/api/draft/undo", {
      method: "POST",
      body: JSON.stringify({ slotId: placedSlotId }),
    });
    check("the pick was taken back", cleared.body?.ok === true);
    if (cleared.body?.ok === true) placedSlotId = null;

    /*
     * Still on the "Gone" filter, which should empty itself. Waited for
     * properly rather than sampled: the undo has to cross the same websocket
     * the pick did, and reading the count straight away only ever proves that
     * a round trip takes longer than nothing.
     */
    const emptied = await page
      .locator("[data-player-id]")
      .first()
      .waitFor({ state: "detached", timeout: PROPAGATION_MS })
      .then(() => true)
      .catch(() => false);
    check(
      "an undone pick puts the player back, live",
      emptied && (await page.locator("[data-player-id]").count()) === 0,
      `“Gone” still lists ${await page.locator("[data-player-id]").count()}`,
    );
  } finally {
    await restore();
    await browser.close();
  }
};

run()
  .catch(async (err) => {
    failures++;
    console.error(`\n  ✗ threw: ${err?.message ?? err}`);
    await restore().catch(() => {});
  })
  .finally(() => {
    console.log(
      `\n  ${failures === 0 ? "All checks passed. The sheet stays current on its own." : `${failures} failed.`}\n`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });

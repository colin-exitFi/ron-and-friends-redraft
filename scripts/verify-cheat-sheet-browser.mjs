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

    /*
     * ========================================================================
     * 1b. THE SPREADSHEET: IT SCROLLS SIDEWAYS AND THE NAME STAYS PUT
     * ========================================================================
     * The commissioner asked for "a spreadsheet you can scroll left and right"
     * and got, first time round, a tap-to-expand panel showing the scoring
     * arithmetic. He did not want the arithmetic. This section is what replaced
     * it, and it asserts the two things that separate a spreadsheet from a table
     * that is merely too wide:
     *
     *   1. THE IDENTITY COLUMN IS FROZEN. This is the whole feature. A column of
     *      numbers whose player name has scrolled off the left edge is worse
     *      than no columns at all, because it is confidently wrong — you read
     *      the wrong man's receptions. So the name cell's screen position is
     *      measured before and after a full-width scroll and has to be the same.
     *   2. THE LAST COLUMN IS REACHABLE AND WHOLE. "Scrolls sideways" is not
     *      worth anything if the rightmost column stops half off the edge, so
     *      the scroll is driven to its maximum and the final heading has to sit
     *      entirely inside the box.
     *
     * It also asserts the panel is GONE rather than merely unused, since a
     * leftover expander would be the thing he objected to still shipping.
     */
    section("1b. The spreadsheet scrolls sideways with the name pinned");

    {
      const sheet = page.locator("[data-sheet-scroll]");
      check("the table lives in a scroll region", (await sheet.count()) === 1);

      const before = await sheet.evaluate((el) => ({
        scrollLeft: el.scrollLeft,
        scrollable: el.scrollWidth - el.clientWidth,
        vertical: el.scrollHeight - el.clientHeight,
      }));
      check(
        "there is something to the right to scroll to",
        before.scrollable > 100,
        `only ${before.scrollable}px of horizontal travel`,
      );
      check(
        "…and it starts at the left, showing the identity and the two point columns",
        before.scrollLeft === 0,
      );

      // The panel he objected to. Asserted absent, not merely unopened.
      check(
        "the tap-to-expand arithmetic panel is gone",
        (await page.getByRole("button", { name: /stat breakdown/ }).count()) === 0 &&
          (await page.locator("[data-breakdown-for]").count()) === 0,
      );

      /*
       * EVERY ROW HAS EVERY COLUMN, which is what makes reading down a column
       * mean anything. Sampled across the pool rather than on one row, because
       * the failure this catches is a per-position variation and a quarterback
       * and a defence are hundreds of rows apart.
       */
      const shape = await page.evaluate(() => {
        const headings = document.querySelectorAll("thead th").length;
        const rows = [...document.querySelectorAll("[data-player-id]")];
        const counts = new Set(
          rows.map((tr) => tr.querySelectorAll(":scope > td").length),
        );
        return { headings, counts: [...counts], rows: rows.length };
      });
      check(
        `every one of the ${shape.rows} rows has the same ${shape.headings} cells`,
        shape.counts.length === 1 && shape.counts[0] === shape.headings,
        `cell counts seen: ${shape.counts.join(", ")} against ${shape.headings} headings`,
      );

      // Lower-cased for comparison: the headings are typeset in small caps with
      // `uppercase`, so `innerText` reports "PASS YD" for a cell whose markup
      // says "Pass yd". The assertion is about the column existing, not its case.
      const headings = (await page.locator("thead th").allInnerTexts()).map((h) =>
        h.trim(),
      );
      const has = (label) =>
        headings.some((h) => h.toLowerCase() === label.toLowerCase());
      console.log(`  · columns: ${headings.join(" | ")}`);
      for (const label of [
        "2025",
        "Proj",
        "Pass yd",
        "Pass TD",
        "Rush yd",
        "Rush TD",
        "Rec",
        "Rec yd",
        "Rec TD",
        "Fum",
      ]) {
        check(`the “${label}” column exists`, has(label));
      }

      // The two figures people decide on, immediately right of the frozen block
      // so they are readable without swiping at all.
      check(
        "2025 and Proj are the first two numeric columns",
        headings[1] === "2025" && headings[2].toLowerCase() === "proj",
        `${headings[1]}, ${headings[2]}`,
      );

      /*
       * THE FROZEN COLUMN, MEASURED. A row from the middle of what is on screen,
       * so the sticky `<thead>` is not sitting on top of the thing being read.
       */
      const nameCell = page.locator("[data-player-id]").nth(3).locator("[data-name-cell]");
      const nameBefore = await nameCell.boundingBox();
      const whose = await page
        .locator("[data-player-id]")
        .nth(3)
        .getAttribute("data-player-name");

      // All the way right, as a thumb would drag it.
      await sheet.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await page.waitForTimeout(300);
      const after = await sheet.evaluate((el) => ({
        scrollLeft: el.scrollLeft,
        clientRight: el.getBoundingClientRect().right,
      }));
      check(
        "the table really scrolled sideways",
        after.scrollLeft > 100,
        `scrollLeft ${after.scrollLeft}`,
      );

      const nameAfter = await nameCell.boundingBox();
      check(
        `${whose}'s name is still pinned to the left edge after scrolling`,
        Math.abs((nameAfter?.x ?? -999) - (nameBefore?.x ?? 999)) <= 1,
        `moved from x=${Math.round(nameBefore?.x ?? -1)} to x=${Math.round(nameAfter?.x ?? -1)}`,
      );
      check(
        "…and is still legible rather than a sliver",
        (nameAfter?.width ?? 0) >= 100,
        `${Math.round(nameAfter?.width ?? 0)}px wide`,
      );
      check(
        "…and the position badge went with it",
        await page
          .locator("[data-player-id]")
          .nth(3)
          .locator("[data-position-badge]")
          .isVisible(),
      );
      /*
       * NOT PAINTED OVER BY THE NUMBERS SLIDING UNDER IT. A sticky cell with a
       * translucent background shows the digits through the name, which looks
       * like a rendering fault and is the most likely way this goes wrong.
       */
      const opaque = await nameCell.evaluate((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        const alpha = bg.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/);
        return { bg, alpha: alpha ? parseFloat(alpha[1]) : 1 };
      });
      check(
        "…on an opaque fill, so the scrolling numbers do not show through it",
        opaque.alpha >= 0.99,
        opaque.bg,
      );

      // The far end of the sheet, whole. `boundingBox()` reports x/y/width/height
      // and no `right`, so the edge is computed rather than read.
      const last = await page.locator("thead th").last().boundingBox();
      const lastRight = last ? last.x + last.width : Infinity;
      const lastLabel = (await page.locator("thead th").last().innerText()).trim();
      check(
        `the last column (“${lastLabel}”) is fully inside the box at the end of the scroll`,
        lastRight <= after.clientRight + 1,
        `its right edge is at ${Math.round(lastRight)}, the box ends at ${Math.round(after.clientRight)}`,
      );
      check(
        "…and nothing runs off the side of the PAGE, only inside the table",
        (await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        )) <= 1,
      );

      /*
       * VERTICAL SCROLLING, STILL, WITH THE TABLE DRAGGED SIDEWAYS. A horizontal
       * scroll region that swallows an upward fling is miserable on a phone and
       * is a real failure mode of `overflow: auto` boxes with touch handlers.
       */
      const vBefore = await sheet.evaluate((el) => el.scrollTop);
      await sheet.evaluate((el) => {
        el.scrollTop = 400;
      });
      await page.waitForTimeout(200);
      const vAfter = await sheet.evaluate((el) => el.scrollTop);
      check(
        "the sheet still scrolls vertically while scrolled sideways",
        vAfter > vBefore,
        `scrollTop ${vBefore} → ${vAfter}`,
      );
      check(
        "…and the frozen column is still frozen after a vertical scroll",
        Math.abs(
          ((await page
            .locator("[data-player-id]")
            .nth(3)
            .locator("[data-name-cell]")
            .boundingBox()) ?? { x: -999 }
          ).x - (nameBefore?.x ?? 999),
        ) <= 1,
      );

      // Scrolled to the grid itself, since a shot of the page header proves
      // nothing about the thing this section is about.
      await sheet.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, "cheat-sheet-sheet-scrolled.png") });

      /*
       * IT READS LIKE A SPREADSHEET: right-aligned, tabular figures, and a
       * consistent number of decimal places down each column. The decimals are
       * checked by column rather than by cell, because "13.2 above 9" in the
       * same column is exactly what makes a grid of numbers unreadable.
       */
      const numeric = await page.evaluate(() => {
        const rows = [...document.querySelectorAll("[data-player-id]")].slice(0, 60);
        const byColumn = new Map();
        let notRight = 0;
        let notTabular = 0;
        for (const tr of rows) {
          const cells = [...tr.querySelectorAll(":scope > td")];
          for (let i = 2; i < cells.length; i++) {
            const style = getComputedStyle(cells[i]);
            if (style.textAlign !== "right") notRight++;
            if (!style.fontVariantNumeric.includes("tabular-nums")) notTabular++;
            const text = cells[i].textContent.trim().split("\n")[0];
            const m = text.match(/^-?[\d,]+(\.(\d+))?$/);
            if (!m) continue;
            if (!byColumn.has(i)) byColumn.set(i, new Set());
            byColumn.get(i).add(m[2]?.length ?? 0);
          }
        }
        return {
          notRight,
          notTabular,
          mixed: [...byColumn.entries()]
            .filter(([, places]) => places.size > 1)
            .map(([i, places]) => `column ${i}: ${[...places].join("/")}`),
        };
      });
      check(
        "every numeric cell is right-aligned",
        numeric.notRight === 0,
        `${numeric.notRight} cells are not`,
      );
      check(
        "…in tabular figures, so the digits line up down the column",
        numeric.notTabular === 0,
        `${numeric.notTabular} cells are not`,
      );
      check(
        "…to the same number of decimal places within each column",
        numeric.mixed.length === 0,
        numeric.mixed.join("; "),
      );

      // A missing stat has to look deliberate. An em dash does; an empty cell
      // reads as a bug and makes a manager distrust the row it is on.
      const blanks = await page.evaluate(() => {
        const cells = [
          ...document.querySelectorAll("[data-player-id] > td"),
        ].slice(0, 600);
        return {
          dashes: cells.filter((c) => c.textContent.includes("—")).length,
          empty: cells.filter((c) => c.textContent.trim() === "").length,
        };
      });
      check(
        "a missing number is an em dash rather than an empty cell",
        blanks.dashes > 0 && blanks.empty === 0,
        `${blanks.dashes} dashes, ${blanks.empty} truly empty`,
      );

      /*
       * THE PROVENANCE LINE, AND THE ABSENCE OF THE THINGS IT REPLACED.
       *
       * A "Refresh from FantasyPros" button advertised a capability the
       * deployment does not have, and its failure message was red text sitting
       * directly above a set of numbers that had just been audited clean. On a
       * phone, in a live draft, that reads as "do not trust this page". So the
       * button's absence is asserted, and so is the absence of ANY red text
       * above the table — a warning nobody put back on purpose is exactly the
       * kind of thing that creeps back in.
       */
      check(
        "the broken “Refresh from FantasyPros” button is gone",
        (await page.getByRole("button", { name: /Refresh from FantasyPros/i }).count()) ===
          0,
      );
      check(
        "…and so is the red “could not be reached” warning",
        (await page.locator("text=/could not be reached/i").count()) === 0,
      );
      const alarming = await page.evaluate(() => {
        const table = document.querySelector("table");
        const nodes = [...document.querySelectorAll("main *, body > div *")].filter(
          (el) =>
            el.children.length === 0 &&
            el.textContent.trim() &&
            table &&
            table.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING,
        );
        // The league's warning hue, as the token resolves at runtime.
        return nodes
          .map((el) => getComputedStyle(el).color)
          .filter((c) => {
            const m = c.match(/\d+/g);
            if (!m) return false;
            const [r, g, b] = m.map(Number);
            return r > 150 && g < 110 && b < 110;
          }).length;
      });
      check(
        "…and nothing above the table is coloured like an error at all",
        alarming === 0,
        `${alarming} red text node(s) above the sheet`,
      );

      /*
       * THE PROVENANCE LINE, AND THE FACT THAT IT IS STILL A LINE.
       *
       * Three facts, in the commissioner's own order — whose ranking, when it
       * was pulled, what the points are scored in — as ONE row above the sort
       * controls. It reached him as two statements instead: this summary, plus a
       * six-line paragraph between the controls and the first player repeating
       * all three at length. "All the sorting capabilities are basically above
       * this massive block of text."
       *
       * So the length is asserted, not just the content. Every fact below is
       * worth stating and each one is an invitation to add the sentence that
       * explains it, which is precisely how the paragraph grew the first time.
       * The budget is what the three facts cost plus room for a longer date —
       * comfortably under the four lines this wrapped to on a 390px screen.
       */
      // Scoped by the timestamp it carries rather than by being the first
      // `<summary>`, so it keeps pointing at the provenance if the page ever
      // grows a second disclosure.
      const summary = page.locator("summary:has([data-rankings-updated])").first();
      const provenance = (await summary.innerText()).replace(/\s+/g, " ").trim();
      console.log(`  · “${provenance}” (${provenance.length} chars)`);
      check(
        "the provenance names FantasyPros' consensus ranking",
        /FantasyPros ECR/.test(provenance),
        provenance,
      );
      check(
        "…and when it was pulled",
        /\w+ \d+, \d+:\d\d/.test(provenance),
        provenance,
      );
      check(
        "…and that the points are this league's, tight end premium included",
        /TE premium|tight end/i.test(provenance),
        provenance,
      );
      check(
        "…in one line and not a paragraph",
        provenance.length <= 80,
        `${provenance.length} chars: “${provenance}”`,
      );
      check(
        "the second, longer copy of it above the first player is gone",
        (await page.locator("text=/is scored to Ron and Friends/").count()) === 0,
      );
      /*
       * THE SCROLL CUE IS A FADE, NOT A SENTENCE, and that is deliberate. There
       * was instructional copy across the top of the table telling people to
       * scroll and naming what stayed pinned; the commissioner asked for it off
       * — "you don't need to call out rank, name, and position stay put" — so
       * the affordance is the last column reading as continuing off-screen.
       * Asserted as present and as NOT eating the drag it exists to invite,
       * because a `pointer-events: auto` overlay across the right edge would
       * swallow every swipe that started there.
       */
      // At the left, where there IS something off-screen, the cue is drawn.
      await sheet.evaluate((el) => {
        el.scrollLeft = 0;
      });
      await page.waitForTimeout(250);
      const cue = await page.locator("[data-scroll-cue]").evaluate((el) => ({
        events: getComputedStyle(el).pointerEvents,
        image: getComputedStyle(el).backgroundImage,
        width: el.getBoundingClientRect().width,
      }));
      check(
        "the right edge fades, so the row reads as continuing off-screen",
        cue.width > 0 && cue.width <= 24 && cue.image.includes("gradient"),
        `${Math.round(cue.width)}px, ${cue.image.slice(0, 40)}`,
      );
      check(
        "…and it is narrow enough to feather an edge rather than wash a column",
        cue.width <= 24,
        `${Math.round(cue.width)}px`,
      );
      check(
        "…and the cue does not swallow the swipe it invites",
        cue.events === "none",
        cue.events,
      );

      /*
       * ========================================================================
       * AND IT IS GONE AT THE RIGHT-HAND END, WHERE IT WAS HIDING THE BYE WEEK
       * ========================================================================
       * The fade used to be drawn unconditionally, which put a translucent wash
       * over the last column — the bye week, which is the rightmost column and
       * one people read at the table. The commissioner's report was that he "can't
       * see their bye week because you're trying to show people they can scroll".
       *
       * An affordance pointing at content it obscures is worse than no affordance,
       * so this asserts the cue is ABSENT once there is nothing further to reveal,
       * and separately that a real bye value is sitting there unobstructed —
       * `elementFromPoint` at the centre of the cell has to hit the cell itself
       * and not an overlay.
       */
      await sheet.evaluate((el) => {
        el.scrollLeft = el.scrollWidth;
      });
      await page.waitForTimeout(300);
      check(
        "the fade is gone at the right-hand end, where nothing is left to reveal",
        (await page.locator("[data-scroll-cue]").count()) === 0,
        "it is still drawn over the last column",
      );

      const bye = await page.evaluate(() => {
        const box = document
          .querySelector("[data-sheet-scroll]")
          .getBoundingClientRect();
        const head =
          document.querySelector("thead").getBoundingClientRect().bottom;
        for (const tr of document.querySelectorAll("[data-player-id]")) {
          const cells = tr.querySelectorAll(":scope > td");
          const cell = cells[cells.length - 1];
          const text = cell.textContent.trim();
          if (!/^\d+$/.test(text)) continue;
          const r = cell.getBoundingClientRect();
          /*
           * A cell that is genuinely on screen: inside the scroll box, clear of
           * its sticky header, and inside the window. `elementFromPoint` is in
           * viewport coordinates and returns null outside it, which would read as
           * "covered by nothing" and pass for the wrong reason.
           */
          const onScreen =
            r.top >= Math.max(box.top, head, 0) &&
            r.bottom <= Math.min(box.bottom, window.innerHeight) &&
            r.width > 0;
          if (!onScreen) continue;
          const x = Math.round(r.left + r.width / 2);
          const y = Math.round(r.top + r.height / 2);
          const onTop = document.elementFromPoint(x, y);
          return {
            text,
            covered: onTop !== cell && !cell.contains(onTop),
            what: onTop
              ? `<${onTop.tagName.toLowerCase()}>${onTop.dataset?.scrollCue != null ? " — the scroll cue" : ""}`
              : "nothing",
          };
        }
        return null;
      });
      check(
        `the bye week (“${bye?.text}”) is not sitting under an overlay`,
        bye != null && !bye.covered,
        `the point at its centre hits ${bye?.what}`,
      );

      check(
        "no instructional copy was left across the top of the table",
        (await page.locator("text=/Scroll the table sideways/").count()) === 0 &&
          (await page.locator("text=/stay put/").count()) === 0,
      );

      /*
       * ========================================================================
       * THE TIMESTAMP IS IN THE LEAGUE'S TIMEZONE, NOT THE SERVER'S
       * ========================================================================
       * This page renders on a server running in UTC, and the provenance line was
       * printing the raw UTC clock — a 2:20 PM export shown to the league as
       * "7:20 pm". Checked against the instant itself rather than against a
       * pattern, because "some time is printed" is exactly what passed while the
       * page was five hours out.
       */
      const stamp = await page.locator("[data-rankings-updated]").first();
      const iso = await stamp.getAttribute("data-rankings-updated");
      const shown = (await stamp.innerText()).trim();
      const expected = `${new Date(iso).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Chicago",
      })} Central`;
      console.log(`  · ${iso} → “${shown}”`);
      check(
        `the rankings timestamp reads in Central time (“${expected}”)`,
        shown === expected,
        `the page says “${shown}”`,
      );
      check(
        "…and is not the server's UTC clock",
        shown !==
          `${new Date(iso).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            timeZone: "UTC",
          })} Central`,
        "it is printing UTC with a Central label, which is worse than no label",
      );

      // Sorting from a stat heading, which is what a spreadsheet does.
      await sheet.evaluate((el) => {
        el.scrollLeft = 0;
        el.scrollTop = 0;
      });
      await page.getByRole("button", { name: "Rec", exact: true }).click();
      await page.waitForTimeout(400);
      const byRec = await page.evaluate(() =>
        [...document.querySelectorAll("[data-player-id]")].slice(0, 40).map((tr) => {
          const cells = tr.querySelectorAll(":scope > td");
          const text = cells[cells.length - 7]?.textContent.trim() ?? "";
          return parseFloat(text.replace(/,/g, ""));
        }),
      );
      check(
        "tapping a stat heading sorts the pool by that column, biggest first",
        byRec.every((v, i) => i === 0 || byRec[i - 1] >= v),
        byRec.slice(0, 6).join(", "),
      );
      await page.getByRole("button", { name: "Rk", exact: true }).click();
      await page.waitForTimeout(300);
    }


    /*
     * ========================================================================
     * 1c. THE OTHER PHONES PEOPLE ACTUALLY HAVE
     * ========================================================================
     * 390×844 is a modern iPhone. A 375×667 is an SE, which is materially
     * narrower AND much shorter — the short viewport is what pushes the first
     * player below the fold, and this page has already lost that fight once.
     * Landscape is included because somebody will rotate the phone to read a
     * table, and the table's max-height is written in `dvh`.
     */
    section("1c. The narrow phone, the short phone, and landscape");

    for (const [label, viewport] of [
      ["iPhone SE portrait 375×667", { width: 375, height: 667 }],
      ["landscape 844×390", { width: 844, height: 390 }],
    ]) {
      const alt = await browser.newPage({
        viewport,
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      });
      try {
        await alt.goto(`${BASE}/players`, { waitUntil: "domcontentloaded" });
        await alt.waitForSelector("[data-player-id]");

        const wide = await alt.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        );
        check(`${label}: nothing overflows sideways`, wide <= 1, `${wide}px`);

        const rows = await alt.locator("[data-player-id]").count();
        check(`${label}: the pool renders`, rows > 50, `${rows} rows`);

        // The position filter is the thing these managers explicitly asked
        // for, so it has to be hittable at the narrowest width.
        const te = alt.getByRole("button", { name: "TE", exact: true });
        const teBox = await te.boundingBox();
        check(
          `${label}: the position filter is thumb-sized`,
          (teBox?.height ?? 0) >= 44 && (teBox?.width ?? 0) >= 40,
          `${Math.round(teBox?.width ?? 0)}×${Math.round(teBox?.height ?? 0)}`,
        );
        await te.tap();
        await alt.waitForTimeout(300);
        const filtered = await alt.locator("[data-player-id]").count();
        check(
          `${label}: tapping TE actually filters the list`,
          filtered > 0 && filtered < rows,
          `${filtered} of ${rows}`,
        );

        /*
         * THE FROZEN COLUMN, AT EVERY SIZE. Checked here as well as at 390×844
         * because the sticky offsets are written per breakpoint — the phone
         * layout uses a narrower rank column than the desktop one — so the two
         * numbers that have to agree are a DIFFERENT pair at each width, and
         * getting one pair right proves nothing about the other.
         */
        await alt.getByRole("button", { name: "All pos", exact: true }).tap();
        await alt.waitForTimeout(300);
        const sheet = alt.locator("[data-sheet-scroll]");
        const nameCell = alt.locator("[data-player-id]").nth(3).locator("[data-name-cell]");
        const wasAt = await nameCell.boundingBox();
        check(
          `${label}: the sheet has columns off to the right`,
          (await sheet.evaluate((el) => el.scrollWidth - el.clientWidth)) > 100,
        );
        await sheet.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
        });
        await alt.waitForTimeout(300);
        const nowAt = await nameCell.boundingBox();
        check(
          `${label}: the name stays pinned through a full sideways scroll`,
          Math.abs((nowAt?.x ?? -999) - (wasAt?.x ?? 999)) <= 1 &&
            (nowAt?.width ?? 0) >= 90,
          `x ${Math.round(wasAt?.x ?? -1)} → ${Math.round(nowAt?.x ?? -1)}, ${Math.round(nowAt?.width ?? 0)}px wide`,
        );
        const boxRight = await sheet.evaluate(
          (el) => el.getBoundingClientRect().right,
        );
        const lastColumn = await alt.locator("thead th").last().boundingBox();
        const columnRight = lastColumn
          ? lastColumn.x + lastColumn.width
          : Infinity;
        check(
          `${label}: the last column is fully readable at the end of the scroll`,
          columnRight <= boxRight + 1,
          `right edge ${Math.round(columnRight)} against a box ending at ${Math.round(boxRight)}`,
        );
        check(
          `${label}: …and still nothing overflows the page itself`,
          (await alt.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          )) <= 1,
        );

        await alt.screenshot({
          path: path.join(OUT, `cheat-sheet-${viewport.width}x${viewport.height}.png`),
        });
      } finally {
        await alt.close();
      }
    }

    /*
     * ========================================================================
     * 1d. FLEX — "SHOW ME EVERYONE I WOULD ACTUALLY CONSIDER"
     * ========================================================================
     * The commissioner's framing, and it is the right one: late in the draft he
     * does not know whether he wants a back, a receiver or a tight end, he wants
     * the best player available. So FLEX is not a sixth position filter, it is
     * the RB/WR/TE pool in one list.
     *
     * THE ORDER IS THE FEATURE, so it is what is asserted hardest. A combined
     * list in an arbitrary order is three lists stapled together and is worth
     * nothing under a clock; the sort has to run ACROSS the pool. Both sorts a
     * manager would use are checked — the league-scoped board order this page
     * defaults to, and projected points.
     *
     * AT 375×667, because the failure mode of adding a sixth button to a row
     * sized for five is that it runs off the side of the narrowest phone in the
     * league. The whole section runs there rather than at 390.
     */
    section("1d. FLEX: backs, receivers and tight ends in one ordered list");

    {
      const flex = await browser.newPage({
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 3,
        hasTouch: true,
        isMobile: true,
      });
      try {
        await flex.goto(`${BASE}/players`, { waitUntil: "domcontentloaded" });
        await flex.waitForSelector("[data-player-id]");

        /*
         * Every row as the page has it: id, position, league rank and projected
         * points, read off the DOM rather than off the library that produced it.
         * `verify:cheat-sheet` already proves the pure function; the only thing
         * worth proving in a browser is that what is ON SCREEN agrees with it.
         */
        const readRows = () =>
          flex.evaluate(() =>
            [...document.querySelectorAll("[data-player-id]")].map((tr) => {
              const cells = tr.querySelectorAll(":scope > td");
              const num = (i) => {
                const m = cells[i]?.textContent?.match(/-?\d[\d,]*\.?\d*/);
                return m ? parseFloat(m[0].replace(/,/g, "")) : null;
              };
              const rank = tr.getAttribute("data-league-rank");
              return {
                id: tr.getAttribute("data-player-id"),
                pos:
                  tr.querySelector("[data-position-badge]")?.getAttribute(
                    "data-position-badge",
                  ) ?? null,
                // Off the attribute: the rank shares its cell with the name and
                // the position badge now, so the first number in that cell is
                // not reliably the rank.
                rank: rank ? Number(rank) : null,
                proj: num(2),
              };
            }),
          );

        const everyone = await readRows();
        const expected = everyone.filter((r) => ["RB", "WR", "TE"].includes(r.pos));
        check(
          "the unfiltered sheet carries a position badge on every row",
          everyone.length > 50 && everyone.every((r) => r.pos),
          `${everyone.filter((r) => !r.pos).length} of ${everyone.length} rows with no badge`,
        );

        const flexButton = flex.getByRole("button", { name: "FLEX", exact: true });
        check("a FLEX filter is offered", await flexButton.isVisible());

        // The five it was added next to are still there, in their original
        // order. A new filter that displaced the muscle memory of the row would
        // cost more than it gave.
        const order = await flex.evaluate(() => {
          const labels = ["All pos", "QB", "RB", "WR", "TE", "DST", "FLEX"];
          return [...document.querySelectorAll("button")]
            .map((b) => b.textContent?.trim())
            .filter((t) => labels.includes(t));
        });
        check(
          "…alongside the original five, in their original order",
          order.join(",") === "All pos,QB,RB,WR,TE,DST,FLEX",
          order.join(",") || "(no filter row found)",
        );

        const box = await flexButton.boundingBox();
        check(
          "…as a thumb-sized target, like the others",
          (box?.height ?? 0) >= 44 && (box?.width ?? 0) >= 40,
          `${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)}`,
        );

        /*
         * THE ROW WITH SIX BUTTONS IN IT, ON A 375px SCREEN.
         *
         * Overflow of the page is checked elsewhere; this checks the filter row
         * ITSELF — that it wrapped rather than scrolled, and that every control
         * in it is inside the viewport. A button whose right edge is at 402px is
         * unreachable and the document-level check would not notice, because a
         * flex row can clip its own children without widening the page.
         */
        const row = await flexButton.evaluate((el) => {
          const parent = el.parentElement;
          const buttons = [...parent.querySelectorAll("button")];
          return {
            overflow: parent.scrollWidth - parent.clientWidth,
            widest: Math.max(...buttons.map((b) => b.getBoundingClientRect().right)),
            offLeft: Math.min(...buttons.map((b) => b.getBoundingClientRect().left)),
            lines: new Set(
              buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
            ).size,
            shortest: Math.min(
              ...buttons.map((b) => b.getBoundingClientRect().height),
            ),
          };
        });
        check(
          "the filter row wraps rather than overflowing at 375px",
          row.overflow <= 1,
          `${row.overflow}px of overflow inside the row`,
        );
        check(
          "…with every filter inside the screen",
          row.widest <= 375 + 1 && row.offLeft >= -1,
          `rightmost edge at ${Math.round(row.widest)}px, leftmost at ${Math.round(row.offLeft)}px`,
        );
        check(
          "…and none of them squashed by the extra button",
          row.shortest >= 44,
          `shortest filter is ${Math.round(row.shortest)}px tall`,
        );
        console.log(`  · the six filters wrap onto ${row.lines} line(s) at 375px`);
        check(
          "…and the page still does not overflow sideways",
          (await flex.evaluate(
            () => document.documentElement.scrollWidth - window.innerWidth,
          )) <= 1,
        );

        await flexButton.tap();
        await flex.waitForTimeout(400);

        const inFlex = await readRows();
        const ids = (list) => list.map((r) => r.id).sort().join(",");
        check(
          "FLEX lists exactly the backs, receivers and tight ends",
          ids(inFlex) === ids(expected),
          `${inFlex.length} shown, ${expected.length} expected`,
        );
        check(
          "…and no quarterback or defence among them",
          !inFlex.some((r) => r.pos === "QB" || r.pos === "DST"),
          [...new Set(inFlex.map((r) => r.pos))].join(", "),
        );
        for (const pos of ["RB", "WR", "TE"]) {
          check(
            `…with ${pos}s present`,
            inFlex.some((r) => r.pos === pos),
            `0 of ${inFlex.length}`,
          );
        }

        /*
         * THE ORDER, ACROSS THE COMBINED POOL. Two claims, and the second is the
         * one that matters: monotonic in the sorted column, and INTERLEAVED —
         * a list that happens to be RBs then WRs then TEs would pass a
         * monotonic check on a per-position sort and be useless.
         */
        const blocks = (list) =>
          list.reduce((n, r, i) => (i > 0 && r.pos === list[i - 1].pos ? n : n + 1), 0);

        const rankOrdered = inFlex.every(
          (r, i) =>
            i === 0 ||
            (inFlex[i - 1].rank ?? Infinity) <= (r.rank ?? Infinity),
        );
        check(
          "the league board's order runs straight down the combined pool",
          rankOrdered,
          "a rank goes backwards, so the sort is scoped per position",
        );
        check(
          "…and the three positions interleave rather than sitting in blocks",
          blocks(inFlex) > 20,
          `only ${blocks(inFlex)} runs of one position in ${inFlex.length} rows`,
        );

        // Projected points, which is the other thing he said he sorts on.
        await flex.getByRole("button", { name: "Proj", exact: true }).tap();
        await flex.waitForTimeout(400);
        const byProj = await readRows();
        check(
          "sorting by Proj re-orders the whole flex pool, not one position",
          ids(byProj) === ids(expected) &&
            byProj.every(
              (r, i) =>
                i === 0 || (byProj[i - 1].proj ?? -Infinity) >= (r.proj ?? -Infinity),
            ),
          "projected points go back up somewhere in the list",
        );
        check(
          "…and the pool is still mixed after the re-sort",
          blocks(byProj) > 20,
          `${blocks(byProj)} runs of one position`,
        );

        /*
         * WHERE THE TIGHT END PREMIUM BECOMES VISIBLE.
         *
         * This view is the only place a manager directly compares a tight end
         * against a back or a receiver, and it is where this league's scoring
         * diverges hardest from instinct — a full point a catch for a tight end
         * and half for everybody else. So the assertion is not "a tight end is
         * somewhere in the list": it is that the leading tight end is priced
         * INTO the top of the mixed order, above backs and receivers, by the
         * Proj column the list is sorted on.
         */
        const topTe = byProj.findIndex((r) => r.pos === "TE");
        const te = byProj[topTe];
        const above = byProj
          .slice(0, topTe)
          .reduce((n, r) => (r.pos === "TE" ? n : n + 1), 0);
        console.log(
          `  · the leading tight end is #${topTe + 1} of ${byProj.length} on projected points (${te?.proj}), ahead of ${byProj.length - topTe - 1} backs and receivers`,
        );
        check(
          "a premium tight end holds his own against backs and receivers",
          topTe >= 0 && topTe < 24,
          `the best TE is only #${topTe + 1} in the flex pool`,
        );
        check(
          "…and it is the Proj column putting him there",
          te != null && te.proj != null && byProj[above]?.proj != null,
          "the tight end carries no projected figure to be ordered on",
        );

        // The badge, which in a mixed list is the only thing telling two
        // adjacent rows apart. It is asserted for size, not merely presence.
        const badge = await flex.evaluate(() => {
          const el = document.querySelector("[data-position-badge]");
          const r = el.getBoundingClientRect();
          return {
            text: el.textContent.trim(),
            size: parseFloat(getComputedStyle(el).fontSize),
            visible: r.width > 0 && r.height > 0,
          };
        });
        check(
          "every row still says which position it is",
          badge.visible && /^(RB|WR|TE)\d*$/.test(badge.text),
          `“${badge.text}”`,
        );
        check(
          "…legibly on a phone, at 10px or more",
          badge.size >= 10,
          `${badge.size}px`,
        );

        /*
         * Two shots, because the two claims are 600px apart on a phone: the
         * filter row that had to absorb a sixth button, and the mixed list it
         * produces. The second is taken back on the league board's order, which
         * is what a manager opening the page in round eleven will see.
         */
        await flex.evaluate(() => window.scrollTo(0, 0));
        await flex.waitForTimeout(200);
        await flex.screenshot({ path: path.join(OUT, "cheat-sheet-flex-phone.png") });

        await flex.getByRole("button", { name: "Rk", exact: true }).tap();
        await flex.waitForTimeout(400);
        await flex.evaluate(() =>
          document.querySelector("table").scrollIntoView({ block: "start" }),
        );
        await flex.waitForTimeout(200);
        await flex.screenshot({ path: path.join(OUT, "cheat-sheet-flex-rows.png") });
      } finally {
        await flex.close();
      }
    }

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

    /*
     * RUN IN THE FLEX VIEW, which is the point of doing it here rather than in
     * a second copy of this section. Every claim below is the one this harness
     * has always made — the row goes on its own, nothing navigates, the
     * half-typed name survives — and running it with the combined RB/WR/TE
     * filter on proves the same of the view he will be looking at in the last
     * ten rounds. A filter that quietly re-derived its own pool from a cached
     * list would pass every check in section 1d and strand a drafted player
     * here.
     */
    await page.getByRole("button", { name: "FLEX", exact: true }).tap();
    await page.waitForTimeout(400);
    const flexCount = await page.locator("[data-player-id]").count();
    check(
      "the FLEX filter is on, and narrower than the whole pool",
      flexCount > 50 && flexCount < rowCount,
      `${flexCount} of ${rowCount}`,
    );

    // The player at the top of the flex list, who is definitely on screen.
    const target = page.locator("[data-player-id]").first();
    const targetId = await target.getAttribute("data-player-id");
    // Off the attribute rather than out of the cell: the frozen identity cell
    // now also carries the position badge and the team, and reading a name out
    // of that by splitting on newlines was one layout change away from typing
    // "RB1 " into the search box and filtering the row away before the pick
    // landed — which would make the propagation check below pass vacuously.
    const targetName = await target.getAttribute("data-player-name");
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
      (await page.locator("[data-player-id]").count()) < flexCount,
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
      "the drafted player leaves the FLEX list with nobody touching the phone",
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
    // Back to the whole pool, so what follows is about availability rather than
    // about the position filter section 3 left switched on.
    await page.getByRole("button", { name: "All pos", exact: true }).click();
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
      .locator("[data-name-text]")
      .evaluate((el) => getComputedStyle(el).textDecorationLine);
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

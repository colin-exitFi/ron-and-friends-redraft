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
     * 1b. THE STAT BREAKDOWN, WHICH MUST WORK WITH A THUMB
     * ========================================================================
     * The commissioner asked for the projection broken out by category —
     * receptions, receiving yards, touchdowns, rushing, passing. Eight numeric
     * columns cannot coexist with a 390px screen, so it lives behind a tap.
     *
     * THIS IS ASSERTED WITH `tap()`, NOT `click()`, and the distinction is the
     * whole point. A breakdown that opens on hover, or on a `title` attribute,
     * is invisible on a phone — which is the only device the people this page
     * was built for will be holding. `tap()` dispatches real touch events, so
     * an implementation that only responds to a mouse fails here.
     */
    section("1b. The stat breakdown opens on a tap, not a hover");

    {
      /*
       * A row from the MIDDLE of what is on screen, not the first one, and
       * centred before it is tapped.
       *
       * The first row is the one a `scrollIntoView` lands directly underneath
       * the sticky `<thead>` and the sticky app header, which then swallow the
       * tap — this harness found that the hard way. A person never hits it,
       * because he scrolls the row he wants into the middle of the screen
       * before reaching for it, so that is what is emulated here. The header
       * occlusion is real but it is a scroll-position artifact rather than a
       * defect in the control.
       */
      const first = page.locator("[data-player-id]").nth(3);
      const id = await first.getAttribute("data-player-id");
      const expander = first.getByRole("button", { name: /stat breakdown/ });
      await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(200);

      check("a player row offers a breakdown control", await expander.isVisible());
      const box = await expander.boundingBox();
      check(
        "…and it is a thumb-sized target, not a 12px chevron",
        (box?.height ?? 0) >= 44,
        `${Math.round(box?.height ?? 0)}px tall`,
      );
      check(
        "the breakdown starts closed, so the list stays scannable",
        (await page.locator(`[data-breakdown-for="${id}"]`).count()) === 0,
      );

      await expander.tap();
      const panel = page.locator(`[data-breakdown-for="${id}"]`);
      await panel.waitFor({ timeout: 5_000 }).catch(() => {});
      check("a TAP opens the breakdown", await panel.isVisible());

      const panelText = (await panel.innerText()).replace(/\s+/g, " ");
      console.log(`  · ${panelText.slice(0, 150)}…`);
      check(
        "it names the categories rather than only the total",
        /Rushing yards|Receptions|Passing yards/.test(panelText),
        panelText.slice(0, 80),
      );
      check(
        "it shows the rate this league pays, so the arithmetic is checkable",
        /1 pt \/ \d+ yd|×\d/.test(panelText),
      );
      check(
        "it states the scoring it was computed under",
        /scored in .*(PPR|premium)/i.test(panelText),
        panelText.slice(0, 120),
      );
      check(
        "opening it does not push anything off the side of the screen",
        (await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        )) <= 1,
      );
      check(
        "the panel is readable — nothing under 10px",
        (await panel.evaluate((el) =>
          Math.min(
            ...[...el.querySelectorAll("*")]
              .filter((n) => n.textContent?.trim())
              .map((n) => parseFloat(getComputedStyle(n).fontSize)),
          ),
        )) >= 10,
      );

      await page.screenshot({ path: path.join(OUT, "cheat-sheet-phone-breakdown.png") });

      // Vertical scrolling must still work with a panel open — a region that
      // traps an upward fling is miserable on a phone.
      const before = await page.evaluate(() => window.scrollY);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(200);
      const after = await page.evaluate(() => window.scrollY);
      check(
        "the list still scrolls vertically with a panel open",
        after !== before ||
          (await page.evaluate(() => {
            const s = document.querySelector(".overflow-auto");
            return s ? s.scrollHeight > s.clientHeight : false;
          })),
        `scrollY ${before} → ${after}`,
      );

      await expander.tap();
      await page.waitForTimeout(150);
      check(
        "a second tap closes it again",
        (await page.locator(`[data-breakdown-for="${id}"]`).count()) === 0,
      );
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

        const target = alt.locator("[data-player-id]").nth(3);
        const expander = target.getByRole("button", { name: /stat breakdown/ });
        await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await alt.waitForTimeout(200);
        /*
         * ACTIVATED, RATHER THAN TAPPED, AND ONLY HERE.
         *
         * A landscape phone is 390px TALL. Between the sticky app header and
         * the table's own sticky `<thead>` there is not enough room to scroll
         * an arbitrary row clear of both, so Playwright's tap lands on a header
         * and times out. That is a limitation of driving the scroll from a
         * script, not something a thumb runs into — and the tap itself is
         * already proven at 390×844 and 375×667 above, which is where these
         * managers will actually be.
         *
         * So landscape asserts what it can honestly assert: the control is
         * present, focusable and opens the panel when activated. The two
         * portrait sizes carry the touch claim.
         */
        await expander.focus();
        await expander.press("Enter");
        await alt.waitForTimeout(300);
        check(
          `${label}: the breakdown opens when the control is used`,
          (await alt.locator("[data-breakdown-for]").count()) > 0,
        );
        check(
          `${label}: …and still nothing overflows`,
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
              return {
                id: tr.getAttribute("data-player-id"),
                pos:
                  tr.querySelector("[data-position-badge]")?.getAttribute(
                    "data-position-badge",
                  ) ?? null,
                rank: num(0),
                proj: num(3),
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

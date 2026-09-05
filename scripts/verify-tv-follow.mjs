/**
 * Proves the board follows the draft on the projector, and that the safe area
 * is a thing the room can actually move.
 *
 *   BASE=http://localhost:3210 node scripts/verify-tv-follow.mjs
 *
 * ============================================================================
 * WHY THIS ENTERS TV MODE THROUGH `?tv=1`
 * ============================================================================
 * `document.fullscreenElement` cannot be driven from Playwright. That was
 * established across five configurations — headless, `--start-fullscreen`,
 * `--headless=old`, headed at a fixed viewport, headed with `viewport: null` —
 * and it came back false in all of them. An assertion gated on it does not
 * fail, it SKIPS, which is how TV behaviour came to be the one part of this
 * board that had never been tested. `useTvMode` ORs fullscreen with a `tv=1`
 * search param, and that param exists for two reasons at once: this harness,
 * and a golf-simulator PC running the browser in OS-level kiosk fullscreen
 * where the document reports no fullscreen element at all.
 *
 * ============================================================================
 * WHAT IS ASSERTED
 * ============================================================================
 *   1. TV mode scrolls at all three viewports, and its rows are no shorter
 *      than the same board outside TV mode.
 *   2. The active round sits inside the safe band — found by walking from the
 *      on-the-clock cell to its `[data-round]` row.
 *   3. Following works: the cursor is walked to the first round, a round in the
 *      middle and the last round, and (2) is re-asserted at each.
 *   4. A committed pick re-follows, entered with the keyboard against the real
 *      API. That writes the live board, so it is borrowed through
 *      `live-board-guard.mjs` and the sha is confirmed unchanged at the end.
 *   5. Neither end over-scrolls.
 *   6. A manual scroll suspends following, the pill says so, and it comes back
 *      by itself after eight seconds — and immediately on Escape.
 *   7. The safe area adjusts by exactly 2 a press, clamps at 50, and survives
 *      a reload.
 *   8. The adjustment overlay appears at once and is gone two seconds later.
 *   9. BROWSER ZOOM REACHES THE BOARD, in Scroll and in Fit, at 80/100/125% —
 *      measured in DEVICE pixels, because CSS pixels are the unit that stays
 *      still under zoom and comparing those is how you conclude nothing
 *      happened when the whole screen just changed size. See `checkZoom` for
 *      how the zoom is driven and why it is driven that way.
 *  10. The density range reaches every round on the board inside the band,
 *      clamps at both ends, and the readout says how many are on screen.
 *
 * And the mock, which renders the same grid: it follows too. The repo's own
 * note is that drift between the mock and the live board gets discovered on
 * the night, and the mock is the rehearsal.
 *
 * Geometry out of the DOM rather than screenshots, same as
 * `scripts/verify-board-fit.mjs`. Screenshots land in `screenshots/` for the
 * things a number cannot show.
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  assertLocalBase,
  assertServerHasNoPicks,
  borrowLiveBoard,
} from "./live-board-guard.mjs";
import {
  CAP_RATIO,
  DENSITY_MAX,
  DENSITY_MIN,
  FURTHEST_VIEWER_IN,
  META_FLOOR_ARCMIN,
  NAME_FLOOR_ARCMIN,
  PX_PER_INCH,
  RESOLVABLE_ARCMIN,
  SAFE_AREA_STEP,
  SAFE_BOTTOM_DEFAULT,
  SAFE_TOP_DEFAULT,
} from "../src/lib/board-legibility.ts";
/*
 * THE BOARD'S SHAPE, READ RATHER THAN PINNED.
 *
 * This harness was written against a 10 x 16 board and asserted both halves of
 * that as literals: 160 cells, and "round 16" as the bottom of the board in
 * every follow, Fit and zoom check. Ron and Friends drafts 10 x 15, so all of
 * them failed on the LEAGUE rather than on a bug — twenty-four times over.
 *
 * The failure text is the dangerous part. "expected 160, got 150" reads as a
 * board that is a round short, two hours before the room sits down, and the fix
 * it invites is to regenerate the board to sixteen rounds. The board is right:
 * 10 x 15 = 150 is Sleeper's live draft setting and the commissioner's own
 * ruling. So the assertions are what move, and they move to being derived,
 * because `DRAFT.rounds` has changed twice today already — 16 in the source
 * league, then 14, now 15 — and a fourth literal typed in here would be wrong
 * the next time he changes his mind.
 *
 * `league-config.ts` has no imports of its own, so there is no alias resolution
 * to arrange here — the same reason `verify-board-fit.mjs` imports it directly.
 */
import { DRAFT, LEAGUE, TOTAL_PICKS } from "../src/lib/league-config.ts";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = path.join(process.cwd(), "screenshots");
const BOARD_FILE = path.join(process.cwd(), "data", "draft-state-2026.json");

/** The room. The other two are the projectors it might turn out to be. */
const PROJECTOR = { width: 1920, height: 1080 };
/** Lower-spec projector, and the viewport where the rem floors bind. */
const SMALL = { width: 1280, height: 720 };
/** Catches a regression back to the board simply fitting. */
const LARGE = { width: 2560, height: 1440 };

const SAFE_KEY = "ukl.tv-safe-area.v1";
const FIT_KEY = "ukl.board.fit.v1";
/*
 * THE SAFE AREA, READ RATHER THAN PINNED — for the same reason the board's
 * shape now is. `bottom` was 72 here and 72 in `board-legibility.ts`, and the
 * day the display stopped being a floor-to-ceiling projector and became a
 * 65-inch television at eye level, the product's default moved to 94 and this
 * copy of it did not. Every safe-area assertion below then failed against a
 * band the board no longer starts in.
 */
const STEP = SAFE_AREA_STEP;
const DEFAULT_SAFE = { top: SAFE_TOP_DEFAULT, bottom: SAFE_BOTTOM_DEFAULT };
/**
 * A band tight enough that 1080p still has something to scroll — which the
 * television's default deliberately does not. 72% is not an arbitrary tight
 * number: it is the floor-to-ceiling projector's former default, a display
 * this board still supports, so the scrolling behaviours are exercised in the
 * setup that actually has them rather than in a contrived one.
 */
const SCROLLING_SAFE = { top: 0, bottom: 72 };
/** Matches `FLASH_MS` in `draft-surface.tsx`. */
const FLASH_MS = 3400;

/**
 * The last round on the board — the one every "does it reach the bottom" claim
 * is about, and the only round whose number is load-bearing here.
 */
const LAST_ROUND = DRAFT.rounds;
/**
 * A round in the middle of the board, which is where the safe-area and
 * following checks want the cursor: far enough down that the board has had to
 * scroll to put it in the band, and not so far that it is pinned at the end.
 */
const MID_ROUND = Math.ceil(DRAFT.rounds / 2);
/** First, middle, last — the three the follow check walks the cursor to. */
const FOLLOW_ROUNDS = [1, MID_ROUND, LAST_ROUND];

mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

const sha = () => createHash("sha256").update(readFileSync(BOARD_FILE)).digest("hex");

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    → ${path.relative(process.cwd(), file)}`);
}

/** Types at the document with no element focused — the board's only input. */
async function typeAtDocument(page, text) {
  for (const char of text) {
    await page.keyboard.press(char === " " ? "Space" : char);
    await page.waitForTimeout(12);
  }
}

/**
 * Everything about where the board is parked, read in one round trip.
 *
 * The active ROW is found by walking from the on-the-clock cell up to its
 * `[data-round]` ancestor rather than by trusting a round number computed out
 * here — the whole claim is that the board follows the cell that is live, and
 * deriving the row from that cell is what makes the claim testable.
 */
async function geometry(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const cell = document.querySelector("[data-slot-id][title]");
    const board = cell?.closest("main") ?? null;
    if (!board) return { board: false };

    const header = board.firstElementChild.getBoundingClientRect();
    const rows = [...board.querySelectorAll("[data-round]")];
    const live =
      board.querySelector('[title*=" · on the clock"]') ??
      board.querySelector(".ring-primary");
    const aimedRow = live?.closest("[data-round]") ?? null;

    const safe = {
      top: Number(getComputedStyle(board).getPropertyValue("--ukl-safe-top")) || 0,
      bottom:
        Number(getComputedStyle(board).getPropertyValue("--ukl-safe-bottom")) || 0,
    };

    const rowBox = (row) => {
      const r = row.getBoundingClientRect();
      return { top: round(r.top), bottom: round(r.bottom), height: round(r.height) };
    };

    return {
      board: true,
      rounds: rows.length,
      rowHeight: rows[2] ? round(rows[2].getBoundingClientRect().height) : null,
      /*
       * The height a row is GUARANTEED, `3.45rem × density`, read off the row
       * rather than restated here so the density control moves it. A row is
       * `grow`, so on a screen where the whole board fits it is stretched well
       * past this floor and the drawn height says as much about the leftover
       * space as about the board. See the row-height check in
       * `checkEachViewport`, which is why this is measured at all.
       */
      minRowHeight: rows[2]
        ? round(parseFloat(getComputedStyle(rows[2]).minHeight) || 0)
        : null,
      /* The round-number rail. It is the board's other type size, and the one
         that was left in `vw` and therefore immune to zoom. */
      railPx: rows[0]?.firstElementChild
        ? round(parseFloat(getComputedStyle(rows[0].firstElementChild).fontSize))
        : null,
      /* Top to top: a round's full cost, gap included, without assuming which
         box the gap belongs to. See `roundsInBand`. */
      pitch:
        rows[1]
          ? round(
              rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top,
            )
          : null,
      headerBottom: round(header.bottom),
      headerHeight: round(header.height),
      scrollTop: round(board.scrollTop),
      scrollHeight: round(board.scrollHeight),
      clientHeight: round(board.clientHeight),
      maxScroll: round(board.scrollHeight - board.clientHeight),
      padTop: round(parseFloat(getComputedStyle(board).paddingTop) || 0),
      padBottom: round(parseFloat(getComputedStyle(board).paddingBottom) || 0),
      innerHeight: window.innerHeight,
      safe,
      bandTop: round(window.innerHeight * safe.top),
      bandBottom: round(window.innerHeight * safe.bottom),
      activeRound: aimedRow ? Number(aimedRow.dataset.round) : null,
      /* Every cell's title starts `{label} — …`; see the note in `Cell`. */
      activeLabel: live ? (live.getAttribute("title") ?? "").split(" —")[0] : null,
      activeRow: aimedRow ? rowBox(aimedRow) : null,
      firstRow: rows[0] ? rowBox(rows[0]) : null,
      lastRow: rows[rows.length - 1] ? rowBox(rows[rows.length - 1]) : null,
      /* The sticky header's own resting place, for the round-one check. */
      stickyTop: round(header.top),
      pill: (() => {
        const el = document.querySelector("[data-follow-pill]");
        return el ? { text: el.innerText.replace(/\s+/g, " ").trim(),
                      rect: rowBox(el) } : null;
      })(),
      overlay: Boolean(document.querySelector("[data-safe-area-overlay]")),
      overlayLabels: [...document.querySelectorAll("[data-safe-area-label]")].map(
        (el) => el.innerText.trim(),
      ),
      hydrated: Object.keys(cell).some((k) => k.startsWith("__reactFiber")),
    };
  });
}

/**
 * What Fit mode actually costs, measured rather than predicted.
 *
 * Every type size the cell renders, plus the two things that decide whether a
 * board this dense is still a board: whether any box is holding more than it
 * was given, and whether all `TOTAL_PICKS` cells still lay their slots out
 * identically.
 * The arcminutes are computed from the measured name size out here, against the
 * same room constants `board-legibility.ts` holds.
 */
async function cellMetrics(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const cells = [...document.querySelectorAll("[data-slot-id][title]")];
    if (cells.length === 0) return { count: 0 };

    const read = (cell) => {
      const box = cell.getBoundingClientRect();
      const stack = cell.firstElementChild;
      /*
       * The ownership strip, on a board that draws one. A league that cannot
       * trade picks draws none — `boardShowsOwnership` gives every cell that
       * line back as type — and then the stack IS the last child, so taking it
       * for the strip measures the player's name against its own container and
       * reports the result as a clearance of about −13px.
       */
      const strip = cell.children.length > 1 ? cell.lastElementChild : null;
      const [name, posRow, clubRow] = [...stack.children];
      const offset = (el) => round(el.getBoundingClientRect().top - box.top);
      return {
        height: round(box.height),
        fonts: {
          name: round(parseFloat(getComputedStyle(name.firstElementChild).fontSize)),
          position: round(parseFloat(getComputedStyle(posRow.firstElementChild).fontSize)),
          meta: round(parseFloat(getComputedStyle(clubRow).fontSize)),
          strip: strip ? round(parseFloat(getComputedStyle(strip).fontSize)) : null,
        },
        slots: {
          name: offset(name),
          position: offset(posRow),
          club: offset(clubRow),
          strip: strip ? offset(strip) : null,
        },
        /* Anything that would cut text, whether or not it is cutting today. */
        cutters: [...cell.querySelectorAll("*")].filter((el) => {
          const s = getComputedStyle(el);
          return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
        }).length,
        /* Any box holding more than it was given. Blocks only — an inline span
           has no client box and reads as overflowing by 2px in every cell. */
        overflowing: [cell, ...cell.querySelectorAll("*")].filter((el) => {
          const display = getComputedStyle(el).display;
          if (display === "inline" || display === "contents" || el.tagName === "svg") {
            return false;
          }
          return (
            el.scrollHeight - el.clientHeight > 2 || el.scrollWidth - el.clientWidth > 2
          );
        }).length,
        /* The ownership strip must not come up over the name — and where no
           strip is drawn, the cell's own floor must not either. */
        clearance: round(
          (strip ? strip.getBoundingClientRect().top : box.bottom) -
            name.getBoundingClientRect().bottom,
        ),
      };
    };

    const all = cells.map(read);
    /*
     * SPREADS, NOT DISTINCT VALUES. Fit sizes its rounds with `minmax(0, 1fr)`,
     * so the browser hands the leftover sub-pixel of the band to some rows and
     * not others — two rows can be 40.42px and 40.41px, which is two "distinct
     * heights" and is not a uniformity defect. What would be one is a cell a
     * whole pixel out of line with its neighbours, so the spread is what is
     * measured and `checkTheCellsSurvive` holds it under a pixel.
     */
    const spread = (pick) => {
      const values = all.map(pick);
      return round(Math.max(...values) - Math.min(...values));
    };
    return {
      count: all.length,
      fonts: all[0].fonts,
      heightSpread: spread((c) => c.height),
      nameSpread: spread((c) => c.fonts.name),
      slotSpread: Math.max(
        spread((c) => c.slots.name),
        spread((c) => c.slots.position),
        spread((c) => c.slots.club),
        spread((c) => c.slots.strip),
      ),
      cutters: all.filter((c) => c.cutters > 0).length,
      overflowing: all.filter((c) => c.overflowing > 0).length,
      covered: all.filter((c) => c.clearance < 0).length,
      tightest: Math.min(...all.map((c) => c.clearance)),
    };
  });
}

/** What a font size subtends from the furthest seat, in arcminutes of cap. */
const arcmin = (fontPx) =>
  Math.round(((fontPx * CAP_RATIO) / PX_PER_INCH / FURTHEST_VIEWER_IN) * 3438 * 10) / 10;

/**
 * How many rounds fit the band, by the same arithmetic `use-board-readout.ts`
 * uses — so a disagreement between this harness and the number on the screen is
 * a real disagreement rather than two roundings.
 *
 * N rounds occupy `N × pitch − gap`. Charging the last round for a gap it does
 * not have loses a whole round at exactly the density where the whole board
 * starts to fit, which is the figure the widening is judged on.
 */
function roundsInBand(g) {
  if (!g.pitch || g.pitch <= 0) return 0;
  const gap = g.pitch - g.rowHeight;
  return Math.min(g.rounds, Math.floor((g.bandBottom - g.headerBottom + gap) / g.pitch));
}

/**
 * IS THE WHOLE DRAFT ON THE SCREEN, INSIDE THE READABLE BAND, RIGHT NOW.
 *
 * The commissioner's requirement for the television is "see the whole board the
 * entire time", and once the safe area's default moved from 72% to 94% that
 * became the ordinary case at 1080p rather than something only a wide screen
 * managed. Several checks below were written when it was impossible and read a
 * board with nothing left to scroll as a board that had broken.
 *
 * Drawn as a predicate rather than repeated inline because six of them need it
 * and "0px of scroll" means two opposite things depending on this answer: a
 * board that fits, or a board that has lost its last five rounds.
 */
function everyRoundIsInTheBand(g) {
  return (
    g.rounds === DRAFT.rounds && g.lastRow != null && g.lastRow.bottom <= g.bandBottom + 1
  );
}

/**
 * The claims that hold in BOTH modes: nothing cut, every cell the same.
 *
 * The labels below count in `TOTAL_PICKS` rather than in `m.count`. That is
 * deliberate: interpolating the MEASURED count into a label while comparing it
 * against the expected one prints "all 150 cells drew — 150" on a failure and
 * reads as the board disagreeing with itself, which is the same trap
 * `verify-board-fit.mjs` had to be dug out of.
 */
function checkTheCellsSurvive(m, where) {
  check(
    `${where}: all ${TOTAL_PICKS} cells drew`,
    m.count === TOTAL_PICKS,
    `${m.count}, expected ${LEAGUE.teams} teams x ${DRAFT.rounds} rounds`,
  );
  check(
    `${where}: nothing is clipped, ellipsized or overflowing its own box`,
    m.cutters === 0 && m.overflowing === 0,
    `${m.cutters} cells could cut text, ${m.overflowing} overflow`,
  );
  check(
    `${where}: the ownership strip covers no name`,
    m.covered === 0,
    `tightest clearance ${m.tightest}px`,
  );
  check(
    `${where}: all ${TOTAL_PICKS} cells lay their slots out at the same offsets, to the pixel`,
    m.slotSpread < 1 && m.heightSpread < 1,
    `slots drift ${m.slotSpread}px, heights ${m.heightSpread}px`,
  );
  check(
    `${where}: and render one type size board-wide`,
    m.nameSpread < 0.2,
    `name ${m.fonts.name}px (drift ${m.nameSpread}px), position ${m.fonts.position}px, ` +
      `meta ${m.fonts.meta}px, strip ${m.fonts.strip}px`,
  );
}

/**
 * The one assertion this whole feature is for: the round being drafted is in
 * the part of the screen the room can see.
 */
function checkActiveRoundIsInTheBand(g, where) {
  if (!g.activeRow) {
    check(`${where}: there is an active round to locate`, false);
    return;
  }
  const clear =
    g.activeRow.top >= g.bandTop - 1 && g.activeRow.bottom <= g.bandBottom + 1;
  check(
    `${where}: round ${g.activeRound} sits inside the safe band`,
    clear,
    `row ${g.activeRow.top}–${g.activeRow.bottom}px, band ${g.bandTop}–${g.bandBottom}px ` +
      `of ${g.innerHeight}`,
  );
  check(
    `${where}: …and clear of the sticky franchise header`,
    g.activeRow.top >= g.headerBottom - 1,
    `row top ${g.activeRow.top}px, header bottom ${g.headerBottom}px`,
  );
}

/**
 * Walks the cursor to a round with the arrow keys, from an empty name box.
 *
 * IT MAY HAVE TO CHANGE COLUMN TO GET THERE, and that is a fact about the
 * board rather than a convenience here: the cursor steps OVER keepers rather
 * than stopping on one, so a column holding keepers at rounds 7 and 8 goes
 * straight from 6 to 9 and no sequence of ↑ and ↓ will ever land on 8 in it.
 * Nineteen cells on this board are keepers. So on an oscillation it steps
 * sideways with → and tries the column next door, which is exactly what the
 * operator would do.
 */
async function walkCursorTo(page, target) {
  const at = () =>
    page.evaluate(() => {
      const live =
        document.querySelector('[title*=" · on the clock"]') ??
        document.querySelector(".ring-primary");
      const row = live?.closest("[data-round]");
      return row ? Number(row.dataset.round) : null;
    });

  let last = await at();
  for (let column = 0; column < 6; column++) {
    const seen = new Set([last]);
    for (let i = 0; i < 24 && last != null && last !== target; i++) {
      await page.keyboard.press(last < target ? "ArrowDown" : "ArrowUp");
      await page.waitForTimeout(90);
      const next = await at();
      if (next == null || seen.has(next)) break;
      seen.add(next);
      last = next;
    }
    if (last === target || last == null) return last;
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(90);
    last = await at();
  }
  return last;
}

/**
 * Puts a starting band in place before the first byte of the page.
 *
 * ONLY IF NOTHING IS STORED. An init script runs on every navigation, reload
 * included, so seeding unconditionally would stamp the default back over
 * whatever the keyboard had just set — and the reload check below would be
 * asserting that this script works rather than that the board persists.
 */
function seedSafeArea([key, value]) {
  try {
    if (window.localStorage.getItem(key) == null) {
      window.localStorage.setItem(key, value);
    }
  } catch {
    /* nothing to do; the board falls back to its default band */
  }
}

/** A page already in TV mode, with the safe area seeded before anything loads. */
async function tvPage(browser, viewport, safe = DEFAULT_SAFE, route = "/draft") {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addInitScript(seedSafeArea, [SAFE_KEY, JSON.stringify(safe)]);
  /* Scroll is the default and every check below assumes it, so a Fit choice
     left in storage by a previous section cannot leak into the next one. */
  await context.addInitScript(seedSafeArea, [FIT_KEY, "0"]);
  const page = await context.newPage();
  await page.goto(`${BASE}${route}?tv=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-slot-id][title]");
  await page.waitForTimeout(700);
  return { context, page };
}

// --- 1 and 2: TV mode scrolls, and the live round is in the band ------------

async function checkEachViewport(browser) {
  for (const viewport of [PROJECTOR, SMALL, LARGE]) {
    const name = `${viewport.width}x${viewport.height}`;
    section(`TV mode at ${name}`);

    /* The same board WITHOUT `?tv=1`, to hold the two against each other. */
    const plain = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    await plain.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
    await plain.waitForSelector("[data-slot-id][title]");
    await plain.waitForTimeout(500);
    const off = await geometry(plain);
    const offCells = await cellMetrics(plain);
    await plain.close();

    const { context, page } = await tvPage(browser, viewport);
    const g = await geometry(page);
    const onCells = await cellMetrics(page);

    check(`${name}: the board hydrated, so TV mode is answerable at all`, g.hydrated);
    /*
     * THE FLOOR IS RESERVED, AND NO ROUND IS STRANDED BELOW THE FOLD.
     *
     * This used to read "reserves the floor and therefore scrolls", and the
     * second half of that was an assumption about the LEAGUE rather than a
     * property of TV mode: a 16-round board is taller than any screen in the
     * room, so there was always something left to scroll. Fifteen rounds fit
     * inside the band at 1440p, and the old form failed there — reporting a
     * board with every round already on screen as a board that had broken.
     *
     * So the claim is stated as what was actually wanted: the floor is given
     * up, and either the board scrolls or it has nothing left to scroll
     * BECAUSE the whole draft is inside the band. That second branch is
     * stronger than the assertion it replaces, not weaker — "0px of scroll" on
     * its own would also describe a board that had lost its last five rounds.
     */
    const wholeBoardInBand = everyRoundIsInTheBand(g);
    check(
      `${name}: TV mode reserves the floor, and nothing is stranded below the fold`,
      g.padBottom > 0 && (g.maxScroll > 0 || wholeBoardInBand),
      `${g.padBottom}px of trailing space, ${g.maxScroll}px of scroll` +
        (g.maxScroll > 0
          ? ""
          : ` — all ${g.rounds} rounds already inside the band, so there is nothing to scroll`),
    );
    /*
     * TV MODE MUST NOT COME OUT SMALLER THAN A BROWSER WINDOW, and the thing to
     * measure that on is the TYPE rather than the row.
     *
     * The row was the wrong ruler. A row is `grow`, so on a screen where the
     * whole board fits it is stretched into the slack: at 1080p a window draws
     * a 62.36px row against TV mode's 55.19px, and the difference is not TV
     * mode shrinking anything — it is the room deliberately giving the bottom
     * 28% of the screen away as unviewable floor. Comparing the two measured
     * the safe area and filed it as a regression. It only held while the board
     * was taller than every screen, which is another 16-round assumption.
     *
     * The type is genuinely like-for-like: in Scroll mode it follows the
     * density and the viewport, not the row, so it is IDENTICAL in TV mode and
     * in a window at the same size. That is the claim worth defending, and a
     * TV mode that shrank the board would fail it.
     */
    check(
      `${name}: TV mode renders exactly the type a browser window does`,
      Math.abs(onCells.fonts.name - offCells.fonts.name) < 0.05 &&
        Math.abs(onCells.fonts.meta - offCells.fonts.meta) < 0.05,
      `name ${onCells.fonts.name}px in TV mode against ${offCells.fonts.name}px in a window, ` +
        `metadata ${onCells.fonts.meta}px against ${offCells.fonts.meta}px`,
    );
    /*
     * And the row, compared only where comparing it means something: where the
     * window board ALSO scrolls, neither is stretching and TV mode must not be
     * the shorter of the two. Where the window has slack, the floor the density
     * guarantees is what TV mode is held to instead.
     */
    const windowStretches = off.maxScroll <= 1;
    check(
      windowStretches
        ? `${name}: the rows still stand at the floor the density guarantees`
        : `${name}: the rows are no shorter than outside TV mode`,
      windowStretches
        ? g.rowHeight >= g.minRowHeight - 0.5
        : g.rowHeight >= off.rowHeight - 0.5,
      `${g.rowHeight}px in TV mode, ${off.rowHeight}px in a window` +
        (windowStretches
          ? ` — the window has ${off.maxScroll}px to scroll, so it is stretching its rows ` +
            `into space TV mode gave to the safe area; floor ${g.minRowHeight}px`
          : ""),
    );
    check(
      `${name}: outside TV mode there is no trailing space at all`,
      off.padBottom < 8,
      `${off.padBottom}px`,
    );
    check(
      `${name}: the band is the safe area the page was seeded with`,
      Math.abs(g.safe.bottom - DEFAULT_SAFE.bottom / 100) < 0.001 &&
        Math.abs(g.safe.top - DEFAULT_SAFE.top / 100) < 0.001,
      `top ${g.safe.top}, bottom ${g.safe.bottom}`,
    );
    checkActiveRoundIsInTheBand(g, name);

    /* 3 — following, to both ends of the board and back to the middle. */
    for (const round of FOLLOW_ROUNDS) {
      const at = await walkCursorTo(page, round);
      await page.waitForTimeout(600);
      const step = await geometry(page);
      check(
        `${name}: the cursor walked to round ${round}`,
        at === round,
        `landed on ${at}`,
      );
      checkActiveRoundIsInTheBand(step, `${name} round ${round}`);
      if (viewport === PROJECTOR) {
        await shot(page, `tv-follow-round-${String(round).padStart(2, "0")}`);
      }
    }

    /* 5 — neither end over-scrolls. */
    await walkCursorTo(page, 1);
    await page.waitForTimeout(600);
    const top = await geometry(page);
    check(
      `${name}: round 1 clamps to the top rather than over-scrolling`,
      top.scrollTop === 0,
      `scrollTop ${top.scrollTop}`,
    );
    check(
      `${name}: …and round 1 is not hidden under the sticky header`,
      top.firstRow != null && top.firstRow.top >= top.headerBottom - 1,
      top.firstRow
        ? `row 1 top ${top.firstRow.top}px, header bottom ${top.headerBottom}px`
        : "no rows found",
    );

    await walkCursorTo(page, LAST_ROUND);
    await page.waitForTimeout(600);
    const bottom = await geometry(page);
    check(
      `${name}: round ${LAST_ROUND} clamps to maximum scroll`,
      Math.abs(bottom.scrollTop - bottom.maxScroll) <= 1,
      `scrollTop ${bottom.scrollTop} of ${bottom.maxScroll}`,
    );
    check(
      `${name}: …and the space under it is only the trailing spacer`,
      bottom.lastRow != null &&
        bottom.innerHeight - bottom.lastRow.bottom <= bottom.padBottom + 2,
      bottom.lastRow
        ? `${Math.round(bottom.innerHeight - bottom.lastRow.bottom)}px below round ${LAST_ROUND}, ` +
          `spacer ${bottom.padBottom}px`
        : "no rows found",
    );

    await context.close();
  }
}

// --- 6: a manual scroll suspends following ---------------------------------

async function checkSuspendAndResume(browser) {
  section("A manual scroll suspends following, and it comes back on its own");
  /*
   * DRIVEN AT THE PROJECTOR'S BAND, NOT THE TELEVISION'S, AND ON PURPOSE.
   *
   * Everything in this section is about what happens when somebody scrolls a
   * board by hand — and at the television default there is nothing to scroll,
   * because all fifteen rounds are inside the band. Run here, the first check
   * read "the wheel actually moved the board — 0 → 0" and the rest followed it
   * down, reporting the commissioner's own requirement as eight failures.
   *
   * Dropping the section would have been the wrong repair: suspend-and-resume
   * is still live code on a laptop, on a tightened band, and on the projector
   * this board has not stopped supporting. So it is exercised at a band where
   * the board genuinely overflows — 72%, which is exactly the projector's
   * former default — and `SCROLLING_SAFE` says which and why.
   */
  const { context, page } = await tvPage(browser, PROJECTOR, SCROLLING_SAFE);

  /*
   * Deep enough that the board has scrolled to get there, but never past the
   * end of the board — `Math.min` is what keeps this honest on a board shorter
   * than the ten rounds this was written against. The cursor is walked back UP
   * to round 2, and the distance between the two is what the claim below is
   * worth, so it is computed rather than spelled out.
   */
  const suspendFrom = Math.min(10, LAST_ROUND);
  const suspendTo = 2;

  await walkCursorTo(page, suspendFrom);
  await page.waitForTimeout(600);
  const before = await geometry(page);

  await page.mouse.move(600, 500);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(400);
  const scrolled = await geometry(page);
  check(
    "the wheel actually moved the board",
    scrolled.scrollTop !== before.scrollTop,
    `${before.scrollTop} → ${scrolled.scrollTop}`,
  );
  check(
    "the pill says the board is not following, and for how much longer",
    scrolled.pill != null && /NOT FOLLOWING/i.test(scrolled.pill?.text ?? ""),
    scrolled.pill?.text ?? "no pill",
  );
  check(
    "…and the pill is inside the band rather than on the floor",
    scrolled.pill != null && scrolled.pill.rect.bottom <= scrolled.bandBottom + 1,
    scrolled.pill
      ? `pill bottom ${scrolled.pill.rect.bottom}px, band bottom ${scrolled.bandBottom}px`
      : "",
  );
  await shot(page, "tv-follow-suspended");

  /*
   * UP the board, and a long way up. Following, if it were still on, would take
   * the board back near the top to put round 2 in the band — six hundred pixels
   * of travel — so "it did not move" is a claim with something behind it.
   *
   * WALKING DOWN TO ROUND 12 WAS NOT SUCH A CLAIM. The wheel has already put the
   * board at maximum scroll, and from there round 12's follow position IS
   * maximum scroll: the assertion read the same number whether following was
   * suspended or running, so it could only ever pass by luck. It failed for a
   * third reason instead — maximum scroll drops by 9px between the two cursor
   * positions, because the board's client height changes by that much, and the
   * browser clamps the board to the new maximum. That is not the board
   * re-aiming, so the clamp belongs in the expectation rather than in the
   * failure column.
   */
  await walkCursorTo(page, suspendTo);
  await page.waitForTimeout(600);
  const moved = await geometry(page);
  const pinned = Math.min(scrolled.scrollTop, moved.maxScroll);
  check(
    `walking the cursor ${suspendFrom - suspendTo} rounds does not scroll while suspended`,
    Math.abs(moved.scrollTop - pinned) <= 1,
    `${scrolled.scrollTop} → ${moved.scrollTop}, cursor on round ${moved.activeRound}` +
      ` (maximum scroll ${scrolled.maxScroll} → ${moved.maxScroll})`,
  );

  await page.waitForTimeout(9000);
  const resumed = await geometry(page);
  check("the pill is gone after the eight-second timeout", resumed.pill == null);
  checkActiveRoundIsInTheBand(resumed, "after the timeout");

  /* And Escape, which is the same key that already means "follow the clock". */
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(400);
  const again = await geometry(page);
  check("a second wheel suspends it again", again.pill != null);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  const escaped = await geometry(page);
  check("Escape resumes following immediately", escaped.pill == null);
  checkActiveRoundIsInTheBand(escaped, "after Escape");

  await context.close();
}

// --- 7 and 8: the safe area adjusts, clamps, persists -----------------------

async function checkTheSafeArea(browser) {
  section("The safe area, adjusted from the keyboard");
  const { context, page } = await tvPage(browser, PROJECTOR);
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  await walkCursorTo(page, MID_ROUND);
  await page.waitForTimeout(600);
  const start = await geometry(page);

  /* 8 — the overlay is up within 100ms of the first press. */
  await page.keyboard.press(`${mod}+Shift+ArrowUp`);
  await page.waitForTimeout(100);
  const flashed = await geometry(page);
  check(
    "the overlay is drawn within 100ms of the first press",
    flashed.overlay,
    flashed.overlayLabels.join(" | "),
  );
  check(
    "…and it names the edge and the number",
    flashed.overlayLabels.some((l) => /SAFE AREA · BOTTOM \d+%/.test(l)),
    flashed.overlayLabels.join(" | "),
  );
  await shot(page, "tv-safe-area-overlay");

  /* 7 — four presses of the tighten key move `bottom` by exactly 8. */
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(`${mod}+Shift+ArrowUp`);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(700);
  const tighter = await geometry(page);
  check(
    "four presses move the bottom edge by exactly 8",
    Math.abs(tighter.safe.bottom * 100 - (DEFAULT_SAFE.bottom - 4 * STEP)) < 0.5,
    `${Math.round(start.safe.bottom * 100)}% → ${Math.round(tighter.safe.bottom * 100)}%`,
  );
  checkActiveRoundIsInTheBand(tighter, "after tightening");

  await page.waitForTimeout(2100);
  const faded = await geometry(page);
  check("the overlay is gone two seconds after the last press", !faded.overlay);

  /* Thirty more presses have to stop at the floor with a usable band left. */
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(`${mod}+Shift+ArrowUp`);
    await page.waitForTimeout(45);
  }
  await page.waitForTimeout(900);
  const clamped = await geometry(page);
  check(
    "thirty more presses stop at the 50% floor rather than running to zero",
    Math.abs(clamped.safe.bottom * 100 - 50) < 0.5,
    `${Math.round(clamped.safe.bottom * 100)}%`,
  );
  const roundsInBand =
    (clamped.bandBottom - clamped.headerHeight) / (clamped.rowHeight + 2);
  check(
    "…and the tightest band still holds five rounds",
    roundsInBand >= 5,
    `${Math.round(roundsInBand * 10) / 10} rounds in ${clamped.bandBottom}px`,
  );
  checkActiveRoundIsInTheBand(clamped, "at the tightest band");
  await shot(page, "tv-safe-area-tightest");

  /* And it survives a reload, which is the whole point of persisting it. */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("[data-slot-id][title]");
  await page.waitForTimeout(900);
  const reloaded = await geometry(page);
  check(
    "the band survives a reload",
    Math.abs(reloaded.safe.bottom * 100 - 50) < 0.5,
    `${Math.round(reloaded.safe.bottom * 100)}% after reload`,
  );
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), SAFE_KEY);
  check("…and it is the value that was written to storage", /"bottom":50/.test(stored ?? ""), stored ?? "");
  checkActiveRoundIsInTheBand(reloaded, "after the reload");

  /* ⌘⌥0 puts both edges back — ⌘⇧0 belongs to the density control. */
  await page.keyboard.press(`${mod}+Alt+Digit0`);
  await page.waitForTimeout(700);
  const reset = await geometry(page);
  check(
    "⌘⌥0 resets both edges, leaving ⌘⇧0 to the density control",
    Math.abs(reset.safe.bottom * 100 - DEFAULT_SAFE.bottom) < 0.5 &&
      Math.abs(reset.safe.top * 100 - DEFAULT_SAFE.top) < 0.5,
    `top ${Math.round(reset.safe.top * 100)}%, bottom ${Math.round(reset.safe.bottom * 100)}%`,
  );

  await context.close();
}

// --- Fit mode: every round on the board, inside the band --------------------

/**
 * The other half of the toggle, at all three viewports.
 *
 * The arcminutes are REPORTED rather than asserted against the floor. Fitting
 * the whole board into 72% of 1080p takes the name well under the 16′ that
 * Scroll is built around, and that is the trade Fit exists to offer — it is for
 * standing up and looking at the whole draft, not for reading from the table.
 * Printing the number is what makes it a choice rather than a surprise.
 */
async function checkFitMode(browser) {
  const reported = [];

  for (const viewport of [PROJECTOR, SMALL, LARGE]) {
    const name = `${viewport.width}x${viewport.height}`;
    section(`Fit mode at ${name}`);

    const { context, page } = await tvPage(browser, viewport);
    const scroll = await cellMetrics(page);

    const mod = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${mod}+Shift+F`);
    await page.waitForTimeout(700);

    const g = await geometry(page);
    const m = await cellMetrics(page);

    check(
      `${name}: ⌘⇧F switched the board to Fit`,
      g.scrollHeight <= g.clientHeight + 1,
      `scrollHeight ${g.scrollHeight}, clientHeight ${g.clientHeight}`,
    );
    check(
      `${name}: all ${DRAFT.rounds} rounds are drawn`,
      g.rounds === DRAFT.rounds,
      `${g.rounds} rounds`,
    );
    check(
      `${name}: and every one of them is inside the safe band`,
      g.firstRow != null &&
        g.lastRow != null &&
        g.firstRow.top >= g.headerBottom - 1 &&
        g.lastRow.bottom <= g.bandBottom + 1,
      g.lastRow
        ? `round 1 top ${g.firstRow.top}px under a header ending at ${g.headerBottom}px, ` +
          `round ${LAST_ROUND} bottom ${g.lastRow.bottom}px, band bottom ${g.bandBottom}px of ${g.innerHeight}`
        : "no rows",
    );
    check(
      `${name}: nothing follows anything, because nothing scrolls`,
      g.maxScroll <= 1 && g.pill == null,
      `${g.maxScroll}px of scroll`,
    );
    checkTheCellsSurvive(m, name);
    check(
      /*
       * FIT IS NEVER LARGER THAN SCROLL — which is a weaker sentence than
       * "denser" and the true one. Fit's `min()` carries Scroll's own `rem`
       * term as one of its arguments, so the two CONVERGE once the band is
       * wide enough to hold the whole draft at full size: at 1440p and above,
       * with the safe area at its television default, Fit has nothing left to
       * shrink and draws exactly the board Scroll does. Asserting strict
       * inequality there was asserting that the board must still be too big
       * for the screen.
       */
      `${name}: Fit is never larger than Scroll, so a name that fits one fits both`,
      m.fonts.name <= scroll.fonts.name + 0.01,
      `name ${scroll.fonts.name}px in Scroll, ${m.fonts.name}px in Fit` +
        (m.fonts.name >= scroll.fonts.name - 0.01
          ? " — the band holds the whole draft at full size, so the two modes agree"
          : ""),
    );

    reported.push({
      viewport: name,
      scrollName: scroll.fonts.name,
      fitName: m.fonts.name,
      fitMeta: m.fonts.meta,
      rowHeight: g.rowHeight,
    });

    if (viewport === PROJECTOR) {
      await shot(page, "tv-fit-projector");

      /* And the safe area still rescales the board rather than being ignored. */
      const before = await geometry(page);
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press(`${mod}+Shift+ArrowUp`);
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(600);
      const tighter = await geometry(page);
      const tightM = await cellMetrics(page);
      check(
        `${name}: tightening the band in Fit rescales the board`,
        tighter.rowHeight < before.rowHeight,
        `round ${before.rowHeight}px → ${tighter.rowHeight}px at ` +
          `${Math.round(tighter.safe.bottom * 100)}%`,
      );
      check(
        `${name}: …and all ${DRAFT.rounds} rounds are inside the NEW band`,
        tighter.lastRow != null &&
          tighter.lastRow.bottom <= tighter.bandBottom + 1 &&
          tighter.scrollHeight <= tighter.clientHeight + 1,
        tighter.lastRow
          ? `round ${LAST_ROUND} bottom ${tighter.lastRow.bottom}px, band bottom ${tighter.bandBottom}px`
          : "no rows",
      );
      checkTheCellsSurvive(tightM, `${name} at a tightened band`);
      await shot(page, "tv-fit-tightened");

      /*
       * And the choice survives a reload, which is what persisting it is for.
       * The band is widened back with the arrows rather than with ⌘⌥0, which is
       * the one reset and would put Fit back to Scroll along with everything
       * else — that is what ⌘⌥0 is for, and it is asserted in its own section.
       */
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press(`${mod}+Shift+ArrowDown`);
        await page.waitForTimeout(90);
      }
      await page.waitForTimeout(400);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForSelector("[data-slot-id][title]");
      await page.waitForTimeout(900);
      const reloaded = await geometry(page);
      check(
        "the Fit choice survives a reload",
        reloaded.rounds === DRAFT.rounds && reloaded.maxScroll <= 1,
        `${reloaded.maxScroll}px of scroll after reload`,
      );
      const stored = await page.evaluate(
        (key) => window.localStorage.getItem(key),
        FIT_KEY,
      );
      check("…and it is the value that was written to storage", stored === "1", stored ?? "");

      /* Back to Scroll, and the board follows again. */
      await page.keyboard.press(`${mod}+Shift+F`);
      await page.waitForTimeout(800);
      const back = await geometry(page);
      check(
        /* Same correction as the floor check above: leaving Fit restores
           Scroll's LAYOUT — full type and the floor reserved — and whether
           there is anything left to scroll is the display's answer, not the
           mode's. See `everyRoundIsInTheBand`. */
        "⌘⇧F switches back to Scroll, with the floor reserved and no round stranded",
        back.padBottom > 0 && (back.maxScroll > 0 || everyRoundIsInTheBand(back)),
        `${back.maxScroll}px of scroll` +
          (back.maxScroll > 0 ? "" : `, all ${back.rounds} rounds already in the band`),
      );
      checkActiveRoundIsInTheBand(back, "back in Scroll");
      await shot(page, "tv-scroll-projector");
    }

    await context.close();
  }

  /*
   * BOTH MODES AT 60%, which is the size a screenshot gets read at rather than
   * the size it is taken at — the same downscale `verify-roster-pane.mjs` uses,
   * and the only honest way to compare two densities side by side.
   */
  for (const mode of ["scroll", "fit"]) {
    const context = await browser.newContext({
      viewport: PROJECTOR,
      deviceScaleFactor: 0.6,
    });
    await context.addInitScript(seedSafeArea, [SAFE_KEY, JSON.stringify(DEFAULT_SAFE)]);
    await context.addInitScript(seedSafeArea, [FIT_KEY, mode === "fit" ? "1" : "0"]);
    const page = await context.newPage();
    await page.goto(`${BASE}/draft?tv=1`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-slot-id][title]");
    await page.waitForTimeout(800);
    await shot(page, `tv-${mode}-projector-60pct`);
    await context.close();
  }

  section("What Fit costs, in arcminutes from the furthest seat");
  for (const r of reported) {
    console.log(
      `    ${r.viewport}: name ${r.fitName}px = ${arcmin(r.fitName)}′ ` +
        `(Scroll ${r.scrollName}px = ${arcmin(r.scrollName)}′, floor ${NAME_FLOOR_ARCMIN}′) · ` +
        `metadata ${r.fitMeta}px = ${arcmin(r.fitMeta)}′ (floor ${META_FLOOR_ARCMIN}′) · ` +
        `round ${r.rowHeight}px`,
    );
  }
  const room = reported.find((r) => r.viewport === `${PROJECTOR.width}x${PROJECTOR.height}`);
  /*
   * WHAT SCROLL HAS TO BEAT IS FIT, NOT THE COMFORT TARGET.
   *
   * This asserted `Scroll clears 16′`, and it did, against a room made of a
   * 220-inch projection read from 18 ft. The draft is on a 65-inch television:
   * a tenth of 56.65 inches cannot hold a name that subtends 16′ from the far
   * end of a living room whatever the CSS says, and asserting it here would
   * only be satisfiable by making the room constants describe a screen nobody
   * owns. So the two things that ARE the board's to control are what is
   * asserted — that Scroll is the larger of the two modes, which is why it is
   * the default, and that it is above the angle an eye resolves at all — and
   * the comfort target is reported as the distance it corresponds to.
   */
  check(
    "Scroll draws the name larger than Fit at 1080p, which is why it is the default",
    room.scrollName > room.fitName,
    `Scroll ${room.scrollName}px / ${arcmin(room.scrollName)}′ vs Fit ${room.fitName}px / ${arcmin(room.fitName)}′`,
  );
  check(
    `…and clears the ${RESOLVABLE_ARCMIN}′ an eye resolves at all, from the furthest seat`,
    arcmin(room.scrollName) >= RESOLVABLE_ARCMIN,
    `${room.scrollName}px, ${arcmin(room.scrollName)}′ at ${FURTHEST_VIEWER_IN / 12}ft`,
  );
  const comfortableFt = (px) =>
    Math.round(((px * CAP_RATIO * 3438) / PX_PER_INCH / NAME_FLOOR_ARCMIN / 12) * 10) / 10;
  console.log(
    `    Against the ${NAME_FLOOR_ARCMIN}′ comfort target, Scroll is comfortable within ` +
      `${comfortableFt(room.scrollName)}ft of a 65in panel and Fit within ` +
      `${comfortableFt(room.fitName)}ft. The room sits 8–${FURTHEST_VIEWER_IN / 12}ft back, so ` +
      `neither reaches the far seat comfortably — the width of a tenth of the panel is the ` +
      `limit, not the type scale. Scroll is the one that gets closest.`,
  );
}

// --- The density range, and the readout that makes it a decision ------------

/**
 * How far the density control can now reach, and what it says while it moves.
 *
 * The old floor of 0.9 was derived from the arcminute model and therefore
 * assumed the model is right about a room nobody has measured with a projector
 * running in it. The bar now is that ⌘⇧− reaches EVERY ROUND ON THE BOARD in
 * Scroll — "I prefer to see as much of the board as possible" — and that the
 * readout tells him what he traded to get there.
 */
async function checkTheDensityRange(browser) {
  section("The density range, and the readout");
  const { context, page } = await tvPage(browser, PROJECTOR);
  const mod = process.platform === "darwin" ? "Meta" : "Control";

  const readout = () =>
    page.evaluate(() => {
      const el = document.querySelector("[data-board-readout]");
      if (!el) return null;
      return {
        text: el.innerText.replace(/\s+/g, " ").trim(),
        shown: getComputedStyle(el).opacity !== "0",
      };
    });

  const before = await geometry(page);
  await page.keyboard.press(`${mod}+Shift+Minus`);
  await page.waitForTimeout(120);
  const flashed = await readout();
  check(
    "one press of ⌘⇧− puts the readout up at once",
    flashed != null && flashed.shown,
    flashed?.text ?? "no readout",
  );
  check(
    "…and it names the rounds, which is the quantity he asked about",
    /\d+ ROUNDS/.test(flashed?.text ?? ""),
    flashed?.text ?? "",
  );

  /* All the way down. 0.4 from 1.0 in 5% steps is twelve presses; press more,
     and the clamp is asserted below by the value the readout settles on. */
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press(`${mod}+Shift+Minus`);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(600);
  const dense = await geometry(page);
  const denseRead = await readout();
  /*
   * THE GEOMETRY, NOT A COUNT DERIVED FROM IT. "Every round is on screen" means
   * the last round's bottom edge is inside the band with nothing left to
   * scroll, and that is asserted directly — a rounds figure computed out here
   * could agree with the readout because both are wrong the same way.
   * `roundsInBand` is then checked against it, which is what makes the number
   * the room reads trustworthy rather than merely present.
   */
  check(
    `⌘⇧− reaches all ${DRAFT.rounds} rounds inside the band, in Scroll mode`,
    dense.maxScroll <= 1 && dense.lastRow.bottom <= dense.bandBottom + 1,
    `round ${LAST_ROUND} bottom ${dense.lastRow.bottom}px of a ${dense.bandBottom}px band, ` +
      `${dense.maxScroll}px left to scroll, ${dense.pitch}px a round`,
  );
  check(
    `…and the readout on screen says ${DRAFT.rounds}, which is what he reads`,
    roundsInBand(dense) === DRAFT.rounds &&
      new RegExp(`\\s${DRAFT.rounds} ROUNDS`).test(denseRead?.text ?? ""),
    `${roundsInBand(dense)} by measurement — ${denseRead?.text ?? "no readout"}`,
  );
  check(
    "…and the density clamped at the widened floor rather than running on",
    new RegExp(`DENSITY ${DENSITY_MIN.toFixed(2)}\\b`).test(denseRead?.text ?? ""),
    denseRead?.text ?? "",
  );
  check(
    /*
     * The warning is a DISTANCE now rather than an adjective. "Tight from the
     * back" and "front rows only" were written for a room with a back and rows
     * in it; the draft is ten people around a 65-inch television, where the
     * useful form of the same fact is how close you have to be — a number
     * somebody can look across the room and judge. See `legibilityNote`.
     */
    "…and the readout warns how close you have to be for it to be comfortable",
    /′/.test(denseRead?.text ?? "") &&
      /COMFORTABLE WITHIN [\d.]+FT/i.test(denseRead?.text ?? ""),
    denseRead?.text ?? "",
  );
  await shot(page, "tv-density-floor");

  /* And back up, to prove the other end of the clamp is where it is claimed.
     0.4 to 1.25 is seventeen steps; the spares land on the clamp, which
     publishes nothing, so the readout is still up when it is read. */
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press(`${mod}+Shift+Equal`);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(300);
  const loose = await geometry(page);
  const looseRead = await readout();
  check(
    "⌘⇧= clamps at the ceiling, and the board is at its largest there",
    new RegExp(`DENSITY ${DENSITY_MAX.toFixed(2)}\\b`).test(looseRead?.text ?? "") &&
      loose.pitch > dense.pitch,
    `${looseRead?.text ?? "no readout"} — ${loose.pitch}px a round against ` +
      `${dense.pitch}px at the floor`,
  );

  await page.waitForTimeout(2100);
  check("the readout fades two seconds after the last press", !(await readout())?.shown);

  /* And ⌘⌥0 is the one key that puts the whole board back. */
  await page.keyboard.press(`${mod}+Shift+F`);
  await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press(`${mod}+Shift+ArrowUp`);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(500);
  await page.keyboard.press(`${mod}+Alt+Digit0`);
  await page.waitForTimeout(800);
  const reset = await geometry(page);
  check(
    /*
     * `maxScroll > 0` was standing in for "the board is back in Scroll", and
     * it stopped meaning that when the safe area's default widened: Scroll at
     * the television band has all fifteen rounds on screen and nothing left to
     * scroll. The three things the reset actually promises are the band, the
     * density and the layout, so all three are named — the band by its value,
     * the density by the row coming back to the height it had, and the layout
     * by no round being stranded. See `everyRoundIsInTheBand`.
     */
    "⌘⌥0 puts the band, the density and the layout all back to what shipped",
    Math.abs(reset.safe.bottom * 100 - DEFAULT_SAFE.bottom) < 0.5 &&
      Math.abs(reset.rowHeight - before.rowHeight) < 0.5 &&
      (reset.maxScroll > 0 || everyRoundIsInTheBand(reset)),
    `band ${Math.round(reset.safe.bottom * 100)}%, round ${reset.rowHeight}px ` +
      `(was ${before.rowHeight}px), ${reset.maxScroll}px of scroll` +
      (reset.maxScroll > 0 ? "" : `, all ${reset.rounds} rounds in the band`),
  );

  await context.close();
}

// --- Browser zoom, which the board was structurally immune to ---------------

/**
 * ⌘+ / ⌘− reaching the board again.
 *
 * HOW ZOOM IS DRIVEN HERE, because a test that does not actually change the
 * rendered scale would prove nothing — the same trap the fullscreen assertions
 * fell into. Browser zoom does exactly two things: it divides the viewport's
 * CSS width by the zoom factor, and multiplies the device pixel ratio by it. So
 * a 1920x1080 screen at 125% is a `1536x864` viewport at `deviceScaleFactor:
 * 1.25`, and that is what is set here. `Emulation.setPageScaleFactor` would
 * have been the wrong tool: it is pinch zoom, and it does not change a single
 * CSS pixel, which is precisely the property that makes `vw` immune.
 *
 * The consequence being asserted is physical size, so every measurement is
 * converted to DEVICE pixels — CSS pixels are the unit that stays still under
 * zoom, and comparing those is how you conclude nothing happened when the whole
 * screen just changed size.
 */
async function checkZoom(browser) {
  section("Browser zoom, in Scroll and in Fit");
  const rows = [];

  for (const zoom of [1, 0.8, 1.25]) {
    for (const mode of ["scroll", "fit"]) {
      const viewport = {
        width: Math.round(PROJECTOR.width / zoom),
        height: Math.round(PROJECTOR.height / zoom),
      };
      const context = await browser.newContext({ viewport, deviceScaleFactor: zoom });
      await context.addInitScript(seedSafeArea, [SAFE_KEY, JSON.stringify(DEFAULT_SAFE)]);
      await context.addInitScript(seedSafeArea, [FIT_KEY, mode === "fit" ? "1" : "0"]);
      const page = await context.newPage();
      await page.goto(`${BASE}/draft?tv=1`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-slot-id][title]");
      await page.waitForTimeout(800);

      const g = await geometry(page);
      const m = await cellMetrics(page);
      const label = `${Math.round(zoom * 100)}% ${mode}`;

      checkTheCellsSurvive(m, label);
      if (mode === "fit") {
        check(
          `${label}: still fits the band with nothing to scroll`,
          g.scrollHeight <= g.clientHeight + 1 &&
            g.rounds === DRAFT.rounds &&
            g.lastRow.bottom <= g.bandBottom + 1,
          `${g.maxScroll}px of scroll, round ${LAST_ROUND} bottom ${g.lastRow.bottom}px of a ` +
            `${g.bandBottom}px band`,
        );
      } else {
        checkActiveRoundIsInTheBand(g, label);
      }

      rows.push({
        zoom,
        mode,
        /* DEVICE pixels: what the projector actually paints, and the only unit
           in which "did zoom do anything" is a meaningful question. */
        nameDevicePx: Math.round(m.fonts.name * zoom * 100) / 100,
        nameCssPx: m.fonts.name,
        railDevicePx: Math.round(g.railPx * zoom * 100) / 100,
        rounds: mode === "fit" ? DRAFT.rounds : roundsInBand(g),
      });

      await context.close();
    }
  }

  const at = (zoom, mode) => rows.find((r) => r.zoom === zoom && r.mode === mode);
  const base = at(1, "scroll");
  const out = at(0.8, "scroll");
  const inn = at(1.25, "scroll");

  check(
    /*
     * "…and puts more rounds on screen" was the POINT of zooming out when the
     * band held eleven of fifteen. At the television default it holds all
     * fifteen at 100%, so there is no sixteenth round for 80% to reveal and
     * the clause can only fail. What zoom has to do is still asserted, in the
     * unit that means something: the board gets physically smaller, and it
     * does not lose a round on the way.
     */
    "zooming OUT shrinks the board without dropping a round off the screen",
    out.nameDevicePx < base.nameDevicePx - 0.1 && out.rounds >= base.rounds,
    `${base.nameDevicePx}px and ${base.rounds} rounds at 100%, ` +
      `${out.nameDevicePx}px and ${out.rounds} rounds at 80%` +
      (out.rounds === base.rounds
        ? ` — all ${DRAFT.rounds} already fit at 100%, so there is no round left to reveal`
        : ""),
  );
  check(
    "the round rail moves WITH the type instead of staying its own size",
    out.railDevicePx < base.railDevicePx - 0.1 &&
      inn.railDevicePx > base.railDevicePx + 0.1,
    `rail ${out.railDevicePx}px / ${base.railDevicePx}px / ${inn.railDevicePx}px ` +
      `at 80/100/125% against names ${out.nameDevicePx}/${base.nameDevicePx}/` +
      `${inn.nameDevicePx}px`,
  );
  check(
    "…and never outgrows the names it labels, which is what `vw` let it do",
    rows.every((r) => r.railDevicePx <= r.nameDevicePx + 0.01),
    rows
      .map((r) => `${Math.round(r.zoom * 100)}% ${r.railDevicePx}≤${r.nameDevicePx}`)
      .join(", "),
  );
  check(
    "zooming IN grows the board rather than doing nothing at all",
    inn.nameDevicePx > base.nameDevicePx + 0.1,
    `${base.nameDevicePx}px at 100%, ${inn.nameDevicePx}px at 125% — ` +
      `+${Math.round(((inn.nameDevicePx / base.nameDevicePx) - 1) * 1000) / 10}%`,
  );
  check(
    /* See the note on the Fit/Scroll comparison above: the comfort target is
       out of a 65-inch panel's reach at ten columns, so what is asserted is
       the angle below which a letter is not small but absent. */
    `and the default at 100% is still resolvable at ${RESOLVABLE_ARCMIN}′ from the furthest seat`,
    arcmin(base.nameCssPx) >= RESOLVABLE_ARCMIN,
    `${base.nameCssPx}px, ${arcmin(base.nameCssPx)}′ — comfortable within ` +
      `${Math.round(((base.nameCssPx * CAP_RATIO * 3438) / PX_PER_INCH / NAME_FLOOR_ARCMIN / 12) * 10) / 10}ft`,
  );

  console.log("    Zoom, in device pixels on the 1080p signal:");
  for (const r of rows) {
    console.log(
      `      ${String(Math.round(r.zoom * 100)).padStart(3)}% ${r.mode.padEnd(6)} ` +
        `name ${r.nameDevicePx}px (${r.nameCssPx}px CSS) · ${r.rounds} rounds`,
    );
  }
}

// --- 4: a committed pick re-follows ----------------------------------------

async function checkACommittedPickRefollows(browser) {
  section("A pick entered from the keyboard, and the board following it");
  const { context, page } = await tvPage(browser, PROJECTOR);

  const before = await geometry(page);
  await typeAtDocument(page, "mccaffrey");
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  /*
   * Immediately, not after the flash. `FLASH_MS` is 3.4 seconds and the
   * announcement covers the middle of the screen, so the travel happens behind
   * it and is nearly invisible; delaying would move the board at the exact
   * moment the room looks back at it.
   */
  await page.waitForTimeout(500);
  const during = await geometry(page);
  check(
    "the pick landed and the clock moved on",
    during.activeLabel != null && during.activeLabel !== before.activeLabel,
    `${before.activeLabel} → ${during.activeLabel}`,
  );
  checkActiveRoundIsInTheBand(during, "behind the announcement");

  await page.waitForTimeout(FLASH_MS);
  const after = await geometry(page);
  checkActiveRoundIsInTheBand(after, "once the announcement clears");
  await shot(page, "tv-follow-after-pick");

  await context.close();
}

// --- The mock renders the same grid, and must follow too --------------------

async function checkTheMockFollows(browser) {
  section("The mock — same grid, same follow");
  const context = await browser.newContext({
    viewport: PROJECTOR,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(seedSafeArea, [SAFE_KEY, JSON.stringify(DEFAULT_SAFE)]);
  const page = await context.newPage();
  await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });
  await page.goto(`${BASE}/mock?tv=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  /*
   * Started in WATCH mode — no franchise claimed — so all ten are bots and the
   * clock advances without anything being typed. That is what makes the follow
   * observable here: on the live board the cursor is walked, and in a mock
   * there is no cursor, so the draft itself has to be the thing that moves.
   *
   * Driven through the setup screen's own controls rather than through
   * `verify-mock-browser.mjs`, which is being repaired elsewhere.
   */
  await page.getByTitle("Begin the mock with these settings").click();
  await page.waitForTimeout(1200);

  const started = await page.waitForSelector("[data-slot-id][title]").catch(() => null);
  check("the mock started and drew its grid", started != null);
  if (!started) {
    await context.close();
    return;
  }

  const g = await geometry(page);
  check(
    "the mock is in TV mode and carries the same trailing space",
    g.padBottom > 0 && g.maxScroll > 0,
    `${g.padBottom}px of trailing space, ${g.maxScroll}px of scroll`,
  );
  check(
    "…and it reads the same safe area",
    Math.abs(g.safe.bottom - DEFAULT_SAFE.bottom / 100) < 0.001,
    `bottom ${g.safe.bottom}`,
  );

  /*
   * The bots drive the clock here, so following is proved by letting the draft
   * run past a round boundary and asking where the board ended up rather than
   * by walking a cursor there is none of.
   */
  let deepest = g;
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(700);
    const at = await geometry(page);
    if (!at.activeRow) break;
    deepest = at;
    if (at.activeRound >= 8) break;
  }
  check(
    "the mock's clock ran past a round boundary",
    (deepest.activeRound ?? 0) > (g.activeRound ?? 0),
    `round ${g.activeRound} → ${deepest.activeRound}`,
  );
  checkActiveRoundIsInTheBand(deepest, "the mock");
  check(
    /*
     * The claim is that the mock KEEPS THE ACTIVE ROUND IN THE BAND the way the
     * live board does, and `checkActiveRoundIsInTheBand` above is what proves
     * it. Scrolling was the mechanism, and it stopped being a necessary one at
     * the television's band: the mock's own banner leaves it a little to
     * scroll, but round 8 is inside the band already, so a follow that moved
     * the board would be moving it for no reason.
     */
    "and the mock did not have to scroll to keep up, because the round was already in the band",
    deepest.scrollTop > 0 || deepest.activeRow.bottom <= deepest.bandBottom + 1,
    `scrollTop ${deepest.scrollTop} of ${deepest.maxScroll} at round ${deepest.activeRound}`,
  );
  await shot(page, "tv-follow-mock");

  await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });
  await context.close();
}

// --- Run --------------------------------------------------------------------

/*
 * The pick in section 4 is a REAL pick against the real board, so the board is
 * borrowed rather than trusted to survive. The guard refuses outright if the
 * draft is running, vaults the file on disk before the first write and restores
 * on every exit path including a signal — see `live-board-guard.mjs`.
 *
 * What the vault cannot cover is a BASE that is not serving from the file it
 * vaulted. Point this at the deployment, or at a server with `DRAFT_STORE=
 * database`, and section 4's pick lands in Postgres while the restore below
 * dutifully confirms an untouched local file — a real pick added to the real
 * draft under a run that reports every check passing. `assertLocalBase` comes
 * before the lock so a run that was never going to write where it thinks stops
 * before taking one. `assertServerHasNoPicks` comes after the borrow, because
 * the borrow is what recovers a fixture stranded by a run that died; asking
 * first would see that fixture's picks and refuse, leaving it stranded.
 */
assertLocalBase(BASE);
const guard = borrowLiveBoard("verify-tv-follow");
await assertServerHasNoPicks(BASE);
const shaBefore = sha();

const browser = await chromium.launch();
try {
  await checkEachViewport(browser);
  await checkFitMode(browser);
  await checkZoom(browser);
  await checkTheDensityRange(browser);
  await checkSuspendAndResume(browser);
  await checkTheSafeArea(browser);
  await checkACommittedPickRefollows(browser);
  await checkTheMockFollows(browser);
} finally {
  await browser.close();
}

const restored = guard.putBack();
check(
  "the live board is byte-identical to how this run found it",
  restored && sha() === shaBefore,
  `${sha().slice(0, 16)}… (was ${shaBefore.slice(0, 16)}…)`,
);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

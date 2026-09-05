/**
 * Proves the Rosters wall puts all ten rosters, all sixteen slots each, on one
 * screen with nothing cut — on all three surfaces that host it.
 *
 *   BASE=http://localhost:3213 node scripts/verify-roster-wall.mjs
 *
 * THE FAILURE THIS EXISTS FOR. The wall gave every slot row `min-h-[2.5rem]`
 * and `shrink-0`, and put `overflow-y-auto` on the surface around them. Sixteen
 * rows that refuse to go under 40px need about 730px, and the mock's Rosters tab
 * has 639px at 1366x768 — so the wall stopped fitting and started SCROLLING,
 * which on this surface is the whole failure: "the final board and rosters view
 * can be all 16 rounds shown fully -- we'll be up walking around wanting to see
 * the full board in its entirety." It scrolled by 80px at 1440x780, 89px at
 * 1366x768 and 78px at 1024x768, and none of it was visible from the source.
 *
 * Two things were cutting text as well, both from a floor that stopped type
 * shrinking when its box did:
 *
 *   · The name was `clamp(0.62rem, 0.6vw, 0.95rem)`, so below about 1550px wide
 *     it stuck at 9.92px while the column kept narrowing. At 1024x768 that put
 *     "Omarion Hampton" and "J. Croskey-Merritt" 3px over an 87px box, and
 *     `truncate` ellipsised them.
 *   · The club and bye line was `PlayerMeta`, sized in `vw` for a board cell
 *     three times this tall. In a 34px cell the flex column shrank its box below
 *     its own line height, and because `truncate` means `overflow: hidden`, the
 *     text was cut rather than spilling.
 *
 * SO THIS MEASURES, at every viewport the league actually uses, on all three
 * surfaces, against a board holding all 160 players:
 *
 *   · NOTHING SCROLLS. `scrollHeight <= clientHeight` on the wall's own
 *     scroller, and the document no taller than the window. Sixteen slot rows
 *     and a header, all of them on screen.
 *   · NOTHING IS CUT. No element in the wall carries `text-overflow: ellipsis`
 *     or a line clamp — a name that fits today under a rule that would cut it
 *     tomorrow is not a pass — and no string is wider or taller than the box it
 *     is painted into. Measured with a `Range` over the text rather than with
 *     `scrollWidth`: once the ellipsis is gone the box no longer scrolls, so
 *     `scrollWidth` reports the box and would agree with itself forever.
 *   · NOTHING IS SQUASHED. Every line's box is at least its own line height. A
 *     flex column shrinks its children before it overflows, and a shrunk line
 *     box crops the glyphs inside it.
 *   · EVERY CELL IS THE SAME SHAPE. One height, one set of line offsets and one
 *     computed type across all 160, filled or open.
 *
 * And then again with the widest names the league's player file contains
 * substituted into all 160 cells, because the name that decides this layout is
 * "Dorian Thompson-Robinson" — 11.7px of Inter Black per px of font size — and
 * not whoever the mock happened to draft.
 *
 * 390x844 IS REPORTED, NOT ASSERTED. A phone cannot hold ten columns of a
 * sixteen-row grid without scrolling and there is no point pretending
 * otherwise; the wall already scrolls sideways there by design. The numbers are
 * printed so the cost is on the record.
 *
 * Screenshots land in `screenshots/`.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/* The wall's own printing rule, imported rather than restated, so this cannot
   hold a second copy of it that agrees with nothing. */
import { boardName } from "../src/lib/board-name.ts";
import { ROSTER } from "../src/lib/league-config.ts";

const BASE = process.env.BASE ?? "http://localhost:3213";
const OUT = path.join(process.cwd(), "screenshots");

/** Sixteen slot rows: nine starters and the bench, from the league's own config. */
const SLOT_ROWS = ROSTER.activeCap;

const VIEWPORTS = [
  { name: "projector", width: 1920, height: 1080, tv: true },
  { name: "projector-windowed", width: 1920, height: 1080 },
  { name: "retina", width: 2560, height: 1440 },
  { name: "macbook-pro", width: 1512, height: 982 },
  { name: "laptop", width: 1440, height: 900 },
  { name: "laptop-window", width: 1440, height: 780 },
  { name: "small-laptop", width: 1366, height: 768 },
  { name: "narrow-laptop", width: 1280, height: 800 },
  { name: "ipad", width: 1024, height: 768 },
  /* Reported only — see the note above. */
  { name: "phone", width: 390, height: 844, report: true },
];

const SURFACES = [
  { name: "/draft", slug: "draft", url: "/draft" },
  { name: "/mock", slug: "mock", url: "/mock", mock: true },
  { name: "/draft/final", slug: "final", url: "/draft/final" },
];

/** The widths worth a picture: the projector and the MacBook Air that broke. */
const SHOT_AT = new Set([1920, 1440]);

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

/** The widest names the wall could ever be asked to print, as it prints them. */
function widestNames(count = 24) {
  const pool = JSON.parse(
    readFileSync(path.join(process.cwd(), "data/smartdraft-players.json"), "utf8"),
  );
  const players = Array.isArray(pool) ? pool : pool.players;
  const printed = [...new Set(players.map((p) => boardName(p.name, p.position)))];
  /* Length only picks the candidates; the widths that decide anything are
     measured in the browser, in the font actually in use. */
  return printed.sort((a, b) => b.length - a.length).slice(0, count);
}

/**
 * The whole wall, read out of the DOM.
 *
 * Every filled cell is three lines — position and pick, name, club and bye — so
 * a cell is found by having three element children and a `title`, and its lines
 * are read positionally. A cell that stopped printing one of them fails the
 * shape checks rather than being measured as though it had not.
 */
async function readWall(page) {
  return page.evaluate(() => {
    const r2 = (n) => Math.round(n * 100) / 100;
    const cs = (el) => getComputedStyle(el);
    const wall = [...document.querySelectorAll("main")].find((m) =>
      /--ukl-gutter/.test(m.className),
    );
    if (!wall) return { found: false };

    /**
     * The real width and height of the text in an element, off a Range rather
     * than off `scrollWidth`. `scrollWidth` is the scrollable area, which for a
     * box with `overflow: visible` is just the box — so it cannot see a string
     * hanging out of one, which is exactly the case this has to catch.
     */
    const textBox = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const b = range.getBoundingClientRect();
      return { w: b.width, h: b.height };
    };

    const rows = [...wall.children].filter((el) =>
      /container-type/.test(el.getAttribute("class") ?? ""),
    );
    const cells = [...wall.querySelectorAll("[title]")].filter(
      (el) => /rounded border/.test(String(el.className)) && el.closest("main") === wall,
    );
    const filled = cells.filter((el) => el.children.length === 3);
    const open = [...wall.querySelectorAll("div")].filter(
      (el) => el.children.length === 1 && el.children[0].textContent?.trim() === "open",
    );

    /* Anything that could cut a word, now or later. SVG excluded: a glyph-shaped
       icon clips its own viewBox and always has. */
    const cutters = [wall, ...wall.querySelectorAll("*")]
      .filter((el) => el.tagName !== "svg" && !el.closest("svg"))
      .filter((el) => {
        const s = cs(el);
        return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
      })
      .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);

    /*
     * Everything in the wall that holds text of its own. Two exclusions:
     *
     *   · An element whose text lives in a child. Its height is its child's, and
     *     asking whether "QB" plus "1.01" fits the row that holds them both is a
     *     question about the two spans, not about their parent.
     *   · An element still laid out `inline`. `clientWidth` and `clientHeight`
     *     are zero on an inline box and its rect is the glyphs rather than the
     *     line, so both measurements below would read as a catastrophe on a
     *     column header that is in fact wrapping exactly as intended. Its block
     *     parent is measured instead, which is where the box actually is.
     */
    const leaves = [...wall.querySelectorAll("*")].filter((el) => {
      if (el.tagName === "svg" || el.closest("svg")) return false;
      const d = cs(el).display;
      if (d === "inline" || d === "contents") return false;
      return [...el.childNodes].some(
        (n) => n.nodeType === 3 && (n.textContent ?? "").trim(),
      );
    });
    /* A string wider than its own box. The 1px tolerance is sub-pixel layout
       rounding; the truncation this replaced was 3px to 8px over. */
    const overflowing = leaves
      .map((el) => ({
        text: (el.textContent ?? "").trim().slice(0, 24),
        over: r2(textBox(el).w - el.clientWidth),
      }))
      .filter((x) => x.over > 1);

    /* A line box shrunk below its own line height crops the glyphs inside it. */
    const squashed = leaves
      .map((el) => ({
        text: (el.textContent ?? "").trim().slice(0, 20),
        h: r2(el.getBoundingClientRect().height),
        lh: r2(parseFloat(cs(el).lineHeight)),
      }))
      .filter((x) => x.lh - x.h > 0.5);

    /* A line painted below the bottom of the cell it belongs to is sitting on
       the row underneath — the failure the board's own fit check is named for. */
    const spilling = filled
      .filter((cell) => {
        const b = cell.getBoundingClientRect();
        const last = cell.children[cell.children.length - 1].getBoundingClientRect();
        return last.bottom - b.bottom > 0.5;
      })
      .map((cell) => (cell.children[1].textContent ?? "").trim());

    /* Whole pixels: fractional row heights make the last decimal of an offset a
       property of the viewport, not of the layout. */
    const shapeOf = (cell) => {
      const top = cell.getBoundingClientRect().top;
      return [...cell.children]
        .map((k) => Math.round(k.getBoundingClientRect().top - top))
        .join(",");
    };

    const names = filled.map((c) => c.children[1]);

    return {
      found: true,
      viewport: { w: innerWidth, h: innerHeight },
      fullscreen: Boolean(document.fullscreenElement),
      docOverflow: r2(document.documentElement.scrollHeight - innerHeight),
      wallOverflow: r2(wall.scrollHeight - wall.clientHeight),
      wallH: r2(wall.clientHeight),
      wallScrollH: r2(wall.scrollHeight),
      rowCount: rows.length,
      rowHeights: [...new Set(rows.map((r) => r2(r.getBoundingClientRect().height)))].sort(
        (a, b) => a - b,
      ),
      /* Room still going spare under the last row. Negative would mean a row is
         off the bottom of the surface even though the scroller says it fits. */
      slack: rows.length
        ? r2(
            wall.getBoundingClientRect().bottom -
              rows[rows.length - 1].getBoundingClientRect().bottom,
          )
        : null,
      cellCount: cells.length,
      filledCount: filled.length,
      openCount: open.length,
      cellHeights: [
        ...new Set(filled.map((c) => r2(c.getBoundingClientRect().height))),
      ].sort((a, b) => a - b),
      shapes: [...new Set(filled.map(shapeOf))],
      typePx: [...new Set(names.map((n) => r2(parseFloat(cs(n).fontSize))))],
      openHeights: [
        ...new Set(open.map((c) => r2(c.getBoundingClientRect().height))),
      ].sort((a, b) => a - b),
      cutters,
      cutterCount: cutters.length,
      overflowing: overflowing.slice(0, 6),
      overflowCount: overflowing.length,
      squashed: squashed.slice(0, 4),
      squashedCount: squashed.length,
      spilling: spilling.slice(0, 4),
      spillCount: spilling.length,
      widestName: names
        .map((n) => ({
          text: n.textContent.trim(),
          want: r2(textBox(n).w),
          room: r2(n.clientWidth),
        }))
        .sort((a, b) => b.want - a.want)[0],
    };
  });
}

function checkNothingScrolls(w) {
  check(
    "the wall fits its surface with no scrollbar",
    w.wallOverflow <= 1,
    `${w.wallScrollH}px of wall in ${w.wallH}px, ${w.slack}px spare`,
  );
  check("and the page itself is no taller than the window", w.docOverflow <= 1, `${w.docOverflow}px`);
  check(
    `all ${SLOT_ROWS} slot rows drew`,
    w.rowCount === SLOT_ROWS,
    `${w.rowCount} rows`,
  );
  check(
    "and the last of them is above the bottom of the surface",
    w.slack >= -1,
    `${w.slack}px`,
  );
}

function checkNothingIsCut(w) {
  check(
    "no rule in the wall could cut a word — no ellipsis, no line clamp",
    w.cutterCount === 0,
    w.cutters.slice(0, 3).join(" | "),
  );
  check(
    "and no string is wider than the box it is painted in",
    w.overflowCount === 0,
    w.overflowing.map((o) => `"${o.text}" over by ${o.over}px`).join(" | "),
  );
  check(
    "no line box was shrunk below its own line height",
    w.squashedCount === 0,
    w.squashed.map((s) => `"${s.text}" ${s.h} of ${s.lh}`).join(" | "),
  );
  check(
    "and no cell paints a line below its own bottom edge",
    w.spillCount === 0,
    w.spilling.map((t) => `"${t}"`).join(" | "),
  );
}

function checkEveryCellIsTheSameShape(w) {
  check(
    `all ${w.filledCount} filled cells are the same height`,
    w.cellHeights.length === 1 ||
      (w.cellHeights.length === 2 && w.cellHeights[1] - w.cellHeights[0] <= 1),
    `${w.cellHeights.join(", ")}px`,
  );
  check(
    "and lay their three lines out at the same offsets",
    w.shapes.length === 1,
    `${w.shapes.length} shapes: ${w.shapes.slice(0, 3).join("  |  ")}`,
  );
  /* A hundredth of a pixel apart is the row's fractional height reaching the
     type through `cqh`, not a cell that chose its own size. */
  check(
    "and print the name at one computed size across the whole wall",
    w.typePx[w.typePx.length - 1] - w.typePx[0] <= 0.1,
    `${w.typePx.join(", ")}px`,
  );
  const rows = w.rowHeights;
  check(
    "every slot row is the same height",
    rows.length === 1 || (rows.length === 2 && rows[1] - rows[0] <= 1),
    `${rows.join(", ")}px`,
  );
  /* Vacuous on a finished board, which is the point of checking it on a live one:
     the wall the commissioner looks at before the draft is nearly all empty. */
  if (w.openCount > 0 && w.filledCount > 0) {
    check(
      "and an empty slot stands exactly as tall as a filled one",
      Math.abs(w.openHeights[0] - w.cellHeights[0]) <= 1,
      `${w.openHeights.join("/")}px open against ${w.cellHeights.join("/")}px filled`,
    );
  }
}

/**
 * Puts the widest names in the league's player file into all 160 cells.
 *
 * Printed text only — no state, no re-render — because the question is purely
 * one of layout: at the size the wall has chosen for this viewport, does the
 * longest name in the pool still fit the cell it is in.
 */
async function stress(page, names) {
  return page.evaluate((names) => {
    const wall = [...document.querySelectorAll("main")].find((m) =>
      /--ukl-gutter/.test(m.className),
    );
    let i = 0;
    for (const cell of wall.querySelectorAll("[title]")) {
      if (cell.children.length !== 3) continue;
      cell.children[1].textContent = names[i % names.length];
      i++;
    }
    return i;
  }, names);
}

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `roster-wall-${name}.png`) });
  console.log(`    → screenshots/roster-wall-${name}.png`);
}

/** The mock, drafted out to a full board — 160 players, ten rosters at the cap. */
async function fillMock(page) {
  await page.getByTitle(/^Quick/).click();
  await page.waitForTimeout(150);
  await page.getByTitle("Begin the mock with these settings").click();
  await page.waitForTimeout(600);
  await page.getByTitle("Pause the bots").click();
  await page.waitForTimeout(200);
  await page.getByTitle("Autopick every remaining pick at once").click();
  await page.waitForTimeout(2500);
}

async function toRosters(page) {
  await page.getByTitle("All ten rosters (Tab, or ⌘B)").click();
  await page.waitForTimeout(350);
}

const browser = await chromium.launch();
const names = widestNames();

try {
  for (const s of SURFACES) {
    for (const v of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: v.width, height: v.height },
      });
      section(
        `${s.name} — ${v.width}x${v.height}${v.tv ? " TV mode" : ""}` +
          (v.report ? " (reported, not asserted)" : ""),
      );
      if (s.mock) await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });
      await page.goto(`${BASE}${s.url}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500);
      if (v.tv) {
        /* Requested from an evaluated call: headless Chromium refuses
           `requestFullscreen` from a synthetic click and honours it from here. */
        await page.evaluate(() => document.documentElement.requestFullscreen());
        await page.waitForTimeout(500);
      }
      if (s.mock) await fillMock(page);
      await toRosters(page);

      const w = await readWall(page);
      if (!w.found) {
        check("the wall drew itself", false, `${BASE}${s.url}`);
        await page.close();
        continue;
      }
      if (v.tv) check("TV mode is on", w.fullscreen === true);

      if (v.report) {
        console.log(
          `    wall ${w.wallScrollH}px in ${w.wallH}px (${w.wallOverflow}px scrolled),` +
            ` row ${w.rowHeights.join("/")}px, name ${w.typePx.join("/")}px,` +
            ` ${w.overflowCount} strings over their box, ${w.cutterCount} rules that could cut one`,
        );
      } else {
        checkNothingScrolls(w);
        checkNothingIsCut(w);
        checkEveryCellIsTheSameShape(w);
        console.log(
          `    ${w.filledCount} filled and ${w.openCount} open cells,` +
            ` ${w.cellHeights.join("/")}px tall, name ${w.typePx.join("/")}px;` +
            ` widest drawn "${w.widestName?.text}" ${w.widestName?.want}px in` +
            ` ${w.widestName?.room}px`,
        );
        if (SHOT_AT.has(v.width)) await shoot(page, `${s.slug}-${v.name}`);

        /* --- and again with the widest names the pool contains ------------- */
        const swapped = await stress(page, names);
        await page.waitForTimeout(150);
        const x = await readWall(page);
        check(`the widest names in the pool went in (${swapped} cells)`, swapped > 0);
        check(
          "and every one of them fits the cell it landed in",
          x.overflowCount === 0,
          x.overflowing.map((o) => `"${o.text}" over by ${o.over}px`).join(" | "),
        );
        check(
          "and none of them made the wall scroll",
          x.wallOverflow <= 1,
          `${x.wallOverflow}px`,
        );
        console.log(
          `    widest of them drawn "${x.widestName?.text}" ${x.widestName?.want}px` +
            ` in ${x.widestName?.room}px`,
        );
        if (SHOT_AT.has(v.width)) await shoot(page, `${s.slug}-${v.name}-widest`);
      }
      if (v.report) await shoot(page, `${s.slug}-${v.name}`);
      await page.close();
    }
    if (s.mock) await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });
  }

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);

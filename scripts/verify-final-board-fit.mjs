/**
 * Proves that `/draft/final` fits on the screen — all sixteen rounds, all ten
 * franchises, no scroll — with nothing cut, at every window the league will
 * open it in.
 *
 *   BASE=http://localhost:3313 node scripts/verify-final-board-fit.mjs
 *
 * ============================================================================
 * THIS IS THE OPPOSITE RULE FROM `verify-board-fit.mjs`, DELIBERATELY
 * ============================================================================
 *
 * The live board is asserted to SCROLL: it is projected floor-to-ceiling, the
 * bottom of the image is at floor level, and the ruling there is that a legible
 * cell beats a board that fits. Do not copy that assertion into this file.
 *
 * The final board is the wall poster of the finished draft — "we'll be up
 * walking around wanting to see the full board in its entirety" — so it is
 * asserted never to scroll, on either the pane or the page, at any width. It is
 * also read from a foot away rather than from fifteen feet, which is the slack
 * that pays for the fit: there is no projector legibility floor to respect here,
 * and the type is allowed to get genuinely small at a small window.
 *
 * THE TWO REQUIREMENTS FIGHT, AND BOTH ARE ASSERTED. Sixteen rounds inside 768px
 * of window leaves a round about 39px, and the way that used to be made to work
 * was `truncate` — nine names ellipsised at 1024x768 and eight at 390x844,
 * because `--ukl-name` had a `0.68rem` floor that would not follow the column
 * down. So "it fits" is never enough on its own here: every check below runs in
 * pairs, one for the fit and one for what the fit cost.
 *
 * WHAT IT MEASURES
 *
 *   · NOTHING SCROLLS. `scrollHeight <= clientHeight` on the board pane, and
 *     `documentElement.scrollHeight <= innerHeight` so the page has not simply
 *     moved the scroll somewhere else.
 *   · NOTHING IS CUT. No element carries `text-overflow: ellipsis` or a line
 *     clamp — whether or not it happens to be cutting anything today — and no
 *     box inside a cell overflows what it was given.
 *   · EVERY CELL IS THE SAME SHAPE. Height, slot offsets and computed type are
 *     compared across all 160 and have to agree to within a sub-pixel.
 *   · EVERY FACT IS ON SCREEN, whole: the unabbreviated name, position, club,
 *     bye, round, and a padlock on every keeper. The round is checked against
 *     each cell's own tooltip, because it looks like a duplicate of the rail
 *     down the left edge and is not one — see `checkEveryFactIsOnScreen`.
 *   · THE SMALL PRINT CAN BE READ. The club and bye are held to WCAG AA's
 *     4.5:1 against the fill they sit on, measured through a canvas so that
 *     `oklch()` and `color-mix()` are resolved by the browser rather than by a
 *     regex here — and the name is held above them, so "secondary" goes on
 *     meaning smaller and lighter rather than fainter.
 *   · THE BUDGET, AGAINST DATA THAT IS NOT ON THE BOARD. The widest metadata
 *     line the league could ever produce is built out of the real fonts and
 *     measured, and every name in the top 200 by ADP is wrapped in a real cell
 *     to prove it still lands inside the two lines the cell reserves. A board
 *     that fits the draft that happened is not the same claim as a board that
 *     fits.
 *
 * IT BORROWS THE LIVE BOARD. A final board of an unstarted draft is ten empty
 * columns, so this writes a finished mock of 141 picks over
 * `data/draft-state-2026.json` and drives the page off it. Nothing here touches
 * the database.
 *
 * HOW THAT IS MADE SAFE IS NOT IN THIS FILE. `scripts/live-board-guard.mjs`
 * holds the refusal to run against a board with picks on it, the lock that stops
 * two harnesses interleaving, the on-disk vault, the restore on every exit path
 * and the SHA-256 verification of it — read that before changing anything here.
 *
 * This file used to keep the original in a local variable and put it back in a
 * `finally`, with handlers for SIGINT and an uncaught throw. That is not enough
 * and it is the pattern the guard exists to replace. It had no refusal, so run
 * at pick 40 on Saturday it would stamp a finished mock over forty real picks
 * and "restore" the board to the state it had before the run — losing every pick
 * entered inside the window and reporting success. It had no lock, so two
 * harnesses could interleave and one would restore the other's fixture as though
 * it were the league's board. And it held the only copy in memory, so a SIGTERM
 * or a `kill -9` took the board with it.
 *
 * DRIVE IT AGAINST A PRODUCTION BUILD (`next build` && `next start`). The dev
 * server's HMR socket does not come up on this machine, so nothing hydrates and
 * every measurement is of server-rendered HTML.
 *
 * Screenshots land in `screenshots/`.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  assertLocalBase,
  assertServerHasNoPicks,
  borrowLiveBoard,
} from "./live-board-guard.mjs";

const BASE = process.env.BASE ?? "http://localhost:3313";
const OUT = path.join(process.cwd(), "screenshots");
const LIVE_STATE = path.join(process.cwd(), "data", "draft-state-2026.json");

/**
 * Every window the board has to fit, and why each one is on the list.
 *
 * `shot` marks the two the commissioner asked to see: the projector, and the
 * MacBook Air with browser chrome on it — 1440x900 is the screen, the menu bar,
 * the tab strip and the address bar take the rest, and that is the window the
 * scroll was reported from.
 */
const VIEWPORTS = [
  { width: 2560, height: 1440, why: "a 27in display" },
  { width: 1920, height: 1080, why: "the projector", shot: true, tv: true },
  { width: 1512, height: 982, why: "a 14in MacBook Pro" },
  { width: 1440, height: 900, why: "a MacBook Air, fullscreen" },
  { width: 1440, height: 780, why: "a MacBook Air with browser chrome", shot: true },
  { width: 1366, height: 768, why: "the commonest laptop there is" },
  { width: 1280, height: 800, why: "a small laptop" },
  { width: 1024, height: 768, why: "the tightest window that counts", shot: true },
];

/**
 * A phone, reported rather than asserted on the fit.
 *
 * Ten columns of this cannot be made out of 390px and nobody is going to try to
 * read a finished draft on one. The board keeps its own column width there and
 * scrolls SIDEWAYS for it, which is the one axis this surface is allowed to
 * move on — so the vertical fit and the no-clipping rules still hold and are
 * still checked, and the horizontal scroll is expected.
 */
const PHONE = { width: 390, height: 844, why: "a phone, held upright" };

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
const round2 = (n) => Math.round(n * 100) / 100;
/* The board's own digests are the guard's business now; see `putBack`. */

/** The pool the board is sized for: the top 200 by FantasyPros consensus ADP. */
function topByAdp(count = 200) {
  const file = path.join(process.cwd(), "data", "fantasypros-players.json");
  const { players } = JSON.parse(readFileSync(file, "utf8"));
  const ranked = players
    .filter((p) => typeof p.adp === "number")
    .sort((a, b) => a.adp - b.adp);
  return {
    names: ranked.slice(0, count).map((p) => p.name),
    /* Every club abbreviation in the feed, so the widest one is measured rather
       than whichever happened to get drafted. */
    clubs: [...new Set(players.map((p) => p.team).filter(Boolean))],
  };
}

// --- Reading the board ------------------------------------------------------

/**
 * Everything about the board that can go wrong, read out of the DOM.
 *
 * The slots are found by position inside the cell rather than by class, and
 * cross-checked against the cell's own tooltip, so a redesign makes this fail
 * rather than quietly measure the wrong box.
 */
async function readBoard(page) {
  return page.evaluate(() => {
    const r = (n) => Math.round(n * 1000) / 1000;

    /*
     * WCAG CONTRAST, RESOLVED BY THE BROWSER RATHER THAN BY A PARSER HERE.
     *
     * Every colour on this board arrives as `oklch()` or `color-mix()` — the
     * cell fills are literally `color-mix(in oklch, var(--ds-mint) 18%, ...)` —
     * and a regex pulling three numbers out of that reads the oklch triple as
     * if it were sRGB and answers confident nonsense. It rated the near-white
     * player name at 1.05:1 against a WR cell.
     *
     * So the layers are stacked onto a 1px canvas instead, bottom-first, and the
     * pixel is read back: `fillStyle` puts the whole CSS colour system, alpha
     * compositing included, on the job. `paint(under)` is the background the
     * text actually sits on; `paint([...under, colour])` is the text composited
     * over it, which is what matters when the text carries alpha of its own —
     * that alpha is exactly what was pulling the club and bye under the floor.
     */
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    const paint = (layers) => {
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, 0, 1, 1);
      ctx.globalCompositeOperation = "source-over";
      for (const c of layers) {
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
      }
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2]];
    };
    const lin = (v) => {
      const s = v / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = ([R, G, B]) => 0.2126 * lin(R) + 0.7152 * lin(G) + 0.0722 * lin(B);
    /** Every background between an element and the first opaque one, bottom-first. */
    const backdrop = (el) => {
      const layers = [];
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (!bg || bg === "transparent" || /,\s*0\)$/.test(bg)) continue;
        layers.unshift(bg);
        if (!/rgba\(/.test(bg)) break;
      }
      return layers;
    };
    const contrast = (el) => {
      const under = backdrop(el);
      const bg = paint(under);
      const fg = paint([...under, getComputedStyle(el).color]);
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };

    const cellEls = [...document.querySelectorAll("[data-slot-id][title]")];
    const pane = cellEls[0]?.closest("main");
    if (!pane) return null;
    /* The rounds live in their own grid so they can share the height equally;
       the column heads are the pane's other child. */
    const rounds = [...pane.lastElementChild.children];

    const read = (cell) => {
      const box = cell.getBoundingClientRect();
      const stack = cell.firstElementChild;
      const [name, meta] = [...stack.children];
      const offset = (el) => r(el.getBoundingClientRect().top - box.top);
      const text = (el) => (el?.innerText ?? "").trim();

      /* Anything that would cut text, whether or not it is cutting it today. */
      const cutters = [...cell.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
      }).length;

      /*
       * Any box inside the cell that cannot hold its own contents. Blocks only:
       * an inline span has no client box, so Chrome answers 0 for `clientHeight`
       * and something else for `scrollHeight`, and every span would read as
       * overflowing. The 1px tolerance on the ones that do have a box is integer
       * rounding — both properties round, and every length here is a fraction of
       * a container.
       */
      const overflowing = [cell, ...cell.querySelectorAll("*")].filter((el) => {
        const d = getComputedStyle(el).display;
        if (d === "inline" || d === "contents" || el.tagName === "svg") return false;
        return el.scrollHeight - el.clientHeight > 1 || el.scrollWidth - el.clientWidth > 1;
      });

      /*
       * The metadata line is two groups: what he is and when he went on the
       * left, who he plays for and when he is off on the right. Read that way
       * rather than as four siblings, so a regression that flattens them back
       * into one run fails here instead of passing quietly.
       */
      const [lead, tail] = [...meta.children];
      const posTag = lead.firstElementChild;
      const roundEl = lead.children[1];
      const lock = posTag.querySelector("svg");
      const [clubEl, byeEl] = [...tail.children];
      return {
        title: cell.getAttribute("title") ?? "",
        height: r(box.height),
        width: r(box.width),
        slots: { name: offset(name), meta: offset(meta) },
        fonts: {
          name: r(parseFloat(getComputedStyle(name).fontSize)),
          meta: r(parseFloat(getComputedStyle(meta).fontSize)),
          club: r(parseFloat(getComputedStyle(tail).fontSize)),
        },
        /* The gap the commissioner said was not there. Measured edge to edge,
           so it is the white space between the two groups and not the CSS
           `gap`, which is only its floor. */
        groupGap: r(tail.getBoundingClientRect().left - lead.getBoundingClientRect().right),
        contrast: {
          name: contrast(name),
          position: contrast(posTag),
          round: roundEl ? contrast(roundEl) : null,
          club: clubEl ? contrast(clubEl) : null,
          bye: byeEl ? contrast(byeEl) : null,
        },
        roundText: text(roundEl),
        clubText: text(clubEl),
        byeText: text(byeEl),
        name: text(name),
        meta: text(meta),
        /* The name is the one thing allowed to wrap, so what matters is that it
           lands inside the lines the cell set aside for it. */
        nameReserved: r(name.getBoundingClientRect().height),
        nameUsed: name.scrollHeight,
        nameLineWidth: r(name.clientWidth),
        keeperMark: lock ? getComputedStyle(lock).visibility !== "hidden" : false,
        lockBoxed: lock ? lock.getBoundingClientRect().width > 0 : false,
        /* Where the position letters start; must not move for a keeper. */
        tagLeft: r(posTag.getBoundingClientRect().left - box.left),
        cutters,
        overflowing: overflowing.map(
          (el) =>
            `${el.tagName}.${String(el.className).slice(0, 40)} ` +
            `dw=${r(el.scrollWidth - el.clientWidth)} dh=${r(el.scrollHeight - el.clientHeight)}`,
        ),
      };
    };

    return {
      count: cellEls.length,
      /* THE HEADLINE NUMBER. Both of them: the pane, and the page under it. */
      paneScrollHeight: pane.scrollHeight,
      paneClientHeight: pane.clientHeight,
      paneScrollWidth: pane.scrollWidth,
      paneClientWidth: pane.clientWidth,
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      bodyScrollHeight: document.body.scrollHeight,
      rounds: rounds.length,
      roundHeight: r(rounds[2]?.getBoundingClientRect().height ?? 0),
      /* The bottom of the last round, against the bottom of the pane. */
      lastRoundBottom: r(rounds[rounds.length - 1]?.getBoundingClientRect().bottom ?? 0),
      paneBottom: r(pane.getBoundingClientRect().bottom),
      fullscreen: Boolean(document.fullscreenElement),
      hydrated: cellEls[0]
        ? Object.keys(cellEls[0]).some((k) => k.startsWith("__reactFiber"))
        : false,
      cells: cellEls.map(read),
    };
  });
}

/** The name in the cell, checked against the name in the cell's own tooltip. */
function tooltipName(title) {
  return title.match(/^(.+?) — (?:QB|RB|WR|TE|DST),/)?.[1] ?? null;
}

// --- The checks -------------------------------------------------------------

function checkNothingScrolls(b, { expectSideways }) {
  check(
    "the board pane does not scroll — every round is on screen at once",
    b.paneScrollHeight <= b.paneClientHeight,
    `scrollHeight ${b.paneScrollHeight} vs clientHeight ${b.paneClientHeight}` +
      (b.paneScrollHeight > b.paneClientHeight
        ? ` — ${b.paneScrollHeight - b.paneClientHeight}px below the fold`
        : ""),
  );
  check(
    "…and neither does the page under it",
    b.docScrollHeight <= b.innerHeight && b.bodyScrollHeight <= b.innerHeight,
    `document ${b.docScrollHeight} / body ${b.bodyScrollHeight} vs window ${b.innerHeight}`,
  );
  check(
    `all ${b.rounds} rounds are drawn, and the last one ends inside the pane`,
    b.rounds === 16 && b.lastRoundBottom <= b.paneBottom + 1,
    `round ${b.roundHeight}px, last ends ${round2(b.paneBottom - b.lastRoundBottom)}px above the pane's bottom`,
  );
  if (!expectSideways) {
    check(
      "and it does not scroll sideways either",
      b.paneScrollWidth <= b.paneClientWidth + 1,
      `${b.paneScrollWidth} vs ${b.paneClientWidth}`,
    );
  }
}

function checkNothingIsCut(b) {
  const cut = b.cells.filter((c) => c.cutters > 0);
  check(
    "no cell contains anything that could cut text — no ellipsis, no line clamp",
    cut.length === 0,
    cut.length ? `${cut.length} cells` : `${b.count} cells clean`,
  );
  const over = b.cells.filter((c) => c.overflowing.length > 0);
  check(
    "no box inside a cell overflows what it was given",
    over.length === 0,
    over.length
      ? `${over.length} cells, first ${over[0].title.slice(0, 30)} → ${over[0].overflowing[0]}`
      : "",
  );
  const spilled = b.cells.filter((c) => c.nameUsed > c.nameReserved + 1);
  check(
    "every name wraps inside the lines its cell reserves for it",
    spilled.length === 0,
    spilled.length
      ? spilled
          .slice(0, 3)
          .map((c) => `${c.name.replace(/\s+/g, " ")} ${c.nameUsed}>${c.nameReserved}`)
          .join(" | ")
      : `${round2(b.cells[0].nameReserved)}px reserved on a ${b.cells[0].fonts.name}px name`,
  );
}

/**
 * Sub-pixel, not exact. Sixteen rounds share the pane's height through
 * `minmax(0, 1fr)`, and a height that does not divide by sixteen leaves the
 * browser distributing hundredths of a pixel. 0.5px is well inside "the same
 * shape" and well outside anything a layout bug could hide in.
 */
function checkEveryCellIsTheSameShape(b) {
  const spread = (f) => {
    const v = b.cells.map(f);
    return round2(Math.max(...v) - Math.min(...v));
  };
  const heightSpread = spread((c) => c.height);
  check(
    `all ${b.count} cells are the same height`,
    heightSpread <= 0.5,
    `${round2(b.cells[0].height)}px, spread ${heightSpread}px`,
  );
  const nameSpread = spread((c) => c.slots.name);
  const metaSpread = spread((c) => c.slots.meta);
  check(
    "…and lay their slots out at the same offsets",
    nameSpread <= 0.5 && metaSpread <= 0.5,
    `name +${round2(b.cells[0].slots.name)}px (spread ${nameSpread}), ` +
      `meta +${round2(b.cells[0].slots.meta)}px (spread ${metaSpread})`,
  );
  const fontSpread = spread((c) => c.fonts.name);
  check(
    "…and render one type size across the whole board",
    fontSpread <= 0.1 && spread((c) => c.fonts.meta) <= 0.1,
    `name ${b.cells[0].fonts.name}px, meta ${b.cells[0].fonts.meta}px`,
  );
  /* The horizontal half of it: a padlock must not indent the position tag in
     the cells that have one. */
  const tagSpread = spread((c) => c.tagLeft);
  check(
    "the position letters start at the same x in every cell, keeper or not",
    tagSpread <= 0.5,
    `spread ${tagSpread}px`,
  );
}

function checkEveryFactIsOnScreen(b) {
  const filled = b.cells.filter((c) => tooltipName(c.title));
  check(`there are filled cells to check (${filled.length} of ${b.count})`, filled.length > 100);

  const wrongName = filled.filter(
    (c) => c.name.replace(/\s+/g, " ").trim() !== tooltipName(c.title),
  );
  check(
    "every filled cell prints the player's whole name, unabbreviated",
    wrongName.length === 0,
    wrongName
      .slice(0, 3)
      .map((c) => `"${c.name}" for ${tooltipName(c.title)}`)
      .join(" | "),
  );

  const missing = filled.filter((c) => {
    const line = c.meta.replace(/\s+/g, " ").trim();
    const byeIsKnown = /bye week \d+/.test(c.title);
    return (
      !/^(QB|RB|WR|TE|DST)\b/.test(line) ||
      !/^R\d+$/.test(c.roundText) ||
      !/^[A-Z]{2,3}$/.test(c.clubText) ||
      (byeIsKnown && !/^BYE \d+$/.test(c.byeText))
    );
  });
  check(
    "…and its position, round, club and bye, all on one line",
    missing.length === 0,
    missing.length
      ? missing.slice(0, 2).map((c) => `${c.title.slice(0, 16)} meta="${c.meta}"`).join(" | ")
      : `e.g. "${filled[0].meta.replace(/\s+/g, " ")}"`,
  );

  /*
   * THE ROUND IS NOT THE RAIL, AND THIS IS THE PROOF OF IT.
   *
   * Deleting `R6` from a cell sitting in row 6 is the obvious tidy-up and it
   * would be wrong: the rail counts each franchise's OWN picks, and a franchise
   * that traded for a second pick in round 4 is one round out from there down.
   * Asserted rather than remembered, because the next person to look at this
   * will have the same idea.
   */
  const disagreeing = filled.filter((c) => {
    const row = Number(c.title.match(/round (\d+)/)?.[1]);
    return Number(c.roundText.slice(1)) !== row;
  });
  check(
    "every cell's round agrees with its own tooltip",
    disagreeing.length === 0,
    disagreeing.length ? `${disagreeing.length} disagree` : "",
  );
}

/**
 * CAN THE ROOM READ THE SMALL PRINT — in WCAG ratios, measured.
 *
 * "The muted gray is hard to read." It was `text-muted-foreground/80`, and the
 * alpha put it at 4.38:1 on a WR cell and 4.41:1 on a TE one — under AA's 4.5:1
 * for normal text, on two of the five position fills, on the surface people
 * walk up to. Held to 4.5:1 here on every cell at every viewport, so it cannot
 * drift back.
 *
 * The hierarchy is asserted too, and it is the other half of the fix: the point
 * was never that the metadata should be as loud as the name, it was that
 * "secondary" has to mean smaller and lighter rather than too faint to read. So
 * the name must still out-contrast it and the type must still be smaller.
 */
function checkTheMetadataIsReadable(b) {
  const AA = 4.5;
  const worst = (f) => b.cells.reduce((a, c) => Math.min(a, f(c) ?? Infinity), Infinity);
  const club = worst((c) => c.contrast.club);
  const bye = worst((c) => c.contrast.bye);
  check(
    `the club and bye clear WCAG AA's ${AA}:1 on every cell`,
    club >= AA && bye >= AA,
    `worst club ${club}:1, worst bye ${bye}:1 across ${b.cells.length} cells`,
  );
  const round = worst((c) => c.contrast.round);
  const position = worst((c) => c.contrast.position);
  check(
    "…and so do the round and the position tag beside them",
    round >= AA && position >= AA,
    `round ${round}:1, position ${position}:1`,
  );
  const name = worst((c) => c.contrast.name);
  check(
    "the player's name is still the loudest thing in the cell",
    name > club && name > round,
    `name ${name}:1 against club ${club}:1 — still secondary, by weight and size rather than by fading`,
  );
  check(
    "…and the metadata is still the smaller type",
    b.cells[0].fonts.club < b.cells[0].fonts.name,
    `name ${b.cells[0].fonts.name}px, club and bye ${b.cells[0].fonts.club}px`,
  );

  /*
   * "The team abbr. the bye week are really close to the round." They shared a
   * 0.4em run with it; they are now the far half of the line. What is asserted
   * is the white space between the two groups, in multiples of the type — a
   * pixel floor would pass at 2560 and fail to notice 1024 closing up.
   */
  const gaps = b.cells.map((c) => c.groupGap);
  const tightest = round2(Math.min(...gaps));
  const ems = round2(tightest / b.cells[0].fonts.meta);
  check(
    "the club and bye stand clear of the round rather than running into it",
    ems >= 0.85,
    `tightest gap ${tightest}px — ${ems}em of the metadata's own type`,
  );

  const keepers = b.cells.filter((c) => /· keeper/.test(c.title));
  const unmarked = keepers.filter((c) => !c.keeperMark);
  check(
    `every keeper carries its padlock (${keepers.length})`,
    keepers.length > 0 && unmarked.length === 0,
    unmarked.length ? `${unmarked.length} unmarked` : "",
  );
  const falseMark = b.cells.filter((c) => !/· keeper/.test(c.title) && c.keeperMark);
  check("and no cell that is not a keeper shows one", falseMark.length === 0);
  const unboxed = b.cells.filter((c) => !c.lockBoxed);
  check(
    "the padlock's box is reserved in all 160 cells, so a keeper is the same shape as a pick",
    unboxed.length === 0,
    unboxed.length ? `${unboxed.length} without one` : "",
  );
}

/**
 * THE BUDGET, AGAINST DATA THAT IS NOT ON THE BOARD.
 *
 * A board that fits the draft that happened is a weaker claim than a board that
 * fits. So the widest metadata line the league could ever produce is assembled
 * out of a real cell — longest position, a padlock, a three-figure reach, the
 * widest club in the feed, a two-digit bye, round 16 — and measured in the real
 * fonts against the width a real cell has. The clone is laid out at
 * `max-content` off-screen, so what comes back is what the line WANTS rather
 * than what the flex row squeezed it into.
 */
async function checkTheWidestPossibleMetaLineFits(page, clubs) {
  const m = await page.evaluate((clubList) => {
    const r = (n) => Math.round(n * 100) / 100;
    const cell = document.querySelector("[data-slot-id][title]");
    const meta = cell.firstElementChild.children[1];
    const available = r(meta.clientWidth);

    const ghost = cell.cloneNode(true);
    ghost.style.position = "absolute";
    ghost.style.left = "-9999px";
    ghost.style.top = "0";
    ghost.style.width = "max-content";
    ghost.style.visibility = "hidden";
    cell.parentElement.appendChild(ghost);

    const gMeta = ghost.firstElementChild.children[1];
    const [lead, tail] = [...gMeta.children];
    const tag = lead.firstElementChild;
    /* The position, with the padlock shown: DST is the longest abbreviation
       there is, and a kept DST is a cell this league has never drawn. */
    tag.childNodes[0].textContent = "DST";
    const lock = tag.querySelector("svg");
    if (lock) lock.classList.remove("invisible");

    const widest = (list) => {
      const probe = document.createElement("span");
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      probe.style.font = getComputedStyle(tail).font;
      document.body.appendChild(probe);
      let best = list[0] ?? "";
      let bestW = 0;
      for (const s of list) {
        probe.textContent = s;
        const w = probe.getBoundingClientRect().width;
        if (w > bestW) {
          bestW = w;
          best = s;
        }
      }
      probe.remove();
      return best;
    };
    const club = widest(clubList);

    /* The left group is the position, the round and — only on a marked cell —
       the reach or steal, so the third is put back when this one has none. */
    lead.children[1].textContent = "R16";
    if (lead.children.length < 3) {
      const chip = lead.children[1].cloneNode(true);
      lead.appendChild(chip);
    }
    lead.children[2].textContent = "+159";
    tail.children[0].textContent = club;
    tail.children[1].textContent = "BYE 14";

    const needed = r(gMeta.getBoundingClientRect().width);
    const line = {
      needed,
      available,
      club,
      text: gMeta.textContent.replace(/\s+/g, " ").trim(),
      metaFont: r(parseFloat(getComputedStyle(gMeta).fontSize)),
    };
    ghost.remove();
    return line;
  }, clubs);

  const margin = round2(((m.available - m.needed) / m.available) * 100);
  check(
    "the widest metadata line the league could ever produce still fits its cell",
    m.needed <= m.available,
    `"${m.text}" wants ${m.needed}px of ${m.available}px at ${m.metaFont}px type — ${margin}% spare`,
  );
  return { ...m, margin };
}

/**
 * AND EVERY NAME IN THE TOP 200, WRAPPED IN A REAL CELL.
 *
 * `break-words` means a name can never run off the side — it takes another line
 * instead, and a third line is what would push a cell past the round it is in.
 * So each name is put into a clone of a real name box, at the real width and the
 * real type, and the height it comes back with is compared to the two lines the
 * cell reserves.
 */
async function checkEveryNameWrapsInTwoLines(page, names) {
  const m = await page.evaluate((list) => {
    const r = (n) => Math.round(n * 100) / 100;
    const cell = document.querySelector("[data-slot-id][title]");
    const nameBox = cell.firstElementChild.children[0];
    const reserved = r(nameBox.getBoundingClientRect().height);

    const ghost = nameBox.cloneNode(true);
    ghost.style.position = "absolute";
    ghost.style.left = "-9999px";
    ghost.style.width = `${nameBox.clientWidth}px`;
    ghost.style.visibility = "hidden";
    nameBox.parentElement.appendChild(ghost);

    let worst = { name: "", used: 0 };
    const over = [];
    for (const name of list) {
      ghost.textContent = name;
      const used = r(ghost.scrollHeight);
      if (used > worst.used) worst = { name, used };
      if (used > reserved + 1) over.push({ name, used });
    }
    const font = r(parseFloat(getComputedStyle(ghost).fontSize));
    const width = r(nameBox.clientWidth);
    ghost.remove();
    return { reserved, worst, over, font, width, count: list.length };
  }, names);

  check(
    `all ${m.count} of the top 200 by ADP wrap inside the two lines a cell reserves`,
    m.over.length === 0,
    m.over.length
      ? `${m.over.length} need a third line, worst "${m.over[0].name}" ${m.over[0].used}>${m.reserved}`
      : `worst "${m.worst.name}" takes ${m.worst.used}px of ${m.reserved}px, ` +
        `on a ${m.width}px line at ${m.font}px type`,
  );
  return m;
}

// --- Driving ----------------------------------------------------------------

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    → ${path.relative(process.cwd(), file)}`);
}

const pool = topByAdp();

/*
 * `assertLocalBase` before the lock: this vaults and restores a local FILE, so a
 * run aimed at the deployment — where the board is a Postgres row — would be
 * measuring one board while claiming to have protected another.
 * `assertServerHasNoPicks` after the borrow, because the borrow is what recovers
 * a fixture stranded by a run that died, and a stranded fixture has picks on it.
 */
assertLocalBase(BASE);
const { putBack } = borrowLiveBoard("verify:final:fit");
await assertServerHasNoPicks(BASE);

try {
  section("Setup — a finished board to measure");
  const { fixture } = await import("./recap-fixture.mjs");
  const { state } = await fixture();
  writeFileSync(LIVE_STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`  wrote a finished board of ${state.picks.length} picks over the live state`);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: VIEWPORTS[1].width, height: VIEWPORTS[1].height },
    deviceScaleFactor: 1,
  });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });

  const table = [];
  try {
    await page.goto(`${BASE}/draft/final`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const first = await readBoard(page);
    check("the board drew all 160 cells", first?.count === 160, `${first?.count}`);
    check("and it hydrated, so TV mode is answerable at all", first?.hydrated, `BASE=${BASE}`);

    for (const v of [...VIEWPORTS, PHONE]) {
      const phone = v === PHONE;
      section(`${v.width}x${v.height} — ${v.why}`);
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.waitForTimeout(500);
      const b = await readBoard(page);
      checkNothingScrolls(b, { expectSideways: phone });
      checkNothingIsCut(b);
      checkEveryCellIsTheSameShape(b);
      checkEveryFactIsOnScreen(b);
      checkTheMetadataIsReadable(b);
      const meta = await checkTheWidestPossibleMetaLineFits(page, pool.clubs);
      const names = await checkEveryNameWrapsInTwoLines(page, pool.names);
      table.push({
        v,
        pane: `${b.paneScrollHeight}/${b.paneClientHeight}`,
        round: b.roundHeight,
        name: b.cells[0].fonts.name,
        metaFont: b.cells[0].fonts.meta,
        metaMargin: meta.margin,
        nameWorst: names.worst.used,
        nameRoom: names.reserved,
        club: round2(Math.min(...b.cells.map((c) => c.contrast.club ?? Infinity))),
        gap: round2(Math.min(...b.cells.map((c) => c.groupGap))),
      });
      if (v.shot) await shot(page, `final-board-${v.width}x${v.height}`);

      /*
       * TV mode is browser fullscreen and nothing else — no CSS keys off
       * `:fullscreen` — so a 1920x1080 viewport already is the projector's
       * screen. Asserted rather than assumed, because the header's own height
       * is what the rounds divide up and a chrome-less window is a different
       * header.
       */
      if (v.tv) {
        await page.evaluate(() => document.documentElement.requestFullscreen());
        await page.waitForTimeout(600);
        const tv = await readBoard(page);
        check("TV mode is on and the board knows it", tv.fullscreen === true);
        checkNothingScrolls(tv, { expectSideways: false });
        checkNothingIsCut(tv);
        checkEveryCellIsTheSameShape(tv);
        checkTheMetadataIsReadable(tv);
        await shot(page, `final-board-tv-${v.width}x${v.height}`);
        await page.evaluate(() => document.exitFullscreen());
        await page.waitForTimeout(400);
      }
    }

    /*
     * THE ROSTERS PANE IS SHARED WITH THE LIVE BOARD AND THE MOCK.
     *
     * `roster-wall.tsx` is not this file's to change, so what is asserted here
     * is only that the board half did not break it: the switch still works, the
     * ten franchises are still there, and it still does not scroll the page.
     */
    section("The Rosters pane, which this board only borrows");
    await page.setViewportSize({ width: 1440, height: 780 });
    await page.waitForTimeout(300);
    await page
      .getByRole("group", { name: "Which view of the draft" })
      .getByRole("button", { name: "rosters" })
      .click();
    await page.waitForTimeout(600);
    const rosters = await page.evaluate(() => ({
      docScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      text: document.body.innerText,
      cutters: [...document.querySelectorAll("main *")].filter((el) => {
        const s = getComputedStyle(el);
        return s.textOverflow === "ellipsis";
      }).length,
    }));
    check(
      "the Rosters pane still draws all ten franchises",
      (rosters.text.match(/\bQB\b/g) ?? []).length >= 10,
      `${(rosters.text.match(/\bQB\b/g) ?? []).length} position rows`,
    );
    check(
      "and the page still does not scroll behind it",
      rosters.docScrollHeight <= rosters.innerHeight,
      `${rosters.docScrollHeight} vs ${rosters.innerHeight}`,
    );
    await shot(page, "final-board-rosters-1440x780");

    section("Console health");
    const real = problems.filter((p) => !p.includes("webpack-hmr"));
    check("no page errors", real.length === 0, real.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }

  section("The fit, at a glance");
  console.log(
    "  viewport      pane scroll/client   round    name    meta   meta spare   name worst    club:1   group gap",
  );
  for (const row of table) {
    console.log(
      `  ${`${row.v.width}x${row.v.height}`.padEnd(13)} ${row.pane.padEnd(20)} ` +
        `${String(row.round).padEnd(8)} ${String(row.name).padEnd(7)} ` +
        `${String(row.metaFont).padEnd(6)} ${`${row.metaMargin}%`.padEnd(12)} ` +
        `${`${row.nameWorst}/${row.nameRoom}px`.padEnd(13)} ` +
        `${String(row.club).padEnd(8)} ${row.gap}px`,
    );
  }
} finally {
  section("The live draft board is back exactly as it was");
  check("every borrowed file is byte-identical to what was borrowed", putBack());
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

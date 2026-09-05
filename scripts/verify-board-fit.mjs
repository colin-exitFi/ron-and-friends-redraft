/**
 * Proves that every cell on the draft board shows everything it holds, in full,
 * and that every one of them is the same shape.
 *
 *   BASE=http://localhost:3210 node scripts/verify-board-fit.mjs
 *
 * THE FAILURE THIS EXISTS FOR. The commissioner opened the board in a browser
 * window on a MacBook Air and the ownership strips on traded picks were sitting
 * over the player names. Two separate things put them there, and neither was
 * visible from the source alone:
 *
 *   1. The row floor was `min(3.45rem, 5.2vh)`, so on a 780px-tall window a row
 *      stood 41px — six less than a cell's contents needed. The cell's inner
 *      column was allowed to shrink and the strip was not, so the name spilled
 *      under an opaque bar.
 *   2. On a WIDE screen the cell's `0.3vw` padding and the strip's `1.15em`
 *      arrow grew while the row did not, which covered names on the 1080p
 *      projector too, by about 2px.
 *
 * THE BAR IT IS HELD TO NOW is the commissioner's, and it is higher than "not
 * broken": "all the cells show all the data they need to show with nothing
 * truncated, clipped, covered, etc.", and "I want the names normalized in terms
 * of alignment (top alignment) in all cells — this needs to look uniform and
 * clean as fuck with all metadata showing in the cells."
 *
 * So this measures four things, all geometrically rather than by eye:
 *
 *   · NOTHING IS CUT. No element inside a cell overflows its own box, and no
 *     element is allowed to carry `text-overflow: ellipsis` or a line clamp in
 *     the first place — a name that fits today under a rule that would cut it
 *     tomorrow is not a pass.
 *   · NOTHING IS COVERED. The bottom of the name against the top of the
 *     ownership strip, per cell, has to be positive.
 *   · EVERY CELL IS THE SAME SHAPE. Each slot's offset from the top of its cell
 *     is compared across every cell on the board and has to be identical — that is what
 *     makes a traded cell, a keeper and an ordinary pick line up.
 *   · EVERY FACT IS ON SCREEN. Full name, position, club, bye, pick number, and
 *     the acquiring franchise on the picks that were traded.
 *
 * It is run against a POPULATED board, because uniformity between a filled cell
 * and an empty one is most of the claim. The mock draft is what populates it:
 * same grid, same cells, and its own state file, so nothing here can touch the
 * real draft.
 *
 * TWO THINGS ABOUT DRIVING THIS, both found the hard way:
 *
 *   · `localhost`, not `127.0.0.1`. `next.config` allows the one dev origin, and
 *     against the other the dev client never boots — the board renders, nothing
 *     hydrates, and the measurements are of server-rendered HTML.
 *   · TV mode is entered by calling `requestFullscreen` rather than by clicking
 *     the button, because headless Chromium ignores the request when it comes
 *     from a synthetic click and honours it from an evaluated call.
 *
 * Screenshots land in `screenshots/`.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

/*
 * The board's own splitting rule, imported rather than restated. A test that
 * reimplements the thing it is testing agrees with itself and nothing else.
 * Node strips the types; `board-name.ts` has no imports of its own, so there is
 * no alias resolution to arrange.
 */
import { boardNameMode, splitBoardName } from "../src/lib/board-name.ts";
/* The one map that assigns a position its hue. Imported so this cannot hold a
   second, drifting copy of it — the failure being guarded against is exactly a
   colour that was restated somewhere instead of inherited. */
import { POSITION_TEXT } from "../src/lib/positions.ts";
import {
  CAP_RATIO,
  FURTHEST_VIEWER_IN,
  LEGIBILITY_TABLE,
  META_FLOOR_ARCMIN,
  NAME_FLOOR_ARCMIN,
  PX_PER_INCH,
  RESOLVABLE_ARCMIN,
  SAFE_AREA_BOTTOM,
  arcminutes,
} from "../src/lib/board-legibility.ts";
/*
 * THE BOARD'S SHAPE AND THE LEAGUE'S FEATURES, READ RATHER THAN PINNED.
 *
 * This harness was written for a 10 x 16 keeper league with traded picks in it,
 * and it asserted all three as literals: 160 cells, 16 rounds, and "there is at
 * least one keeper / traded strip to measure". Ron and Friends drafts 10 x 14
 * with no keepers and no pick trading, so every one of those failed on the
 * LEAGUE rather than on a bug — and the failure text ("expected 160, got 140")
 * invites the catastrophic fix of regenerating the board to 16 rounds two hours
 * before kickoff. Deriving them means the harness cannot drift again.
 *
 * `league-config.ts` has no imports of its own, so there is no alias resolution
 * to arrange here — the same reason `board-name.ts` is safe to import above.
 */
import { DRAFT, FEATURES, LEAGUE, TOTAL_PICKS } from "../src/lib/league-config.ts";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = path.join(process.cwd(), "screenshots");

/**
 * The players the board is sized for: the top 200 by FantasyPros ADP.
 *
 * `data/fantasypros-players.json` is the pull `npm run pull:players` writes, and
 * `adp` is its consensus average draft position — the same field
 * `expected-pick.ts` ranks the pool by. 200 is the commissioner's own scoping:
 * "really only the top 200 ADP are likely to get drafted over the 160 picks. So
 * optimize for that." Read here rather than hardcoded, so a new pull moves the
 * budget and this fails instead of going stale.
 */
function topByAdp(count = 200) {
  const file = path.join(process.cwd(), "data", "fantasypros-players.json");
  const { players } = JSON.parse(readFileSync(file, "utf8"));
  return players
    .filter((p) => typeof p.adp === "number")
    .sort((a, b) => a.adp - b.adp)
    .slice(0, count)
    .map((p) => ({ ...splitBoardName(p.name, p.position), full: p.name, adp: p.adp }));
}

/** A name nobody will draft, for proving the step-down fires. See `nameStep`. */
const ABSURD = "A. Ogubunfoidajfoiadf Jr.";

/**
 * A MacBook Air with a browser on it. 1440x900 is the screen; the menu bar, the
 * tab strip and the address bar take the rest, which is the case that broke.
 */
const LAPTOP = { width: 1440, height: 780 };
/** The screen the draft is actually run on. */
const PROJECTOR = { width: 1920, height: 1080 };
/** TV mode on the laptop itself — fullscreen, so the viewport IS the screen. */
const LAPTOP_FULL = { width: 1440, height: 900 };

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

/**
 * Everything about the cells that can go wrong, read out of the DOM.
 *
 * The slots are found by position in the cell rather than by class, and every
 * one of them is cross-checked against the cell's own tooltip before anything
 * is asserted, so a redesign makes this script fail rather than quietly measure
 * the wrong box.
 */
async function cells(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;

    const read = (cell) => {
      const box = cell.getBoundingClientRect();
      const stack = cell.firstElementChild;
      /*
       * The ownership strip is the cell's fourth slot on a board that draws
       * one — and a redraft draws none, because a league that cannot trade a
       * pick has nothing to put in it and the reserved line is worth more as
       * type. See `boardShowsOwnership`. When it is absent the stack IS the
       * last child, so this must be asked rather than assumed: reading the
       * stack as the strip would have measured the player's name against
       * itself and called the result a clearance.
       */
      const strip = cell.children.length > 1 ? cell.lastElementChild : null;
      const [name, posRow, clubRow] = [...stack.children];
      const offset = (el) => round(el.getBoundingClientRect().top - box.top);
      const text = (el) => (el?.innerText ?? "").trim();

      /*
       * The box the LETTERS occupy, not the box their span occupies. The padlock
       * lives inside the position tag's span now, so the span's own rect
       * includes it — and the gap between the tag and the lock, which is the
       * thing the commissioner asked for, is invisible from the outside.
       */
      const glyphs = (el) => {
        const node = [...(el?.childNodes ?? [])].find(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim(),
        );
        if (!node) return null;
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect();
      };

      const posTag = posRow.firstElementChild;
      const lock = posTag.querySelector("svg");
      const tagGlyphs = glyphs(posTag);
      const lockBox = lock?.getBoundingClientRect() ?? null;
      /*
       * The CAP HEIGHT of the position letters, off the real font rather than
       * off the Range around them — a Range reports the LINE BOX, which is
       * about 1.16em and so nearly a fifth taller than the letters. Comparing a
       * lock to it asked the lock to out-grow a box the letters do not fill,
       * which is not what "the tag's own optical weight" means.
       */
      const tagStyle = getComputedStyle(posTag);
      const capCtx = document.createElement("canvas").getContext("2d");
      capCtx.font = `${tagStyle.fontWeight} ${tagStyle.fontSize} ${tagStyle.fontFamily}`;
      const tagCap = capCtx.measureText("H").actualBoundingBoxAscent;
      const padlock = {
        exists: Boolean(lock),
        /* The abbreviation the lock is supposed to be colour-matched to. */
        pos:
          [...posTag.childNodes]
            .find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
            ?.textContent.trim() ?? null,
        /* Reserved even when it has nothing to say, so geometry cannot move. */
        boxed: lockBox ? lockBox.width > 0 && lockBox.height > 0 : false,
        shown: lock ? getComputedStyle(lock).visibility !== "hidden" : false,
        /*
         * Both colours are read even when the lock is hidden, because
         * `visibility: hidden` does not stop `color` resolving — which is what
         * lets the palette be checked against EVERY position on the board
         * rather than only the ones that happen to have been kept.
         */
        colour: lock ? getComputedStyle(lock).color : null,
        tagColour: getComputedStyle(posTag).color,
        opacity: lock ? Number(getComputedStyle(lock).opacity) : null,
        size: lockBox ? round(lockBox.height) : null,
        tagSize: tagGlyphs ? round(tagGlyphs.height) : null,
        tagCap: round(tagCap),
        /*
         * The drawn line width, in CSS pixels. `stroke-width` is in the icon's
         * own 24-unit box, so this is the only form of it that can be compared
         * with the stem of a letter beside it — and the stroke, not the size, is
         * what decides whether the mark reads from the back of the room.
         */
        strokePx:
          lock && lockBox
            ? round((parseFloat(lock.getAttribute("stroke-width")) / 24) * lockBox.height)
            : null,
        /* Right of the letters, tight against them, on the same line. */
        gap: lockBox && tagGlyphs ? round(lockBox.left - tagGlyphs.right) : null,
        centreDrift:
          lockBox && tagGlyphs
            ? round(
                (lockBox.top + lockBox.bottom) / 2 -
                  (tagGlyphs.top + tagGlyphs.bottom) / 2,
              )
            : null,
        /* Where the position letters start. Must not move for a keeper. */
        tagLeft: tagGlyphs ? round(tagGlyphs.left - box.left) : null,
        /* And where the lock's reserved box starts, kept or not. */
        lockLeft: lockBox ? round(lockBox.left - box.left) : null,
      };

      /* Anything that would cut text, whether or not it is cutting it today. */
      const cutters = [...cell.querySelectorAll("*")].filter((el) => {
        const s = getComputedStyle(el);
        return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
      }).length;

      /*
       * Any box inside the cell that cannot hold its own contents.
       *
       * Blocks only. An inline span has no client box, so Chrome answers 0 for
       * `clientHeight` and something else for `scrollHeight`, and every span on
       * the board reads as overflowing by 2px — which is how a check like this
       * ends up either disabled or lied to. The 2px tolerance on the ones that
       * DO have a box is integer rounding: both properties round, and every
       * length here is a fraction of the viewport.
       */
      const overflowing = [cell, ...cell.querySelectorAll("*")].filter((el) => {
        const display = getComputedStyle(el).display;
        if (display === "inline" || display === "contents" || el.tagName === "svg") return false;
        return (
          el.scrollHeight - el.clientHeight > 2 || el.scrollWidth - el.clientWidth > 2
        );
      }).length;

      /* The two name lines: forename over surname, both always present. */
      const [firstLine, lastLine] = [...name.children];
      /* `lastLine` is legitimately absent when the board is in one-line mode. */
      const spills = (el) =>
        el != null &&
        (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
      const nameBlock = {
        lines: [...name.children].length,
        first: text(firstLine),
        last: text(lastLine),
        /* Both lines drawn whole, and the pair still inside the reserved box. */
        spills: spills(firstLine) || spills(lastLine),
        reserved: round(name.getBoundingClientRect().height),
        used: name.scrollHeight,
        fontSize: firstLine ? round(parseFloat(getComputedStyle(firstLine).fontSize)) : null,
        lineWidth: firstLine ? round(firstLine.clientWidth) : null,
      };

      /* Every type size the cell renders, for the "one board, one size" claim.
         `strip` is null on a board that draws no ownership strip, which is a
         size not rendered rather than a size of zero. */
      const fonts = {
        name: round(parseFloat(getComputedStyle(name.firstElementChild).fontSize)),
        position: round(parseFloat(getComputedStyle(posTag).fontSize)),
        meta: round(parseFloat(getComputedStyle(clubRow).fontSize)),
        strip: strip ? round(parseFloat(getComputedStyle(strip).fontSize)) : null,
      };

      return {
        title: cell.getAttribute("title") ?? "",
        height: round(box.height),
        width: round(box.width),
        fonts,
        nameBlock,
        /* The shape of the cell: where each slot starts, from the cell's top.
           A null strip is part of the shape and is compared as one — every
           cell on a board must agree about whether the slot is there. */
        slots: {
          name: offset(name),
          position: offset(posRow),
          club: offset(clubRow),
          strip: strip ? offset(strip) : null,
        },
        name: text(name),
        position: text(posRow),
        club: text(clubRow),
        strip: text(strip),
        /*
         * The padlock, by computed visibility rather than by class — the strip's
         * arrow is an `svg` too, and it is hidden by a class on its PARENT, so
         * "does this cell contain a visible svg" answers the wrong question.
         */
        keeperMark: padlock.shown,
        padlock,
        /*
         * The room between the name and whatever comes up underneath it. With
         * a strip that is the strip's top edge, which is the bug this whole
         * script was written for. Without one it is the bottom of the cell,
         * which is the same question asked of the only thing left that can
         * come up under a name: the cell's own floor.
         */
        clearance: round(
          (strip ? strip.getBoundingClientRect().top : box.bottom) -
            name.getBoundingClientRect().bottom,
        ),
        cutters,
        overflowing,
      };
    };

    const all = [...document.querySelectorAll("[data-slot-id][title]")];
    const board = all[0]?.closest("main") ?? null;
    /*
     * ROUNDS VISIBLE. The franchise header is STICKY, so it sits over the top of
     * the scroll box for the whole draft and the height a round can occupy
     * starts below it — dividing the whole box by a row height overstates the
     * answer by most of a round, which is how the first version of this reported
     * a number the room would not see.
     *
     * Derived from that height rather than by counting the rows that happen to
     * be on screen, because counting is a function of where the board is
     * SCROLLED: the same board reads 9 or 10 depending on whether round one is
     * flush under the header or half beneath it. The question is how many rounds
     * the screen has room for, and that has one answer.
     */
    const rows = board ? [...board.children].slice(1) : [];
    const header = board ? board.firstElementChild.getBoundingClientRect() : null;
    return {
      count: all.length,
      cells: all.map(read),
      overflow: board ? board.scrollHeight - board.clientHeight : null,
      rowHeight: board ? round(rows[2]?.getBoundingClientRect().height ?? 0) : null,
      /* The height a round has to live in, once the sticky header has taken its
         share off the top of the scroll box. */
      roundRoom: board ? round(board.clientHeight - header.height) : null,
      headerHeight: header ? round(header.height) : null,
      /* For rounds-visible: the scrolling box, and the gap between rounds. */
      gridHeight: board ? round(board.clientHeight) : null,
      rowGap: board ? round(parseFloat(getComputedStyle(board).rowGap) || 0) : null,
      nameLines: board
        ? Number(getComputedStyle(board).getPropertyValue("--ukl-name-lines")) || null
        : null,
      density: board
        ? Number(getComputedStyle(board).getPropertyValue("--ukl-density")) || null
        : null,
      fullscreen: Boolean(document.fullscreenElement),
      hydrated: all[0] ? Object.keys(all[0]).some((k) => k.startsWith("__reactFiber")) : false,
    };
  });
}

/** The name in the cell, checked against the name in the cell's own tooltip. */
function tooltipName(title) {
  return title.match(/·\s([^(]+?)\s\(/)?.[1] ?? null;
}

function checkNothingIsCut(g) {
  const cut = g.cells.filter((c) => c.cutters > 0);
  check(
    "no cell contains anything that could cut text — no ellipsis, no line clamp",
    cut.length === 0,
    cut.length ? `${cut.length} cells` : "",
  );
  const over = g.cells.filter((c) => c.overflowing > 0);
  check(
    "no box inside a cell overflows what it was given",
    over.length === 0,
    over.length ? `${over.length} cells, first ${over[0].title.slice(0, 40)}` : "",
  );
  const covered = g.cells.filter((c) => c.clearance < 0);
  const tightest = Math.min(...g.cells.map((c) => c.clearance));
  check(
    g.cells[0]?.slots.strip == null
      ? "nothing comes up under a name — every cell has room below its last line"
      : "the ownership strip covers no name",
    g.cells.length > 0 && covered.length === 0,
    covered.length
      ? `${covered.length} covered, worst by ${-covered[0].clearance}px`
      : `tightest ${tightest}px`,
  );
}

/**
 * The name block: two lines, both whole, and the type big enough to be worth it.
 */
function checkTheNameBlock(g) {
  const filled = g.cells.filter((c) => tooltipName(c.title));
  if (filled.length === 0) {
    check("there are names on screen to check", false);
    return;
  }

  /*
   * One line or two is the BOARD's decision, so what is asserted is that every
   * cell obeys the same one — and that in two-line mode the split is forename
   * over surname rather than wherever the words happened to wrap.
   */
  const lines = new Set(g.cells.map((c) => c.nameBlock.lines));
  check(
    `every cell reserves the same number of name lines (${[...lines].join("/")})`,
    lines.size === 1 && [...lines][0] === g.nameLines,
    `board says ${g.nameLines}`,
  );

  const wrongSplit = filled.filter((c) => {
    const want = splitBoardName(tooltipName(c.title), c.position.split("\n")[0].trim());
    return g.nameLines === 2
      ? c.nameBlock.first !== want.first || c.nameBlock.last !== want.last
      : c.nameBlock.first !== tooltipName(c.title);
  });
  check(
    g.nameLines === 2
      ? "every name is printed forename over surname, on its own two lines"
      : "every name is printed whole on the single line the board is using",
    wrongSplit.length === 0,
    wrongSplit
      .slice(0, 3)
      .map((c) => `"${c.nameBlock.first}"/"${c.nameBlock.last}" for ${tooltipName(c.title)}`)
      .join(" | "),
  );

  const spilling = filled.filter((c) => c.nameBlock.spills);
  check(
    "and both lines are drawn whole, neither cut nor spilling its line",
    spilling.length === 0,
    spilling.slice(0, 3).map((c) => tooltipName(c.title)).join(", "),
  );

  const overRun = filled.filter((c) => c.nameBlock.used > c.nameBlock.reserved + 2);
  check(
    "the name block stays inside the two lines every cell reserves for it",
    overRun.length === 0,
    overRun
      .slice(0, 3)
      .map((c) => `${tooltipName(c.title)} ${c.nameBlock.used}>${c.nameBlock.reserved}`)
      .join(" | "),
  );
}

/**
 * THE BUDGET, MEASURED RATHER THAN ASSUMED.
 *
 * Every first name and every surname-plus-suffix in the top 200 by ADP is
 * measured in the board's own font, at the board's own size, against the width a
 * name line actually has. The widest of each is reported with what is left over,
 * so the type can be pushed to the number the data allows instead of the number
 * that felt safe.
 */
async function checkTheTopTwoHundredFit(page, top) {
  const result = await page.evaluate(
    ({ firsts, lasts }) => {
      const round = (n) => Math.round(n * 100) / 100;
      const cell = document.querySelector("[data-slot-id][title]");
      const line = cell.firstElementChild.firstElementChild.firstElementChild;
      const style = getComputedStyle(line);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}/${style.lineHeight} ${style.fontFamily}`;
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = font;
      /* `letterSpacing` is -0.01em on the name and canvas does not inherit it. */
      const tracking = parseFloat(style.letterSpacing) || 0;
      const measure = (s) => round(ctx.measureText(s).width + tracking * s.length);
      const widest = (list) =>
        list.reduce((a, b) => (measure(b) > measure(a) ? b : a), list[0] ?? "");
      const widestFirst = widest(firsts);
      const widestLast = widest(lasts);
      const available = round(line.clientWidth);
      return {
        fontSize: round(parseFloat(style.fontSize)),
        available,
        widestFirst: { text: widestFirst, width: measure(widestFirst) },
        widestLast: { text: widestLast, width: measure(widestLast) },
        /* What the type could be if the widest token filled the line exactly. */
        ceiling: round(
          (parseFloat(style.fontSize) * available) /
            Math.max(measure(widestFirst), measure(widestLast)),
        ),
      };
    },
    { firsts: top.map((p) => p.first), lasts: top.map((p) => p.last).filter(Boolean) },
  );

  const worst = Math.max(result.widestFirst.width, result.widestLast.width);
  const headroom = Math.round(((result.available - worst) / result.available) * 1000) / 10;
  check(
    `every one of the top 200's ${top.length * 2 - 1} name tokens fits its line`,
    worst <= result.available,
    `widest first "${result.widestFirst.text}" ${result.widestFirst.width}px, ` +
      `widest surname "${result.widestLast.text}" ${result.widestLast.width}px, ` +
      `line ${result.available}px at ${result.fontSize}px type — ${headroom}% spare, ` +
      `ceiling ${result.ceiling}px`,
  );
  return result;
}

/**
 * THE ESCALATION IS THE BOARD'S, NOT A CELL'S.
 *
 * "Still normalizing cell layout and size please." So the rule is asserted where
 * it lives — one answer computed from every name on the board — and the DOM is
 * asserted to carry exactly one type size across every cell. A per-cell
 * step-down would pass a "nothing is clipped" check and fail the thing the
 * commissioner is actually asking for, which is that no cell looks different
 * from its neighbours.
 */
function checkTheBoardWideEscalation(g, top) {
  /* Short names only: one line, and the board is at its densest. */
  const shortOnly = top.filter((p) => p.full.length <= 13).slice(0, 40);
  check(
    "a board of short names is laid out on one line",
    boardNameMode(shortOnly.map((p) => ({ name: p.full }))).lines === 1,
  );

  /* One long name is enough to move every cell to two lines. */
  const withLong = [...shortOnly, { full: "Jacory Croskey-Merritt" }];
  const two = boardNameMode(withLong.map((p) => ({ name: p.full })));
  check(
    "one long name moves the whole board to two lines, at full size",
    two.lines === 2 && two.scale === 1,
    JSON.stringify(two),
  );

  /* And a name nobody can fit takes the WHOLE board down a size, not one cell. */
  const absurd = boardNameMode([...withLong.map((p) => ({ name: p.full })), { name: ABSURD }]);
  check(
    `an unfittable name steps the whole board's type down (${ABSURD})`,
    absurd.lines === 2 && absurd.scale < 1 && absurd.scale >= 0.78,
    JSON.stringify(absurd),
  );

  /* The DOM half: one size, everywhere, whatever is on the board. */
  const sizes = new Set(g.cells.map((c) => JSON.stringify(c.fonts)));
  check(
    `all ${g.count} cells render identical type sizes`,
    sizes.size === 1,
    [...sizes].slice(0, 2).join("  |  "),
  );
}

/**
 * CAN THE ROOM READ IT — in arcminutes, which is the unit that governs.
 *
 * The cap-height ratio is MEASURED off the font actually in use rather than
 * taken from the assumption in `board-legibility.ts`, because font size and cap
 * height differ by about 0.7 and confusing the two overstates legibility by
 * 40%. If the real font is tighter than the assumption, this fails.
 */
async function checkTheRoomCanReadIt(page, g) {
  const measured = await page.evaluate(() => {
    const cell = document.querySelector("[data-slot-id][title]");
    const line = cell.firstElementChild.firstElementChild.firstElementChild;
    const style = getComputedStyle(line);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const m = ctx.measureText("H");
    return {
      fontPx: parseFloat(style.fontSize),
      capPx: m.actualBoundingBoxAscent,
      family: style.fontFamily.split(",")[0],
    };
  });

  const ratio = Math.round((measured.capPx / measured.fontPx) * 1000) / 1000;
  check(
    `the font's real cap ratio is at least the ${CAP_RATIO} the sizes assume (${measured.family})`,
    ratio >= CAP_RATIO - 0.005,
    `measured ${ratio} — ${measured.capPx.toFixed(1)}px cap on ${measured.fontPx}px type`,
  );

  const asArcmin = (fontPx) => Math.round(arcminutes(fontPx) * 10) / 10;
  /** The distance inside which a size reaches the comfort target, in feet. */
  const comfortableFt = (fontPx) =>
    Math.round(((fontPx * CAP_RATIO * 3438) / PX_PER_INCH / NAME_FLOOR_ARCMIN / 12) * 10) / 10;
  const fonts = g.cells[0].fonts;
  /*
   * THE HARD FLOOR IS ACUITY. THE COMFORT TARGET IS REPORTED.
   *
   * These three read `>= NAME_FLOOR_ARCMIN` and `>= META_FLOOR_ARCMIN`, and
   * they passed comfortably against a room made of a 220-inch projection at
   * 18 ft. The draft is on a 65-inch television at eye level, which is about
   * half that angle, and the board cannot grow into the difference: ten columns
   * across 56.65 inches gives each name line about 4.1 in, and the longest
   * surname in the top 200 already fills it. Reaching 16′ from 12 ft would take
   * 32px type in a box that holds 17.8.
   *
   * A floor that can only be met by describing a screen nobody owns is not a
   * check, it is a reason to falsify `SCREEN_WIDTH_IN`. So what is asserted is
   * the angle below which a letter is not small but ABSENT — 20/20 resolves
   * about 5′ — and the comfort target becomes a distance printed beside it,
   * which is the form the room can act on and the same one the on-screen
   * readout now uses. The board's own contribution is asserted where it belongs
   * and still bites: `checkTheTopTwoHundredFit` proves the name is as large as
   * its column allows.
   */
  check(
    `the player's name is resolvable at ${RESOLVABLE_ARCMIN}′ from the furthest seat (${FURTHEST_VIEWER_IN / 12}ft)`,
    asArcmin(fonts.name) >= RESOLVABLE_ARCMIN,
    `${fonts.name}px type, ${asArcmin(fonts.name)}′ at ${FURTHEST_VIEWER_IN}in and ${PX_PER_INCH}px/in ` +
      `— comfortable within ${comfortableFt(fonts.name)}ft, against a ${NAME_FLOOR_ARCMIN}′ target`,
  );
  for (const [what, px] of [
    ["the position tag", fonts.position],
    ["the club and bye", fonts.meta],
  ]) {
    check(
      `${what} is resolvable at ${RESOLVABLE_ARCMIN}′`,
      asArcmin(px) >= RESOLVABLE_ARCMIN,
      `${px}px type, ${asArcmin(px)}′ — comfortable within ${comfortableFt(px)}ft, ` +
        `against a ${META_FLOOR_ARCMIN}′ target`,
    );
  }
  /*
   * THE OWNERSHIP STRIP IS HELD HIGHER THAN THE REST OF THE METADATA.
   *
   * It used to be checked against the 12-arcminute metadata floor and sat right
   * on it, at 11.14px and 12.4′ — and the commissioner read the board and said
   * the strips "could be a bit more legible… it's really small". The floor was
   * the wrong one for this element. A bye week is genuinely reference detail,
   * looked up when it matters; who owns a traded pick is scanned for live, and
   * it is the most confusing thing on a board when it is unclear. So it is held
   * to `STRIP_FLOOR_ARCMIN`, up near the position tag's band rather than down
   * with the bye.
   */
  if (fonts.strip == null) {
    /* No strip is drawn, so there is no size to hold to a floor. That the
       strip is absent is asserted by `checkEveryCellIsTheSameShape`, against
       the same flag, so this is a skip rather than a gap. */
    console.log(
      "    (no ownership strip on this board, so nothing to hold to the strip floor — this league cannot trade picks)",
    );
    return { ratio, arcmin: asArcmin(fonts.name), stripArcmin: null };
  }
  /* Held above the metadata, still — but as a RATIO now rather than an angle,
     for the reason the two above changed: the angle is the television's to
     decide and the ratio is the board's. The strip must read larger than the
     bye week it sits under, which is the claim that was actually being made. */
  check(
    `the ownership strip is drawn larger than the club and bye it sits under`,
    fonts.strip > fonts.meta,
    `${fonts.strip}px against ${fonts.meta}px — ${asArcmin(fonts.strip)}′ against ` +
      `${asArcmin(fonts.meta)}′, a ${Math.round((STRIP_FLOOR_ARCMIN / META_FLOOR_ARCMIN) * 100) / 100}× target`,
  );
  return { ratio, arcmin: asArcmin(fonts.name), stripArcmin: asArcmin(fonts.strip) };
}

/** Held above the metadata floor. See the note in `checkTheRoomCanReadIt`. */
const STRIP_FLOOR_ARCMIN = 14;
/** WCAG AA for normal text. The strip is dark ink on a light bar. */
const STRIP_MIN_CONTRAST = 4.5;

/**
 * COLOURS AS PAINTED RATHER THAN AS DECLARED — the shared measurement.
 *
 * `getComputedStyle` answers with the authored value, which under Tailwind v4 is
 * an `oklab()`/`oklch()` carrying an alpha. Parsing three numbers out of that
 * with a regex gets the channel order wrong and will cheerfully rate a near-
 * white player name at 1.05:1 against a mint cell. So every colour here is
 * resolved by STACKING THE LAYERS ONTO A 1x1 CANVAS and reading the pixel back,
 * which makes the browser do both the colour-space conversion and the alpha
 * compositing — and compositing is the whole point, because the bugs being
 * measured are all bugs of transparency over a tinted fill.
 *
 * Injected into the page as a string rather than imported, because it has to run
 * in the browser and both checks below need it.
 */
const COLOUR_TOOLS = `
  const round = (n) => Math.round(n * 100) / 100;
  const ctx = document.createElement("canvas").getContext("2d");
  const stack = (...layers) => {
    ctx.clearRect(0, 0, 1, 1);
    for (const c of layers) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); }
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  };
  const hex = ({ r, g, b }) =>
    "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const lum = ({ r, g, b }) => {
    const f = (v) => { const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return round((hi + 0.05) / (lo + 0.05));
  };
`;

/**
 * THE CELL'S OWN METADATA, AGAINST EVERY FILL IT CAN LAND ON.
 *
 * The club, the bye and the pick number are drawn on five different tinted
 * position fills, and a single ratio against "the background" says nothing about
 * the one it fails on. So all five are enumerated and the worst governs.
 *
 * This is the check that would have caught `text-muted-foreground/80`: the token
 * is 7.8:1 on the plain canvas and the alpha spent it, landing at 4.38:1 over a
 * WR and 4.41:1 over a TE — both under the floor, on a board read from fifteen
 * feet. The name is measured alongside them, because the fix for bad contrast
 * must not be to let the secondary text compete with the player's name.
 */
async function checkTheMetadataIsLegible(page) {
  const rows = await page.evaluate(`(() => {
    ${COLOUR_TOOLS}
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const seen = new Map();
    for (const cell of document.querySelectorAll("[data-slot-id][title]")) {
      const stackEl = cell.firstElementChild;
      const posTag = stackEl.children[1].firstElementChild;
      const pos = posTag.textContent.trim();
      if (!pos || seen.has(pos)) continue;
      const fill = stack(pageBg, getComputedStyle(cell).backgroundColor);
      const ink = (el) => stack(hex(fill), getComputedStyle(el).color);
      seen.set(pos, {
        position: pos,
        fill: hex(fill),
        club: ratio(ink(stackEl.children[2]), fill),
        pick: ratio(ink(stackEl.children[1].lastElementChild), fill),
        name: ratio(ink(stackEl.firstElementChild), fill),
        tag: ratio(ink(posTag), fill),
      });
    }
    return [...seen.values()];
  })()`);

  if (rows.length === 0) {
    check("there are filled cells to measure metadata contrast on", false);
    return null;
  }

  const worst = rows.reduce((a, b) => (b.club < a.club || b.pick < a.pick ? b : a));
  const worstRatio = Math.min(...rows.map((r) => Math.min(r.club, r.pick)));
  check(
    `the club, bye and pick number clear ${STRIP_MIN_CONTRAST}:1 on all ${rows.length} position fills`,
    worstRatio >= STRIP_MIN_CONTRAST,
    rows
      .sort((a, b) => a.club - b.club)
      .map((r) => `${r.position} ${r.fill} ${r.club}:1`)
      .join("  |  "),
  );

  /*
   * And the hierarchy survives the fix. Brightening the metadata to clear AA
   * would be the wrong trade if it brought it level with the name — secondary
   * text is meant to read as smaller and lighter, not as faded to the edge of
   * legibility, which is the mistake that produced the `/80` in the first place.
   */
  const tooClose = rows.filter((r) => r.name < r.club * 1.5);
  check(
    "and the player's name still dominates the cell it sits in",
    tooClose.length === 0,
    rows
      .map((r) => `${r.position} name ${r.name}:1 vs meta ${r.club}:1`)
      .slice(0, 2)
      .join("  |  "),
  );
  return { worst: worstRatio, worstAt: worst.position, rows };
}

/**
 * THE TRADED STRIP: dark ink on a light bar, and one bar in all twenty-nine.
 */
async function checkTheStripIsLegible(page) {
  const m = await page.evaluate(`(() => {
    ${COLOUR_TOOLS}
    const pageBg = getComputedStyle(document.body).backgroundColor;
    const out = [];
    for (const cell of document.querySelectorAll("[data-slot-id][title]")) {
      /* No fourth slot at all on a board that draws no strip — see \`read\`. */
      if (cell.children.length < 2) continue;
      const strip = cell.lastElementChild;
      const cs = getComputedStyle(strip);
      if (cs.visibility === "hidden" || !strip.innerText.trim()) continue;
      /* The cell fill over the page, then the strip's fill over that. */
      const cellFill = stack(pageBg, getComputedStyle(cell).backgroundColor);
      const fill = stack(hex(cellFill), cs.backgroundColor);
      const ink = stack(hex(fill), cs.color);
      out.push({
        owner: strip.innerText.trim().replace(/\\s+/g, " "),
        position: cell.firstElementChild.children[1].firstElementChild.textContent.trim(),
        fill: hex(fill),
        ink: hex(ink),
        contrast: ratio(ink, fill),
        height: round(strip.getBoundingClientRect().height),
      });
    }
    return out;
  })()`);

  if (m.length === 0) {
    /*
     * NO OWNERSHIP STRIPS IS THE CORRECT ANSWER IN A REDRAFT. @fromProposal
     * Section 6 forbids trading picks and `FEATURES.tradedPicks` records it, so
     * every slot is owned by the franchise it was born to and no strip is drawn.
     * `checkEveryFactIsOnScreen` separately proves no cell prints a strip it has
     * not earned, which is the assertion that still bites here.
     */
    if (!FEATURES.tradedPicks) {
      console.log(
        "    (no ownership strips to measure — this league does not trade picks)",
      );
      return null;
    }
    check("there are traded strips to measure", false);
    return null;
  }

  const worst = m.reduce((a, b) => (b.contrast < a.contrast ? b : a));
  check(
    `every traded strip's handle clears ${STRIP_MIN_CONTRAST}:1 against its own bar (${m.length} strips)`,
    worst.contrast >= STRIP_MIN_CONTRAST,
    `worst ${worst.contrast}:1 — ${worst.ink} on ${worst.fill} (${worst.owner} over a ${worst.position})`,
  );

  /*
   * ONE BAR, NOT TEN. A translucent fill samples the position colour behind it,
   * which is how the strip ended up a slightly different grey per column. The
   * board's argument is uniformity, and this is the cheapest place to lose it.
   */
  const fills = new Set(m.map((s) => s.fill));
  check(
    "and every bar is the same colour, whatever position it sits on",
    fills.size === 1,
    fills.size === 1 ? `all ${m.length} at ${[...fills][0]}` : [...fills].join(", "),
  );

  const heights = new Set(m.map((s) => s.height));
  check(
    "and every bar is the same height",
    heights.size === 1,
    [...heights].join(", ") + "px",
  );
  return { contrast: worst.contrast, fill: [...fills][0], height: [...heights][0] };
}

/** How much of the draft is on screen — the number the density work is for. */
function roundsVisible(g) {
  if (!g.rowHeight || !g.roundRoom) return null;
  return Math.floor(g.roundRoom / (g.rowHeight + g.rowGap));
}

/**
 * The rounds the ROOM will see, measured on the real board rather than the mock.
 *
 * The mock harness carries a banner the draft itself does not, and at 1080p that
 * banner is worth a whole round: 883px of round room against the board's 974px.
 * Reporting the mock's count understates the board by one, which is how the
 * density control nearly went chasing a round that was already there.
 *
 * On its own page so the populated mock the rest of this script depends on is
 * left exactly where it was.
 */
async function roundsOnTheRealBoard(browser) {
  const page = await browser.newPage({ viewport: PROJECTOR, deviceScaleFactor: 1 });
  try {
    await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-slot-id][title]");
    await page.waitForTimeout(500);
    const g = await cells(page);
    return { rounds: roundsVisible(g), roundRoom: g.roundRoom, rowHeight: g.rowHeight };
  } finally {
    await page.close();
  }
}

function checkEveryCellIsTheSameShape(g) {
  if (g.cells.length === 0) {
    check("there are cells on screen to compare", false);
    return;
  }
  const shapes = new Map();
  for (const c of g.cells) {
    const key = JSON.stringify(c.slots);
    shapes.set(key, (shapes.get(key) ?? 0) + 1);
  }
  const listed = [...shapes.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${n}× ${k}`);
  check(
    `all ${g.count} cells lay their slots out identically`,
    shapes.size === 1,
    shapes.size === 1 ? listed[0].replace(/^\d+× /, "") : listed.slice(0, 3).join("  |  "),
  );

  const heights = new Set(g.cells.map((c) => c.height));
  check(
    "and they are all the same height",
    heights.size === 1,
    [...heights].join(", ") + "px",
  );

  /*
   * AND THEY ALL AGREE ABOUT THE FOURTH SLOT.
   *
   * The ownership strip is reserved in every cell or in none of them, and which
   * of those it is follows the league rather than the cell: @fromProposal
   * Section 6 forbids pick trading, `FEATURES.tradedPicks` records it, and
   * `boardShowsOwnership` turns that into a line of every cell's height spent
   * on type instead. So the assertion INVERTS with the flag rather than
   * relaxing — in a redraft, a reserved strip is 11.7px a round at 1080p, or
   * better than two rounds of board, given to a fact that cannot occur.
   */
  const reserved = g.cells.filter((c) => c.slots.strip != null);
  check(
    FEATURES.tradedPicks
      ? `every cell reserves the ownership strip (${reserved.length})`
      : "no cell reserves an ownership strip — this league cannot trade picks, so the line is the name's",
    FEATURES.tradedPicks
      ? reserved.length === g.cells.length
      : reserved.length === 0,
    FEATURES.tradedPicks
      ? `${g.cells.length - reserved.length} cells without one`
      : reserved.length
        ? `${reserved.length} cells still hold one`
        : `${g.cells.length} cells, ${g.cells[0].height}px tall`,
  );
}

function checkEveryFactIsOnScreen(g) {
  const filled = g.cells.filter((c) => tooltipName(c.title));
  check(`there are filled cells to check (${filled.length})`, filled.length > 0);

  /* Two lines now, so the newline between them is normalised out. */
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

  const missingMeta = filled.filter((c) => {
    const [position, club] = [c.position, c.club].map((t) => t.split("\n")[0].trim());
    /* Several drafted players are genuinely unsigned and so have no bye week;
       the cell says "FA" and leaves the bye slot empty, which is the truth. */
    const byeIsKnown = /bye week \d+/.test(c.title);
    return (
      !/^(QB|RB|WR|TE|DST)$/.test(position) ||
      !/\d+\.\d+/.test(c.position) ||
      !/^[A-Z]{2,3}$/.test(club) ||
      (byeIsKnown && !/BYE \d+/.test(c.club))
    );
  });
  check(
    "…and its position, pick number, club and bye",
    missingMeta.length === 0,
    missingMeta
      .slice(0, 2)
      .map((c) => `${c.title.slice(0, 12)} pos="${c.position}" club="${c.club}"`)
      .join(" | "),
  );

  const traded = g.cells.filter((c) => /'s pick, now (.+?)(?: ·|$)/.test(c.title));
  const wrongOwner = traded.filter((c) => {
    const owner = c.title.match(/'s pick, now ([^·(]+)/)?.[1].trim();
    return c.strip.toUpperCase() !== owner?.toUpperCase();
  });
  /*
   * In a redraft the assertion INVERTS rather than relaxing: there must be no
   * traded cell at all. That is a real check — it is how a stray traded pick
   * left in a snapshot would be caught — where `traded.length > 0` was only
   * ever a check that the harness's own league still existed.
   */
  check(
    FEATURES.tradedPicks
      ? `every traded pick names the franchise that owns it now (${traded.length})`
      : "no cell claims a traded owner — this league does not trade picks",
    FEATURES.tradedPicks
      ? traded.length > 0 && wrongOwner.length === 0
      : traded.length === 0,
    FEATURES.tradedPicks
      ? wrongOwner.slice(0, 2).map((c) => `strip "${c.strip}"`).join(" | ")
      : traded.length
        ? `${traded.length} cell(s) print a traded owner`
        : "",
  );
  const untradedWithStrip = g.cells.filter((c) => !/'s pick, now/.test(c.title) && c.strip);
  check(
    "and no cell that was not traded prints one",
    untradedWithStrip.length === 0,
    untradedWithStrip.length ? `${untradedWithStrip.length} cells` : "",
  );

  const keepers = g.cells.filter((c) => /, keeper\)/.test(c.title));
  const unmarked = keepers.filter((c) => !c.keeperMark);
  check(
    FEATURES.keepers
      ? `every keeper carries its padlock (${keepers.length})`
      : "no cell is marked a keeper — 2026 is a pure redraft",
    FEATURES.keepers
      ? keepers.length > 0 && unmarked.length === 0
      : keepers.length === 0,
    FEATURES.keepers
      ? unmarked.length
        ? `${unmarked.length} unmarked`
        : ""
      : keepers.length
        ? `${keepers.length} cell(s) claim to be keepers`
        : "",
  );
  const falseMark = g.cells.filter((c) => !/, keeper\)/.test(c.title) && c.keeperMark);
  check(
    "and no cell that is not a keeper shows one",
    falseMark.length === 0,
    falseMark.length ? `${falseMark.length} cells` : "",
  );
}

/**
 * The padlock: attached to the position tag, in the tag's colour, evident.
 *
 * "No bro I mean the lock to the right of the position tag, like right next to
 * it, as the same color as the position tag… they need to be kinda evident."
 * Each of those three is a measurement here, and so is the thing that put the
 * lock on the other side of the row in the first place: the position letters
 * must still start at the same pixel in every cell on the board.
 */
function checkTheKeeperPadlock(g) {
  const keepers = g.cells.filter((c) => /, keeper\)/.test(c.title));
  if (keepers.length === 0) {
    /*
     * A redraft has no kept cell, so there is no padlock to measure the gap,
     * size or stroke of. It does NOT follow that there is nothing to check: the
     * padlock's BOX is reserved in every cell whether or not a lock is drawn in
     * it, and that reservation is the horizontal half of the uniformity claim —
     * it is what keeps a row aligned. So the box is still asserted, over all
     * cells, and only the lock's own appearance is announced as skipped.
     */
    if (!FEATURES.keepers) {
      const unboxedInRedraft = g.cells.filter((c) => !c.padlock.exists || !c.padlock.boxed);
      check(
        `every one of the ${g.cells.length} cells still reserves the padlock's box, so the rows line up without one`,
        unboxedInRedraft.length === 0,
        unboxedInRedraft.length ? `${unboxedInRedraft.length} cells without one` : "",
      );
      console.log(
        "    (no keeper cells, so the padlock's own gap, size and stroke are not measurable — pure redraft)",
      );
      return;
    }
    check("there are keeper cells to measure", false);
    return;
  }

  const unboxed = g.cells.filter((c) => !c.padlock.exists || !c.padlock.boxed);
  check(
    "every cell holds the padlock's box, keeper or not",
    unboxed.length === 0,
    unboxed.length ? `${unboxed.length} cells without one` : "",
  );

  const adrift = keepers.filter(
    (c) => !(c.padlock.gap > 0 && c.padlock.gap < c.padlock.tagCap),
  );
  check(
    "the padlock sits immediately right of the position letters",
    adrift.length === 0,
    `gap ${keepers[0].padlock.gap}px, inside the ${keepers[0].padlock.tagCap}px cap height ` +
      `— one unit with the tag, not a separate field`,
  );
  /*
   * Reserved to the same pixel whether the pick was kept or not. This is the
   * horizontal half of the uniformity claim: `checkEveryCellIsTheSameShape`
   * compares the slots' vertical offsets, and would not notice a keeper's row
   * being laid out differently across.
   *
   * PER POSITION, because the lock rides the tag rather than a column: it sits
   * after the letters, so "DST" legitimately pushes it further right than "WR".
   * What must not vary is the lock's place beside a GIVEN abbreviation, which is
   * what makes a kept WR and an ordinary WR the same shape.
   */
  const perPosition = new Map();
  for (const c of g.cells) {
    if (!c.padlock.pos || c.padlock.lockLeft == null) continue;
    const at = perPosition.get(c.padlock.pos) ?? [];
    at.push(c.padlock.lockLeft);
    perPosition.set(c.padlock.pos, at);
  }
  const drifted = [...perPosition.entries()]
    .map(([pos, xs]) => [pos, Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100])
    .filter(([, spread]) => spread > 0.5);
  check(
    `the lock's box starts at the same x in every cell of a position, kept or not (${perPosition.size} positions)`,
    drifted.length === 0,
    drifted.length
      ? drifted.map(([pos, s]) => `${pos} drifts ${s}px`).join(", ")
      : `${keepers.length} keepers and ${g.cells.length - keepers.length} ordinary picks agree`,
  );
  const offLine = keepers.filter((c) => Math.abs(c.padlock.centreDrift) > 1.5);
  check(
    "on the same line, centred against them",
    offLine.length === 0,
    `drift ${keepers[0].padlock.centreDrift}px`,
  );

  /*
   * THE COLOUR, PER POSITION, ACROSS THE WHOLE BOARD.
   *
   * "The lock is supposed to be the same color as the position, wr green, rb
   * blue, qb magenta, te orange, dst purp… next to the abbreviated position."
   *
   * Checked on EVERY cell that names a position rather than only on the kept
   * ones, because the keepers a season happens to produce do not cover the
   * palette — this league's nineteen are QB, RB, WR and TE, and a DST keeper
   * has never existed. The lock's box is reserved and colour-resolved in all
   * every cell even where it is hidden, so the DST cells answer for DST.
   *
   * There is nothing to keep in step here by construction: the lock is a child
   * of the tag's own span and takes `currentColor`, and `positionText` in
   * `src/lib/positions.ts` is the only thing that sets it. That is the point of
   * asserting it anyway — the previous board coloured the lock from the pick
   * number's muted `quiet` class instead, and it looked deliberate.
   */
  const tagged = g.cells.filter((c) => c.padlock.pos && c.padlock.exists);
  const byPosition = new Map();
  for (const c of tagged) {
    const seen = byPosition.get(c.padlock.pos) ?? { cells: 0, matched: 0, colour: null };
    seen.cells++;
    if (c.padlock.colour === c.padlock.tagColour && c.padlock.opacity === 1) seen.matched++;
    seen.colour = c.padlock.tagColour;
    byPosition.set(c.padlock.pos, seen);
  }
  const mismatched = [...byPosition.entries()].filter(([, v]) => v.matched !== v.cells);
  check(
    `the lock is exactly its position tag's colour, for all ${byPosition.size} positions on the board`,
    tagged.length > 0 && mismatched.length === 0,
    [...byPosition.entries()]
      .map(([pos, v]) => `${pos} ${v.colour} ×${v.cells}`)
      .join("  |  "),
  );
  if (mismatched.length) {
    for (const [pos, v] of mismatched) {
      console.log(`      ↳ ${pos}: only ${v.matched}/${v.cells} cells match ${v.colour}`);
    }
  }
  /*
   * AND EVERY POSITION IS IN THE MAP THAT COLOURS IT.
   *
   * Matching is not on its own enough: `positionText` answers
   * `text-muted-foreground` for a position it does not know, and the lock would
   * inherit THAT — so a new position would arrive grey with the lock loyally
   * grey beside it and the check above would pass. So the board's positions are
   * checked against `POSITION_TEXT` itself, which is the one place a hue is
   * assigned. A season that starts drafting kickers fails here.
   */
  const unpainted = [...byPosition.keys()].filter((pos) => !(pos in POSITION_TEXT));
  check(
    `every position on the board has a hue assigned in POSITION_TEXT (${[...byPosition.keys()].sort().join(", ")})`,
    unpainted.length === 0,
    unpainted.length
      ? `${unpainted.join(", ")} falls through positionText to the muted default`
      : `${new Set([...byPosition.values()].map((v) => v.colour)).size} distinct hues, ` +
          `${Object.keys(POSITION_TEXT).length} in the map`,
  );

  /*
   * EVIDENT IS A MATTER OF WEIGHT, NOT OF SIZE. An outline icon the same height
   * as the letters beside it still disappears if its line is thinner than their
   * stems, which is exactly how the first version read from a seat: a 1.7px
   * stroke against a `font-black` tag whose stems are 2.2px. Both are asserted,
   * as ratios of the tag's cap height, so neither can drift with the viewport.
   */
  const small = keepers.filter((c) => c.padlock.size < c.padlock.tagCap * 1.35);
  check(
    "and is drawn larger than the letters it sits beside",
    small.length === 0,
    `${keepers[0].padlock.size}px lock on a ${keepers[0].padlock.tagCap}px cap ` +
      `— ${Math.round((keepers[0].padlock.size / keepers[0].padlock.tagCap) * 100) / 100}×`,
  );
  const faint = keepers.filter((c) => c.padlock.strokePx < c.padlock.tagCap * 0.18);
  check(
    "at the tag's own stroke weight rather than as a hairline",
    faint.length === 0,
    `${keepers[0].padlock.strokePx}px stroke on a ${keepers[0].padlock.tagCap}px cap ` +
      `— ${Math.round((keepers[0].padlock.strokePx / keepers[0].padlock.tagCap) * 100) / 100}×`,
  );

  /*
   * The regression the previous arrangement existed to prevent. A padlock in
   * FRONT of the letters indented them in the nineteen keeper cells and nowhere
   * else; behind them it cannot. 0.5px of tolerance is sub-pixel column
   * placement, not room for an indent — a padlock is twenty times that.
   */
  const lefts = g.cells.map((c) => c.padlock.tagLeft).filter((n) => n != null);
  const spread = Math.round((Math.max(...lefts) - Math.min(...lefts)) * 100) / 100;
  check(
    `the position letters start at the same x in all ${lefts.length} cells that have them`,
    spread <= 0.5,
    `spread ${spread}px`,
  );
}

/**
 * CAN THE LAST ROUND BE LIFTED OFF THE FLOOR.
 *
 * The projector's bottom edge is at floor level and below every sightline in the
 * room, so a round parked there is unreadable however long you look at it. The
 * defect this measures was not that the last round was hard to reach — it was
 * that reaching it did not help: at maximum scroll the last round's bottom sat
 * at 99.7% of the screen height, because the scroll range ended exactly where
 * the content did.
 *
 * So this scrolls the board as far as it will go and asks where the last round
 * lands.
 * The bar is `SAFE_AREA_BOTTOM` — asserted against the constant rather than
 * against a number typed in here, so when the safe-area control moves it this
 * moves with it.
 */
async function checkRoundSixteenClearsTheFloor(page, { expectTrailingSpace }) {
  const m = await page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const cell = document.querySelector("[data-slot-id][title]");
    const board = cell.closest("main");
    const rows = [...board.children].slice(1);
    const last = rows[rows.length - 1];

    /* Scroll position 0 first: round one must still sit under the header. */
    board.scrollTop = 0;
    const header = board.firstElementChild.getBoundingClientRect();
    const firstAtTop = round(rows[0].getBoundingClientRect().top - header.bottom);

    board.scrollTop = board.scrollHeight - board.clientHeight;
    const atBottom = last.getBoundingClientRect();
    return {
      rounds: rows.length,
      pad: round(parseFloat(getComputedStyle(board).paddingBottom) || 0),
      maxScroll: round(board.scrollHeight - board.clientHeight),
      firstAtTop,
      lastBottomY: round(atBottom.bottom),
      viewportH: window.innerHeight,
      /* Where the last round's bottom edge ends up, as a share of the screen. */
      lastBottomPct: round((atBottom.bottom / window.innerHeight) * 100),
      /* And that it is on screen at all, not scrolled past the box. */
      lastVisible: atBottom.bottom <= board.getBoundingClientRect().bottom + 1,
    };
  });

  /*
   * The label reads from the CONFIG, not from `m.rounds`. It used to interpolate
   * the measured count into its own label while comparing against a pinned 16,
   * so a stale failure printed "all 14 rounds to scroll through — 14 rounds" and
   * looked like the board disagreeing with itself.
   */
  check(
    `the board still has all ${DRAFT.rounds} rounds to scroll through`,
    m.rounds === DRAFT.rounds,
    `${m.rounds} rounds, ${m.maxScroll}px of scroll`,
  );
  if (expectTrailingSpace) {
    check(
      `TV mode carries trailing space below round ${DRAFT.rounds} (${m.pad}px, from a ${SAFE_AREA_BOTTOM} safe area)`,
      m.pad > 0,
      `padding-bottom ${m.pad}px`,
    );
    check(
      `and maximum scroll lifts round ${DRAFT.rounds}'s bottom to ${SAFE_AREA_BOTTOM * 100}% of the screen or above`,
      m.lastBottomY <= SAFE_AREA_BOTTOM * m.viewportH + 1 && m.lastVisible,
      `bottom lands at ${m.lastBottomY}px of ${m.viewportH} — ${m.lastBottomPct}%, ` +
        `leaving ${round1(100 - m.lastBottomPct)}% of the screen clear of the floor`,
    );
  } else {
    check(
      "outside TV mode the board carries no trailing space",
      m.pad < 8,
      `padding-bottom ${m.pad}px, round ${DRAFT.rounds} lands at ${m.lastBottomPct}%`,
    );
  }
  check(
    "and at scroll 0 round one still sits directly under the sticky header",
    Math.abs(m.firstAtTop) <= 2,
    `${m.firstAtTop}px between them`,
  );
  return m;
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Fills the mock board so the uniformity claim is made against traded, kept and
 * ordinary picks sitting side by side rather than against an empty grid.
 */
async function populateMock(page) {
  await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });
  await page.goto(`${BASE}/mock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.getByTitle(/^Draft for /).first().click();
  await page.waitForTimeout(150);
  await page.getByTitle(/^Quick/).click();
  await page.waitForTimeout(100);
  await page.getByTitle("Begin the mock with these settings").click();
  await page.waitForTimeout(800);
  await page.getByTitle("Autopick every remaining pick at once").click();
  await page.waitForTimeout(2500);
  /* Finishing lands on the rosters view, where there is no grid to measure. */
  await page.keyboard.press("Tab");
  await page.waitForTimeout(700);
}

const top200 = topByAdp();

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: LAPTOP, deviceScaleFactor: 1 });

try {
  section(`The real board, keepers and traded picks only — ${LAPTOP.width}x${LAPTOP.height}`);
  await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  let g = await cells(page);
  check(
    `the grid drew all ${TOTAL_PICKS} cells (${g.count})`,
    g.count === TOTAL_PICKS,
    `${g.count}, expected ${LEAGUE.teams} teams x ${DRAFT.rounds} rounds`,
  );
  check("the board hydrated, so TV mode is answerable at all", g.hydrated, `BASE=${BASE}`);
  checkNothingIsCut(g);
  checkEveryCellIsTheSameShape(g);
  checkTheKeeperPadlock(g);
  /*
   * The board is allowed to run off the bottom of a browser window, and on a
   * laptop it has to: a full board of legible cells does not fit 780px and the
   * ruling is that legibility wins. Asserted rather than reported because the
   * bug was a board that fitted by squeezing.
   */
  check(
    "it scrolls rather than squeezing the cells to fit the window",
    g.overflow > 0,
    `row ${g.rowHeight}px, ${g.overflow}px below the fold`,
  );
  await page.screenshot({ path: path.join(OUT, "board-cells-laptop-empty.png") });
  console.log("    → screenshots/board-cells-laptop-empty.png");

  section("A full board — traded, kept and ordinary picks side by side");
  await populateMock(page);
  g = await cells(page);
  check(
    `the mock drew all ${TOTAL_PICKS} cells (${g.count})`,
    g.count === TOTAL_PICKS,
    `${g.count}, expected ${LEAGUE.teams} teams x ${DRAFT.rounds} rounds`,
  );
  checkNothingIsCut(g);
  checkEveryCellIsTheSameShape(g);
  checkEveryFactIsOnScreen(g);
  checkTheKeeperPadlock(g);
  checkTheNameBlock(g);
  const budget = await checkTheTopTwoHundredFit(page, top200);
  checkTheBoardWideEscalation(g, top200);
  await page.screenshot({ path: path.join(OUT, "board-cells-laptop-full.png") });
  console.log("    → screenshots/board-cells-laptop-full.png");
  /* The region the commissioner asked to see: the rounds where the keepers and
     the traded picks sit beside ordinary ones, at the size he was reading. */
  await page.screenshot({
    path: path.join(OUT, "board-cells-region.png"),
    clip: { x: 0, y: 290, width: 1000, height: 480 },
  });
  console.log("    → screenshots/board-cells-region.png");

  section(`The same full board on the projector — ${PROJECTOR.width}x${PROJECTOR.height}`);
  await page.setViewportSize(PROJECTOR);
  await page.waitForTimeout(700);
  g = await cells(page);
  checkNothingIsCut(g);
  checkEveryCellIsTheSameShape(g);
  checkEveryFactIsOnScreen(g);
  checkTheKeeperPadlock(g);
  checkTheNameBlock(g);
  const projectorBudget = await checkTheTopTwoHundredFit(page, top200);
  checkTheBoardWideEscalation(g, top200);
  const legibility = await checkTheRoomCanReadIt(page, g);
  const rounds = roundsVisible(g);
  console.log(
    `    ROUNDS VISIBLE AT 1080p: ${rounds} of ${DRAFT.rounds} — ${g.roundRoom}px of room for rounds ` +
      `under a ${g.headerHeight}px sticky header, at ${g.rowHeight}px + ${g.rowGap}px a round. ` +
      `Name ${g.cells[0].fonts.name}px at ${legibility.arcmin}′, ` +
      `${g.nameLines} name line(s), density ${g.density}.`,
  );
  const real = await roundsOnTheRealBoard(browser);
  console.log(
    `    …and ${real.rounds} of ${DRAFT.rounds} on the real board, which has ${real.roundRoom}px to the ` +
      `mock's ${g.roundRoom}px — the mock's banner is worth a round, so this is the number the room sees.`,
  );
  /*
   * Locks in the density decision: 11 rounds at the name's 18ft comfortable size
   * is the balance that was struck, so losing one to new chrome must fail here.
   * The margin is thin and worth knowing — 974px of round room over an 85.4px
   * round is 11.4, so about a third of a round of slack. Growing the ownership
   * strip's type spent 0.03px of it, which is the whole reason that change was
   * allowed to be made in the box the strip already had.
   *
   * ELEVEN IS A DENSITY FLOOR, NOT A BOARD SHAPE, so it survives the move to a
   * shorter board — but it cannot exceed the board. `DRAFT.rounds` has already
   * moved twice today (16 in the source league, 14, now 15), which is the whole
   * argument for deriving it here rather than typing it a fourth time.
   */
  const DENSITY_FLOOR = Math.min(11, DRAFT.rounds);
  check(
    `the room still sees ${DENSITY_FLOOR} of the ${DRAFT.rounds} rounds at 1080p`,
    real.rounds >= DENSITY_FLOOR,
    `${real.rounds} rounds at ${real.rowHeight}px a round, ${real.roundRoom}px of room ` +
      `— ${Math.round((real.roundRoom / (real.rowHeight + g.rowGap)) * 100) / 100} rounds' worth`,
  );
  const strip = await checkTheStripIsLegible(page);
  if (strip) {
    console.log(
      `    The ownership strip: ${g.cells[0].fonts.strip}px at ${legibility.stripArcmin}′, ` +
        `${strip.fill} bar at ${strip.contrast}:1, ${strip.height}px tall.`,
    );
  }
  const meta = await checkTheMetadataIsLegible(page);
  if (meta) {
    console.log(
      `    Cell metadata, worst fill first: ` +
        meta.rows
          .map((r) => `${r.position} ${r.club}:1 (name ${r.name}:1)`)
          .join(", ") +
        ".",
    );
  }
  /*
   * The same number in TV mode, which is the case the count is FOR. It comes out
   * the same because TV mode is browser fullscreen and nothing else — no CSS or
   * layout keys off `:fullscreen` — so a 1920x1080 viewport already IS the
   * projector's screen. Asserted rather than assumed, because "the board is
   * denser on the TV" would be an easy thing to believe and act on wrongly.
   */
  /* Before TV mode: the trailing space must not be there in a browser window. */
  await checkRoundSixteenClearsTheFloor(page, { expectTrailingSpace: false });

  await page.evaluate(() => document.documentElement.requestFullscreen());
  await page.waitForTimeout(600);
  const tv = await cells(page);
  check(
    `TV mode at ${PROJECTOR.width}x${PROJECTOR.height} shows the same ${rounds} rounds`,
    tv.fullscreen === true && roundsVisible(tv) === rounds && tv.rowHeight === g.rowHeight,
    `${roundsVisible(tv)} rounds, row ${tv.rowHeight}px`,
  );
  checkNothingIsCut(tv);
  checkEveryCellIsTheSameShape(tv);
  await checkRoundSixteenClearsTheFloor(page, { expectTrailingSpace: true });
  /* Scrolled to the end, so the empty floor region can be judged by eye. */
  await page.screenshot({ path: path.join(OUT, "board-cells-projector-bottom.png") });
  console.log("    → screenshots/board-cells-projector-bottom.png");
  await page.evaluate(() => {
    const board = document.querySelector("[data-slot-id][title]").closest("main");
    board.scrollTop = 0;
  });
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(400);
  console.log(
    `    Panel assumptions at ${FURTHEST_VIEWER_IN / 12}ft: ${LEGIBILITY_TABLE.map(
      (r) => `${r.diagonalIn}in (${r.widthIn}in wide) → ${r.pxPerInch}px/in, ` +
        `${NAME_FLOOR_ARCMIN}′ would want ${r.nameFloorPx}px`,
    ).join("; ")}`,
  );
  await page.screenshot({ path: path.join(OUT, "board-cells-projector.png") });
  console.log("    → screenshots/board-cells-projector.png");
  await page.screenshot({
    path: path.join(OUT, "board-cells-projector-region.png"),
    clip: { x: 0, y: 360, width: 1240, height: 640 },
  });
  console.log("    → screenshots/board-cells-projector-region.png");

  section(`TV mode — ${LAPTOP_FULL.width}x${LAPTOP_FULL.height} fullscreen`);
  await page.setViewportSize(LAPTOP_FULL);
  await page.waitForTimeout(300);
  await page.evaluate(() => document.documentElement.requestFullscreen());
  await page.waitForTimeout(800);
  g = await cells(page);
  check("TV mode is on and the board knows it", g.fullscreen === true);
  checkNothingIsCut(g);
  checkEveryCellIsTheSameShape(g);
  checkTheNameBlock(g);
  await checkTheTopTwoHundredFit(page, top200);
  console.log(`    row ${g.rowHeight}px, ${g.overflow}px below the fold`);
  await page.screenshot({ path: path.join(OUT, "board-cells-tv.png") });
  console.log("    → screenshots/board-cells-tv.png");
  await page.evaluate(() => document.exitFullscreen());

  section("A phone, upright and sideways");
  for (const size of [
    { width: 390, height: 844 },
    { width: 915, height: 412 },
  ]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(600);
    g = await cells(page);
    console.log(`  ${size.width}x${size.height}`);
    checkNothingIsCut(g);
    checkEveryCellIsTheSameShape(g);
    checkTheNameBlock(g);
    await checkTheTopTwoHundredFit(page, top200);
  }

  /* Leave no mock in progress: the next run of anything starts from setup. */
  await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });

  console.log(
    `\nThe name budget: ${budget.fontSize}px type on a ${budget.available}px line at ` +
      `${LAPTOP.width}px wide, ${projectorBudget.fontSize}px on ${projectorBudget.available}px ` +
      `at ${PROJECTOR.width}px. Widest tokens "${budget.widestFirst.text}" and ` +
      `"${budget.widestLast.text}".`,
  );
  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);

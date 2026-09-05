/**
 * Proves the on-the-clock pane is readable from the back of the room, and that
 * it bought that with its own empty space rather than with the board's width.
 *
 *   BASE=http://localhost:3210 node scripts/verify-roster-pane.mjs
 *
 * THE COMPLAINT THIS EXISTS FOR, from the commissioner: "this roster pane on the
 * right side is kinda small and unreadable, too… font-wise anyway… we don't want
 * to eat up more real estate on the board, but the font and stuff could
 * absolutely be bigger and easier to read."
 *
 * Both halves of that are measurable, and both are measured here:
 *
 *   · BIGGER. Every string in the pane is converted to the angle it subtends
 *     from the furthest seat, by the arithmetic the board holds itself to in
 *     `src/lib/board-legibility.ts`, and held to the same two floors — 16 arcmin
 *     for a player's name, 12 for the labels, the pick numbers and the rest. The
 *     pane was under both.
 *   · WITHOUT MORE BOARD. The pane is 12.5vw and the assertion is that it is
 *     STILL exactly 12.5vw at every viewport. Legibility paid for with the
 *     grid's width would be a loss.
 *
 * And three things that would each make "bigger" a lie:
 *
 *   · NOTHING IS CUT. No ellipsis, no line clamp, no box overflowing its own
 *     width, and every name printed in full — checked against the row's own
 *     tooltip. Run against the longest names in the league's player file as well
 *     as against whatever the board happens to hold, because the name that
 *     breaks this layout is "Dorian Thompson-Robinson", not "Josh Allen".
 *   · NOTHING SCROLLED AWAY. Sixteen printed slots are the point of the card, so
 *     the list has to fit with no scrollbar. The type is sized against the space
 *     underneath it; this is the check that the space was really there.
 *   · EVERY ROW IS THE SAME SHAPE. One height and one pair of line offsets
 *     across all sixteen, filled or open, starter or bench.
 *
 * Screenshots land in `screenshots/`, each pane twice: once at the size it is
 * drawn, and once at a 0.6 device pixel ratio, which is roughly what the 1080p
 * screen gives the back seat.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = path.join(process.cwd(), "screenshots");

/*
 * The room, and the arithmetic. Literals rather than an import from
 * `src/lib/board-legibility.ts` so this runs on plain node with no loader; they
 * are the same numbers, and that file is where they are explained.
 *
 *   192 in of screen / 1920 px = 10 px per inch, read from 18 ft back.
 */
const PX_PER_INCH = 1920 / 192;
const FURTHEST_VIEWER_IN = 216;
const NAME_FLOOR_ARCMIN = 16;
const META_FLOOR_ARCMIN = 12;

/** What the pane is allowed to be, as a fraction of the viewport. Unchanged. */
const PANE_VW = 0.125;

/**
 * Which hue each starting slot's LABEL has to be drawn in.
 *
 * The league's starting nine, from `@/lib/league-config` by way of
 * `lineupSlots()`. Written out rather than derived because the point of the
 * assertion is that the pane agrees with what the league fields; a script that
 * read the same config could not catch the two of them drifting apart.
 *
 * FLEX and the bench are absent deliberately — see `checkTheLabelsAreColoured`.
 */
const SLOT_HUE = {
  QB: "qb",
  RB1: "rb",
  RB2: "rb",
  WR1: "wr",
  WR2: "wr",
  TE: "te",
  DST: "dst",
};

/**
 * The floor for a coloured label on the pane's own background.
 *
 * 4.5:1, which is WCAG AA for normal text — not the 3:1 large-text allowance,
 * because these labels are 15px and the allowance starts at 18.7px bold. The
 * five position hues land between 5.2 and 11.1, so none of them needed
 * brightening for this use; the check is here so that a future move on the
 * palette cannot quietly take one below the line.
 */
const LABEL_CONTRAST_FLOOR = 4.5;

/**
 * How much colour the FLEX rainbow has to keep, at its dullest column.
 *
 * Measured as the spread between a pixel's brightest and dimmest channel, over
 * 255 — 0 is a neutral grey. It is a crude stand-in for chroma and it is the
 * right crudeness here, because the thing being caught is exactly "this letter
 * has gone grey".
 *
 * 0.35 sits between the two versions of this gradient rather than at a round
 * number: blending the same three stops in sRGB bottomed out at 0.11, and
 * blending them in `oklch` holds 0.51. Anything that drops back under a third of
 * full saturation has lost the argument the oklch blend was there to win.
 */
const GRADIENT_CHROMA_FLOOR = 0.35;

const VIEWPORTS = [
  { name: "projector", width: 1920, height: 1080, tv: true, floors: true },
  { name: "retina", width: 2560, height: 1440, tv: false, floors: false },
  { name: "laptop", width: 1440, height: 900, tv: false, floors: false },
  { name: "laptop-window", width: 1440, height: 780, tv: false, floors: false },
  { name: "small-laptop", width: 1280, height: 800, tv: false, floors: false },
];

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

/** The angle a font size subtends from the furthest seat, in cap-height arcmin. */
function arcmin(fontPx, capRatio) {
  return ((fontPx * capRatio) / PX_PER_INCH / FURTHEST_VIEWER_IN) * 3438;
}

/** The widest names the pane could ever be asked to hold. */
function widestNames() {
  const pool = JSON.parse(
    readFileSync(path.join(process.cwd(), "data/smartdraft-players.json"), "utf8"),
  );
  const names = (Array.isArray(pool) ? pool : pool.players).map((p) => p.name);
  /* Length only picks the candidates; the widths that decide anything are
     measured in the browser, in the font actually in use. */
  return names.sort((a, b) => b.length - a.length).slice(0, 24);
}

/** The name in a row, as the row's own tooltip spells it. */
function tooltipName(title) {
  return title.match(/^[A-Z0-9]+:\s(.+?)\s—\s/)?.[1] ?? null;
}

/**
 * The whole pane, read out of the DOM.
 *
 * Rows are found by `data-slot-row`. Each row's printed name comes back beside
 * the name in its own `title`, so a row that abbreviates or drops a player fails
 * rather than being measured as though it had not.
 */
async function readPane(page) {
  return page.evaluate(() => {
    const round = (n) => Math.round(n * 100) / 100;
    const rows = [...document.querySelectorAll("[data-slot-row]")];
    const card = rows[0]?.closest("aside") ?? null;
    if (!card) return { found: false };

    const cs = (el) => getComputedStyle(el);
    const size = (el) => round(parseFloat(cs(el).fontSize));

    /*
     * COLOUR, THROUGH A CANVAS RATHER THAN A PARSER.
     *
     * `getComputedStyle().color` comes back as `lab(...)` or `oklab(... / 0.8)`
     * in this browser, and the tokens are `oklch()`. Painting a pixel and reading
     * it back turns every one of those into the sRGB the projector is actually
     * going to emit, which is also the only space the contrast formula is
     * defined in.
     */
    const ctx = document.createElement("canvas").getContext("2d");
    const rgba = (css) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#000";
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (fg, bg) => fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
    const luminance = (c) =>
      c
        .slice(0, 3)
        .map((v) => v / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const contrast = (a, b) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m);
      return round((hi + 0.05) / (lo + 0.05));
    };
    /* Every translucent layer between the text and the first opaque surface. */
    const backdrop = (el) => {
      const stack = [];
      for (let node = el; node; node = node.parentElement) {
        const c = rgba(cs(node).backgroundColor);
        if (c[3] > 0) stack.push(c);
        if (c[3] === 1) break;
      }
      return stack.reverse().reduce((acc, c) => over(c, acc), [0, 0, 0]);
    };
    const painted = (el) => {
      const bg = backdrop(el);
      const fg = over(rgba(cs(el).color), bg);
      return { fg: fg.map(Math.round), bg: bg.map(Math.round), ratio: contrast(fg, bg) };
    };

    /*
     * A GRADIENT-FILLED LABEL, MEASURED WHERE IT IS WEAKEST.
     *
     * FLEX is painted with `background-clip: text` and a transparent fill, so its
     * computed `color` is `rgba(0,0,0,0)` and says nothing about what lands on
     * the screen. Both the contrast and the saturation vary along the word, so a
     * single reading off a single stop would not be the answer either.
     *
     * So the gradient is walked column by column. A canvas gradient would be the
     * obvious way to replay it and it is the WRONG way: canvas interpolates in
     * sRGB, and the whole point of this label is that CSS is interpolating it in
     * `oklch`. Replaying it through `color-mix()` in the gradient's own declared
     * space asks the engine the same question the painter asked, so the numbers
     * below describe the pixels that actually reach the wall.
     */
    const gradientProbe = (el) => {
      const image = cs(el).backgroundImage;
      if (!image.startsWith("linear-gradient")) return null;
      /* Split the argument list on top-level commas — the colours have their own. */
      const args = [];
      let depth = 0;
      let head = 0;
      const body = image.slice(image.indexOf("(") + 1, image.lastIndexOf(")"));
      for (let i = 0; i <= body.length; i++) {
        const ch = body[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if ((ch === "," && depth === 0) || i === body.length) {
          args.push(body.slice(head, i).trim());
          head = i + 1;
        }
      }
      /*
       * The prelude is one argument holding both the direction and the space —
       * "to right in oklch". Absent a space, CSS interpolates in sRGB, which is
       * the bug this label was fixed for, so the default is named rather than
       * assumed.
       */
      const prelude = args[0];
      const space =
        prelude.match(
          /\bin ([a-z-]+(?: (?:longer|shorter|increasing|decreasing) hue)?)/,
        )?.[1] ?? "srgb";
      const stops = args
        .filter((a) => /\s-?[\d.]+%$/.test(a))
        .map((arg) => {
          const at = arg.lastIndexOf(" ");
          return { color: arg.slice(0, at).trim(), at: parseFloat(arg.slice(at)) };
        });
      if (stops.length < 2) return null;

      const bg = backdrop(el);
      const width = Math.max(2, Math.round(el.getBoundingClientRect().width));
      let worst = Infinity;
      let worstColor = null;
      /* Channel spread stands in for saturation: a grey has none of it. */
      let dullest = Infinity;
      let dullestColor = null;
      for (let x = 0; x < width; x++) {
        const at = (x / (width - 1)) * 100;
        let i = 0;
        while (i < stops.length - 2 && stops[i + 1].at < at) i++;
        const [a, b] = [stops[i], stops[i + 1]];
        const span = b.at - a.at;
        const t = span <= 0 ? 1 : Math.min(1, Math.max(0, (at - a.at) / span));
        const px = over(
          rgba(`color-mix(in ${space}, ${b.color} ${round(t * 100)}%, ${a.color})`),
          bg,
        );
        const ratio = contrast(px, bg);
        if (ratio < worst) {
          worst = ratio;
          worstColor = px.map(Math.round);
        }
        const spread = (Math.max(...px) - Math.min(...px)) / 255;
        if (spread < dullest) {
          dullest = spread;
          dullestColor = px.map(Math.round);
        }
      }
      return {
        prelude,
        space,
        stops: stops.map((s) => ({
          at: s.at,
          rgb: rgba(s.color).slice(0, 3).map(Math.round),
        })),
        clip: cs(el).webkitBackgroundClip || cs(el).backgroundClip,
        transparentFill: rgba(cs(el).color)[3] === 0,
        /*
         * What paints if `in oklch` is not understood: the inline declaration is
         * dropped and the class-based sRGB gradient is left. Read by taking the
         * inline one away and looking, which is the only way to be sure the
         * fallback is really there.
         */
        fallback: (() => {
          const inline = el.style.backgroundImage;
          if (!inline) return null;
          el.style.backgroundImage = "";
          const under = cs(el).backgroundImage;
          el.style.backgroundImage = inline;
          return under.startsWith("linear-gradient") ? under.slice(0, 60) : null;
        })(),
        bg: bg.map(Math.round),
        worst: round(worst),
        worstColor,
        dullest: round(dullest),
        dullestColor,
        samples: width,
      };
    };

    /*
     * The real cap height of the font in use, off the canvas rather than
     * assumed: `board-legibility.ts` takes 0.70 as the floor for a humanist
     * sans, and every arcminute here is 0.70-something of a font size.
     */
    const capRatioOf = (el) => {
      const s = cs(el);
      const ctx = document.createElement("canvas").getContext("2d");
      ctx.font = `${s.fontWeight} 100px ${s.fontFamily}`;
      return round(ctx.measureText("H").actualBoundingBoxAscent / 100);
    };

    const byText = (re) =>
      [...card.querySelectorAll("div,span")].find((el) => re.test(el.textContent ?? ""));

    const readRow = (row) => {
      const box = row.getBoundingClientRect();
      const [top, bottom] = [...row.children];
      const value = bottom.firstElementChild;
      const lock = [...row.querySelectorAll("svg")].find(
        (s) => cs(s).visibility !== "hidden",
      );
      /* Leaves only: the span that WRAPS the pick number holds the same text and
         inherits the root's 16px, which reads as a pass on any size check. */
      const pick = [...top.querySelectorAll("span")].find(
        (s) => s.children.length === 0 && /^\d+\.\d+$/.test(s.textContent.trim()),
      );
      const labelPaint = painted(top.firstElementChild);
      const valuePaint = painted(value);
      return {
        label: row.getAttribute("data-slot-row"),
        title: row.getAttribute("title") ?? "",
        height: round(box.height),
        labelColor: labelPaint.fg,
        labelBg: labelPaint.bg,
        labelRatio: labelPaint.ratio,
        labelGradient: gradientProbe(top.firstElementChild),
        valueColor: valuePaint.fg,
        valueRatio: valuePaint.ratio,
        /* Where each of the row's two lines starts, from the row's own top. */
        lines: [
          round(top.getBoundingClientRect().top - box.top),
          round(bottom.getBoundingClientRect().top - box.top),
        ],
        labelPx: size(top.firstElementChild),
        valueText: value.textContent.trim(),
        valuePx: size(value),
        /* How many lines the name actually took. More than one means it wrapped. */
        valueLines: Math.round(
          bottom.getBoundingClientRect().height / parseFloat(cs(bottom).lineHeight),
        ),
        valueWidth: round(value.getBoundingClientRect().width),
        valueRoom: round(bottom.getBoundingClientRect().width),
        metaPx: pick ? size(pick) : null,
        keeperMark: Boolean(lock),
        /* `currentColor` on the padlock is the claim; these are the evidence. */
        lockColor: lock ? cs(lock).color : null,
        tagColor: lock ? cs(lock.parentElement).color : null,
        rowColor: cs(row).color,
        lockPx: lock ? round(lock.getBoundingClientRect().height) : null,
      };
    };

    /* The scroll container the sixteen rows live in. */
    const list = rows[0].parentElement;
    const eyebrow = card.firstElementChild.firstElementChild;
    const summary = byText(/^\d+ starters? open|^Lineup set/);
    const bench = byText(/^Bench\d/);

    return {
      found: true,
      viewport: { w: innerWidth, h: innerHeight },
      fullscreen: Boolean(document.fullscreenElement),
      paneWidth: round(card.getBoundingClientRect().width),
      paneHeight: round(card.getBoundingClientRect().height),
      capRatio: capRatioOf(rows[0]),
      /*
       * THE SHARED PALETTE, resolved off the document root. `positions.ts` maps
       * a position to `text-pos-*`, which is `var(--color-pos-*)`, so these are
       * the same values the grid's position tags and the keeper padlock draw
       * with — and comparing a label against one of them is what proves the pane
       * took its colour from the palette rather than from a second copy of it.
       */
      hues: Object.fromEntries(
        ["qb", "rb", "wr", "te", "dst"].map((k) => [
          k,
          rgba(
            cs(document.documentElement).getPropertyValue(`--color-pos-${k}`).trim(),
          )
            .slice(0, 3)
            .map(Math.round),
        ]),
      ),
      /* Room still going spare under the last row — where the type came from. */
      slack: round(
        list.getBoundingClientRect().bottom -
          rows[rows.length - 1].getBoundingClientRect().bottom,
      ),
      listOverflow: round(list.scrollHeight - list.clientHeight),
      chrome: {
        eyebrowPx: size(eyebrow),
        titlePx: size(eyebrow.nextElementSibling),
        summaryPx: summary ? size(summary) : null,
        benchPx: bench ? size(bench.firstElementChild) : null,
        footerPx: size(card.lastElementChild),
      },
      rows: rows.map(readRow),
      cutters: [...card.querySelectorAll("*")].filter((el) => {
        const s = cs(el);
        return s.textOverflow === "ellipsis" || s.webkitLineClamp !== "none";
      }).length,
      overflowing: [card, ...card.querySelectorAll("*")]
        .filter((el) => {
          const d = cs(el).display;
          if (d === "inline" || d === "contents" || el.tagName === "svg") return false;
          return (
            el.scrollHeight - el.clientHeight > 2 || el.scrollWidth - el.clientWidth > 2
          );
        })
        .map((el) => `${el.tagName}.${String(el.className).slice(0, 28)}`),
    };
  });
}

function checkTheTypeIsBigEnough(p) {
  check(
    "the font draws a capital at least 0.70 of its em, as the board assumes",
    p.capRatio >= 0.7,
    `measured ${p.capRatio}`,
  );
  const A = (px) => Math.round(arcmin(px, p.capRatio) * 10) / 10;

  const named = p.rows.filter((r) => tooltipName(r.title));
  const namePx = Math.min(...named.map((r) => r.valuePx));
  check(
    `a player's name clears ${NAME_FLOOR_ARCMIN} arcmin from 18 ft`,
    named.length > 0 && A(namePx) >= NAME_FLOOR_ARCMIN,
    `${namePx}px = ${A(namePx)} arcmin`,
  );

  const open = p.rows.filter((r) => r.valueText === "open").map((r) => r.valuePx);
  const meta = p.rows.map((r) => r.metaPx).filter((n) => n != null);
  const rest = [
    ["slot labels", Math.min(...p.rows.map((r) => r.labelPx))],
    ["the open placeholders", open.length ? Math.min(...open) : null],
    ["the pick numbers", meta.length ? Math.min(...meta) : null],
    ["the header's eyebrow", p.chrome.eyebrowPx],
    ["the franchise's name", p.chrome.titlePx],
    ["the starters-open bar", p.chrome.summaryPx],
    ["the bench header", p.chrome.benchPx],
    ["the picks-left footer", p.chrome.footerPx],
  ];
  for (const [what, px] of rest) {
    check(
      `${what} clear ${META_FLOOR_ARCMIN} arcmin`,
      px != null && A(px) >= META_FLOOR_ARCMIN,
      px == null ? "not found" : `${px}px = ${A(px)} arcmin`,
    );
  }
}

function checkItTookNoBoardWidth(p) {
  const want = Math.round(p.viewport.w * PANE_VW);
  check(
    `the pane is still ${PANE_VW * 100}vw of the screen and no more`,
    Math.abs(p.paneWidth - want) <= 1,
    `${p.paneWidth}px at ${p.viewport.w} wide, wanted ${want}px`,
  );
}

function checkNothingIsCut(p) {
  check("nothing in the pane could cut text — no ellipsis, no line clamp", p.cutters === 0);
  check(
    "no box in the pane overflows what it was given",
    p.overflowing.length === 0,
    p.overflowing.slice(0, 3).join(" | "),
  );
  const named = p.rows.filter((r) => tooltipName(r.title));
  const wrong = named.filter((r) => r.valueText !== tooltipName(r.title));
  check(
    `every filled slot prints its player's whole name (${named.length})`,
    named.length > 0 && wrong.length === 0,
    wrong.slice(0, 3).map((r) => `"${r.valueText}" for ${tooltipName(r.title)}`).join(" | "),
  );
  const empty = p.rows.filter((r) => !tooltipName(r.title));
  check(
    `every empty slot still says so (${empty.length})`,
    empty.every((r) => r.valueText === "open"),
  );
  check(
    `all ${p.rows.length} slots are on screen without scrolling`,
    p.rows.length === 16 && p.listOverflow <= 1,
    `${p.listOverflow}px hidden, ${p.slack}px of room to spare`,
  );
}

function checkEveryRowIsTheSameShape(p) {
  /*
   * The last row draws no bottom border — `last:border-b-0`, so the card does
   * not put a line against its own frame — which makes it 1px shorter by design.
   */
  const heights = [...new Set(p.rows.map((r) => r.height))].sort((a, b) => a - b);
  check(
    `all ${p.rows.length} rows are the same height`,
    heights.length === 1 || (heights.length === 2 && heights[1] - heights[0] <= 1),
    `${heights.join(", ")}px`,
  );
  const shapes = new Set(p.rows.map((r) => JSON.stringify(r.lines)));
  check(
    "and lay their two lines out identically, filled or open",
    shapes.size === 1,
    [...shapes].join("  |  "),
  );
}

/**
 * The colour on the labels, and only on the labels.
 *
 * Four separate claims, because they can fail independently:
 *
 *   · A dedicated starting slot's label is its position's hue, filled or empty —
 *     the pane has to be colour-coded on a roster nobody has drafted into yet,
 *     which is what most of draft night looks like.
 *   · FLEX is neutral until somebody is in it, and then takes that player's hue.
 *   · The bench is grey whatever is in it.
 *   · The NAMES ARE STILL WHITE. The point of colouring the labels was to leave
 *     the names alone, so a change that tinted them would be a regression even
 *     though everything else here would still pass.
 */
function checkTheLabelsAreColoured(p) {
  const same = (a, b) => a && b && a.every((v, i) => Math.abs(v - b[i]) <= 2);
  const anyHue = (c) => Object.values(p.hues).some((h) => same(c, h));

  const dedicated = p.rows.filter((r) => SLOT_HUE[r.label]);
  const wrongHue = dedicated.filter((r) => !same(r.labelColor, p.hues[SLOT_HUE[r.label]]));
  check(
    `every dedicated starting slot's label is its own position's hue (${dedicated.length})`,
    dedicated.length === 7 && wrongHue.length === 0,
    wrongHue
      .map((r) => `${r.label} drew ${r.labelColor} not ${p.hues[SLOT_HUE[r.label]]}`)
      .join(" | "),
  );
  const emptyDedicated = dedicated.filter((r) => !tooltipName(r.title));
  check(
    `…including the ones with nobody in them yet (${emptyDedicated.length})`,
    emptyDedicated.length > 0 &&
      emptyDedicated.every((r) => same(r.labelColor, p.hues[SLOT_HUE[r.label]])),
  );

  /*
   * FLEX IS FLEX, whatever is standing in it — "no, flex is flex. It can stay
   * the rainbow gradient." The label describes what the slot accepts, so it is
   * the same in an empty row and a filled one, and the assertion is
   * unconditional. Both states are exercised: the live board's flexes are empty,
   * the mock's are full.
   */
  const flex = p.rows.filter((r) => r.label.startsWith("FLEX"));
  const filled = flex.filter((r) => tooltipName(r.title)).length;
  const noGradient = flex.filter((r) => !r.labelGradient);
  check(
    `both FLEX labels carry the rainbow, in every state (${filled} of ${flex.length} filled)`,
    flex.length === 2 && noGradient.length === 0,
    noGradient.map((r) => r.label).join(", "),
  );
  /*
   * Three palette hues, each held flat across a glyph, IN HUE ORDER — blue at
   * 255°, mint at 152°, amber at 84°, so the sweep only ever turns one way. The
   * order is not decoration: mint → blue → amber doubled back through the greens
   * and that is half of why the middle of the word looked dirty.
   */
  const wrongStops = flex.filter((r) => {
    const stops = r.labelGradient?.stops ?? [];
    const want = [p.hues.rb, p.hues.rb, p.hues.wr, p.hues.wr, p.hues.te, p.hues.te];
    return (
      stops.length !== 6 ||
      stops.some((s, i) => !same(s.rgb, want[i])) ||
      stops[0].at !== 0 ||
      stops[5].at !== 100 ||
      /* Each hue flat over a run, rather than the whole word being one smear. */
      !stops.every((s, i) => i % 2 === 0 || s.at > stops[i - 1].at)
    );
  });
  check(
    "and hold three palette hues in hue order — RB, WR, TE, one to a glyph",
    wrongStops.length === 0,
    flex[0]?.labelGradient
      ? flex[0].labelGradient.stops.map((s) => `${s.rgb}@${s.at}%`).join(" ")
      : "no gradient found",
  );
  const wrongSpace = flex.filter((r) => r.labelGradient?.space !== "oklch");
  check(
    "blended in oklch, not sRGB, so the middle of the word keeps its chroma",
    wrongSpace.length === 0,
    flex[0]?.labelGradient
      ? `"${flex[0].labelGradient.prelude}"`
      : "no gradient found",
  );
  const noFallback = flex.filter((r) => !r.labelGradient?.fallback);
  check(
    "with a plain sRGB gradient underneath it, for an engine that cannot read oklch",
    noFallback.length === 0,
    flex[0]?.labelGradient?.fallback
      ? `${flex[0].labelGradient.fallback}…`
      : "the label would be invisible without one",
  );
  const notClipped = flex.filter(
    (r) => r.labelGradient?.clip !== "text" || !r.labelGradient?.transparentFill,
  );
  check(
    "painted through the text, so no box moved to get it",
    notClipped.length === 0,
    notClipped.map((r) => r.label).join(", "),
  );

  const bench = p.rows.filter((r) => /^BN\d+$/.test(r.label));
  check(
    `no bench label is position-coloured (${bench.length})`,
    bench.length === 7 && bench.every((r) => !anyHue(r.labelColor)),
    bench.filter((r) => anyHue(r.labelColor)).map((r) => r.label).join(", "),
  );

  const named = p.rows.filter((r) => tooltipName(r.title));
  /* Achromatic within a couple of steps, which no position hue is. */
  const tinted = named.filter(
    (r) => Math.max(...r.valueColor) - Math.min(...r.valueColor) > 12,
  );
  check(
    `every player's name is still drawn white, not tinted (${named.length})`,
    named.length > 0 && tinted.length === 0,
    tinted.length
      ? tinted.map((r) => `${r.label} ${r.valueColor}`).join(" | ")
      : `${named[0]?.valueColor} at ${named[0]?.valueRatio}:1`,
  );
}

/** Whether a coloured label is still readable on the dark it sits on. */
function checkTheColoursHoldUpOnDark(p) {
  const solid = p.rows.filter((r) => SLOT_HUE[r.label]);
  const dim = solid.filter((r) => r.labelRatio < LABEL_CONTRAST_FLOOR);
  check(
    `every solid label clears ${LABEL_CONTRAST_FLOOR}:1 against its own row`,
    solid.length > 0 && dim.length === 0,
    dim.length
      ? dim.map((r) => `${r.label} ${r.labelRatio}:1`).join(" | ")
      : solid.map((r) => `${r.label} ${r.labelRatio}`).join("  "),
  );

  /*
   * The gradient's floor is checked at its WEAKEST COLUMN, not at a stop. Blue
   * has the least headroom of the three and sits at the midpoint, so this is the
   * number that would go first if the palette ever moved.
   */
  const flex = p.rows.filter((r) => r.labelGradient);
  const faded = flex.filter((r) => r.labelGradient.worst < LABEL_CONTRAST_FLOOR);
  check(
    `the rainbow clears ${LABEL_CONTRAST_FLOOR}:1 at its worst point too`,
    flex.length > 0 && faded.length === 0,
    flex.length
      ? `worst ${Math.min(...flex.map((r) => r.labelGradient.worst))}:1 at ` +
          `${flex[0].labelGradient.worstColor} over ${flex[0].labelGradient.bg},` +
          ` ${flex[0].labelGradient.samples} columns sampled`
      : "no gradient found",
  );
  /*
   * AND THAT IT NEVER GOES GREY, which is the complaint that produced the oklch
   * blend: "the E and X in the middle are washed-out grey-blue". The sRGB version
   * of this gradient bottomed out at 0.11 of channel spread — a hair off neutral
   * — where the oklch one holds above 0.5.
   */
  const dull = flex.filter((r) => r.labelGradient.dullest < GRADIENT_CHROMA_FLOOR);
  check(
    `and stays coloured all the way across — no column duller than ${GRADIENT_CHROMA_FLOOR}`,
    flex.length > 0 && dull.length === 0,
    flex.length
      ? `dullest ${Math.min(...flex.map((r) => r.labelGradient.dullest))} at ` +
          `${flex[0].labelGradient.dullestColor}`
      : "",
  );

  const names = p.rows.filter((r) => tooltipName(r.title));
  const loudest = Math.max(...solid.map((r) => r.labelRatio));
  check(
    "and the names, being white, are the highest-contrast thing in the pane",
    names.length > 0 && names.every((r) => r.valueRatio > loudest),
    `names ${names[0]?.valueRatio}:1 against ${loudest}:1`,
  );
}

/**
 * The pane's shape at the projector, to the hundredth of a pixel.
 *
 * These are not preferences, they are the measurements `de327e7` left behind and
 * every change since has had to leave alone: the pane's box, the row, and where
 * a row's two lines start. A tripwire, deliberately brittle — the rainbow on the
 * FLEX labels is painted with `background-clip`, and the reason it is painted
 * rather than built out of three spans is that it must not move any of this.
 *
 * A deliberate change to the type scale is expected to fail here and to update
 * these numbers in the same commit.
 */
const PROJECTOR_GEOMETRY = {
  /*
   * 9.72px shorter than it was, and the bar above the board is why. That bar's
   * state line wrapped to a second line whenever the cursor sat on a traded
   * pick, so the board and this pane lost 9.72px on the way onto one of the 29
   * traded picks and got it back on the way off. The bar now reserves both
   * lines whether or not the second is used, so this box is 1001.92px at every
   * cursor position instead of 1011.64px at some of them.
   *
   * The row height and the line offsets below are untouched, which is the part
   * that says the type scale did not move — only the height the pane is handed.
   *
   * 5.39px shorter again, and the bar above the board is why a second time. It
   * had a top margin and no bottom one, so it sat flush on the franchise-name
   * row with under 3px between them and the two read as one block; it now
   * carries the matching `mb-[0.5vh]`, which is 5.39px of the projector that
   * the board and this pane hand over. The row height and line offsets are
   * again untouched, so the type scale did not move.
   */
  pane: [240, 996.53],
  row: 45.39,
  /* The last row draws no bottom border, so it is 1px shorter by design. */
  lastRow: 44.39,
  lines: [4.86, 21.11],
};

/**
 * `box` is off on the mock, whose board has a strip of its own above the pane, so
 * the pane is genuinely shorter there. The ROWS are the same on both, which is
 * the part a gradient could have broken.
 */
function checkTheGeometryDidNotMove(p, { box = true } = {}) {
  const g = PROJECTOR_GEOMETRY;
  if (box) {
    check(
      "the pane is the same box it was before the colour went on",
      p.paneWidth === g.pane[0] && Math.abs(p.paneHeight - g.pane[1]) < 0.01,
      `${p.paneWidth}x${p.paneHeight}, was ${g.pane.join("x")}`,
    );
  }
  const heights = [...new Set(p.rows.map((r) => r.height))].sort((a, b) => a - b);
  check(
    "and the rows are the same height, to the hundredth of a pixel",
    heights.length === 2 &&
      Math.abs(heights[0] - g.lastRow) < 0.01 &&
      Math.abs(heights[1] - g.row) < 0.01,
    `${heights.join(", ")}, was ${g.lastRow}, ${g.row}`,
  );
  const lines = [...new Set(p.rows.map((r) => JSON.stringify(r.lines)))];
  check(
    "and each row's two lines start exactly where they did",
    lines.length === 1 && lines[0] === JSON.stringify(g.lines),
    `${lines.join(" | ")}, was ${JSON.stringify(g.lines)}`,
  );
}

function checkTheKeepersAreMarked(p) {
  const keepers = p.rows.filter((r) => /kept at/.test(r.title));
  const unmarked = keepers.filter((r) => !r.keeperMark);
  check(
    `every keeper carries its padlock (${keepers.length})`,
    keepers.length > 0 && unmarked.length === 0,
    unmarked.map((r) => r.label).join(", "),
  );
  const falseMark = p.rows.filter((r) => !/kept at/.test(r.title) && r.keeperMark);
  check(
    "and no slot that was drafted shows one",
    falseMark.length === 0,
    falseMark.map((r) => r.label).join(", "),
  );
  /*
   * The padlock takes the position tag's colour off `currentColor`, which is
   * what the grid does with it too. Asserted as "the same colour as its tag, and
   * not the colour of the row", so a refactor that hard-codes a grey fails here.
   */
  const wrongHue = keepers.filter(
    (r) => r.lockColor !== r.tagColor || r.lockColor === r.rowColor,
  );
  check(
    "and draws it in its position's colour, not the row's",
    keepers.length > 0 && wrongHue.length === 0,
    keepers.length ? `${keepers[0].lockColor} on a row of ${keepers[0].rowColor}` : "",
  );
  const small = keepers.filter((r) => r.lockPx < r.metaPx);
  check(
    "at a size that reads as a mark, not a speck",
    small.length === 0,
    keepers.length ? `${keepers[0].lockPx}px lock beside ${keepers[0].metaPx}px type` : "",
  );
}

/**
 * Fills the pane with the widest names in the league's own player file.
 *
 * The board holds whoever it holds, and "Ladd McConkey" proves nothing about a
 * card whose type is sized to the width of a pane. This replaces printed text
 * only — no state, no re-render — because the question is purely one of layout:
 * does the longest name in the pool still fit on one line, and where it cannot,
 * does it wrap rather than vanish.
 */
async function stress(page, names) {
  return page.evaluate((names) => {
    let i = 0;
    for (const row of document.querySelectorAll("[data-slot-row]")) {
      const value = row.children[1].firstElementChild;
      if (value.textContent.trim() === "open") continue;
      value.textContent = names[i % names.length];
      value.closest("[data-slot-row]").setAttribute(
        "title",
        `${row.getAttribute("data-slot-row")}: ${names[i % names.length]} — stress, ??, drafted 1.01`,
      );
      i++;
    }
    return i;
  }, names);
}

/** The pane on its own, at the size it is drawn. */
async function shoot(page, name) {
  const clip = await page.evaluate(() => {
    const b = document
      .querySelector("[data-slot-row]")
      .closest("aside")
      .getBoundingClientRect();
    return {
      x: Math.floor(b.x),
      y: Math.floor(b.y),
      width: Math.ceil(b.width),
      height: Math.ceil(b.height),
    };
  });
  await page.screenshot({ path: path.join(OUT, `roster-pane-${name}.png`), clip });
  console.log(`    → screenshots/roster-pane-${name}.png`);
}

/** Puts a franchise with a filling roster on the clock, on the mock's own board. */
async function populateMock(page, steps) {
  await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });
  await page.goto(`${BASE}/mock`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.getByTitle(/^Quick/).click();
  await page.waitForTimeout(120);
  await page.getByTitle("Begin the mock with these settings").click();
  await page.waitForTimeout(600);
  /* The bots start running on their own, and Step only exists while paused. */
  await page.getByTitle("Pause the bots").click();
  await page.waitForTimeout(200);
  /*
   * Stepped rather than finished. `Finish` drafts the whole board, and then
   * nobody is on the clock — the one state this pane does not have to be legible
   * in. Stepping stops mid-draft with somebody's roster nearly full.
   */
  const step = page.getByTitle("Let one bot pick, then stop again");
  for (let i = 0; i < steps; i++) await step.click({ timeout: 5000 });
  await page.waitForTimeout(500);
}

const browser = await chromium.launch();
const names = widestNames();

try {
  for (const v of VIEWPORTS) {
    for (const dpr of [1, 0.6]) {
      const page = await browser.newPage({
        viewport: { width: v.width, height: v.height },
        deviceScaleFactor: dpr,
      });
      if (dpr === 1) {
        section(
          `The real board, keepers on the clock — ${v.width}x${v.height}` +
            (v.tv ? " TV mode" : ""),
        );
      }
      await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);
      if (v.tv) {
        /* Requested from an evaluated call: headless Chromium refuses
           `requestFullscreen` from a synthetic click and honours it from here. */
        await page.evaluate(() => document.documentElement.requestFullscreen());
        await page.waitForTimeout(700);
      }
      if (dpr === 1) {
        const p = await readPane(page);
        check("the pane drew itself", p.found === true);
        if (p.found) {
          if (v.tv) check("TV mode is on", p.fullscreen === true);
          checkItTookNoBoardWidth(p);
          checkNothingIsCut(p);
          checkEveryRowIsTheSameShape(p);
          checkTheKeepersAreMarked(p);
          checkTheLabelsAreColoured(p);
          checkTheColoursHoldUpOnDark(p);
          if (v.floors) {
            checkTheTypeIsBigEnough(p);
            checkTheGeometryDidNotMove(p);
          }
          console.log(
            `    pane ${p.paneWidth}x${p.paneHeight}px, row ${p.rows[0].height}px,` +
              ` name ${p.rows.find((r) => tooltipName(r.title))?.valuePx}px`,
          );
        }
        await shoot(page, `${v.name}-keepers`);
      } else {
        await shoot(page, `${v.name}-keepers-60pct`);
      }
      await page.close();
    }
  }

  /* --- The narrowest pane the board is ever run at, holding the same names -- */
  {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
    });
    section("The widest names in a 160px pane — 1280x800");
    await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await stress(page, names);
    await page.waitForTimeout(200);
    const p = await readPane(page);
    checkItTookNoBoardWidth(p);
    check("nothing could cut text", p.cutters === 0);
    check(
      "no box overflows what it was given",
      p.overflowing.length === 0,
      p.overflowing.slice(0, 3).join(" | "),
    );
    const lines = Math.max(...p.rows.map((r) => r.valueLines));
    /*
     * A 160px pane cannot hold "Dorian Thompson-Robinson" on one line at a size
     * anybody would want to read, so here it wraps — onto a second line, at the
     * hyphen, with the row growing to hold it. Two is the ceiling: three would
     * mean the name is being broken mid-word.
     */
    check(`the longest names wrap rather than being cut (${lines} lines)`, lines <= 2);
    console.log(`    ${p.listOverflow}px of list below the fold, ${p.slack}px spare`);
    await shoot(page, "small-laptop-widest-names");
    await page.close();
  }

  /* --- A filling roster, and then the widest names in the pool ------------- */
  for (const dpr of [1, 0.6]) {
    const page = await browser.newPage({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: dpr,
    });
    if (dpr === 1) section("A mock mid-draft, a roster filling up — 1920x1080");
    await populateMock(page, 96);
    if (dpr === 1) {
      const p = await readPane(page);
      check("the pane drew itself on the mock's board too", p.found === true);
      if (p.found) {
        checkItTookNoBoardWidth(p);
        checkNothingIsCut(p);
        checkEveryRowIsTheSameShape(p);
        checkTheLabelsAreColoured(p);
        checkTheColoursHoldUpOnDark(p);
        checkTheTypeIsBigEnough(p);
        checkTheGeometryDidNotMove(p, { box: false });
        const wrapped = p.rows.filter((r) => r.valueLines > 1);
        check(
          "no drafted name had to wrap",
          wrapped.length === 0,
          wrapped.map((r) => `${r.label} "${r.valueText}"`).join(" | "),
        );
        console.log(
          `    ${p.rows.filter((r) => tooltipName(r.title)).length} slots filled,` +
            ` widest name drawn ${Math.max(...p.rows.map((r) => r.valueWidth))}px in` +
            ` ${p.rows[0].valueRoom}px of line`,
        );
      }
      await shoot(page, "mock-full");
    } else {
      await shoot(page, "mock-full-60pct");
    }

    section(dpr === 1 ? "The same rows holding the widest names in the pool" : "");
    const swapped = await stress(page, names);
    await page.waitForTimeout(200);
    if (dpr === 1) {
      const p = await readPane(page);
      check(`the longest names in the pool went in (${swapped} slots)`, swapped > 0);
      checkItTookNoBoardWidth(p);
      checkNothingIsCut(p);
      const wrapped = p.rows.filter((r) => r.valueLines > 1);
      check(
        "and every one of them still fits on one line",
        wrapped.length === 0,
        wrapped
          .map((r) => `${r.label} "${r.valueText}" over ${r.valueLines} lines`)
          .join(" | "),
      );
      console.log(
        `    widest drawn ${Math.max(...p.rows.map((r) => r.valueWidth))}px of` +
          ` ${p.rows[0].valueRoom}px available`,
      );
      await shoot(page, "widest-names");
    } else {
      await shoot(page, "widest-names-60pct");
    }
    await page.close();
  }

  /* Leave no mock in progress: the next run of anything starts from setup. */
  await fetch(`${BASE}/api/mock-draft/state`, { method: "DELETE" });

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);

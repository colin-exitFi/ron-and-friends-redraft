/**
 * Palette helper for integrating a design revision.
 *
 * Converts hex to the exact oklch the token sheet records, and prints the WCAG
 * ratios the tables in BRANDING.md quote. Both matter when a palette lands:
 * `globals.css` documents every token as `hex` plus its exact oklch conversion,
 * and the light-vs-dark knockout on a solid fill is the decision most often got
 * wrong by eye (white on the cyan accent looks fine and is 2.33:1).
 *
 *   node scripts/hex-to-oklch.mjs                     # the current palette
 *   node scripts/hex-to-oklch.mjs '#06b6d4' '#18181b' # ad-hoc: convert, then
 *                                                     # ratio each against the
 *                                                     # first argument
 */

const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

const channels = (hex) => {
  const h = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`not a 6-digit hex: ${hex}`);
  return [0, 2, 4].map((i) => srgbToLinear(parseInt(h.slice(i, i + 2), 16) / 255));
};

/** sRGB hex -> oklch, matching the values recorded in globals.css. */
export function hexToOklch(hex) {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.sqrt(A * A + B * B);
  const H = (Math.atan2(B, A) * 180) / Math.PI;
  return {
    css: `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${(H < 0 ? H + 360 : H).toFixed(1)})`,
    L,
    C,
    H: H < 0 ? H + 360 : H,
  };
}

const luminance = (hex) => {
  const [r, g, b] = channels(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio. Order-independent. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------------- */

const CANVAS = "#09090b";

/** The current palette, in the order BRANDING.md lists it. */
const PALETTE = {
  "--ds-canvas": CANVAS,
  "--ds-surface": "#18181b",
  "--ds-elevated": "#27272a",
  "--ds-border": "#3f3f46",
  "--ds-text": "#fafafa",
  "--ds-text-sec": "#a1a1aa",
  "--ds-muted": "#52525b",
  "--ds-cyan": "#06b6d4",
  "--ds-cyan-hover": "#0ea5e9",
  "--ds-pink": "#fc19a9",
  "--ds-blue": "#1187fc",
  "--ds-mint": "#1fdf75",
  "--ds-lavender": "#b25cfc",
  "--ds-amber": "#edb41a",
  "--ds-green": "#10b981",
  "--ds-red": "#ef4444",
};

/** The five position hues. */
const POSITIONS = {
  QB: "#fc19a9",
  TE: "#edb41a",
  WR: "#1fdf75",
  RB: "#1187fc",
  DST: "#b25cfc",
};

/*
 * The three hues that are NOT positions but still render inside the board grid,
 * which makes them fixed points the positions have to be solved around rather
 * than a separate concern:
 *
 *   destructive  the reach-vs-ADP ring, drawn AROUND a position-tinted cell
 *   success      the steal-vs-ADP ring, same place
 *   accent       the live cell, and every focus ring on the screen
 *
 * Leaving these out is how an earlier palette scored a comfortable 44.3° while
 * actually shipping a 7.3° collision: WR mint sat under a green steal ring.
 */
const FIXED = {
  "reach ring": "#ef4444",
  "steal ring": "#10b981",
  accent: "#06b6d4",
};

const args = process.argv.slice(2);

if (args.length) {
  const [ground, ...rest] = args;
  console.log(ground.padEnd(10), hexToOklch(ground).css);
  for (const hex of rest) {
    console.log(
      hex.padEnd(10),
      hexToOklch(hex).css,
      `| vs ${ground}: ${contrast(ground, hex).toFixed(2)}:1`,
    );
  }
} else {
  console.log("token                oklch                        on canvas");
  for (const [token, hex] of Object.entries(PALETTE)) {
    const ratio = hex === CANVAS ? "—" : `${contrast(CANVAS, hex).toFixed(1)}:1`;
    console.log(
      token.padEnd(20),
      hexToOklch(hex).css.padEnd(28),
      ratio.padStart(8),
      hex,
    );
  }

  // Every position hue here is light enough that dark text wins. Getting this
  // backwards is what made the old skin's chips 1.6:1 at worst.
  console.log("\nsolid fills — which knockout wins");
  for (const [pos, hex] of Object.entries({
    ...POSITIONS,
    ACCENT: "#06b6d4",
    // The traded-pick strip. Neutral, so it is the one solid fill on the board
    // whose knockout is not a close call.
    TRADE: "#fafafa",
  })) {
    const white = contrast(hex, "#fafafa");
    const dark = contrast(hex, CANVAS);
    console.log(
      pos.padEnd(7),
      hex,
      `white ${white.toFixed(2)}:1`.padEnd(16),
      `dark ${dark.toFixed(2)}:1`.padEnd(15),
      `-> ${dark > white ? "dark" : "white"}`,
    );
  }

  /*
   * The board is read by hue at distance, so the tightest gap is the risk — and
   * it has to be measured across every hue the grid draws, positions and fixed
   * marks together. Measuring positions alone flatters the palette and hides
   * exactly the failure it should catch.
   */
  const separation = (hues) => {
    const entries = Object.entries(hues);
    let tightest = [Infinity, ""];
    for (const [pa, ha] of entries) {
      for (const [pb, hb] of entries) {
        if (pa >= pb) continue;
        const raw = Math.abs(ha - hb);
        const gap = Math.min(raw, 360 - raw);
        if (gap < tightest[0]) tightest = [gap, `${pa}/${pb}`];
      }
    }
    return tightest;
  };

  const toHues = (o) =>
    Object.fromEntries(Object.entries(o).map(([k, hex]) => [k, hexToOklch(hex).H]));
  const posHues = toHues(POSITIONS);
  const boardHues = { ...posHues, ...toHues(FIXED) };

  console.log("\nboard hue separation (degrees; the tightest pair is the risk)");
  console.log(
    "  positions   ",
    Object.entries(posHues)
      .sort((a, b) => a[1] - b[1])
      .map(([p, h]) => `${p} ${h.toFixed(0)}°`)
      .join("  "),
  );
  console.log(
    "  fixed marks ",
    Object.entries(toHues(FIXED))
      .sort((a, b) => a[1] - b[1])
      .map(([p, h]) => `${p} ${h.toFixed(0)}°`)
      .join("  "),
  );
  const posOnly = separation(posHues);
  const tightest = separation(boardHues);
  console.log(`\n  positions only : ${posOnly[1]} at ${posOnly[0].toFixed(1)}°`);
  console.log(`  all board hues : ${tightest[1]} at ${tightest[0].toFixed(1)}°`);

  /*
   * A tight pair between a position and a ring is only a defect if the two also
   * land at the same lightness — that is what made the old WR mint / steal ring
   * pair unreadable at 1.46:1. The rings are drawn full-strength on an 18% tint,
   * so print the contrast that actually decides it.
   */
  const tint = (hex, pct = 0.18) => {
    const [a, b] = [hex.replace("#", ""), "0a0a0c"];
    return (
      "#" +
      [0, 2, 4]
        .map((i) =>
          Math.round(
            parseInt(a.slice(i, i + 2), 16) * pct +
              parseInt(b.slice(i, i + 2), 16) * (1 - pct),
          )
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  };
  console.log("\nrings against the cell tint they are drawn on (the real test)");
  for (const [pos, hex] of Object.entries(POSITIONS)) {
    const cell = tint(hex);
    console.log(
      `  ${pos.padEnd(4)}${cell}  reach ${contrast(cell, FIXED["reach ring"]).toFixed(2)}:1` +
        `   steal ${contrast(cell, FIXED["steal ring"]).toFixed(2)}:1`,
    );
  }
  /*
   * WR mint is 10.8° from the steal ring, the one real hue overlap in the set.
   * The ring stays readable because it is full strength on an 18% tint, so the
   * comparison the eye makes is ring-against-cell (above), not hue-against-hue:
   * mint against the steal green direct is only 1.87:1.
   */
  console.log(
    "  WR mint vs the steal green directly: " +
      `${contrast(POSITIONS.WR, FIXED["steal ring"]).toFixed(2)}:1 ` +
      "— which is why the ring is never drawn at tint strength",
  );

  /*
   * Whether the board has a hue to spare, which is the question every proposal
   * for a new mark on it turns out to be. The bar to clear is the number above:
   * a candidate closer to something claimed than the positions are to each
   * other will be read as that thing. Nothing clears it, which is why the
   * traded-pick strip is neutral — see `--trade` in globals.css.
   */
  console.log(
    `\nis any hue actually free? (nearest claimed hue; bar is the ${posOnly[0].toFixed(1)}° position floor)`,
  );
  // Keeper and trade are absent on purpose: both are neutral now, so neither
  // claims a hue.
  const CANDIDATES = {
    "orange #e85d30": "#e85d30",
    "old cyan #06b6d4": "#06b6d4",
    "magenta #f472b6": "#f472b6",
    "lime #bdd225": "#bdd225",
    "teal #14b8a6": "#14b8a6",
  };
  for (const [name, hex] of Object.entries(CANDIDATES)) {
    const h = hexToOklch(hex).H;
    let nearest = [Infinity, ""];
    for (const [claim, ch] of Object.entries(boardHues)) {
      const raw = Math.abs(h - ch);
      const gap = Math.min(raw, 360 - raw);
      if (gap < nearest[0]) nearest = [gap, claim];
    }
    console.log(
      name.padEnd(16),
      `${h.toFixed(0)}°`.padStart(5),
      `${nearest[0].toFixed(1)}° from ${nearest[1]}`.padEnd(26),
      // Measured against the POSITION floor. The WR/steal overlap is an accepted
      // exception, so using the all-hue floor here would wave candidates through.
      nearest[0] < posOnly[0] ? "-> too close" : "-> clears the bar",
    );
  }
}

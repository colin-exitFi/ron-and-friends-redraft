/**
 * Position accent classes for player badges across the app.
 *
 * The five hues are theme tokens (`--color-pos-*` in globals.css) rather than
 * Tailwind palette colours, but they remain the one colour group that is *not*
 * derived from the accent: they encode position at a glance on the draft board
 * and must stay mutually distinct regardless of what the rest of the palette
 * does. See BRANDING.md.
 *
 * Smart Draft calls team defenses DST; older data called them DEF. Both keys
 * exist so a badge never falls through to the muted default. There is no K
 * entry — this league does not use the position.
 */

/** Chip treatment: tinted fill, solid text, matching ring. */
export const POSITION_STYLES: Record<string, string> = {
  QB: "bg-pos-qb/15 text-pos-qb ring-pos-qb/40",
  RB: "bg-pos-rb/15 text-pos-rb ring-pos-rb/40",
  WR: "bg-pos-wr/15 text-pos-wr ring-pos-wr/40",
  TE: "bg-pos-te/15 text-pos-te ring-pos-te/40",
  DST: "bg-pos-dst/15 text-pos-dst ring-pos-dst/40",
  DEF: "bg-pos-dst/15 text-pos-dst ring-pos-dst/40",
};

export function positionStyle(pos: string | null | undefined): string {
  return POSITION_STYLES[pos ?? ""] ?? "bg-muted text-muted-foreground ring-border";
}

/**
 * The solid chip: the full-strength hue, used where the chip sits on a surface
 * rather than inside an already-tinted cell.
 *
 * Dark knockout on all five, where this used to be white on all five. White
 * loses on every one and it is not close: WR mint 1.7:1, TE amber 1.8:1, and
 * even the darkest three — QB pink, RB blue and DST lavender — only reach
 * 3.5:1. The canvas knocked out of the same five runs 5.5:1 to 11.3:1.
 * Matches the palette's own button treatment, which sets dark text on cyan.
 *
 * That 5.5:1 floor is DOWN from 7.5:1 under the pastel set, and it is the price
 * of saturation rather than an oversight: chroma lives at lower lightness, so
 * the three hues that gained the most (QB +52%, RB +38%, DST +30%) are also the
 * three that gave up contrast. 5:1 is the floor it was stopped at — clear of AA
 * for normal text, and well clear of the dead zone near L 0.59 where dark and
 * white knockouts both fall to ~4.4:1 and neither is safe.
 *
 * The binding constraint is not this one, though — it is `positionText` below.
 * See the `--ds-pink` block in globals.css.
 *
 * `node scripts/hex-to-oklch.mjs` prints the white-vs-dark comparison for all
 * five; run it if any position hue changes.
 */
export const POSITION_CHIP_SOLID: Record<string, string> = {
  QB: "bg-pos-qb text-background",
  RB: "bg-pos-rb text-background",
  WR: "bg-pos-wr text-background",
  TE: "bg-pos-te text-background",
  DST: "bg-pos-dst text-background",
  DEF: "bg-pos-dst text-background",
};

export function positionChipSolid(pos: string | null | undefined): string {
  return POSITION_CHIP_SOLID[pos ?? ""] ?? "bg-muted text-muted-foreground";
}

/** Solid bar/dot colors (literal classes so Tailwind generates them). */
export const POSITION_BAR: Record<string, string> = {
  QB: "bg-pos-qb",
  RB: "bg-pos-rb",
  WR: "bg-pos-wr",
  TE: "bg-pos-te",
  DST: "bg-pos-dst",
  DEF: "bg-pos-dst",
};

export function positionBar(pos: string | null | undefined): string {
  return POSITION_BAR[pos ?? ""] ?? "bg-muted-foreground/40";
}

/**
 * Draft-board cell treatment: an opaque fill in the position's hue, outlined in
 * the solid hue, so a column reads positionally from across a room. Keeper and
 * traded state are marks layered on top of this, not competing fills.
 *
 * The fills are `--cell-*`, pre-mixed over the board's deep base in
 * `globals.css`, rather than the hue at `/[0.13]` over a panel grey. Translucent
 * tints sampled whatever was behind them, so the same position rendered
 * differently depending on where the cell fell relative to the canvas washes —
 * and the panel grey they sat on made empty cells brighter than filled ones.
 * Board contrast is now one number in the token sheet. See BRANDING.md.
 */
export const POSITION_CELL: Record<string, string> = {
  QB: "bg-cell-qb border-pos-qb",
  RB: "bg-cell-rb border-pos-rb",
  WR: "bg-cell-wr border-pos-wr",
  TE: "bg-cell-te border-pos-te",
  DST: "bg-cell-dst border-pos-dst",
  DEF: "bg-cell-dst border-pos-dst",
};

export function positionCell(pos: string | null | undefined): string {
  return POSITION_CELL[pos ?? ""] ?? "bg-board-base border-border";
}

/**
 * An empty board slot: the board's own base, so un-drafted rounds recede and the
 * position fills advance. The hairline is at full strength because on a
 * near-black field it is the only thing drawing the grid.
 */
export const EMPTY_CELL = "bg-board-base border-border";

/**
 * Text-only hue, for the position label inside a tinted cell.
 *
 * This is the constraint that caps how saturated the position palette can go,
 * which is worth knowing before anyone tries to deepen it further. The label is
 * the hue drawn on an 18% tint OF THAT SAME HUE, so the ratio is set by the
 * hue's own luminance — a genuinely dark position colour cannot label its own
 * cell. The floor here is 4.54:1 (QB, RB and DST all sit near it) and the chip
 * knockout above still has 5.5:1, so this gives out first.
 *
 * Lowering `--cell-*` from 18% does NOT buy headroom: it moves the ratio by
 * under 0.2, because darkening the tint darkens the thing it is compared with.
 * The only real lever is the hue's lightness.
 */
export const POSITION_TEXT: Record<string, string> = {
  QB: "text-pos-qb",
  RB: "text-pos-rb",
  WR: "text-pos-wr",
  TE: "text-pos-te",
  DST: "text-pos-dst",
  DEF: "text-pos-dst",
};

export function positionText(pos: string | null | undefined): string {
  return POSITION_TEXT[pos ?? ""] ?? "text-muted-foreground";
}

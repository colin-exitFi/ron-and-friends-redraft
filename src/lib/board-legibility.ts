/**
 * How big the draft board's type has to be for the room it is actually in.
 *
 * ============================================================================
 * THE ROOM — AND IT IS A ROOM, NOT A CINEMA
 * ============================================================================
 * "We're not drafting on a golf simulator. We're drafting on a 65-inch TV… Just
 * a regular 4K TV is what we're going to be on, not a 1080p fucking 100-inch
 * screen. It's not a 16- or 18-foot screen. It's a 65-inch television at eye
 * level for everybody."
 *
 * So: a 65 in diagonal 16:9 panel — 56.65 in wide, 31.9 in tall — at eye level,
 * with the room between about 8 ft and 12 ft from it.
 *
 *   56.65 in wide / 1920 px  =  33.9 px per inch
 *
 * That number is the whole reason this file exists. Every legibility question
 * about this board — is a bye week readable, is a name readable, how many rounds
 * can we afford — is a question about inches of glass, and the only bridge from
 * CSS pixels to inches is that ratio. Change `SCREEN_WIDTH_IN` and everything
 * below follows; the answers for the panel sizes this might turn out to be are
 * in `LEGIBILITY_TABLE`, so a re-measurement is a one-line change.
 *
 * ============================================================================
 * WHAT THE CORRECTION COST, BECAUSE IT WAS NOT A ROUNDING ERROR
 * ============================================================================
 * This file used to describe a 192 in wide screen — a 220 in DIAGONAL — read
 * from 18 ft. It is tempting to think a 65 in panel up close comes out about
 * the same, and for the commissioner's own "100-inch" comparison it nearly
 * would: 65 in at 10 ft subtends 30°, a 100 in at 18 ft subtends 26°. But the
 * screen the numbers below were derived against was 220 in, and that subtends
 * 54°. The board is therefore angularly about HALF what the old model claimed:
 *
 *   name at 16.13px, old model, 18 ft from a 220 in screen   18.0 arcmin
 *   name at 16.13px, 65 in panel at 1920 CSS px, from 10 ft   9.5 arcmin
 *   …from 12 ft                                               8.0 arcmin
 *
 * AND THE BOARD CANNOT SIMPLY GROW ITS WAY OUT OF THAT, which is the fact worth
 * having written down before someone spends an evening on it. Ten columns
 * across 56.65 in gives each one about 4.1 in of name line at 1920 CSS px, and
 * the longest surname in the top 200 fills it at 17.8px. Reaching 16 arcmin
 * from 12 ft would take 32px. The constraint is the width of a tenth of a
 * 65-inch television, not the type scale — so the levers that remain are the
 * density control, closing the roster pane, and where people sit.
 *
 * ============================================================================
 * THE CSS PIXEL IS THE ASSUMPTION THAT MATTERS MOST, AND IT IS NOT THE PANEL'S
 * ============================================================================
 * `SCREEN_WIDTH_PX` is how many CSS pixels the BROWSER lays the board out
 * across, which on a 4K panel is a display-settings question rather than a
 * hardware one. Screen mirroring and AirPlay hand over 1920; macOS's default
 * scaled mode for a 4K TV does too; a machine plugged in at native 1:1 hands
 * over 3840 and every length in this file is then worth half as many inches.
 * At 3840 the name lands near 4 arcmin from 12 ft, which is at the limit of
 * what an eye resolves at all. The board fits either way — that is asserted —
 * but it is only READABLE at 1920, so 1920 is what this file assumes and what
 * the television should be driven at.
 *
 * ============================================================================
 * WHY ARCMINUTES AND NOT A RULE OF THUMB
 * ============================================================================
 * The signage rule ("cap height ≥ distance / 150") is a proxy for the thing the
 * eye actually resolves, which is ANGLE. Angular size collapses the screen's
 * size and the viewer's distance into one number that can be compared across
 * setups — including against the laptop this board is developed on:
 *
 *   arcmin = (cap_height_inches / distance_inches) × 3438
 *
 * ~5 arcmin is the bare threshold for high-contrast text. 16–22 arcmin is
 * comfortable for sustained reading. So 16 is the floor this board holds itself
 * to for the player's name, and anything above it is spent on rounds instead of
 * on type — which is the commissioner's ruling: "treat ~16 arcmin as the floor
 * you must not cross and spend anything above it on rounds."
 *
 * Metadata gets a lower floor, deliberately. A bye week is reference detail read
 * by somebody leaning in, not the thing being read from the back of the room.
 *
 * ============================================================================
 * FONT SIZE IS NOT CAP HEIGHT
 * ============================================================================
 * A 20px font does not draw a 20px capital. Cap height runs about 0.70 of the em
 * for a humanist sans, and conflating the two overstates legibility by ~40% —
 * which is large enough here to be the difference between "clears the floor" and
 * "does not". `CAP_RATIO` is the assumption, and
 * `scripts/verify-board-fit.mjs` MEASURES the real ratio of the font in use and
 * fails if it is lower than this, so the assumption cannot rot quietly.
 */

/** The panel, by the number written on the box. */
export const SCREEN_DIAGONAL_IN = 65;
/** …and across, which is what the board is laid out over. 16:9 of the above. */
export const SCREEN_WIDTH_IN = 56.65;
/** CSS pixels across that panel. See the note above: this is a display
    setting, not a hardware fact, and 3840 halves every inch below. */
export const SCREEN_WIDTH_PX = 1920;

/** The seats. The far one sets the floor; the near one only says "not absurd". */
export const FURTHEST_VIEWER_IN = 144;
export const CLOSEST_VIEWER_IN = 96;

/** Cap height as a fraction of font size. Asserted against the real font. */
export const CAP_RATIO = 0.7;

/**
 * Comfortable for sustained reading. IT IS A TARGET NOW RATHER THAN A FLOOR,
 * and the difference is the television: a tenth of a 65 in panel cannot hold a
 * name big enough to reach it from the back of a living room, whatever this
 * file says it wants. So nothing refuses to render below it. What it drives is
 * the readout — `legibilityNote` turns it into the distance inside which the
 * board IS comfortable, which is a number the room can pace out.
 */
export const NAME_FLOOR_ARCMIN = 16;
/** Reference detail: read by whoever is leaning in, not from the back wall. */
export const META_FLOOR_ARCMIN = 12;
/**
 * WHERE A LETTER STOPS BEING A LETTER. 20/20 vision resolves about 5 arcmin, so
 * below this the mark on the screen is not small, it is absent. This is the one
 * angular number that is still a hard floor and that `verify-board-fit.mjs`
 * still refuses to pass: a comfort target the panel cannot reach is a target,
 * but type the room physically cannot resolve is a broken board.
 */
export const RESOLVABLE_ARCMIN = 5;

export const PX_PER_INCH = SCREEN_WIDTH_PX / SCREEN_WIDTH_IN;

/** What a font size subtends from a given seat, in arcminutes of cap height. */
export function arcminutes(
  fontPx: number,
  distanceIn = FURTHEST_VIEWER_IN,
  pxPerInch = PX_PER_INCH,
): number {
  return ((fontPx * CAP_RATIO) / pxPerInch / distanceIn) * 3438;
}

/** The smallest font size that still clears a floor from a given seat. */
export function fontForArcminutes(
  arcmin: number,
  distanceIn = FURTHEST_VIEWER_IN,
  pxPerInch = PX_PER_INCH,
): number {
  return (arcmin * pxPerInch * distanceIn) / 3438 / CAP_RATIO;
}

/**
 * The same answers for the panels this might turn out to be, because "65-inch"
 * came off the back of a television rather than out of a tape measure, and
 * because the next thing that happens to a league that likes its draft board is
 * somebody buying a bigger screen.
 *
 * A BIGGER PANEL AT THE SAME CSS WIDTH IS STRICTLY BETTER HERE, which is the
 * opposite of what this table used to say. On a projector, widening the screen
 * at a fixed 1080p spread the same pixels over more wall and the type had to
 * grow in pixels to hold its angle. A television is not thrown, so the pixels
 * simply get physically larger and the same 16.13px name gains arcminutes for
 * free: 75 in buys about 15% over 65 in from the same seat.
 *
 * `nameFloorPx` is what it would take to reach the comfort target from the
 * furthest seat. On a 65 in panel it prints a number about twice the widest
 * type a column can hold, which is the point — it is the size of the gap.
 */
export const LEGIBILITY_TABLE = [55, 65, 75, 85].map((diagonalIn) => {
  const widthIn = (diagonalIn * 16) / Math.hypot(16, 9);
  const pxPerInch = SCREEN_WIDTH_PX / widthIn;
  return {
    diagonalIn,
    widthIn: Math.round(widthIn * 10) / 10,
    pxPerInch: Math.round(pxPerInch * 100) / 100,
    nameFloorPx: Math.round(fontForArcminutes(NAME_FLOOR_ARCMIN, FURTHEST_VIEWER_IN, pxPerInch) * 10) / 10,
    metaFloorPx: Math.round(fontForArcminutes(META_FLOOR_ARCMIN, FURTHEST_VIEWER_IN, pxPerInch) * 10) / 10,
  };
});

/**
 * THE SAFE AREA'S RANGE, in whole percentages of the window's height.
 *
 * Nobody knows what fraction of that screen is usable until it is on and ten
 * people are sitting down, so the edges are keyboard-adjustable in the room —
 * ⌘⇧↑/⌘⇧↓ for the bottom, ⌘⌥↑/⌘⌥↓ for the top, ⌘⌥0 to put both back.
 * Percentages rather than fractions because that is what the overlay prints and
 * what `localStorage` holds, and rounding a fraction for display twice is how
 * "94%" starts reading as "93%".
 *
 * 2 a step is 21.6px at 1080p, about a third of a row: fine enough to land on
 * the sightline, coarse enough that four presses are visibly four presses.
 *
 * THE FLOOR ON THE BAND IS WHERE USEFULNESS ENDS, not where the arithmetic
 * does. 40vh of band at 1080p is 432px, which holds seven rounds at the pitch
 * the board runs at now — the active round and six ahead of it. Tighter than
 * that and the board stops answering "who's up next", which is the question it
 * exists for. It held 5.8 before the ownership strip's reserved line came out
 * of every cell, which is the same floor buying more of the draft.
 */
export const SAFE_TOP_DEFAULT = 0;
export const SAFE_TOP_MIN = 0;
export const SAFE_TOP_MAX = 25;
/**
 * 94, DOWN FROM 72, BECAUSE THE BOTTOM OF A TELEVISION IS NOT THE FLOOR.
 *
 * 72 was the right answer to a question this league turns out not to be
 * asking. It described a floor-to-ceiling projection whose bottom edge was at
 * ground level and below every sightline at a bar-height table: the last
 * quarter of that image was not a place a round could be put. A 65 in
 * television at eye level has no such region. Every pixel of it is readable by
 * everyone in the room, and reserving 28% of it gave away four rounds of board
 * to a hazard that does not exist.
 *
 * WHAT 94 BUYS, MEASURED AT 1920x1080 RATHER THAN CHOSEN: all fifteen rounds
 * inside the band in Scroll, at the board's full 16.13px type, with nothing to
 * scroll and nothing snapping about as picks land — which is the commissioner's
 * actual requirement, "see the whole board the entire time". The board needs
 * about 90% to do that; 94 is the first even step with real margin, and the
 * margin is doing a second job.
 *
 * THAT SECOND JOB IS OVERSCAN. He is casting rather than plugging in, and a
 * television handed a mirrored signal will often crop a few percent off every
 * edge before it draws anything. 6% at the bottom is about 65px at 1080p — more
 * than any overscan this side of a plasma — so the last round survives a TV
 * that quietly zooms. 100 would fit too and would leave nothing in hand.
 *
 * THE TOP EDGE STAYS AT 0. Overscan crops it as well, but what sits there is
 * the header bar rather than a round, and the bar already carries its own
 * margin. Spending vertical space to protect chrome is what this change is
 * undoing.
 */
export const SAFE_BOTTOM_DEFAULT = 94;
export const SAFE_BOTTOM_MIN = 50;
export const SAFE_BOTTOM_MAX = 100;
export const SAFE_BAND_MIN = 40;
export const SAFE_AREA_STEP = 2;
export const SAFE_AREA_KEY = "ukl.tv-safe-area.v1";
/** Scroll or Fit. See `use-board-fit.ts`. */
export const BOARD_FIT_KEY = "ukl.board.fit.v1";

/**
 * FIT MODE'S TYPE, AS A SHARE OF THE ROUND IT SITS IN.
 *
 * Fit divides the safe band into equal rounds and then asks each cell to size
 * itself to whatever height that turned out to be — the technique
 * `final-board.tsx` uses, where the grid decides how tall a round is and the
 * cell follows, rather than a size being chosen and the board hoping it fits.
 *
 * So the type is written in `cqh` against the round's own height and carries NO
 * `rem` floor. A floor is exactly what cannot follow a row down, and it is what
 * put an ellipsis through nine names on the final board before that surface
 * gave floors up.
 *
 * THESE NUMBERS ARE A BUDGET AND IT ADDS UP TO 100. A round holds, in cqh:
 *
 *   2 × 1.6      the cell's padding, top and bottom
 *   2 × 0.8      the gaps between the slots
 *   2.3 × name   two reserved name lines at 1.15 each
 *  1.15 × pos    the position row
 *  1.15 × meta   the club-and-bye row
 *  1.053 × meta  the ownership strip — ONLY where one is drawn
 *
 * SO THERE ARE TWO BUDGETS, because there are two cells. A league that trades
 * picks reserves the strip in all of them and the last term is real; a redraft
 * cannot trade a pick, draws no strip, and gets that term back to spend on
 * type. See `boardShowsOwnership` in `draft-surface.tsx` for which is which.
 *
 * `withOwnership` is the arrangement as it shipped and is left exactly at it —
 * it is what a 2027 keeper vote restores, and a budget that had been retuned
 * against a board with no strip in it would overflow the band on the day the
 * flag went back. `plain` spends the released 12.6cqh where the commissioner
 * asked for it: the name first, then the position and the club. At 1080p with
 * fifteen rounds inside the default band that is a 10.6px name rather than a
 * 7.5px one.
 *
 * BOTH LEAVE ABOUT 6cqh IN HAND, and that is not decoration. A surname wrapping
 * to a third line costs 2.3cqh of it, and in Fit the board is `overflow-hidden`
 * — a budget spent to the last unit is a round pushing the next one out of the
 * band rather than a round that looks slightly tight.
 */
export const FIT_TYPE_CQH = {
  /** No ownership strip: the line it would have taken is the name's. */
  plain: { name: 25, pos: 16, meta: 12.5 },
  /** The strip is drawn in every cell, so it is charged for in every cell. */
  withOwnership: { name: 17.5, pos: 15, meta: 12 },
} as const;

export type SafeArea = { top: number; bottom: number };

/**
 * Both edges into range, then the band between them into range.
 *
 * The band is enforced by moving whichever edge was NOT just asked for, so a
 * key held down against the limit stops rather than dragging the other edge
 * along with it — the operator pressed one arrow and expects one line to move.
 */
export function clampSafeArea(
  value: Partial<SafeArea>,
  moved: keyof SafeArea = "bottom",
): SafeArea {
  const bound = (n: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
  let top = bound(value.top ?? SAFE_TOP_DEFAULT, SAFE_TOP_MIN, SAFE_TOP_MAX, SAFE_TOP_DEFAULT);
  let bottom = bound(
    value.bottom ?? SAFE_BOTTOM_DEFAULT,
    SAFE_BOTTOM_MIN,
    SAFE_BOTTOM_MAX,
    SAFE_BOTTOM_DEFAULT,
  );
  if (bottom - top < SAFE_BAND_MIN) {
    if (moved === "bottom") {
      top = Math.max(SAFE_TOP_MIN, bottom - SAFE_BAND_MIN);
      bottom = Math.max(bottom, top + SAFE_BAND_MIN);
    } else {
      bottom = Math.min(SAFE_BOTTOM_MAX, top + SAFE_BAND_MIN);
      top = Math.min(top, bottom - SAFE_BAND_MIN);
    }
  }
  return { top, bottom };
}

/**
 * THE BOTTOM OF THE SCREEN THAT CAN ACTUALLY BE READ, as a fraction of its
 * height.
 *
 * WHAT THIS WAS FOR, AND WHY IT IS NOW ALMOST THE WHOLE SCREEN. The projector
 * this board was first built against was floor-to-ceiling: 9 ft of image whose
 * bottom edge was at ground level, read from a bar-height table. The last foot
 * or two was below every sightline in the room, so it was not a place a round
 * could be put — and scrolling did not rescue it, because at maximum scroll the
 * last round came to rest against the bottom of the scroll box, which IS the
 * floor. "Scrolling to the bottom round 16 will still sit on the ground."
 *
 * The draft is on a 65 in television at eye level, and none of that is true of
 * one. So the reserved region is now 6% rather than 28%, and what it protects
 * is a cast signal being overscanned rather than a round being on the carpet.
 * See `SAFE_BOTTOM_DEFAULT`. The MECHANISM is unchanged and deliberately so —
 * the board still carries trailing space below its last round and maximum
 * scroll still lifts that round clear of the reserved strip, which is what
 * keeps the projector a supported display rather than a deleted one. Anyone
 * putting this back on a big throw sets the bottom edge back to 72 with ⌘⇧↑ and
 * gets the old board exactly.
 *
 * ONE SEAM, DELIBERATELY. The keyboard-adjustable safe area — ⌘⇧↑ and ⌘⇧↓,
 * which is why the density control does not use those chords — sets
 * `--ukl-safe-bottom` and nothing else: the trailing space is derived from that
 * property in CSS, so the control moves the board without `draft-surface.tsx`
 * learning that it exists. This constant is now that control's DEFAULT, kept
 * here so `scripts/verify-board-fit.mjs` asserts against the same number the
 * board actually starts at.
 *
 * TV MODE ONLY. In a browser window the bottom edge of the viewport is at desk
 * height and perfectly readable, and empty space under the board would read as
 * a bug rather than as a decision.
 */
export const SAFE_AREA_BOTTOM = SAFE_BOTTOM_DEFAULT / 100;

/**
 * THE BOARD'S GOVERNING TYPE SIZE, IN `rem` — WHICH IS WHAT MAKES ⌘+ / ⌘− WORK.
 *
 * "cmnd +/- to zoom and the fonts get bigger which we used to have but you took
 * out." They did have it, and it regressed when the board moved to `vw`: browser
 * zoom shrinks the CSS pixel and hands the viewport proportionally more of them,
 * so a `vw`-sized cell lands at exactly the same physical size and the board
 * does not move a hair. Only `rem` and `px` lengths respond. Saying zoom could
 * never work here was wrong — it was only true of the layout as written.
 *
 * So the term that GOVERNS is `rem` now. 1.008rem is 16.13px, which is what
 * `0.84vw` resolved to on the 1080p signal, so the board the room is calibrated
 * against is unchanged to the hundredth of a pixel at 100% zoom.
 *
 * THE `vw` TERM SURVIVES AS A CEILING, and it is load-bearing rather than
 * decorative: a column is about a tenth of the screen, and "Croskey-Merritt"
 * stops fitting one at about 0.925vw — measured against the real top-200 by
 * `verify-board-fit.mjs`, not guessed. 0.88 keeps ~5% in hand. Applied to the
 * FINAL size rather than to the base, so it also caps what the density control
 * can ask for; without that, density 1.25 asks for 20.2px on a line that holds
 * 17.8 and the board clips a name, which is the one thing it must never do.
 *
 * The consequence, and it is worth being plain about it: zooming OUT works all
 * the way — the type shrinks, more rounds fit, which is the direction actually
 * asked for, and `verify-tv-follow.mjs` measures 80% at 12.9 device pixels and
 * nine rounds against 16.13 and seven. Zooming IN grows the type until the
 * ceiling binds, and that is 4.8% at 1080p rather than the 10% claimed here
 * first: 0.88/0.84 is the whole distance between the base and the cap, and the
 * harness measures the same +4.8%. Past it a column genuinely cannot hold the
 * longest surname whole, and this board does not clip names. Worth knowing in
 * the room: ⌘− is the lever with travel in it, ⌘+ is spent on one press.
 */
export const NAME_BASE_REM = 1.008;
export const META_BASE_REM = 0.696;
export const POS_BASE_REM = 0.864;
/** What a column can hold, as a share of the screen. Measured, not chosen. */
export const NAME_WIDTH_CEILING_VW = 0.88;

export const DENSITY_STEP = 0.05;
/*
 * 0.4, WIDENED FROM 0.9, AND DELIBERATELY BELOW THE ARCMINUTE FLOOR.
 *
 * 0.9 was derived rather than chosen — it is the last step at which the name
 * still clears 16 arcminutes from the eighteen-foot seat. Sound arithmetic, and
 * it assumes the model is right about that room. "The font size is something we
 * just won't really know for sure until it's up on the screen, and he's right,
 * so we kind of need to check all the boxes… really he's right we don't know
 * until we're in the room."
 *
 * A range that cannot reach the answer is worse than a model that is slightly
 * wrong, and he has stated which end he wants headroom at: "I prefer to see as
 * much of the board as possible." So the floor is the step that reaches ALL
 * SIXTEEN ROUNDS inside the default band in Scroll mode, measured at 1080p
 * rather than predicted: 0.5 shows fourteen, and 0.45 is where round 16's
 * bottom edge lands on the band's to the hundredth of a pixel.
 *
 * THOSE SIXTEEN ROUNDS ARE THE LEAGUE THIS WAS DERIVED AGAINST, NOT THIS ONE.
 * Ron and Friends drafts 15, so the floor has a round of headroom it did not
 * have when it was chosen. The derivation is kept as-is because it is the
 * tighter case: a control proven to reach 16 rounds reaches 15.
 *
 * 0.4 is one step
 * past that, because a range whose last step is the answer reads as a control
 * that ran out rather than one that arrived — and the two steps of slack are
 * what absorb a franchise name wrapping to a second line and taking the header
 * with it.
 *
 * Below 0.4 buys nothing and is not offered: the rounds stretch to fill the
 * band once they fit it, so further steps shrink the type without showing
 * another round.
 *
 * THE DEFAULT DOES NOT MOVE. Anyone who touches nothing still gets the board
 * that clears the floor — 16.1px, 18.0′ against a 16′ floor. It is the
 * reachable range that widens, and going below the floor is him choosing in the
 * room with his own eyes, which beats a calculation. The readout says what he
 * is trading while he does it: 0.4 is 6.5px and 7.2′.
 */
export const DENSITY_MIN = 0.4;
export const DENSITY_MAX = 1.25;
export const DENSITY_DEFAULT = 1;
export const DENSITY_KEY = "ukl.board.density";

export function clampDensity(value: number): number {
  if (!Number.isFinite(value)) return DENSITY_DEFAULT;
  const stepped = Math.round(value / DENSITY_STEP) * DENSITY_STEP;
  return Math.min(DENSITY_MAX, Math.max(DENSITY_MIN, Math.round(stepped * 100) / 100));
}

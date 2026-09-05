/**
 * How a player's name is printed in a grid cell.
 *
 * TWO ANSWERS LIVE HERE. `splitBoardName` below is the draft board's: the name
 * takes two lines, forename over surname, and nothing is shortened. `boardName`
 * is the one-line answer, still used by the roster wall and the finished board,
 * where a name shares a row with a lineup slot rather than owning a cell.
 *
 * ---------------------------------------------------------------------------
 *
 * THE RULE `boardName` EXISTS TO KEEP: every cell on the board is the same
 * height, and the position, club, bye and ownership strip sit at the same offset
 * in all 160 of them. That only works if a name occupies exactly one line,
 * always.
 *
 * A wrapped name needs about 59px of cell once the top line and an ownership
 * strip are accounted for, and sixteen rounds of 59px does not fit a 1080p
 * projector — it needs 57px. So wrapping and uniformity are mutually exclusive,
 * and something has to give. The commissioner named the way out himself, twice:
 * "if we need to go down to first initial, last name, that's totally fine — we
 * know who all these players are."
 *
 * SO ONLY THE LONG ONES SHORTEN. "Josh Allen" and "Brock Bowers" are untouched,
 * because most names already fit and abbreviating them would cost legibility
 * for nothing. This is not the old `boardName()` that rendered every name as
 * "J. Gibbs"; that was rejected, correctly, for shortening names that had room.
 *
 * The threshold is in characters because CSS cannot report a text width back to
 * the render. 15 is the budget of the narrowest column this board is asked to
 * survive — 93px at a 1280px window, at the 10.88px floor of the name type —
 * and "J. Smith-Njigba" is exactly 15. The full name is always in the cell's
 * tooltip, so nothing is actually lost.
 *
 * DEFENCES ARE NOT PEOPLE, which this got wrong once and is worth spelling out.
 * The initial rule assumes the first word is a forename, so applied to a club it
 * produced "S. Francisco 49ers", "N. England Patriots" and "W. Commanders" —
 * the city initialised as though San Francisco were a man called San. A club is
 * identified by its NICKNAME, so that is what prints: "49ers", "Patriots",
 * "Commanders". Shorter than the abbreviation it replaces, and it is also how
 * ESPN itself lists them.
 */
const MAX_CHARS = 15;

export function boardName(full: string, position?: string): string {
  /*
   * The nickname is the last word for every club in the league, including the
   * two-word cities ("Los Angeles Rams" → "Rams"). Done before the length test
   * rather than after, because "Chicago Bears" is under the threshold and would
   * otherwise print a city the board has no use for.
   */
  if (position === "DST") return full.trim().split(/\s+/).pop() ?? full;

  if (full.length <= MAX_CHARS) return full;
  const parts = full.split(" ");
  // A mononym has no initial to fall back to. Better long than mangled.
  if (parts.length < 2) return full;
  const [first, ...rest] = parts;
  return `${first[0]}. ${rest.join(" ")}`;
}

/** The two lines a draft-board cell prints a name on. */
export type NameLines = { first: string; last: string };

/**
 * A name, split over the two lines every board cell reserves for it.
 *
 * WHY THE SPLIT IS EXPLICIT AND NOT LEFT TO WORD WRAP. The commissioner read the
 * board and saw the room in it: "looks like there's room to do first name top
 * line, last name line under it." Word wrap would land on the same break for
 * most names and a different one for the rest, so which line a surname is on
 * would depend on the column's width — and a board is read down a column.
 *
 * IT IS ALSO WHERE THE BIGGER TYPE COMES FROM. A single line has to hold
 * "Jaxon Smith-Njigba", eighteen characters. Split, the widest thing any line
 * holds is "Smith-Njigba", twelve — and the type can be sized against the
 * longest TOKEN rather than the longest name. `scripts/verify-board-fit.mjs`
 * measures both against the real top-200 ADP list and fails if either stops
 * fitting.
 *
 * THE SUFFIX GOES WITH THE SURNAME. "Travis Etienne Jr." is "Travis" over
 * "Etienne Jr.", never a third line for the "Jr." — a suffix is part of how the
 * man is named, not a fact about him.
 *
 * A CLUB IS SPLIT WHERE A CLUB IS SPLIT: city over nickname, "New England" over
 * "Patriots". The old one-line rule dropped the city, which was the right call
 * when there was one line and is the wrong one now that there are two — the
 * ruling is that a cell shows everything it holds.
 *
 * A MONONYM TAKES THE FIRST LINE and leaves the second empty. The alternative —
 * pushing it down to the surname line — would be the only cell on the board
 * whose name does not start at the top, and top alignment is the thing this
 * layout is for.
 */
export function splitBoardName(full: string, position?: string): NameLines {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { first: parts[0] ?? "", last: "" };
  if (position === "DST") {
    const nickname = parts[parts.length - 1];
    return { first: parts.slice(0, -1).join(" "), last: nickname };
  }
  const [first, ...rest] = parts;
  return { first, last: rest.join(" ") };
}

/**
 * ONE DECISION FOR THE WHOLE BOARD, NEVER ONE PER CELL.
 *
 * How the names are laid out — one line or two, and at what size — is settled
 * once for all 160 cells from everything currently on the board. It used to be
 * settled per cell, which fit more names into less space and was wrong:
 * "Still normalizing cell layout and size please." A single cell rendering
 * smaller type than its neighbours is the non-uniform look the whole layout
 * exists to prevent, and on a projector one odd cell is the one you notice.
 *
 * THE ESCALATION, IN ORDER, ALL BOARD-WIDE:
 *
 *   1. One line, at full size. The dense case, and the common one: the board
 *      spends the height it saves on showing more rounds.
 *   2. Two lines, forename over surname, when any name on the board is too long
 *      to hold on one.
 *   3. A smaller size for every cell, when a name is too long even for two —
 *      never below `NAME_MIN_SCALE`, which is where the type would stop clearing
 *      the room's arcminute floor. See `board-legibility.ts`.
 *   4. Never truncate. `break-words` catches anything past step 3, which the
 *      reserved height can hold because a smaller line box is a shorter one.
 *
 * The budgets are in CHARACTERS because CSS cannot report a text width back to
 * the render, and they are calibrated in `scripts/verify-board-fit.mjs`, which
 * measures the real top-200-by-ADP names in the board's own font at the board's
 * own size and fails if either budget stops being true.
 *
 * ONE_LINE_CHARS is the whole name, "Jaxon Smith-Njigba" and its 18 characters.
 * TWO_LINE_CHARS is the longest single token, "Croskey-Merritt" and its 15 — the
 * split is what buys the difference, and it is the reason two lines can hold
 * names one line cannot at the same size.
 */
export const ONE_LINE_CHARS = 13;
export const TWO_LINE_CHARS = 15;
/** As far down as the board may step before the room cannot read it. */
export const NAME_MIN_SCALE = 0.78;

export type BoardNameMode = {
  /** How many lines every cell reserves for a name. */
  lines: 1 | 2;
  /** What every cell multiplies `--ukl-name` by. 1 unless a freak name landed. */
  scale: number;
};

export function boardNameMode(
  names: readonly { name: string; position?: string }[],
): BoardNameMode {
  if (names.length === 0) return { lines: 1, scale: 1 };

  const longestWhole = Math.max(...names.map((n) => n.name.trim().length));
  if (longestWhole <= ONE_LINE_CHARS) return { lines: 1, scale: 1 };

  const longestToken = Math.max(
    ...names.map((n) => {
      const { first, last } = splitBoardName(n.name, n.position);
      return Math.max(first.length, last.length);
    }),
  );
  if (longestToken <= TWO_LINE_CHARS) return { lines: 2, scale: 1 };

  /*
   * Sized so the offending token lands inside the budget rather than by steps: a
   * board carrying one absurd name is uniform at a slightly smaller size, which
   * is what was asked for, and the arithmetic is the same for every cell.
   */
  const scale = Math.max(NAME_MIN_SCALE, TWO_LINE_CHARS / longestToken);
  return { lines: 2, scale: Math.round(scale * 100) / 100 };
}

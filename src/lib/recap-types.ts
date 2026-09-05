/**
 * The recap as it is stored and rendered.
 *
 * Separate from `@/lib/recap-llm` and free of `server-only` for one reason: the
 * page that draws these is a client component with a re-roll button in it, so
 * the types have to cross into the browser bundle. Nothing in this file knows
 * that a model exists — it is the finished article, not the machinery.
 *
 * Versioned, like `DraftStateFile`, because a saved recap outlives the shape
 * that wrote it and a stored document that cannot be recognised should be
 * ignored rather than half-rendered.
 */

/** A page the model read, kept so a claim about a player can be traced. */
export type RecapSource = { title: string; url: string };

export type RecapBlurb = {
  /** Franchise this is about, matching `BoardTeam.id`. */
  teamId: string;
  /** Two to five words for the card. May be empty if the model skipped it. */
  verdict: string;
  blurb: string;
  /** What the model says it used here. `RecapDocument.citations` is the full list. */
  sources: RecapSource[];
};

/**
 * A figure the letter rests on, as the model cited it.
 *
 * `value` is a number and not a string union, because a citation that carries
 * no number cannot be checked against the evidence and a grade whose figures
 * cannot be found is dropped. See `GradeCitation` in `@/lib/recap-grade`.
 */
export type RecapGradeCitation = { label: string; value: number };

export type RecapGrade = {
  /** Franchise this letter is about, matching `BoardTeam.id`. */
  teamId: string;
  /**
   * One of `GRADE_SCALE`. Typed as a plain string so this file — which crosses
   * into the browser bundle — does not have to carry the grading module's
   * runtime with it. Nothing off the scale is ever written: `validateGrades`
   * blocks the whole set before a save.
   */
  letter: string;
  /** One sentence. Why this letter, in this league's terms. */
  reason: string;
  citations: RecapGradeCitation[];
};

/**
 * The letters, and — when there are none — why not.
 *
 * WHY A WITHHOLDING IS RECORDED RATHER THAN JUST OMITTED. A blocking flag from
 * `validateGrades` drops all ten grades at once, because the letters are
 * relative to each other and nine of ten is not a curve. That is the right
 * behaviour and it has one bad property: the page then looks exactly like a
 * page nobody has graded. On draft night, in front of the room, "the model's
 * grades failed their own consistency check" and "nobody pressed the button"
 * are very different facts and the commissioner has to be able to tell them
 * apart without opening a log he does not have.
 *
 * So the refusal is part of the document. `withheld` non-null with `assigned`
 * empty is the failure; `assigned` populated is the success; the whole field
 * absent is the recap nobody graded — which includes every recap written
 * before grades existed, and the one currently live in the database.
 */
export type RecapGrades = {
  /**
   * What the letters are about, as `SUBJECT_LABEL` names it — "Keeper slate
   * grade", "Partial draft grade", "Draft grade".
   *
   * STORED RATHER THAN DERIVED ON READ, for the same reason
   * `keepersOutOfPool` is: the board moves and the letters do not. A keeper
   * slate graded on Saturday morning must still say "keeper slate grade" when
   * the tab is reopened at pick 90, or the card claims a draft that letter
   * never saw.
   */
  subjectLabel: string;
  /** Empty exactly when `withheld` is set. */
  assigned: RecapGrade[];
  withheld: RecapGradesWithheld | null;
};

export type RecapGradesWithheld = {
  /** How many letters came back before the check refused them. */
  returned: number;
  /**
   * One line per blocking flag, in `GradeFlag.message`'s own words — which are
   * written to be printable without reformatting.
   */
  reasons: string[];
};

export const RECAP_VERSION = 1;

export type RecapDocument = {
  version: typeof RECAP_VERSION;
  season: number;
  generatedAt: string;
  provider: string;
  model: string;
  /**
   * The keeper count the blurbs were written against, derived from the board at
   * generation time. Stored rather than recomputed on read: keepers keep
   * arriving, and a blurb that cites nineteen should still be readable next to
   * the number it was actually written from.
   */
  keepersOutOfPool: number;
  /** Picks on the board when this was written, so a stale recap can say so. */
  picksEntered: number;
  /**
   * The board these blurbs were written against, as `boardFingerprint` computes
   * it. OPTIONAL, and it has to stay optional: every recap generated before this
   * field existed is without one, and such a document must still read back and
   * render rather than be rejected as unrecognisable. A missing fingerprint is
   * reported as unknown rather than guessed either way — see `recapStaleness`.
   */
  boardFingerprint?: string;
  blurbs: RecapBlurb[];
  /**
   * The draft grades, when this generation was asked for any.
   *
   * OPTIONAL, AND IT HAS TO STAY OPTIONAL, exactly as `boardFingerprint` is.
   * Every recap written before grading existed has none — including the one
   * sitting in the league database right now — and such a document must read
   * back and render rather than be rejected as unrecognisable. Absent is a
   * normal state and the card draws nothing for it.
   */
  grades?: RecapGrades;
  /** Every page the model read across the run, deduplicated. */
  citations: RecapSource[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    webSearches: number;
    costUsd: number;
  };
};

function isSource(value: unknown): value is RecapSource {
  const s = value as RecapSource;
  return !!s && typeof s.title === "string" && typeof s.url === "string";
}

function isBlurb(value: unknown): value is RecapBlurb {
  const b = value as RecapBlurb;
  return (
    !!b &&
    typeof b.teamId === "string" &&
    typeof b.blurb === "string" &&
    typeof b.verdict === "string" &&
    Array.isArray(b.sources) &&
    b.sources.every(isSource)
  );
}

function isGrade(value: unknown): value is RecapGrade {
  const g = value as RecapGrade;
  return (
    !!g &&
    typeof g.teamId === "string" &&
    typeof g.letter === "string" &&
    typeof g.reason === "string" &&
    Array.isArray(g.citations) &&
    g.citations.every(
      (c) => !!c && typeof c.label === "string" && typeof c.value === "number",
    )
  );
}

function isGrades(value: unknown): value is RecapGrades {
  const g = value as RecapGrades;
  if (!g || typeof g !== "object") return false;
  if (typeof g.subjectLabel !== "string") return false;
  if (!Array.isArray(g.assigned) || !g.assigned.every(isGrade)) return false;
  if (g.withheld == null) return true;
  return (
    typeof g.withheld.returned === "number" &&
    Array.isArray(g.withheld.reasons) &&
    g.withheld.reasons.every((r) => typeof r === "string")
  );
}

/**
 * Whether a parsed value is a recap this build can render.
 *
 * Deliberately strict about the pieces the page indexes by and loose about the
 * rest: a document missing `usage` is a curiosity, a document whose `blurbs`
 * are not blurbs is a crash.
 */
export function isRecapDocument(value: unknown): value is RecapDocument {
  const doc = value as RecapDocument;
  // Same rule as `boardFingerprint` below, and for the same reason: absent is
  // every recap written before grades existed, and present-but-wrong would
  // reach the card as a letter nobody can read.
  if (doc?.grades != null && !isGrades(doc.grades)) return false;
  // Absent is the normal case for anything written before the staleness check
  // existed, exactly as `restorable` is on `DraftStateFile`. Present-but-wrong
  // is not: a fingerprint that is not a string would be compared against one
  // that is and would report every recap stale forever.
  if (doc?.boardFingerprint != null && typeof doc.boardFingerprint !== "string") {
    return false;
  }
  return (
    !!doc &&
    typeof doc === "object" &&
    doc.version === RECAP_VERSION &&
    typeof doc.season === "number" &&
    typeof doc.generatedAt === "string" &&
    Array.isArray(doc.blurbs) &&
    doc.blurbs.every(isBlurb)
  );
}

/**
 * Whether a stored recap still describes the board sitting next to it.
 *
 * THE PROBLEM THIS EXISTS FOR. The blurbs persist; the dossier printed beneath
 * them is recomputed from the live board on every load. Generate once before the
 * draft to show the room the button works, finish the draft, and the tab then
 * shows prose about a half-empty board flush against receipts describing the
 * finished one, with nothing saying which is which.
 *
 * TWO SIGNALS, AND THE PICK COUNT IS THE ONE THAT FIRES. `boardFingerprint`
 * covers which slots exist and who owns them and DELIBERATELY not what has been
 * picked into them (see `boardFingerprint` in `@/lib/draft-engine`), so it does
 * not move as the room drafts — on its own it would miss the entire case above.
 * The count catches "written at 12 of 160, read at 160". The fingerprint catches
 * the rarer and worse case of ownership moving underneath a recap, which a pick
 * count cannot see because a trade changes no totals.
 *
 * `unknown` is a real answer, not a hedge. A recap from before this field
 * existed whose pick count still matches may or may not have been written
 * against this board, and saying so is honest where claiming either would not
 * be.
 */
export type RecapStaleness =
  | { kind: "fresh"; picksThen: number; picksNow: number }
  | { kind: "unknown"; picksThen: number; picksNow: number }
  | { kind: "stale"; picksThen: number; picksNow: number; boardMoved: boolean };

export function recapStaleness(
  recap: RecapDocument | null,
  board: { picksEntered: number; boardFingerprint: string },
): RecapStaleness | null {
  if (!recap) return null;

  const picksThen = recap.picksEntered;
  const picksNow = board.picksEntered;
  const stored = recap.boardFingerprint;
  const boardMoved = stored != null && stored !== board.boardFingerprint;

  if (picksThen !== picksNow) return { kind: "stale", picksThen, picksNow, boardMoved };
  if (boardMoved) return { kind: "stale", picksThen, picksNow, boardMoved: true };
  if (stored == null) return { kind: "unknown", picksThen, picksNow };
  return { kind: "fresh", picksThen, picksNow };
}

/** The blurb for one franchise, or null when the recap predates it. */
export function blurbFor(
  recap: RecapDocument | null,
  teamId: string,
): RecapBlurb | null {
  return recap?.blurbs.find((b) => b.teamId === teamId) ?? null;
}

/**
 * The letter for one franchise, or null.
 *
 * NULL IS THE ORDINARY ANSWER AND THE CARD MUST DRAW NOTHING FOR IT. A recap
 * from before grading has none; a recap whose grades the validator refused has
 * none either, and in that case none of the ten has one. A placeholder, a dash
 * or a skeleton in this slot would read as a franchise that scored badly, which
 * is a claim nobody made.
 */
export function gradeFor(
  recap: RecapDocument | null,
  teamId: string,
): RecapGrade | null {
  return recap?.grades?.assigned.find((g) => g.teamId === teamId) ?? null;
}

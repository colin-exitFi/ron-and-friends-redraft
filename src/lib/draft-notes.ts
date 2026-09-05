/**
 * The scribe's record of the draft room, joined onto the board.
 *
 * Scott Johnston keeps the notes every year — sits at the table with his
 * workbook open and writes down what people say while they say it. The app
 * records what was drafted and nothing at all about the two hours around it, so
 * his `SCJ COMMENTS` column is the only surviving account of the night. This
 * module turns it into something renderable.
 *
 * ============================================================================
 * THE BOARD SUPPLIES THE FACTS; THE SHEET SUPPLIES THE TALKING
 * ============================================================================
 *
 * The join is by OVERALL PICK NUMBER and it carries one field across: what was
 * said. Player, position, franchise and round all come from the board, which is
 * reconciled against the commissioner's workbook and the traded-pick ledger.
 * That split is not fussiness — his sheet spells ten players wrong ("Deeboo
 * Samuel", "Xaiver Worthy", "Hunter [Fucking] Henrey"), which is exactly the
 * right priority for a man transcribing a room, and importing those names would
 * put a second, wrong spelling of ten players into the app. See
 * `scripts/import-draft-notes.py` for what else is deliberately left behind.
 *
 * Verified at import: all 141 of his rows that name a live pick join, and the 19
 * that do not are precisely the 19 keepers — slots nobody drafted into and
 * therefore nobody spoke over.
 *
 * ============================================================================
 * PARSING IS DONE HERE AND NOT IN THE IMPORTER, ON PURPOSE
 * ============================================================================
 *
 * `data/draft-notes-2026.json` holds his text verbatim, so it can be read beside
 * the spreadsheet and checked by eye. Everything below is derived from it at
 * render time, which means the parser can be exercised over all sixty-three real
 * lines by `verify:draft:notes` rather than over whatever the importer happened
 * to emit the last time somebody ran it.
 *
 * NOTHING HERE INVENTS AN ATTRIBUTION. A quote whose speaker is not a name the
 * league recognises comes back with `speaker: null` and its text preserved, and
 * the page prints it unattributed. Guessing would put words in a named man's
 * mouth on a page the whole league reads, which is the one failure this file
 * cannot recover from — and Scott left seven quotes unattributed, so the case is
 * real rather than defensive.
 */

import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { CURRENT_SEASON } from "@/lib/league-config";
import type { DraftRoomView } from "@/lib/draft-types";

/** One pick's worth of commentary, as imported. Text is verbatim. */
export type StoredNote = {
  overallPick: number;
  round: number | null;
  /** The scribe's own spelling, for the join audit. Never rendered. */
  sheetPlayer: string | null;
  said: string;
};

export type DraftNotesFile = {
  season: number;
  scribe: { shortName: string; fullName: string };
  source: string;
  notes: StoredNote[];
};

/**
 * A parsed fragment of one cell.
 *
 * `quote` is somebody talking. `action` is everything else Scott wrote — the
 * bracketed stage directions ("[SHOT]", "[Waitress flips off the group]") and
 * the occasional line of unquoted narration. Kept as a separate kind rather than
 * folded into a quote because they are not speech and should not be set as
 * though they were.
 */
export type ScribeSegment =
  | {
      kind: "quote";
      said: string;
      /** Canonical short name, or null when Scott named nobody. */
      speaker: string | null;
      /**
       * Whatever followed the speaker — "to Zach", "after the pick", "back to
       * Joe". Verbatim, because the alternative is parsing intent out of it.
       */
      aside: string | null;
    }
  | { kind: "action"; text: string };

/** A pick that was spoken over, with the board's facts and the room's words. */
export type NotedPick = {
  overallPick: number;
  round: number;
  /** "4.06" — what the room calls the pick. */
  label: string;
  /** Franchise that made it, by the handle the league uses. */
  team: string;
  franchiseName: string;
  manager: string;
  playerName: string;
  position: string;
  nflTeam: string | null;
  /** True where the slot was filled by a keeper rather than drafted into. */
  isKeeper: boolean;
  /** Original owner's handle where the pick was acquired, else null. */
  acquiredFrom: string | null;
  segments: ScribeSegment[];
  /** Scott's text, unparsed, for anything that would rather have it whole. */
  said: string;
};

/** How many lines each person is on the record for. */
export type SpeakerTally = {
  speaker: string;
  quotes: number;
  /** True for somebody who is not a manager — the waitress, a passing stranger. */
  guest: boolean;
};

export type DraftNotes = {
  season: number;
  scribe: { shortName: string; fullName: string };
  source: string;
  /** In board order. */
  picks: NotedPick[];
  /** Commented picks the board has no slot for. Should be empty; shown if not. */
  unmatched: StoredNote[];
  /** Loudest first. Ties broken by name so the order is total. */
  talkers: SpeakerTally[];
  /** Quotes Scott attributed to nobody. Counted so the page can be honest. */
  unattributed: number;
};

/**
 * People in the room who are not in `managers.json`.
 *
 * The waitress carries four of the best lines of the night and a manager from
 * another league at the bar carries one, so dropping them would lose real
 * material. Listed explicitly rather than inferred: the rule is "a name the
 * league recognises", and inferring speakers from capitalisation is how a stray
 * word becomes a person who said something.
 *
 * "GG" is deliberately absent. It appears once, as the person Stefan was talking
 * TO, and it is probably Greg — but "probably" is not good enough to print, so it
 * survives verbatim inside an `aside` instead.
 */
const GUEST_SPEAKERS = ["Waitress", "TopShooters manager"] as const;

/** Trailing and leading punctuation a spreadsheet cell picks up. */
const EDGE_NOISE = /^[\s;,.\u2026\u2013\u2014-]+|[\s;,\u2026\u2013\u2014-]+$/g;

function notesPath(season: number): string {
  return path.join(process.cwd(), "data", `draft-notes-${season}.json`);
}

function isNotesFile(value: unknown): value is DraftNotesFile {
  if (!value || typeof value !== "object") return false;
  const file = value as Partial<DraftNotesFile>;
  return (
    typeof file.season === "number" &&
    typeof file.source === "string" &&
    !!file.scribe &&
    typeof file.scribe.shortName === "string" &&
    Array.isArray(file.notes) &&
    file.notes.every(
      (n) => typeof n?.overallPick === "number" && typeof n?.said === "string",
    )
  );
}

/**
 * The imported notes, or null when nobody has imported any.
 *
 * Absent is a normal state — the file only exists for seasons Scott has sent a
 * workbook for — so this returns null rather than throwing, exactly as
 * `readProjections` does for the same reason.
 */
export function readStoredNotes(season: number = CURRENT_SEASON): DraftNotesFile | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(notesPath(season), "utf8"));
    return isNotesFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Splits one cell into quotes, speakers and stage directions.
 *
 * Quote marks are PAIRED IN ORDER — first with second, third with fourth — which
 * works because the importer refuses a cell with an odd number of them. Text
 * between one quote's close and the next one's open is the attribution for the
 * quote that just ended, and a `[bracketed]` run anywhere outside a quote is a
 * stage direction. Brackets INSIDE a quote stay in it: Josh really did say "Do
 * you think [Dolly Parton] is actually dead?", and that is Scott clarifying who
 * was meant rather than describing the room.
 */
export function parseScribeLine(
  said: string,
  known: ReadonlySet<string>,
  canonical: ReadonlyMap<string, string>,
): ScribeSegment[] {
  const marks: number[] = [];
  for (let i = 0; i < said.length; i++) if (said[i] === '"') marks.push(i);
  // An odd count would mean pairing the wrong marks together, which silently
  // turns the next speaker's line into an attribution. Refuse the whole cell.
  const pairs = marks.length % 2 === 0 ? marks.length / 2 : 0;

  const segments: ScribeSegment[] = [];
  let cursor = 0;

  for (let p = 0; p < pairs; p++) {
    const open = marks[p * 2];
    const close = marks[p * 2 + 1];

    // Anything before this quote belongs to the PREVIOUS one, as its
    // attribution, or is narration when there is no previous one.
    const gap = said.slice(cursor, open);
    const previous = segments[segments.length - 1];
    if (previous?.kind === "quote") {
      attribute(previous, gap, segments, known, canonical);
    } else {
      pushAction(segments, gap);
    }

    const text = said.slice(open + 1, close).trim();
    if (text) segments.push({ kind: "quote", said: text, speaker: null, aside: null });
    cursor = close + 1;
  }

  const tail = said.slice(cursor);
  const last = segments[segments.length - 1];
  if (last?.kind === "quote") {
    attribute(last, tail, segments, known, canonical);
  } else {
    pushAction(segments, tail);
  }

  return segments;
}

/**
 * Reads an attribution onto the quote it follows.
 *
 * Bracketed runs are lifted out as their own stage directions first — "[SHOT]"
 * after a name is a thing that happened, not part of the name. What is left has
 * its leading known name taken as the speaker and everything after it kept as an
 * `aside`. No known name means no speaker: the text becomes a stage direction so
 * nothing is lost, and no quote is ever credited to a guess.
 */
function attribute(
  quote: Extract<ScribeSegment, { kind: "quote" }>,
  gap: string,
  segments: ScribeSegment[],
  known: ReadonlySet<string>,
  canonical: ReadonlyMap<string, string>,
): void {
  const actions: string[] = [];
  const plain = gap
    .replace(/\[([^\]]*)\]/g, (_, inner: string) => {
      const trimmed = inner.trim();
      if (trimmed) actions.push(trimmed);
      return " ";
    })
    .replace(EDGE_NOISE, "")
    .trim();

  if (plain) {
    const match = leadingSpeaker(plain, known, canonical);
    if (match && !quote.speaker) {
      quote.speaker = match.speaker;
      quote.aside = match.rest || null;
    } else {
      actions.unshift(plain);
    }
  }

  for (const text of actions) segments.push({ kind: "action", text });
}

/**
 * The longest known name at the front of an attribution, and what follows it.
 *
 * Longest wins so "TopShooters manager" is not read as an unknown word after a
 * name. Case-insensitive because the scribe was typing fast in a bar — "JOe" and
 * "waitress" both appear — and the canonical spelling is substituted back, which
 * is the one normalisation this file does to his text.
 */
function leadingSpeaker(
  text: string,
  known: ReadonlySet<string>,
  canonical: ReadonlyMap<string, string>,
): { speaker: string; rest: string } | null {
  let best: { speaker: string; rest: string } | null = null;

  for (const name of known) {
    if (text.length < name.length) continue;
    if (text.slice(0, name.length).toLowerCase() !== name.toLowerCase()) continue;
    // Must end on a word boundary, or "Joe" would match the front of "Joel".
    const next = text[name.length];
    if (next !== undefined && /[A-Za-z]/.test(next)) continue;
    if (best && best.speaker.length >= name.length) continue;
    best = {
      speaker: canonical.get(name.toLowerCase()) ?? name,
      rest: text.slice(name.length).replace(EDGE_NOISE, "").trim(),
    };
  }

  return best;
}

function pushAction(segments: ScribeSegment[], raw: string): void {
  const inner: string[] = [];
  const plain = raw
    .replace(/\[([^\]]*)\]/g, (_, text: string) => {
      const trimmed = text.trim();
      if (trimmed) inner.push(trimmed);
      return " ";
    })
    .replace(EDGE_NOISE, "")
    .trim();

  if (plain) segments.push({ kind: "action", text: plain });
  for (const text of inner) segments.push({ kind: "action", text });
}

/**
 * Joins the imported notes onto a board.
 *
 * Returns null when there are no notes for the season, which the page renders as
 * a sentence rather than an empty table.
 */
export function buildDraftNotes(
  view: DraftRoomView,
  stored: DraftNotesFile | null = readStoredNotes(view.season),
): DraftNotes | null {
  if (!stored) return null;

  /*
   * The ten handles come off the BOARD rather than out of `managers.json`. Same
   * ten names either way, but the board is what every other fact on this page is
   * read from, and a speaker list that could disagree with the franchise column
   * beside it is a second source waiting to drift.
   */
  const known = new Set<string>([
    ...view.teams.map((t) => t.name),
    ...GUEST_SPEAKERS,
  ]);
  const canonical = new Map<string, string>(
    [...known].map((name) => [name.toLowerCase(), name]),
  );
  const guests = new Set<string>(GUEST_SPEAKERS);

  const slotByPick = new Map(view.slots.map((s) => [s.overallPick, s]));

  const picks: NotedPick[] = [];
  const unmatched: StoredNote[] = [];
  const tally = new Map<string, number>();
  let unattributed = 0;

  for (const note of [...stored.notes].sort((a, b) => a.overallPick - b.overallPick)) {
    const slot = slotByPick.get(note.overallPick);
    if (!slot?.player) {
      unmatched.push(note);
      continue;
    }

    const segments = parseScribeLine(note.said, known, canonical);
    for (const segment of segments) {
      if (segment.kind !== "quote") continue;
      if (segment.speaker) tally.set(segment.speaker, (tally.get(segment.speaker) ?? 0) + 1);
      else unattributed++;
    }

    picks.push({
      overallPick: slot.overallPick,
      round: slot.round,
      label: slot.label,
      team: slot.currentOwner.name,
      franchiseName: slot.currentOwner.franchiseName,
      manager: slot.currentOwner.manager,
      playerName: slot.player.name,
      position: slot.player.position,
      nflTeam: slot.player.nflTeam,
      isKeeper: slot.isKeeper,
      acquiredFrom: slot.traded ? slot.originalOwner.name : null,
      segments,
      said: note.said,
    });
  }

  const talkers = [...tally.entries()]
    .map(([speaker, quotes]) => ({ speaker, quotes, guest: guests.has(speaker) }))
    .sort((a, b) => b.quotes - a.quotes || a.speaker.localeCompare(b.speaker));

  return {
    season: stored.season,
    scribe: stored.scribe,
    source: stored.source,
    picks,
    unmatched,
    talkers,
    unattributed,
  };
}

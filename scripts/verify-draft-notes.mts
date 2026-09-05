/**
 * The scribe's notes, joined to the live board and parsed line by line.
 *
 *   npm run verify:draft:notes
 *
 * Two things are being proved, and the first one is the one that would ruin the
 * page quietly.
 *
 * THE JOIN. Every commented pick has to land on the slot Scott meant. The notes
 * key on overall pick number, so a single inserted row in his workbook would
 * shift sixty-three quotes one pick to the left and attach every one of them to
 * the wrong player and the wrong franchise — a page that looks entirely fine and
 * is wrong about all of it. `sheetPlayer` is carried through the import for
 * exactly this check: his spelling against the board's, per pick, with the ten
 * known transcription differences allowed and anything else a failure.
 *
 * THE PARSE. Sixty-three cells of freehand transcription written in a bar. The
 * checks below run the real ones — not fixtures — because the failure modes are
 * all in the specific mess of the real text: a missing closing quote, a name
 * typed "JOe", a stage direction sitting between two speakers, brackets inside a
 * quote that are a clarification rather than an action.
 *
 * NOTHING HERE ASSERTS ON THE JOKES. What is checked is that each quote reaches
 * the page attached to the right pick, credited to somebody the league can name
 * or to nobody at all, with its text unaltered.
 */

import { readRoom } from "@/lib/draft-service";
import {
  buildDraftNotes,
  parseScribeLine,
  readStoredNotes,
  type NotedPick,
} from "@/lib/draft-notes";

let failures = 0;

function section(title: string): void {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
}

/**
 * Where Scott's spelling and the board's differ, with the board being right.
 *
 * Every one is a transcription artefact and none is a different player. Listed
 * rather than fuzzy-matched so that a genuine misalignment — a quote landing on
 * a different man entirely — cannot hide behind a similarity threshold.
 */
const KNOWN_SPELLINGS = new Map<number, string>([
  [44, "Terry McLaurin"], //  "Terry McCLaurin"
  [120, "Deebo Samuel"], //   "Deeboo Samuel"
  [123, "Hunter Henry"], //   "Hunter [Fucking] Henrey"
  [125, "Xavier Worthy"], //  "Xaiver Worthy"
  [133, "Tyler Allgeier"], // "Tyler Algeier"
]);

/**
 * Names compared the way a human would: case, punctuation and suffixes aside.
 *
 * The `Jr`/`II` and `DEF`/`DST` suffixes are dropped rather than corrected. Both
 * are the sheet being systematically more verbose than the board — "Brian Thomas
 * Jr", "Seattle Seahawks DEF" — and nine of the sixty-three rows differ only in
 * that way. Listing them as transcription errors would bury the five real ones
 * in bookkeeping and imply Scott got nine names wrong when he got them right.
 */
function looseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|def|dst|d\/st)\b/g, "")
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const stored = readStoredNotes();
if (!stored) {
  console.error(
    "\nNo notes have been imported. Run:\n" +
      "  python3 scripts/import-draft-notes.py <workbook.xlsx>\n",
  );
  process.exit(1);
}

const view = await readRoom();
const notes = buildDraftNotes(view, stored);
if (!notes) {
  console.error("\nThe notes did not build against the live board.\n");
  process.exit(1);
}

console.log(
  `\nScott's notes for ${notes.season}, from ${notes.source}: ` +
    `${stored.notes.length} commented picks over a ${view.filled}-slot board.`,
);

section("1. Every note lands on the pick the scribe meant");

check(
  "no commented pick is left unmatched",
  notes.unmatched.length === 0,
  notes.unmatched.map((n) => `#${n.overallPick}`).join(", "),
);
check(
  "every stored note reached the page",
  notes.picks.length === stored.notes.length,
  `${notes.picks.length} of ${stored.notes.length}`,
);

/*
 * The join audit. This is the check that would catch a shifted workbook, and it
 * is the reason the importer carries a field it never renders.
 */
const byPick = new Map<number, NotedPick>(notes.picks.map((p) => [p.overallPick, p]));
const mismatched: string[] = [];
for (const note of stored.notes) {
  const pick = byPick.get(note.overallPick);
  if (!pick || !note.sheetPlayer) continue;
  const expected = KNOWN_SPELLINGS.get(note.overallPick) ?? note.sheetPlayer;
  if (looseName(expected) !== looseName(pick.playerName)) {
    mismatched.push(`#${note.overallPick} sheet "${note.sheetPlayer}" vs board "${pick.playerName}"`);
  }
}
check(
  "the scribe's player agrees with the board on every commented pick",
  mismatched.length === 0,
  mismatched.slice(0, 3).join(" | "),
);

/*
 * The corrections table has to stay honest. If a re-cut sheet fixes a spelling,
 * the entry for it is now dead and should go — otherwise the table slowly
 * becomes a licence for any name at those picks.
 */
const stale = [...KNOWN_SPELLINGS.keys()].filter((pick) => {
  const note = stored.notes.find((n) => n.overallPick === pick);
  const board = byPick.get(pick);
  if (!note?.sheetPlayer || !board) return true;
  return looseName(note.sheetPlayer) === looseName(board.playerName);
});
check(
  "…and no allowed spelling difference has quietly gone away",
  stale.length === 0,
  stale.length ? `picks ${stale.join(", ")} no longer differ` : "",
);

check(
  "every commented pick names a franchise off the board",
  notes.picks.every((p) => p.team && p.manager && p.franchiseName),
);
check(
  "…and a position, so the page can colour it",
  notes.picks.every((p) => !!p.position),
);

section("2. The parse, over the real sixty-three lines");

const allSegments = notes.picks.flatMap((p) => p.segments);
const quotes = allSegments.filter((s) => s.kind === "quote");
const actions = allSegments.filter((s) => s.kind === "action");

check("every line produced at least one segment", notes.picks.every((p) => p.segments.length > 0));
check(
  "the room is quoted rather than summarised",
  quotes.length >= 100,
  `${quotes.length} quotes, ${actions.length} stage directions`,
);
check(
  "no quote came through empty",
  quotes.every((q) => q.kind === "quote" && q.said.trim().length > 0),
);
check(
  "no stage direction came through empty",
  actions.every((a) => a.kind === "action" && a.text.trim().length > 0),
);

/*
 * NO QUOTE MARKS SURVIVE INSIDE A QUOTE. An odd number of marks in a cell means
 * the pairing is off by one, and the tell is a stray `"` in the parsed text —
 * which is why the importer refuses such a cell and why this looks for the
 * symptom independently.
 */
check(
  "no parsed quote still contains a quote mark",
  quotes.every((q) => q.kind === "quote" && !q.said.includes('"')),
  quotes.find((q) => q.kind === "quote" && q.said.includes('"'))?.kind === "quote"
    ? "pairing is off by one somewhere"
    : "",
);

/* Attribution: only names the league can put a face to, and never a guess. */
const speakers = new Set(
  quotes.flatMap((q) => (q.kind === "quote" && q.speaker ? [q.speaker] : [])),
);
const boardNames = new Set(view.teams.map((t) => t.name));
const guests = [...speakers].filter((s) => !boardNames.has(s));
check(
  "every attributed quote names a manager or a known guest",
  guests.every((g) => g === "Waitress" || g === "TopShooters manager"),
  guests.join(", "),
);
check(
  "the tally covers every attributed quote and nothing else",
  notes.talkers.reduce((sum, t) => sum + t.quotes, 0) + notes.unattributed === quotes.length,
  `${notes.talkers.reduce((sum, t) => sum + t.quotes, 0)} tallied + ${notes.unattributed} unattributed vs ${quotes.length}`,
);
check(
  "unattributed quotes are reported rather than assigned to somebody",
  notes.unattributed > 0,
  "Scott left several quotes unnamed; silently crediting them is the failure",
);

/*
 * The specific messes, named. Each of these is a real cell that a naive parser
 * gets wrong in a different way, so they are asserted individually rather than
 * as a count.
 */
section("3. The lines that break a naive parser");

function pick(overall: number): NotedPick {
  const found = byPick.get(overall);
  if (!found) throw new Error(`No noted pick ${overall} — the fixture has moved.`);
  return found;
}

/* "JOe" — typed fast, and the canonical spelling is what should print. */
const joeTypo = pick(105).segments.filter((s) => s.kind === "quote");
check(
  "a name typed in haste is normalised to the league's spelling",
  joeTypo.some((s) => s.kind === "quote" && s.speaker === "Joe"),
  joeTypo.map((s) => (s.kind === "quote" ? s.speaker : "")).join(","),
);
check(
  "…and that line keeps all five of its speakers",
  joeTypo.length === 5,
  `${joeTypo.length} quotes parsed`,
);

/* A cell with no quotes at all: pure stage direction. */
const staged = pick(121).segments;
check(
  "a cell that is only a stage direction parses as one",
  staged.length === 1 && staged[0].kind === "action",
);
check(
  "…with its brackets stripped and its text intact",
  staged[0].kind === "action" && /finished his beer/.test(staged[0].text),
);

/* Brackets INSIDE a quote are Scott clarifying, not the room doing something. */
const dolly = pick(92).segments.find((s) => s.kind === "quote");
check(
  "brackets inside a quote stay inside it",
  dolly?.kind === "quote" && dolly.said.includes("[Dolly Parton]"),
  dolly?.kind === "quote" ? dolly.said : "",
);

/* A stage direction sitting between two speakers must not eat the attribution. */
const shot = pick(133).segments;
const shotQuotes = shot.filter((s) => s.kind === "quote");
check(
  "a stage direction between speakers keeps both of them",
  shotQuotes.filter((s) => s.kind === "quote" && s.speaker !== null).length >= 6,
  `${shotQuotes.filter((s) => s.kind === "quote" && s.speaker).length} attributed of ${shotQuotes.length}`,
);
check(
  "…and the [SHOT] survives as its own note",
  shot.some((s) => s.kind === "action" && /^SHOT$/i.test(s.text)),
  shot.filter((s) => s.kind === "action").map((s) => (s.kind === "action" ? s.text : "")).join(" | "),
);

/* "Stefan to Zach" — the recipient is kept verbatim, never parsed into a field. */
const toZach = pick(75).segments.find((s) => s.kind === "quote");
check(
  "who a line was aimed at is kept beside the speaker",
  toZach?.kind === "quote" && toZach.speaker === "Stefan" && toZach.aside === "to Zach",
  toZach?.kind === "quote" ? `${toZach.speaker} / ${toZach.aside}` : "",
);

/* The cell the importer had to correct, which now has to parse cleanly. */
const waitress = pick(118).segments.filter((s) => s.kind === "quote");
check(
  "the repaired cell gives the waitress her line and Colin his",
  waitress.some((s) => s.kind === "quote" && s.speaker === "Waitress") &&
    waitress.some((s) => s.kind === "quote" && s.speaker === "Colin"),
  waitress.map((s) => (s.kind === "quote" ? s.speaker : "")).join(","),
);
check(
  "…and Colin's is the one about having built the app",
  waitress.some(
    (s) => s.kind === "quote" && s.speaker === "Colin" && /BUILT THIS APP/.test(s.said),
  ),
);

/* An unattributed quote stays unattributed. */
const cmc = pick(5).segments.find((s) => s.kind === "quote");
check(
  "a quote the scribe left unnamed is printed without a name",
  cmc?.kind === "quote" && cmc.speaker === null && /didn't want CMC/.test(cmc.said),
  cmc?.kind === "quote" ? `${cmc.speaker}` : "",
);

section("4. The parser refuses to guess");

/*
 * Fed a cell it cannot pair, the parser must produce NOTHING rather than a
 * plausible-looking mis-pairing. This is the guarantee that lets the importer's
 * refusal be the only place a malformed cell is handled.
 */
const known = new Set(view.teams.map((t) => t.name));
const canonical = new Map([...known].map((n) => [n.toLowerCase(), n]));
const odd = parseScribeLine('"He said" Kyle "and then', known, canonical);
check(
  "an unpairable cell yields no quotes at all",
  odd.every((s) => s.kind !== "quote"),
  odd.map((s) => s.kind).join(","),
);

const stranger = parseScribeLine('"Who is this" Barry', known, canonical);
check(
  "a name the league does not know is never made a speaker",
  stranger.every((s) => s.kind !== "quote" || s.speaker === null),
);
check(
  "…and their text is kept rather than dropped",
  stranger.some((s) => s.kind === "action" && s.text === "Barry"),
  stranger.map((s) => (s.kind === "action" ? s.text : "")).join(","),
);

const prefix = parseScribeLine('"Nice" Joel', known, canonical);
check(
  "a longer name starting with a known one is not mistaken for it",
  prefix.every((s) => s.kind !== "quote" || s.speaker === null),
  prefix.map((s) => (s.kind === "quote" ? `${s.speaker}` : "")).join(","),
);

section("5. Who actually talked");

const loudest = notes.talkers[0];
console.log(
  `  ${notes.talkers
    .map((t) => `${t.speaker} ${t.quotes}${t.guest ? " (guest)" : ""}`)
    .join(", ")}`,
);
check("somebody is on the record more than anybody else", !!loudest && loudest.quotes > 0);
check(
  "the tally is ordered loudest first",
  notes.talkers.every((t, i) => i === 0 || notes.talkers[i - 1].quotes >= t.quotes),
);

console.log(`\n${failures === 0 ? "All draft-notes checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

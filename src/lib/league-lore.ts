import "server-only";

/**
 * What the recap is allowed to know about these people beyond tonight's board.
 *
 * ============================================================================
 * FOR RON AND FRIENDS 2026 THE ANSWER IS: NOTHING. THAT IS DELIBERATE.
 * ============================================================================
 *
 * This module used to carry the previous league's lore — ten named manager
 * personas, their professions and rivalries, a decade of running jokes, and a
 * multi-page account of a contract two of them signed. All of it was true, all
 * of it was sourced, and NONE of it is about the ten people in this room.
 *
 * A recap is a machine for writing fluent, confident prose. Handed a persona
 * for a man who is not at the table it does not fail, throw, or hedge: it
 * writes an assured paragraph about a stranger and puts it on a television in
 * front of the people who are. That is the worst way this app can fail, because
 * nothing catches it — not a type, not a build, not a test.
 *
 * So the lore is gone rather than replaced. Inventing Ron and Friends lore
 * tonight would be guessing about ten people this codebase knows nothing about,
 * and a wrong inside joke reads worse than no inside joke at all. The
 * commissioner has ruled that building it is a later conversation.
 *
 * ============================================================================
 * WHAT THE RECAP STILL HAS, WHICH IS THE PART THAT WAS ALWAYS DOING THE WORK
 * ============================================================================
 *
 * Everything that happened at this table: who reached and by how much against
 * ADP, who got a value, the runs on a position and who started them, who waited
 * on a quarterback until it hurt, who took a tight end early in a league that
 * pays a tight end premium, who left a starting slot empty. That is all
 * derivable from the board, it is all checkable by anybody in the room, and it
 * is where the sharp lines were coming from anyway. A persona was never what
 * made a verdict land — a number the man cannot argue with was.
 *
 * ============================================================================
 * WHEN THE LEAGUE WANTS LORE BACK
 * ============================================================================
 *
 * The mechanism is intact and this is the only file to change. Populate
 * `MANAGER_PERSONAS`, keyed by the short name in `data/managers.json`, and put
 * recorded facts in `data/league-history.json` with a `source` and a
 * `confidence` against each one. The rules that governed it are worth keeping:
 *
 * 1. IT HAS TO HAVE HAPPENED. A fabricated callback is obvious to the room
 *    instantly and it takes the real ones down with it.
 * 2. NAME THE RIGHT MAN. Match on the short name, never a first name.
 * 3. DRAFT AND FOOTBALL ONLY. A profession can flavour a line; employers,
 *    families, appearance, money and health stay out.
 * 4. SAY WHICH DRAFT IT IS TRUE OF. A one-off written without its year reads as
 *    a standing trait, and the model will build the man an identity out of it.
 *
 * The confidence markers are load-bearing rather than decoration: `verified`
 * and `derived` may be quoted with their numbers, anything else may run the
 * joke but not state a round, a pick or a year for it.
 *
 * Reads from disk, and therefore `server-only`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The manager the savage blurb is aimed at, or null for "whoever earned it".
 *
 * NULL FOR RON AND FRIENDS, AND THAT IS THE CORRECT DEFAULT RATHER THAN A GAP.
 * The previous league's commissioner named a man he wanted the hard blurb
 * pointed at, because he knew the room and knew who would argue back. Nobody
 * has asked for that here, and picking a target out of a list of strangers
 * would be the single most hostile thing this app could do unprompted.
 *
 * With no name the prompt falls back to what it does by default: the savaging
 * goes to whoever had the worst night, judged on the board. Set this to a short
 * name from `data/managers.json` the day a commissioner asks for it.
 */
export const ASSIGNED_SAVAGE: string | null = null;

/**
 * The heading of the aim order, exported so `verify:recap` can prove it reached
 * the rendered prompt. Only present when `ASSIGNED_SAVAGE` names somebody.
 */
export const SAVAGE_ORDER_MARKER = "THE COMMISSIONER HAS ASKED FOR A NAMED TARGET";

/**
 * Persona and register — the things that are not facts about the past.
 *
 * EMPTY ON PURPOSE. See the note at the top of this file: these ten people have
 * not been described to this codebase, and a guess is worse than a blank.
 */
const MANAGER_PERSONAS: Record<string, string> = {};

/**
 * Oral lore: real, recorded nowhere, usable as a reference but never with a
 * number attached. Empty for the same reason as the personas.
 */
const ORAL_ONLY: string[] = [];

type HistoryNote = { fact?: unknown; confidence?: unknown };
type History = {
  managers?: Record<string, { notes?: HistoryNote[] }>;
  unverified?: { item?: unknown; state?: unknown }[];
};

let cached: History | null | undefined;

function history(): History | null {
  if (cached !== undefined) return cached;
  try {
    const file = path.join(process.cwd(), "data", "league-history.json");
    cached = JSON.parse(readFileSync(file, "utf8")) as History;
  } catch {
    // The recap is worth writing without it; the numbers all come from the
    // board regardless. Only the callbacks are lost.
    cached = null;
  }
  return cached;
}

/** Confidence levels whose numbers a blurb is allowed to quote. */
const QUOTABLE = new Set(["verified", "derived"]);

/**
 * Notes withheld because two of the league's own files contradict each other
 * and nobody has ruled. Empty while there is no history to contradict itself.
 */
const WITHHELD_NOTES: { match: RegExp; because: string }[] = [];

function notesFor(shortName: string): { hard: unknown[]; soft: unknown[] } {
  const hard: unknown[] = [];
  const soft: unknown[] = [];
  for (const note of history()?.managers?.[shortName]?.notes ?? []) {
    if (typeof note?.fact !== "string") continue;
    if (WITHHELD_NOTES.some((w) => w.match.test(note.fact as string))) continue;
    (QUOTABLE.has(String(note.confidence)) ? hard : soft).push(note.fact);
  }
  return { hard, soft };
}

/** Which notes are being withheld, so a verifier can prove the filter fires. */
export function withheldNoteCount(): number {
  const all = Object.keys(MANAGER_PERSONAS).flatMap(
    (name) => history()?.managers?.[name]?.notes ?? [],
  );
  return all.filter(
    (n) =>
      typeof n?.fact === "string" &&
      WITHHELD_NOTES.some((w) => w.match.test(n.fact as string)),
  ).length;
}

/**
 * The lore block as the prompt receives it.
 *
 * WITH NO LORE THIS IS NOT AN EMPTY STRING, IT IS AN INSTRUCTION. A section
 * that simply vanishes leaves the model to fill the silence from its own
 * priors, which is exactly the invention this file exists to prevent. So the
 * absence is stated, and stated as a prohibition.
 */
export function loreBlock(): string {
  const known = Object.keys(MANAGER_PERSONAS).length > 0;

  if (!known) {
    return `## Who these people are

**NOTHING IS RECORDED ABOUT THESE TEN MANAGERS, AND YOU MUST NOT INVENT ANY OF IT.**

This is the league's first season under this board. There is no history, no
previous draft, no standings, no running joke and no rivalry on file. You have
never been told what any of these people do for a living, what they are like,
who needles whom, or what happened last year, because none of it has been
written down anywhere you can see.

So:

- Do not give anybody a profession, a personality, a reputation or a nickname.
- Do not reference a previous season, a past draft, an earlier keeper, a trade
  history or "the usual" anything. There is no previous season.
- Do not imply the managers know each other in any particular way beyond being
  in a league together.
- Do not write a callback. There is nothing to call back to.
- If a line needs a fact about a person to work, write a different line.

**Write about the draft, not about the drafters.** Everything you need is in the
board and it is a great deal: the reaches and the values against ADP, the runs
on a position and who set them off, who waited on a quarterback, who paid up
early for a tight end in a league that pays a tight end premium, who has an
empty starting slot, who drafted three of one position. Those are observations
anybody at the table can check, which is what makes them land — and being
checkable is the entire reason they are funnier than an invented character
trait would be.

Refer to a manager by the short name the board uses and nothing more.`;
  }

  const people = Object.entries(MANAGER_PERSONAS)
    .map(([shortName, persona]) => {
      const { hard, soft } = notesFor(shortName);
      const lines = [`**${shortName}** — ${persona}`];
      for (const fact of hard) lines.push(`  - ${fact}`);
      for (const fact of soft) {
        lines.push(`  - (NO NUMBERS — the story is real, the details are not recorded) ${fact}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const unverified = (history()?.unverified ?? [])
    .filter((u) => typeof u?.item === "string")
    .map((u) => `- **${u.item}** — ${u.state ?? "not established"}`)
    .join("\n");

  const sections = [
    `## Who these people are, and what is on the record about them`,
    `Everything under a manager below is sourced and checked, and its numbers are quotable. A line marked NO NUMBERS is a true story whose details were never written down — run the joke, never state a round, a pick or a year for it.`,
    `**A note recording what a manager SAID is verified as to the saying, not as to the claim.** Quote him, attribute it, and do not promote his words into a finding of your own.`,
    people,
  ];

  if (ORAL_ONLY.length) {
    sections.push(
      `## Oral lore — real, and unrecorded`,
      ORAL_ONLY.map((o) => `- ${o}`).join("\n"),
    );
  }

  if (unverified) {
    sections.push(
      `## Things nobody has been able to establish`,
      `Do not resolve any of these in a blurb. If a joke needs one of them to be true, tell a different joke.`,
      unverified,
    );
  }

  return sections.join("\n\n");
}

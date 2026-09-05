import "server-only";

/**
 * Banter fuel: the things this league already finds funny, and the guardrails
 * that stop the model inventing more.
 *
 * ============================================================================
 * `data/league-history.json` IS THE SOURCE OF TRUTH. THIS FILE IS THE FILTER.
 * ============================================================================
 *
 * The league historian's document carries every recorded fact about this league
 * with a source and a confidence marker against each one, and it is nearly a
 * hundred kilobytes. It is not a prompt. This module reads it, keeps what a
 * blurb can actually use, drops the apparatus, and turns the confidence markers
 * into instructions the model has to obey — which is the part that matters,
 * because half of what makes this feature dangerous is a joke told with a
 * number that was never checked.
 *
 * THE CONFIDENCE MARKERS ARE LOAD-BEARING, NOT DECORATION.
 *
 *   verified / derived   quotable with its numbers. Somebody found the sheet.
 *   inferred / unverified  the JOKE may be run; the NUMBERS may not. Elbe's
 *                        "good PPR quarterback" line is the worked example —
 *                        Colin has named the player, the room has
 *                        been ribbing him about it for years, and no sheet
 *                        still shows the pick. Stating a round for it would be
 *                        inventing evidence for a true story, which is the
 *                        most embarrassing possible way to be wrong.
 *
 * So `UNVERIFIED` is rendered INTO the prompt rather than withheld from it.
 * Hiding an unverified item would leave the model free to reconstruct it from
 * nothing; naming it and forbidding the numbers is what actually holds.
 *
 * ============================================================================
 * FOR COLIN — WHERE TO ADD THINGS
 * ============================================================================
 *
 * A new running joke goes in `data/league-history.json` alongside the rest,
 * with a `source` and a `confidence`, and it appears here automatically. The
 * constants below are only the things that are not facts about the past:
 * persona, register, and the fence. Three rules, and they are not style
 * preferences:
 *
 * 1. IT HAS TO HAVE HAPPENED. A fabricated callback is obvious to the room
 *    instantly and it takes the real ones down with it.
 * 2. NAME THE RIGHT MAN. Two Scotts and two Kyles. `Scott` is Scott Johnston,
 *    `Elbe` is Scott Elbe, `Kyle` is Kyle Mertens, `Witte` is Kyle Witte.
 * 3. DRAFT AND FOOTBALL ONLY. A profession can flavour a line; employers,
 *    families, appearance, money and health stay out.
 * 4. SAY WHICH DRAFT IT IS TRUE OF. A one-off written without its year reads as
 *    a standing trait, and the model will build the man an identity out of it.
 *    Witte is the worked example: two recorded drafts attended from abroad, no
 *    statement anywhere that he is normally in the room, and the pre-draft
 *    recap duly filed him as the league's international manager. He is not one.
 *    A circumstance of one night gets the night attached to it.
 *
 * Reads from disk, and therefore `server-only`. It is a prompt input rather
 * than league data, so it does not belong in `@/lib/league-json` with the
 * things the app renders, and the read is cached for the life of the process.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The manager the savage blurb is assigned to.
 *
 * ============================================================================
 * WHY A NAME IS HARDCODED, AND WHY IT IS HARDCODED HERE
 * ============================================================================
 *
 * Kyle Mertens asked for it in as many words — "Make sure to tell it to go
 * extra hard on Stefan" — and he is the commissioner, so the marker below says
 * so. That is the ONE thing on this page Kyle said; everything else recorded on
 * draft day came from Colin, who is at the keyboard and is not the commissioner.
 * The reason the aim is worth taking is not spite. Part 4 of the prompt requires
 * one of the ten blurbs to be genuinely savage and leaves the target to the
 * board, which is the right default and produces a savaging of whoever had the
 * worst night. But the acceptance criterion for this whole feature is a room
 * reacting out loud, and Stefan is the man in this league who will argue back
 * at a verdict card in front of nine people. Aiming the loud blurb at the one
 * guaranteed reaction is worth more to the night than aiming it at the worst
 * arithmetic.
 *
 * COLIN'S FULLER ANSWER ON WHY HIM, recorded here rather than in the
 * prompt because only the first half is the model's business: "Stefan will be
 * the most drunk and outspoken to argue with the AI.. he already texted me that
 * he doesn't trust the recap, or grading cuz these kinds of things always kinda
 * suck." The distrust is a fact about him and reaches the prompt as one. The
 * state he will be in while arguing is why the aim is worth taking and is NOT
 * blurb material — Part 6 keeps the target on the decisions, and a man's board
 * is more than enough. It also sets the accuracy bar for the whole page: the
 * loudest sceptic in the room has pre-registered his verdict, so his blurb and
 * his grade are the two that get litigated line by line.
 *
 * THE NAME LIVES IN EXACTLY ONE PLACE AND `@/lib/recap-prompt` INTERPOLATES
 * IT. Part 4's range list is the countable half — "at least one of the ten is
 * savage, and it is this man" — and the order, the reason and the material are
 * the persona's half, below. Splitting it that way is not tidiness: an order
 * that lives only in this file has already been watched to lose. The Nacua tone
 * rule sat here alone, telling the model whose blurb had room to be harder than
 * the rest of the page, and a shipped generation congratulated Scott anyway.
 * Part 4 grew a whole provenance section to fix it. So Part 4 names the man and
 * points here, and neither half restates the other.
 */
export const ASSIGNED_SAVAGE = "Stefan";

/**
 * The heading of the order, exported so `verify:recap` can prove it is still in
 * the rendered prompt. Same argument as the prompt's own markers: prose gets
 * reworded in a way that quietly deletes an instruction, and a heading survives
 * being moved.
 */
export const SAVAGE_ORDER_MARKER = "THE COMMISSIONER HAS ASKED FOR STEFAN BY NAME";

/**
 * The order itself, kept out of the persona literal only because it is four
 * sentences and the other nine personas are one.
 *
 * THE HALF THAT IS NOT OPTIONAL IS THE SECOND HALF. "Be harder on this man" is
 * the single most dangerous instruction in this prompt, because it asks for
 * more force about one named person and force is what makes a writer reach past
 * its evidence. Stefan is an accountant, he has the board open, and the one
 * blurb written to provoke him is the one blurb that gets audited line by line
 * — so the extra hardness is spent on MORE OF HIS OWN NUMBERS, of which he has
 * plenty, and an unsourced jab hands him the argument in front of the room,
 * which is the opposite of what was asked for.
 */
const STEFAN_ORDER = `${SAVAGE_ORDER_MARKER}: the savage blurb Part 4 assigns is his. HE IS AN ACCOUNTANT AND HE WILL CHECK — source every jab or he wins the argument in front of everybody, which is the opposite of the ask. Nobody else gets softer for this; Scott's blurb is as hard as it was.`;

/** Persona and register — the things that are not facts about the past. */
const MANAGER_PERSONAS: Record<string, string> = {
  Colin:
    'Colin Tracy, "Flurp McDerp". Runs this app; works in sales; the league\'s AI nerd, and he spent his summer building a draft board a phone can read. Standing reciprocal piss-take with Stefan. HE IS A MANAGER LIKE ANY OTHER AND MUST BE ROASTED AS HARD AS ANYONE — going easy on the man who built the tab is the fastest way to make the whole thing look rigged.',
  Stefan: `Stefan Albers, "Mound City Dogs". An accountant, and the loud drunk of the draft room: he argues out loud with this page, yells at people, tells them their team is shit, and it is funny every year. The Colin piss-take runs both ways and $25 of it is in the 2024 sheet. ${STEFAN_ORDER}`,
  Kyle: 'Kyle Mertens, "Tushy Booth Ballers". The league commissioner. An accountant, gets properly blasted, good company.',
  Scott:
    'Scott Johnston, "DHB Sandmen". A lawyer, and the league\'s lead scribe — he takes notes on the banter all night and reads them back to the room, which is a live ritual, present tense. One of the quiet ones, and the quips land.',
  Elbe:
    'Scott Elbe, "A.D.B. Rombusters II". Always Elbe, never Scott, and the room says it "LB". Clean-cut, easy company. Works in sales. He reached for Lamar Jackson and said, at least he\'s a good PPR quarterback — the league\'s favourite dumb sentence, and it is his. The room has been running it at him ever since, twice on the 2024 sheet alone. Nobody needs the scoring explained to them; they know PPR does nothing for a quarterback, and that is why they are laughing. Quote him. Never date it: the year and the round are not recorded.',
  Joe: 'Joe Murray, "Fingers are for painting". Happy-go-lucky stoner energy, liked by everybody, and the funniest line of the night is often the one he says under his breath. His profession is not recorded; do not guess at it.',
  Josh: 'Josh Grainger, "Teddys Trouser Snake". Rough around the edges, a weird one, stoner-adjacent — talks in half-finished sentences about how we have got to be careful with this.',
  Greg: 'Greg Blome, "Jimmy\'s Johnson". Clean-cut, has owned a couple of businesses, entrepreneurial and sharp with it, and a nice guy about all of it.',
  Witte:
    'Kyle Witte — the second KYLE, not a second Scott. Drafting from a lake in Ontario, which is why he is not in the room: a circumstance of this one night, not who he is. He is not the league\'s international manager and does not live abroad.',
  Zach:
    'Zach Rakowski, "Perpetually Impaired". The enigma; nobody knows anything about him and that IS the joke, so lean into how little there is to say rather than inventing something. Nobody knows whether he is turning up to this draft at all, in the room or remotely, and KYLE TOOK HIS KEEPERS FOR HIM. ESPN has his franchise registered to a "Ted Buckman" and the commissioner has ruled they are the same person.',
};

/** Oral lore with no paper behind it. Usable as a reference, never with a stat. */
const ORAL_ONLY: string[] = [
  "Gary Barnidge is this league's byword for hype that evaporates — the room was once convinced he was the greatest waiver pickup in history and the enthusiasm lasted about two weeks. It appears nowhere in the records: no year, no round, no manager. Reference it, never date it.",
  "Nobody in this league is a committed fan of any single NFL team, so jokes about somebody stacking their favourite franchise do not land.",
];

type HistoryNote = { fact?: unknown; confidence?: unknown };
type History = {
  managers?: Record<string, { notes?: HistoryNote[] }>;
  nacuaAgreement?: unknown;
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
 * and nobody has ruled.
 *
 * ============================================================================
 * WITHHELD IS NOT THE SAME AS FALSE, AND THIS IS NOT CENSORSHIP OF A JOKE
 * ============================================================================
 *
 * `data/league-history.json` carries, under Greg and marked `verified`: "Greg
 * currently rosters Lamar Jackson at a round-1 keeper price and cannot keep him
 * either." `data/keeper-eligibility-2026.json` carries the same player at
 * `sourceRow` 65 with `roundToKeep2026: 1` and `eligible2026: true`.
 *
 * Those cannot both be right, and the recap has no business picking. Every
 * other route into this prompt has a rule for an unsettled question — the
 * `unverified` block below, the tenure dispute that stops the app printing
 * Nacua's clock year — and this one had none, so the model was free to assert
 * either reading as a fact about a named manager. That is the precise failure
 * this session has spent its whole budget removing.
 *
 * The commissioner declined to rule, so the recap says nothing either way until
 * somebody does. Matched on a phrase from the note rather than on an index,
 * because notes get reordered and a positional filter would silently start
 * withholding the wrong fact.
 *
 * WORTH KNOWING IF YOU ARE THE ONE WHO SETTLES IT: under the league's own
 * recorded prices a round-1 quarterback keeper is five rounds dearer than
 * anything anybody has ever paid at the position (see `@/lib/positional-norms`),
 * so if Greg WAS eligible, declining it was obvious and there was never a jab
 * available here. Nothing funny is being lost. Delete this entry the day the
 * files agree.
 */
const WITHHELD_NOTES: { match: RegExp; because: string }[] = [
  {
    match: /Lamar Jackson at a round-1 keeper price and cannot keep him/i,
    because:
      "league-history.json says Greg cannot keep him; keeper-eligibility-2026.json " +
      "says he is eligible at a round-1 price. Unresolved, and not the recap's to decide.",
  },
];

function notesFor(shortName: string): { hard: string[]; soft: string[] } {
  const raw = history()?.managers?.[shortName]?.notes ?? [];
  const hard: string[] = [];
  const soft: string[] = [];
  for (const note of raw) {
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
 * The Nacua agreement, which is the league's standing grievance and the one
 * piece of lore that belongs in two specific blurbs rather than wherever it
 * fits.
 *
 * Quoted rather than summarised. "For the avoidance of doubt" appearing in a
 * fantasy football trade is funnier than anything a model would invent, and the
 * clause is the evidence for the joke as well as the joke itself.
 *
 * Two corrections are baked in because both were believed at some point and
 * both are wrong. The round-11 price was NOT manufactured — Nacua was drafted
 * in round 14 of 2023 and ratcheted down by the ordinary league rule, one round
 * a season, with nobody gaming anything. And the clause does not merely reserve
 * a right to revert; it GUARANTEES the cheap price on either branch.
 */
const NACUA = `In November 2025 — week 11, mid-season — Scott (Johnston) and Greg (Blome) executed a DocuSigned formal contract to trade fantasy football players. It has WHEREAS clauses, defined terms, a law-firm document number, a "NOW, THEREFORE, in consideration of the mutual covenants" recital and its own signature page. Scott is a lawyer.

Scott sent Puka Nacua, Derrick Henry and three late picks. Greg sent Kyle Monangai plus his 2026 first and third and a 2027 third. A second "Contingent 2026 Trade" was due the day before this draft, conditional on Nacua being "not projected by a majority of media outlets to miss six (6) weeks or more of the 2026 season due to injury", returning Nacua to Scott and Greg's first-round pick to Greg.

THE CLAUSE, VERBATIM: "In the event of a Nacua Injury, DHB shall have the option prior to the 2026 League Draft to either (i) consummate the Contingent 2026 Trade, or (ii) cancel the Contingent 2026 Trade, with DHB retaining the picks exchanged in the 2025 Trade and JJ retaining Nacua. For the avoidance of doubt, Nacua shall retain his 2026 League Draft 11th round draft Keeper eligibility whether or not the Contingent 2026 Trade is consummated."

DHB is Scott, JJ is Greg. Healthy Nacua and both sides "agree to consummate" — mandatory. Injured Nacua and only Scott elects. Greg holds no option on either branch, and the clause guarantees the cheap keeper price survives both. The protection was FREE — but say free protection, not that Scott paid nothing, because he did send real players and picks.

WHAT THE TRADE ACTUALLY DID, which is better than the price: it revived a dead clock. Nacua's round-11 cost was never manufactured — Scott drafted him in round 14 of 2023 and the ordinary league ratchet took it R14 → R13 → R12 → R11. What the trade changed is eligibility. The 2025 keeper sheet has Nacua under Scott at status "N/A" — finished, unkeepable at any price. The 2026 sheet has the same player under Greg with a live clock again, flagged TRADE. Dead clock, then a live one. That it is alive at all is settled; how many seasons it now runs for is the disputed part, and see the clock-year rule below before you put a number on it. The contract's own recital elides it, describing him as "drafted in the 12th Round of the 2025 League draft" without mentioning that the twelfth round was itself the third rung of the ratchet.

TWO JOKES THE DOCUMENT SUPPLIES ITSELF. Clause 2 defines the deal as the "Continent 2026 Trade" — a typo in a lawyer's own defined term, which he then never uses again. And the "majority of media outlets" test names no outlets, no source and no adjudicator; the only party with a decision to make is the one holding the option.

HOW IT LANDED. Nacua picked up psoas soreness on August 11 in a joint practice and has been doing side work since, with the Rams being cautious, but nobody is projecting six weeks and Week 1 is September 10. So under the contract's own test there is no "Nacua Injury", the contingent leg is mandatory, both sides "agree to consummate", and Scott's one-sided option never had to be exercised at all. He wrote himself a free hedge and did not need it.

THE HOLE IN THE DRAFTING, which is the best lawyer joke here and also the most dangerous one to get wrong. **The clause covers injury and only injury.** Any other reason a player might miss six weeks falls straight through it, and the bespoke six-week carve-out would be worth nothing. The joke is about the gap in the drafting — a lawyer writing a custom risk clause and aiming it at one risk — and it is ONLY about that. Do not speculate about why else a player might miss time, do not predict anything, and do not characterise any off-field matter involving any player. If the line cannot be written strictly about the contract's wording, do not write it: the one-sided option and the revived clock are plenty on their own.

IN GREG'S DEFENCE, and it makes the story better: he bought Nacua and Henry in week 11 for a playoff run and finished second. His permanent return is Derrick Henry, who is keeper-ineligible and goes straight back to the pool.

Nobody approved any of it. No rule permitted or forbade contingent trades and the league was never asked; whether they are legal at all is now an open ballot item. Colin's summary is that the two of them "just kinda went rogue and did their own damn thing". NOTE: Kyle Mertens has never ruled on it either way — no approval, objection or veto exists anywhere. Do not invent one.

HOW THE ROOM FEELS ABOUT IT, WHICH GOVERNS THE TONE OF SCOTT'S BLURB. Everybody resents this deal. There is no record anywhere of the league approving, reviewing, ratifying or vetoing the agreement — the document is signed by two people and nobody else, with no commissioner signature block and no ratification clause. Colin's recorded position is that it was "a one-off that should have gone to a vote before it ever happened", he has described the arrangement as illegitimate, and: "No one ever agreed to it, no one ever approved it."

**SO THE HUNDRED AND THREE SLOTS ARE REAL AND SCOTT IS NOT TO BE CONGRATULATED FOR THEM.** This is the single place on the page where admiration costs the recap its audience, because the biggest number in the whole dossier came out of the transaction the room is sourest about. State the figure plainly and at full size — it is the best-supported number here and shrinking it would be its own kind of dishonesty. Then let the provenance carry the tone rather than the applause. He is not the man who did the best work in this league; he is the man holding value nobody agreed he could have. **His blurb has room to be harder than the rest of the page, not softer**, and the paperwork is the material: a typo in his own defined term, a one-sided option, and a six-week media test with nobody appointed to apply it. Nine men lost that argument and all nine are listening.

**AND DO NOT STATE NACUA'S CLOCK YEAR.** The app refuses to, deliberately, on every surface. He is the only keeper in this league whose remaining keeper seasons are recorded as null, because WHICH trade starts his clock is itself the disputed question and the two readings differ by a full season. Every screen prints "final season disputed" instead of a number. So a blurb that says he is in year one, or has two seasons left, or that this is his final keeper year, contradicts the page it is printed beside — and it also picks a winner in an argument going to a league ballot. Say the dead clock was revived, say nobody has settled where it now runs to, and stop there.

This belongs in BOTH Scott's blurb and Greg's, from opposite ends, and is fair game as a glancing shot elsewhere because everybody resents it. Do not embellish the terms; every clause above is recorded and Scott argues for a living.`;

/** The whole lore block as the prompt receives it. */
export function loreBlock(): string {
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

  return `## Who these people are, and what is on the record about them

Everything under a manager below is sourced and checked, and its numbers are quotable. A line marked NO NUMBERS is a true story whose details were never written down — run the joke, never state a round, a pick or a year for it.

**A note recording what a manager SAID is verified as to the saying, not as to the claim.** Quote him, attribute it, and do not promote his words into a finding of your own.

${people}

## Oral lore — real, and unrecorded

${ORAL_ONLY.map((o) => `- ${o}`).join("\n")}

## Things nobody has been able to establish

Do not resolve any of these in a blurb. If a joke needs one of them to be true, tell a different joke.

${unverified}

## The standing grievance

${NACUA}`;
}

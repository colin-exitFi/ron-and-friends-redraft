import "server-only";

/**
 * What the recap is allowed to know about these people beyond tonight's board.
 *
 * ============================================================================
 * POPULATED, AND EVERY LINE OF IT CAME OUT OF THE COMMISSIONER'S MOUTH
 * ============================================================================
 *
 * This module used to carry the previous league's lore — ten named manager
 * personas, their professions and rivalries, a decade of running jokes, and a
 * multi-page account of a contract two of them signed. All of it was true, all
 * of it was sourced, and NONE of it was about the ten people in this room, so
 * it was deleted rather than adapted and this file sat deliberately empty.
 *
 * What is here now is the replacement, dictated by the commissioner on the
 * afternoon of the 2026 draft: the nicknames, the group's shared vocabulary,
 * and the handful of stories these men actually tell each other. It is his
 * material about his own cousins, in the register he asked for.
 *
 * A recap is a machine for writing fluent, confident prose. Handed a persona
 * for a man who is not at the table it does not fail, throw, or hedge: it
 * writes an assured paragraph about a stranger and puts it on a television in
 * front of the people who are. That is still the worst way this app can fail,
 * because nothing catches it — not a type, not a build, not a test. Which is
 * why the four rules that governed the old file govern this one unchanged:
 *
 * 1. IT HAS TO HAVE HAPPENED. A fabricated callback is obvious to the room
 *    instantly and it takes the real ones down with it. Four of the ten below
 *    have no running joke at all and say so; that is a finding, not a gap.
 * 2. NAME THE RIGHT MAN. Match on the short name in `data/managers.json`, never
 *    a first name. Two of the stories below have a heckler and a puncher in
 *    them and the wrong name on either is a lie about somebody in the room.
 * 3. DRAFT AND FOOTBALL ONLY. A profession can flavour a line; employers,
 *    families, appearance, money and health stay out. The single relationship
 *    recorded below — Dennis is Colin's stepdad — is here only because both men
 *    are sat at this table, and it opens nothing else about anybody's family.
 * 4. NOTHING HERE CARRIES A NUMBER, A YEAR OR A ROUND, AND NOTHING MAY BE GIVEN
 *    ONE. None of it was written down at the time. `loreBlock()` states that to
 *    the model in as many words, because a story told without its year reads as
 *    a standing trait and the model will build the man an identity out of it.
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
 * is where the sharp lines come from. A persona is not what makes a verdict
 * land — a number the man cannot argue with is. The lore below is a box of
 * callbacks for a blurb that has already earned one, and nothing more.
 *
 * ============================================================================
 * `data/league-history.json` IS STILL EMPTY, AND THAT IS STILL CORRECT
 * ============================================================================
 *
 * That file holds RECORDED facts — each with a `source` and a `confidence` —
 * and Ron and Friends has no recorded draft history to put in one. Anything
 * added there renders as an indented note beneath its manager. The confidence
 * markers are load-bearing rather than decoration: `verified` and `derived` may
 * be quoted with their numbers, anything else may run the joke but not state a
 * round, a pick or a year for it.
 *
 * Reads from disk, and therefore `server-only`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { CURRENT_SEASON } from "@/lib/league-config";

/**
 * The manager the savage blurb is aimed at, or null for "whoever earned it".
 *
 * NULL FOR RON AND FRIENDS, AND THAT IS THE CORRECT DEFAULT RATHER THAN A GAP.
 * The previous league's commissioner named a man he wanted the hard blurb
 * pointed at, because he knew the room and knew who would argue back. This
 * commissioner handed over a file full of material and did not name anybody,
 * and the difference matters: a target picked by this codebase rather than by
 * him would be the one cruelty on the page nobody in the room asked for.
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
 * Keyed by the short name in `data/managers.json` and written IN DRAFT-SLOT
 * ORDER, so the rendered block reads down the board the way the room does.
 *
 * FOUR OF THESE TEN SAY "NOTHING ELSE IS RECORDED", AND THEY MEAN IT. Dennis,
 * Steve, Keith and Scott carry no running joke in this league, and the
 * commissioner said so in as many words rather than simply failing to mention
 * one. That is the hardest instruction in the file to obey, because the other
 * six are so richly supplied that the four blanks read as an oversight the
 * model can helpfully fill. It is not an oversight, and filling it is the
 * fabrication this whole module exists to prevent.
 */
const MANAGER_PERSONAS: Record<string, string> = {
  Steve:
    "One of the three old balls, with Keith and Scott — the league's own word " +
    "for its seniors, self-applied and affectionate. NOTHING ELSE ABOUT HIM IS " +
    "RECORDED: no habit, no history, no running joke of his own, and NO " +
    "NICKNAME. His franchise is named Mahomies and that is a TEAM NAME, not a " +
    "name for the man — there is no \"Steve Mahomes\", the league has never " +
    "called him that, and the resemblance is a coincidence of spelling you must " +
    "not build a joke on. He is one of the older men at a table of knucklehead " +
    "cousins, and everything else in his blurb has to come off this board.",

  Dennis:
    "Franchise dennisphinney, and the league calls him Denny Finney. He is " +
    "Colin's stepdad — the one family fact on the record anywhere in this " +
    "file, here because both men are sat at this table, and it opens nothing " +
    "else about anybody's family. An old-school drafter and one of the old " +
    "balls. NO RUNNING JOKE EXISTS ABOUT HIM AND YOU MUST NOT INVENT ONE. His " +
    "material is being the old-school stepdad drafting against nine " +
    "knuckleheads, and the substance of it has to be what he actually did.",

  Chris:
    "Franchise BigboofieBiff, and everybody calls him Biff. THE DEFENDING " +
    "CHAMPION — say it flat and never attach a year, a score, a margin or a " +
    "beaten opponent to it, because none of that is recorded and this board " +
    "has no previous season on it. He is the loudest man in the league right " +
    "now and he is complaining about two things, and both complaints are " +
    "primarily HIS — Ryan is the backing vocal, not the co-author. FIRST: he " +
    "has never done an offline draft in his life. He is a Yahoo app man, " +
    "drafting off his phone from the couch, and a draft held in a room with " +
    "actual people is the new and frightening thing; his specific gripe is " +
    "that he cannot research off his phone. SECOND: he hates the idea of a " +
    "keeper league, and he has made it his entire personality this week. One " +
    "of the four Rainman guys. In Vegas, extremely fucked up, he puked on the " +
    "ground and narrated it as it came — \"Here comes another one. Oh, that's " +
    "a good one.\" — while Tom hollered \"Take a walk, motherfucker\" at him " +
    "from a safe distance. He is going to be honking boobies.",

  Scott:
    "Franchise ScottBrennanstl. Brand new: this is very likely the first " +
    "fantasy football league he has ever been in, and he is one of the old " +
    "balls besides. Beginner's luck is the open question of his night and it " +
    "is the ONLY angle on him — nobody knows whether he knows what he is " +
    "doing, himself included, and the board is the first evidence anybody has. " +
    "Nothing else about him is recorded. Do not give him a history, a habit, a " +
    "nickname or a preference he has not shown tonight.",

  Nick:
    "Franchise LeCapitalG, and the league calls him Nickwis. BOTH OF THIS " +
    "LEAGUE'S NICKNAMES CAME OUT OF HIS MOUTH: as a kid he could not say his " +
    "R's or his L's, so his own name came out Nickwis and Ryan's came out " +
    "Wyan, and the pair of them stuck for good. The impediment is his and " +
    "nobody else's — see the shared lore on the voice, and the restraint note " +
    "attached to it. The youngest man in the room and by a distance its " +
    "biggest obsessive: he is in three leagues and pours an absurd amount of " +
    "time into mock drafts, research and agonising over his squads. One of the " +
    "four Rainman guys. That is the tension every one of his picks sits " +
    "inside — all that preparation, against a board that does whatever it " +
    "likes.",

  Tom:
    "Franchise TopNotchTom, which is also what he is called: Top Notch Tom. " +
    "Likes honking boobies. One of the four Rainman guys. On the University of " +
    "Illinois campus he yelled \"Roast him!\" to egg Ryan into punching a guy. " +
    "In Vegas he was one of the two hollering \"Take a walk, motherfucker\" at " +
    "Chris from a distance while Chris narrated his own vomiting; THE SECOND " +
    "HECKLER IS NOT RECORDED, so Tom is the one you may name and nobody else " +
    "may be put beside him.",

  Colin:
    "Franchise CullenGPT, full name Colin Tracy, and the commissioner. Called " +
    "Cullen. One of the four Rainman guys. The room says \"Fuck off, fuck off, " +
    "Colin\" to him constantly, which is the closest thing this league has to a " +
    "term of endearment. Dennis is his stepdad.",

  Ryan:
    "Franchise ChillyWonka, and he is Wyan, or Ryan Wyan. THE NAME IS NICK'S " +
    "DOING AND NOT HIS OWN: Nick could not say his R's or his L's as a kid and " +
    "said Ryan as Wyan, and it stuck. RYAN HAS NO SPEECH IMPEDIMENT — the W is " +
    "Nick's childhood mouth, Ryan simply kept the name he was given, and any " +
    "line that puts the impediment on Ryan is a false fact about a man sat in " +
    "the room. See the shared lore on the voice and the restraint note with " +
    "it. He once shot a goose with a bow and arrow. He got in " +
    "a fight on the University of Illinois campus — the one Tom yelled \"Roast " +
    "him!\" at. Like Chris he has never done an offline draft — another Yahoo " +
    "app man, out of his element in a room — and he is grumbling along about " +
    "that and about the keeper idea. HE IS THE SECOND VOICE ON BOTH: Chris " +
    "owns those grievances and Ryan is agreeing with him, so do not split them " +
    "evenly. The two of them hate change and new things and are dorks about " +
    "it. HE IS NOT A RAINMAN GUY. That group is Colin, Nick, Chris and Tom, " +
    "and putting Ryan in it is exactly the misattribution this section exists " +
    "to prevent.",

  Keith:
    "Franchise JollyRushers. Brand new: very likely the first fantasy football " +
    "league he has ever been in, and one of the old balls. Beginner's luck is " +
    "the open question and it is the only angle on him. Nothing else about him " +
    "is recorded — no history, no habit, no nickname, no preference he has not " +
    "shown on this board tonight.",

  Dre:
    "Franchise GizzyDillespie, full name Andrew, and he answers to Dre, Drew, " +
    "Android and the Good Doctor. The soft-spoken one at a very loud table. He " +
    "is a developer and an IT guy, which is where Android comes from — the " +
    "trade may flavour a line, his employer may not appear at all.",
};

/**
 * Oral lore: real, recorded nowhere, usable as a reference but never with a
 * number attached.
 *
 * This is the league's SHARED VOCABULARY rather than any one man's material,
 * which is why it is here instead of in a persona: anybody at the table can be
 * on the end of any of it, and filing "boofy" under one manager would quietly
 * make it his. The one exception is the Rainman group, which is named because
 * it is four men and not ten.
 */
const ORAL_ONLY: string[] = [
  "**THE KEEPER ARGUMENT, WHICH IS A PROPOSAL AND NOT THIS SEASON'S FORMAT.** " +
    "Somebody floated the idea of turning this into a keeper league. It was " +
    `not adopted, ${CURRENT_SEASON} is a pure redraft, and NOTHING IN A BLURB ` +
    "MAY IMPLY OTHERWISE — nobody kept anybody, nobody could have. What is " +
    "real is the row about it, and Chris is the one having it. His words, " +
    "recorded: **\"Why the fuck do I want to do a keeper league? I'm keeping " +
    "Puka because he had Puka on his team last year.\"** The joke is that this " +
    "is not what a keeper league is, at all, and he is saying it with total " +
    "confidence. **HE IS VERIFIED AS TO THE SAYING AND NOT AS TO THE CLAIM** — " +
    "quote him, attribute it to him, and do not let one word of it become a " +
    "statement of your own about Puka, about anybody's roster, or about how " +
    "keeping works. And the commissioner's own footnote, which is what stops " +
    "this being a joke at one man's expense: honestly nobody in this league " +
    "understands what a keeper league is.",

  "**THE OFFLINE DRAFT, AND THEY HAVE IT EXACTLY BACKWARDS.** Chris and Ryan " +
    "have never drafted anywhere but Yahoo on their phones — the handy dandy " +
    "app, from the couch — so a draft held in a room with other people is new " +
    "and they are mourning it loudly. What they have not worked out is that " +
    "the app is the one that punishes you: online everybody is on a clock and " +
    "there are no breaks. In the room you can take your time, smoke pot, " +
    "drink beers, honk boobies, dick around and actually have a good time. " +
    "**They are grieving the loss of a timer.** And the second half of it, " +
    "which is better than the first: Colin built this whole app around them " +
    "so that they could do exactly what they are used to doing, so the " +
    "complaint is aimed at the one man who had already solved it. Any of " +
    "those three angles is available — the phone drafters out of their " +
    "element, the clock they escaped without noticing, or the commissioner " +
    "who pre-emptively fixed a grievance they insisted on having anyway.",

  "**Boofy / boofied** is the league's collective word for a fart, and it " +
    "conjugates freely: \"Did you boofy?\", \"get boofied\", \"Don't get " +
    "boofied\", \"You're going to get fucked — here comes the boofy.\"",

  "**\"Feck off.\"** They say \"fuck off, fuck off, F-E-C-K off\" constantly, " +
    "and it is spelled feck.",

  "**The voice.** NICK could not say his R's or L's as a child, and the league " +
    "got both of its nicknames out of it: his own name came out **Nickwis**, " +
    "and Ryan's came out **Wyan**. The impediment is Nick's alone — Ryan just " +
    "kept the name Nick gave him and his own speech has never been the joke. " +
    "The bit is live rather than historical: when either name comes up the " +
    "room DOES THE VOICE, swapping W in for R and L, and it will run a whole " +
    "sentence that way. It is available to you on those two men and nowhere " +
    "else. **USE IT ONCE AT MOST.** A speech bit that fires in every Nick and " +
    "Ryan reference is not a callback, it is a tic, and it reads as a machine " +
    "that found one joke and could not put it down — once, on a line that had " +
    "already earned a laugh, is the whole ration.",

  "**\"Hut\"** is an all-purpose interjection and sentence-opener. The cadence, " +
    "as spoken: \"Hut, Chris says that we like to honk boobies.\"",

  "**Honking boobies.** Chris is going to be honking boobies, Tom likes " +
    "honking boobies, and the position of the group is that they all like " +
    "honking boobies.",

  "**Rainman**, heavily and constantly — counting cards, \"About $100\", \"How " +
    "much does a candy bar cost, Ray? About $100.\" Any Rainman quote lands. " +
    "THE RAINMAN GUYS ARE COLIN, NICK, CHRIS AND TOM, and a Rainman line " +
    "belongs in one of those four blurbs and nowhere else.",

  "**Slingblade.** The movie, quoted a lot.",

  "**Degenerate gambling**, all ten of them, and they are playing poker after " +
    "the draft.",

  "**Rub and tugs**, and **Mama San** — a standing subject of jokes.",

  "**\"Mongoloids United\"** is the name of the young cousins' group chat. " +
    "Deeply derogatory and entirely self-applied, which is the only reason it " +
    "is available at all.",

  "**\"Roast him!\"** and **\"Take a walk, motherfucker\"** both work as bare " +
    "heckles, detached from the nights they come from.",

  "Seniority, useful for a joke and for nothing else: Nick is the youngest, " +
    "then Colin, then Ryan, then Chris and Tom, then Dre, then the three old " +
    "balls — Keith, Scott and Steve. Dennis is Colin's stepdad and sits with " +
    "the old balls. DO NOT TURN ANY OF THAT INTO AN AGE, A DECADE OR A NUMBER.",

  "The register overall: goofy knucklehead cousins, extremely raunchy, and " +
    "roasting is how affection is expressed. Nobody here is being protected " +
    "from a joke, and nobody is owed one either.",
];

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
 * Ron and Friends renders the populated branch. The empty branch is kept rather
 * than deleted because it is one edit away from being live again — emptying
 * `MANAGER_PERSONAS` is what a commissioner would do to pull the lore back off
 * the television, and it has to leave the prompt safe rather than silent.
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
    `All of this came from the commissioner, about his own cousins, and all of it is real. **NOT ONE LINE OF IT CARRIES A NUMBER, A YEAR OR A ROUND, AND YOU MAY NOT GIVE IT ONE** — no date on a story, no season on a title, no count of anything, no "the third year running". Where a manager has an indented line under him, that line is a recorded fact out of the league's history file and its numbers ARE quotable; a line marked NO NUMBERS is a true story whose details were never written down. Run the joke, never date it.`,
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

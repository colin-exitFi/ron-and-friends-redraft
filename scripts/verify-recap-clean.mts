#!/usr/bin/env node
/**
 * Prove that no other league's people can reach the recap model.
 *
 * ============================================================================
 * WHY THIS EXISTS SEPARATELY FROM `verify:recap`
 * ============================================================================
 * The recap is the one feature here that fails SILENTLY and CONFIDENTLY. It
 * cannot throw, it cannot fail a type check, and it cannot fail a build: handed
 * a persona for somebody who is not in the room it simply writes a fluent,
 * assured paragraph about a stranger and puts it on a television in front of
 * the people who are.
 *
 * This app was reskinned from a different league's draft board. That league's
 * lore — ten named manager personas, their professions and rivalries, a decade
 * of running jokes, and a signed contract between two of its members — was
 * wired directly into the recap prompt. All of it was true. NONE of it is about
 * the ten people at this table.
 *
 * So the check is blunt on purpose: render the ACTUAL prompt, at every stage,
 * and fail if any of those names survives anywhere in it.
 *
 * ============================================================================
 * THE FALSE-POSITIVE TRAP, WHICH IS REAL AND WORTH THE CARE
 * ============================================================================
 * Two of the previous league's managers share a surname with a player in this
 * season's pool — Puka Nacua and Quentin Johnston are both drafted here. A
 * surname-only banlist would fail on a correct prompt forever, and a check that
 * cries wolf gets deleted. So the list below is full names, franchise names and
 * lore phrases that cannot occur innocently, and the player-name collisions are
 * asserted to be ABSENT from the banlist rather than quietly tolerated.
 *
 * Usage: npm run verify:recap:clean
 */

import { recapSystemPrompt } from "@/lib/recap-prompt";
import { loreBlock, ASSIGNED_SAVAGE } from "@/lib/league-lore";
import { positionalNormsBlock } from "@/lib/positional-norms";
import { readGradeHistory } from "@/lib/recap-grade-source";
import { CURRENT_SEASON, FEATURES, FRANCHISES, LEAGUE } from "@/lib/league-config";

let checks = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = "") {
  checks++;
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

/**
 * The previous league's people and lore. Full names and franchises only — see
 * the note above on why a bare surname is not safe to ban.
 */
const FOREIGN_LORE = [
  "Zach Rakowski",
  "Kyle Witte",
  "Joe Murray",
  "Josh Grainger",
  "Scott Elbe",
  "Kyle Mertens",
  "Scott Johnston",
  "Stefan Albers",
  "Greg Blome",
  "Perpetually Impaired",
  "The Replacement Team",
  "Fingers are for painting",
  "Teddys Trouser Snake",
  "Rombusters",
  "Tushy Booth Ballers",
  "DHB Sandmen",
  "Mound City Dogs",
  "Jimmy's Johnson",
  "Flurp McDerp",
  "Ted Buckman",
  "Gary Barnidge",
  "Ultimate Keeper",
  "Smart Draft",
  "Continent 2026 Trade",
  "Contingent 2026 Trade",
  "for the avoidance of doubt",
  "good PPR quarterback",
];

/** Surnames that are ALSO real players this season. Must never be banned. */
const PLAYER_COLLISIONS = ["Nacua", "Johnston"];

section("1. The banlist cannot fire on a real player");
for (const name of PLAYER_COLLISIONS) {
  check(
    `"${name}" is a drafted player and is not banned on its own`,
    !FOREIGN_LORE.includes(name),
  );
}

section("2. The lore block carries nobody from another league");
const lore = loreBlock();
for (const name of FOREIGN_LORE) {
  check(`lore block is free of "${name}"`, !lore.toLowerCase().includes(name.toLowerCase()));
}

section("3. …and what it does carry is this league's, and is fenced");
/*
 * THIS SECTION USED TO ASSERT THE OPPOSITE, AND THE FLIP IS THE POINT.
 *
 * While `MANAGER_PERSONAS` was empty, `loreBlock()` rendered a prohibition —
 * "NOTHING IS RECORDED ABOUT THESE TEN MANAGERS" — and the checks here proved
 * that prohibition reached the model. The commissioner has since dictated the
 * real thing: nicknames, the group's shared vocabulary, and the handful of
 * stories these men actually tell. So the empty branch no longer renders and
 * asserting its wording would fail on the LEAGUE rather than on a bug.
 *
 * What has NOT changed is the failure being guarded against, so the checks are
 * re-pointed rather than dropped. Sections 1, 2 and 5 — the foreign-lore
 * banlist, which is the reason this script exists — are untouched. What is
 * asserted below is that the replacement is complete (every man on tonight's
 * roster has a line, so no blurb is written off a blank), that it is fenced
 * where the commissioner fenced it (four managers with no material, and no
 * number, year or round attached to any of it), and that the two facts most
 * easily misattributed still name the right men.
 */
check("the lore block is present rather than empty", lore.trim().length > 0);
const missing = FRANCHISES.filter((f) => !lore.includes(`**${f.shortName}** —`));
check(
  "every manager on tonight's roster has a persona of his own",
  missing.length === 0,
  missing.map((f) => f.shortName).join(", "),
);
check(
  "it forbids putting a number, a year or a round on any of it",
  /NOT ONE LINE OF IT CARRIES A NUMBER, A YEAR OR A ROUND/i.test(lore),
);
check(
  "the four managers with no material are marked as having none",
  /NOTHING ELSE ABOUT HIM IS RECORDED/.test(lore) &&
    /NO RUNNING JOKE EXISTS ABOUT HIM AND YOU MUST NOT INVENT ONE/.test(lore) &&
    ["Scott", "Keith"].every((n) =>
      new RegExp(`\\*\\*${n}\\*\\* —[^\\n]*[Nn]othing else about him is recorded`).test(lore),
    ),
);
/*
 * The two misattributions this lore makes available, asserted by name. Both are
 * a good line under the wrong man, which reads perfectly and is false — the
 * exact failure Part 5 spends a paragraph on.
 */
check(
  "the Rainman four are named, and Ryan is explicitly not one of them",
  /THE RAINMAN GUYS ARE COLIN, NICK, CHRIS AND TOM/.test(lore) &&
    /HE IS NOT A[\s\S]{0,20}RAINMAN GUY/.test(lore),
);
check(
  "the unrecorded second heckler is named as unrecorded rather than guessed at",
  /THE SECOND HECKLER IS NOT RECORDED/.test(lore),
);
check(
  "Steve's franchise name is not allowed to become a nickname for Steve",
  /there is no "Steve Mahomes"/.test(lore),
);
/*
 * THE IMPEDIMENT IS NICK'S, AND IT WAS RECORDED AGAINST RYAN TWICE BEFORE THE
 * COMMISSIONER CAUGHT IT. Wyan and Nickwis both came out of Nick's childhood
 * mouth; Ryan only ever kept the name he was given. It is the most inviting
 * misattribution in the file — the name that got changed is Ryan's, so the
 * impediment reads as though it ought to be his — and it is a false claim about
 * a man who will be sat in the room while the blurb is read out.
 */
check(
  "the speech impediment is Nick's, and Ryan is cleared of it in as many words",
  /NICK could not say his R's or L's as a child/.test(lore) &&
    /RYAN HAS NO SPEECH IMPEDIMENT/.test(lore) &&
    !/Ryan could not say his/i.test(lore),
);
check(
  "…and the bit carries its own restraint rule",
  /USE IT ONCE AT MOST/.test(lore),
);

section("4. Nobody is nominated for the savage blurb");
check(
  "no manager is named as the savage target",
  ASSIGNED_SAVAGE === null,
  `got ${JSON.stringify(ASSIGNED_SAVAGE)}`,
);

section("5. The rendered system prompt, at every stage");
for (const stage of ["predraft", "midraft", "postdraft"] as const) {
  for (const grading of [false, true]) {
    const prompt = recapSystemPrompt(stage, { grading });
    const hits = FOREIGN_LORE.filter((n) => prompt.toLowerCase().includes(n.toLowerCase()));
    check(
      `${stage}${grading ? " (grading)" : ""}: no foreign lore in ${(prompt.length / 1024) | 0}KB of prompt`,
      hits.length === 0,
      hits.join(", "),
    );
  }
}

section("6. The other two documents that reach the model");
const norms = positionalNormsBlock();
check(
  "the positional-price block is empty — this league has no draft history to price against",
  norms === "",
  `${norms.length} chars`,
);
const graded = readGradeHistory();
check(
  "the grade history is empty — no manager carries a note from another league",
  Object.keys(graded).length === 0,
  Object.keys(graded).join(", "),
);

section("7. The managers the prompt CAN name are this league's");
const roster = FRANCHISES.map((f) => f.shortName);
check(`${LEAGUE.teams} franchises configured`, roster.length === LEAGUE.teams, roster.join(", "));
check(
  "every short name is unique, so a blurb cannot be misattributed",
  new Set(roster.map((s) => s.toLowerCase())).size === roster.length,
);

section("8. The keeper machinery does not render into a redraft");
/*
 * THE SECOND WAY A PROMPT LIES TO THE ROOM, AND IT IS NOT A FOREIGN NAME.
 *
 * Sections 1–5 stop another league's PEOPLE reaching the model. This one stops
 * another league's FORMAT reaching it, which shipped for exactly as long and
 * was harder to see because none of it is a proper noun.
 *
 * `FEATURES.keepers` is false: Section 10 of the ruleset writes the keeper
 * framework down and deliberately leaves it switched off, so nobody kept
 * anybody and every keeper-shaped field in the dossier is empty. The prompt
 * nonetheless carried several thousand words on how to price a keeper, how to
 * judge a passed-over keeper, and how to read a board reshaped by pick trades
 * this league forbids — and the pre-draft branch was a KEEPER AUDIT from its
 * title down, against a board with no keepers to audit.
 *
 * A model handed instructions for machinery that is not there does not fall
 * silent. It explains the absence, or it borrows the vocabulary and writes a
 * sentence about a keeper in a league that has none, in front of ten men who
 * will notice immediately. So the gating is asserted rather than assumed, by
 * the FIELD NAMES: a schema key like `slotsSavedByKeeping` cannot appear in a
 * correct redraft prompt for any innocent reason, which makes it the same kind
 * of unambiguous tripwire as a full name in `FOREIGN_LORE`.
 *
 * Everything here reverses cleanly if the league votes keepers in for 2027 —
 * the checks are written against the switch, not against the string.
 */
check(`FEATURES.keepers is off, so ${CURRENT_SEASON} is the redraft this section assumes`, !FEATURES.keepers);

if (!FEATURES.keepers) {
  /** Schema keys that only exist to price a keeper. None may reach the model. */
  const KEEPER_FIELDS = [
    "slotsSavedByKeeping",
    "pickIfReleased",
    "costOverallPick",
    "passedOnKeepers",
    "keeperConsumedRounds",
    "keepersOutOfPool",
    "unusedKeeperSlots",
    "roundsCheaperToKeep",
  ];

  for (const stage of ["predraft", "midraft", "postdraft"] as const) {
    const prompt = recapSystemPrompt(stage);
    const leaked = KEEPER_FIELDS.filter((f) => prompt.includes(f));
    check(`${stage}: no keeper field name survives in the prompt`, leaked.length === 0, leaked.join(", "));
  }

  const post = recapSystemPrompt("postdraft");
  check(
    "the format is stated as a redraft in the opening, not as a keeper league",
    /-team redraft fantasy football league/.test(post) &&
      !/-team keeper fantasy football league/.test(post),
  );
  check(
    "…and Part 1 says outright that nobody kept anybody",
    /THIS IS A PURE REDRAFT AND NOBODY KEPT ANYBODY/.test(post),
  );
  check(
    "…and Part 3 names the keeper framework as switched off rather than absent",
    /NO KEEPERS THIS SEASON/.test(post) && /a keeper vote is a 2027 conversation/.test(post),
  );
  check(
    "the one surviving value measure is the ADP comparison, and it is named as the only one",
    /There is exactly ONE measure of value on this page/.test(post) &&
      /\`expectedPick - overallPick\`/.test(post),
  );

  /*
   * The pre-draft branch, which was the worst of it: a keeper audit by name,
   * ordering a model to judge declarations that do not exist, and narrating a
   * projected table computed off rosters with no players in them.
   */
  const pre = recapSystemPrompt("predraft");
  check("the pre-draft branch is a roast and no longer a keeper audit", /PRE-DRAFT ROAST/.test(pre) && !/KEEPER AUDIT/.test(pre));
  check(
    "…and it forbids a projected finish outright, because nobody owns a player",
    /NO PROJECTED STANDINGS/.test(pre) && !/\`projectedStandings\.spread\`/.test(pre),
  );
  check(
    "…and it names what IS known before a pick: the seat, the franchise, who is new, the lore",
    /Where he is sitting, and what that seat is worth/.test(pre) && /draftSlot/.test(pre),
  );
}

section("9. The keeper row is recorded as an argument, never as this season's format");
/*
 * THE ONE PLACE "KEEPER" IS STILL ALLOWED TO APPEAR, AND WHY IT IS FENCED.
 *
 * Chris is loudly against a keeper league that was floated and not adopted, and
 * the commissioner wanted the row recorded because it is the funniest thing
 * happening in the room tonight. It is also the single easiest way for a blurb
 * to state that this league has keepers — so the lore has to carry the
 * grievance AND the fact that it is about a proposal, and his quote has to stay
 * a thing he said rather than a thing that is true.
 */
check(
  "the lore records the keeper league as a proposal that was not adopted",
  /A PROPOSAL AND NOT THIS SEASON'S FORMAT/.test(lore) &&
    new RegExp(`${LEAGUE.currentSeason} is a pure redraft`).test(lore),
);
check(
  "Chris's own words are quoted, and fenced as saying rather than as claim",
  /Why the fuck do I want to do a keeper league/.test(lore) &&
    /VERIFIED AS TO THE SAYING AND NOT AS TO THE CLAIM/.test(lore),
);
/*
 * THE INVERSION, ASSERTED BECAUSE IT WAS RECORDED BACKWARDS ONCE. Chris and
 * Ryan have never done an OFFLINE draft — they are Yahoo-app phone drafters and
 * the room is the new thing. Written the other way round the joke still reads
 * perfectly and is the opposite of true about two men who will be sitting here.
 */
check(
  "the offline draft is the new thing for them, not the online one",
  /never done an offline draft/.test(lore) &&
    /Yahoo app man/.test(lore) &&
    !/never done an online draft/i.test(lore),
);
check(
  "…and the grievance is weighted to Chris rather than split with Ryan",
  /HE IS THE SECOND VOICE ON BOTH/.test(lore) && /do not split them evenly/.test(lore),
);

console.log(`\n  ${checks} checks, ${failures.length} failed.\n`);
if (failures.length) {
  console.log("FAILED:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("No other league's people can reach the recap.\n");

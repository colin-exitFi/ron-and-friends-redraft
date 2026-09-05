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
import { FRANCHISES, LEAGUE } from "@/lib/league-config";

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

section("3. …and it does not merely vanish, it forbids invention");
check("the lore block is present rather than empty", lore.trim().length > 0);
check(
  "it states outright that nothing is recorded about these managers",
  /NOTHING IS RECORDED ABOUT THESE TEN MANAGERS/i.test(lore),
);
check("it forbids inventing a profession or a personality", /do not give anybody a profession/i.test(lore));
check("it forbids referencing a previous season", /there is no previous season/i.test(lore));
check("it points the model at the board instead", /write about the draft, not about the drafters/i.test(lore));

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

console.log(`\n  ${checks} checks, ${failures.length} failed.\n`);
if (failures.length) {
  console.log("FAILED:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("No other league's people can reach the recap.\n");

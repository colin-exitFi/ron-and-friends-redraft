#!/usr/bin/env node
/**
 * Run the pre-draft recap for real, against the real board, and stop at the
 * network.
 *
 * ============================================================================
 * WHY THIS EXISTS SEPARATELY FROM `verify:recap:clean`
 * ============================================================================
 *
 * `verify:recap:clean` renders the SYSTEM PROMPT and asserts strings in it. It
 * never builds a dossier, so it cannot see the half of the pre-draft path that
 * is most likely to break tonight: `buildRecapDossier` over a board with zero
 * picks, `capitalSentences` and `keeperEconomics` deciding whether to render,
 * `valueTies` finding a ten-way tie at zero, and `recapUserMessage` stitching
 * the lot together. Every one of those is exercised for the first time at the
 * moment the commissioner presses the button, in front of ten people, and a
 * thrown exception there is indistinguishable from the app being broken.
 *
 * So this does exactly what `src/app/api/recap/route.ts` does — same reads,
 * same dossier, same two strings — and then stops. It does not call Anthropic
 * and it must never be made to: a check that costs money is a check nobody runs
 * before a draft.
 *
 * WHAT IT CANNOT TELL YOU, stated plainly because the gap matters. It proves
 * the request we would send is well formed and that building it does not throw.
 * It proves nothing about what comes back. The model's output is covered by
 * `verify:recap:grade -- --straight-face`, which does spend money and is opt-in.
 *
 * ============================================================================
 * IT ASSERTS AGAINST THE LIVE BOARD, NOT A FIXTURE
 * ============================================================================
 *
 * A fixture would pass on a checkout where the real board is broken, which is
 * the wrong way round for a check whose whole job is "is tonight going to
 * work". If picks have been entered by the time this runs, the pre-draft
 * assertions do not apply and it says so and skips them rather than failing —
 * the draft having started is not a defect.
 *
 * Usage: npm run verify:recap:predraft [-- --print]
 */

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import {
  readClosedKeeperLists,
  readKeeperOptions,
  readProjectedStandings,
} from "@/lib/recap-source";
import { readPool, readRoom } from "@/lib/draft-service";
import { recapStage, recapSystemPrompt, recapUserMessage } from "@/lib/recap-prompt";
import { buildGradeInput } from "@/lib/recap-grade";
import { readGradeHistory } from "@/lib/recap-grade-source";
import { positionalNorms } from "@/lib/positional-norms";
import { FEATURES, LEAGUE } from "@/lib/league-config";

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

// ---------------------------------------------------------------------------
section("1. The route's own reads, against the board as it stands");

const view = await readRoom();
const pool = readPool();
const dossier = buildRecapDossier({
  view,
  expectedPick: buildExpectedPicks(pool, view.slots),
  pool,
  keeperOptions: readKeeperOptions(),
  closedKeeperLists: readClosedKeeperLists(),
  projectedStandings: readProjectedStandings(view),
});

const stage = recapStage(dossier);
check(
  `the dossier builds off the live board without throwing (stage: ${stage}, ${dossier.picksEntered} picks)`,
  true,
);
check(
  `all ${LEAGUE.teams} franchises are in it`,
  dossier.franchises.length === LEAGUE.teams,
  `${dossier.franchises.length}`,
);

if (stage !== "predraft") {
  console.log(
    `\n  – ${dossier.picksEntered} picks are already entered, so the pre-draft\n` +
      `    assertions below do not apply. The draft having started is not a\n` +
      `    defect; this check covers the state before it does.\n`,
  );
  console.log(`\n  ${checks} checks, ${failures.length} failed.\n`);
  process.exit(failures.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
section("2. Both halves of the request render, which is the part that can throw");

const grading = buildGradeInput({
  dossier,
  history: readGradeHistory(),
  positionalNorms: positionalNorms(),
});
const gradable = grading.coverage.sufficientToGrade;

const system = recapSystemPrompt(stage, { grading: gradable });
const user = recapUserMessage(dossier, dossier.franchises.map((f) => f.teamId), gradable ? grading : null);

check(`the system prompt renders (${(system.length / 1024) | 0}KB)`, system.length > 1000);
check(`the user message renders (${(user.length / 1024) | 0}KB)`, user.length > 500);
check(
  "no unresolved template placeholder survived into either string",
  !system.includes("${") && !user.includes("${"),
);

/*
 * The grade gate, which is the reason this run is cheap. Nobody has decided
 * anything, so no letters are asked for and Part 10 never renders.
 */
check(
  "a pre-draft board is not graded, so no rubric is attached",
  !gradable && !/# Part 10/.test(system),
  `sufficientToGrade=${gradable}`,
);

// ---------------------------------------------------------------------------
section("3. Nothing in either string claims this is a keeper league");

if (!FEATURES.keepers) {
  /*
   * The OPENING line only. The body of Part 0 says "there is no keeper audit
   * tonight or on any other night this season", which is the denial doing its
   * job — a bare substring match reads that as the fault it is preventing.
   */
  check("no keeper audit is announced", !/writing the PRE-DRAFT KEEPER AUDIT/i.test(system));
  check("the format is named as a redraft", /-team redraft fantasy football league/.test(system));
  check(
    "the user turn does not report a keeper count",
    !/players were kept and never entered the pool/.test(user),
    user.slice(0, 200),
  );
  /*
   * The schema keys that only exist to price a keeper. Same tripwire logic as
   * `verify:recap:clean` section 8, applied to the USER turn, which that script
   * does not build.
   */
  const KEEPER_FIELDS = [
    "slotsSavedByKeeping",
    "pickIfReleased",
    "keeperConsumedRounds",
    "KEEPER SURPLUS",
    "WHAT WAS ACTUALLY ON THE TABLE",
  ];
  const leaked = KEEPER_FIELDS.filter((f) => user.includes(f));
  check("no keeper machinery renders into the user turn", leaked.length === 0, leaked.join(", "));
}

// ---------------------------------------------------------------------------
section("4. The pre-draft roast has its material");

check("it is framed as a roast", /PRE-DRAFT ROAST/.test(system));
check(
  "…and it is told to write about the seat, the franchise and the lore",
  /Where he is sitting, and what that seat is worth/.test(system) &&
    /Who is brand new/.test(system) &&
    /Who is the defending champion/.test(system),
);
check(
  "…and it is forbidden a projected finish",
  /NO PROJECTED STANDINGS/.test(system),
);
check(
  "the lore is populated rather than prohibited",
  !/NOTHING IS RECORDED ABOUT THESE TEN MANAGERS/.test(system),
);
for (const f of ["Chris", "Ryan", "Nick", "Keith", "Scott", "Dre", "Dennis", "Steve", "Colin", "Tom"]) {
  check(`  ${f} has a persona the roast can use`, system.includes(`**${f}** —`));
}
check(
  "the offline-draft grievance is available, and flagged as pre-draft material",
  /THE OFFLINE DRAFT, AND THEY HAVE IT EXACTLY BACKWARDS/.test(system) &&
    /grieving the loss of a timer/.test(system),
);
check(
  "the Wyan nickname carries its double edge",
  /it roasts NICK every time it is used on RYAN/i.test(system),
);

// ---------------------------------------------------------------------------
section("4b. No mock draft: the ADP board is not handed over as a forecast");
/*
 * "He's taking Derrick Henry at 1.03" shipped off this page. The cause was not
 * bad data — the pool is current FantasyPros ADP and Henry sits at 16.33 in it
 * — it was `pickCapital.topTalentPlayers`, which names which of the top twenty
 * the board expects to be gone at a given manager's slots. After a draft that
 * is a fair comparison. Before one it is a mock draft with his name on it.
 */
check(
  "the prompt forbids putting a named player in a named slot",
  /Never put a named player into a named slot/.test(system),
);
check(
  "…and the aggregate alternative is offered rather than just prohibited",
  /talk about the board in AGGREGATE/.test(system),
);
check(
  "the payload withholds the per-manager list of expected players",
  !/topTalentPlayers/.test(user),
);
check(
  "…while keeping the structural count, which is the actual material",
  /"topTalentCaptured":/.test(user),
);
/*
 * The player names themselves. Anything the board expects at somebody's slot is
 * a forecast tonight, so none of the top of the ADP board should appear in the
 * payload at all.
 */
const topOfBoard = ["Derrick Henry", "Ja'Marr Chase", "Jahmyr Gibbs", "Bijan Robinson"];
const named = topOfBoard.filter((n) => user.includes(n));
check("no player from the top of the board is named in the payload", named.length === 0, named.join(", "));

// ---------------------------------------------------------------------------
section("4c. The model is told to ground every player in the current season");

check(
  `it must confirm ${LEAGUE.currentSeason} reality before characterising anybody`,
  new RegExp(`GROUND EVERY PLAYER IN ${LEAGUE.currentSeason} BEFORE YOU CHARACTERISE HIM`).test(system),
);
check(
  "…and is told its own sense of a player is out of date",
  /Your own sense of who is good is out of date and you cannot feel that it is/.test(system),
);
check(
  "…and that local ADP is a stale-able reference that search overrules",
  /is a starting reference and it can be stale/.test(system) && /search wins/.test(system),
);
check(
  "…and that saying less beats being confidently wrong",
  /saying less is not a failure, and being confidently wrong is/.test(system),
);

// ---------------------------------------------------------------------------
section("5. Every franchise the roast must cover is in the user turn");

for (const f of dossier.franchises) {
  check(`  ${f.teamName} is on the board with a draft slot`, user.includes(f.teamName) && f.draftSlot > 0);
}

if (process.argv.includes("--print")) {
  console.log(`\n${"═".repeat(78)}\nSYSTEM PROMPT\n${"═".repeat(78)}\n`);
  console.log(system);
  console.log(`\n${"═".repeat(78)}\nUSER MESSAGE (dossier JSON elided)\n${"═".repeat(78)}\n`);
  console.log(user.slice(0, user.indexOf("{\"season\"") > 0 ? user.indexOf("{\"season\"") : 4000));
}

console.log(`\n  ${checks} checks, ${failures.length} failed.\n`);
if (failures.length) {
  console.log("FAILED:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("A pre-draft recap would build and send cleanly. Nothing was asked of the model.\n");

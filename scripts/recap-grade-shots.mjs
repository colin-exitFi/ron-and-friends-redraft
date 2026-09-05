/**
 * The letters, on the cards, on the board the league is actually looking at.
 *
 *   BASE=http://127.0.0.1:3232 node scripts/recap-grade-shots.mjs
 *
 * ============================================================================
 * WHY THIS IS NOT PART OF `audit:recap:layout`
 * ============================================================================
 *
 * That harness measures. It screenshots a HAND-WRITTEN fixture recap, which is
 * the right call for a check anybody should be able to run on a whim: it costs
 * nothing, it never varies, and what it proves is that a stored recap reaches
 * the screen without clipping.
 *
 * What it cannot show is whether a letter the MODEL chose looks right sitting
 * next to a franchise name — how long a real `gradeReason` runs, how wide a
 * real receipt line gets, whether five citations wrap into something anybody
 * would read. Those are properties of real output and a fixture cannot have
 * them, because the person writing the fixture already knows what fits.
 *
 * So the grades below are VERBATIM from one real generation — Opus 5, the
 * shipping prompt, the live pre-draft board, research replayed off
 * `data/recap-recordings/2026-08-29T08-41-01-shipped.json`, $0.714, every one
 * of the ten accepted by `validateGrades` with no flag of any severity. They
 * are pasted rather than regenerated because a generation costs about a dollar
 * and a screenshot check should not, and because the point of a fixed sample
 * is that two runs of this script produce comparable pictures.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 *
 * Only `data/draft-recap-2026.json` is written — the board itself is left
 * exactly as it is, because a keeper slate IS the board this is about and there
 * is nothing to install over it. `scripts/live-board-guard.mjs` still holds the
 * lock and vaults both files: the recap file is the league's, a run that died
 * halfway would leave this sample sitting in production's place, and the guard
 * is the thing that puts it back on every exit path.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { borrowLiveBoard } from "./live-board-guard.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = path.join(process.cwd(), "screenshots");
const RECAP_FILE = path.join(process.cwd(), "data", "draft-recap-2026.json");

/** The three screens this page is read on, as `audit:recap:layout` defines them. */
const SIZES = [
  { label: "desktop", w: 1440, h: 900 },
  { label: "laptop", w: 1280, h: 800 },
  { label: "phone", w: 390, h: 844 },
];

/**
 * One real generation, by team handle.
 *
 * `verdict` and `blurb` are the prose from the same run, kept so the card is
 * photographed in the state it actually ships in — a letter above a blurb,
 * both from one model, competing for the same column.
 */
const RUN = {
  Zach: {
    letter: "C+",
    verdict: "Third on points, eighth on price",
    reason:
      "Two receivers kept at 77 slots saved, both priced dearer than the league's median WR keeper round, propped up by a projected third on points he didn't really earn with price.",
    citations: [
      { label: "Total slots saved across both keepers", value: 77 },
      { label: "League rank on keeper surplus", value: 8 },
      { label: "Justin Jefferson slots saved", value: 52 },
      { label: "Projected points, third in the league", value: 493.1 },
    ],
    blurb:
      "Zach declared two receivers and paid over the going rate on both — McConkey at a sixth and Jefferson at a seventh, when the median wide receiver keeper in this league costs an eighth. That's 77 slots saved, eighth of ten, and it still projects him third on points at 493.1, which is the single funniest disagreement between price and player on this board. He also walked in holding two firsts, three fourths and then absolutely nothing from round five through round ten, having sold four of those rounds to Kyle and Witte. Jefferson is in his final keeper season, so the whole thing is a one-year lease he paid a premium on.",
  },
  Witte: {
    letter: "B+",
    verdict: "Best work done from Canada",
    reason:
      "114 slots saved, third-most in the league, with both keepers priced under this league's own median at their positions.",
    citations: [
      { label: "Total slots saved", value: 114 },
      { label: "De'Von Achane slots saved", value: 72 },
      { label: "Tucker Kraft slots saved", value: 42 },
      { label: "Trades he was a party to, of twelve logged", value: 6 },
    ],
    blurb:
      "Achane at an eighth is a round cheaper than the median running back keeper here, Kraft at an eleventh is two rounds cheaper than the median tight end, and together that's 114 slots saved — third in the league without a single argument attached to it. He was a party to six of the twelve logged trades and moved himself into two seconds, two fourths and two eighths while shedding rounds five, seven, nine, ten and eleven, which is the most lopsided board in the room. Clean, quiet, and better business than eight people in the room actually managed.",
  },
  Joe: {
    letter: "D",
    verdict: "He kept one guy on purpose",
    reason:
      "One keeper out of two by choice, 35 slots saved — last but one — and a projected 359.1 points, 88.8 clear of the ninth-place franchise on the wrong side of the table's only real cliff.",
    citations: [
      { label: "Keepers declared, of two permitted", value: 1 },
      { label: "Slots saved", value: 35 },
      { label: "Projected points, last", value: 359.1 },
      { label: "Points gap to the franchise above him", value: 88.8 },
      { label: "Playoff odds, percent", value: 2.1 },
    ],
    blurb:
      "Joe is the only franchise in the league that declared one keeper instead of two, and it was a final answer, given in writing, on purpose. Jayden Daniels at a ninth is a round dearer than the median quarterback keeper here and he saved 35 slots with it — and that is the whole haul, which is why he sits last on points at 359.1 with the board's one real cliff, 88.8 points of it, sitting between him and Greg. The empty slot could have had Drake London or TreVeyon Henderson in it, both at prices no sane man pays, so fine — but he had fifteen names available and used one.",
  },
  Josh: {
    letter: "B",
    verdict: "Tight end tax, paid gladly",
    reason:
      "79 slots saved with Etienne at exactly the median RB price, but Bowers at a sixth is three rounds dearer than the median tight end keeper here.",
    citations: [
      { label: "Total slots saved", value: 79 },
      { label: "Brock Bowers slots saved", value: 41 },
      { label: "Travis Etienne slots saved", value: 38 },
      { label: "Projected points, fourth", value: 480.3 },
    ],
    blurb:
      "Josh paid a sixth for Brock Bowers, three rounds dearer than the median tight end keeper in this league's history, and got 41 slots back for it, which is the rare case of the expensive answer also being the right one. Etienne at a seventh is exactly the median running back price — boring, correct, 38 slots. He declined Joe Burrow at a round-3 keeper price, which nobody here has ever come close to paying at quarterback, so credit where it's due. Fourth on points, 480.3, and he did it without doing anything embarrassing, which around here counts as a personality.",
  },
  Elbe: {
    letter: "B",
    verdict: "Two backs, no arguments",
    reason:
      "102 slots saved, fourth in the league, off two running backs — Skattebo at a ninth is two rounds cheaper than the median RB keeper price.",
    citations: [
      { label: "Total slots saved", value: 102 },
      { label: "Cam Skattebo slots saved", value: 59 },
      { label: "Javonte Williams slots saved", value: 43 },
      { label: "Projected points, eighth", value: 468 },
    ],
    blurb:
      "Skattebo came to Elbe by trade and is kept at a ninth — two rounds cheaper than the median running back keeper price here — for 59 slots, and it's the legitimate version of the trick everyone else is trying to lawyer their way into. Javonte Williams at a seventh is exactly the median, and Williams walked into Dallas camp as the unquestioned starter with Blue and Mafah behind him, so that's 43 more slots on a guy with the backfield to himself. 102 slots, fourth in the league, and not one of them requires a ballot.",
  },
  Kyle: {
    letter: "A-",
    verdict: "Expensive and projected first",
    reason:
      "Projected first in the league at 604.8 points with 98.4 percent playoff odds off 82 slots saved, even though both keepers are priced dearer than this league's median at their positions.",
    citations: [
      { label: "Projected points, first", value: 604.8 },
      { label: "Playoff odds, percent", value: 98.4 },
      { label: "Title odds, percent", value: 39.9 },
      { label: "Total slots saved", value: 82 },
      { label: "Chase Brown slots saved", value: 50 },
    ],
    blurb:
      "Kyle paid a fourth for Smith-Njigba — four rounds dearer than the median receiver keeper in this league's history — and a sixth for Chase Brown, a round dearer than the median back, and he is projected first in the league on 604.8 points with 98.4 percent playoff odds off exactly two guys and sixteen rounds still to come. Fifth on keeper surplus, first on the table; that gap is the whole story and he should be insufferable about it. He paid over the odds twice and it worked anyway, and there's not a damn thing the rest of you can do about it tonight.",
  },
  Scott: {
    letter: "B-",
    verdict: "148 slots, nobody voted",
    reason:
      "148 slots saved is the biggest figure on the board, but 103 of them come from the unratified contingent-trade mechanism the league is voting on rather than from a decision anybody here concedes.",
    citations: [
      { label: "Total slots saved, most in the league", value: 148 },
      { label: "Puka Nacua slots saved", value: 103 },
      { label: "Kyren Williams slots saved", value: 45 },
      { label: "Early picks, most in the league", value: 9 },
      { label: "Projected points, second", value: 579.9 },
    ],
    blurb:
      "Scott holds 148 slots of keeper surplus, more than anyone, and 103 of it is Puka Nacua at an eleventh — the largest single figure in this entire dossier, and the one that came out of two pages of WHEREAS clauses, a DocuSign envelope and a defined term his own contract spells 'Continent 2026 Trade' and then never uses again. Kyren at a seventh is exactly the median back price, and he walks in with nine early picks — he bought the top of the draft with the bottom of it. Second on points, 579.9, and nine men in this room never agreed you could have any of it.",
  },
  Stefan: {
    letter: "C",
    verdict: "One great, one dear",
    reason:
      "78 slots saved, seventh in the league, with Rashee Rice at a fourth — four rounds dearer than the median WR keeper price — carrying an availability risk on top.",
    citations: [
      { label: "Total slots saved", value: 78 },
      { label: "Rashee Rice slots saved", value: 19 },
      { label: "Colston Loveland slots saved", value: 59 },
      { label: "Projected points, fifth", value: 479.7 },
    ],
    blurb:
      "Loveland at a ninth is exactly the median tight end price and saved 59 slots, and everything out of Chicago says he's been unguardable in camp — genuinely good work, no notes. Then there's Rashee Rice at a fourth, four rounds dearer than the median receiver keeper in this league's history, for 19 slots, with a probation matter hanging over his 2026 availability. He sold the first, can't keep the guy he bought with it, and paid four rounds over the market for the keeper he did make.",
  },
  Greg: {
    letter: "D+",
    verdict: "Nine slots. Total.",
    reason:
      "9 slots saved across two keepers, last in the league by 68 slots, with both receivers priced dearer than the median WR keeper round and the least early capital in the room.",
    citations: [
      { label: "Total slots saved, last in the league", value: 9 },
      { label: "Garrett Wilson slots saved", value: 5 },
      { label: "Rome Odunze slots saved", value: 4 },
      { label: "Early capital rank", value: 10 },
      { label: "Playoff odds, percent", value: 39.4 },
    ],
    blurb:
      "Nine slots. That's Greg's entire keeper haul — Garrett Wilson at a fourth for 5 and Rome Odunze at a sixth for 4 — in a league where the next-worst pair is 35 and Scott is sitting on 148 of them, 103 of which is the receiver Greg handed back. He paid four rounds over the median receiver price for one and two over for the other, declined Kittle at a fifth and Waddle at a fourth to do it, and holds the fewest early picks in the room. He went rogue with a lawyer and came out holding Rome Odunze.",
  },
  Colin: {
    letter: "A-",
    verdict: "Loudest man, cheapest keepers",
    reason:
      "116 slots saved, second in the league, with Irving at a tenth — three rounds cheaper than the median RB keeper price — and McBride a round under the median tight end price.",
    citations: [
      { label: "Total slots saved", value: 116 },
      { label: "Bucky Irving slots saved", value: 61 },
      { label: "Trey McBride slots saved", value: 55 },
      { label: "Projected points, sixth", value: 475.6 },
    ],
    blurb:
      "Sixty-one slots on Bucky Irving at a tenth, three rounds cheaper than the median running back keeper price in this league, and fifty-five more on McBride at an eighth, a round under the median tight end — 116 slots, second only to a deal nobody voted on, and both prices are ordinary rules applied properly. He declined AJ Brown, Davante Adams and Omarion Hampton at a round-1 apiece and Kamara at a second, every one of them a price at or beyond the dearest anybody here has ever paid, and he was right every time. He'll be unbearable about the 116 and he's earned it.",
  },
};

/** What the run actually cost, printed on the page it paid for. */
const USAGE = { inputTokens: 115_009, outputTokens: 5_549, webSearches: 8, costUsd: 0.714 };

mkdirSync(OUT, { recursive: true });

/** Team ids and the honest subject label for whatever board is on disk. */
function boardFacts() {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      path.join(process.cwd(), "scripts", "draft-loader.mjs"),
      path.join(process.cwd(), "scripts", "recap-board-facts.mts"),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`Could not read the board:\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/*
 * Nothing above this line has written anything. The recap file below is the
 * league's, so the guard takes the lock and vaults it before the first write.
 */
const { putBack } = borrowLiveBoard("recap:grade:shots");

try {
  const facts = boardFacts();
  const idOf = new Map(facts.teams.map((t) => [t.teamName, t.teamId]));

  const missing = Object.keys(RUN).filter((name) => !idOf.has(name));
  if (missing.length) {
    throw new Error(
      `This sample names franchises that are not on the board: ${missing.join(", ")}. ` +
        `The league changed underneath it — regenerate rather than renaming.`,
    );
  }

  const recap = {
    version: 1,
    season: 2026,
    generatedAt: new Date().toISOString(),
    provider: "anthropic",
    model: "claude-opus-5",
    keepersOutOfPool: facts.keepersOutOfPool,
    picksEntered: facts.picksEntered,
    boardFingerprint: facts.boardFingerprint,
    blurbs: Object.entries(RUN).map(([name, g]) => ({
      teamId: idOf.get(name),
      verdict: g.verdict,
      blurb: g.blurb,
      sources: [],
    })),
    grades: {
      subjectLabel: facts.gradeSubjectLabel,
      assigned: Object.entries(RUN).map(([name, g]) => ({
        teamId: idOf.get(name),
        letter: g.letter,
        reason: g.reason,
        citations: g.citations,
      })),
      withheld: null,
    },
    citations: [],
    usage: USAGE,
  };

  writeFileSync(RECAP_FILE, `${JSON.stringify(recap, null, 2)}\n`);
  console.log(
    `\nA real generation over the live board: ${facts.picksEntered} picks, ` +
      `"${facts.gradeSubjectLabel}", ${recap.grades.assigned.length} letters.\n`,
  );

  const browser = await chromium.launch();
  try {
    for (const { label, w, h } of SIZES) {
      const page = await browser.newPage({
        viewport: { width: w, height: h },
        deviceScaleFactor: 2,
        isMobile: label === "phone",
        hasTouch: label === "phone",
      });
      await page.goto(`${BASE}/draft/recap`, { waitUntil: "networkidle" });
      await page.waitForTimeout(700);

      const main = await page.textContent("main");
      check(
        `${label}: all ten letters are on screen, labelled "${facts.gradeSubjectLabel}"`,
        (main.match(new RegExp(facts.gradeSubjectLabel, "g")) ?? []).length === 10,
      );
      check(
        `${label}: and the page is not calling a keeper slate a draft`,
        facts.picksEntered > 0 || !main.includes("Draft grade"),
      );

      const file = path.join(OUT, `recap-grades-${label}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`    → ${path.relative(process.cwd(), file)}`);

      /*
       * THREE CARDS ON THEIR OWN, CROPPED, AND CHOSEN FOR THEIR BANDS. A
       * full-page shot of ten cards is four thousand pixels tall and answers
       * "does the row still line up"; it is useless for "does the letter look
       * like it belongs", which is the only question a person can settle here.
       *
       * Kyle is an A- (the accent), Stefan a C (the neutral the rubric insists
       * is not an insult) and Joe a D (the warning). Those are the three tones
       * with an argument behind them; B and F sit either side of a decision
       * nobody disputes.
       */
      for (const name of ["Kyle", "Stefan", "Joe"]) {
        const card = page
          .locator('main [data-slot="card"]')
          .filter({ has: page.locator("dl") })
          .filter({ hasText: RUN[name].verdict });
        /*
         * Scrolled clear of the sticky masthead first. Playwright brings an
         * element into view before cropping it, which on a phone parks the
         * card's header row directly underneath the fixed header — so the one
         * row this shot exists to show was the one row covered up.
         */
        /*
         * CLIPPED OUT OF THE FULL-PAGE RENDER RATHER THAN CROPPED OFF THE
         * ELEMENT. `locator.screenshot()` scrolls its target to the top of the
         * viewport first, which on a phone parks the card's header row exactly
         * underneath the sticky masthead — and the header row is the one row
         * these shots exist to show. A full-page render paints a sticky header
         * once, at rest, so a clip taken from it is clean.
         */
        const box = await card.first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return {
            x: r.left + window.scrollX,
            y: r.top + window.scrollY,
            width: r.width,
            height: r.height,
          };
        });
        await page.screenshot({
          path: path.join(OUT, `recap-grade-card-${name}-${label}.png`),
          fullPage: true,
          clip: box,
        });
        console.log(`    → screenshots/recap-grade-card-${name}-${label}.png`);
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }
} finally {
  putBack();
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

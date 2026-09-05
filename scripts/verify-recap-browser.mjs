/**
 * Drives the recap tab in a real browser, on a FINISHED board, both with a
 * model key and without one.
 *
 *   BASE=http://127.0.0.1:3210 node scripts/verify-recap-browser.mjs
 *
 * `verify:recap` proves the arithmetic. This proves the thing the arithmetic is
 * wrapped in: that the tab draws, that it draws its numbers with no
 * `ANTHROPIC_API_KEY` present and says so in a sentence rather than a stack
 * trace, that the per-team re-roll control is there, and that a stored recap
 * renders on top of the same numbers.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 *
 * The real `data/draft-state-2026.json` holds keepers and zero picks until
 * Saturday, and a recap of that is ten franchises with nothing to say — which
 * would make this check prove nothing about the screen the league will actually
 * look at. So it runs a seeded mock draft to completion and writes that board
 * over the live state.
 *
 * HOW THAT IS MADE SAFE IS NOT IN THIS FILE. `scripts/live-board-guard.mjs`
 * holds the lock, the on-disk vault, the refusal to run against a board with
 * picks on it, the restore on every exit path and the SHA-256 verification of
 * it — read that before changing anything here.
 *
 * This script used to do its own version, and the version was not good enough:
 * the original was held in memory only, so a `kill -9` took it with the
 * process, and nothing stopped a second harness starting mid-run and "backing
 * up" this one's fixture as though it were the league's board. That is not
 * hypothetical. A concurrent session lost a run to it, reporting POSTDRAFT
 * because a fixture board was installed underneath it. Nothing here touches the
 * database — it forces the file store for its own process only.
 *
 * The recap it renders is a fixture, not a generation. Pressing the real button
 * costs a dollar and takes three minutes, and neither belongs in a check that
 * should be runnable on a whim; `npm run experiment:recap` is where real
 * generations happen. What this asserts is that a stored recap reaches the
 * screen with its receipts attached.
 *
 * Screenshots land in `screenshots/`.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { borrowLiveBoard } from "./live-board-guard.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3210";
const OUT = path.join(process.cwd(), "screenshots");
/** 1080p, because that is what it will be plugged into. */
const VIEWPORT = { width: 1600, height: 1200 };
const LIVE_STATE = path.join(process.cwd(), "data", "draft-state-2026.json");
const RECAP_FILE = path.join(process.cwd(), "data", "draft-recap-2026.json");

mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`    → ${path.relative(process.cwd(), file)}`);
}

// --- Build a finished board, out of process ---------------------------------

/*
 * Nothing above this line has written anything. Everything below it may write
 * over the league's board, so the guard goes here: it refuses outright if the
 * board has picks on it, takes the lock that stops two harnesses interleaving,
 * vaults the originals to disk and wires the restore to every exit path.
 */
const { putBack } = borrowLiveBoard("verify:recap:browser");

try {
  section("Setup — a finished board and a stored recap");
  const { fixture } = await import("./recap-fixture.mjs");
  const { state, recap } = await fixture();
  writeFileSync(LIVE_STATE, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`  wrote a mock board of ${state.picks.length} picks over the live state`);

  /*
   * The board the page is about to be judged on is the one just written, not
   * whatever else may have got there. Cheap, and it is the check whose absence
   * let a concurrent run report the wrong stage as a pass.
   */
  const installed = JSON.parse(readFileSync(LIVE_STATE, "utf8")).picks?.length ?? 0;
  check(
    "the fixture board is the board on disk",
    installed === state.picks.length,
    `wanted ${state.picks.length} picks, found ${installed}`,
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });

  try {
    section("The tab renders with NO recap generated");
    rmSync(RECAP_FILE, { force: true });
    await page.goto(`${BASE}/draft/recap`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const empty = await page.textContent("body");

    check("the page drew", empty.includes("Draft Recap"));
    check(
      "it says no recap has been written yet",
      /No recap has been written yet|cannot be written|ANTHROPIC_API_KEY/.test(empty),
    );
    check("all ten franchises are on screen", countCards(empty) === 10, `${countCards(empty)} found`);
    check(
      "the deterministic receipts are there without a model",
      empty.includes("BEST STEAL") || empty.includes("Best steal"),
    );
    check(
      "the keeper count comes off the board, not a constant",
      /\b19 keepers are out of the pool\b/.test(empty),
      "expected the derived count in the description",
    );
    /*
     * The pick-capital chip is on every card, unlike the rest of the strip, and
     * the league median is what makes it worth printing. Asserted here as well
     * as in `verify:recap` because the arithmetic being right in the dossier and
     * the chip never reaching the card are two different failures, and the
     * second one is invisible from Node.
     */
    const capitalChips = (empty.match(/draftable picks? through R\d+/g) ?? []).length;
    check(
      "every card carries its pick-capital receipt",
      capitalChips === 10,
      `${capitalChips} found`,
    );
    check(
      "…with the league median printed beside it",
      /against a league median of [\d.]+/.test(empty),
    );
    /*
     * The spread has to be on the page as well as in the prompt. A blurb calling
     * the field bunched above a table that reads as a procession is the same
     * failure as a blurb disagreeing with its own steal.
     */
    check(
      "the table says how tight it actually is",
      /project within one win of the median|project within [\d.]+ points of the median/.test(
        empty,
      ) && /typical distance between neighbouring rows/.test(empty),
    );
    await shot(page, "recap-01-no-blurbs");

    section("The tab renders a stored recap with its receipts");
    writeFileSync(RECAP_FILE, `${JSON.stringify(recap, null, 2)}\n`);
    await page.goto(`${BASE}/draft/recap`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const full = await page.textContent("body");

    check("every franchise has a blurb", countBlurbs(full, recap) === recap.blurbs.length);
    // The verdict is uppercased by CSS, so the DOM still holds the original
    // casing. Asserting on the rendered look would test Tailwind, not the app.
    check("the verdict cards print", full.includes(recap.blurbs[0].verdict));
    check(
      "provenance names the model and the cost",
      full.includes(recap.model) && /about \$\d/.test(full),
    );
    /*
     * One action, one name. The page-level button, the per-card control and
     * every sentence that points at either now all say "Run Recap" — the
     * per-card one adding only the scope. This used to look for "Write a new
     * blurb for", which was the third name the same operation had on one
     * screen.
     *
     * Matched on `title$=" only"` rather than on the "Run Recap for" prefix:
     * the masthead button's own title is "Run Recap for all ten franchises",
     * so the prefix finds eleven controls and the count check reads as a bug
     * in the page rather than a bug in the selector.
     */
    const perCard = await page.locator('button[title$=" only"]').count();
    check(
      "every franchise has its own Run Recap control",
      perCard === 10,
      `${perCard} found`,
    );
    const pageLevel = await page.getByRole("button", { name: "Run Recap" }).count();
    check(
      "the masthead action is named Run Recap",
      pageLevel >= 1,
      `${pageLevel} found`,
    );

    /*
     * The grades reach the screen, labelled for what they are and with the
     * receipts that make them checkable. This board is finished, so "Draft
     * grade" is the honest label here and the only place it is.
     */
    /*
     * COUNTED OFF `main`, NOT OFF `body`. Next embeds the RSC flight payload in
     * script tags inside the body, so the stored recap's own `subjectLabel`
     * reads back as an eleventh "Draft grade" that is not on any card. Every
     * check here that counts rather than merely finds has to be scoped, or it
     * is measuring the serialisation rather than the screen.
     */
    const rendered = await page.textContent("main");
    check(
      "every franchise carries a letter, labelled for a finished board",
      (rendered.match(/Draft grade/g) ?? []).length === recap.grades.assigned.length,
      `${(rendered.match(/Draft grade/g) ?? []).length} found`,
    );
    check(
      "the letters are the ones that were stored",
      recap.grades.assigned.every((g) => full.includes(g.reason)),
    );
    check(
      "…and the footer accounts for them rather than staying quiet",
      /\d+ × draft grade/i.test(full) && !/Withheld/.test(full),
    );
    await shot(page, "recap-02-generated");

    /*
     * THE WITHHELD PATH, which is the one nobody would otherwise look at. A
     * blocking flag drops all ten letters, and the failure this check exists
     * for is that the page then looks exactly like a page nobody graded. The
     * cards must be clean — no dash, no hole — and the footer must say what
     * happened, in the checker's own words.
     */
    section("Grades the consistency check refused");
    writeFileSync(
      RECAP_FILE,
      `${JSON.stringify(
        {
          ...recap,
          grades: {
            subjectLabel: recap.grades.subjectLabel,
            assigned: [],
            withheld: {
              returned: 10,
              reasons: [
                "Witte's A+ cites slots saved by keeping = 400, which appears nowhere in this franchise's evidence.",
              ],
            },
          },
        },
        null,
        2,
      )}\n`,
    );
    await page.goto(`${BASE}/draft/recap`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const dropped = await page.textContent("main");

    check("the blurbs are kept — only the letters were dropped", countBlurbs(dropped, recap) === 10);
    check("no card shows a grade", !/Draft grade/.test(dropped));
    check(
      "the footer says they were withheld and how many came back",
      /Withheld — 10 came back/.test(dropped),
    );
    await page.getByText(/why it was withheld/).click();
    await page.waitForTimeout(150);
    check(
      "…and the checker's own words are one click away",
      /appears nowhere in this franchise's evidence/.test(
        await page.textContent("main"),
      ),
    );
    await shot(page, "recap-03-grades-withheld");

    /*
     * A GENERATION THAT LANDS AFTER THE BROWSER STOPS LISTENING.
     *
     * The failure this exists for was reported off the live page: the
     * commissioner re-ran the recap, the projected table moved and the ten
     * verdicts above it did not, so he was reading the previous run's prose over
     * this run's numbers with nothing on screen to say so. Two causes, both
     * fixed together — the page held the recap in `useState(recap)`, which reads
     * the prop once and ignores every later server render, and a request that
     * failed was reported as "the recap was not written" when a whole-board run
     * takes two and a half minutes, keeps going after the socket drops, and had
     * in fact written it. That run cost $1.46.
     *
     * Simulated the way it actually happens: the POST is aborted while the store
     * already holds a NEWER document, which is exactly the state the server is
     * left in when the function finishes alone. The GET is left alone, because
     * reading the store back is the recovery being tested.
     */
    section("A run that finished after the connection dropped");
    writeFileSync(RECAP_FILE, `${JSON.stringify(recap, null, 2)}\n`);
    await page.goto(`${BASE}/draft/recap`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);

    const LANDED = "This blurb only exists in the run the browser never saw.";
    const later = {
      ...recap,
      // Comfortably after the fixture, so the comparison is not a clock race.
      generatedAt: new Date(Date.parse(recap.generatedAt) + 60_000).toISOString(),
      blurbs: recap.blurbs.map((b, i) =>
        i === 0 ? { ...b, blurb: LANDED } : b,
      ),
    };
    writeFileSync(RECAP_FILE, `${JSON.stringify(later, null, 2)}\n`);

    await page.route("**/api/recap", async (route) => {
      if (route.request().method() === "POST") return route.abort("failed");
      return route.fallback();
    });

    const runRecap = page.getByRole("button", { name: "Run Recap" }).first();
    check(
      "the masthead button is live, so the recovery can be exercised",
      await runRecap.isEnabled(),
      "needs ANTHROPIC_API_KEY on the server for the button to be pressable",
    );

    if (await runRecap.isEnabled()) {
      await runRecap.click();
      await page.waitForFunction(
        () => !/Running…/.test(document.querySelector("main")?.textContent ?? ""),
        { timeout: 20_000 },
      );
      await page.waitForTimeout(300);
      const after = await page.textContent("main");

      check(
        "the page does NOT claim the recap was not written",
        !/The recap was not written/.test(after),
      );
      check(
        "it says the connection dropped and the recap finished anyway",
        /The connection dropped, but the recap finished/.test(after),
      );
      check(
        "…and the blurb from the run that landed is the one on screen",
        after.includes(LANDED),
        "still showing the pre-request document",
      );
      await shot(page, "recap-04-recovered-after-drop");
    }

    await page.unroute("**/api/recap");
    /*
     * The abort above is this script's own doing, and the browser logs a failed
     * request for it. Dropped here by exact signature rather than by adding
     * `ERR_FAILED` to the console filter, which would blind that check to every
     * genuinely failed fetch on the page.
     */
    for (let i = problems.length - 1; i >= 0; i--) {
      if (problems[i] === "console: Failed to load resource: net::ERR_FAILED") {
        problems.splice(i, 1);
      }
    }

    /*
     * THE SAME STALENESS WITH NO REQUEST IN HAND, which is the sequence actually
     * reported. He pressed the button, got bored of the two and a half minutes,
     * reloaded — so the page rendered BEFORE the generation landed and had
     * nothing in flight to recover from. Coming back to the tab is what tells
     * it, so that is what is driven here.
     */
    section("A recap written after the page loaded, with nothing in flight");
    writeFileSync(RECAP_FILE, `${JSON.stringify(recap, null, 2)}\n`);
    await page.goto(`${BASE}/draft/recap`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    check(
      "the page starts on the recap it rendered with",
      !(await page.textContent("main")).includes(LANDED),
    );

    // The run lands on the server. Nothing tells the page.
    writeFileSync(RECAP_FILE, `${JSON.stringify(later, null, 2)}\n`);
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(
      (needle) => (document.querySelector("main")?.textContent ?? "").includes(needle),
      LANDED,
      { timeout: 10_000 },
    );
    const returned = await page.textContent("main");
    check("coming back to the tab picks up the newer recap", returned.includes(LANDED));
    check(
      "…and says so rather than swapping the prose silently",
      /A newer recap was written after this page loaded/.test(returned),
    );
    await shot(page, "recap-05-newer-on-return");

    section("Console health");
    // The HMR socket is the dev server talking to itself and is absent in the
    // build this actually ships as. Everything else counts.
    const real = problems.filter((p) => !p.includes("webpack-hmr"));
    check("no page errors", real.length === 0, real.slice(0, 2).join(" | "));
  } finally {
    await browser.close();
  }
} finally {
  section("The live draft board is back exactly as it was");
  // `putBack` verifies by SHA-256 and prints the recovery command if it cannot.
  // It is also wired to `exit` and to the signals, so this is the tidy path
  // rather than the only one.
  check("every borrowed file is byte-identical to what was borrowed", putBack());
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

/** Franchise cards carry the manager's full name after a middot. */
function countCards(body) {
  return (body.match(/·\s+(Zach|Kyle|Joe|Josh|Scott|Stefan|Greg|Colin)\s/g) ?? []).length;
}

function countBlurbs(body, recap) {
  return recap.blurbs.filter((b) => body.includes(b.blurb.slice(0, 40))).length;
}

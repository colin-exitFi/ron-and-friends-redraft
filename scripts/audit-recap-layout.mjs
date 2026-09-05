/**
 * Looks at the recap tab, at the three board states it really has, on the three
 * screens it is really read on — and measures whether anything is clipped.
 *
 *   npm run audit:recap:layout                  # against http://127.0.0.1:3000
 *   BASE=http://127.0.0.1:3210 npm run audit:recap:layout
 *
 * ============================================================================
 * WHY THIS EXISTS
 * ============================================================================
 *
 * The tab was written, reviewed and shipped without anybody ever loading it.
 * It looked plausible in the source and read as broken on a screen: ten cards
 * announcing in red that every franchise was unable to field a lineup, a bare
 * "0" beside a meaningless "#1 of 10", and a sentence — "no QB at all; the
 * league starts 1" — that the commissioner reasonably read as text that had
 * been cut off. `verify:recap` proves the arithmetic and `verify:recap:browser`
 * proves the page draws. Neither could have caught any of that, because neither
 * looks at the layout.
 *
 * So this one measures the layout, and it writes the PNGs a person then has to
 * actually look at. The measurements are the half that can be automated:
 *
 *   1. HORIZONTAL PAGE OVERFLOW — the document wider than the viewport.
 *   2. TRUNCATION — a text node ellipsised by `truncate`.
 *   3. CLIPPING — a text node taller than the box it is in, but only where an
 *      ancestor actually has `overflow: hidden`. Without that second test this
 *      reports every `leading-none` heading in the app, which overflows its
 *      line box by a couple of pixels and is visible anyway.
 *   4. OFF-CANVAS — an element whose right edge is past the viewport.
 *
 * ============================================================================
 * THE THREE STATES, AND WHY THE MIDDLE ONE IS NOT OPTIONAL
 * ============================================================================
 *
 *   before    the live board: keepers only, not a pick entered, no recap
 *             written. This is what the tab shows for eleven months of the
 *             year and it is the state that was never once looked at.
 *   written   the live board with a recap already sitting on top of it. A
 *             real state — the commissioner pressed the button early to see
 *             whether it worked — and the one production was in when this pass
 *             was asked for. Prose about a draft, above numbers from a board
 *             with nothing on it.
 *   complete  the fixture board, drafted out to the last slot, with a recap of
 *             it. The board the page was designed for, and the only one where
 *             the steal, the reach and the value column exist.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 *
 * `complete` needs a finished board, so it writes a seeded mock over
 * `data/draft-state-2026.json`. Everything about doing that safely — the lock,
 * the on-disk vault, the refusal to touch a board that has picks on it, the
 * restore on every exit path and the SHA-256 verification of it — lives in
 * `scripts/live-board-guard.mjs`, which is worth reading before changing
 * anything here. Nothing in this file touches the database.
 *
 * IT ALSO CHECKS IT IS LOOKING AT THE BOARD IT INSTALLED. A harness that writes
 * a fixture and then screenshots whatever the server felt like serving is worse
 * than no harness, because it reports green. Every state declares the pick
 * count it expects and a sentence only that state's page can contain, and both
 * are asserted at every viewport before a single measurement is trusted. A
 * concurrent session lost a run to exactly this: it reported POSTDRAFT because
 * another process had a fixture board installed underneath it.
 *
 * The recaps are FIXTURES. Pressing the real button costs about a dollar and
 * takes three minutes, and neither belongs in a check anybody should be able to
 * run on a whim.
 */
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { borrowLiveBoard } from "./live-board-guard.mjs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = path.join(process.cwd(), "screenshots");
const LIVE_STATE = path.join(process.cwd(), "data", "draft-state-2026.json");
const RECAP_FILE = path.join(process.cwd(), "data", "draft-recap-2026.json");

/**
 * 1440 is the commissioner's window, 1280 the smallest laptop anybody in this
 * league opens it on, 390 an iPhone. The board has its own TV-sized audit; this
 * page is read sitting down.
 */
const SIZES = [
  { label: "desktop", w: 1440, h: 900 },
  { label: "laptop", w: 1280, h: 800 },
  { label: "phone", w: 390, h: 844 },
];

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

/** Picks sitting in the live state file this instant. */
function picksOnDisk() {
  if (!existsSync(LIVE_STATE)) return 0;
  return JSON.parse(readFileSync(LIVE_STATE, "utf8")).picks?.length ?? 0;
}

/** Facts about whatever board is in `data/` right now. */
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
  if (result.status !== 0) {
    throw new Error(`Could not read the board:\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

/**
 * The fixture recap's prose, re-pointed at the board that is actually on disk.
 *
 * A recap document carries the pick count and fingerprint of the board it was
 * written against, and the page compares both against the live board to decide
 * whether to shout. Copying the fixture's numbers across verbatim would put a
 * staleness banner on every shot; taking the live board's makes the document
 * honest about the board it is being shown next to.
 */
function recapForCurrentBoard(fixtureRecap) {
  const facts = boardFacts();
  return {
    ...fixtureRecap,
    picksEntered: facts.picksEntered,
    keepersOutOfPool: facts.keepersOutOfPool,
    boardFingerprint: facts.boardFingerprint,
    /*
     * The letters' subject travels with the board for exactly the reason the
     * pick count does. This same fixture is shown over a finished draft and
     * over a board with nothing on it, and a card reading "Draft grade" above
     * "Nothing has been drafted yet" is the claim the label exists to prevent —
     * screenshotted, in the harness that exists to catch it.
     */
    ...(fixtureRecap.grades
      ? {
          grades: { ...fixtureRecap.grades, subjectLabel: facts.gradeSubjectLabel },
        }
      : {}),
  };
}

/**
 * What is clipped, truncated or off the canvas, measured rather than eyeballed.
 *
 * `sr-only` is deliberately clipped to a 1px box for screen readers, so it
 * reports as both truncated and clipped and is neither. Counting it made an
 * earlier run of the board's audit claim truncation on a board that had none.
 */
const measure = (page) =>
  page.evaluate(() => {
    const isRealText = (el) => {
      const text = (el.textContent ?? "").trim();
      if (!text || el.children.length > 0) return false;
      if (el.closest(".sr-only") || el.classList.contains("sr-only")) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none";
    };

    /*
     * A box taller than its contents only CLIPS if something above it hides
     * the overflow. `leading-none` headings overflow their line box by a
     * couple of pixels everywhere in this app and are perfectly visible.
     */
    const isActuallyClipped = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (s.overflowY === "hidden" || s.overflowY === "clip") return true;
      }
      return false;
    };

    const truncated = [];
    const clipped = [];
    const offscreen = [];
    const vw = document.documentElement.clientWidth;

    document.querySelectorAll("main *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1) {
        offscreen.push({
          text: (el.textContent ?? "").trim().slice(0, 34),
          by: Math.round(r.right - vw),
        });
      }
      if (!isRealText(el)) return;
      const text = (el.textContent ?? "").trim();
      if (el.scrollWidth > el.clientWidth + 1) {
        truncated.push({ text: text.slice(0, 44), by: el.scrollWidth - el.clientWidth });
      }
      if (el.scrollHeight > el.clientHeight + 1 && isActuallyClipped(el)) {
        clipped.push({ text: text.slice(0, 44), by: el.scrollHeight - el.clientHeight });
      }
    });

    /*
     * TRAILING SLACK, which is the thing that actually made a row of cards look
     * accidental.
     *
     * Grid items already stretch, so paired cards were the same height before
     * any of this; what differed was where each card's CONTENT stopped. A short
     * blurb left forty pixels of nothing under the receipt box while its
     * neighbour ran to the edge, so one card read as finished and the other as
     * abandoned. Aligning the box TOPS is the wrong target — two cards with
     * different numbers of receipt rows cannot have both, and the row count is
     * real information. What must be constant is the gap between the last thing
     * on a card and the bottom of the card, which is exactly the card's padding
     * when the prose is the element absorbing the slack.
     */
    const slack = [...document.querySelectorAll('main [data-slot="card"]')]
      .filter((card) => card.querySelector("dl"))
      .map((card) => {
        const last = card.lastElementChild;
        if (!last) return null;
        return Math.round(
          card.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
        );
      })
      .filter((n) => n !== null);
    const slackSpread = slack.length ? Math.max(...slack) - Math.min(...slack) : 0;

    return {
      pageOverflow: Math.round(
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
      truncated: truncated.slice(0, 8),
      truncatedCount: truncated.length,
      clipped: clipped.slice(0, 8),
      clippedCount: clipped.length,
      offscreen: offscreen.slice(0, 6),
      offscreenCount: offscreen.length,
      cards: slack.length,
      slackSpread,
    };
  });

// --- Run --------------------------------------------------------------------

/*
 * Everything after this line may write over the live board. `borrowLiveBoard`
 * refuses outright if there are picks on it, takes the lock, vaults the
 * originals to disk and wires the restore to every exit path — including the
 * signals a bare `finally` never covered.
 */
const { putBack } = borrowLiveBoard("audit:recap:layout");
const originalState = existsSync(LIVE_STATE) ? readFileSync(LIVE_STATE) : null;

try {
  const { fixture } = await import("./recap-fixture.mjs");
  const { state: doneState, recap: fixtureRecap } = await fixture();

  const STATES = [
    {
      name: "before",
      title: "Keepers only, nothing drafted, no recap written",
      /** Picks the board must hold once `apply` has run. */
      picks: 0,
      /** A sentence only this state's page can produce. */
      onlyHere: /Nothing has been drafted yet/,
      apply: () => {
        if (originalState) writeFileSync(LIVE_STATE, originalState);
        rmSync(RECAP_FILE, { force: true });
      },
      expect: (body, main) => [
        ["it says the draft has not happened", /Nothing has been drafted yet/.test(body)],
        ["it says when the recap arrives", /recap is written after the draft/i.test(body)],
        [
          "no franchise is accused of failing to field a lineup",
          !/cannot fill/i.test(body),
        ],
        ["no bare shortage sentence survives", !/the league starts \d+$/m.test(body)],
        ["the projected table is still there", /Projected finish/i.test(body)],
        /*
         * An ungraded recap draws NO grade, not an empty one. A dash or a
         * skeleton in that slot on ten cards would read as ten franchises who
         * scored badly, which is a claim nobody has made.
         */
        ["no grade slot on a recap that has none", !/grade/i.test(main)],
      ],
    },
    {
      name: "written",
      title: "A recap already written over a board with no picks on it",
      picks: 0,
      onlyHere: /Nothing has been drafted yet/,
      apply: () => {
        if (originalState) writeFileSync(LIVE_STATE, originalState);
        writeFileSync(
          RECAP_FILE,
          `${JSON.stringify(recapForCurrentBoard(fixtureRecap), null, 2)}\n`,
        );
      },
      expect: (body, main) => [
        ["the blurbs render", body.includes(fixtureRecap.blurbs[0].blurb.slice(0, 40))],
        ["it still says nothing has been drafted", /Nothing has been drafted yet/.test(body)],
        [
          "no staleness banner, because the recap matches this board",
          !/describe a different board/.test(body),
        ],
        ["no lineup accusation on an undrafted board", !/cannot fill/i.test(body)],
        /*
         * THE CLAIM THIS WHOLE STATE EXISTS TO CATCH, now with a letter on it.
         * Nineteen keepers are in and nobody has picked, so the only decisions
         * on the table are the declarations — and calling that a draft grade
         * asserts a draft that has not happened.
         */
        [
          "the letters call themselves a keeper slate grade",
          (main.match(/Keeper slate grade/g) ?? []).length === 10 &&
            !main.includes("Draft grade"),
        ],
      ],
    },
    {
      name: "complete",
      title: "The board drafted out to the last slot",
      picks: doneState.picks.length,
      onlyHere: /walked in with/i,
      apply: () => {
        writeFileSync(LIVE_STATE, `${JSON.stringify(doneState, null, 2)}\n`);
        writeFileSync(
          RECAP_FILE,
          `${JSON.stringify(recapForCurrentBoard(fixtureRecap), null, 2)}\n`,
        );
      },
      expect: (body, main) => [
        ["the steals are on the cards", /Best steal/i.test(body)],
        ["capital is stated in the past tense", /walked in with/i.test(body)],
        [
          "a full lineup says so rather than saying nothing",
          /a legal starting nine/i.test(body),
        ],
        [
          "every card carries its pick-capital receipt",
          (body.match(/draftable pick s? ?through R\d+|draftable picks? through R\d+/g) ?? [])
            .length === 10,
        ],
        ["…with the league median beside it", /against a league median of [\d.]+/.test(body)],
        [
          "every card carries a letter, and it is a draft grade",
          (main.match(/Draft grade/g) ?? []).length === 10 &&
            !main.includes("Keeper slate grade"),
        ],
      ],
    },
  ];

  const browser = await chromium.launch();
  try {
    for (const state of STATES) {
      section(`${state.name} — ${state.title}`);
      state.apply();

      /*
       * The install landed. Asserted against the file rather than assumed,
       * because everything below is measured against the board this claims to
       * have put there — and a state that quietly failed to install would go
       * on to report a page full of passing checks about the wrong thing.
       */
      const onDisk = picksOnDisk();
      check(
        `the board on disk is the one this state installed`,
        onDisk === state.picks,
        `wanted ${state.picks} picks, found ${onDisk}`,
      );
      if (onDisk !== state.picks) {
        console.log("    skipping this state — measuring it would report nonsense");
        continue;
      }

      for (const { label, w, h } of SIZES) {
        const page = await browser.newPage({
          viewport: { width: w, height: h },
          deviceScaleFactor: 2,
          isMobile: label === "phone",
          hasTouch: label === "phone",
        });
        const problems = [];
        page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
        page.on("console", (m) => {
          if (m.type() === "error" && !m.text().includes("webpack-hmr")) {
            problems.push(`console: ${m.text()}`);
          }
        });

        await page.goto(`${BASE}/draft/recap`, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);

        const m = await measure(page);
        const body = await page.textContent("body");
        /*
         * `main` as well as `body`, because Next embeds the RSC flight payload
         * in script tags inside the body and `textContent` reads them. Anything
         * that COUNTS occurrences rather than merely finding one has to use
         * this, or it is measuring the serialised recap instead of the screen —
         * which is how a stored `subjectLabel` reads back as an eleventh card.
         */
        const main = await page.textContent("main");

        console.log(`\n  ${label} ${w}×${h}`);

        /*
         * THE STAGE CHECK, AND IT COMES FIRST. Everything after it is a
         * measurement of a screenshot, and a measurement of the wrong
         * screenshot is worse than no measurement because it passes. This is
         * the only assertion here that is about what the page IS rather than
         * how it looks, and it is repeated at every viewport rather than once
         * per state: the board can move underneath a run.
         */
        const rightStage = state.onlyHere.test(body);
        check(
          `${label}: the page is rendering the ${state.name} board`,
          rightStage,
          `nothing on the page matched ${state.onlyHere}`,
        );
        if (!rightStage) {
          const file = path.join(OUT, `recap-${state.name}-${label}-WRONG-STAGE.png`);
          await page.screenshot({ path: file, fullPage: true });
          console.log(`    → ${path.relative(process.cwd(), file)} (not overwriting the good shot)`);
          await page.close();
          continue;
        }

        check(`${label}: no horizontal page overflow`, m.pageOverflow === 0, `${m.pageOverflow}px`);
        check(
          `${label}: nothing truncated`,
          m.truncatedCount === 0,
          m.truncated.map((t) => `"${t.text}" (-${t.by}px)`).join(", "),
        );
        check(
          `${label}: nothing clipped`,
          m.clippedCount === 0,
          m.clipped.map((t) => `"${t.text}" (-${t.by}px)`).join(", "),
        );
        check(
          `${label}: nothing past the right edge`,
          m.offscreenCount === 0,
          m.offscreen.map((t) => `"${t.text}" (+${t.by}px)`).join(", "),
        );
        check(`${label}: no page errors`, problems.length === 0, problems.slice(0, 2).join(" | "));

        if (m.cards >= 10) {
          check(
            `${label}: every card's content runs to its own bottom edge`,
            m.slackSpread <= 1,
            `${m.slackSpread}px between the emptiest and the fullest card`,
          );
        }

        if (label === "desktop") {
          for (const [label2, ok] of state.expect(body, main)) check(`  ${label2}`, ok);
        }

        const file = path.join(OUT, `recap-${state.name}-${label}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log(`    → ${path.relative(process.cwd(), file)}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  section("The live draft board is back exactly as it was");
  // `putBack` verifies by SHA-256 and prints the recovery command if it cannot.
  // It is also wired to `exit` and to the signals, so this call is the tidy
  // path rather than the only one.
  check("every borrowed file is byte-identical to what was borrowed", putBack());
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

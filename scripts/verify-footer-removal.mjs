/**
 * Verifies the draft board no longer carries the instruction footer, that the
 * live indicator survived the removal into the header, and that the finished
 * board offers a working download.
 *
 * The footer was the board's only rendering of the keyboard grammar, so the
 * check is not just "is the strip gone" — it also asserts the keys still WORK
 * with nothing on screen telling you about them. A silent regression there is
 * the one way removing a purely-informational strip could actually break the
 * draft.
 *
 * Usage: node scripts/verify-footer-removal.mjs [baseUrl]
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3822";
const SHOTS = "/tmp/ukl-footer-shots";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

try {
  await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  // --- The footer is actually gone -----------------------------------------
  check("no <footer> element on the board", (await page.locator("footer").count()) === 0);

  const body = (await page.locator("body").innerText()).toLowerCase();
  for (const phrase of [
    "undo last",
    "move cursor",
    "delete the pick under the cursor",
    "pick traded to",
    "saved to",
  ]) {
    check(`instruction text gone: "${phrase}"`, !body.includes(phrase));
  }

  // --- The status that was NOT an instruction survived ----------------------
  /*
   * The board's own header, not the app shell's mobile nav bar, which is also a
   * <header> and is first in the DOM.
   */
  const header = page
    .locator("header")
    .filter({ hasText: /ON THE CLOCK|OUT OF ORDER|SELECTED|THAT'S THE DRAFT/ })
    .first();
  check("found the board header", (await header.count()) > 0);

  const headerText = (await header.innerText()).toLowerCase();

  /*
   * The live dot only renders when saves are shared, so on a file-store run its
   * absence is correct rather than a regression. Ask the server which it is
   * before deciding what to assert.
   */
  const shared = await page.evaluate(async () => {
    try {
      const r = await fetch("/api/draft/state");
      const j = await r.json();
      return j?.sharedSaves ?? null;
    } catch {
      return null;
    }
  });

  if (shared === true) {
    check(
      "live status moved into the header",
      /live|connecting|syncing/.test(headerText),
      headerText.replace(/\s+/g, " ").slice(0, 80),
    );
  } else {
    console.log(
      `SKIP  live status in header — saves are not shared here (sharedSaves=${shared}), so the dot is correctly absent`,
    );
  }

  // --- The keys still work with nothing on screen documenting them ---------
  const clockOf = async () =>
    (await header.innerText()).match(/Pick\s+(\d+\.\d+)/)?.[1] ?? null;

  const before = await clockOf();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  const after = await clockOf();
  check(
    "ArrowRight still moves the cursor",
    Boolean(before && after && before !== after),
    `${before} -> ${after}`,
  );

  await page.keyboard.type("just");
  await page.waitForTimeout(500);
  check(
    "typing still opens the matcher",
    (await page.locator("body").innerText()).toLowerCase().includes("just"),
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // --- Cells got the reclaimed height --------------------------------------
  /*
   * Find whatever is ACTUALLY scrolling rather than assuming it is <main>. An
   * earlier version of this measured main's own box and reported a comfortable
   * fit at 1366x768 while the screenshot plainly showed round 13 sliced off —
   * a check that passes when the thing it is checking is broken is worse than
   * no check.
   */
  const fit = async () =>
    page.evaluate(() => {
      let worst = null;
      document.querySelectorAll("*").forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 100) {
          const over = el.scrollHeight - el.clientHeight;
          if (!worst || over > worst.over) {
            worst = { over, client: el.clientHeight, scroll: el.scrollHeight };
          }
        }
      });
      /* A round, found through a cell rather than by a utility class the rows
         have already changed once. */
      const row = document.querySelector("[data-slot-id]")?.parentElement?.parentElement;
      return { worst, row: row ? Math.round(row.getBoundingClientRect().height) : null };
    });

  /*
   * THE ONE-SCREEN FIT IS NO LONGER THE BAR, so both sizes below are reported
   * rather than asserted. This used to fail if the board scrolled at 1080p, on
   * the reasoning that the room reads the whole draft in one look. Two rulings
   * retired that: the cells have to show everything they hold with nothing
   * truncated, clipped or covered, which costs more height than sixteen rounds
   * of 1080p have — and the draft turns out to run on a floor-to-ceiling
   * projector whose bottom edge cannot be read from a seat in any case. TV mode
   * is getting its own following scroll instead.
   *
   * What carries the claim about the cells now is
   * `scripts/verify-board-fit.mjs`: nothing in them is cut, nothing is covered,
   * and all 160 are the same shape.
   */
  const at1080 = await fit();
  console.log(
    `      projector 1920x1080: ${
      at1080.worst ? `scrolls, ${at1080.worst.over}px below the fold` : "fits"
    }, row ${at1080.row}px`,
  );
  await page.screenshot({ path: `${SHOTS}/draft-1080p.png` });

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(700);
  const atLaptop = await fit();
  console.log(
    `      laptop 1366x768: ${
      atLaptop.worst ? `scrolls, ${atLaptop.worst.over}px below the fold` : "fits"
    }, row ${atLaptop.row}px`,
  );
  await page.screenshot({ path: `${SHOTS}/draft-laptop.png` });

  // --- The finished board's download ---------------------------------------
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${BASE}/draft/final`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  const dl = page.locator('a[href*="/api/draft/export"]').first();
  check("download link present on the finished board", (await dl.count()) > 0);
  if ((await dl.count()) > 0) {
    check(
      "download link is labelled, not a bare icon",
      (await dl.innerText()).trim().toLowerCase().includes("download"),
      `"${(await dl.innerText()).trim()}"`,
    );

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 20_000 }).catch(() => null),
      dl.click(),
    ]);
    check(
      "clicking it downloads a CSV",
      Boolean(download && download.suggestedFilename().endsWith(".csv")),
      download ? download.suggestedFilename() : "no download event",
    );
  }

  /*
   * The finished board keeps a footer, but only as a colour key for the reach
   * and steal rings, and only when a ring is actually on the board. What must
   * be gone is the instructional half of it.
   */
  const finalBody = (await page.locator("body").innerText()).toLowerCase();
  for (const phrase of ["is the round he went in", "not whose pick it was"]) {
    check(`finished board: instruction gone — "${phrase}"`, !finalBody.includes(phrase));
  }

  /*
   * Scoped to the footer, not the page: "keeper" legitimately appears in the
   * header's count and on the cells themselves. What had to go is the padlock
   * legend that used to sit in the footer.
   */
  const finalFooters = await page.locator("footer").count();
  const footerText =
    finalFooters > 0 ? (await page.locator("footer").first().innerText()).toLowerCase() : "";
  check("finished board: no padlock legend in the footer", !footerText.includes("keeper"));

  const hasRings = finalBody.includes("reach vs expected");
  check(
    "finished board footer is present only as a colour key",
    finalFooters === 0 || hasRings,
    `${finalFooters} footer(s), rings ${hasRings ? "shown" : "absent"}`,
  );
  await page.screenshot({ path: `${SHOTS}/final-1080p.png` });
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => f.name).join(", ")}`);
  process.exitCode = 1;
}

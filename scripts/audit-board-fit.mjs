/**
 * Measures whether the draft board actually fits, at the resolutions the board
 * is really viewed on, and reports the three separate ways it can fail to.
 *
 * "It fits" is three claims, not one, and they fail independently:
 *
 *   1. NO SCROLL — the grid's own scroll container does not overflow.
 *   2. NO TRUNCATION — no text is cut off with an ellipsis by `truncate`.
 *   3. NO CLIPPING — no text is silently cut by a fixed-height box.
 *
 * A board can pass 1 and fail 2, which is what "close, but not perfect" tends
 * to mean in practice: everything is on screen but the long names are chopped.
 *
 * Fullscreen (TV mode) is what these numbers assume. The viewport IS the screen
 * there, which is why the sizes below are screen sizes with no chrome deducted.
 *
 * Usage: node scripts/audit-board-fit.mjs [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3824";

/*
 * MacBook Air logical resolutions come from the display scaling picker, not
 * from the panel: a 13" M2/M3 Air is 2560x1664 native but hands CSS 1470x956
 * by default and 1710x1112 on "More Space", which is where someone who "goes
 * for the highest res" lands. Note the aspect ratio is about 1.54 — TALLER
 * than 16:9, so these have more vertical room per pixel of width than the TV.
 */
const SIZES = [
  { label: "1080p TV (the room)", w: 1920, h: 1080 },
  { label: 'Air 13" More Space', w: 1710, h: 1112 },
  { label: 'Air 13" default', w: 1470, h: 956 },
  { label: 'Air 15" More Space', w: 1800, h: 1169 },
  { label: "16:9 laptop 1366x768", w: 1366, h: 768 },
  { label: "1440x900 (16:10)", w: 1440, h: 900 },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const measure = () =>
  page.evaluate(() => {
    const round = (n) => Math.round(n);

    // 1. Whatever is actually scrolling.
    let scroller = null;
    document.querySelectorAll("*").forEach((el) => {
      if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 100) {
        const over = el.scrollHeight - el.clientHeight;
        if (!scroller || over > scroller.over) scroller = { over, client: el.clientHeight };
      }
    });

    /*
     * 2. Truncation. `truncate` sets overflow:hidden + text-overflow:ellipsis,
     * so the tell is scrollWidth exceeding clientWidth on the element carrying
     * it. Only elements with actual text are counted.
     */
    /*
     * `sr-only` is deliberately clipped to a 1px box for screen readers, so it
     * reports as both truncated and clipped and is neither. Counting it made an
     * earlier run of this audit claim truncation on a board that had none.
     */
    const isRealText = (el) => {
      const text = (el.textContent ?? "").trim();
      if (!text || el.children.length > 0) return false;
      if (el.closest(".sr-only") || el.classList.contains("sr-only")) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none";
    };

    const truncated = [];
    const clipped = [];
    document.querySelectorAll("main *").forEach((el) => {
      if (!isRealText(el)) return;
      const text = (el.textContent ?? "").trim();
      if (el.scrollWidth > el.clientWidth + 1) {
        truncated.push({ text: text.slice(0, 28), by: el.scrollWidth - el.clientWidth });
      }
      if (el.scrollHeight > el.clientHeight + 1) {
        clipped.push({ text: text.slice(0, 28), by: el.scrollHeight - el.clientHeight });
      }
    });

    // Row height and the font size of a player name, for readability.
    const row = document.querySelector('[class*="basis-0"]');
    const nameEl = [...document.querySelectorAll("main *")].find(
      (el) => isRealText(el) && /^[A-Z]\.\s|[a-z]{3,}\s[A-Z]/.test(el.textContent ?? ""),
    );

    return {
      scroller,
      truncated: truncated.slice(0, 6),
      truncatedCount: truncated.length,
      clipped: clipped.slice(0, 4),
      clippedCount: clipped.length,
      row: row ? round(row.getBoundingClientRect().height) : null,
      nameFont: nameEl ? getComputedStyle(nameEl).fontSize : null,
      nameSample: nameEl ? (nameEl.textContent ?? "").trim().slice(0, 20) : null,
    };
  });

for (const { label, w, h } of SIZES) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(650);
  const m = await measure();

  const verdict = [
    m.scroller ? `SCROLLS by ${m.scroller.over}px` : "no scroll",
    m.truncatedCount ? `${m.truncatedCount} truncated` : "no truncation",
    m.clippedCount ? `${m.clippedCount} clipped` : "no clipping",
  ].join(" · ");

  console.log(`\n${label}  ${w}x${h}  (ratio ${(w / h).toFixed(2)})`);
  console.log(`   ${verdict}`);
  console.log(`   row ${m.row}px · name font ${m.nameFont} ${m.nameSample ? `("${m.nameSample}")` : ""}`);
  if (m.truncated.length) {
    console.log(
      `   truncated e.g. ${m.truncated.map((t) => `"${t.text}" (-${t.by}px)`).join(", ")}`,
    );
  }
  if (m.clipped.length) {
    console.log(`   clipped e.g. ${m.clipped.map((t) => `"${t.text}" (-${t.by}px)`).join(", ")}`);
  }
}

await browser.close();

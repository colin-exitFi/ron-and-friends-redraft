/**
 * How big is the text ACTUALLY going to be in the room?
 *
 * The draft is run on a 1080p projector onto a golf-simulator screen. That
 * makes readability a physics question with a real answer, not a matter of
 * taste: at 1920px across a screen W inches wide, one CSS pixel is W/1920
 * inches, and a viewer D inches away sees a glyph of height h subtend
 * (h/D) radians. Converted to arcminutes that is directly comparable to the
 * limits of human vision:
 *
 *   ~5 arcmin   the acuity limit — 20/20 vision resolves a letter this big
 *   ~10 arcmin  readable, but working at it
 *   ~16 arcmin  comfortable for sustained reading
 *   ~20+ arcmin easy across a room
 *
 * Cap height, not font size, is what the eye has to resolve, and for this
 * typeface it is roughly 0.7 of the font size. The numbers below report cap
 * height for that reason; using font size would flatter the result by 40%.
 *
 * Usage: node scripts/audit-board-readability.mjs [baseUrl]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3824";

/** Projector is 1080p, so the board is always 1920 CSS px across the screen. */
const H_PIXELS = 1920;
const CAP_RATIO = 0.7;

/* Golf-sim impact screens run about 8 to 16 feet wide; viewers sit close. */
const SCREENS = [
  { label: "10 ft wide", inches: 120 },
  { label: "12 ft wide", inches: 144 },
  { label: "14 ft wide", inches: 168 },
];
const DISTANCES = [
  { label: "8 ft", inches: 96 },
  { label: "12 ft", inches: 144 },
  { label: "15 ft", inches: 180 },
];

const arcmin = (heightInches, distanceInches) =>
  (heightInches / distanceInches) * (180 / Math.PI) * 60;

const verdict = (a) =>
  a >= 20 ? "easy" : a >= 16 ? "comfortable" : a >= 10 ? "readable" : a >= 5 ? "straining" : "TOO SMALL";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

/*
 * Group every piece of visible text on the board by its computed font size, and
 * keep an example of each so the sizes can be named rather than just listed.
 */
const groups = await page.evaluate(() => {
  const out = new Map();
  const board = document.querySelector("main");
  if (!board) return [];

  board.querySelectorAll("*").forEach((el) => {
    const text = (el.textContent ?? "").trim();
    if (!text || el.children.length > 0) return;
    if (el.closest(".sr-only")) return;
    const s = getComputedStyle(el);
    if (s.visibility === "hidden" || s.display === "none") return;
    const size = Math.round(parseFloat(s.fontSize) * 100) / 100;
    const entry = out.get(size) ?? { size, count: 0, samples: [], weight: s.fontWeight };
    entry.count += 1;
    if (entry.samples.length < 3 && text.length < 22) entry.samples.push(text);
    out.set(size, entry);
  });

  return [...out.values()].sort((a, b) => b.size - a.size);
});

console.log(`Board text at 1920x1080, ${groups.length} distinct sizes\n`);

for (const g of groups) {
  console.log(
    `${String(g.size).padStart(6)}px  weight ${g.weight}  x${String(g.count).padEnd(4)} e.g. ${g.samples
      .map((s) => `"${s}"`)
      .join(", ")}`,
  );
}

console.log(`\n\nPhysical cap height on the projector, and how it reads:\n`);

for (const screen of SCREENS) {
  const inchPerPx = screen.inches / H_PIXELS;
  console.log(`--- ${screen.label} screen (1 px = ${inchPerPx.toFixed(4)}") ---`);
  for (const g of groups) {
    const cap = g.size * CAP_RATIO * inchPerPx;
    const reads = DISTANCES.map((d) => {
      const a = arcmin(cap, d.inches);
      return `${d.label}: ${a.toFixed(0)}' ${verdict(a)}`;
    }).join("  |  ");
    console.log(
      `  ${String(g.size).padStart(6)}px  cap ${cap.toFixed(2)}"  ${reads}   ${g.samples[0] ? `(${g.samples[0]})` : ""}`,
    );
  }
  console.log("");
}

await browser.close();

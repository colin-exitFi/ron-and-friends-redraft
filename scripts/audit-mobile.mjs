/**
 * Measures whether the app is usable on a phone, and screenshots it.
 *
 *   node scripts/audit-mobile.mjs [baseUrl] [--only=/draft,/mock] [--tag=after]
 *
 * The league is about to be emailed the link, and most of them will open it in
 * a phone mail client. The reference handset is a Galaxy S25 Ultra — 412x915
 * portrait, 915x412 landscape — with a smaller phone and an SE-sized one
 * checked alongside so nothing is tuned to one width.
 *
 * Four failures are measured separately, because they fail independently and a
 * page can pass three of them:
 *
 *   1. SIDEWAYS SCROLL — the page body is wider than the viewport. Fatal: it
 *      means the whole app slides under the thumb.
 *   2. HEADER SHARE — how much of the viewport's height is gone before any
 *      content. On a 915px-tall phone this is the whole complaint.
 *   3. TAP TARGETS — interactive things under 44px in their smaller dimension.
 *   4. TRUNCATION — text clipped to an ellipsis, which on the board means a
 *      player's name the room cannot read.
 *
 * Desktop and the 1080p projector are measured by the same script on purpose:
 * every number here is a regression check for them as much as a target for the
 * phone.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3401";
const TAG = args.find((a) => a.startsWith("--tag="))?.slice(6) ?? "now";
const ONLY = args.find((a) => a.startsWith("--only="))?.slice(7)?.split(",");

const OUT = path.join(process.cwd(), "screenshots", "mobile", TAG);
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { key: "s25u-portrait", w: 412, h: 915, touch: true },
  { key: "s25u-landscape", w: 915, h: 412, touch: true },
  { key: "phone-390", w: 390, h: 844, touch: true },
  { key: "se-375", w: 375, h: 667, touch: true },
  { key: "desktop-1440", w: 1440, h: 900, touch: false },
  { key: "projector-1080p", w: 1920, h: 1080, touch: false },
];

const ROUTES = [
  "/",
  "/draft",
  "/mock",
  "/draft/final",
  "/keepers",
  "/rosters",
  "/teams",
  "/players",
  "/trades",
  "/trades/new",
  "/trades/ledger",
  "/governance",
  "/scoring",
  "/calendar",
  "/checklist",
];

const routes = ONLY ?? ROUTES;
const SIZE_ONLY = args.find((a) => a.startsWith("--sizes="))?.slice(8)?.split(",");
const sizes = SIZE_ONLY ? SIZES.filter((s) => SIZE_ONLY.includes(s.key)) : SIZES;

/**
 * Everything the audit asks of a rendered page, in one pass in the browser.
 *
 * The header measurement takes the TALLEST of the app shell's mobile bar, a
 * `PageHeader` band, or a board surface's own bar, because the three surfaces
 * do not share one element — what matters is how far down the page the first
 * content sits, whichever chrome put it there.
 */
const measure = () =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    /*
     * Only the chrome a thumb can actually see. The draft board, the mock and
     * the final board all render as a `fixed inset-0` overlay OVER the app
     * shell, so the shell's own mobile bar is still in the DOM, still "visible"
     * by every style check, and covers nothing — counting it credited those
     * three pages with 56px of chrome that is not on the screen.
     */
    const onTop = (el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(
        Math.min(vw - 2, Math.max(2, r.left + r.width / 2)),
        Math.min(vh - 2, Math.max(2, r.top + r.height / 2)),
      );
      return hit ? el.contains(hit) || hit.contains(el) : false;
    };

    const headers = [...document.querySelectorAll("header")].filter(
      (el) => visible(el) && onTop(el),
    );
    const headerHeight = headers.reduce(
      (max, el) => Math.max(max, Math.round(el.getBoundingClientRect().height)),
      0,
    );
    /* Everything above the first pixel of real content, chrome included. */
    const chromeHeight = headers.reduce((sum, el) => {
      const r = el.getBoundingClientRect();
      return r.top < vh ? sum + Math.round(r.height) : sum;
    }, 0);

    const tiny = [];
    document
      .querySelectorAll("button, a[href], [role=button], summary, input, select")
      .forEach((el) => {
        // Covered controls are not small, they are unreachable, and counting
        // them buried the ones a thumb can actually land on.
        if (!visible(el) || !onTop(el)) return;
        const r = el.getBoundingClientRect();
        if (r.top > vh || r.bottom < 0) return;
        const small = Math.min(Math.round(r.width), Math.round(r.height));
        if (small < 44) {
          tiny.push({
            small,
            what: (el.getAttribute("aria-label") ?? el.textContent ?? "")
              .trim()
              .slice(0, 24),
          });
        }
      });

    const truncated = [];
    document.querySelectorAll("body *").forEach((el) => {
      if (el.children.length > 0) return;
      const text = (el.textContent ?? "").trim();
      if (!text || el.closest(".sr-only")) return;
      if (!visible(el)) return;
      if (el.scrollWidth > el.clientWidth + 1) {
        truncated.push(text.slice(0, 24));
      }
    });

    return {
      overflow: Math.max(0, doc.scrollWidth - vw, document.body.scrollWidth - vw),
      headerHeight,
      chromeHeight,
      chromeShare: Math.round((chromeHeight / vh) * 100),
      tiny: tiny.slice(0, 6),
      tinyCount: tiny.length,
      truncated: [...new Set(truncated)].slice(0, 6),
      truncatedCount: truncated.length,
    };
  });

const browser = await chromium.launch();
let page;
let problems = 0;

for (const size of sizes) {
  console.log(
    `\n${"═".repeat(64)}\n${size.key}  ${size.w}x${size.h}\n${"═".repeat(64)}`,
  );
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    isMobile: size.touch,
    hasTouch: size.touch,
    ...(size.touch ? { userAgent: devices["Galaxy S9+"].userAgent } : {}),
  });
  page = await context.newPage();

  for (const route of routes) {
    try {
      await page.goto(`${BASE}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      await page.waitForTimeout(1100);
    } catch (err) {
      console.log(`  ${route.padEnd(16)} FAILED TO LOAD — ${err.message.slice(0, 60)}`);
      problems++;
      continue;
    }

    const m = await measure();
    const name = route === "/" ? "home" : route.slice(1).replace(/\//g, "-");
    await page.screenshot({
      path: path.join(OUT, `${name}--${size.key}.png`),
    });

    const flags = [];
    if (m.overflow > 0) {
      flags.push(`SIDEWAYS +${m.overflow}px`);
      problems++;
    }
    if (m.truncatedCount) flags.push(`${m.truncatedCount} truncated`);
    if (size.touch && m.tinyCount) flags.push(`${m.tinyCount} taps <44px`);

    console.log(
      `  ${route.padEnd(16)} chrome ${String(m.chromeHeight).padStart(4)}px ` +
        `(${String(m.chromeShare).padStart(2)}% of height)  ${flags.join(" · ") || "clean"}`,
    );
    if (m.truncated.length) {
      console.log(`      truncated: ${m.truncated.map((t) => `"${t}"`).join(", ")}`);
    }
    if (size.touch && m.tiny.length) {
      console.log(
        `      small taps: ${m.tiny.map((t) => `${t.small}px "${t.what}"`).join(", ")}`,
      );
    }
  }

  await context.close();
}

await browser.close();
console.log(`\nScreenshots → ${path.relative(process.cwd(), OUT)}`);
console.log(problems === 0 ? "No page overflows sideways." : `${problems} overflow/load problems.`);
process.exit(problems === 0 ? 0 : 1);

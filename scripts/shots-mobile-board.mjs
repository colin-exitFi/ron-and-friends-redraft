/**
 * Screenshots the three board surfaces on a phone, in both orientations, in
 * the state a league member will actually meet them in.
 *
 *   node scripts/shots-mobile-board.mjs [baseUrl] [tag]
 *
 * `audit-mobile.mjs` measures every route, and it cannot reach two of the
 * things this pass had to fix. The mock opens on its setup screen, so the mock
 * BOARD is only reached by starting one; and the traded-pick cell — the
 * complaint that started all of this — is only worth looking at with the roster
 * drawer open beside it. So this drives the pages rather than just loading
 * them, and it screenshots the specific cells and panels that were broken.
 *
 * Desktop and the 1080p projector are shot from the same script, because "no
 * regression on the big screen" is a claim that should be looked at, not
 * asserted.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3401";
const TAG = process.argv[3] ?? "after";
const OUT = path.join(process.cwd(), "screenshots", "mobile", TAG);
mkdirSync(OUT, { recursive: true });

const PHONES = [
  { key: "s25u-portrait", w: 412, h: 915 },
  { key: "s25u-landscape", w: 915, h: 412 },
];
const DESKS = [
  { key: "desktop-1440", w: 1440, h: 900 },
  { key: "projector-1080p", w: 1920, h: 1080 },
];

const browser = await chromium.launch();

async function open(size, touch) {
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 1,
    isMobile: touch,
    hasTouch: touch,
    ...(touch ? { userAgent: devices["Galaxy S9+"].userAgent } : {}),
  });
  return { context, page: await context.newPage() };
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  → ${path.relative(process.cwd(), file)}`);
}

/** Starts a fresh mock and gets to the running board. */
async function startMock(page) {
  await page.goto(`${BASE}/mock`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const start = page.locator("button", { hasText: /Start mock|Resume mock/ }).first();
  if ((await start.count()) === 0) return false;
  await start.click();
  await page.waitForTimeout(2500);
  return true;
}

/** The board cell holding a traded pick, measured rather than eyeballed. */
async function tradedCell(page) {
  return page.evaluate(() => {
    const cell = [...document.querySelectorAll("[data-slot-id]")].find((el) => {
      const title = el.getAttribute("title") ?? "";
      return /'s pick, now /.test(title) && / · /.test(title);
    });
    if (!cell) return null;
    /* The name line is the one element carrying `truncate` and a real name. */
    const name = [...cell.querySelectorAll("span")].find(
      (s) => s.children.length === 0 && /[a-z]{3}/.test(s.textContent ?? ""),
    );
    const box = cell.getBoundingClientRect();
    const strip = cell.lastElementChild?.getBoundingClientRect();
    return {
      title: cell.getAttribute("title")?.slice(0, 70),
      cell: { w: Math.round(box.width), h: Math.round(box.height) },
      stripShare: strip ? Math.round((strip.height / box.height) * 100) : null,
      name: name?.textContent ?? null,
      nameFont: name ? getComputedStyle(name).fontSize : null,
      nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : null,
      overflows: cell.scrollHeight > cell.clientHeight + 1,
    };
  });
}

for (const size of [...PHONES, ...DESKS]) {
  const touch = PHONES.includes(size);
  console.log(`\n${size.key}  ${size.w}x${size.h}`);
  const { context, page } = await open(size, touch);

  await page.goto(`${BASE}/draft`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  await shot(page, `board--${size.key}`);

  const traded = await tradedCell(page);
  console.log(`  traded cell: ${JSON.stringify(traded)}`);

  /* The roster, which a phone could not reach at all before this. */
  const drawer = page.locator("button[title='The roster of whoever is on the clock']");
  if ((await drawer.count()) > 0 && (await drawer.first().isVisible())) {
    await drawer.first().click();
    await page.waitForTimeout(700);
    await shot(page, `board-roster-drawer--${size.key}`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  await page.goto(`${BASE}/draft/final`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1400);
  await shot(page, `final--${size.key}`);

  if (await startMock(page)) {
    await shot(page, `mock--${size.key}`);
  } else {
    console.log("  ! could not start a mock");
  }

  await context.close();
}

await browser.close();
console.log(`\nScreenshots → ${path.relative(process.cwd(), OUT)}`);

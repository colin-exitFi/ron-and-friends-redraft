/**
 * Screenshots a few pages so the re-skin can be compared against the Figma
 * frames. Board pages are shot at 1920x1080 because that is the projector
 * target the design was drawn to; the rest at the design's 1440 width.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.env.BASE ?? "http://127.0.0.1:3400";
const out = process.env.OUT ?? "/tmp/ukl/after";
mkdirSync(out, { recursive: true });

const shots = [
  { path: "/draft", name: "draftboard", w: 1920, h: 1080 },
  { path: "/", name: "dashboard", w: 1440, h: 1000 },
  { path: "/keepers", name: "keepers", w: 1440, h: 1000 },
  { path: "/teams", name: "teams", w: 1440, h: 1000 },
  { path: "/trades", name: "trades", w: 1440, h: 1000 },
  { path: "/players", name: "players", w: 1440, h: 1000 },
  { path: "/governance", name: "governance", w: 1440, h: 1000 },
  { path: "/scoring", name: "scoring", w: 1440, h: 1000 },
  { path: "/calendar", name: "calendar", w: 1440, h: 1000 },
  { path: "/checklist", name: "checklist", w: 1440, h: 1000 },
];

const browser = await chromium.launch();
for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  try {
    const res = await page.goto(base + s.path, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${s.name}.png` });
    console.log(`${s.name}: ${res?.status()} -> ${out}/${s.name}.png`);
  } catch (err) {
    console.log(`${s.name}: FAILED ${err.message}`);
  }
  await page.close();
}
await browser.close();

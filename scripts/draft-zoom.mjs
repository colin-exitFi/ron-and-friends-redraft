/**
 * Close-up crops of the board, for judging cell legibility.
 *
 *   node scripts/draft-zoom.mjs
 *
 * Renders at 1080p — the resolution it will actually be plugged into — then
 * captures regions at 2x so the type can be inspected without guessing. Does
 * not modify the board: it fills a scratch copy, screenshots, and resets.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE ?? "http://localhost:3200";
const OUT = path.join(process.cwd(), "screenshots");
mkdirSync(OUT, { recursive: true });

async function api(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const { players } = await import("../data/smartdraft-players.json", {
  with: { type: "json" },
}).then((m) => m.default ?? m);
const ranked = players
  .filter((p) => p.position !== "K" && p.sortAdp != null)
  .sort((a, b) => a.sortAdp - b.sortAdp);

await api("/api/draft/reset", { confirm: "RESET" });
let live = (await api("/api/draft/state")).view;
for (let i = 0; i < 76 && live.onTheClockSlotId; i++) {
  const taken = new Set(live.draftedPlayerIds);
  const next = ranked.find((p) => !taken.has(String(p.id)));
  const res = await api("/api/draft/pick", {
    slotId: live.onTheClockSlotId,
    playerId: String(next.id),
  });
  if (!res.ok) break;
  live = res.view;
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 2,
});
await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);

const crops = [
  ["zoom-header", { x: 0, y: 0, width: 960, height: 96 }],
  ["zoom-cells-top", { x: 0, y: 84, width: 960, height: 300 }],
  ["zoom-cells-traded", { x: 0, y: 380, width: 960, height: 300 }],
  ["zoom-onclock", { x: 960, y: 84, width: 960, height: 400 }],
  ["zoom-cells-empty", { x: 0, y: 620, width: 960, height: 320 }],
];
for (const [name, clip] of crops) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, clip });
  console.log(path.relative(process.cwd(), file));
}

await api("/api/draft/reset", { confirm: "RESET" });
await browser.close();

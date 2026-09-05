/**
 * The arrow keys move the cursor the way the key points, and nothing else.
 *
 *   BASE=http://localhost:3100 npm run verify:draft:arrows
 *
 * `verify-draft-typing.mjs` proves a pick can be ENTERED without the mouse.
 * This proves the operator can GET SOMEWHERE ELSE without it, which is the half
 * that matters when the pick needing a correction is four rows up. Nothing else
 * in the suite asserts any of it — `verify-footer-removal.mjs` checks that
 * ArrowRight moves the cursor at all, and stops there.
 *
 * The claims, in order of how badly each reads on a projector when wrong:
 *
 *   1. every arrow moves one cell in its own direction, and the opposite arrow
 *      comes straight back
 *   2. an even round moves the same way as an odd one — THE SNAKE IS GONE, and
 *      a cursor that still snaked would send the commissioner to the wrong end
 *      of the board in front of the room
 *   3. the edges of the board stop it rather than wrapping it around
 *   4. with a name half-typed the arrows belong to the match list, not to the
 *      cursor
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 *
 * This was `ukl-arrows.mjs` in the repo root, hard-wired to
 * `http://localhost:3000` — the port the commissioner's `next dev` is on — and
 * it opened by POSTing `{"confirm":"RESET"}` with no precondition and closed by
 * doing it again. On the file store that server's state IS the live board, so
 * running it on draft day emptied the projector twice over with nothing put
 * back and nothing to put it back from.
 *
 * `borrowLiveBoard` is what makes it safe now, and is worth reading before
 * changing anything here: it refuses a board with picks on it, copies the
 * original to disk BEFORE the first write so it survives a `kill -9`, and
 * restores on every exit path with the bytes verified by SHA-256.
 */
import { chromium } from "playwright";

import {
  assertLocalBase,
  assertServerHasNoPicks,
  borrowLiveBoard,
} from "./live-board-guard.mjs";

/*
 * A throwaway build, never 3000. The default is the port the other browser
 * harnesses use, and the guard refuses anything that is not loopback.
 */
const BASE = process.env.BASE ?? "http://localhost:3100";
const get = async (u) => (await (await fetch(BASE + u)).json());
const post = async (u, b) => (await (await fetch(BASE + u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json());
const view = async () => (await get("/api/draft/state")).view;
let passed = 0, failed = 0;
const check = (l, ok, d = "") => { console.log(`${ok ? "  ok  " : "  FAIL"} ${l}${d ? ` — ${d}` : ""}`); if (ok) passed++; else failed++; };
const section = (s) => console.log(`\n${s}`);

/*
 * Nothing above this line has written anything. Everything below it drives the
 * real board through the real API.
 *
 * The order of the three is deliberate. `BASE` is checked first because it
 * reads nothing and a run aimed at the wrong machine should stop before taking
 * a lock. The picks check is last because `borrowLiveBoard` recovers a fixture
 * left by a run that died, and a leftover fixture HAS picks on it — asking the
 * server first would refuse to start and strand it there for good.
 */
assertLocalBase(BASE);
const { putBack } = borrowLiveBoard("verify:draft:arrows");
await assertServerHasNoPicks(BASE);

const browser = await chromium.launch();

try {
  await post("/api/draft/reset", { confirm: "RESET" });
  let v = await view();
  const open = v.slots.filter((s) => s.fill === null);
  const { players } = await get("/api/players/search?q=a&excludeDrafted=1");
  for (let i = 0; i < 12 && i < players.length; i++) await post("/api/draft/pick", { slotId: open[i].id, playerId: players[i].id });
  v = await view();

  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);

  const cursor = async () => {
    const ring = page.locator('[data-slot-id].ring-2').first();
    if (await ring.count()) return await ring.getAttribute("data-slot-id");
    const active = page.locator('[data-slot-id]:has-text("ACTIVE")').first();
    return await active.getAttribute("data-slot-id");
  };
  const slotOf = (id) => v.slots.find((s) => s.id === id);
  const rc = (id) => { const s = slotOf(id); return s ? `r${s.round}c${s.column} ${s.label}` : "?"; };

  section("The cursor moves the way the key points");
  const start = await cursor();
  check("starts on the clock", Boolean(start), rc(start));

  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  let now = await cursor();
  check("<- moved one column LEFT, same round",
    slotOf(now).column === slotOf(start).column - 1 && slotOf(now).round === slotOf(start).round,
    `${rc(start)} -> ${rc(now)}`);

  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  let back = await cursor();
  check("-> came straight back", back === start, `${rc(now)} -> ${rc(back)}`);

  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  now = await cursor();
  check("down moved one round DOWN, same column",
    slotOf(now).round === slotOf(start).round + 1 && slotOf(now).column === slotOf(start).column,
    `${rc(start)} -> ${rc(now)}`);

  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  back = await cursor();
  check("up came straight back", back === start, `${rc(now)} -> ${rc(back)}`);

  section("Even rounds move the same way as odd ones (the snake is gone)");
  /*
   * AN EVEN ROUND, WALKED TO RATHER THAN ASSUMED.
   *
   * This pressed ArrowDown once and asserted `round === 2`, which is only true
   * while the clock starts in round 1 — and where the clock starts depends on
   * how many keepers are on the board. Nineteen of them put it in round 2
   * already, so the one press landed in round 3 and the check failed saying
   * nothing whatever about the snake. Keeper declarations move right up to the
   * draft, so pinning this to a round number was never going to hold.
   */
  let even = await cursor();
  for (let i = 0; i < 3 && slotOf(even).round % 2 !== 0; i++) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(300);
    even = await cursor();
  }
  check("walked down to an even round", slotOf(even).round % 2 === 0, rc(even));
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  const evenLeft = await cursor();
  check("<- still moves left in an even round",
    slotOf(evenLeft).column === slotOf(even).column - 1,
    `${rc(even)} -> ${rc(evenLeft)}`);

  section("The edges of the board stop it");
  for (let i = 0; i < 15; i++) { await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(70); }
  const edge = await cursor();
  check("walked to column 1 and stopped", slotOf(edge).column === 1, rc(edge));
  for (let i = 0; i < 25; i++) { await page.keyboard.press("ArrowUp"); await page.waitForTimeout(60); }
  const top = await cursor();
  check("walked to round 1 and stopped", slotOf(top).round === 1, rc(top));

  section("With a name typed, the arrows still work the match list");
  await page.keyboard.type("bro", { delay: 40 });
  await page.waitForTimeout(350);
  const cursorBefore = await cursor();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(250);
  check("down did not move the cursor while typing", (await cursor()) === cursorBefore, rc(cursorBefore));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  section("Delete still removes the pick under the cursor");
  const before = (await view()).picksMade;
  let guard = 0;
  while (guard++ < 20) {
    const id = await cursor();
    if (slotOf(id)?.fill === "pick") break;
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(120);
  }
  const victim = slotOf(await cursor());
  check("cursor is on an entered pick", victim?.fill === "pick", victim ? `${victim.label} ${victim.player?.name}` : "none");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(250);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(1500);
  const after = await view();
  check("one pick removed", after.picksMade === before - 1, `${before} -> ${after.picksMade}`);
  check("and it was the one under the cursor", after.slots.find((s) => s.id === victim.id)?.fill === null);
} finally {
  // Before the browser, so a close that throws or hangs cannot get between the
  // board and its restore. `putBack` verifies by SHA-256 and prints the
  // recovery command if it cannot; it is also wired to `exit` and to the
  // signals, so this call is the tidy path rather than the only one.
  section("The live draft board is back exactly as it was");
  check("every borrowed file is byte-identical to what was borrowed", putBack());
  await browser.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

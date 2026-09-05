/**
 * Taking a wrong pick back off the board, which is the draft-day recovery.
 *
 *   BASE=http://localhost:3100 npm run verify:draft:delete
 *
 * Undo removes the pick entered LAST. That is the wrong verb for the mistake
 * that actually happens in the room — the name was wrong six picks ago and
 * nobody noticed until now — so the board also has a cursor, a delete, and a
 * right-click menu, and this is the only thing that proves any of them work.
 *
 * What it holds, and why each one is here rather than in
 * `verify-draft-typing.mjs`:
 *
 *   1. the arrows reach an entered pick and the header names who is in it
 *   2. Delete ASKS FIRST, naming the player, and removes nothing until it is
 *      answered — a destructive key on a projector needs a sentence between
 *      the press and the loss
 *   3. Escape backs out of that question
 *   4. the second press removes THAT ONE PICK AND NO OTHER
 *   5. the emptied cell takes the correction straight away
 *   6. typing while parked on an old pick goes to the clock rather than into
 *      the void — the fumble that would otherwise lose a pick mid-draft
 *   7. right-click deletes one specific pick, for whoever has the mouse
 *   8. Undo is still the other verb: one pick, the one entered last
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT PUTS IT BACK
 * ============================================================================
 *
 * This was `ukl-delete-check.mjs` in the repo root, hard-wired to
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
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (ok) passed++;
  else failed++;
};
const section = (s) => console.log(`\n${s}`);
const slotByLabel = (v, label) => v.slots.find((s) => s.label === label);

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
const { putBack } = borrowLiveBoard("verify:draft:delete");
await assertServerHasNoPicks(BASE);

const browser = await chromium.launch();

try {
  // --- Seed a known board ---------------------------------------------------
  await post("/api/draft/reset", { confirm: "RESET" });
  let v = await view();
  const open = v.slots.filter((s) => s.fill === null);
  const { players } = await get("/api/players/search?q=a&excludeDrafted=1");
  const seeded = [];
  for (let i = 0; i < 6; i++) {
    await post("/api/draft/pick", { slotId: open[i].id, playerId: players[i].id });
    seeded.push({ label: open[i].label, name: players[i].name });
  }
  console.log("seeded:", seeded.map((s) => `${s.label} ${s.name}`).join(", "));
  const lastSeeded = seeded[5];

  const page = await browser.newPage({ viewport: { width: 1680, height: 1000 } });
  await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const body = () => page.textContent("body");

  section("1. The arrow keys reach an entered pick");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  let text = await body();
  check("the header says a pick is selected", /SELECTED:/i.test(text));
  check(`and names ${lastSeeded.label} ${lastSeeded.name}`, text.includes(lastSeeded.name.toUpperCase()), text.match(/SELECTED:[^\n]{0,80}/)?.[0]);

  section("2. Delete asks before it removes");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  text = await body();
  check("a confirmation names the player", /Delete this pick/i.test(text) && text.includes(lastSeeded.name));
  check("nothing has been removed yet", (await view()).picksMade === 6, `${(await view()).picksMade} picks`);

  section("3. Escape backs out of it");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("the confirmation is gone", !/Delete this pick/i.test(await body()));
  check("the pick is still on the board", (await view()).picksMade === 6);

  section("4. A second Delete removes that one pick and no other");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(1500);
  v = await view();
  check("one pick gone, five remain", v.picksMade === 5, `${v.picksMade} picks`);
  check(`${lastSeeded.label} is open again`, slotByLabel(v, lastSeeded.label)?.fill === null);
  check("the five earlier picks are untouched", seeded.slice(0, 5).every((s) => slotByLabel(v, s.label)?.player?.name === s.name));

  section("5. The emptied cell is ready for the right name");
  await page.keyboard.type("saquon", { delay: 40 });
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  v = await view();
  check(`${lastSeeded.label} now holds the correction`, /saquon/i.test(slotByLabel(v, lastSeeded.label)?.player?.name ?? ""), slotByLabel(v, lastSeeded.label)?.player?.name ?? "empty");
  check("and the board is back to six picks", v.picksMade === 6, `${v.picksMade} picks`);

  section("6. Typing while parked on a pick goes to the clock, never into the void");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  check("the cursor is on an entered pick", /SELECTED:/i.test(await body()));
  await page.keyboard.type("bijan", { delay: 40 });
  await page.waitForTimeout(400);
  text = await body();
  check("typing released it back to the clock", /ON THE CLOCK:/i.test(text));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  v = await view();
  const clockLabel = open[6].label;
  check("and the name landed on the clock's cell", /bijan/i.test(slotByLabel(v, clockLabel)?.player?.name ?? ""), slotByLabel(v, clockLabel)?.player?.name ?? "empty");

  section("7. Right-click deletes one specific pick");
  const victim = seeded[1];
  const before = (await view()).picksMade;
  await page.locator(`[title^="${victim.label} —"]`).first().click({ button: "right" });
  await page.waitForTimeout(400);
  check("a menu offers to delete it", /Delete this pick/i.test(await body()));
  await page.getByRole("menuitem", { name: /Delete this pick/i }).click();
  await page.waitForTimeout(1500);
  v = await view();
  check(`${victim.label} is empty`, slotByLabel(v, victim.label)?.fill === null);
  check("exactly one pick was removed", v.picksMade === before - 1, `${before} → ${v.picksMade}`);

  section("8. Undo is still the other verb — one pick, the one entered last");
  const beforeUndo = await view();
  const lastEntered = beforeUndo.lastPick;
  await page.getByRole("button", { name: /^Undo$/i }).click();
  await page.waitForTimeout(1500);
  v = await view();
  check("undo removed one pick, not the draft", v.picksMade === beforeUndo.picksMade - 1, `${beforeUndo.picksMade} → ${v.picksMade}`);
  check(`it removed the one entered last (${lastEntered?.label})`, slotByLabel(v, lastEntered.label)?.fill === null);
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

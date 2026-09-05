/**
 * The commissioner's rehearsal: the whole of draft night, in one run.
 *
 *   BASE=http://localhost:3921 node scripts/verify-draft-dryrun.mjs
 *
 * ============================================================================
 * WHY THIS EXISTS WHEN THERE ARE ALREADY FOURTEEN HARNESSES
 * ============================================================================
 *
 * The others each prove one mechanism, and prove it well. `verify:draft` proves
 * the engine, `verify:draft:typing` proves a pick can be entered without the
 * mouse, `verify:board:fit` proves a cell is legible, `verify:draft:delete`
 * proves a wrong pick comes back off. What none of them does is assert the two
 * things the league's own priority list puts FIRST, against the rendered board:
 *
 *   1. THAT A TRADED SLOT NAMES THE FRANCHISE THAT ACTUALLY OWNS IT. Twenty-nine
 *      of the hundred and sixty picks on Saturday's board have changed hands.
 *      `verify:picks` proves the ledger behind them and `db:verify:trades`
 *      proves the cascade that moved them, but both stop at the data. The
 *      failure that matters is a cell that draws the ORIGINAL owner's name — the
 *      commissioner calls "Stefan's pick", Zach says it is his, and the room
 *      stops. That is a rendering claim and it needs a browser to refute.
 *
 *   2. THAT A WIPED BOARD COMES BACK IN ONE KEYSTROKE. `simulate-draft.mts`
 *      proves `restorable` at the engine level. This proves the path the room
 *      would actually take at pick 90 with ten people watching: the board is
 *      empty, the undo control has relabelled itself to say how many picks it is
 *      holding, and one chord puts every one of them back.
 *
 * Everything else here is the connective tissue a dry run needs to be a dry run
 * rather than a unit test: sixteen rounds present, keepers placed and never on
 * the clock, the clock following the board without a human scrolling, and the
 * projector screenshots that a person then has to look at.
 *
 * IT BORROWS THE LIVE BOARD. The refusal to run against a draft in progress, the
 * lock, the on-disk vault and the SHA-256 verified restore all live in
 * `scripts/live-board-guard.mjs`. Read that before changing anything here.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  assertLocalBase,
  assertServerHasNoPicks,
  borrowLiveBoard,
} from "./live-board-guard.mjs";

const BASE = process.env.BASE ?? "http://localhost:3921";
const OUT = path.join(process.cwd(), "screenshots");
/** 1080p, because that is what it gets plugged into. */
const VIEWPORT = { width: 1920, height: 1080 };

mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ok   ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

async function api(pathname, body) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}
const boardState = async () => (await api("/api/draft/state")).view;
const byLabel = (view, label) => view.slots.find((s) => s.label === label);

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    -> ${path.relative(process.cwd(), file)}`);
}

/** Types at the document with nothing focused, exactly as the operator does. */
async function typeAtDocument(page, text) {
  for (const char of text) {
    await page.keyboard.press(char === " " ? "Space" : char);
    await page.waitForTimeout(12);
  }
}

/** Every cell's label, title and owner line, read straight out of the DOM. */
async function readCells(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-slot-id][title]")].map((el) => ({
      slotId: el.getAttribute("data-slot-id"),
      title: el.getAttribute("title") ?? "",
      text: (el.innerText ?? "").replace(/\s+/g, " ").trim(),
    })),
  );
}

/**
 * The BOARD's header, not the app shell's.
 *
 * There are two `<header>` elements on `/draft` and the first one in the
 * document is the site navigation — "Open navigation / Ultimate Keeper /
 * Search". Taking `querySelector("header")` reads that one and never sees the
 * clock, so this finds the header by the sentence only the board's own state
 * line can produce. Returns null rather than "" when there is no such header, so
 * a board that stopped announcing the clock fails here instead of passing on an
 * empty string.
 */
const boardHeader = (page) =>
  page.evaluate(() => {
    const board = [...document.querySelectorAll("header")].find((h) =>
      /ON THE CLOCK|OUT OF ORDER|SELECTED:|THAT'S THE DRAFT/i.test(h.innerText ?? ""),
    );
    return board ? (board.innerText ?? "").replace(/\s+/g, " ").trim() : null;
  });

/*
 * `assertLocalBase` before the lock, so a run aimed at the deployment is stopped
 * before it takes a lock over a file that has no bearing on where its picks go.
 * `assertServerHasNoPicks` after the borrow, because the borrow is what recovers
 * a fixture stranded by a run that died.
 */
assertLocalBase(BASE);
const { putBack } = borrowLiveBoard("verify:draft:dryrun");
await assertServerHasNoPicks(BASE);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});

try {
  section("1. The board the room walks in to");
  await api("/api/draft/reset", { confirm: "RESET" });
  await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  let view = await boardState();
  const keeperBaseline = view.keeperCount;
  check("all 160 slots exist", view.slots.length === 160, `${view.slots.length}`);
  check("nothing has been entered yet", view.picksMade === 0);
  check(
    `every keeper is already placed (${keeperBaseline})`,
    view.filled === keeperBaseline && keeperBaseline > 0,
    `filled ${view.filled}`,
  );

  let cells = await readCells(page);
  check("the board draws a cell for all 160 slots", cells.length === 160, `${cells.length}`);
  const rounds = new Set(view.slots.map((s) => s.round));
  check("all sixteen rounds are present in the data", rounds.size === 16, `${rounds.size}`);
  /*
   * Drawn, not merely present: a virtualised grid that renders eight rounds and
   * pages the rest is the failure this is aimed at, and the room stands up to
   * read round 16 rather than scrolling to it.
   */
  const drawnRounds = new Set(
    cells.map((c) => Number(c.title.match(/^(\d+)\./)?.[1])).filter(Boolean),
  );
  check(
    "…and all sixteen are actually drawn, none paged away",
    drawnRounds.size === 16,
    `rounds drawn: ${[...drawnRounds].sort((a, b) => a - b).join(",")}`,
  );

  section("2. A traded slot names the franchise that owns it now");
  /*
   * THE LEAGUE'S FIRST PRIORITY, ASSERTED AGAINST THE RENDERED CELL.
   *
   * The title is the cell's own sentence about itself: a traded pick reads
   * "4.01 — Colin's pick, now Zach", an untraded one just "1.01 — Zach". So the
   * check is not "does a name appear" but "does the name the room would read
   * match the franchise the server says holds the pick".
   */
  const traded = view.slots.filter((s) => s.traded);
  check(`the board is carrying traded picks (${traded.length})`, traded.length > 0);

  const byId = new Map(cells.map((c) => [c.slotId, c]));
  const wrongOwner = [];
  const missingOrigin = [];
  for (const slot of traded) {
    const cell = byId.get(slot.id);
    if (!cell) {
      wrongOwner.push(`${slot.label} has no cell`);
      continue;
    }
    // "…'s pick, now X" — X is who owns it, and it must be the current owner.
    const now = cell.title.match(/'s pick, now ([^·]+?)(?: ·|$)/)?.[1]?.trim();
    if (now !== slot.currentOwner.name) {
      wrongOwner.push(`${slot.label} reads "${now}" but ${slot.currentOwner.name} holds it`);
    }
    if (!cell.title.startsWith(`${slot.label} — ${slot.originalOwner.name}'s pick`)) {
      missingOrigin.push(`${slot.label}: "${cell.title.slice(0, 44)}"`);
    }
  }
  check(
    `all ${traded.length} traded cells name their CURRENT owner`,
    wrongOwner.length === 0,
    wrongOwner.slice(0, 3).join(" | "),
  );
  check(
    "…and still say whose pick it originally was, so the column reads",
    missingOrigin.length === 0,
    missingOrigin.slice(0, 3).join(" | "),
  );
  /* The other half: an untraded cell must NOT claim to have been traded. */
  const falseTrade = view.slots
    .filter((s) => !s.traded)
    .filter((s) => byId.get(s.id)?.title.includes("'s pick, now"));
  check(
    "no untraded cell claims to have changed hands",
    falseTrade.length === 0,
    falseTrade.slice(0, 3).map((s) => s.label).join(", "),
  );
  /* And every traded pick genuinely moved, or the fixture proves nothing. */
  check(
    "every traded slot's current owner really differs from its original",
    traded.every((s) => s.currentOwner.id !== s.originalOwner.id),
  );

  section("3. Keepers are placed, and never on the clock");
  const keepers = view.slots.filter((s) => s.fill === "keeper");
  check(`${keepers.length} keeper slots are filled with a player`, keepers.every((s) => s.player));
  check("no keeper slot is on the clock", keepers.every((s) => !s.onTheClock));
  const keeperCells = keepers.map((s) => byId.get(s.id)).filter(Boolean);
  check(
    "every keeper cell says so, so nobody drafts one again",
    keeperCells.length === keepers.length &&
      keeperCells.every((c) => /keeper/i.test(c.title)),
    `${keeperCells.filter((c) => /keeper/i.test(c.title)).length}/${keepers.length}`,
  );
  /* A keeper sitting on an ACQUIRED pick is settled practice here and is the
     case most likely to be drawn wrong, so it is named rather than sampled. */
  const keeperOnAcquired = keepers.filter((s) => s.traded);
  check(
    `keepers on acquired picks are drawn on the acquirer's row (${keeperOnAcquired.length})`,
    keeperOnAcquired.every((s) => {
      const t = byId.get(s.id)?.title ?? "";
      return t.includes(`now ${s.currentOwner.name}`);
    }),
    keeperOnAcquired.map((s) => `${s.label} ${s.player.name}→${s.currentOwner.name}`).join(", "),
  );

  section("4. The clock names a man, and says when the pick was traded for");
  const onClock = () =>
    boardState().then((v) => v.slots.find((s) => s.id === v.onTheClockSlotId) ?? null);
  let target = await onClock();
  let header = await boardHeader(page);
  check("the board's header announces the clock", header !== null, header ?? "no board header");
  check(
    `it names the franchise that holds ${target.label} (${target.currentOwner.name})`,
    (header ?? "").toUpperCase().includes(target.currentOwner.name.toUpperCase()),
    header ?? "",
  );
  await shot(page, "dryrun-01-opening-board");

  /*
   * THE LINE THAT SETTLES THE ARGUMENT.
   *
   * When the cursor is on a pick that changed hands, the state line has to say
   * so in words — "TRADED FROM STEFAN" — because the room's objection is always
   * "that's my pick". This read "VIA PI" once, which nobody decoded. Checked by
   * aiming the cursor rather than by drafting up to the slot, so it costs no
   * picks and cannot disturb what follows.
   */
  const firstTraded = view.slots.find((s) => s.traded && s.fill === null);
  check("there is a traded, undrafted pick to aim at", !!firstTraded, firstTraded?.label);
  if (firstTraded) {
    await page.click(`[data-slot-id="${firstTraded.id}"]`);
    await page.waitForTimeout(400);
    const aimedHeader = await boardHeader(page);
    check(
      `aiming at ${firstTraded.label} says it was traded, in words`,
      /TRADED FROM/i.test(aimedHeader ?? ""),
      aimedHeader ?? "no board header",
    );
    check(
      `…and names ${firstTraded.originalOwner.name} as who it came from`,
      (aimedHeader ?? "").toUpperCase().includes(firstTraded.originalOwner.name.toUpperCase()),
    );
    check(
      `…while crediting the pick to ${firstTraded.currentOwner.name}, who holds it`,
      (aimedHeader ?? "").toUpperCase().includes(firstTraded.currentOwner.name.toUpperCase()),
    );
    await shot(page, "dryrun-01b-traded-pick-on-the-clock");
    /* Reload rather than trusting a key to clear the aim: everything below
       assumes the cursor is back on the clock the server nominates. */
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(700);
  }

  section("5. Picks, the way they get called in the room");
  /* Typed, not clicked — the operator's hands never leave the keyboard. */
  const entered = [];
  for (const name of ["gibbs", "bijan", "chase"]) {
    const slot = await onClock();
    await typeAtDocument(page, name);
    await page.waitForTimeout(220);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    view = await boardState();
    const landed = byLabel(view, slot.label)?.player?.name;
    check(`"${name}" + Enter filled ${slot.label}`, !!landed, landed ?? "empty");
    if (landed) entered.push({ label: slot.label, player: landed });
    await page.waitForTimeout(200);
  }
  check("three picks are on the board", view.picksMade === 3, `${view.picksMade}`);

  /* The arrows move the cursor off the clock and back, which is the other way a
     pick gets entered when the room jumps around. */
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(200);
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(200);
  view = await boardState();
  check("moving the cursor with the arrows entered nothing", view.picksMade === 3);

  section("6. Undo takes back the last pick");
  const lastEntered = entered[entered.length - 1];
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(900);
  view = await boardState();
  check(
    `one chord took ${lastEntered.label} back off the board`,
    byLabel(view, lastEntered.label)?.fill === null,
    `${view.picksMade} picks left`,
  );
  check("and it took back exactly one", view.picksMade === 2);

  section("7. A wiped board comes back in one keystroke");
  /*
   * THE RECOVERY THIS LEAGUE IS DESIGNED AROUND. Destructive controls are
   * deliberately easy to reach here and the answer to a misclick is that it can
   * be taken back — so the thing that must be true is not that a reset is hard,
   * it is that a reset is REVERSIBLE, visibly, without anyone opening a file.
   */
  const beforeWipe = await boardState();
  const wipedPicks = beforeWipe.picksMade;
  await api("/api/draft/reset", { confirm: "RESET" });
  await page.waitForTimeout(1200);
  view = await boardState();
  check("the reset emptied the entered picks", view.picksMade === 0);
  check(
    `keepers survived the reset (${keeperBaseline})`,
    view.filled === keeperBaseline,
    `filled ${view.filled}`,
  );
  check(
    `the board is holding the ${wipedPicks} wiped picks for a restore`,
    view.restorable?.pickCount === wipedPicks,
    `offered ${view.restorable?.pickCount ?? "nothing"}`,
  );

  /* The control has to SAY it, or nobody in the room knows the way back. */
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const restoreLabel = await page.evaluate(() =>
    [...document.querySelectorAll("button")]
      .map((b) => `${b.innerText} ${b.getAttribute("title") ?? ""}`)
      .find((t) => /restore|put back/i.test(t)) ?? null,
  );
  check(
    "the undo control relabels itself to offer the restore",
    restoreLabel !== null && new RegExp(String(wipedPicks)).test(restoreLabel),
    restoreLabel ?? "no restore control found",
  );
  await shot(page, "dryrun-02-wiped-board-offers-restore");

  await page.keyboard.press("Control+z");
  await page.waitForTimeout(1500);
  view = await boardState();
  check(
    `one chord put all ${wipedPicks} picks back`,
    view.picksMade === wipedPicks,
    `${view.picksMade} of ${wipedPicks}`,
  );
  check(
    "…and put them back where they were",
    entered
      .slice(0, wipedPicks)
      .every((e) => byLabel(view, e.label)?.player?.name === e.player),
  );
  check("the restore is spent, not repeatable", view.restorable == null);

  section("8. The board follows the clock, without a human scrolling");
  /*
   * The projector is floor-to-ceiling and nobody is walking to the laptop to
   * scroll it. Drafted deep enough that the live cell is certainly below the
   * fold on a fresh load, then the on-clock cell is asked whether it is inside
   * the scrolled pane.
   */
  const { players } = await import("../data/smartdraft-players.json", {
    with: { type: "json" },
  }).then((m) => m.default ?? m);
  const ranked = players
    .filter((p) => p.position !== "K" && p.sortAdp != null)
    .sort((a, b) => a.sortAdp - b.sortAdp);

  let live = await boardState();
  for (let i = 0; i < 95 && live.onTheClockSlotId; i++) {
    const taken = new Set(live.draftedPlayerIds);
    const next = ranked.find((p) => !taken.has(String(p.id)));
    if (!next) break;
    const res = await api("/api/draft/pick", {
      slotId: live.onTheClockSlotId,
      playerId: String(next.id),
    });
    if (!res.ok) break;
    live = res.view;
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  view = await boardState();
  check(`board drafted deep for the follow test`, view.picksMade > 60, `${view.picksMade} picks`);

  const follow = await page.evaluate(() => {
    const cell = document.querySelector("[data-slot-id].border-live, [data-slot-id].bg-live");
    const target =
      cell ??
      [...document.querySelectorAll("[data-slot-id][title]")].find((el) =>
        (el.getAttribute("title") ?? "").includes("on the clock"),
      );
    if (!target) return null;
    const pane = target.closest("main") ?? document.scrollingElement;
    const c = target.getBoundingClientRect();
    const p = pane.getBoundingClientRect();
    return {
      round: (target.getAttribute("title") ?? "").slice(0, 6),
      visible: c.top >= p.top - 1 && c.bottom <= p.bottom + 1,
      cellTop: Math.round(c.top),
      paneTop: Math.round(p.top),
      paneBottom: Math.round(p.bottom),
      scrolled: Math.round(pane.scrollTop ?? 0),
    };
  });
  check("the cell on the clock was found on the rendered board", follow !== null);
  if (follow) {
    check(
      `the board scrolled itself to the live pick (${follow.round})`,
      follow.visible,
      `cell top ${follow.cellTop}, pane ${follow.paneTop}–${follow.paneBottom}, scrollTop ${follow.scrolled}`,
    );
    check(
      "…and it genuinely had to scroll to do it, so this proves something",
      follow.scrolled > 0,
      `scrollTop ${follow.scrolled}`,
    );
  }
  await shot(page, "dryrun-03-mid-draft-projector");

  section("9. Round 16 is reachable, and legible when the room stands up");
  const deepCells = await readCells(page);
  const round16 = deepCells.filter((c) => /^16\./.test(c.title));
  check("all ten of round 16's cells are on the board", round16.length === 10, `${round16.length}`);
  const clipped = deepCells.filter((c) => c.text.includes("…"));
  check("nothing on the board is ellipsised", clipped.length === 0, `${clipped.length} cells`);

  section("10. Console health");
  const real = problems.filter(
    (p) => !p.includes("webpack-hmr") && !p.includes("Download the React DevTools"),
  );
  check("no page errors while all of that happened", real.length === 0, real.slice(0, 2).join(" | "));

  section("11. Leave him the board he started with");
  await api("/api/draft/reset", { confirm: "RESET" });
  view = await boardState();
  check(
    `board back to keepers only (${keeperBaseline})`,
    view.filled === keeperBaseline && view.picksMade === 0,
    `filled ${view.filled}`,
  );
} finally {
  /* Before the browser closes, so a close that hangs cannot get between the
     board and its restore. Verified by SHA-256 inside the guard. */
  const back = putBack();
  await browser.close();
  section("The live draft board is back exactly as it was");
  check("every borrowed file is byte-identical to what was borrowed", back);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

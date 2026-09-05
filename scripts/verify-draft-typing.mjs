/**
 * Drives the real draft board in a real browser, with the keyboard only.
 *
 *   node scripts/verify-draft-typing.mjs
 *
 * The simulation in `simulate-draft.mts` proves the engine. This proves the
 * thing the engine is wrapped in: that a practiced operator can enter a pick
 * start to finish without the mouse existing, that a misspelling and a bare
 * surname both land on the right player, that the duplicate warning says who
 * has him and clears in one keystroke, and that the pick announcement shows
 * the room enough to object without ever getting in the operator's way.
 *
 * The mouse is never used. Not once. Every interaction below is a keystroke
 * dispatched at the document, which is the only way the board accepts input —
 * if focus handling were wrong, this script could not make a single pick.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT REFUSES TO IF THE DRAFT IS RUNNING
 * ============================================================================
 *
 * Every pick below is a real pick, entered through the real API against the
 * real `data/draft-state-2026.json`. There is no test season to hide in.
 *
 * HOW THAT IS MADE SAFE IS NOT IN THIS FILE. `scripts/live-board-guard.mjs`
 * holds the refusal to run against a board with picks on it, the lock that
 * stops two harnesses interleaving, the on-disk vault, the restore on every
 * exit path and the SHA-256 verification of it — read that before changing
 * anything here.
 *
 * This script used to do its own version in this file, and restoring is only
 * the fallback. Reset, draft seventy picks, put the original back: on a board
 * that is mid-draft that still discards every pick the commissioner enters
 * inside the window, because the restore stamps the pre-run bytes back over
 * them. The answer is not to run at all, which is the guard's first act.
 *
 * `BASE` is checked before the lock is taken, and the server is asked as well as
 * the file. The vault holds a local FILE; pointed at the deployment the board is
 * a Postgres row instead, so the reset would land on the league's real draft and
 * the restore would never reach it.
 *
 * Screenshots land in `screenshots/`.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  assertLocalBase,
  assertServerHasNoPicks,
  borrowLiveBoard,
} from "./live-board-guard.mjs";

const BASE = process.env.BASE ?? "http://localhost:3100";
const OUT = path.join(process.cwd(), "screenshots");
/** 1080p, because that is what it will be plugged into. */
const VIEWPORT = { width: 1920, height: 1080 };

mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
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

/** The board's state as the server sees it — the check of record. */
async function boardState() {
  const { view } = await api("/api/draft/state");
  return view;
}

function slotByLabel(view, label) {
  return view.slots.find((s) => s.label === label);
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`    → ${path.relative(process.cwd(), file)}`);
  return file;
}

/** Types at the document with no element focused, one key at a time. */
async function typeAtDocument(page, text) {
  for (const char of text) {
    await page.keyboard.press(char === " " ? "Space" : char);
    await page.waitForTimeout(12);
  }
}

/**
 * The pick announcement, or null once it has faded. Read by its animation class
 * so the test is looking at the same element the animation drives.
 */
async function flash(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".ukl-flash");
    if (!el) return null;
    const style = getComputedStyle(el);
    /*
     * The name is set to truncate, and innerText reports the full string even
     * when CSS has clipped it to an ellipsis — so asking whether the text is
     * "present" would pass on a name the room cannot actually read. Measure it.
     *
     * Found by attribute, not by position in the child list. It was
     * `children[1]`, which was only ever true of one particular arrangement of
     * the band and would have gone on passing — against a `<div>` that is not
     * the name and never overflows — the first time the band was recomposed.
     */
    const nameEl = el.querySelector("[data-flash-name]");
    return {
      // innerText, not textContent: it keeps the line and cell breaks, so a
      // check for the position "RB" cannot be satisfied by a run of letters
      // welded onto the end of the player's name.
      text: el.innerText ?? "",
      opacity: Number(style.opacity),
      transform: style.transform,
      // `null`, not `false`, when the handle is gone: a missing name element
      // must fail the clipping check rather than satisfy it.
      nameClipped: nameEl ? nameEl.scrollWidth > nameEl.clientWidth + 1 : null,
    };
  });
}

/**
 * Case-insensitive, because the announcement is uppercased in CSS and that is a
 * presentation choice the assertions should not be pinned to.
 */
const says = (f, needle) => !!f && f.text.toUpperCase().includes(needle.toUpperCase());

/**
 * The announcement holds for about three seconds and then fades. Waiting it out
 * has to outlast the whole thing, or "it cleared itself" passes on a flash that
 * is merely still fading in. Tied to `FLASH_MS` in `@/components/draft-surface`.
 */
const FLASH_SETTLE = 3700;

/**
 * How long the room must be able to read the pick for. The feedback that set
 * this: "right now it's a split second that needs to last a couple seconds, a
 * few seconds." Checked below as a floor, not as an exact duration.
 */
const FLASH_MIN_READABLE = 2500;

/**
 * One board cell, found by the title every cell carries. Returns its rendered
 * text plus whether the content actually fits, so "the name is present" and
 * "the name is readable" can be told apart.
 */
async function cell(page, label) {
  return page.evaluate((lbl) => {
    const el = document.querySelector(`[title^=${JSON.stringify(`${lbl} — `)}]`);
    if (!el) return null;
    return {
      text: el.innerText ?? "",
      overflows: el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1,
    };
  }, label);
}

// --- The live board, borrowed -----------------------------------------------

/*
 * Nothing above this line has written anything. Everything below it resets and
 * drafts over the league's board, so the guard goes here: it refuses outright
 * if the board has picks on it, takes the lock that stops two harnesses
 * interleaving, vaults the originals to disk and wires the restore to every
 * exit path including the signals.
 *
 * `assertLocalBase` comes first, because a run aimed at the deployment should be
 * stopped before it takes a lock over a file that has no bearing on where its
 * picks are going. `assertServerHasNoPicks` comes after the borrow, because the
 * borrow is what recovers a fixture stranded by a run that died — asking first
 * would see that fixture's picks, refuse, and leave it there. It duplicates the
 * guard's own picks check on purpose: that one reads the file, this one asks the
 * server, and only this one notices a board being served from somewhere the
 * vault cannot see.
 */
assertLocalBase(BASE);
const { putBack } = borrowLiveBoard("verify:draft:typing");
await assertServerHasNoPicks(BASE);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

const consoleProblems = [];
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    consoleProblems.push(`${message.type()}: ${message.text()}`);
  }
});
page.on("pageerror", (err) => consoleProblems.push(`pageerror: ${err.message}`));

try {
  section("Setup — start from an empty board");
  await api("/api/draft/reset", { confirm: "RESET" });
  await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  let view = await boardState();
  // Read the keeper total off the board rather than hard-coding it: the league
  // data is being edited in parallel and the count is expected to move.
  const keeperBaseline = view.keeperCount;
  console.log(`  (board is carrying ${keeperBaseline} keepers)`);
  check(
    "board loads with every keeper placed and nothing entered",
    view.filled === keeperBaseline && view.picksMade === 0,
    `filled ${view.filled}, keepers ${keeperBaseline}`,
  );
  const firstOpen = view.slots.find((s) => s.fill === null);
  check(
    `the clock is on the first open slot (${firstOpen?.label})`,
    firstOpen?.onTheClock === true,
  );

  /** The slot the next Enter will fill. Read live, so added keepers cannot
   *  invalidate a hard-coded pick number. */
  const onClock = () =>
    boardState().then((v) => v.slots.find((s) => s.id === v.onTheClockSlotId) ?? null);

  // Prove the mouse is genuinely unnecessary: nothing has been clicked, and
  // the active element is still the body.
  const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? "NONE");
  check("nothing is focused — keystrokes are captured at the document", activeTag === "BODY");

  await shot(page, "01-board-empty");

  section("A misspelling still finds the player");
  // The players entered here are deliberately ones nobody is keeping. Keeper
  // data is moving underneath this script, and a test pick that quietly turns
  // into a keeper would fail as a duplicate for reasons that have nothing to do
  // with what is being tested.
  const slotA = await onClock();
  await typeAtDocument(page, "mccaffery");
  await page.waitForTimeout(200);
  const overlayText = await page.textContent("body");
  check(
    'typing "mccaffery" surfaces Christian McCaffrey',
    overlayText.includes("Christian McCaffrey"),
  );
  await shot(page, "02-typing-misspelling");

  await page.keyboard.press("Enter");
  /** When the pick landed, so the announcement's life can be timed from it. */
  const pickedAt = Date.now();
  await page.waitForTimeout(700);
  view = await boardState();
  check(
    `Enter drafted him to ${slotA.label}, no mouse involved`,
    slotByLabel(view, slotA.label)?.player?.name === "Christian McCaffrey",
    slotByLabel(view, slotA.label)?.player?.name ?? "empty",
  );
  check("the clock advanced", view.onTheClockSlotId !== slotA.id);

  section("The pick flashes up for the room");
  // The confirmation step is the ten people watching, so this checks what they
  // can actually read: who, what, where he plays, and who just got him.
  const announced = await flash(page);
  check("an announcement is on screen straight after the pick", announced !== null);
  if (announced) {
    check("it is fully visible, not still fading in", announced.opacity > 0.9);
    check("it names the player", says(announced, "Christian McCaffrey"));
    check("it gives the position", /\bRB\b/.test(announced.text));
    check("it gives the NFL team", says(announced, "SF"), announced.text);
    check("it gives the bye week", /\bBYE\s*8\b/i.test(announced.text), announced.text);
    check(
      `it names the drafting franchise (${slotA.currentOwner.name})`,
      says(announced, slotA.currentOwner.name),
    );
    check("it names the pick", says(announced, slotA.label));
  }
  await shot(page, "06-flash-midanimation");

  /*
   * The whole complaint was that it went by too fast to read, so the duration is
   * checked rather than assumed: still up, and still at full opacity — not
   * halfway through a fade — two and a half seconds after the pick landed. Timed
   * from the keystroke, with everything read since then subtracted, so the
   * assertion is about the animation and not about how long this script took.
   */
  await page.waitForTimeout(Math.max(0, pickedAt + FLASH_MIN_READABLE - Date.now()));
  const stillUp = await flash(page);
  check(
    `it is still up ${FLASH_MIN_READABLE / 1000}s later, for the room to read and argue with`,
    stillUp !== null,
  );
  check(
    "…and still solid at that point, not fading out",
    stillUp !== null && stillUp.opacity > 0.9,
    `opacity ${stillUp?.opacity ?? "gone"}`,
  );

  // The whole point is that it decorates rather than gates. Typing during the
  // flash must land, and the next pick must cut it off rather than queue.
  await typeAtDocument(page, "gibbs");
  const duringFlash = await flash(page);
  const typedThrough = await page.textContent("body");
  check(
    "the next name can be typed while it is still up",
    typedThrough.includes("Jahmyr Gibbs"),
  );
  check("…and it was genuinely still up while that happened", duringFlash !== null);
  await shot(page, "07-flash-typing-through");

  section("A bare surname is enough");
  const slotB = await onClock();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  view = await boardState();
  check(
    `typing "gibbs" + Enter drafted Jahmyr Gibbs to ${slotB.label}`,
    slotByLabel(view, slotB.label)?.player?.name === "Jahmyr Gibbs",
    slotByLabel(view, slotB.label)?.player?.name ?? "empty",
  );
  const replaced = await flash(page);
  check(
    "the new pick replaced the old announcement rather than queueing behind it",
    says(replaced, "Jahmyr Gibbs") && !says(replaced, "Christian McCaffrey"),
    replaced?.text ?? "no flash",
  );
  await page.waitForTimeout(FLASH_SETTLE);
  check("and it clears itself without being dismissed", (await flash(page)) === null);

  section("Every filled cell carries the club and the bye week");
  // Asked for by the league member who read the board: "include the city
  // abbreviation and the bye week for each player in the box." The point of
  // checking it here rather than trusting the markup is the last two: adding two
  // more facts to a 170-pixel cell must not clip the name or burst the cell.
  const mccaffrey = await cell(page, slotA.label);
  check("the cell gives the NFL club", /\bSF\b/.test(mccaffrey?.text ?? ""), mccaffrey?.text);
  check("the cell gives the bye week", /\bBYE\s*8\b/i.test(mccaffrey?.text ?? ""), mccaffrey?.text);
  /*
   * THE WHOLE NAME, BOTH WORDS OF IT.
   *
   * This asked for "C. McCaffrey" for a while: the forename was shortened to an
   * initial to keep every cell one line tall, which was the price of fitting
   * sixteen rounds on a 1080p screen. The commissioner has since withdrawn both
   * halves of that trade — "all the cells show all the data they need to show
   * with nothing truncated, clipped, covered, etc." — so the name wraps to a
   * second line and the board scrolls instead.
   */
  check(
    "a long name is printed whole, wrapped rather than shortened or clipped",
    /Christian\s+McCaffrey/.test(mccaffrey?.text ?? "") &&
      !(mccaffrey?.text ?? "").includes("…"),
    mccaffrey?.text,
  );
  check("and the cell still fits its box", mccaffrey?.overflows === false);

  section("A nickname resolves");
  const slotC = await onClock();
  await typeAtDocument(page, "saquon");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(FLASH_SETTLE);
  view = await boardState();
  check(
    `"saquon" drafted Saquon Barkley to ${slotC.label}`,
    slotByLabel(view, slotC.label)?.player?.name === "Saquon Barkley",
    slotByLabel(view, slotC.label)?.player?.name ?? "empty",
  );

  section("The duplicate warning names who has him");
  const slotD = await onClock();
  await typeAtDocument(page, "gibbs");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const warning = await page.textContent("body");
  check("it says he is already drafted", warning.includes("already drafted"));
  check("it names the round", new RegExp(`round\\s*${slotB.round}\\b`, "i").test(warning));
  const gibbsOwner = slotB.currentOwner.name;
  check(`it names the franchise holding him (${gibbsOwner})`, warning.includes(gibbsOwner));
  await shot(page, "03-duplicate-warning");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  view = await boardState();
  check(
    `Escape cancelled it — ${slotD.label} is still open`,
    slotByLabel(view, slotD.label)?.fill === null,
  );
  // Escape must clear the box too, or the next name typed appends to the one he
  // was just told was wrong. This is a real fumble, not a test artefact.
  const afterEscape = await page.textContent("body");
  check(
    "Escape also cleared the box, so the next name starts clean",
    !/gibbs▌/i.test(afterEscape),
  );

  section("…but the commissioner can overrule it");
  await typeAtDocument(page, "gibbs");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  view = await boardState();
  check(
    "a second Enter drafted him anyway",
    slotByLabel(view, slotD.label)?.player?.name === "Jahmyr Gibbs",
    slotByLabel(view, slotD.label)?.player?.name ?? "empty",
  );
  check(
    "and the board is still shouting about the duplicate",
    view.conflicts.some((c) => c.kind === "duplicate-player"),
  );

  section("Backspace edits the box — it does not undo");
  // Backspace is a reflex key. It used to undo on an empty box, and that is
  // exactly the accident nobody wants at pick 90, so the path is gone. These
  // three presses walk the box to empty and two more fall off the end of it;
  // the board must be untouched by all five.
  const beforeBackspaces = (await boardState()).filled;
  await typeAtDocument(page, "abc");
  await page.waitForTimeout(150);
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(500);
  view = await boardState();
  check(
    "five Backspaces on the way to an empty box undid nothing",
    view.filled === beforeBackspaces,
    `${beforeBackspaces} → ${view.filled}`,
  );
  check(
    `${slotD.label} still holds the override`,
    slotByLabel(view, slotD.label)?.player?.name === "Jahmyr Gibbs",
  );
  const stillTyped = await page.textContent("body");
  check("and the box really was emptied by them", !/abc▌/i.test(stillTyped));

  section("Undo, by chord only");
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(800);
  view = await boardState();
  check(
    "Ctrl+Z undid the override",
    slotByLabel(view, slotD.label)?.fill === null,
  );
  check("the duplicate warning cleared with it", view.conflicts.length === 0);

  await page.keyboard.press("Meta+z");
  await page.waitForTimeout(800);
  view = await boardState();
  check(
    `⌘Z undid the pick before that (${slotC.label})`,
    slotByLabel(view, slotC.label)?.fill === null,
  );

  section("Undo takes the announcement down with it");
  const slotE = await onClock();
  await typeAtDocument(page, "saquon");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  check("the pick is being announced", (await flash(page)) !== null);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(150);
  check(
    "…and undo cancelled it mid-animation, rather than leaving it up",
    (await flash(page)) === null,
  );
  await page.waitForTimeout(800);
  view = await boardState();
  check(`${slotE.label} is open again`, slotByLabel(view, slotE.label)?.fill === null);

  section("Reduced motion still announces the pick");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const slotF = await onClock();
  await typeAtDocument(page, "saquon");
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  const reduced = await flash(page);
  check("it still appears", says(reduced, "Saquon Barkley"));
  check(
    "but nothing scales — it only fades",
    reduced === null || reduced.transform === "none" || reduced.transform === "matrix(1, 0, 0, 1, 0, 0)",
    reduced?.transform ?? "",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(FLASH_SETTLE);
  await page.keyboard.press("Control+z");
  await page.waitForTimeout(700);
  check(
    `${slotF.label} rolled back`,
    (await boardState()).slots.find((s) => s.id === slotF.id)?.fill === null,
  );

  section("Team defenses, by the name the room actually says");
  /*
   * Ten of these go on Saturday, one per roster, in the late rounds when the
   * table is loudest. The matcher is exhaustively covered over all 32 in
   * `simulate-draft.mts`; what is checked here is the part only a browser can
   * show — that a defense drafted by nickname lands, announces itself sanely,
   * and fits its cell once the design's full-name rule has to carry a
   * twenty-one character team name.
   */
  const dstCases = [
    { typed: "niners", name: "San Francisco 49ers", nfl: "SF" },
    { typed: "patriots d", name: "New England Patriots", nfl: "NE" },
    // The longest of the 32, and the one whose bare city is nine real players.
    { typed: "washington d", name: "Washington Commanders", nfl: "WAS" },
  ];

  for (const dst of dstCases) {
    const slot = await onClock();
    await typeAtDocument(page, dst.typed);
    await page.waitForTimeout(220);
    const listed = await page.textContent("body");
    check(`"${dst.typed}" surfaces ${dst.name}`, listed.includes(dst.name));

    await page.keyboard.press("Enter");
    await page.waitForTimeout(260);

    const announced = await flash(page);
    check(`${dst.nfl} announcement names the defense`, says(announced, dst.name));
    check(`${dst.nfl} announcement says DST, not a player position`, /\bDST\b/.test(announced?.text ?? ""));
    check(`${dst.nfl} announcement gives the NFL code`, says(announced, dst.nfl));
    check(
      `${dst.nfl} announcement names the drafting franchise (${slot.currentOwner.name})`,
      says(announced, slot.currentOwner.name),
    );
    /*
     * The absurd failure this guards against: a defense whose display logic
     * pastes the city on twice — "SAN FRANCISCO SAN FRANCISCO 49ERS". Counting
     * occurrences catches it where a substring check would not.
     */
    const cityWord = dst.name.split(" ")[0].toUpperCase();
    const cityHits = (announced?.text.toUpperCase().match(new RegExp(cityWord, "g")) ?? []).length;
    check(`${dst.nfl} announcement says "${cityWord}" once, not twice`, cityHits === 1, `${cityHits}×`);
    check(
      `${dst.nfl} announcement is not clipped to an ellipsis`,
      announced?.nameClipped === false,
    );
    if (dst.nfl === "WAS") await shot(page, "10-flash-longest-defense");

    await page.waitForTimeout(FLASH_SETTLE);
    view = await boardState();
    check(
      `${dst.name} landed on ${slot.label}`,
      slotByLabel(view, slot.label)?.player?.name === dst.name,
      slotByLabel(view, slot.label)?.player?.name ?? "empty",
    );

    const drawn = await cell(page, slot.label);
    /*
     * A club is printed by its nickname. This asked for the full "San Francisco
     * 49ers" once, and the abbreviation rule that arrived for player names
     * answered it with "S. Francisco 49ers" — the city initialised as though
     * San Francisco were a man called San. The nickname is both correct and
     * shorter, so the check is that it is there and that no initial is.
     */
    const nickname = dst.name.split(" ").pop();
    check(`${slot.label} shows "${nickname}"`, drawn?.text.includes(nickname), drawn?.text);
    check(
      `${slot.label} does not initialise the city`,
      !/\b[A-Z]\.\s/.test(drawn?.text ?? ""),
      drawn?.text,
    );
    check(`${slot.label} shows no ellipsis`, !(drawn?.text ?? "").includes("…"));
    check(`${slot.label} fits its cell without overflowing`, drawn?.overflows === false);
    // The longest names in the pool are all defenses, so this is where the club
    // and bye have the least room to sit beside one.
    check(
      `${slot.label} still carries ${dst.nfl} and a bye`,
      new RegExp(`\\b${dst.nfl}\\b`).test(drawn?.text ?? "") &&
        /\bBYE\s*\d+\b/i.test(drawn?.text ?? ""),
      drawn?.text,
    );
  }
  await shot(page, "09-defenses-on-board");

  section("A populated board, for the legibility judgement");
  // Fill a realistic chunk through the API so the screenshot shows the board
  // the room will actually be staring at, keepers and traded picks included.
  const pool = await (await fetch(`${BASE}/api/draft/state`)).json();
  void pool;
  let live = await boardState();
  const { players } = await import("../data/smartdraft-players.json", {
    with: { type: "json" },
  }).then((m) => m.default ?? m);
  const ranked = players
    .filter((p) => p.position !== "K" && p.sortAdp != null)
    .sort((a, b) => a.sortAdp - b.sortAdp);

  for (let i = 0; i < 58 && live.onTheClockSlotId; i++) {
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
  await page.waitForTimeout(700);
  view = await boardState();
  check(`board populated to ${view.filled}/160 for the screenshot`, view.filled > 60);
  const full = await shot(page, "04-board-populated");

  await typeAtDocument(page, "brown");
  await page.waitForTimeout(250);
  await shot(page, "05-typing-matches");
  await page.keyboard.press("Escape");

  section("Offline — the venue wifi is not trusted");
  // Every request the page makes is recorded, and then everything that is not
  // this machine is hard-blocked. If the board needs the internet for anything
  // — a font, an API, an analytics beacon — it breaks here rather than on
  // Saturday night.
  const requested = [];
  page.on("request", (r) => requested.push(r.url()));
  await page.route("**/*", (route) => {
    const url = route.request().url();
    const local = url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:");
    return local ? route.continue() : route.abort();
  });

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const offsite = [...new Set(requested)].filter(
    (u) => !u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:"),
  );
  /*
   * ONE EXCEPTION, AND IT IS NAMED RATHER THAN WAIVED.
   *
   * The board asks FantasyPros' CDN for a player headshot when it announces a
   * pick, and nothing else off this machine, ever. That is a real change to
   * what this check used to assert, so it is stated here rather than allowed
   * to erode: the list below is the whole allowance, and any other host
   * appearing still fails.
   *
   * It is decorative and it fails closed — the announcement is already on
   * screen before the request is made, the image is out of flow so it cannot
   * move anything, and a failure draws the player's initials instead. The two
   * checks below are what hold that, with the network genuinely cut.
   *
   * Bundling the pictures instead was measured and rejected: 482 headshots is
   * 45 MB at the size a projector wants, and 7 MB at a size that looks soft on
   * one.
   */
  const ALLOWED_OFFSITE = ["https://images.fantasypros.com/"];
  const unexpected = offsite.filter((u) => !ALLOWED_OFFSITE.some((a) => u.startsWith(a)));
  check(
    "the board asks for nothing off this machine but player headshots",
    unexpected.length === 0,
    unexpected.slice(0, 3).join(", "),
  );

  // And it must still be able to take a pick with the outside world cut off.
  await typeAtDocument(page, "kittle");
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  // The animation must render from what is already on the machine. If it had
  // pulled a font or an asset, this is where the flash would come up wrong.
  const offlineFlash = await flash(page);
  check(
    "the announcement still renders with the network cut",
    says(offlineFlash, "George Kittle"),
    offlineFlash?.text ?? "no flash",
  );
  // The headshot is the only thing on the band that wanted the network, and it
  // is the only thing that may be missing. Give the blocked request a moment to
  // fail, then confirm the fallback drew rather than a hole or a broken icon.
  await page.waitForTimeout(600);
  const offlineHeadshot = await page.evaluate(() => {
    const shot = document.querySelector(".ukl-flash [data-flash-portrait]");
    if (!shot) return null;
    return { hasImg: !!shot.querySelector("img"), text: (shot.innerText ?? "").trim() };
  });
  check(
    "the headshot falls back to the player's initials with the CDN unreachable",
    offlineHeadshot?.hasImg === false && offlineHeadshot?.text === "GK",
    JSON.stringify(offlineHeadshot),
  );
  await shot(page, "08-flash-offline");
  await page.waitForTimeout(700);
  view = await boardState();
  check(
    "a pick still commits with all non-local traffic blocked",
    view.slots.some((s) => s.player?.name === "George Kittle" && s.fill === "pick"),
  );
  await page.unroute("**/*");

  section("Console health");
  const nativeButton = consoleProblems.filter((m) => m.includes("nativeButton"));
  check("no Base UI nativeButton warning", nativeButton.length === 0, nativeButton[0] ?? "");
  const other = consoleProblems.filter(
    (m) =>
      !m.includes("nativeButton") &&
      !m.includes("Download the React DevTools") &&
      // The headshot request deliberately blocked in the offline section above.
      // The browser logs a failed image load as a console error, and the check
      // that matters — that the announcement fell back to initials — is asserted
      // there directly rather than inferred from the absence of this line.
      !(m.includes("net::ERR_FAILED") && m.includes("Failed to load resource")),
  );
  check(
    "no other console errors or warnings",
    other.length === 0,
    other.slice(0, 3).join(" | "),
  );

  section("Cleanup — leave him an empty board");
  await api("/api/draft/reset", { confirm: "RESET" });
  const finalView = await boardState();
  check(
    `board reset to keepers only (${keeperBaseline})`,
    finalView.filled === keeperBaseline && finalView.picksMade === 0,
    `filled ${finalView.filled}`,
  );

  console.log(`\nFull board screenshot: ${full}`);
} finally {
  /*
   * Before the browser, so a close that throws or hangs cannot get between the
   * board and its restore. `putBack` verifies by SHA-256 and prints the one
   * command that fixes it if it cannot; it is also wired to `exit` and to the
   * signals, so this is the tidy path rather than the only one.
   */
  const back = putBack();
  await browser.close();

  section("The live draft board is back exactly as it was");
  check("every borrowed file is byte-identical to what was borrowed", back);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

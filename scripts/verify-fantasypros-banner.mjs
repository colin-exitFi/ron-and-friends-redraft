/**
 * Proves the pick announcement is identical with a headshot, without one, and
 * with the image host unreachable.
 *
 *   node scripts/verify-fantasypros-banner.mjs
 *
 * THE ASSERTION THAT MATTERS is not "a face appeared". It is that the label,
 * the name and the meta row land on the SAME PIXELS whether the picture arrives
 * or not. This board is read across a room off a projector, and a banner that
 * jumps as a headshot pops in is worse than no headshot at all — so the box is
 * reserved at a fixed size before the image exists, and this is what holds it
 * there.
 *
 * THE COMPARISON IS THE SAME PLAYER TWICE, once with the CDN reachable and once
 * with it cut, with the board reset in between. It used to be two different
 * players, which only measured anything while the band was a centred paragraph
 * whose geometry did not depend on the name in it. The band is a portrait and a
 * type column now and its width moves with the length of the name, so two
 * players would differ for reasons that have nothing to do with the image. One
 * player answers the actual question.
 *
 * The blocked case is simulated, not hoped for: FantasyPros' image host is
 * routed to a dead end at the browser level, which is what a CDN outage, a
 * pulled URL or a venue firewall all look like from inside the page.
 *
 * ============================================================================
 * IT BORROWS THE LIVE BOARD, AND IT REFUSES TO IF THE DRAFT IS RUNNING
 * ============================================================================
 *
 * The same player has to be drafted three times, so the board is reset between
 * the sections — real resets, against the real `data/draft-state-2026.json`.
 *
 * HOW THAT IS MADE SAFE IS NOT IN THIS FILE. `scripts/live-board-guard.mjs`
 * holds the refusal to run against a board with picks on it, the lock that
 * stops two harnesses interleaving, the on-disk vault, the restore on every
 * exit path and the SHA-256 verification of it — read that before changing
 * anything here.
 *
 * This script used to do its own version in this file, and restoring is only
 * the fallback. Three resets and a restore at the end still leaves the board
 * wiped for the length of the run, so a pick entered inside that window is
 * stamped over by the restore itself. The answer is not to run at all, which is
 * the guard's first act.
 *
 * `BASE` is checked before the lock is taken, and the server is asked as well as
 * the file. The vault holds a local FILE; pointed at the deployment the board is
 * a Postgres row instead, so the resets would land on the league's real draft
 * and the restore would never reach it.
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

/** Ranked #3, and FantasyPros has a picture of him. */
const WITH_IMAGE = "Ja'Marr Chase";
/**
 * Ranked #126 and FantasyPros has no headshot for him — the case the initials
 * fallback exists for. Read out of the snapshot rather than guessed.
 */
const WITHOUT_IMAGE = "KC Concepcion";

/**
 * Long enough for the band and the portrait to have finished scaling in. Every
 * geometry read below waits it out first: `getBoundingClientRect` reports the
 * transformed box, so a rect taken at 200ms measures the easing curve and two
 * of them taken at different moments will never agree.
 */
const ENTRANCE_MS = 700;

mkdirSync(OUT, { recursive: true });

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) console.log(`  ✓ ${label}`);
  else {
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

async function typeAtDocument(page, text) {
  for (const char of text) {
    await page.keyboard.press(char === " " ? "Space" : char);
    await page.waitForTimeout(12);
  }
}

/**
 * Geometry of the three text rows of the announcement, plus what the headshot
 * box is currently showing. Rounded to whole pixels: sub-pixel differences are
 * font rendering, not layout shift.
 */
async function banner(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".ukl-flash");
    if (!el) return null;
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const shot = el.querySelector("[data-flash-portrait]");
    const img = shot?.querySelector("img") ?? null;
    return {
      text: el.innerText ?? "",
      // Found by attribute rather than by position in the child list, which was
      // a property of one arrangement of the band and would have gone on
      // "passing" against whatever happened to be third once it changed.
      label: box(el.querySelector("[data-flash-label]")),
      // The same element verify-draft-typing measures for clipping.
      name: box(el.querySelector("[data-flash-name]")),
      meta: box(el.querySelector("[data-flash-meta]")),
      headshotBox: box(shot),
      hasImg: !!img,
      imgComplete: img ? img.complete && img.naturalWidth > 0 : null,
      initials: img ? null : (shot?.innerText ?? "").trim(),
    };
  });
}

async function pick(page, name) {
  await typeAtDocument(page, name);
  await page.waitForTimeout(260);
  await page.keyboard.press("Enter");
  /*
   * Waits for the band rather than for a fixed 140ms, which was a coin toss
   * against a dev server that has to write the pick to disk before the board
   * re-renders — this script failed on whichever of the three sections lost
   * the toss. The announcement's own duration is asserted in
   * `verify-draft-typing.mjs`; nothing here is timing it, so waiting for it to
   * exist gives up no coverage.
   */
  await page.waitForSelector(".ukl-flash", { timeout: 4000 }).catch(() => {});
  return banner(page);
}

async function shot(page, file) {
  const at = path.join(OUT, `${file}.png`);
  await page.screenshot({ path: at });
  console.log(`    → ${path.relative(process.cwd(), at)}`);
}

/** The four rectangles the no-shift comparison is made of. */
function rects(b) {
  return b && { label: b.label, name: b.name, meta: b.meta, box: b.headshotBox };
}

/** Back to keepers-only, so the same player can be drafted again. */
async function freshBoard(page) {
  await api("/api/draft/reset", { confirm: "RESET" });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
}

// --- The live board, borrowed -----------------------------------------------

/*
 * Nothing above this line has written anything. Everything below it resets the
 * league's board three times, so the guard goes here: it refuses outright if
 * the board has picks on it, takes the lock that stops two harnesses
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
const { putBack } = borrowLiveBoard("verify:fantasypros:banner");
await assertServerHasNoPicks(BASE);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

const geometry = {};

try {
  section("Setup");
  await api("/api/draft/reset", { confirm: "RESET" });
  await page.goto(`${BASE}/draft`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  console.log("  board reset and loaded");

  // --- 1. A player FantasyPros has a picture of ----------------------------

  section(`With a headshot — ${WITH_IMAGE}`);
  let b = await pick(page, WITH_IMAGE);
  check("the announcement is up", !!b && b.text.toUpperCase().includes("CHASE"));
  check("a headshot element is rendered", b?.hasImg === true);
  // Give the CDN a beat, then confirm the picture actually decoded.
  await page.waitForTimeout(1200);
  b = await banner(page);
  check("the image loaded from FantasyPros", b?.imgComplete === true);
  check(
    "it is beside the type, not inside the text column",
    !!b?.headshotBox && !!b?.name && b.headshotBox.x + b.headshotBox.w <= b.name.x,
    JSON.stringify({ portrait: b?.headshotBox, name: b?.name }),
  );
  /*
   * THE POINT OF THE REDESIGN, ASSERTED RATHER THAN EYEBALLED. The picture was
   * an 11vh square in the margin — a thumbnail next to a name more than twice
   * its height — and the commissioner's note was that it should be bigger and
   * a focal point. "Focal point" is a judgement, but "taller than the name it
   * sits beside" is not, and it is the floor that judgement rests on.
   */
  check(
    "the portrait is at least as tall as the name beside it",
    !!b?.headshotBox && !!b?.name && b.headshotBox.h >= b.name.h,
    `portrait ${b?.headshotBox?.h}px, name ${b?.name?.h}px`,
  );
  await shot(page, "fantasypros-banner-with-headshot");
  geometry.withImage = rects(b);
  await page.waitForTimeout(3700);

  // --- 2. A player FantasyPros has no picture of ---------------------------

  section(`Without a headshot — ${WITHOUT_IMAGE}`);
  b = await pick(page, WITHOUT_IMAGE);
  check("the announcement is up", !!b && b.text.toUpperCase().includes("CONCEPCION"));
  check("no image element is rendered at all", b?.hasImg === false);
  check("his initials are shown instead", b?.initials === "KC", `got "${b?.initials}"`);
  // Read the geometry only once the entrance has finished. The band and the
  // portrait both scale in, so a rect taken mid-animation is a rect of the
  // easing curve rather than of the layout.
  await page.waitForTimeout(ENTRANCE_MS);
  b = await banner(page);
  /*
   * A different player, so his name is a different width and the type column
   * beside the portrait is a different width with it. What must NOT differ is
   * the reserved box: an initials fallback drawn at a different size from a
   * photograph would move the eye between picks even though neither one
   * "shifted".
   */
  check(
    "the reserved box is the same size as a photographed one",
    !!b?.headshotBox &&
      b.headshotBox.w === geometry.withImage?.box.w &&
      b.headshotBox.h === geometry.withImage?.box.h,
    JSON.stringify({ withImage: geometry.withImage?.box, noImage: b?.headshotBox }),
  );
  await shot(page, "fantasypros-banner-no-headshot");
  await page.waitForTimeout(3700);

  // --- 3. The same player again, with the image host unreachable -----------

  section(`With FantasyPros' image host unreachable — ${WITH_IMAGE} again`);
  // Reset first, so this is the same player and not a second one whose name
  // happens to be a different length.
  await freshBoard(page);
  // Every request to the CDN is aborted, which is what an outage, a pulled URL
  // or the venue's wifi blocking it all look like from in here.
  await page.route("**://images.fantasypros.com/**", (route) => route.abort());

  b = await pick(page, WITH_IMAGE);
  check(
    "the announcement still comes up immediately",
    !!b && b.text.toUpperCase().includes("CHASE"),
  );
  await page.waitForTimeout(1500);
  b = await banner(page);
  check(
    "it fell back to initials rather than a broken image",
    b?.hasImg === false && b?.initials === "JC",
    `hasImg ${b?.hasImg}, initials "${b?.initials}"`,
  );
  await shot(page, "fantasypros-banner-image-blocked");
  geometry.blocked = rects(b);

  // --- 4. The point of the whole exercise ----------------------------------

  section("No layout shift");
  check(
    "the same pick lays out identically whether the headshot loads or not",
    !!geometry.withImage &&
      !!geometry.blocked &&
      JSON.stringify(geometry.withImage) === JSON.stringify(geometry.blocked),
    JSON.stringify({ withImage: geometry.withImage, blocked: geometry.blocked }),
  );
} finally {
  /*
   * The restore replaces the reset that used to be the cleanup here, and is
   * both stricter and safer: it puts the board back byte for byte rather than
   * back to whatever a reset produces. It goes before the browser so a close
   * that throws or hangs cannot get between the board and its restore.
   * `putBack` verifies by SHA-256 and is also wired to `exit` and to the
   * signals, so this is the tidy path rather than the only one.
   */
  const back = putBack();
  await browser.close();

  section("The live draft board is back exactly as it was");
  check("every borrowed file is byte-identical to what was borrowed", back);
}

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);

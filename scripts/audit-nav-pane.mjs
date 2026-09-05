/**
 * Measures the navigation pane at narrow widths, where it is a top bar and a
 * drawer rather than the desktop rail.
 *
 *   node scripts/audit-nav-pane.mjs [baseUrl] [--tag=after]
 *
 * `audit-mobile.mjs` walks every route and asks whether the PAGE fits. This
 * asks the narrower question that audit cannot reach: the drawer is closed
 * while it runs, so nothing it measures says anything about the pane the league
 * actually navigates with. This opens it.
 *
 * What it asserts, and why each one is here rather than left to the eye:
 *
 *   1. DRAWER WIDTH is the width the shell asked for. The `Sheet` primitive
 *      ships `data-[side=left]:w-3/4`, and a variant-prefixed utility outranks
 *      an unprefixed `w-[232px]` on specificity — tailwind-merge cannot drop
 *      one for the other because they are different keys. So a plain width
 *      override is silently ignored and the drawer opens at three quarters of
 *      the viewport, holding a nav list built for 232px.
 *   2. THE CREST THE BROWSER DECODED IS THE PORTRAIT CREST. This is the check
 *      that found the bug it was written for, so it is worth being precise
 *      about what it measures and why the obvious version of it passes.
 *
 *      The artwork is portrait, 232x256. `next/image` hands the bar a srcset of
 *      `w=32 1x, w=64 2x` and the drawer `w=48 1x, w=96 2x`, and each rendition
 *      is generated and cached independently. The dev image cache held a `w=64`
 *      rendition made BEFORE the crest was reissued — back when the file at
 *      that same path was a 256x256 square of the old league's mark — and did
 *      not invalidate it when the bytes underneath changed. So the mobile bar
 *      served the previous league's crest while the drawer and the rail, which
 *      ask for different widths, served the new one. Exactly the report:
 *      wrong on a phone, right on a big screen.
 *
 *      Comparing the rendered box against the decoded image's own aspect
 *      CANNOT catch that — the box is derived from the decode, so a square
 *      rendition gives a square box and the two agree. Neither can `object-fit`,
 *      which was `contain` throughout and correct. What catches it is comparing
 *      the DECODED aspect against the artwork's: a crest that decodes square is
 *      a stale rendition of a portrait file, whatever it looks like on its own
 *      terms. `naturalWidth`/`naturalHeight` are density-corrected, so a 2x
 *      candidate reports half its pixels — hence the ratio rather than the size.
 *   3. THE WORDMARK DOES NOT COLLIDE with the drawer's close button, which the
 *      primitive absolutely positions over the header.
 *   4. TAP TARGETS in the pane clear 44px of REACH — including that close
 *      button, which the primitive renders at `size-7`. Reach rather than size;
 *      see the hit-testing note in the measurement below for why the two come
 *      apart here.
 *   5. THE NAV LIST IS REACHABLE: no item clipped below the drawer, nothing
 *      overflowing sideways, and the last item hittable.
 *   6. THE DRAWER CLOSES three ways a thumb or a keyboard will try: the link,
 *      the backdrop, Escape.
 *
 * Screenshots land in `screenshots/nav-pane/<tag>/`.
 */
import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const BASE = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000";
const TAG = args.find((a) => a.startsWith("--tag="))?.slice(6) ?? "now";

const OUT = path.join(process.cwd(), "screenshots", "nav-pane", TAG);
mkdirSync(OUT, { recursive: true });

/*
 * 390 and 430 are the two iPhone widths the league is most likely to open the
 * emailed link on. 767 is the last pixel before `md`, where the drawer is at
 * its widest and the mismatch with a 232px nav list is most visible. 768 is the
 * first pixel of the rail — included with a COARSE pointer, because the shell
 * gates the rail on `pointer:fine` and a tablet at 768 must still get the
 * drawer rather than thirteen unlabelled icons it cannot hover.
 */
const SIZES = [
  { key: "phone-390", w: 390, h: 844, touch: true },
  { key: "phone-430", w: 430, h: 932, touch: true },
  { key: "narrow-767", w: 767, h: 900, touch: true },
  { key: "tablet-768", w: 768, h: 1024, touch: true },
  /*
   * The rotated handset, which is the one case where the pane is short rather
   * than narrow: 412px of height has to hold thirteen 44px rows, so the
   * drawer's list MUST scroll here or the bottom of Admin is unreachable. It is
   * also past `md`, which is the whole reason the shell gates the rail on
   * pointer instead of width.
   */
  { key: "phone-landscape-915", w: 915, h: 412, touch: true },
  { key: "se-375", w: 375, h: 667, touch: true },
];

/** The width the shell's own class asks the drawer to be. */
const WANT_DRAWER = 232;
const MIN_TAP = 44;
/** 232/256 — the aspect of `public/brand/crest-v2*.png`. */
const CREST_ASPECT = 232 / 256;
/** Generous: enough to pass every rounded rendition, nowhere near square. */
const ASPECT_SLACK = 0.03;

const crestNote = (where, c, note) => {
  console.log(
    `    ${where} crest ${c.w}x${c.h} box, decoded ${c.natural} (aspect ${c.naturalAspect}), object-fit:${c.objectFit}`,
  );
  note(`${where} crest loaded`, c.complete, c.complete ? "" : "naturalWidth 0");
  note(
    `${where} crest is the portrait artwork`,
    Math.abs(c.naturalAspect - CREST_ASPECT) < ASPECT_SLACK,
    `decoded aspect ${c.naturalAspect}, artwork ${CREST_ASPECT.toFixed(4)}` +
      (Math.abs(c.naturalAspect - 1) < ASPECT_SLACK
        ? " — SQUARE, so this is a stale rendition of the old crest"
        : ""),
  );
  note(
    `${where} crest is not stretched`,
    c.objectFit === "contain" || Math.abs(c.boxAspect - c.naturalAspect) < 0.02,
    `box ${c.boxAspect} vs decoded ${c.naturalAspect}`,
  );
};

let problems = 0;
const note = (label, ok, detail) => {
  if (!ok) problems++;
  console.log(`    ${ok ? "ok  " : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Everything about the pane, measured in the page in one pass.
 *
 * `openState` is read from the trigger's `aria-expanded` rather than from the
 * presence of the popup, so a drawer that mounts but animates to nowhere still
 * reads as a failure rather than a pass.
 */
const readPane = (page) =>
  page.evaluate(
    ({ minTap }) => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
          right: Math.round(r.right),
          bottom: Math.round(r.bottom),
        };
      };
      const visible = (el) => {
        if (!el) return false;
        const s = getComputedStyle(el);
        if (s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };

      /*
       * An <img> that is laid out to a different aspect than its own is only
       * distorted if `object-fit` lets it stretch. Report both so the caller
       * can tell a squashed crest from a merely letterboxed one.
       */
      const img = (el) => {
        if (!el) return null;
        const b = box(el);
        const nw = el.naturalWidth;
        const nh = el.naturalHeight;
        return {
          ...b,
          natural: `${nw}x${nh}`,
          naturalAspect: nh ? +(nw / nh).toFixed(4) : 0,
          boxAspect: b.h ? +(b.w / b.h).toFixed(4) : 0,
          objectFit: getComputedStyle(el).objectFit,
          complete: el.complete && nw > 0,
        };
      };

      const drawer = document.querySelector("[data-slot=sheet-content]");
      const trigger = document.querySelector("[data-slot=sheet-trigger]");
      const bar = document.querySelector("header");

      /*
       * Tap targets are measured by HIT TESTING, not by `getBoundingClientRect`.
       * A target's box and the area a thumb can land on are not the same thing:
       * the footer's settings gear keeps the design's 13px glyph and grows its
       * reach with a pseudo-element, which is hit-testable but contributes
       * nothing to the element's own rect. Measuring the rect reported that
       * target as 13px however large its reach — which would push the next
       * person to inflate the glyph and break the rail's match with the design.
       *
       * So: probe the perimeter of a `minTap` box centred on the element and
       * ask what the document says is at each point. This also, for free, fails
       * a target that is large but covered by something on top of it.
       */
      const taps = [];
      const scope = drawer ?? bar;
      if (scope) {
        scope
          .querySelectorAll("button, a[href], [role=button], [data-slot=sheet-close]")
          .forEach((el) => {
            if (!visible(el)) return;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            /*
             * Below the fold is not the same as too small. On a rotated handset
             * most of Admin is scrolled out of the list, and hit testing an
             * off-screen point returns whatever is on screen there — which read
             * as eight failing 44px targets. Whether those rows can be reached
             * is the scroll assertion's job, so anything whose centre is not
             * showing is left to it.
             *
             * "Showing" is bounded by the scroll viewport, not the window. The
             * list is clipped well above the drawer's bottom edge by the footer,
             * so a row straddling that clip has its centre inside the window and
             * nothing of itself on screen — two more phantom failures until the
             * bound came from the right box.
             */
            const clip = el.closest("[data-slot=scroll-area-viewport]");
            const cr = clip?.getBoundingClientRect();
            const left = Math.max(0, cr?.left ?? 0);
            const top = Math.max(0, cr?.top ?? 0);
            const right = Math.min(vw, cr?.right ?? vw);
            const bottom = Math.min(vh, cr?.bottom ?? vh);
            if (cx < left || cy < top || cx > right || cy > bottom) return;
            const arm = minTap / 2 - 1;
            const probes = [
              [cx, cy],
              [cx - arm, cy],
              [cx + arm, cy],
              [cx, cy - arm],
              [cx, cy + arm],
            ].filter(
              ([px, py]) => px >= left && py >= top && px <= right && py <= bottom,
            );
            const missed = probes.filter(([px, py]) => {
              const hit = document.elementFromPoint(px, py);
              return !hit || !(el.contains(hit) || hit.contains(el));
            });
            if (missed.length) {
              taps.push({
                box: Math.min(Math.round(r.width), Math.round(r.height)),
                missed: `${missed.length}/${probes.length}`,
                what:
                  (el.getAttribute("aria-label") ??
                    el.textContent ??
                    el.dataset.slot ??
                    "?")
                    .trim()
                    .slice(0, 28) || "(icon)",
              });
            }
          });
      }

      const links = drawer
        ? [...drawer.querySelectorAll("nav a[href]")].map((el) => ({
            label: (el.textContent ?? "").trim().slice(0, 20),
            ...box(el),
            clipped: el.getBoundingClientRect().bottom > vh + 1,
          }))
        : [];

      /*
       * The list's scroll viewport, so an item below the fold can be told apart
       * from an item that cannot be reached at all. On a rotated handset the
       * bottom of Admin is legitimately off screen; what matters is that it
       * scrolls into reach.
       */
      const viewport = drawer?.querySelector("[data-slot=scroll-area-viewport]");
      const scroll = viewport
        ? {
            overflow: viewport.scrollHeight - viewport.clientHeight,
            scrollable:
              viewport.scrollHeight > viewport.clientHeight &&
              getComputedStyle(viewport).overflowY !== "visible",
          }
        : null;

      const closeBtn = drawer?.querySelector("[data-slot=sheet-close]");
      /* The wordmark is the first element in the brand lockup's text column. */
      const wordmark = drawer?.querySelector("nav")
        ? drawer.querySelector("a[href='/'] .font-display")
        : null;

      return {
        vw,
        vh,
        expanded: trigger?.getAttribute("aria-expanded") ?? null,
        bar: box(bar),
        barCrest: img(bar?.querySelector("img")),
        drawer: box(drawer),
        drawerCrest: img(drawer?.querySelector("img")),
        drawerWordmark: box(wordmark),
        closeBtn: visible(closeBtn) ? box(closeBtn) : null,
        drawerScrollX: drawer ? drawer.scrollWidth - drawer.clientWidth : 0,
        scroll,
        navCount: links.length,
        navFirst: links[0] ?? null,
        navLast: links.at(-1) ?? null,
        navClipped: links.filter((l) => l.clipped).map((l) => l.label),
        taps: taps.slice(0, 8),
        tapCount: taps.length,
      };
    },
    { minTap: MIN_TAP },
  );

const browser = await chromium.launch();

for (const size of SIZES) {
  console.log(
    `\n${"═".repeat(68)}\n${size.key}  ${size.w}x${size.h}  pointer:${size.touch ? "coarse" : "fine"}\n${"═".repeat(68)}`,
  );
  const context = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: 2,
    isMobile: size.touch,
    hasTouch: size.touch,
    ...(size.touch ? { userAgent: devices["Galaxy S9+"].userAgent } : {}),
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1400);

  /* ---- closed: the bar ---- */
  const shut = await readPane(page);
  await page.screenshot({ path: path.join(OUT, `bar--${size.key}.png`) });
  console.log(`  bar  ${shut.bar?.h}px tall`);
  if (shut.barCrest) crestNote("bar", shut.barCrest, note);

  /* ---- open the drawer ---- */
  await page.locator("[data-slot=sheet-trigger]").click();
  await page.waitForTimeout(700);
  const open = await readPane(page);
  await page.screenshot({ path: path.join(OUT, `drawer--${size.key}.png`) });

  note("drawer opens", open.expanded === "true" && !!open.drawer, `aria-expanded=${open.expanded}`);
  if (open.drawer) {
    console.log(
      `  drawer ${open.drawer.w}x${open.drawer.h} at x=${open.drawer.x}  (asked for ${WANT_DRAWER}px)`,
    );
    note(
      `drawer is ${WANT_DRAWER}px wide`,
      Math.abs(open.drawer.w - WANT_DRAWER) <= 2,
      `${open.drawer.w}px`,
    );
    note("drawer does not scroll sideways", open.drawerScrollX <= 0, `+${open.drawerScrollX}px`);
  }
  if (open.drawerCrest) crestNote("drawer", open.drawerCrest, note);
  if (open.drawerWordmark && open.closeBtn) {
    note(
      "wordmark clears the close button",
      open.drawerWordmark.right <= open.closeBtn.x,
      `wordmark ends ${open.drawerWordmark.right}, close starts ${open.closeBtn.x}`,
    );
  }
  if (open.closeBtn) {
    console.log(`    close button ${open.closeBtn.w}x${open.closeBtn.h}`);
  }
  console.log(
    `  ${open.navCount} nav links, list overflows by ${open.scroll?.overflow ?? "?"}px`,
  );
  if (open.navLast) {
    console.log(
      `    last "${open.navLast.label}" at y=${open.navLast.y} h=${open.navLast.h}`,
    );
  }
  /*
   * Reachability, not visibility. A short pane is allowed to put Admin below
   * the fold; it is not allowed to strand it there.
   */
  if (open.navClipped.length === 0) {
    note("every nav link is on screen without scrolling", true);
  } else {
    note(
      "the list that overflows can be scrolled",
      open.scroll?.scrollable === true,
      `${open.navClipped.length} below the fold: ${open.navClipped.join(", ")}`,
    );
    await page.locator("[data-slot=scroll-area-viewport]").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(400);
    const scrolled = await readPane(page);
    await page.screenshot({
      path: path.join(OUT, `drawer-scrolled--${size.key}.png`),
    });
    note(
      "the last nav link scrolls into reach",
      scrolled.navClipped.length === 0,
      `still off screen: ${scrolled.navClipped.join(", ")}`,
    );
  }
  if (size.touch) {
    note(
      `pane tap targets clear ${MIN_TAP}px`,
      open.tapCount === 0,
      open.taps
        .map((t) => `"${t.what}" box ${t.box}px, ${t.missed} probes missed`)
        .join(", "),
    );
  }

  /* ---- closes on a link ---- */
  await page.locator("[data-slot=sheet-content] nav a[href='/teams']").click();
  await page.waitForTimeout(900);
  let after = await readPane(page);
  note("drawer closes on a nav link", after.expanded !== "true" && !after.drawer);

  /* ---- closes on Escape ---- */
  await page.locator("[data-slot=sheet-trigger]").click();
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  after = await readPane(page);
  note("drawer closes on Escape", after.expanded !== "true" && !after.drawer);

  /* ---- closes on the backdrop ---- */
  await page.locator("[data-slot=sheet-trigger]").click();
  await page.waitForTimeout(600);
  const opened = await readPane(page);
  if (opened.drawer) {
    await page.mouse.click(
      Math.min(size.w - 4, opened.drawer.right + (size.w - opened.drawer.right) / 2),
      Math.round(size.h / 2),
    );
    await page.waitForTimeout(700);
    after = await readPane(page);
    note("drawer closes on the backdrop", after.expanded !== "true" && !after.drawer);
  }

  await context.close();
}

await browser.close();
console.log(`\nScreenshots → ${path.relative(process.cwd(), OUT)}`);
console.log(problems === 0 ? "\nNav pane clean at every narrow width." : `\n${problems} nav-pane problems.`);
process.exit(problems === 0 ? 0 : 1);

"use client";

import { useSyncExternalStore } from "react";

import { useFullscreen } from "@/lib/use-fullscreen";

/**
 * Is this board on the projector — by either of the two ways it can get there.
 *
 * `useFullscreen` is the primitive and stays the primitive: it is what the TV
 * mode button latches to, because Esc also leaves fullscreen and the icon has
 * to follow the document. What it is NOT is a complete answer to "is the room
 * looking at this", and the layout decisions below it — the safe area, the
 * trailing space, the auto-follow — need that answer rather than that one.
 *
 * TWO THINGS IT MISSES.
 *
 *   THE KIOSK. A golf-simulator PC may be running the browser fullscreen at the
 *   OS level, where `document.fullscreenElement` is null all evening. The board
 *   would render its laptop layout on a twelve-foot screen and nothing would
 *   look broken enough for anyone to say so.
 *
 *   THE HARNESS. `document.fullscreenElement` cannot be driven from Playwright.
 *   That was established across five configurations — headless, `--start-fullscreen`,
 *   `--headless=old`, headed at a fixed viewport, headed with `viewport: null` —
 *   and it was false in every one. Any TV-mode assertion gated on it does not
 *   fail; it skips, which is how TV behaviour came to be the one part of this
 *   board that had never actually been tested.
 *
 * So `?tv=1` is the other way in, and it is the way `scripts/verify-tv-follow.mjs`
 * uses. Read straight off `window.location.search` rather than through
 * `useSearchParams`, which would drag a Suspense boundary onto the draft route
 * for one boolean.
 *
 * `useSyncExternalStore` with a subscription that never fires, because the
 * server has no window and must render the plain layout: the server snapshot is
 * false and the client's is the real answer, which is precisely the shape this
 * hook is for. It never changes after load — nothing in the app rewrites the
 * query string — so there is nothing to subscribe to.
 */
export function useTvMode(): boolean {
  const { active } = useFullscreen();
  const param = useSyncExternalStore(neverChanges, readParam, () => false);
  return active || param;
}

const neverChanges = () => () => {};
const readParam = () =>
  new URLSearchParams(window.location.search).get("tv") === "1";

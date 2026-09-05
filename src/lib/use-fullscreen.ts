"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * True browser fullscreen — "TV mode" — for the surfaces that go on the projector.
 *
 * The state is mirrored from `document.fullscreenElement` rather than stored,
 * because Esc also leaves fullscreen and a stored flag would strand the icon
 * showing the wrong thing.
 */
export function useFullscreen(): { active: boolean; toggle: () => void } {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () => setActive(Boolean(document.fullscreenElement));
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      // Rejects when the gesture is not trusted; nothing to recover, the button
      // simply does not latch.
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  return { active, toggle };
}

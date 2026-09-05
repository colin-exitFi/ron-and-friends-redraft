"use client";

import { useEffect, useRef, useState } from "react";

import { DB_SCHEMA } from "@/lib/db-schema.mjs";

export type LiveStatus = "off" | "connecting" | "live" | "polling";

/**
 * Tells the draft board when the saved draft has moved, so a pick entered on
 * someone else's device appears here.
 *
 * ============================================================================
 * WHY THIS IS NOT `RealtimeRefresher`
 * ============================================================================
 * That component answers the same question for `/keepers`, `/teams` and the
 * rest by calling `router.refresh()`. On this screen that is destructive, and
 * the migration that first left the live board out of the publication said so:
 *
 *   "a router.refresh() underneath a half-typed player name would take the
 *    keystrokes with it."
 *
 * A server re-render replaces the whole tree. Half of "Jayden Dan" in the match
 * overlay, the aimed cell, the open pick menu — all of it comes from React state
 * in `DraftBoard`, and all of it would go. During a draft the board is being
 * typed into more or less continuously, so "rare" is not a defence.
 *
 * So this hook does not refresh anything. It only reports THAT something
 * changed. The board responds by re-fetching `/api/draft/state` and calling
 * `setView`, which swaps the board data underneath the typing state and leaves
 * every keystroke where it was.
 *
 * ============================================================================
 * WHY IT ALSO POLLS
 * ============================================================================
 * Realtime is a websocket over the venue's wifi. It will drop. When the channel
 * is not subscribed this falls back to polling, because a board that is quietly
 * ten picks behind is worse than one that costs a request every few seconds —
 * and the failure it is protecting against is the one where nobody notices.
 *
 * Polling stops the moment the channel is live again, so the normal case pays
 * nothing. The poll hits `/api/draft/state` on this machine, so it costs
 * nothing off-box either.
 *
 * A dropped channel is retried a few times, slowly, before polling becomes the
 * arrangement for the night — see `RESUBSCRIBE_MS`. Venue wifi drops once and
 * comes back; the old behaviour read the first drop as a verdict.
 *
 * ============================================================================
 * WHY THE SUPABASE CLIENT IS IMPORTED LAZILY
 * ============================================================================
 * The draft board's first promise is that it works with the venue's wifi
 * unplugged. On the commissioner's laptop `enabled` is false — picks go to a
 * file on his disk, so there is no second device to sync with — and this hook
 * must then be indistinguishable from not existing.
 *
 * A static import would put the Supabase client in `/draft`'s bundle whether or
 * not it is ever constructed, which makes the offline guarantee a fact about a
 * runtime flag rather than a fact about the code. Loading it inside the enabled
 * branch means the module is never even fetched on the machine that matters,
 * and `verify:draft` can assert that nothing reachable from `/draft` imports it
 * — see the import-graph check there, which is what stops this coming back.
 */
/**
 * How long to leave a dropped channel alone before building a new one, and how
 * many times to bother.
 *
 * Fifteen seconds is chosen to be longer than a wifi hiccup and short enough
 * that a manager who looks up at the dot twice sees it go green — and it is far
 * enough apart that three attempts is not a retry loop on a screen whose job is
 * to not be busy. Three, because a network that has refused four times across
 * three quarters of a minute is not coming back on its own, and every attempt
 * after that is noise.
 */
const RESUBSCRIBE_MS = 15_000;
const RESUBSCRIBE_TRIES = 3;

/**
 * The poll interval once the socket has been given up on for good.
 *
 * Faster than the normal fallback, because at that point it is the ONLY thing
 * carrying remote picks for the rest of the night, and ten seconds behind on a
 * board the room is reading out loud is the failure nobody notices. It is a
 * request to this machine, so the only cost is one more of those.
 */
const ABANDONED_POLL_MS = 4_000;

export function useDraftLiveSync({
  enabled,
  onChanged,
  debounceMs = 300,
  pollMs = 10_000,
}: {
  /** False on the file store, where no other device can see these picks. */
  enabled: boolean;
  onChanged: () => void;
  debounceMs?: number;
  pollMs?: number;
}): LiveStatus {
  /*
   * "off" is derived rather than stored. It is a fact about the store this
   * board is talking to, not a thing the socket reports, and setting it from
   * inside the effect meant the disabled case — the commissioner's laptop —
   * paid a second render on mount to arrive at the state it started in.
   */
  const [socketStatus, setSocketStatus] = useState<Exclude<LiveStatus, "off">>("connecting");
  const status: LiveStatus = enabled ? socketStatus : "off";
  /**
   * The socket is not coming back. Kept separately from the status because it
   * changes nothing the room is shown — "syncing slowly" is still exactly what
   * is happening — and only tells the poll below to run harder.
   *
   * Never cleared. `enabled` is a fact about which store this board is talking
   * to and does not move while the draft is running, so the only thing that
   * would reset this is a remount, which brings a fresh state anyway.
   */
  const [socketGone, setSocketGone] = useState(false);

  /*
   * The callback closes over board state and so changes identity on every
   * render. Held in a ref rather than a dependency, because re-running the
   * effect would tear down and rebuild the websocket on every keystroke — the
   * bug that makes a subscription look connected while dropping events.
   */
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  }, [onChanged]);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let teardown: (() => void) | null = null;
    let attempts = 0;

    /** Close whatever channel is open. Never throws, safe to call twice. */
    const drop = () => {
      if (!teardown) return;
      const run = teardown;
      teardown = null;
      try {
        run();
      } catch {
        // A channel that will not close is not worth a second thought.
      }
    };

    /**
     * The channel dropped.
     *
     * The channel is torn down rather than left to reconnect on the Supabase
     * client's own schedule, which on a dead network is a retry loop running
     * behind a screen whose entire job is to not be busy. But a torn-down
     * channel used to be the end of it, and the effect only re-runs when the
     * store changes — so ONE hiccup on the venue's wifi left every remote board
     * up to ten seconds behind for the rest of the night. Instead a new channel
     * is built a few times, slowly, and polling covers the gaps; only after
     * that is the socket written off, and then the poll runs harder.
     */
    const lost = () => {
      if (disposed) return;
      drop();
      setSocketStatus("polling");
      attempts++;
      if (attempts >= RESUBSCRIBE_TRIES) {
        setSocketGone(true);
        return;
      }
      retry = setTimeout(connect, RESUBSCRIBE_MS);
    };

    function connect() {
      void (async () => {
        /** This attempt is still the current one. */
        let current = true;

        let createClient: typeof import("@/lib/supabase/client").createClient;
        try {
          ({ createClient } = await import("@/lib/supabase/client"));
        } catch {
          // The chunk could not be fetched — which is exactly what a dead
          // network looks like, and no number of retries fetches a chunk the
          // browser has decided it cannot have. Poll and never mention it again.
          if (!disposed) {
            setSocketStatus("polling");
            setSocketGone(true);
          }
          return;
        }
        if (disposed) return;

        const supabase = createClient();
        const channel = supabase.channel("draft-live-state");

        channel.on(
          "postgres_changes",
          /*
           * `schema` is configured HERE and not by the client's `db` option,
           * which governs `.from(...)` only. Left on the default `"public"` this
           * subscribes to the live R&F app's schema — which has no
           * `draft_live_state` at all — reports SUBSCRIBED, and then delivers
           * nothing for the rest of the night. The board would fall back to the
           * ten-second poll and look merely slow rather than broken, which is
           * the failure nobody notices until picks are arriving late in front of
           * ten people. `npm run verify:draft:realtime` is the check that this
           * is right.
           */
          { event: "*", schema: DB_SCHEMA, table: "draft_live_state" },
          () => {
            /*
             * The payload carries the whole draft document, and it is ignored on
             * purpose. The board goes and asks the API for the assembled view so
             * that a remote pick is built by exactly the same code as a local one —
             * two paths to the same board is how they end up disagreeing.
             */
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(() => {
              if (!disposed) changed.current();
            }, debounceMs);
          },
        );

        teardown = () => {
          void supabase.removeChannel(channel);
        };

        channel.subscribe((state) => {
          if (disposed || !current) return;
          if (state === "SUBSCRIBED") {
            // A channel that came back spends the retry budget again if it
            // drops later in the evening, rather than being one drop from
            // permanent polling for the rest of the night.
            attempts = 0;
            setSocketStatus("live");
            return;
          }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            // One attempt reports several of these on the way down. Only the
            // first counts, or a single drop would burn the whole budget.
            current = false;
            lost();
          }
        });

        if (disposed) drop();
      })();
    }

    connect();

    return () => {
      disposed = true;
      if (debounce) clearTimeout(debounce);
      if (retry) clearTimeout(retry);
      drop();
    };
  }, [enabled, debounceMs]);

  /* Only runs while the socket is down. See the note above. */
  useEffect(() => {
    if (!enabled || status === "live" || status === "off") return;
    // Faster once the socket has been written off, because from then on this is
    // the only thing bringing remote picks in. `Math.min`, so a caller that
    // deliberately asked for a tighter poll still gets it.
    const every = socketGone ? Math.min(pollMs, ABANDONED_POLL_MS) : pollMs;
    const timer = setInterval(() => changed.current(), every);
    return () => clearInterval(timer);
  }, [enabled, status, pollMs, socketGone]);

  return status;
}

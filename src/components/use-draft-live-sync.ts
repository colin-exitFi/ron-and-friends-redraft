"use client";

import { useEffect, useRef, useState } from "react";

import { DB_SCHEMA } from "@/lib/db-schema.mjs";
import { POLL_MS } from "@/lib/poll-interval.mjs";

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
 * nothing. The poll hits this deployment's own API, so it costs nothing off-box
 * either.
 *
 * There are three ways a pick gets here, in order of how quickly it arrives and
 * of how much has to be working for it to: the channel delivers an event; the
 * poll asks anyway, every `POLL_MS`; and coming back to the page asks at once,
 * because neither of the first two survives a phone being locked. A dropped
 * channel is rebuilt on a backoff for as long as the page is open — see
 * `RESUBSCRIBE_BACKOFF_MS`, which used to give up after three tries and leave
 * the poll carrying the rest of the evening.
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
 * How long to leave a dropped channel alone before building a new one.
 *
 * ============================================================================
 * IT NEVER STOPS TRYING, AND IT USED TO
 * ============================================================================
 * This was three attempts fifteen seconds apart, and then the socket was
 * written off for the rest of the evening. The reasoning was that a network
 * refusing four times across three quarters of a minute is not coming back —
 * which is true of a network and is not true of this. A phone that has been in
 * a pocket, a venue access point that reboots, a Realtime server that was
 * briefly unhappy: all of those come back, and all of them landed a board on
 * the poll below for the remaining three hours.
 *
 * The commissioner watched it happen and asked for exactly this: "I need that
 * to be more real-time." Polling is a floor, not a destination. A live socket
 * is the difference between a pick appearing when it is called and a pick
 * appearing on the next tick, so it is worth one handshake a minute forever.
 *
 * Backoff, so a genuinely dead network is not hammered: the first retry is fast
 * enough to cover a hiccup, and it settles at a minute apart. The budget resets
 * on every successful subscribe.
 */
const RESUBSCRIBE_BACKOFF_MS = [5_000, 15_000, 30_000, 60_000];

/**
 * Two wake-ups from the same return to the page — `visibilitychange` and
 * `focus` both fire — are one event as far as this is concerned.
 */
const WAKE_COALESCE_MS = 500;

export function useDraftLiveSync({
  enabled,
  onChanged,
  debounceMs = 300,
  pollMs = POLL_MS,
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
   * The same status, readable from an event handler that is not re-registered
   * on every render. Used only to decide whether a wake-up should rebuild the
   * channel — a live socket must not be torn down just because somebody
   * unlocked their phone.
   */
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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

  /**
   * Set by the subscription effect below, so the wake-up effect can reach the
   * channel without owning it or re-running when it changes.
   */
  const reconnectNow = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let teardown: (() => void) | null = null;
    let attempts = 0;
    /**
     * Which connection attempt is the live one.
     *
     * `connect` is async — it fetches the Supabase chunk before it has a channel
     * — so a wake-up can start a second attempt while the first is still inside
     * that await. Without a token to check on the way out, both would install
     * themselves and the first one's channel would be leaked, subscribed, with
     * nothing holding a reference able to close it.
     */
    let generation = 0;

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
     * behind a screen whose entire job is to not be busy. A new one is built on
     * the backoff above, indefinitely, while the poll below covers the gap.
     */
    const lost = () => {
      if (disposed) return;
      // Nothing from the attempt that just died counts for anything, including
      // a late SUBSCRIBED arriving after the channel was torn down.
      generation++;
      drop();
      setSocketStatus("polling");
      const wait =
        RESUBSCRIBE_BACKOFF_MS[Math.min(attempts, RESUBSCRIBE_BACKOFF_MS.length - 1)];
      attempts++;
      retry = setTimeout(connect, wait);
    };

    /**
     * Stop waiting out the backoff and try the socket right now.
     *
     * For the one case where the backoff's assumption is wrong. It is spacing
     * attempts out because the last few failed, and a phone coming out of a
     * pocket is not the same network conditions that produced those failures —
     * it is the moment most likely to succeed, and the moment somebody is
     * looking at the screen.
     */
    reconnectNow.current = () => {
      if (disposed) return;
      if (retry) {
        clearTimeout(retry);
        retry = null;
      }
      attempts = 0;
      drop();
      setSocketStatus("connecting");
      connect();
    };

    function connect() {
      const mine = ++generation;
      /** Superseded, either by a wake-up or by this attempt's own failure. */
      const stale = () => disposed || mine !== generation;

      void (async () => {
        /*
         * ONE CATCH AROUND THE WHOLE ATTEMPT, AND EVERY FAILURE IS A DROP.
         *
         * The failure this covers is a fetch of the Supabase chunk on a dead
         * network, which is what the retry above exists for. But `createClient`
         * reads the public env and throws if it is not there, and that used to
         * sit outside the catch: a deployment missing `NEXT_PUBLIC_SUPABASE_URL`
         * would take the rejection nowhere, leave the dot on "connecting" for
         * the rest of the night, and never retry — the board claiming it is
         * still trying while nothing is. Anything that goes wrong in here means
         * the same thing to the room, so it takes the same path.
         */
        try {
          const { createClient } = await import("@/lib/supabase/client");
          if (stale()) return;
          await subscribe(createClient());
        } catch {
          if (!stale()) lost();
        }
      })();

      /** Open a channel on a client that exists, and report what it does. */
      async function subscribe(
        supabase: ReturnType<typeof import("@/lib/supabase/client").createClient>,
      ) {
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

        // A wake-up landed while the chunk was loading, so this attempt's
        // channel is already obsolete. Close it here rather than installing it,
        // or it stays open with nothing able to reach it.
        if (stale()) {
          void supabase.removeChannel(channel);
          return;
        }

        teardown = () => {
          void supabase.removeChannel(channel);
        };

        channel.subscribe((state) => {
          if (stale()) return;
          if (state === "SUBSCRIBED") {
            // A channel that came back spends the backoff budget again if it
            // drops later in the evening, rather than every later drop being
            // treated as a continuation of the first one.
            attempts = 0;
            setSocketStatus("live");
            return;
          }
          if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
            // One attempt reports several of these on the way down. `lost()`
            // bumps the generation, so only the first gets through here — or a
            // single drop would burn the whole backoff.
            lost();
          }
        });

        if (disposed) drop();
      }
    }

    connect();

    return () => {
      disposed = true;
      reconnectNow.current = null;
      if (debounce) clearTimeout(debounce);
      if (retry) clearTimeout(retry);
      drop();
    };
  }, [enabled, debounceMs]);

  /* Only runs while the socket is down. See the note above. */
  useEffect(() => {
    if (!enabled || status === "live" || status === "off") return;
    const timer = setInterval(() => changed.current(), pollMs);
    return () => clearInterval(timer);
  }, [enabled, status, pollMs]);

  /*
   * ============================================================================
   * COMING BACK TO THE PAGE COUNTS AS A TICK
   * ============================================================================
   * Neither mechanism above survives a phone going in a pocket, and this is a
   * page built to be read on phones during a three-hour draft.
   *
   * A backgrounded tab has its timers throttled to roughly one a minute by
   * every mobile browser, and its websockets are liable to be suspended
   * outright — so the interval that reads "every three seconds" here is
   * "whenever the browser feels like it" there. The manager then unlocks his
   * phone, looks at the cheat sheet, and reads a pool that is a minute stale
   * while every indicator on it claims to be current. That is the failure this
   * whole hook exists to prevent, wearing a green dot.
   *
   * So returning to the page re-asks immediately, and revives the socket if it
   * is not carrying events. Same for the browser reporting the network back:
   * `online` is the one moment we know more than the backoff does.
   */
  useEffect(() => {
    if (!enabled) return;

    let last = 0;
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      // `visibilitychange` and `focus` both fire on one return to the page.
      const now = Date.now();
      if (now - last < WAKE_COALESCE_MS) return;
      last = now;

      changed.current();
      if (statusRef.current !== "live") reconnectNow.current?.();
    };

    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
    };
  }, [enabled]);

  return status;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

type Status = "connecting" | "live" | "error";

/**
 * Subscribes to postgres changes on the given tables and refreshes the current
 * route's server components when any row changes. This is the browser-side
 * fan-out: the instant our DB changes (from a sync, a refresh, or another
 * client), every open screen updates without a manual reload.
 *
 * With `showIndicator`, renders a small live/connecting pill reflecting the
 * actual channel subscription state.
 */
export function RealtimeRefresher({
  tables,
  debounceMs = 400,
  showIndicator = false,
}: {
  tables: string[];
  debounceMs?: number;
  showIndicator?: boolean;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<Status>("connecting");

  /*
   * Every caller passes an inline array — `tables={["keepers", "draft_slots"]}`
   * — which is a new identity on every render. As a dependency that made the
   * effect tear the channel down and build a new one each time this component
   * re-rendered, and since the effect's own `router.refresh()` causes a
   * re-render, an update kicked off a resubscribe. Depending on the joined
   * string instead makes the dependency the actual list of tables.
   */
  const tableKey = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`realtime:${tableKey}`);

    for (const table of tableKey.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), debounceMs);
        },
      );
    }

    channel.subscribe((state) => {
      if (state === "SUBSCRIBED") setStatus("live");
      else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") setStatus("error");
    });

    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
  }, [tableKey, debounceMs, router]);

  if (!showIndicator) return null;

  return (
    <span className="text-muted-foreground inline-flex items-center gap-1.5 text-xs">
      <span className="relative flex h-2 w-2">
        {status === "live" && (
          <span className="bg-success/70 absolute inline-flex h-full w-full animate-ping rounded-full" />
        )}
        <span
          className={cn(
            "relative inline-flex h-2 w-2 rounded-full",
            status === "live"
              ? "bg-success"
              : status === "error"
                ? "bg-destructive"
                : "bg-muted-foreground/50",
          )}
        />
      </span>
      {status === "live" ? "Live" : status === "error" ? "Offline" : "Connecting…"}
    </span>
  );
}

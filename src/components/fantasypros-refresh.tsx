"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * "Get me FantasyPros' current numbers."
 *
 * The cache holds for ten minutes, which is right for a page ten people might
 * open at once and wrong for the commissioner at 6pm wanting to know whether
 * a name moved. This forces past the TTL.
 *
 * DELIBERATELY NOT ON THE DRAFT BOARD. The board reads the committed snapshot
 * and never calls FantasyPros, which is what makes it immune to an outage;
 * putting a button there that reached out over the network would undo the
 * whole arrangement. This lives on `/players`, which is a browsing surface.
 *
 * A refresh that fails is reported and changes nothing — the previous numbers
 * stay on screen rather than being replaced by an error.
 */
export function FantasyProsRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch("/api/fantasypros/refresh", { method: "POST" });
      const body = (await res.json()) as { ok?: boolean; reason?: string | null };
      if (!body.ok) {
        setProblem(
          body.reason ??
            "FantasyPros could not be reached. The numbers below are the last good ones.",
        );
      }
      startTransition(() => router.refresh());
    } catch {
      setProblem("Could not reach the refresh route. The numbers below are unchanged.");
    } finally {
      setBusy(false);
    }
  }

  const working = busy || pending;

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={refresh}
        disabled={working}
        className={cn(
          "border-border bg-secondary text-muted-foreground hover:text-foreground",
          "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium",
          "transition-colors disabled:opacity-60 max-md:min-h-11",
        )}
      >
        <RefreshCw className={cn("h-3.5 w-3.5", working && "animate-spin")} />
        {working ? "Asking FantasyPros…" : "Refresh from FantasyPros"}
      </button>
      {problem && <span className="text-destructive max-w-prose text-xs">{problem}</span>}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";
import { DRAFTABLE_POSITIONS } from "@/lib/board-types";

export type ComboboxPlayer = {
  id: string;
  name: string;
  position: string | null;
  team: string | null;
  status?: string | null;
};

const POSITIONS = ["", ...DRAFTABLE_POSITIONS] as const;

/**
 * Fuzzy, keyboard-navigable player search. Debounced, ranked server-side.
 * ↑/↓ to move, Enter to pick, Esc to clear. Reused across draft, keepers, trades.
 */
export function PlayerCombobox({
  season,
  excludeDrafted = false,
  disabled = false,
  autoFocus = false,
  placeholder = "Search players…",
  onSelect,
}: {
  season?: number;
  excludeDrafted?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  onSelect: (player: ComboboxPlayer) => void;
}) {
  const [q, setQ] = useState("");
  const [pos, setPos] = useState("");
  const [results, setResults] = useState<ComboboxPlayer[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const search = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (season != null) params.set("season", String(season));
      if (q.trim()) params.set("q", q.trim());
      if (pos) params.set("pos", pos);
      if (excludeDrafted) params.set("excludeDrafted", "1");
      const res = await fetch(`/api/players/search?${params}`);
      const data = await res.json();
      if (res.ok) {
        setResults(data.players ?? []);
        setActive(0);
      }
    } finally {
      setLoading(false);
    }
  }, [season, q, pos, excludeDrafted]);

  useEffect(() => {
    const t = setTimeout(search, 180);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active];
      if (pick) {
        onSelect(pick);
        setQ("");
      }
    } else if (e.key === "Escape") {
      setQ("");
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          {loading && (
            <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
          )}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            className={cn(
              "border-input bg-background/60 focus-visible:border-primary/50 focus-visible:ring-primary/20 h-10 w-full rounded-lg border px-9 text-sm transition-colors outline-none focus-visible:ring-2 touch:h-11",
              disabled && "pointer-events-none opacity-50",
            )}
          />
        </div>
        <div className="flex gap-1">
          {POSITIONS.map((p) => (
            <button
              key={p || "all"}
              type="button"
              onClick={() => setPos(p)}
              disabled={disabled}
              className={cn(
                "h-8 rounded-md px-2.5 text-xs font-medium transition-colors touch:h-11 touch:min-w-11",
                pos === p
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              {p || "All"}
            </button>
          ))}
        </div>
      </div>

      <ul
        ref={listRef}
        className="border-border bg-card/40 max-h-72 divide-y divide-[var(--color-border)] overflow-y-auto rounded-lg border"
      >
        {results.length === 0 && (
          <li className="text-muted-foreground px-3 py-6 text-center text-sm">
            {loading ? "Searching…" : "No players found."}
          </li>
        )}
        {results.map((p, i) => (
          <li key={p.id}>
            <button
              type="button"
              data-idx={i}
              disabled={disabled}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                onSelect(p);
                setQ("");
              }}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                i === active ? "bg-primary/10" : "hover:bg-accent/50",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ring-1",
                  positionStyle(p.position),
                )}
              >
                {p.position ?? "—"}
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              {p.team && (
                <span className="text-muted-foreground shrink-0 font-mono text-xs">
                  {p.team}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

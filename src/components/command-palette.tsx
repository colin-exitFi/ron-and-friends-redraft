"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ClipboardCheck,
  CornerDownLeft,
  Gauge,
  Landmark,
  LayoutGrid,
  ListOrdered,
  Lock,
  NotebookPen,
  Repeat,
  Search,
  UserSearch,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";

type NavDest = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
};

const NAV_DESTS: NavDest[] = [
  { label: "Dashboard", href: "/", icon: LayoutGrid, group: "Overview" },
  { label: "Draft Board", href: "/draft", icon: ListOrdered, group: "Draft" },
  { label: "Keepers", href: "/keepers", icon: Lock, group: "Draft" },
  { label: "Trades", href: "/trades", icon: Repeat, group: "Draft" },
  { label: "Draft Notes", href: "/draft/notes", icon: NotebookPen, group: "Draft" },
  { label: "Franchises", href: "/teams", icon: Users, group: "League" },
  { label: "Calendar", href: "/calendar", icon: CalendarDays, group: "League" },
  { label: "Governance", href: "/governance", icon: Landmark, group: "League" },
  { label: "Players", href: "/players", icon: UserSearch, group: "Reference" },
  { label: "Scoring", href: "/scoring", icon: Gauge, group: "Reference" },
  { label: "Preseason Checklist", href: "/checklist", icon: ClipboardCheck, group: "Reference" },
];

type PlayerHit = { id: string; name: string; position: string | null; team: string | null };

type Row =
  | { kind: "nav"; dest: NavDest }
  | { kind: "player"; player: PlayerHit };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Global open/close shortcuts.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    function onOpen() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command", onOpen);
    };
  }, []);

  if (!open) return null;

  /*
   * The query, the matches and the cursor live in the dialog, which exists
   * only while the palette is open. MOUNTING IS THE RESET: ⌘K always lands on
   * an empty box, and nothing has to notice the palette opened and write three
   * pieces of state back to their starting values.
   */
  return <CommandPaletteDialog onClose={close} />;
}

function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ query: string; players: PlayerHit[] }>({
    query: "",
    players: [],
  });
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const query = q.trim();
  const searching = query.length >= 2;

  // Debounced player search when the query looks like a name.
  useEffect(() => {
    if (!searching) return;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/players/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (res.ok) {
          setHits({ query, players: (data.players ?? []).slice(0, 6) });
          setActive(0);
        }
      } catch {
        /* ignore */
      }
    }, 160);
    return () => clearTimeout(t);
  }, [query, searching]);

  /*
   * Matches are shown only against the query they were fetched for. Tagging
   * them beats emptying them on every keystroke: a slow answer for "mahom"
   * cannot arrive underneath a box that now reads "maho", and a name that was
   * on screen does not blink out and back while the next request is in flight.
   */
  const players = hits.query === query ? hits.players : [];

  const navMatches = NAV_DESTS.filter((d) => d.label.toLowerCase().includes(query.toLowerCase()));

  const rows: Row[] = [
    ...navMatches.map((dest) => ({ kind: "nav" as const, dest })),
    ...players.map((player) => ({ kind: "player" as const, player })),
  ];

  // The cursor can outlive the row it was sitting on; a shorter list brings it
  // home rather than pointing Enter at nothing.
  const cursor = Math.min(active, Math.max(rows.length - 1, 0));

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const go = useCallback(
    (row: Row) => {
      onClose();
      if (row.kind === "nav") router.push(row.dest.href);
      else router.push(`/players?q=${encodeURIComponent(row.player.name)}`);
    },
    [onClose, router],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(cursor + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(cursor - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[cursor];
      if (row) go(row);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] max-md:pt-[7dvh] max-md:landscape:pt-3"
      onClick={onClose}
    >
      <div className="animate-in fade-in absolute inset-0 bg-black/60 backdrop-blur-sm duration-150" />
      {/*
        Held to the DYNAMIC viewport, not `vh`. On a phone `vh` is the height with
        the URL bar retracted, so a `vh`-sized panel puts its last row under the
        browser chrome — and in landscape there are only 412px to spend.
      */}
      <div
        className="animate-in fade-in zoom-in-95 bg-popover border-border relative flex max-h-[calc(100dvh-6rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border shadow-2xl duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-border flex shrink-0 items-center gap-3 border-b px-4">
          <Search className="text-muted-foreground h-4 w-4 shrink-0" />
          {/* Focused on mount, which is when the palette opened — the dialog
              does not exist while it is closed. */}
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page or search a player…"
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="border-border text-muted-foreground hidden rounded border px-1.5 py-0.5 text-[10px] sm:block">
            ESC
          </kbd>
        </div>

        <div
          ref={listRef}
          className="max-h-[55vh] overflow-y-auto p-2 max-md:max-h-none max-md:min-h-0 max-md:flex-1"
        >
          {rows.length === 0 && (
            <p className="text-muted-foreground px-3 py-6 text-center text-sm">No matches.</p>
          )}

          {navMatches.length > 0 && (
            <p className="text-muted-foreground/60 text-eyebrow px-3 pb-1 pt-2 text-[10px]">
              Navigate
            </p>
          )}
          {rows.map((row, i) =>
            row.kind === "nav" ? (
              <button
                key={`nav-${row.dest.href}`}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(row)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  i === cursor ? "bg-primary/10 text-foreground" : "hover:bg-accent/50",
                )}
              >
                <row.dest.icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    i === cursor ? "text-primary" : "text-muted-foreground",
                  )}
                />
                <span className="flex-1 font-medium">{row.dest.label}</span>
                <span className="text-muted-foreground/50 text-[11px]">{row.dest.group}</span>
                {i === cursor && <CornerDownLeft className="text-muted-foreground h-3.5 w-3.5" />}
              </button>
            ) : null,
          )}

          {players.length > 0 && (
            <p className="text-muted-foreground/60 text-eyebrow px-3 pb-1 pt-3 text-[10px]">
              Players
            </p>
          )}
          {rows.map((row, i) =>
            row.kind === "player" ? (
              <button
                key={`pl-${row.player.id}`}
                data-idx={i}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(row)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  i === cursor ? "bg-primary/10 text-foreground" : "hover:bg-accent/50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-9 shrink-0 items-center justify-center rounded text-[10px] font-bold ring-1",
                    positionStyle(row.player.position),
                  )}
                >
                  {row.player.position ?? "—"}
                </span>
                <span className="flex-1 font-medium">{row.player.name}</span>
                {row.player.team && (
                  <span className="text-muted-foreground font-mono text-xs">
                    {row.player.team}
                  </span>
                )}
              </button>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}

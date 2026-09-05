"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, Radio, RotateCw, Search, WifiOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useDraftLiveSync } from "@/components/use-draft-live-sync";
import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";
import { DRAFTABLE_POSITIONS } from "@/lib/board-types";
import {
  applyCheatSheet,
  valueGap,
  type Availability,
  type CheatSheetMeta,
  type CheatSheetRow,
  type DraftedBy,
  type SortKey,
} from "@/lib/cheat-sheet-view";

/**
 * The live cheat sheet.
 *
 * ============================================================================
 * THE ONE REQUIREMENT: IT MUST NOT GO STALE
 * ============================================================================
 * The commissioner was explicit that this page's entire value is staying
 * current — a manager on his phone has to watch a player leave the available
 * list as the pick happens at the table, without touching anything. A stale
 * cheat sheet is worse than no cheat sheet, because somebody plans two picks
 * around a player who went four minutes ago and nothing on screen says so.
 *
 * So the live layer is the load-bearing part of this component and everything
 * else is decoration on top of it.
 *
 * ============================================================================
 * WHY IT REUSES THE DRAFT BOARD'S HOOK RATHER THAN `RealtimeRefresher`
 * ============================================================================
 * `RealtimeRefresher` answers the same question elsewhere by calling
 * `router.refresh()`. That is wrong here for the reason it is wrong on the
 * board: a server re-render replaces the whole tree, and this page has a search
 * box somebody is typing into and a sort somebody has chosen. Refreshing under
 * them would throw away a half-typed name every time anyone in the room made a
 * pick — which, during a draft, is constantly.
 *
 * `useDraftLiveSync` instead reports only THAT the board moved. This component
 * responds by re-fetching `/api/draft/state` and swapping the drafted set
 * underneath the filter state, so the typing, the sort and the scroll position
 * all survive a pick. It is the same hook, the same channel on the same
 * `redraft` schema and the same endpoint the board itself re-syncs from — one
 * mechanism, so a phone and the television cannot disagree about who is gone.
 *
 * It also inherits that hook's fallbacks for free, which matter more here than
 * anywhere: this runs on phones on a venue's wifi. A dropped socket is retried
 * a few times and then becomes a poll, and the indicator says which is
 * happening rather than showing a reassuring green dot over a dead channel.
 */
export function CheatSheet({
  rows,
  initialDrafted,
  liveEnabled,
  meta,
}: {
  rows: CheatSheetRow[];
  initialDrafted: DraftedBy;
  /**
   * Whether picks land somewhere another device can see — `savesAreShared()`.
   * False on the commissioner's laptop, where the board writes to a local file
   * and there is nothing for a phone to subscribe to. Claiming to be live then
   * would be the most expensive lie this page could tell, so the indicator says
   * "reload to update" instead.
   */
  liveEnabled: boolean;
  meta: CheatSheetMeta;
}) {
  const [drafted, setDrafted] = useState<DraftedBy>(initialDrafted);
  const [q, setQ] = useState("");
  const [position, setPosition] = useState("");
  const [availability, setAvailability] = useState<Availability>("available");
  const [sort, setSort] = useState<SortKey>("adp");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  /**
   * Re-read who is off the board.
   *
   * Only the drafted set is fetched, from an endpoint that returns only that:
   * the row data — projections, ADP, bye weeks — was computed on the server and
   * does not move during a draft, so a pick costs one small state update rather
   * than a re-render of everything. See `/api/players/drafted` for why it is
   * not the board's own 75KB room view.
   *
   * A failed fetch is swallowed on purpose. This fires on a websocket event or
   * a poll tick, both of which will come round again, and a toast every time a
   * phone walks behind a pillar would be noise during the one hour nobody wants
   * noise. The indicator already shows the connection state.
   */
  const refresh = useCallback(() => {
    void (async () => {
      try {
        const res = await fetch("/api/players/drafted", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { ok?: boolean; drafted?: DraftedBy };
        if (!body?.ok || !body.drafted) return;
        setDrafted(body.drafted);
        setSyncedAt(new Date());
      } catch {
        // See above — the next tick tries again.
      }
    })();
  }, []);

  const status = useDraftLiveSync({ enabled: liveEnabled, onChanged: refresh });

  const visible = useMemo(
    () => applyCheatSheet(rows, drafted, { q, position, availability, sort }),
    [rows, drafted, q, position, availability, sort],
  );

  const draftedCount = Object.keys(drafted).length;

  return (
    <>
      {/* Controls. Search and availability first: they are what a manager
          reaches for, and on a phone they should not be below the fold. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-xs">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search players…"
              className="pl-9 touch:h-11"
              aria-label="Search players"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="border-border bg-card/50 inline-flex rounded-md border p-0.5">
              {(
                [
                  { label: "Available", value: "available" },
                  { label: "All", value: "all" },
                  { label: "Gone", value: "drafted" },
                ] as const
              ).map((v) => (
                <button
                  key={v.value}
                  type="button"
                  onClick={() => setAvailability(v.value)}
                  className={cn(
                    "inline-flex items-center justify-center rounded px-2.5 py-1 text-xs font-medium transition-colors touch:min-h-11 touch:min-w-14",
                    availability === v.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPosition("")}
            className={cn(
              "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors touch:min-h-11 touch:min-w-14",
              !position
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            All pos
          </button>
          {DRAFTABLE_POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPosition(position === p ? "" : p)}
              className={cn(
                "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors touch:min-h-11 touch:min-w-11",
                position === p
                  ? positionStyle(p)
                  : "bg-secondary text-muted-foreground ring-transparent hover:text-foreground",
              )}
            >
              {p}
            </button>
          ))}

          <span className="text-muted-foreground ml-auto text-xs tabular-nums">
            <span className="text-foreground font-mono font-medium">
              {visible.length.toLocaleString()}
            </span>{" "}
            shown · {draftedCount.toLocaleString()} drafted
          </span>
        </div>
      </div>

      {/*
        The live indicator. Says what is actually happening rather than showing
        a green dot unconditionally — "syncing slowly" is a true and useful
        thing for a manager to know, and a board that has quietly stopped
        updating is the failure this page exists to prevent.
      */}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {liveEnabled ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              {status === "live" && (
                <span className="bg-success/70 absolute inline-flex h-full w-full animate-ping rounded-full" />
              )}
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  status === "live"
                    ? "bg-success"
                    : status === "polling"
                      ? "bg-warning"
                      : "bg-muted-foreground/50",
                )}
              />
            </span>
            {status === "live"
              ? "Live — players disappear as they are picked"
              : status === "polling"
                ? "Syncing slowly — the socket dropped, so this is checking every few seconds"
                : "Connecting…"}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            The board is saving to this machine&apos;s disk, which no other device can
            see — reload to pick up new picks.
          </span>
        )}
        {syncedAt && (
          <span className="tabular-nums">
            Updated {syncedAt.toLocaleTimeString(undefined, { timeStyle: "medium" })}
          </span>
        )}
        <button
          type="button"
          onClick={refresh}
          className="hover:text-foreground inline-flex items-center gap-1 underline-offset-2 transition-colors hover:underline touch:min-h-11"
        >
          <RotateCw className="h-3 w-3" /> Refresh now
        </button>
      </div>

      <div className="border-border bg-card/40 overflow-hidden rounded-xl border">
        <div className="max-h-[calc(100vh-380px)] overflow-auto max-md:max-h-[68dvh]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-card/95 sticky top-0 z-10 backdrop-blur">
              <tr className="border-border text-muted-foreground border-b text-left text-[11px] tracking-wide uppercase">
                <SortHeader
                  label="ADP"
                  value="adp"
                  sort={sort}
                  onSort={setSort}
                  className="w-16 text-right max-md:w-12"
                />
                <SortHeader
                  label="Player"
                  value="name"
                  sort={sort}
                  onSort={setSort}
                  className=""
                />
                <SortHeader
                  label="Pos"
                  value="position"
                  sort={sort}
                  onSort={setSort}
                  className="w-16 max-md:hidden"
                />
                <SortHeader
                  label="Proj"
                  value="points"
                  sort={sort}
                  onSort={setSort}
                  className="w-20 text-right"
                />
                <th className="w-16 px-3 py-2.5 font-medium max-md:hidden">Team</th>
                <th className="w-14 px-3 py-2.5 text-right font-medium max-md:hidden">
                  Bye
                </th>
                <th className="w-36 px-3 py-2.5 font-medium max-md:hidden">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-muted-foreground py-12 text-center">
                    {availability === "available" && draftedCount > 0
                      ? "Nobody left matching that. Try “All”."
                      : "No players match your search."}
                  </td>
                </tr>
              ) : (
                visible.map((p) => (
                  <PlayerRow key={p.id} row={p} taken={drafted[p.id] ?? null} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-muted-foreground max-w-prose text-xs">
        <span className="text-foreground font-medium">Proj</span> is projected season
        points in <span className="text-foreground">{meta.scoringFormat}</span> — this
        league&apos;s own scoring, computed here from raw projected stat lines. A tight
        end&apos;s catch is worth {meta.tePremiumReception} and a passing touchdown{" "}
        {meta.passTd}, so these are deliberately not the numbers ESPN or Sleeper would
        show you.{" "}
        <span className="text-foreground font-medium">ADP</span> is the market&apos;s
        average draft position, on ordinary scoring. Where the two disagree, the
        disagreement is the point: it is where this league prices a player differently
        from the room.
      </p>
    </>
  );
}

/** A column header that sorts. The active one carries the arrow. */
function SortHeader({
  label,
  value,
  sort,
  onSort,
  className,
}: {
  label: string;
  value: SortKey;
  sort: SortKey;
  onSort: (s: SortKey) => void;
  className?: string;
}) {
  const active = sort === value;
  return (
    <th className={cn("px-3 py-2.5 font-medium max-md:px-2", className)}>
      <button
        type="button"
        onClick={() => onSort(value)}
        aria-pressed={active}
        className={cn(
          "hover:text-foreground inline-flex items-center gap-1 uppercase transition-colors touch:min-h-11",
          className?.includes("text-right") && "flex-row-reverse",
          active && "text-foreground",
        )}
      >
        {label}
        <ArrowDown className={cn("h-3 w-3 shrink-0", !active && "opacity-0")} />
      </button>
    </th>
  );
}

/**
 * One player.
 *
 * A drafted player is struck through and dimmed rather than merely greyed —
 * the complaint that produced this page was "I cannot tell who is gone", and a
 * line through the name is legible at arm's length on a phone in a room with
 * the lights down, which a colour change is not.
 */
function PlayerRow({
  row,
  taken,
}: {
  row: CheatSheetRow;
  taken: { by: string; label: string } | null;
}) {
  const gap = valueGap(row);
  return (
    <tr
      // Named the way the board names its cells, so a verification script can
      // point at one player rather than at "the third row".
      data-player-id={row.id}
      data-taken={taken ? "true" : "false"}
      className={cn(
        "border-border/50 hover:bg-accent/40 border-b transition-colors last:border-0",
        taken && "opacity-55",
      )}
    >
      <td className="text-muted-foreground/70 px-3 py-2 text-right font-mono text-xs tabular-nums max-md:px-2 max-md:text-[10px]">
        {row.adp ?? "—"}
      </td>
      <td className="px-3 py-2 font-medium max-md:px-2">
        <span
          className={cn(
            "block max-md:truncate max-md:text-[13px]",
            taken && "text-muted-foreground line-through decoration-2",
          )}
        >
          {row.name}
        </span>
        {/* On a phone the narrow columns fold under the name rather than
            sliding off the side — the pattern this table already used. */}
        <span className="text-muted-foreground/70 mt-0.5 hidden items-center gap-1.5 font-mono text-[10px] max-md:flex">
          <span
            className={cn(
              "inline-flex h-4 min-w-[1.75rem] items-center justify-center rounded px-1 font-sans text-[9px] font-bold ring-1",
              positionStyle(row.position),
            )}
          >
            {row.position}
          </span>
          {row.pointsPositionRank
            ? `${row.position}${row.pointsPositionRank}`
            : row.positionRank
              ? `${row.position}${row.positionRank}`
              : "—"}{" "}
          · {row.team ?? "FA"}
          {row.bye != null && ` · bye ${row.bye}`}
          {taken && (
            <span className="text-destructive font-sans font-semibold">
              · {taken.label === "kept" ? "kept" : `gone ${taken.label}`} {taken.by}
            </span>
          )}
        </span>
      </td>
      <td className="px-3 py-2 max-md:hidden">
        <span
          className={cn(
            "inline-flex h-5 min-w-[2rem] items-center justify-center rounded px-1 text-[10px] font-bold ring-1",
            positionStyle(row.position),
          )}
        >
          {row.position}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums max-md:px-2 max-md:text-[10px]">
        {row.points != null ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className={cn("text-foreground", taken && "text-muted-foreground")}>
              {row.points.toFixed(1)}
            </span>
            {row.pointsPositionRank != null && (
              <span className="text-muted-foreground/60 text-[10px] max-md:hidden">
                {row.position}
                {row.pointsPositionRank}
                {/*
                  Only flagged when this league rates him at least a full round
                  of positional places above the market. Anything smaller is
                  inside the noise of two different projection sets and would
                  put a badge on half the table.
                */}
                {gap != null && gap >= 5 && (
                  <span className="text-success ml-1 font-sans font-semibold">
                    +{gap}
                  </span>
                )}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
      </td>
      <td className="text-muted-foreground px-3 py-2 font-mono text-xs max-md:hidden">
        {row.team ?? "FA"}
      </td>
      <td className="text-muted-foreground px-3 py-2 text-right font-mono text-xs tabular-nums max-md:hidden">
        {row.bye ?? "—"}
      </td>
      <td className="px-3 py-2 max-md:hidden">
        {taken ? (
          <span className="text-destructive inline-flex items-center gap-1.5 text-xs">
            {taken.label === "kept" ? "Kept" : `Gone · ${taken.label}`}
            <span className="text-muted-foreground">{taken.by}</span>
          </span>
        ) : (
          <span className="text-success/70 inline-flex items-center gap-1.5 text-xs">
            <Radio className="h-3 w-3 shrink-0" /> Available
          </span>
        )}
      </td>
    </tr>
  );
}

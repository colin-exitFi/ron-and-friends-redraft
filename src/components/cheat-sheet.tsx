"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ArrowDown,
  ChevronDown,
  Radio,
  RotateCw,
  Search,
  Sigma,
  WifiOff,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { useDraftLiveSync } from "@/components/use-draft-live-sync";
import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";
import { DRAFTABLE_POSITIONS } from "@/lib/board-types";
import {
  applyCheatSheet,
  projectedStatLine,
  projectionBreakdown,
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
  /*
   * Defaults to the LEAGUE-SCOPED board rather than to ADP. The order a manager
   * sees before he touches anything is the one that prices the tight end
   * premium; ADP is a column he can sort by when he wants to know what the room
   * will pay. If there is no export, `applyCheatSheet` falls through to ADP and
   * this default costs nothing.
   */
  const [sort, setSort] = useState<SortKey>("rank");
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  /*
   * Which players have their projection breakdown open.
   *
   * A SET, so more than one can be open at once — the question this panel
   * answers is usually comparative ("is Bowers' catch volume really worth the
   * reach over McBride"), and a panel that closes the last one every time
   * forces a manager to hold two numbers in his head under a clock.
   *
   * TAP, NOT HOVER. This lives in state and is driven by a real `<button>`
   * rather than by a `:hover` or a `title`, because the people this page was
   * built for are on phones and hover does not exist there. A breakdown that
   * only appears under a mouse pointer would be invisible to every one of them.
   */
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

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

      {/*
        WHY THE PROJECTED POINTS DISAGREE WITH EVERY BOARD THEY HAVE SEEN.

        Placed immediately above the table rather than in the footnotes, because
        it is not a credit line — it is the explanation for a discrepancy that
        otherwise reads as a defect. A manager who sees Brock Bowers priced
        above where every public site has him concludes the app is broken; one
        sentence turns that into "the tight end premium". Without it the best
        feature on the page looks like a bug.

        THE CLAIM IS DELIBERATELY NARROW AND CHECKABLE. It says this is scored
        to THIS LEAGUE'S settings and names the two rules that differ — the
        tight end premium and the six-point passing touchdown — so a sceptical
        manager can test it in ten seconds. It does NOT say no other site can do
        this: Sleeper very likely applies league scoring to its own
        projections, and one overreaching sentence would discredit the rest.

        IT ALSO DOES NOT CLAIM THE YARDAGE BONUSES. Those are per-game events
        and `pointsFromStats` cannot recover them from a season projection, so
        naming them here — tempting, since they are a genuine difference — would
        be a false claim about this column specifically. They ARE applied to the
        2025 actuals, and that column's copy says so.
      */}
      {meta.projectedCount > 0 && (
        <p className="text-muted-foreground border-border/60 bg-card/30 flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs">
          <Sigma className="text-primary mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <span className="text-foreground font-medium">Proj</span> is scored to Ron
            and Friends&apos; own settings — {meta.scoringFormat}, where a tight end
            catches at {meta.tePremiumReception} and a passing touchdown is worth{" "}
            {meta.passTd} — so it will disagree with generic cheat sheets, printed
            rankings and standard half-PPR boards.{" "}
            <span className="text-foreground/80">Tap a player</span> for the categories
            behind his number.
          </span>
        </p>
      )}

      <div className="border-border bg-card/40 overflow-hidden rounded-xl border">
        <div className="max-h-[calc(100vh-380px)] overflow-auto max-md:max-h-[68dvh]">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-card/95 sticky top-0 z-10 backdrop-blur">
              <tr className="border-border text-muted-foreground border-b text-left text-[11px] tracking-wide uppercase">
                {/* Rank first, because it is the league's own order and the
                    column a manager reads down. */}
                <SortHeader
                  label="Rk"
                  value="rank"
                  sort={sort}
                  onSort={setSort}
                  className="w-12 text-right max-md:w-9 max-md:px-1.5"
                />
                <SortHeader label="Player" value="name" sort={sort} onSort={setSort} />
                <SortHeader
                  label="Pos"
                  value="position"
                  sort={sort}
                  onSort={setSort}
                  className="w-14 max-md:hidden"
                />
                <SortHeader
                  label="Proj"
                  value="points"
                  sort={sort}
                  onSort={setSort}
                  className="w-20 text-right max-md:w-14 max-md:px-1.5"
                />
                {/* Last season, next to the projection on purpose: the whole
                    point is reading a forecast against what actually happened.
                    Hidden on a phone, where it folds under the name instead. */}
                {meta.lastSeason && (
                  <SortHeader
                    label={`${meta.lastSeason.season}`}
                    value="lastSeason"
                    sort={sort}
                    onSort={setSort}
                    className="w-20 text-right max-md:hidden"
                  />
                )}
                <SortHeader
                  label="ADP"
                  value="adp"
                  sort={sort}
                  onSort={setSort}
                  className="w-20 text-right max-md:hidden"
                />
                <th className="w-12 px-3 py-2.5 text-right font-medium max-md:hidden">
                  Tier
                </th>
                <th className="w-14 px-3 py-2.5 text-right font-medium max-md:hidden">
                  Bye
                </th>
                <th className="w-32 px-3 py-2.5 font-medium max-md:hidden">Status</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-muted-foreground py-12 text-center">
                    {availability === "available" && draftedCount > 0
                      ? "Nobody left matching that. Try “All”."
                      : "No players match your search."}
                  </td>
                </tr>
              ) : (
                visible.map((p) => (
                  <PlayerRow
                    key={p.id}
                    row={p}
                    taken={drafted[p.id] ?? null}
                    showLastSeason={meta.lastSeason != null}
                    expanded={open.has(p.id)}
                    onToggle={toggle}
                    columns={meta.lastSeason ? 9 : 8}
                    meta={meta}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-muted-foreground grid max-w-prose gap-1.5 text-xs">
        <p>
          <span className="text-foreground font-medium">Rk</span> is FantasyPros&apos;
          expert consensus{" "}
          {meta.board?.scopedToLeague ? (
            <>
              exported against this league&apos;s own settings
              {meta.board.leagueLabel ? ` (${meta.board.leagueLabel})` : ""} — so the
              order already prices the tight end premium and the {meta.passTd}-point
              passing touchdown. It is the order to draft against.
            </>
          ) : (
            <>the market&apos;s, not this league&apos;s.</>
          )}
        </p>
        <p>
          <span className="text-foreground font-medium">Proj</span> is projected season
          points in <span className="text-foreground">{meta.scoringFormat}</span>,
          computed here from raw projected stat lines — a tight end&apos;s catch is worth{" "}
          {meta.tePremiumReception} and a passing touchdown {meta.passTd}. Sorting by it
          puts quarterbacks on top, which is true and not advice: in this league they do
          score the most. The badge next to each figure is his rank within his own
          position.
        </p>
        {meta.lastSeason && (
          <p>
            <span className="text-foreground font-medium">{meta.lastSeason.season}</span>{" "}
            is what he <span className="text-foreground">actually scored</span> last
            season — Sleeper&apos;s real stat lines, re-scored here under these same
            league rules, with the season total on top and points per game under it.
            This is the one number nobody else can show you: at a full point per tight
            end catch, Trey McBride&apos;s 126 receptions were worth{" "}
            {meta.tePremiumReception * 126} points here against 63 anywhere else, which
            moves him past receivers every public list puts above him. A dash means no
            {" "}{meta.lastSeason.season} season at all — a rookie, or a defence, whose
            points-allowed scoring is a per-game band a season total cannot recover. An
            amber games count flags somebody who missed time.
          </p>
        )}
        <p>
          <span className="text-foreground font-medium">ADP</span> is the market&apos;s
          average draft position on ordinary scoring, kept precisely because it
          disagrees — the gap between it and Rk is where this league values a player
          differently from the room. The small figure beneath it is FantasyPros&apos;
          expert consensus against that ADP: green means the experts rank him that many
          places ahead of where he is being drafted, so he tends to last longer than he
          should.{" "}
          {meta.board?.tierScope === "generic" && (
            <>
              <span className="text-foreground font-medium">Tier</span> is FantasyPros&apos;
              grouping from its <span className="text-foreground">generic</span> board,
              not the league-scoped one, so a tier boundary will not line up exactly
              with the Rk order. Useful for spotting where a run starts; not a league
              number.
            </>
          )}
        </p>
      </div>
    </>
  );
}

/**
 * One player's 2026 projection, broken out by category with the arithmetic.
 *
 * ============================================================================
 * IT STACKS ON A PHONE RATHER THAN SHRINKING
 * ============================================================================
 * The layout is a two-column list — category on the left, points on the right —
 * with the rate underneath the category rather than in a third column. On a
 * 390px screen a three-column numeric grid would put four characters per cell
 * and wrap every label; this reads as a list at any width and is why the
 * breakdown went behind a tap instead of into the table.
 *
 * ============================================================================
 * WHAT IT REFUSES TO CLAIM
 * ============================================================================
 * A team defence carries FantasyPros' own total — `basis` is `"vendor"` — and
 * this panel says so plainly instead of presenting it as league-scored. Team
 * defence scoring here is dominated by a per-game points-allowed ladder that no
 * feed projects, so there is nothing to break out and pretending otherwise
 * would be inventing precision.
 *
 * It also states that the yardage and explosive bonuses are NOT in the figure.
 * They are real rules of this league and `pointsFromStats` cannot apply them to
 * a projection — there is no way to know how many 100-yard games are inside a
 * 1,400-yard season — so the total is a few points light for everybody. Saying
 * that is cheaper than having a manager find it.
 */
function ProjectionPanel({ row, meta }: { row: CheatSheetRow; meta: CheatSheetMeta }) {
  const lines = projectionBreakdown(row);

  // A vendor total, or nothing at all. Either way there is no breakdown, and
  // the panel's job becomes saying WHY rather than showing numbers.
  if (lines.length === 0) {
    return (
      <p className="text-muted-foreground max-w-prose text-xs">
        {row.points == null ? (
          <>
            Nobody projects {row.name} this season, so there is no figure to break
            down. He is on the sheet because he carries an ADP or a league rank.
          </>
        ) : (
          <>
            <span className="text-foreground font-medium">
              {row.points.toFixed(1)}
            </span>{" "}
            is FantasyPros&apos; own projected total, on their scoring rather than
            this league&apos;s — the one column on this page that is not re-scored
            here. Team defence scoring in Ron and Friends is mostly a per-game
            points-allowed ladder, and no feed projects the bands it reads, so
            there is nothing to break out and no honest way to re-score it.
          </>
        )}
      </p>
    );
  }

  const total = lines.reduce((sum, l) => sum + l.points, 0);

  return (
    <div className="grid gap-2.5">
      <div className="text-muted-foreground text-[11px] tracking-wide uppercase">
        Projected {meta.projectionSeason ?? ""}, scored in {meta.scoringFormat}
      </div>

      <dl className="grid gap-px sm:max-w-md">
        {lines.map((line) => (
          <div
            key={line.label}
            className={cn(
              "flex items-baseline justify-between gap-3 rounded px-2 py-1.5",
              // The premium line is tinted, because it is the one line that
              // explains why this league's board disagrees with every other.
              line.premium ? "bg-primary/10" : "odd:bg-card/40",
            )}
          >
            <dt className="min-w-0 text-xs">
              <span className="text-foreground/90">{line.display}</span>{" "}
              <span className="text-muted-foreground">{line.label}</span>
              <span
                className={cn(
                  "mt-px block font-mono text-[10px]",
                  line.premium ? "text-primary" : "text-muted-foreground/60",
                )}
              >
                {line.rate}
              </span>
            </dt>
            <dd
              className={cn(
                "shrink-0 font-mono text-xs tabular-nums",
                line.points < 0 ? "text-destructive/80" : "text-foreground/80",
              )}
            >
              {line.points > 0 ? "+" : ""}
              {line.points.toFixed(1)}
            </dd>
          </div>
        ))}
        <div className="border-border/60 mt-0.5 flex items-baseline justify-between gap-3 border-t px-2 pt-2">
          <dt className="text-foreground text-xs font-medium">
            Projected total
            {row.pointsPositionRank != null && (
              <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">
                {row.position}
                {row.pointsPositionRank} in this league
              </span>
            )}
          </dt>
          <dd className="text-foreground shrink-0 font-mono text-xs font-medium tabular-nums">
            {total.toFixed(1)}
          </dd>
        </div>
      </dl>

      {/* The season-over-season contrast, where there is one to draw. */}
      {row.lastSeasonPoints != null && meta.lastSeason && (
        <p className="text-muted-foreground max-w-prose text-[11px]">
          For contrast, he actually scored{" "}
          <span className="text-foreground/80 font-mono">
            {row.lastSeasonPoints.toFixed(1)}
          </span>{" "}
          in {meta.lastSeason.season}
          {row.lastSeasonPerGame != null && (
            <> ({row.lastSeasonPerGame.toFixed(1)} a game)</>
          )}
          {row.lastSeasonGames != null && <> across {row.lastSeasonGames} games</>}
          {row.lastSeasonLine && <> — {row.lastSeasonLine}</>}. That figure does
          include the yardage and explosive bonuses; the projection above cannot.
        </p>
      )}

      <p className="text-muted-foreground/70 max-w-prose text-[11px]">
        Components are FantasyPros&apos; projected stat lines. The points are
        computed here under this league&apos;s settings, so they are not
        FantasyPros&apos; own totals. The yardage and explosive-play bonuses are not
        included — they are per-game events a season projection cannot break out —
        so every player is a few points light and the order is unaffected.
      </p>
    </div>
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
  showLastSeason,
  expanded,
  onToggle,
  columns,
  meta,
}: {
  row: CheatSheetRow;
  taken: { by: string; label: string } | null;
  /** False when there is no snapshot, so the column is not drawn at all. */
  showLastSeason: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  /** How many cells the breakdown panel has to span. */
  columns: number;
  meta: CheatSheetMeta;
}) {
  const gap = valueGap(row);
  const statLine = projectedStatLine(row);
  return (
    <>
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
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums max-md:px-1.5 max-md:text-[10px]">
        <span className={cn(taken ? "text-muted-foreground/50" : "text-foreground/80")}>
          {row.leagueRank ?? "—"}
        </span>
      </td>
      <td className="px-3 py-2 font-medium max-md:px-2">
        {/*
          THE NAME IS THE TAP TARGET, and it is the biggest thing on the row —
          which is what makes this work with a thumb. A chevron on its own at
          this text size would be a 12px target on a phone; the name gives it
          the full width of the column and `touch:min-h-11` gives it the 44px
          height the rest of this app settled on.
        */}
        <button
          type="button"
          onClick={() => onToggle(row.id)}
          aria-expanded={expanded}
          aria-label={`${row.name} — show projected stat breakdown`}
          className={cn(
            "flex w-full items-center gap-1.5 text-left max-md:text-[13px] touch:min-h-11",
            taken && "text-muted-foreground line-through decoration-2",
          )}
        >
          {/*
            THE STRIKETHROUGH LIVES ON THE NAME ITSELF, not only on the button
            around it. `text-decoration` paints over descendants, so moving it
            to the wrapper looked identical on screen — and
            `verify:cheat-sheet:browser` caught that the name element's own
            computed style had gone back to `none`. That check exists because
            "I cannot tell who is gone" is the complaint this page was built to
            answer, so the one visual signal for it is asserted rather than
            eyeballed.
          */}
          <span
            className={cn(
              "min-w-0 truncate",
              taken && "line-through decoration-2",
            )}
          >
            {row.name}
          </span>
          {/* The injury flag rides ON THE NAME, at every width, and is the only
              thing added here that a phone does not fold away. It is the one
              fact on the row that can waste a pick outright, so hiding it below
              a breakpoint would hide it from exactly the people this page was
              built for. Only designations that mean he cannot play get this far
              — `buildCheatSheet` drops the preseason "Questionable" that would
              otherwise badge a fifth of the board. */}
          {row.injuryStatus && !taken && (
            <span
              className="text-destructive ring-destructive/40 bg-destructive/10 inline-flex shrink-0 items-center rounded px-1 py-px font-sans text-[9px] font-bold uppercase ring-1 no-underline"
              title={`Listed as ${row.injuryStatus} — he cannot be counted on to play`}
            >
              {row.injuryStatus}
            </span>
          )}
          {/* Only where there is something to open. A chevron on a row with no
              projection would promise a panel that never appears. */}
          {row.projectedStats && (
            <ChevronDown
              className={cn(
                "text-muted-foreground/50 h-3 w-3 shrink-0 transition-transform",
                expanded && "rotate-180",
              )}
            />
          )}
        </button>
        {/* On a phone the narrow columns fold under the name rather than
            sliding off the side — the pattern this table already used. */}
        <span className="text-muted-foreground/70 mt-0.5 hidden flex-wrap items-center gap-x-1.5 font-mono text-[10px] max-md:flex">
          <span
            className={cn(
              "inline-flex h-4 min-w-[1.75rem] items-center justify-center rounded px-1 font-sans text-[9px] font-bold ring-1",
              positionStyle(row.position),
            )}
          >
            {row.position}
            {row.leaguePositionRank ?? ""}
          </span>
          {row.team ?? "FA"}
          {row.bye != null && ` · bye ${row.bye}`}
          {row.adp != null && ` · adp ${row.adp}`}
          {/* Last season on a phone: THE PER-GAME FIGURE, not the total. There
              is room for one number and the average is the more honest one —
              a total ranks a healthy plodder over a star who missed a month,
              which is the mistake this is meant to prevent. The season total
              is a column away on a wider screen. */}
          {row.lastSeasonPerGame != null && (
            <span>
              {" · "}
              <span className="text-foreground/70">
                {row.lastSeasonPerGame.toFixed(1)}/g
              </span>
              {row.lastSeasonGames != null && ` in ${row.lastSeasonGames}`}
            </span>
          )}
          {taken && (
            <span className="text-destructive font-sans font-semibold">
              · {taken.label === "kept" ? "kept" : `gone ${taken.label}`} {taken.by}
            </span>
          )}
        </span>
        {/*
          THE POSITIONALLY RELEVANT COMPONENTS, ON THE ROW, AT EVERY WIDTH.

          He asked to see the categories, and this is the part that does not
          need a tap: a receiver's receptions, yards and touchdowns; a back's
          rushing and his catches; a quarterback's passing. Three numbers, not
          eight columns, which is the only version of this that survives a
          390px screen. `projectedStatLine` decides which three by position —
          passing yards on a running back's row would be noise.
        */}
        {statLine && (
          <span className="text-muted-foreground/60 mt-0.5 block font-mono text-[10px] max-md:text-[10px]">
            {statLine}
          </span>
        )}
      </td>
      <td className="px-3 py-2 max-md:hidden">
        <span
          className={cn(
            "inline-flex h-5 min-w-[2.25rem] items-center justify-center rounded px-1 text-[10px] font-bold ring-1",
            positionStyle(row.position),
          )}
        >
          {row.position}
          {row.leaguePositionRank ?? ""}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums max-md:px-1.5 max-md:text-[10px]">
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
                  Only flagged when this league's projection rates him at least
                  a full round of positional places above the market's ADP.
                  Anything smaller is inside the noise of two projection sets
                  and would put a badge on half the table.
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
      {/*
        LAST SEASON, AS IT ACTUALLY HAPPENED, PRICED IN THIS LEAGUE.
        The season total on top and the per-game average under it, because the
        two say different things and a manager needs both in one glance: Brock
        Bowers' 178 looks ordinary until the 14.9 a game next to it says he
        missed five. A blank is a rookie or a defence and is styled as a dash
        rather than a zero, since "no season" and "a bad season" must not read
        the same.
      */}
      {showLastSeason && (
        <td className="px-3 py-2 text-right font-mono text-xs tabular-nums max-md:hidden">
          {row.lastSeasonPoints != null ? (
            <span className="inline-flex flex-col items-end leading-tight">
              <span className={cn("text-foreground/80", taken && "text-muted-foreground")}>
                {row.lastSeasonPoints.toFixed(1)}
              </span>
              {row.lastSeasonPerGame != null && (
                <span
                  className="text-muted-foreground/60 text-[10px]"
                  title={
                    row.lastSeasonLine
                      ? `${row.lastSeasonLine} in ${row.lastSeasonGames} games`
                      : undefined
                  }
                >
                  {row.lastSeasonPerGame.toFixed(1)}/g
                  {/* Games played, but only when he missed some. Printing "17"
                      on four hundred rows adds nothing; printing "12" on the
                      ones who got hurt is the whole signal. */}
                  {row.lastSeasonGames != null && row.lastSeasonGames < 16 && (
                    <span className="text-warning/80 ml-1">
                      {row.lastSeasonGames}g
                    </span>
                  )}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground/40">—</span>
          )}
        </td>
      )}
      <td className="text-muted-foreground/70 px-3 py-2 text-right font-mono text-xs tabular-nums max-md:hidden">
        {row.adp != null ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <span>{row.adp}</span>
            {/*
              FANTASYPROS' OWN EXPERT-CONSENSUS-VERSUS-ADP, WHICH HAS BEEN
              SITTING IN THE EXPORT UNRENDERED. Positive means the experts rank
              him ahead of where he is being drafted — he is available later
              than he should be. It is a different claim from the `+n` badge in
              the Proj column, which is THIS LEAGUE's scoring disagreeing with
              the market, so the two are deliberately not merged.

              Only shown past a full round's worth of places. Below that it is
              inside the noise of a consensus and would decorate every row.
            */}
            {row.ecrVsAdp != null && Math.abs(row.ecrVsAdp) >= 10 && (
              <span
                className={cn(
                  "text-[10px]",
                  row.ecrVsAdp > 0 ? "text-success/80" : "text-muted-foreground/50",
                )}
                title={
                  row.ecrVsAdp > 0
                    ? `The experts rank him ${row.ecrVsAdp} places ahead of where he is going — a value`
                    : `He is going ${Math.abs(row.ecrVsAdp)} places ahead of where the experts rank him — a reach`
                }
              >
                {row.ecrVsAdp > 0 ? `+${row.ecrVsAdp}` : row.ecrVsAdp}
              </span>
            )}
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono text-xs tabular-nums max-md:hidden">
        {row.tier != null ? (
          <span className="bg-secondary text-muted-foreground inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded px-1 text-[10px]">
            {row.tier}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )}
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
    {/*
      THE FULL BREAKDOWN, ON TAP.

      A FULL-WIDTH PANEL RATHER THAN EXTRA COLUMNS, which is the whole reason
      this shape was chosen: eight numeric columns cannot coexist with a 390px
      screen, and a panel that spans the row has as much space on a phone as it
      does on a television. It stacks instead of shrinking.

      IT SHOWS THE ARITHMETIC, NOT JUST THE STATS. Every line carries the
      projected component, the rate this league pays for it, and the points it
      contributes — so the tight end premium is visible as a line item doing its
      work rather than asserted in a footnote. That is the difference between
      "the app says 260" and "94 catches at a full point each".
    */}
    {expanded && (
      <tr data-breakdown-for={row.id} className="border-border/50 border-b last:border-0">
        <td colSpan={columns} className="bg-card/60 px-3 py-3 max-md:px-2">
          <ProjectionPanel row={row} meta={meta} />
        </td>
      </tr>
    )}
    </>
  );
}

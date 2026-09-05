"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowDown, ArrowLeftRight, RotateCw, Search, Sigma, WifiOff } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useDraftLiveSync } from "@/components/use-draft-live-sync";
import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";
import { DRAFTABLE_POSITIONS } from "@/lib/board-types";
import {
  applyCheatSheet,
  valueGap,
  FLEX_FILTER,
  FLEX_POSITIONS,
  type StatColumn,
  type Availability,
  type CheatSheetMeta,
  type CheatSheetRow,
  type DraftedBy,
  type SortKey,
} from "@/lib/cheat-sheet-view";

/*
 * ============================================================================
 * THE FROZEN COLUMN IS ONE CELL, AND THAT IS THE POINT
 * ============================================================================
 * Rank, name and position pin as a single `sticky left-0` cell rather than as
 * two or three cells at increasing offsets. Two sticky cells need the second
 * one's offset to equal the first one's rendered width, and a table will not
 * promise you that: under automatic layout the rank column came out wider than
 * asked (its heading's sort arrow set the minimum), and under `table-fixed` any
 * space left over after the declared widths gets distributed across every
 * column — so the two numbers disagreed by 7px at one width and 11px at
 * another, and the name slid on top of the rank on every sideways scroll.
 *
 * At `left-0` there is no offset to get wrong. It is also the only arrangement
 * that cannot break when the table is wider than the sum of its columns, which
 * is every desktop screen.
 */
const FROZEN_ID = "sticky left-0 w-[11.5rem] max-md:w-[10.25rem] px-2";

/**
 * The projected-stat columns, in order, with the headings that fit.
 *
 * Passing yards, passing touchdowns and interceptions are here despite not
 * being on the commissioner's list, because without them every quarterback row
 * is nine blank cells — and this league pays six points for a passing
 * touchdown, so the quarterback column is the one where its scoring diverges
 * most from a stock board.
 */
const STAT_HEADERS: { value: StatColumn; label: string }[] = [
  { value: "passYards", label: "Pass yd" },
  { value: "passTd", label: "Pass TD" },
  { value: "interceptions", label: "Int" },
  { value: "rushYards", label: "Rush yd" },
  { value: "rushTd", label: "Rush TD" },
  { value: "receptions", label: "Rec" },
  { value: "recYards", label: "Rec yd" },
  { value: "recTd", label: "Rec TD" },
  { value: "fumblesLost", label: "Fum" },
];

/** Identity, 2025, Proj, the stats, ADP, Tier, Bye. For the empty row. */
const COLUMN_COUNT = 3 + STAT_HEADERS.length + 3;

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
          {/*
            FLEX, WHICH IS NOT A POSITION.

            Late in the draft the question is not "which receiver" — it is "who
            is the best player I would actually start", and the answer can be a
            back, a receiver or a tight end. So this widens the pool to the three
            positions this league's FLEX slots accept and leaves the sort alone,
            which is the whole feature: the order across the combined pool is
            what makes it an answer rather than three lists at once.

            LAST IN THE ROW, AFTER THE FIVE REAL POSITIONS, because it is a
            different kind of thing from them and the row is muscle memory by
            now. It carries the ring-and-tint treatment the positions use rather
            than "All pos"' solid fill, since it selects a subset the same way
            they do.
          */}
          <button
            type="button"
            onClick={() =>
              setPosition(position === FLEX_FILTER ? "" : FLEX_FILTER)
            }
            title={`Running backs, receivers and tight ends together — the ${FLEX_POSITIONS.join("/")} pool, in whatever order is sorted`}
            className={cn(
              "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors touch:min-h-11 touch:min-w-11",
              position === FLEX_FILTER
                ? "bg-primary/15 text-primary ring-primary/40"
                : "bg-secondary text-muted-foreground ring-transparent hover:text-foreground",
            )}
          >
            {FLEX_FILTER}
          </button>

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
            Every column below is his projected {meta.projectionSeason ?? ""} stat line.
          </span>
        </p>
      )}

      {/*
        THE SWIPE, SAID IN WORDS AS WELL AS SHOWN.
        The edge fade is the visual cue; this is the one that survives somebody
        glancing at the page for four seconds before the clock starts. It also
        says the identity column stays put, which is the fact that makes swiping
        feel safe rather than like losing your place.
      */}
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <ArrowLeftRight className="text-primary h-3.5 w-3.5 shrink-0" />
        Scroll the table sideways for the rest of the columns — the rank, name and
        position stay put. Tap any heading to sort the whole pool by it.
      </p>

      {/*
        THE SPREADSHEET.

        ============================================================================
        WHY THIS IS A SIDEWAYS-SCROLLING GRID AND NOT A PANEL
        ============================================================================
        The commissioner asked for "a spreadsheet you can scroll left and right",
        and the first attempt at showing the stats gave him a tap-to-expand panel
        with the scoring arithmetic in it instead. He did not want the arithmetic
        — he wanted columns of numbers he can swipe across and read down. So the
        panel is gone and this is plain columns.

        EVERY ROW HAS EVERY COLUMN. A quarterback's receptions cell is blank, not
        missing. Varying the columns by position would break the one thing that
        makes a spreadsheet worth having: that a column means the same thing all
        the way down it, so sorting by it and comparing across rows both work.

        THE IDENTITY COLUMN IS FROZEN, which is the requirement everything else
        depends on. Rank, name and position stay pinned under `sticky left-0`
        while the numbers scroll beneath the thumb; a column of figures with no
        name attached to it is useless, and on a 375px screen the name is off the
        left edge within two swipes without this.
      */}
      <div className="border-border bg-card/40 relative overflow-hidden rounded-xl border">
        <div
          data-sheet-scroll
          className="max-h-[calc(100vh-380px)] overflow-auto max-md:max-h-[68dvh]"
        >
          {/*
            `w-max` rather than `w-full`: the table is allowed to be wider than
            the box, which is what gives the container something to scroll.
            `min-w-full` keeps it filling a desktop screen.
          */}
          {/*
            `table-fixed` IS LOAD-BEARING, NOT TIDINESS. With automatic layout a
            column is as wide as its widest content, so the rank column came out
            wider than the `w-9` asked for — its heading's sort arrow set the
            minimum — and the name column's `left-9` offset was then 11px short,
            which slid the name over the rank on every sideways scroll. Fixed
            layout makes the declared widths the actual widths, so the frozen
            offset below is arithmetic rather than a guess.
          */}
          <table className="w-max min-w-full table-fixed border-collapse text-sm">
            <thead className="bg-card sticky top-0 z-20">
              <tr className="border-border text-muted-foreground border-b text-left text-[11px] tracking-wide uppercase">
                {/* Both sorts the identity column offers, in the one frozen
                    cell: the league's own order, which is the column a manager
                    reads down, and alphabetical for looking somebody up. */}
                <th className={cn(FROZEN_ID, "bg-card z-30 py-2.5 font-medium")}>
                  <span className="flex items-center gap-2.5">
                    <SortButton label="Rk" value="rank" sort={sort} onSort={setSort} />
                    <SortButton
                      label="Player"
                      value="name"
                      sort={sort}
                      onSort={setSort}
                    />
                  </span>
                </th>
                {/* THE TWO FIGURES PEOPLE ACTUALLY DECIDE ON, immediately right
                    of the frozen block so they are readable without a swipe:
                    what he scored last season and what he is projected for, both
                    in this league's points. */}
                {meta.lastSeason && (
                  <SortHeader
                    label={`${meta.lastSeason.season}`}
                    value="lastSeason"
                    sort={sort}
                    onSort={setSort}
                    className="w-16 text-right"
                  />
                )}
                <SortHeader
                  label="Proj"
                  value="points"
                  sort={sort}
                  onSort={setSort}
                  className="w-16 text-right"
                />
                {STAT_HEADERS.map((c) => (
                  <SortHeader
                    key={c.value}
                    label={c.label}
                    value={c.value}
                    sort={sort}
                    onSort={setSort}
                    className="w-16 text-right"
                  />
                ))}
                <SortHeader
                  label="ADP"
                  value="adp"
                  sort={sort}
                  onSort={setSort}
                  className="w-16 text-right"
                />
                <th className="w-12 px-2 py-2.5 text-right font-medium">Tier</th>
                <th className="w-12 px-2 py-2.5 text-right font-medium">Bye</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMN_COUNT}
                    className="text-muted-foreground py-12 text-center"
                  >
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
                    mixedPositions={position === FLEX_FILTER}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
        {/*
          THE EDGE FADE, WHICH IS THE ONLY THING THAT TELLS ANYBODY TO SWIPE.
          A row that appears to end at the right edge of the card reads as
          finished, and nobody drags a table they think they can already see all
          of. Outside the scroll container so it stays put, and
          `pointer-events-none` so it does not eat the drag it exists to invite.
        */}
        <div className="from-card pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent" />
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
 * The sorting control on its own, without a `<th>` around it.
 *
 * Exists because the frozen identity cell has to offer two sorts — the league's
 * rank order and alphabetical — out of a single table cell, and a `<th>` per
 * sort is exactly what the frozen column cannot have.
 */
function SortButton({
  label,
  value,
  sort,
  onSort,
}: {
  label: string;
  value: SortKey;
  sort: SortKey;
  onSort: (s: SortKey) => void;
}) {
  const active = sort === value;
  return (
    <button
      type="button"
      onClick={() => onSort(value)}
      aria-pressed={active}
      className={cn(
        "hover:text-foreground inline-flex items-center gap-1 uppercase transition-colors touch:min-h-11",
        active && "text-foreground",
      )}
    >
      {label}
      <ArrowDown className={cn("h-3 w-3 shrink-0", !active && "opacity-0")} />
    </button>
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
 * One numeric cell.
 *
 * RIGHT-ALIGNED, TABULAR, AND FIXED TO THE DECIMAL PLACE ITS COLUMN USES, which
 * together are what let somebody read straight down a column instead of
 * comparing digits. Yardage is whole numbers, touchdowns and receptions are one
 * decimal, and a column never mixes the two.
 *
 * A MISSING FIGURE IS AN EM DASH, NOT AN EMPTY CELL. A blank cell reads as a
 * rendering failure and invites a manager to distrust the rest of the row; a
 * dash reads as "there is no number for this", which is the truth for a rookie,
 * a team defence, or anybody the feed does not project.
 */
function Num({
  value,
  decimals = 0,
  className,
}: {
  value: number | null | undefined;
  decimals?: number;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "text-foreground/80 px-2 py-2 text-right font-mono text-xs tabular-nums max-md:text-[11px]",
        className,
      )}
    >
      {value == null ? (
        <span className="text-muted-foreground/30">—</span>
      ) : (
        value.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      )}
    </td>
  );
}

/**
 * One player, as a spreadsheet row.
 *
 * A drafted player is struck through and dimmed rather than merely greyed —
 * the complaint that produced this page was "I cannot tell who is gone", and a
 * line through the name is legible at arm's length on a phone in a room with
 * the lights down, which a colour change is not. The strikethrough lives on the
 * name's own element rather than on a wrapper, because `text-decoration` paints
 * over descendants and moving it up looked identical on screen while leaving the
 * name's computed style at `none` — `verify:cheat-sheet:browser` asserts the
 * name element itself, so the one visual signal for "gone" cannot quietly go.
 */
function PlayerRow({
  row,
  taken,
  showLastSeason,
  mixedPositions,
}: {
  row: CheatSheetRow;
  taken: { by: string; label: string } | null;
  /** False when there is no snapshot, so the column is not drawn at all. */
  showLastSeason: boolean;
  /**
   * Whether the list this row sits in holds more than one position — the FLEX
   * filter. In a single-position view the badge restates the filter and can be
   * the smallest thing on the row; in a mixed one it is the only thing telling
   * two adjacent names apart, so it gets the same size as the text beside it.
   */
  mixedPositions: boolean;
}) {
  const gap = valueGap(row);
  const s = row.projectedStats;
  /*
   * A PROJECTED ZERO AND NO PROJECTION AT ALL ARE DIFFERENT FACTS, and the grid
   * shows them differently. If the feed projects this player, a category he does
   * not register in is a real zero — a quarterback catches no passes, and "0" is
   * the honest cell. If it projects him not at all, every stat cell is a dash.
   */
  const stat = (key: StatColumn) => (s ? (s[key] ?? 0) : null);

  return (
    <tr
      // Named the way the board names its cells, so a verification script can
      // point at one player rather than at "the third row". The name is an
      // attribute because it is no longer the whole of any cell's text.
      data-player-id={row.id}
      data-player-name={row.name}
      data-league-rank={row.leagueRank ?? ""}
      data-taken={taken ? "true" : "false"}
      className={cn(
        "border-border/50 border-b transition-colors last:border-0",
        taken && "opacity-55",
      )}
    >
      {/*
        THE FROZEN BLOCK. `bg-card` rather than a tint, because these two cells
        sit ON TOP of the numeric columns as they scroll past underneath and a
        translucent fill would show the digits through the player's name.
      */}
      <td data-name-cell className={cn(FROZEN_ID, "bg-card z-10 py-2 align-top")}>
        <span className="flex items-start gap-2">
          <span
            className={cn(
              "w-5 shrink-0 text-right font-mono text-[10px] tabular-nums",
              taken ? "text-muted-foreground/50" : "text-foreground/80",
            )}
          >
            {row.leagueRank ?? "—"}
          </span>
          <span className="min-w-0 flex-1">
        <span
          data-name-text
          className={cn(
            "block truncate text-[13px] font-medium",
            taken && "text-muted-foreground line-through decoration-2",
          )}
        >
          {row.name}
        </span>
        {/*
          POSITION, PINNED WITH THE NAME. It belongs in the frozen block rather
          than in a column of its own: in the FLEX view it is the only thing
          distinguishing two adjacent rows, and a position that scrolled off the
          left edge with the stats would be no use there at all.

          The injury flag rides here too, at every width. It is the one fact on
          the row that can waste a pick outright, so it is not allowed behind a
          breakpoint. Only designations that mean he cannot play get this far —
          `buildCheatSheet` drops the preseason "Questionable" that would
          otherwise badge a fifth of the board.
        */}
        <span className="text-muted-foreground/70 mt-0.5 flex flex-wrap items-center gap-x-1 font-mono text-[10px]">
          <span
            data-position-badge={row.position}
            className={cn(
              "inline-flex items-center justify-center rounded px-1 font-sans font-bold ring-1",
              positionStyle(row.position),
              mixedPositions
                ? "h-[1.125rem] min-w-8 text-[10px]"
                : "h-4 min-w-[1.75rem] text-[9px]",
            )}
          >
            {row.position}
            {row.leaguePositionRank ?? ""}
          </span>
          {row.team ?? "FA"}
          {row.injuryStatus && !taken && (
            <span
              className="text-destructive ring-destructive/40 bg-destructive/10 inline-flex shrink-0 items-center rounded px-1 py-px font-sans text-[9px] font-bold uppercase ring-1"
              title={`Listed as ${row.injuryStatus} — he cannot be counted on to play`}
            >
              {row.injuryStatus}
            </span>
          )}
          {taken && (
            <span className="text-destructive font-sans font-semibold">
              {taken.label === "kept" ? "kept" : `gone ${taken.label}`} {taken.by}
            </span>
          )}
        </span>
          </span>
        </span>
      </td>

      {/*
        LAST SEASON, AS IT ACTUALLY HAPPENED, PRICED IN THIS LEAGUE.
        The season total on top and the per-game average under it, because the
        two say different things and a manager needs both in one glance: Brock
        Bowers' 178 looks ordinary until the 14.9 a game next to it says he
        missed five. A blank is a rookie or a defence and is a dash rather than a
        zero, since "no season" and "a bad season" must not read the same.
      */}
      {showLastSeason && (
        <td className="px-2 py-2 text-right font-mono text-xs tabular-nums max-md:text-[11px]">
          {row.lastSeasonPoints != null ? (
            <span className="inline-flex flex-col items-end leading-tight">
              <span
                className={cn("text-foreground/80", taken && "text-muted-foreground")}
              >
                {row.lastSeasonPoints.toFixed(1)}
              </span>
              {row.lastSeasonPerGame != null && (
                <span
                  className="text-muted-foreground/60 text-[9px]"
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
                    <span className="text-warning/80 ml-0.5">{row.lastSeasonGames}g</span>
                  )}
                </span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground/30">—</span>
          )}
        </td>
      )}

      <td className="px-2 py-2 text-right font-mono text-xs tabular-nums max-md:text-[11px]">
        {row.points != null ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <span className={cn("text-foreground", taken && "text-muted-foreground")}>
              {row.points.toFixed(1)}
            </span>
            {row.pointsPositionRank != null && (
              <span className="text-muted-foreground/60 text-[9px]">
                {row.position}
                {row.pointsPositionRank}
                {/*
                  Only flagged when this league's projection rates him at least
                  a full round of positional places above the market's ADP.
                  Anything smaller is inside the noise of two projection sets
                  and would put a badge on half the table.
                */}
                {gap != null && gap >= 5 && (
                  <span className="text-success ml-0.5 font-sans font-semibold">
                    +{gap}
                  </span>
                )}
              </span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground/30">—</span>
        )}
      </td>

      {/* THE STAT COLUMNS, IN THE SAME ORDER ON EVERY ROW. */}
      <Num value={stat("passYards")} />
      <Num value={stat("passTd")} decimals={1} />
      <Num value={stat("interceptions")} decimals={1} />
      <Num value={stat("rushYards")} />
      <Num value={stat("rushTd")} decimals={1} />
      <Num value={stat("receptions")} decimals={1} />
      <Num value={stat("recYards")} />
      <Num value={stat("recTd")} decimals={1} />
      <Num value={stat("fumblesLost")} decimals={1} />

      <td className="text-muted-foreground/70 px-2 py-2 text-right font-mono text-xs tabular-nums max-md:text-[11px]">
        {row.adp != null ? (
          <span className="inline-flex flex-col items-end leading-tight">
            <span>{row.adp.toFixed(1)}</span>
            {/*
              FANTASYPROS' OWN EXPERT-CONSENSUS-VERSUS-ADP. Positive means the
              experts rank him ahead of where he is being drafted — he is
              available later than he should be. A different claim from the `+n`
              badge in the Proj column, which is THIS LEAGUE's scoring
              disagreeing with the market, so the two are deliberately not
              merged. Only shown past a full round's worth of places; below that
              it is inside the noise of a consensus.
            */}
            {row.ecrVsAdp != null && Math.abs(row.ecrVsAdp) >= 10 && (
              <span
                className={cn(
                  "text-[9px]",
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
          <span className="text-muted-foreground/30">—</span>
        )}
      </td>
      <Num value={row.tier} className="text-muted-foreground/70" />
      <Num value={row.bye} className="text-muted-foreground/70" />
    </tr>
  );
}

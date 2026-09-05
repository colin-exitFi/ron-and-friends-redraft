"use client";

import { useMemo } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { boardName } from "@/lib/board-name";
import { positionCell, positionText } from "@/lib/positions";
import { ROSTER } from "@/lib/league-config";
import {
  buildFranchiseLineups,
  lineupSlots,
  type FranchiseLineup,
  type LineupProjectionPoints,
  type LineupPlayer,
} from "@/lib/roster-lineup";
import type { DraftRoomView } from "@/lib/draft-types";

/**
 * All ten rosters on one screen — the Rosters half of the Board / Rosters
 * toggle.
 *
 * THE PROBLEM THIS SOLVES. Smart Draft's recap breaks results out by roster,
 * which the commissioner liked, but he noticed it does not fit on one screen.
 * Ten rosters at sixteen players each is 160 names, which is exactly as many
 * names as the draft board already fits — and that is the answer. This is the
 * same grid, re-sorted: ten franchise columns, sixteen rows, but the rows are
 * ROSTER SLOTS instead of draft rounds. Nine starters, a rule, seven bench.
 *
 * The shape is the board's, and a franchise's column reads positionally by hue
 * exactly the way it does on the board. THE TYPE SCALE IS NOT THE BOARD'S, and
 * that is the whole of what makes sixteen rows fit.
 *
 * The board is projected floor-to-ceiling and read from a seat eighteen feet
 * back, so it has an arcminute floor under its type — see
 * `board-legibility.ts` — and when the rows will not fit, the room scrolls.
 * This surface has no such floor. It is walked up to: "we'll be up walking
 * around wanting to see the full board in its entirety." So the trade runs the
 * other way. All sixteen rows are on screen at every viewport, and the type
 * goes wherever it has to go to keep them there.
 *
 * WHICH MEANS THE ROW DECIDES THE TYPE, not the other way round. Every slot row
 * is `basis-0 grow` with no floor, so sixteen of them divide whatever height the
 * surface has; the row is a size container, and a cell sizes its whole contents
 * off `--ukl-type`, a fraction of the row it sits in. One number per viewport,
 * the same in all 160 cells, arrived at by measurement rather than by choice.
 * The three constraints in that `min()` are, in order: the height of the row,
 * the width of the column, and a ceiling so a 4K screen does not print a roster
 * in headline type. The width term is calibrated against the widest name the
 * league's player file can produce — "D. Thompson-Robinson", at 11.7px of drawn
 * text per px of font size — and `scripts/verify-roster-wall.mjs` fails if that
 * stops being true.
 *
 * NOTHING IS EVER CUT TO MAKE THIS WORK. There is no `truncate` on this surface
 * and no line clamp; a name too long for its box would be a type size chosen
 * wrongly, which is a bug the verify script catches rather than a condition the
 * layout absorbs.
 *
 * Works from any `DraftRoomView`: the live board before the draft (keepers
 * only), mid-draft, or a finished mock.
 *
 * As with everything else on this surface, it shows only what franchises own.
 * No ADP, no rankings, nobody who is still available.
 */

export function RosterWall({
  view,
  projectedPoints = {},
}: {
  view: DraftRoomView;
  projectedPoints?: LineupProjectionPoints;
}) {
  const lineups = useMemo(
    () => buildFranchiseLineups(view, projectedPoints),
    [view, projectedPoints],
  );
  /** The nine starting slot labels, in config order. Derived once. */
  const starterLabels = useMemo(() => lineupSlots().map((s) => s.label), []);
  const benchCount = ROSTER.bench;

  /* Ten columns, and the same sideways scroll the board grid takes on a phone —
   * see `--ukl-cell` in `draft-surface.tsx`. The phone floor is wider than the
   * board's because this surface will not abbreviate to fit: a column has to be
   * wide enough for the longest name in the pool at a size worth reading, and
   * 6.4rem is that width. A phone therefore scrolls both ways, which is the
   * honest answer for ten columns of sixteen rows on a 390px screen. */
  const columns = {
    gridTemplateColumns: `repeat(${lineups.length}, minmax(var(--ukl-cell), 1fr))`,
  };
  const rowWidth = {
    minWidth: `calc(${lineups.length} * (var(--ukl-cell) + 0.25vw) + var(--ukl-gutter))`,
  };

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-[0.25vh] overflow-y-auto px-[0.5vw] py-[0.5vh] [--ukl-cell:0px] [--ukl-gutter:3.2vw] max-md:overflow-x-auto max-md:[--ukl-cell:6.4rem] max-md:[--ukl-gutter:2.15rem]">
      {/* Sticky franchise names, matching the board's own header row. */}
      <div
        className="bg-background/95 sticky top-0 z-10 flex shrink-0 gap-[0.25vw] pb-[0.25vh] backdrop-blur-sm"
        style={rowWidth}
      >
        <div className="bg-background sticky left-0 z-[1] w-[var(--ukl-gutter)] shrink-0" />
        <div className="grid flex-1 gap-[0.25vw]" style={columns}>
          {lineups.map((l) => (
            <ColumnHead key={l.team.id} lineup={l} />
          ))}
        </div>
      </div>

      {starterLabels.map((label, row) => (
        <SlotRow
          key={`start-${label}-${row}`}
          gutter={label}
          starter
          cells={lineups.map((l) => l.starters[row]?.player ?? null)}
          columns={columns}
          rowWidth={rowWidth}
        />
      ))}

      {/*
        The line between a starting lineup and a bench. It is the difference
        between "has a team" and "has bodies", so it is drawn rather than
        implied by a gap nobody notices across a room.
      */}
      <div className="flex shrink-0 items-center gap-[0.4vw] px-[0.2vw] py-[0.25vh]">
        <span className="text-muted-foreground/70 text-[clamp(0.5rem,0.55vw,0.75rem)] font-black tracking-[0.18em] uppercase">
          Bench
        </span>
        <span className="bg-border/70 h-px flex-1" />
      </div>

      {Array.from({ length: benchCount }, (_, row) => (
        <SlotRow
          key={`bench-${row}`}
          gutter={`BN${row + 1}`}
          cells={lineups.map((l) => l.bench[row] ?? null)}
          columns={columns}
          rowWidth={rowWidth}
        />
      ))}

      {lineups.some((l) => l.overflow.length > 0) && (
        <div className="border-destructive/50 bg-destructive/10 text-destructive mt-[0.3vh] shrink-0 rounded border px-[0.6vw] py-[0.3vh] text-[clamp(0.55rem,0.62vw,0.85rem)] font-bold">
          Over the {ROSTER.activeCap}-man roster:{" "}
          {lineups
            .filter((l) => l.overflow.length > 0)
            .map((l) => `${l.team.name} (${l.overflow.map((p) => p.name).join(", ")})`)
            .join(" · ")}
        </div>
      )}
    </main>
  );
}

function ColumnHead({ lineup }: { lineup: FranchiseLineup }) {
  const set = lineup.openStarterLabels.length === 0;
  return (
    /*
     * The manager's handle, matching the board's own header row. Franchise names
     * wrapped to one, two or three lines depending on the name and the window,
     * which left every column's roster count at a different height; handles are
     * three to six characters and always one line. See the fuller note on the
     * header in `draft-surface.tsx`.
     */
    <div
      className="bg-board-base border-border rounded border px-1 py-[0.3vh] text-center"
      title={`${lineup.team.name} — ${lineup.team.franchiseName} · ${lineup.team.manager}`}
    >
      <div className="text-[clamp(0.62rem,0.68vw,1rem)] leading-[1.15] font-black uppercase">
        {lineup.team.name}
      </div>
      <div
        className={cn(
          "text-[clamp(0.5rem,0.55vw,0.78rem)] font-black tabular-nums",
          set ? "text-success" : "text-muted-foreground",
        )}
      >
        {lineup.rosterSize}/{lineup.rosterCap}
        {!set && (
          /* Neutral, not amber — see the empty-starter cell below. */
          <span className="text-foreground/80">
            {" "}
            · {lineup.openStarterLabels.length} open
          </span>
        )}
      </div>
    </div>
  );
}

function SlotRow({
  gutter,
  cells,
  columns,
  rowWidth,
  starter,
}: {
  gutter: string;
  cells: (LineupPlayer | null)[];
  columns: React.CSSProperties;
  rowWidth: React.CSSProperties;
  starter?: boolean;
}) {
  return (
    <div
      className="flex min-h-0 grow basis-0 gap-[0.25vw] [container-type:size] [--ukl-type:min(24cqh,0.71vw,1.15rem)] max-md:min-h-[2.75rem] max-md:shrink-0 max-md:grow-0 max-md:basis-auto max-md:[--ukl-type:min(24cqh,8px)]"
      style={rowWidth}
    >
      <div
        className={cn(
          "bg-board-base border-border sticky left-0 z-[1] flex w-[var(--ukl-gutter)] shrink-0 items-center justify-center rounded border text-[length:var(--ukl-type)] font-black",
          starter ? "text-foreground" : "text-muted-foreground/60",
        )}
      >
        {gutter}
      </div>
      {/* `grid-rows-[100%]`: the implicit row would be `auto`, which is the
          height of the tallest cell's contents — and the contents are sized off
          the row, so the two would be defining each other. Pinning the row to
          the height the flex layout already settled breaks the circle. */}
      <div className="grid flex-1 grid-rows-[100%] gap-[0.25vw]" style={columns}>
        {cells.map((player, i) => (
          <RosterCell key={i} player={player} starter={starter} />
        ))}
      </div>
    </div>
  );
}

function RosterCell({
  player,
  starter,
}: {
  player: LineupPlayer | null;
  starter?: boolean;
}) {
  if (!player) {
    return (
      <div
        className={cn(
          "bg-board-base flex min-h-0 min-w-0 items-center justify-center rounded border p-[0.34em] text-[length:var(--ukl-type)]",
          /*
            An empty STARTING slot still outranks an empty bench slot, and it is
            still drawn that way — by hairline weight and a faint lift rather
            than in amber.

            Amber was the wrong call here more visibly than anywhere else in the
            app. This wall is mostly empty starter cells early in a draft — about
            seventy of the ninety — so the "problem" treatment was the wall's
            default state and read as decoration. Worse, the TE row put amber
            cells immediately beside `--cell-te` ones drawn from the SAME token —
            `--ds-amber` is both the warning and the TE hue — so it was one colour,
            side by side, in the same row, meaning two unrelated things.
          */
          starter
            ? "border-border bg-foreground/[0.03]"
            : "border-border/30",
        )}
      >
        <span className="text-muted-foreground/35 text-[0.85em] font-bold">open</span>
      </div>
    );
  }

  return (
    <div
      title={`${player.name} — ${player.position}, ${player.nflTeam ?? "FA"}${
        player.byeWeek != null ? `, bye week ${player.byeWeek}` : ""
      }, ${
        player.source === "keeper" ? `kept at ${player.label}` : `drafted ${player.label}`
      }`}
      className={cn(
        // Top-aligned, matching the board: equal rows and one baseline.
        "flex min-h-0 min-w-0 flex-col justify-start rounded border p-[0.34em] text-[length:var(--ukl-type)]",
        positionCell(player.position),
      )}
    >
      {/*
        `shrink-0` on all three lines, and a line-height on each rather than the
        cell's old `leading-none`. Both are load bearing.

        A flex column shrinks its children before it lets itself overflow, so in
        a cell one pixel too short the lines were quietly squashed instead —
        which is invisible until something is also clipping. The club and bye
        line was: it came from `PlayerMeta`, which carries `truncate`, and at
        1366x768 its box had been shrunk to 6px of a 10px line, taking most of
        the text with it. `leading-none` made it worse everywhere by boxing every
        line at exactly 1em when the font's glyphs run about 1.15.

        Nothing here may be squashed, and the type is sized so nothing has to be.
      */}
      <div className="flex w-full shrink-0 items-center justify-between gap-[0.2em] leading-[1.2]">
        <span
          className={cn(
            "flex shrink-0 items-center gap-[0.15em] text-[0.92em] font-black",
            positionText(player.position),
          )}
        >
          {player.position}
          {player.source === "keeper" && (
            <Lock className="h-[0.9em] w-[0.9em] shrink-0" aria-label="Keeper" />
          )}
        </span>
        <span className="text-muted-foreground shrink-0 font-mono text-[0.76em] font-extrabold tabular-nums">
          {player.label}
        </span>
      </div>
      <span className="text-foreground w-full shrink-0 text-[1em] leading-[1.14] font-extrabold whitespace-nowrap">
        {boardName(player.name, player.position)}
      </span>
      {/*
        The same club and bye line the board cells carry, and the same text — but
        written out here rather than taken from `PlayerMeta`, which is sized in
        `vw` for a board cell three times this tall. On this surface that left it
        drawn at 8px inside a 34px cell, where it was both the widest thing in the
        row and the only thing carrying `truncate`. Set in `em` of the cell it
        lives in, it stays subordinate to the name at every viewport and there is
        no rule left on this surface that could cut a word.
      */}
      <span className="text-muted-foreground/85 w-full shrink-0 font-mono text-[0.8em] leading-[1.2] font-bold tabular-nums whitespace-nowrap">
        {/* "FA" rather than blank: several drafted players are genuinely unsigned. */}
        {player.nflTeam ?? "FA"}
        {player.byeWeek != null && ` · BYE ${player.byeWeek}`}
      </span>
    </div>
  );
}

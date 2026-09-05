"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Download, Lock, Maximize2, Minimize2, Printer, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { EMPTY_CELL, positionCell, positionText } from "@/lib/positions";
import { buildFinalBoard, positionCountEntries } from "@/lib/final-board-view";
import { useFullscreen } from "@/lib/use-fullscreen";
import { TAP, ViewToggle } from "@/components/draft-surface";
import { RosterWall } from "@/components/roster-wall";
import type { FinalBoardEntry, FinalBoardTeam } from "@/lib/final-board-view";
import type { DraftRoomView } from "@/lib/draft-types";
import type { LineupProjectionPoints } from "@/lib/roster-lineup";

/**
 * The post-draft board, for standing around and arguing about.
 *
 * A column is the franchise that OWNS the player; there is no trade attribution
 * anywhere on it. Rows are each franchise's own pick order, which is what makes
 * the grid a uniform 10×16 with one player per cell — see the long note in
 * `final-board-view.ts` for why it is not keyed by round, and why the round is
 * therefore printed in every cell.
 *
 * BOARD / ROSTERS is the same switch the live board has, and deliberately the
 * same component: this half answers "what did he take, and when", the Rosters
 * half lines the ten teams up QB against QB. Two questions, one screen each.
 */
export function FinalBoard({
  view,
  expectedPick,
  projectedPoints,
}: {
  view: DraftRoomView;
  projectedPoints: LineupProjectionPoints;
  /**
   * Where each player was expected to go on THIS board — keeper-adjusted, in
   * real slot numbers. Not consensus ADP; see `expected-pick.ts` for why the
   * two are not interchangeable.
   */
  expectedPick: Record<string, number | null>;
}) {
  const { active: tvMode, toggle: toggleTvMode } = useFullscreen();
  const [pane, setPane] = useState<"board" | "rosters">("board");
  const board = useMemo(
    () => buildFinalBoard(view, expectedPick),
    [view, expectedPick],
  );

  /* The same phone treatment the live board gets, and for the same reason —
   * see the note on `--ukl-cell` in `draft-surface.tsx`. The two grids have to
   * behave identically or the recap reads as a different app to the board. */
  const columns = {
    gridTemplateColumns: `repeat(${board.teams.length}, minmax(var(--ukl-cell), 1fr))`,
  };
  const rowWidth = {
    minWidth: `calc(${board.teams.length} * (var(--ukl-cell) + 0.25vw) + var(--ukl-gutter))`,
  };

  /*
   * Flat `bg-background`, not `bg-canvas` — see the note on the live board in
   * `draft-board.tsx`. The two have to match or the recap looks like a different
   * app to the board it recaps.
   */
  return (
    <div className="bg-background text-foreground fixed inset-0 z-50 flex h-[100dvh] flex-col overflow-hidden">
      <Header
        board={board}
        pane={pane}
        onPane={setPane}
        tvMode={tvMode}
        onToggleTvMode={toggleTvMode}
      />

      {/*
        Neutral, for the same reason the roster pane's count bar is: "the draft
        is not finished" is the normal condition of this page for the entire
        draft, and an alarm colour on a normal condition is decoration. It also
        sat directly above a grid of TE cells drawn in the very same token —
        `--ds-amber` is both the warning and the TE hue.
      */}
      {!board.complete && (
        <div className="border-border bg-foreground/[0.06] text-foreground/85 mx-[0.5vw] mt-[0.4vh] shrink-0 rounded border px-[0.7vw] py-[0.4vh] text-[clamp(0.6rem,0.72vw,0.9rem)] font-semibold max-md:mx-1 max-md:px-2 max-md:text-[10px]">
          The draft is not finished — {board.owned - board.filled} of{" "}
          {board.owned} slots are still empty. This is the board so far.
        </div>
      )}

      {pane === "rosters" ? (
        <RosterWall view={view} projectedPoints={projectedPoints} />
      ) : (
        /*
          NO `overflow-y-auto`, AND THE OPPOSITE RULE FROM THE LIVE BOARD.

          The live grid is allowed to run off the bottom of the screen: it is
          projected floor-to-ceiling and read from a seat, so type size wins and
          the room scrolls. This one is the wall poster of the finished draft —
          "we'll be up walking around wanting to see the full board in its
          entirety" — so all sixteen rounds are on screen at once or the page has
          failed. Nothing here may scroll, and the surface is looked at from a
          foot away rather than fifteen, which is the slack that pays for it.

          `--ukl-gutter` stays narrower than the live board's 3.2vw: that one
          spells out "RD 4" in its rail and this one prints a bare "4", for the
          reason given on the rail below.
        */
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-[0.35vh] px-[0.5vw] py-[0.4vh] [--ukl-cell:0px] [--ukl-gutter:2vw] max-md:overflow-x-auto max-md:[--ukl-cell:6.6rem] max-md:[--ukl-gutter:1.4rem]">
          <div className="flex shrink-0 gap-[0.25vw]" style={rowWidth}>
            <div className="bg-background sticky left-0 z-[1] w-[var(--ukl-gutter)] shrink-0" />
            <div className="grid flex-1 gap-[0.25vw]" style={columns}>
              {board.teams.map((entry) => (
                <ColumnHead key={entry.team.id} entry={entry} />
              ))}
            </div>
          </div>

          {/*
            THE ROUNDS SHARE WHAT IS LEFT, EQUALLY, AND CANNOT ASK FOR MORE.

            `minmax(0, 1fr)` rather than the live board's `basis-auto`: there a
            row asks for what its cells contain and the board grows past the
            fold, which is the whole disagreement between the two surfaces. Here
            the sixteen rounds divide the height the header and footer left
            behind, so the board fits every viewport by construction rather than
            by a size that happened to work on one of them.

            Uniformity comes free with it: every round is the same height to
            within the hundredth of a pixel the browser has left over, because
            the grid says so rather than because the cells agreed.
          */}
          <div
            className="grid min-h-0 flex-1 gap-[0.35vh]"
            style={{
              ...rowWidth,
              gridTemplateRows: `repeat(${board.rows.length}, minmax(0, 1fr))`,
            }}
          >
            {board.rows.map((row, i) => (
              <div
                key={i}
                /*
                 * THE TYPE IS A FRACTION OF THE ROUND, NOT OF THE WINDOW.
                 *
                 * `container-type: size` makes the round a query container, so
                 * everything inside a cell is written in `cqh` — a percentage of
                 * the height this round was actually given. That closes the
                 * circle: the grid above works out how tall a round is from the
                 * space left over, and the cell sizes itself to that answer, so
                 * there is no viewport where the two disagree and no `rem` floor
                 * left to stop the type shrinking. A floor is exactly what put an
                 * ellipsis through nine names at 1024 — `0.68rem` would not
                 * follow the column down.
                 *
                 * THE NAME AND THE METADATA ARE CAPPED SEPARATELY, and that is
                 * the other half of it. The name wraps, so running out of width
                 * costs it a line and the reserved second line absorbs that. The
                 * metadata does not wrap — position, club, bye and round have to
                 * sit on one baseline — so IT is the thing that runs off the end.
                 * Tied to the name at a fixed ratio it cleared 1024 by 0.2px,
                 * with the name shrinking to buy it that. Sized apart, the name
                 * keeps the height it can afford and the metadata keeps the width
                 * it needs, and there is 13% of the line spare at the worst
                 * viewport rather than a rounding error.
                 *
                 * A phone cannot make ten columns of this out of 390px, so it
                 * keeps the board's own column width and scrolls SIDEWAYS for it
                 * — the one axis this surface is allowed to move on. Both width
                 * terms are a share of `--ukl-cell` there rather than of the
                 * viewport.
                 */
                className="flex min-h-0 gap-[0.25vw] [--ukl-meta:min(calc(var(--ukl-name)*0.72),0.57vw)] [--ukl-name:min(27cqh,1.2vw,1.5rem)] [container-type:size] max-md:[--ukl-meta:min(calc(var(--ukl-name)*0.72),calc(var(--ukl-cell)*0.06))] max-md:[--ukl-name:min(27cqh,calc(var(--ukl-cell)*0.15))]"
              >
                {/*
                  The franchise's Nth selection, NOT a round — the round lives in
                  each cell because it varies across a row. Slim and quiet for the
                  same reason: it is an anchor for the eye, not a fact worth
                  reading.
                */}
                <div className="bg-background text-muted-foreground/40 sticky left-0 z-[1] flex w-[var(--ukl-gutter)] shrink-0 items-center justify-center text-[length:calc(var(--ukl-name)*0.8)] font-black tabular-nums">
                  {i + 1}
                </div>
                <div className="grid min-h-0 flex-1 gap-[0.25vw]" style={columns}>
                  {row.map((entry, t) => (
                    <Cell key={board.teams[t].team.id} entry={entry} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      <Footer board={board} pane={pane} />
    </div>
  );
}

// --- Header -----------------------------------------------------------------

function Header({
  board,
  pane,
  onPane,
  tvMode,
  onToggleTvMode,
}: {
  board: ReturnType<typeof buildFinalBoard>;
  pane: "board" | "rosters";
  onPane: (next: "board" | "rosters") => void;
  tvMode: boolean;
  onToggleTvMode: () => void;
}) {
  return (
    /* Wraps to a control row and a summary line on a phone held upright — the
       same shape, and the same reason, as the live board's bar. */
    <header className="bg-board-base border-border mx-[0.5vw] mt-[0.5vh] flex shrink-0 flex-wrap items-center gap-[1.2vw] rounded-lg border px-[0.7vw] py-[0.55vh] max-md:mx-1 max-md:mt-1 max-md:gap-1 max-md:px-1 max-md:py-1">
      <div className="flex min-w-0 shrink-0 items-center gap-[0.8vw] max-md:gap-1">
        <Image
          src="/brand/crest-v2-256.png"
          alt=""
          width={232}
          height={256}
          className="h-[3.2vh] w-[3.2vh] shrink-0 object-contain max-md:hidden"
        />
        <span className="font-display truncate text-[clamp(0.7rem,0.95vw,1.2rem)] font-bold tracking-[0.06em] uppercase max-md:text-[11px]">
          {board.season} Final<span className="max-md:hidden"> Board</span>
        </span>
      </div>

      {/*
        Two options, not the live board's three: the picks list is a view of a
        draft in progress — it exists to be read as it happens — and this page
        is the recap, where "every pick in order" is what the board CSV behind
        the Download button is for.
      */}
      <ViewToggle view={pane} onChange={onPane} options={["board", "rosters"]} />

      {/*
        The one sentence that makes the board readable. Everybody in this room has
        spent draft night reading the *other* board, where a column is whose pick
        it was, so the change of key needs saying out loud.
      */}
      <span className="text-muted-foreground min-w-0 flex-1 truncate text-[clamp(0.55rem,0.72vw,0.92rem)] max-md:order-last max-md:w-full max-md:flex-none max-md:basis-full max-md:text-[10px]">
        Every player under the franchise that owns him ·{" "}
        <span className="text-foreground font-semibold">
          {board.filled} rostered
        </span>{" "}
        · {board.keeperCount} keepers
      </span>

      <div className="flex shrink-0 items-center gap-[0.5vw] max-md:ml-auto max-md:gap-0.5">
        <button
          type="button"
          onClick={onToggleTvMode}
          title={tvMode ? "Leave TV mode" : "TV mode — fill the whole screen"}
          className={cn(
            "text-muted-foreground hover:text-foreground flex items-center justify-center gap-[0.3vw] text-[clamp(0.55rem,0.72vw,0.9rem)] font-semibold transition-colors max-md:text-[11px]",
            TAP,
          )}
        >
          {tvMode ? (
            <Minimize2 className="h-[1.1em] w-[1.1em]" />
          ) : (
            <Maximize2 className="h-[1.1em] w-[1.1em]" />
          )}
          <span className="max-md:hidden">TV mode</span>
        </button>
        {/*
          A plain <a>, not next/link: this is a file response, not a route, and
          Link would try to prefetch and client-navigate to a CSV.

          Straight to the board CSV rather than to the export page, because the
          board IS the draft result — every pick in order — and "download the
          results" should cost one click, not a hop through a page of choices.
          The other two sheets (rosters, and the lineup typing script) still live
          on the export page behind the printer.
        */}
        <a
          href="/api/draft/export?what=board"
          download
          title="Download the finished board as a CSV"
          className={cn(
            "text-muted-foreground hover:text-foreground flex items-center justify-center gap-[0.3vw] text-[clamp(0.55rem,0.72vw,0.9rem)] font-semibold transition-colors max-md:text-[11px]",
            TAP,
          )}
        >
          <Download className="h-[1.1em] w-[1.1em]" />
          <span className="max-md:hidden">Download</span>
        </a>
        <Link
          href="/draft/export"
          title="Printable sheet, plus the roster and lineup-entry CSVs"
          className="text-muted-foreground hover:text-foreground transition-colors max-md:hidden"
        >
          <Printer className="h-4 w-4" />
        </Link>
        <Link
          href="/draft"
          title="Back to the draft board"
          className={cn(
            "text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors",
            TAP,
          )}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Link
          href="/"
          title="Leave the board"
          className={cn(
            "text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors",
            TAP,
          )}
        >
          <X className="h-4 w-4" />
        </Link>
      </div>
    </header>
  );
}

function ColumnHead({ entry }: { entry: FinalBoardTeam }) {
  const counts = positionCountEntries(entry.byPosition);
  return (
    /*
     * The manager's handle, matching the live board. One line at any width, so
     * the position counts land on one baseline across all ten columns. See the
     * fuller note on the header in `draft-surface.tsx`.
     */
    <div
      className="bg-board-base border-border rounded border px-1 py-[0.3vh] text-center"
      title={`${entry.team.name} — ${entry.team.franchiseName} · ${entry.team.manager} · ${entry.filled} rostered`}
    >
      <div className="text-[clamp(0.62rem,0.68vw,1rem)] leading-[1.15] font-black uppercase">
        {entry.team.name}
      </div>
      {counts.length > 0 ? (
        <div
          title={`Roster: ${counts.map((c) => `${c.count} ${c.position}`).join(", ")}`}
          className="flex flex-wrap items-center justify-center gap-x-[0.35vw] text-[clamp(0.52rem,0.55vw,0.8rem)] font-black tabular-nums"
        >
          {counts.map((c) => (
            <span key={c.position} className={positionText(c.position)}>
              {c.position}
              {c.count}
            </span>
          ))}
        </div>
      ) : (
        <div className="text-muted-foreground/25 text-[clamp(0.5rem,0.55vw,0.75rem)]">
          —
        </div>
      )}
    </div>
  );
}

// --- Cells ------------------------------------------------------------------

/**
 * TWO SLOTS, WHERE THE LIVE BOARD HAS FOUR — AND THAT IS WHAT PAYS FOR THE FIT.
 *
 * `draft-surface.tsx` draws every one of its 160 cells through four slots in a
 * fixed order — the name, the position with the pick's number, the club with
 * the bye, and the ownership strip — and each slot holds its height whether or
 * not it has anything in it. That is what makes the live grid uniform by
 * construction rather than by arithmetic.
 *
 * Two of those four are gone here, and neither is an oversight:
 *
 *   · THE OWNERSHIP STRIP CANNOT EXIST. A column here is the franchise that
 *     OWNS the player, so there is nothing left to attribute — see the note at
 *     the top of this file.
 *   · THE CLUB AND BYE MOVED UP ONTO THE POSITION'S LINE, at the far end of it.
 *     This surface has to hold all sixteen rounds on one screen with nothing
 *     cut, and at 768px of window the arithmetic does not close with two
 *     metadata lines: a round gets about 39px, and paying twice for a line of
 *     type costs the player's name roughly a quarter of its size. One line is
 *     worth more than the parity is — the same facts are still in the cell, and
 *     this is the page you walk up to rather than the one you read from a seat.
 *
 * That one line carries two groups, not four fields in a row. See the note on
 * it in `Cell` for why, and for why the round is not the duplicate of the rail
 * on the left that it looks like.
 *
 * The name keeps its two reserved lines. It is the only thing on the cell worth
 * protecting, and reserving the second line is what lets "Jaxon Smith-Njigba"
 * wrap into space that is already there rather than taking it from the round.
 *
 * Every vertical length is in `cqh` or in `--ukl-name`, both of which are
 * fractions of the round's own height. Nothing here carries a `rem` floor: a
 * floor is what stopped the type following the column down and put an ellipsis
 * through nine of these names.
 */
const CELL_SLOTS = {
  name: "min-h-[calc(2.2*var(--ukl-name))] w-full text-[length:var(--ukl-name)] leading-[1.1] font-extrabold tracking-[-0.01em] break-words hyphens-none",
  meta: "flex w-full min-w-0 items-center justify-between gap-[0.5em] text-[length:var(--ukl-meta)] leading-[1.15]",
  aside: "shrink-0 font-mono tabular-nums font-bold",
} as const;

function Cell({ entry }: { entry: FinalBoardEntry | null }) {
  // A franchise holding fewer picks than the tallest column. Blank, not dashed:
  // there is nothing to say about a pick that does not exist.
  if (!entry) return <div />;

  const { slot } = entry;
  const player = slot.player;
  const marked = entry.mark !== null;

  return (
    <div
      data-slot-id={slot.id}
      title={
        player
          ? `${player.name} — ${player.position}, ${player.nflTeam ?? "free agent"}${
              player.byeWeek != null ? `, bye week ${player.byeWeek}` : ""
            } · round ${slot.round}, pick ${slot.label}${
              slot.fill === "keeper" ? " · keeper" : ""
            }${
              entry.picksEarlier !== null
                ? ` · ${describeGap(entry.picksEarlier)}`
                : ""
            }`
          : `Round ${slot.round}, pick ${slot.label} — not made yet`
      }
      /*
       * No `overflow-hidden`. It was here, and clipping is the one thing a cell
       * on either board must never do: a box that quietly hides what it cannot
       * fit is how the live grid had a strip sitting on a name for a week with
       * nobody able to point at the cause. Everything below is sized to fit, and
       * if that stops being true it will show rather than disappear.
       */
      className={cn(
        "relative flex min-w-0 flex-col rounded border leading-none",
        player ? positionCell(player.position) : EMPTY_CELL,
        // The mark is a ring outside the position fill, so the cell still reads
        // positionally first and "worth arguing about" second.
        marked && "ring-2 ring-offset-0",
        entry.mark === "reach" && "ring-destructive",
        entry.mark === "steal" && "ring-success",
      )}
    >
      {/* Padding measured off the ROUND on both axes now — the vertical share of
          a cell has to shrink with the cell, and `0.3vh` did not know how tall
          the round it was sitting in had turned out to be. */}
      <div className="flex min-w-0 flex-1 flex-col gap-[3cqh] px-[0.35vw] py-[4cqh]">
        {/*
          SLOT 1 — THE NAME, IN FULL.

          This printed "C. McCaffrey" through `boardName` until now, which bought
          one-line cells back when sixteen rounds had to fit a 1080p screen. The
          live board gave that constraint up — the projector is floor-to-ceiling
          and its bottom edge cannot be read from a seat anyway — and this board
          is read by people who have just spent an evening reading whole names.
          Two lines are reserved in every cell, so "Jaxon Smith-Njigba" wraps
          into space that is already there rather than taking it from the round.
        */}
        <div className={cn(CELL_SLOTS.name, "text-foreground")}>
          {player?.name}
        </div>

        {/*
          SLOT 2 — EVERYTHING ELSE, IN TWO GROUPS ON ONE LINE.

          "Honestly the team abbr. the bye week are really close to the round."
          They were: all four facts were strung along the right-hand end with an
          even 0.4em between them, so "DET BYE 6 R1" read as one run of
          characters and the round — the brightest of the three — was jammed
          against the dimmest.

          They are two different questions, so they are now two groups with the
          line's free space between them:

            RB🔒 R1            DET  BYE 6
            what he is,        who he plays for,
            and when he went   and when he is off

          `justify-between` was already putting that gap somewhere; it was
          putting all of it on the LEFT, between the position and a four-token
          pile. Splitting the groups spends it where it separates something, and
          it costs no width to do so — it is space the line already had spare.
          The tightest cell on the real board still opens to 1.9em of it, so the
          `gap` here is only a floor for a cell wider than any that exists; a
          bigger floor bought nothing and came straight out of the margin the
          widest metadata line has left.
        */}
        <div className={cn(CELL_SLOTS.meta, "font-black")}>
          <span className="flex min-w-0 items-center gap-[0.5em]">
            {/*
              THE PADLOCK IS PART OF THE POSITION TAG, NOT A FIELD OF ITS OWN.

              It sits inside the tag's span, immediately to the tag's right, and
              takes its colour from `currentColor` — green beside WR, gold beside
              TE, pink beside QB — so the two cannot drift apart, because only
              one colour is being set. This board had it to the LEFT of the
              position, where it indented "WR" past the name above it in the
              nineteen keeper cells and nowhere else, and where the letters
              shifted across as you switched between this board and the live one.

              AFTER the tag rather than before it is what keeps the column
              alignment: the tag starts on the same pixel in all 160 cells and
              the lock spends the space the line had going spare. Reserved in
              every cell and hidden with `visibility` in the ones that are not
              keepers — the same technique the live grid uses — so a keeper and
              an ordinary pick are the same shape to the pixel.
            */}
            <span
              className={cn(
                "flex items-center gap-[0.3em]",
                positionText(player?.position),
              )}
            >
              {player?.position}
              <Lock
                aria-label="Keeper"
                className={cn(
                  "h-[1.05em] w-[1.05em] shrink-0",
                  slot.fill !== "keeper" && "invisible",
                )}
                strokeWidth={2.75}
              />
            </span>
            {/*
              THE ROUND, AND IT IS NOT WHAT THE RAIL ON THE LEFT SAYS.

              The obvious tidy-up here is to delete it: the board has rounds 1
              to 16 numbered down its left edge, so a cell in row 6 printing
              "R6" looks like it is repeating itself. It is not. That rail is
              each franchise's OWN pick order — see the long note in
              `final-board-view.ts` for why the grid cannot be keyed by round —
              and on the real 2026 board 79 of the 160 cells sit in a row whose
              number is not their round, because trades do not respect rounds.
              Half the board would start lying if this came out.
            */}
            <span className={cn(CELL_SLOTS.aside, "text-foreground/80")}>
              R{slot.round}
            </span>
            {/* How far off the keeper-adjusted expectation this pick landed. Ten
                cells on the board carry one, and they are the widest lines on
                it — hence no chip padding to buy back the room they need. It
                rides with the round because that is what it measures. */}
            {marked && (
              <span
                className={cn(
                  CELL_SLOTS.aside,
                  entry.mark === "reach" ? "text-destructive" : "text-success",
                )}
              >
                {entry.picksEarlier! > 0 ? "+" : ""}
                {entry.picksEarlier}
              </span>
            )}
          </span>

          {/*
            THE CLUB AND THE BYE, AT THE PALETTE'S SECONDARY TEXT RATHER THAN A
            DIMMED VERSION OF IT.

            "The muted gray is hard to read." Measured, it was: 4.38:1 on a WR
            cell and 4.41:1 on a TE one, both under the 4.5:1 AA floor, and only
            4.67:1 on the best of the five. `--muted-foreground` is 7.8:1 on the
            board's own canvas and the alpha was throwing that away — see the
            note on `--ds-muted` in globals.css, which sets out when the palette
            expects a call site to dim this token and when it does not. Text
            somebody has to read is when it does not.

            Secondary is carried by size and weight instead, which is what it
            should have been carrying all along: this is 0.86em of a line that
            is itself 0.72em of the name, in mono rather than the name's
            extrabold. The name still measures around 15:1 against the same
            cell, so nothing about the hierarchy moved — only the floor did.
          */}
          <span
            className={cn(
              CELL_SLOTS.aside,
              "text-muted-foreground flex items-center gap-[0.45em] text-[0.86em]",
            )}
          >
            {/* "FA" rather than blank: several drafted players are genuinely unsigned. */}
            <span>{player ? (player.nflTeam ?? "FA") : null}</span>
            {/*
              "BYE" is spelled out: a bare "6" on a line that also carries "R3"
              is two numbers meaning different things.
            */}
            <span className="tabular-nums">
              {player?.byeWeek != null ? `BYE ${player.byeWeek}` : null}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/*
 * "expected" rather than "ADP" throughout, and the distinction is not pedantry:
 * the number really is a slot on this board with keepers taken out, so saying
 * ADP would credit the comparison to a figure it no longer uses.
 */
function describeGap(picksEarlier: number): string {
  if (picksEarlier === 0) return "exactly where expected";
  return picksEarlier > 0
    ? `${picksEarlier} picks earlier than expected`
    : `${Math.abs(picksEarlier)} picks later than expected`;
}

// --- Footer -----------------------------------------------------------------

function Footer({
  board,
  pane,
}: {
  board: ReturnType<typeof buildFinalBoard>;
  pane: "board" | "rosters";
}) {
  /*
   * A COLOUR KEY, NOT INSTRUCTIONS — AND ONLY WHEN THERE IS A COLOUR TO KEY.
   *
   * The draft board's footer was deleted outright: it listed the keyboard
   * grammar and the padlock, all of which the room works out in two picks. The
   * same reasoning took the padlock and the "a column is who owns the player"
   * line out of this one, the latter because the header says it verbatim three
   * inches above.
   *
   * The rings stay, and they are the exception on purpose. A ring is arbitrary:
   * nothing about a red outline tells you it means "taken earlier than his
   * keeper-adjusted expected pick", and this is the screen where the league
   * argues about exactly that.
   *
   * With nothing to decode there is no bar at all, rather than an empty strip
   * with a border on it — a rule across the screen that explains nothing is
   * worse than the footer that was just removed, not better.
   */
  if (pane !== "board" || !board.hasMarks) return null;

  return (
    <footer className="border-border/60 text-muted-foreground/70 flex shrink-0 items-center justify-end gap-[1vw] border-t px-[1.2vw] py-[0.5vh] text-[clamp(0.55rem,0.78vw,0.95rem)] max-md:gap-2 max-md:px-2 max-md:text-[10px]">
      <span className="text-destructive ring-destructive rounded px-[0.3vw] ring-1">
        reach vs expected
      </span>
      <span className="text-success ring-success rounded px-[0.3vw] ring-1">
        steal vs expected
      </span>
    </footer>
  );
}

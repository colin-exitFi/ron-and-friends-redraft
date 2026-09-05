"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { EMPTY_CELL, positionCell, positionText } from "@/lib/positions";
import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";

/**
 * Every pick from 1.01 to 16.10 in one column, top to bottom — the third view
 * behind the Board / Picks / Rosters toggle.
 *
 * THE QUESTION IT ANSWERS. The grid is the right shape for "what has each
 * franchise got" and the roster wall is the right shape for "what does that team
 * look like", but neither answers "what happened, in order". On the grid the
 * order snakes: pick 11 is directly under pick 10 rather than beside it, and
 * reading the draft as a sequence means zig-zagging across ten columns and
 * sixteen rows. Here it is one axis — scroll down and the draft happened in
 * that order.
 *
 * Same hues, same abbreviations, same handles as the board, so nothing has to be
 * relearned when the toggle is flipped. A row carries the overall number (which
 * the grid never prints), the label the room calls the pick by, who owns it, and
 * the player — which is what makes it the view to read out from.
 *
 * IT IS STILL NOT A CHEAT SHEET. Every row is a slot on this board; nobody who
 * is undrafted appears. See the note at the top of `draft-surface.tsx`.
 */

export function PickList({ view }: { view: DraftRoomView }) {
  // `view.slots` is documented as being in overall pick order, but this is the
  // one screen where that order IS the content, so it is sorted rather than
  // assumed.
  const ordered = useMemo(
    () => [...view.slots].sort((a, b) => a.overallPick - b.overallPick),
    [view.slots],
  );

  const scroller = useRef<HTMLElement>(null);

  /*
   * Land on the live pick rather than at 1.01. Sixteen rounds is far taller than
   * any screen, so opening this view mid-draft would otherwise show the first
   * round and nothing about where the draft has got to. Centred, so the picks
   * either side of the clock — the ones being talked about — come with it.
   */
  useEffect(() => {
    if (!view.onTheClockSlotId) return;
    scroller.current
      ?.querySelector(`[data-pick-row="${view.onTheClockSlotId}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [view.onTheClockSlotId]);

  return (
    <main
      ref={scroller}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-[0.5vw] py-[0.5vh]"
    >
      {/*
        Capped and centred. A row is six short fields, so at full width on a TV
        the owner and the player end up a foot apart and the eye loses the line
        between them.
      */}
      <div className="mx-auto flex w-full max-w-[64rem] flex-col gap-[0.2vh]">
        {ordered.map((slot, i) => (
          <Fragment key={slot.id}>
            {slot.round !== ordered[i - 1]?.round && (
              <RoundRule round={slot.round} />
            )}
            <PickRow slot={slot} onTheClock={slot.id === view.onTheClockSlotId} />
          </Fragment>
        ))}
      </div>
    </main>
  );
}

/**
 * Where each round starts. Sticky, so however far down the list has been
 * scrolled the round being read is named overhead — the same job the sticky
 * franchise row does on the grid.
 */
function RoundRule({ round }: { round: number }) {
  return (
    <div className="bg-background/95 sticky top-0 z-10 flex shrink-0 items-center gap-[0.5vw] pt-[0.5vh] pb-[0.3vh] backdrop-blur-sm">
      <span className="text-muted-foreground/80 text-[clamp(0.55rem,0.62vw,0.8rem)] font-black tracking-[0.18em] uppercase">
        Round {round}
      </span>
      <span className="bg-border/70 h-px flex-1" />
    </div>
  );
}

function PickRow({
  slot,
  onTheClock,
}: {
  slot: LiveSlot;
  onTheClock: boolean;
}) {
  const empty = slot.fill === null;

  return (
    <div
      data-pick-row={slot.id}
      title={rowDetail(slot)}
      className={cn(
        "flex shrink-0 items-center gap-[0.7vw] rounded border px-[0.7vw] py-[0.5vh] leading-none max-md:gap-1.5 max-md:px-1.5 max-md:py-1.5",
        // Clears the sticky round rule when this row is scrolled to.
        "scroll-mt-[6vh] scroll-mb-[2vh]",
        empty ? EMPTY_CELL : positionCell(slot.player?.position),
        // The one row that fills solid and glows, exactly as on the grid: it is
        // the only mark on either surface that does, which is what keeps it
        // first in the hierarchy however bright the position fills get.
        onTheClock && "border-live bg-live glow-live",
      )}
    >
      {/*
        THE OVERALL NUMBER, which the grid never prints — the row is headed by a
        round there and a cell is its coordinates. It is the whole reason this
        view exists ("1 - 160"), so it leads the row.
      */}
      <span
        className={cn(
          "w-[2.4rem] shrink-0 text-right text-[clamp(0.6rem,0.72vw,0.95rem)] font-black tabular-nums max-md:w-[1.6rem] max-md:text-[10px]",
          onTheClock ? "text-primary-foreground/70" : "text-muted-foreground/50",
        )}
      >
        {slot.overallPick}
      </span>

      {/* The label the room calls the pick by. */}
      <span
        className={cn(
          "w-[2.6rem] shrink-0 font-mono text-[clamp(0.6rem,0.72vw,0.95rem)] font-extrabold tabular-nums max-md:w-[2.1rem] max-md:text-[10px]",
          onTheClock ? "text-primary-foreground" : "text-muted-foreground/85",
        )}
      >
        {slot.label}
      </span>

      {/*
        WHO OWNS THE PICK — the manager's handle, not the franchise name,
        matching the grid's column heads and the header's clock line. Every
        handle in this league is one short word, so the column is the same width
        on every row.

        A traded pick names the franchise it came FROM, in that word rather than
        as an arrow between two handles. The grid's own strip can use a bare
        arrow because it hangs inside the original owner's column, so the
        direction is given by where it is; a row has no column to be read
        against, and "STEFAN → ZACH" and "ZACH ← STEFAN" are the same fact
        written two ways. The board learnt this once already, printing "VIA PI",
        which nobody decoded.
      */}
      <span
        className={cn(
          "flex w-[10rem] shrink-0 items-baseline gap-[0.35vw] truncate text-[clamp(0.62rem,0.75vw,1rem)] font-black uppercase max-md:w-[4.4rem] max-md:flex-col max-md:items-start max-md:gap-0 max-md:text-[10px]",
          onTheClock && "text-primary-foreground",
        )}
      >
        {slot.currentOwner.name}
        {slot.traded && (
          <span
            className={cn(
              "min-w-0 max-w-full truncate text-[clamp(0.5rem,0.58vw,0.75rem)] font-black max-md:text-[8px]",
              // A shade under the handle it qualifies. `--trade` is white — see
              // the note on the grid's own strip — so at full strength the pick's
              // history reads as loudly as who holds it.
              onTheClock ? "text-primary-foreground/70" : "text-trade/70",
            )}
          >
            from {slot.originalOwner.name}
          </span>
        )}
      </span>

      {onTheClock ? (
        <span className="text-primary-foreground flex-1 text-[clamp(0.62rem,0.75vw,1rem)] font-black tracking-[0.08em] max-md:text-[10px]">
          ON THE CLOCK
        </span>
      ) : empty ? (
        <span className="text-muted-foreground/35 flex-1 text-[clamp(0.62rem,0.72vw,0.95rem)] font-bold">
          —
        </span>
      ) : (
        <>
          <span
            className={cn(
              "flex w-[3.2rem] shrink-0 items-center gap-[0.25vw] text-[clamp(0.6rem,0.72vw,0.95rem)] font-black max-md:w-[2.1rem] max-md:text-[10px]",
              positionText(slot.player!.position),
            )}
          >
            {slot.player!.position}
            {slot.fill === "keeper" && (
              <Lock className="h-[0.9em] w-[0.9em] shrink-0" aria-label="Keeper" />
            )}
          </span>
          {/*
            Printed in full, not shortened. A row is one line of a 64rem column
            rather than a 170px cell, so there is room for the longest name in
            the pool without the `boardName` initial the grid needs.
          */}
          <span className="text-foreground min-w-0 flex-1 truncate text-[clamp(0.68rem,0.82vw,1.1rem)] font-extrabold max-md:text-[12px]">
            {slot.player!.name}
          </span>
          <span className="text-muted-foreground/85 shrink-0 font-mono text-[clamp(0.55rem,0.62vw,0.8rem)] font-bold tabular-nums max-md:text-[9px]">
            {slot.player!.nflTeam ?? "FA"}
            {slot.player!.byeWeek != null && ` · BYE ${slot.player!.byeWeek}`}
          </span>
        </>
      )}
    </div>
  );
}

/** The unabbreviated row, for its tooltip. */
function rowDetail(slot: LiveSlot): string {
  const owner = slot.traded
    ? `${slot.originalOwner.name}'s pick, now ${slot.currentOwner.name}`
    : slot.currentOwner.name;
  const head = `${slot.label} (pick ${slot.overallPick}) — ${owner}`;
  const player = slot.player;
  if (!player) return `${head} · not entered yet`;
  const parts = [
    player.position,
    player.nflTeam ?? "free agent",
    player.byeWeek != null ? `bye week ${player.byeWeek}` : null,
    slot.fill === "keeper" ? "keeper" : null,
  ].filter(Boolean);
  return `${head} · ${player.name} (${parts.join(", ")})`;
}

"use client";

import { LayoutList, Lock } from "lucide-react";

import { cn } from "@/lib/utils";
import { positionText } from "@/lib/positions";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { FranchiseLineup, LineupPlayer } from "@/lib/roster-lineup";
import type { LiveSlot } from "@/lib/draft-types";

/**
 * The roster of whoever is on the clock, down the side of the board.
 *
 * The commissioner's own proposal, endorsed by the league member he watched
 * Smart Draft with: "a pane that comes up for whoever's on the clock, with a
 * quick view of their roster on the side… so people can talk about what their
 * roster looks like."
 *
 * ITS PURPOSE IS SOCIAL, NOT ANALYTICAL. It is there so the room can heckle
 * somebody for holding four running backs and no quarterback.
 *
 * It is therefore a LINEUP CARD, not a position tally: every slot the league
 * fields gets a printed row — QB, RB1, RB2, WR1, WR2, FLEX1, FLEX2, TE, DST,
 * then every bench slot — filled or empty. The empty rows are the point. A pane
 * that only listed what a franchise owns would hide the one interesting thing
 * on it, which is the hole where the quarterback should be. Row order and row
 * count both come from `@/lib/league-config` by way of `lineupSlots()`, so the
 * card and the Rosters wall can never disagree about the shape of a roster.
 *
 * The type is sized in `vw` because this is read from fifteen feet along with
 * the rest of the board.
 *
 * EVERY ROW IS TWO LINES, and that is what makes the type big enough to read.
 * A row used to be one line — label, padlock, name, position, pick number, all
 * competing for 215px — and the name got 124px of it, which caps a name at
 * about 10px before the longest ones wrap. Giving the name a line of its own
 * takes it from 11.5px to 15.4px, and the size is not eyeballed: the widest
 * name in the player pool is "Dorian Thompson-Robinson" at 13.75em of Inter
 * Bold, and 215px / 13.75 is 15.7px, so 0.8vw is the largest the name can be
 * and still put every player in the pool on one line. That is what keeps the
 * grid uniform without truncating anybody.
 *
 * WHAT IT MUST NEVER SHOW: anything about players who are still available. No
 * ADP, no rankings, no suggestions, no best-available. This league deliberately
 * dropped its cheat-sheet overlay — "it felt like cheating" — and this pane
 * shows only what the franchise on the clock already owns. Keepers included,
 * because they are part of that roster and part of the argument.
 *
 * It is also deliberately narrow and never grows: the grid is the primary
 * object on the screen and the pane is not allowed to take space it needs.
 */

/*
 * Every size the card draws itself at, as two sets of one variable.
 *
 * The pane is read from fifteen feet across a room, so it is sized in `vw`. A
 * phone is read at arm's length and has the whole width of the screen, so the
 * same rows want fixed pixels. Threading a `sheet` boolean down to every row
 * would have meant a conditional on each of the type sizes below; one set of
 * variables on the wrapper means the rows never learn which surface they are on.
 *
 * WHAT THE PANE'S NUMBERS ARE, at the 1080p signal the draft is run on, and what
 * they subtend from the back seat of the room — 18 ft from a 16 ft screen, so
 * 10 px per inch, and Inter draws a capital at 0.73 of its em:
 *
 *              was            is            arcmin  (floor)
 *   name       11.5px         15.4px        17.9    (16)
 *   label      10.8px         15.0px        17.4    (12)
 *   open       10.8px         15.4px        17.9    (12)
 *   meta        9.6px         13.4px        15.6    (12)
 *   eyebrow    10.8px         12.7px        14.7    (12)
 *   title      16.5px         19.6px        22.8    (12)
 *
 * Nothing was below its floor by accident: the pane was written to fit sixteen
 * rows on one line each, and one line each is what held the name to 11.5px. The
 * vertical space the two-line row spends was already there and empty — a third
 * of the pane below the last bench row, at every viewport measured.
 *
 * The `vw` floors in the clamps are the phone-sized end of each range and only
 * bind below about 1400px wide, where the pane is on a laptop a foot away
 * rather than on the wall.
 */
const PANE_TYPE =
  "[--rs-title:clamp(0.9rem,1.02vw,1.6rem)] [--rs-eyebrow:clamp(0.62rem,0.66vw,1.05rem)] " +
  "[--rs-label:clamp(0.7rem,0.78vw,1.25rem)] [--rs-name:clamp(0.72rem,0.8vw,1.3rem)] " +
  "[--rs-meta:clamp(0.66rem,0.7vw,1.1rem)] [--rs-row:0.45vh] [--rs-pad:0.6vw] [--rs-gap:0.3vw]";

const SHEET_TYPE =
  "[--rs-title:19px] [--rs-eyebrow:12px] [--rs-label:14px] [--rs-name:15px] " +
  "[--rs-meta:12px] [--rs-row:6px] [--rs-pad:12px] [--rs-gap:6px]";

export function OnTheClockRoster({
  lineup,
  slot,
  /** "on the clock" normally; the mock says whose turn it is more loudly. */
  eyebrow = "On the clock",
  /**
   * `pane` is the column down the right of the board. `sheet` is the same card
   * filling a phone's bottom drawer, where it is the only thing on screen — see
   * the note on `RosterSheet` in `draft-board.tsx` for why a phone gets it that
   * way rather than not at all.
   */
  layout = "pane",
}: {
  lineup: FranchiseLineup | null;
  slot: LiveSlot | null;
  eyebrow?: string;
  layout?: "pane" | "sheet";
}) {
  const sheet = layout === "sheet";
  /*
   * Hidden below `lg` as a pane. On a phone the grid already has nothing to
   * spare and the pane would push it to a column of confetti; the projector and
   * the commissioner's laptop are both well past that breakpoint. The sheet is
   * how a phone gets at the same card instead.
   */
  const frame = sheet
    ? `flex w-full min-h-0 flex-col overflow-hidden ${SHEET_TYPE}`
    : `hidden w-[12.5vw] shrink-0 flex-col overflow-hidden rounded-lg lg:flex ${PANE_TYPE}`;

  if (!lineup) {
    return (
      <aside className={cn("border-border bg-board-base border", frame)}>
        <div className="text-muted-foreground/60 p-[var(--rs-pad)] text-[length:var(--rs-name)]">
          That&apos;s the draft — nobody is on the clock.
        </div>
      </aside>
    );
  }

  const set = lineup.openStarterLabels.length === 0;

  return (
    <aside
      className={cn("border-live bg-board-base border-[0.08vw]", frame)}
    >
      {/* --- Who --------------------------------------------------------- */}
      <div className="border-border/60 shrink-0 border-b px-[var(--rs-pad)] py-[0.5vh]">
        <div className="text-live text-eyebrow text-[length:var(--rs-eyebrow)]">
          {eyebrow}
        </div>
        {/* The man by the handle the league calls him — see the header bar. */}
        <div className="mt-[0.2vh] text-[length:var(--rs-title)] leading-[1.1] font-black break-words uppercase">
          {lineup.team.name}
        </div>
        <div className="text-muted-foreground mt-[0.25vh] flex flex-wrap items-baseline gap-x-[0.4vw] text-[length:var(--rs-eyebrow)] font-semibold">
          <span>{lineup.team.franchiseName}</span>
          {slot && (
            <span className="font-mono tabular-nums">{slot.label}</span>
          )}
          {slot?.traded && (
            <span className="text-trade font-black uppercase">
              via {slot.originalOwner.name}
            </span>
          )}
        </div>
      </div>

      {/* --- Where the roster stands ------------------------------------- */}
      {/*
        NEUTRAL WHILE THE LINEUP IS INCOMPLETE, GREEN ONLY ONCE IT IS DONE.

        This bar was `--warning` amber, and the amber was wrong twice over. It is
        the exact same token as the TE position hue — `--ds-amber` serves both, so
        the separation is 0° on a board whose tightest pair is 42.4° — and, the
        bigger problem, an open starting slot in round one is
        the NORMAL state of a roster. Every franchise opens the draft with seven
        of them, so the alarm colour fired on the default and stopped carrying
        information; it just made the pane loud.

        So the incomplete state is neutral and merely states the count, and the
        one genuinely notable state — a lineup that is actually full — keeps the
        hue. Colour now appears when something has been ACHIEVED rather than when
        nothing has happened yet.
      */}
      <div
        className={cn(
          "shrink-0 px-[var(--rs-pad)] py-[0.4vh] text-[length:var(--rs-label)] font-black tracking-[0.04em] uppercase",
          set
            ? "bg-success/15 text-success"
            : "bg-foreground/[0.07] text-foreground/85",
        )}
        title={
          set
            ? "Every starting slot has somebody in it"
            : `Starting slots with nobody in them: ${lineup.openStarterLabels.join(", ")}`
        }
      >
        {/*
          A COUNT, not the list. The card below already names every open slot in
          its own row, and spelling them out again ran to three wrapped lines in
          a pane this narrow — pushing the roster itself off the screen to repeat
          what the roster was about to say.
        */}
        {set ? (
          <>Lineup set &middot; {lineup.rosterSize}/{lineup.rosterCap}</>
        ) : (
          <>
            {lineup.openStarterLabels.length} starter
            {lineup.openStarterLabels.length === 1 ? "" : "s"} open &middot;{" "}
            {lineup.rosterSize}/{lineup.rosterCap}
          </>
        )}
      </div>

      {/* --- The lineup card, slot by slot ------------------------------- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lineup.starters.map((s) => (
          <SlotRow
            key={s.label}
            label={s.label}
            player={s.player}
            starter
            /*
             * FLEX names a group, not a position, so the row has to say what is
             * actually standing in it. The dedicated slots do not: "RB2" holding
             * an RB is not news.
             */
            showPosition={s.eligible.length > 1}
            /* One eligible position means the LABEL can carry that hue. */
            slotPosition={s.eligible.length === 1 ? s.eligible[0] : null}
          />
        ))}

        {/*
          Drawn, not implied by a gap. The line between a starting lineup and a
          bench is the difference between having a team and having bodies, which
          is exactly what the room is arguing about.
        */}
        <div className="border-border/60 bg-muted/40 flex items-center gap-[0.4vw] border-y px-[var(--rs-pad)] py-[var(--rs-row)]">
          <span className="text-muted-foreground/70 text-[length:var(--rs-meta)] font-black tracking-[0.14em] uppercase">
            Bench
          </span>
          <span className="text-muted-foreground/50 font-mono text-[length:var(--rs-meta)] font-bold tabular-nums">
            {lineup.bench.length}/{lineup.benchSize}
          </span>
        </div>

        {Array.from({ length: lineup.benchSize }, (_, i) => (
          <SlotRow
            key={`BN${i + 1}`}
            label={`BN${i + 1}`}
            player={lineup.bench[i] ?? null}
            showPosition
          />
        ))}

        {/*
          Should never render. An illegal roster that looks legal is worse than
          an ugly pane, so the 17th man is printed rather than dropped.
        */}
        {lineup.overflow.length > 0 && (
          <div className="border-destructive/50 bg-destructive/10 border-y">
            {lineup.overflow.map((p) => (
              <SlotRow key={p.playerId} label="OVER" player={p} showPosition />
            ))}
          </div>
        )}
      </div>

      {/* --- How much is left ------------------------------------------- */}
      <div className="border-border/60 text-muted-foreground/70 shrink-0 border-t px-[var(--rs-pad)] py-[0.35vh] text-[length:var(--rs-meta)] font-semibold">
        {lineup.picksRemaining} pick{lineup.picksRemaining === 1 ? "" : "s"} left
        {lineup.keeperCount > 0 && (
          <> &middot; {lineup.keeperCount} kept</>
        )}
      </div>
    </aside>
  );
}

/**
 * The same card, as a drawer up from the bottom of a phone.
 *
 * The pane is `hidden` below `lg` and always has been, for a good reason — at
 * 412px it would leave the grid a column of confetti. The consequence nobody
 * had looked at is that the roster was then not reachable on a phone AT ALL,
 * and the roster is the social point of the whole screen: it is what the room
 * heckles somebody's four running backs off.
 *
 * A drawer rather than a fourth entry on the Board / Picks / Rosters toggle,
 * because this is the roster of ONE franchise — whoever the cursor is on — and
 * that is a glance, not a view you sit in. It comes up over the board and goes
 * again, and the board underneath has not moved.
 *
 * Above `lg` the trigger is not rendered and the pane is, so no screen ever
 * offers both.
 */
export function OnTheClockRosterSheet({
  lineup,
  slot,
  eyebrow,
}: {
  lineup: FranchiseLineup | null;
  slot: LiveSlot | null;
  eyebrow: string;
}) {
  return (
    <Sheet>
      <SheetTrigger
        render={
          <button
            type="button"
            title="The roster of whoever is on the clock"
            className="border-border/60 text-foreground flex h-9 shrink-0 items-center justify-center gap-1 rounded border px-2 text-[11px] font-semibold portrait:h-11 lg:hidden"
          />
        }
      >
        <LayoutList className="h-3.5 w-3.5" />
        {lineup?.team.name ?? "Roster"}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="bg-board-base max-h-[80dvh] gap-0 rounded-t-xl p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>
            {lineup ? `${lineup.team.name}'s roster` : "Roster"}
          </SheetTitle>
        </SheetHeader>
        {/* `pt-9` clears the sheet's own close button, which floats top-right. */}
        <div className="flex min-h-0 flex-col overflow-hidden pt-9">
          <OnTheClockRoster
            lineup={lineup}
            slot={slot}
            eyebrow={eyebrow}
            layout="sheet"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * THE COLOUR IN THIS PANE IS ON THE SLOT LABELS, AND NOWHERE ELSE.
 *
 * The commissioner, on the pane once it was legible: "it's a lot of white
 * besides the keeper lock, but it might make sense to use the colors a bit, at
 * least for the starters?"
 *
 * The label is the right place to spend it and the name is the wrong one. What
 * somebody glancing at this pane wants is "what does he still NEED", and that is
 * a question about the SLOTS — so a coloured rail down the left answers it
 * before a word is read, and answers it on a roster with nothing in it yet,
 * which is what most of draft night looks like. The name is the thing actually
 * being read from 18 ft, and white on this base is the highest contrast the
 * board has; tinting it would spend legibility on decoration.
 *
 * The hues come from `positionText`, which is where the grid's position tags and
 * the keeper padlock get theirs, so a hue cannot come to mean two things.
 *
 * FLEX gets all three of the hues it accepts, always — see `FLEX_TONE`. The
 * bench stays grey whatever is in it: that is the commissioner's own "at least
 * for the starters", and the dim block underneath is what makes the starting
 * nine read as the half that matters.
 */
function labelTone(
  starter: boolean | undefined,
  slotPosition: string | null | undefined,
): string {
  if (!starter) return "text-muted-foreground/50";
  return slotPosition ? positionText(slotPosition) : FLEX_TONE;
}

/**
 * FLEX, in all three of the hues it takes: "for flex can you do a rainbow
 * gradient across WR/RB/TE :)"
 *
 * The label says what the slot ACCEPTS, so it is the one label that cannot be a
 * single hue — and it holds the gradient whether or not somebody is in it,
 * which was the ruling when the alternative was offered: "no, flex is flex. It
 * can stay the rainbow gradient." A flex slot with a running back in it is still
 * a flex slot, and the row's own position tag on the right already says which of
 * the three is standing there, so nothing is lost by leaving the label alone.
 *
 * ============================================================================
 * WHY THE STOPS ARE IN HUE ORDER AND THE BLEND IS IN OKLCH
 * ============================================================================
 * The first version ran mint → blue → amber and blended in sRGB, and the middle
 * of the word went grey: "the E and X are washed-out grey-blue". Two separate
 * causes, both fixed here.
 *
 *   · SRGB INTERPOLATION CROSSES THE NEUTRAL AXIS. Blue and amber sit nearly
 *     opposite each other, so the straight line between them in RGB passes close
 *     to grey. Measured, the least saturated column of that gradient had a
 *     channel spread of 0.11 — very nearly a neutral. In `oklch` the same three
 *     stops never drop below 0.51, because the hue rotates instead of the chroma
 *     collapsing. The tokens are authored in `oklch` in the first place, so this
 *     removes a conversion rather than adding one.
 *   · THE HUES WERE OUT OF ORDER. Mint (152°) → blue (255°) → amber (84°) turns
 *     round and comes back through the greens it already passed, which is what
 *     made the word look like it had a blue core with no amber in it. Sorted by
 *     hue — blue, mint, amber — the sweep is monotonic and reads as one sweep.
 *
 * `longer hue` was tried and rejected on grounds that are not taste: the long way
 * round from blue to amber goes through pink and lavender, and in this app pink
 * IS the quarterback and lavender IS the defence. A flex label containing two
 * other positions' colours is worse than a dull one.
 *
 * The plateaus are what makes five characters legible rather than a smear: each
 * hue holds flat across roughly one glyph — blue on the F, mint on the E, amber
 * on the index digit — with the blends landing on the L and the X. The digit is
 * the only part of this label carrying information, which is why amber, the
 * brightest of the three, is the end the sweep runs to.
 *
 * Blue still governs contrast, as the darkest stop: the worst column measures
 * 5.26:1, against a floor of 4.5. `scripts/verify-roster-pane.mjs` walks the
 * whole label with CSS's own interpolation rather than trusting that.
 *
 * ============================================================================
 * TWO DECLARATIONS, DELIBERATELY
 * ============================================================================
 * The class list carries the plain sRGB gradient and the inline style carries the
 * `oklch` one. `in oklch` needs Chrome 111 or Safari 16.2; where it is not
 * understood the inline declaration is dropped at parse time and the class-based
 * gradient is what paints. That matters more here than it usually would, because
 * the fill is transparent — a dropped gradient with no fallback is not a duller
 * label, it is an invisible one.
 *
 * Inline rather than a second utility because two classes setting the same
 * property leave the order to the stylesheet, and the order IS the fallback.
 *
 * `bg-clip-text` throughout: paint only. The row's height, the label's box and
 * the two-line geometry are untouched, which is the whole reason it is done this
 * way rather than with three coloured spans.
 */
const FLEX_TONE =
  "bg-linear-to-r from-pos-rb via-pos-wr to-pos-te bg-clip-text text-transparent";

const FLEX_RAINBOW = {
  backgroundImage:
    "linear-gradient(to right in oklch," +
    " var(--color-pos-rb) 0%, var(--color-pos-rb) 20%," +
    " var(--color-pos-wr) 42%, var(--color-pos-wr) 58%," +
    " var(--color-pos-te) 80%, var(--color-pos-te) 100%)",
};

/**
 * One printed slot, two lines: what the slot is and what the pick was, then
 * whoever is standing in it.
 *
 * An empty STARTING slot is drawn as a problem and an empty bench slot is not,
 * the same distinction the Rosters wall makes, because that is the difference
 * between a roster that cannot field a lineup and one that simply has picks
 * left.
 */
function SlotRow({
  label,
  player,
  starter,
  showPosition,
  slotPosition,
}: {
  label: string;
  player: LineupPlayer | null;
  starter?: boolean;
  showPosition?: boolean;
  /**
   * The position this slot is FOR, where it is for exactly one. Null on FLEX,
   * which is not a position, and on the bench, which takes anybody.
   */
  slotPosition?: string | null;
}) {
  return (
    <div
      data-slot-row={label}
      className={cn(
        "border-border/40 flex flex-col gap-[0.12vh] border-b px-[var(--rs-pad)] py-[var(--rs-row)] last:border-b-0",
        // A neutral lift, where this was an amber wash. It marks the same rows;
        // it just does it in the one direction that cannot be read as a
        // position, and quietly, because seven open starters is where every
        // roster begins. See the count bar above.
        starter && !player && "bg-foreground/[0.035]",
      )}
      title={
        player
          ? `${label}: ${player.name} — ${player.position}, ${
              player.nflTeam ?? "FA"
            }${player.byeWeek != null ? `, bye ${player.byeWeek}` : ""}, ${
              player.source === "keeper"
                ? `kept at ${player.label}`
                : `drafted ${player.label}`
            }`
          : `${label}: nobody`
      }
    >
      {/*
        LINE ONE — the slot's own name, and everything about the pick that is
        not the player. All of it small, all of it out of the name's way.

        `leading-none` on both sides is what makes an open row and a filled row
        the same height: this line is then exactly the label's own size in both,
        rather than the taller of two different line boxes.
      */}
      <div className="flex items-center justify-between gap-[var(--rs-gap)] leading-none">
        <span
          className={cn(
            "text-[length:var(--rs-label)] font-black tabular-nums",
            labelTone(starter, slotPosition),
          )}
          style={starter && !slotPosition ? FLEX_RAINBOW : undefined}
        >
          {label}
        </span>

        {player && (
          <span className="flex shrink-0 items-center gap-[var(--rs-gap)]">
            {/*
              THE PADLOCK BELONGS TO THE POSITION TAG, as it does in the grid:
              inside the tag's own span, immediately to its right, taking its
              colour from `currentColor` so it is green beside WR and gold beside
              TE and the two can never drift apart. The commissioner asked for
              exactly that — "the lock to the right of the position tag… as the
              same color as the position tag… they need to be kinda evident" —
              and this pane is read side by side with the grid.

              A dedicated slot does not print its position (see `showPosition`),
              so on those rows the lock is the whole tag. It still takes the
              position's hue, which is the one thing the tag would have said.
            */}
            {(showPosition || player.source === "keeper") && (
              <span
                className={cn(
                  "flex items-center gap-[0.25em] text-[length:var(--rs-meta)] font-black",
                  positionText(player.position),
                )}
              >
                {showPosition && player.position}
                {player.source === "keeper" && (
                  <Lock
                    className="h-[1.05em] w-[1.05em] shrink-0"
                    strokeWidth={2.75}
                    aria-label="Keeper"
                  />
                )}
              </span>
            )}
            {/*
              5ch and right-aligned so "1.01" and "16.12" end on the same pixel
              down the column, which is what stops the position tags beside them
              from stepping in and out.
            */}
            <span className="text-muted-foreground/70 min-w-[5ch] text-right font-mono text-[length:var(--rs-meta)] font-bold tabular-nums">
              {player.label}
            </span>
          </span>
        )}
      </div>

      {/*
        LINE TWO — whoever is in the slot, with the whole width of the pane to
        himself, which is the only reason he can be read from the back of the
        room. `break-words` is the backstop rather than the plan: at 1920 every
        name in the pool fits on this line (see the note on `--rs-name`), and
        below about 1300px the widest few wrap to a second line rather than
        being cut.

        "open" is drawn at the name's size, not smaller. It shares the line box
        with a name so that a roster of holes and a roster of players are the
        same shape, and it is the thing the room is actually looking for.
      */}
      <div className="text-[length:var(--rs-name)] leading-[1.2]">
        {player ? (
          <span className="font-bold break-words">{player.name}</span>
        ) : (
          <span
            className={cn(
              "font-semibold",
              // Starter vs bench is still the distinction worth drawing, and it
              // is still drawn — one rung of the neutral ramp apart instead of a
              // hue apart. Amber here was seven words of alarm per roster.
              starter ? "text-muted-foreground" : "text-muted-foreground/30",
            )}
          >
            open
          </span>
        )}
      </div>
    </div>
  );
}

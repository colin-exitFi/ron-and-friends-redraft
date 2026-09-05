"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { positionChipSolid, positionStyle } from "@/lib/positions";
import {
  STARTER_COUNT,
  buildFranchiseLineups,
  type FranchiseLineup,
  type LineupProjectionPoints,
  type LineupPlayer,
} from "@/lib/roster-lineup";
import { DRAFTABLE_POSITIONS } from "@/lib/board-types";
import type { DraftRoomView } from "@/lib/draft-types";

/**
 * Rosters, one franchise at a time, switched without navigating.
 *
 * The complaint this answers: there was no roster tab, and the only way to see
 * a roster was /teams → click a franchise → read a keeper list → go back. His
 * friend could not find rosters at all. So this is a top-level surface whose
 * entire job is "show me a team, now show me the next one" — the ten franchises
 * are a row of buttons across the top and switching is a state change, not a
 * page load.
 *
 * ONE COMPONENT, TWO SOURCES. It renders from a `DraftRoomView`, which is what
 * the real board produces and what a mock draft produces, so a finished mock is
 * judged by the identical layout as Saturday's real result. That is the whole
 * reason to lay a roster out by starting slot rather than as a list: the
 * question being asked of a mock is "is this a real team", and a list of
 * fourteen names cannot answer it while nine named slots can.
 *
 * IT HAS TO WORK EMPTY. Until Saturday every franchise holds only keepers, so
 * the pre-draft state is the normal state, not an error state — seven of the
 * nine slots are open and the screen has to read as "here is what is locked in
 * and what it cost" rather than as a broken page.
 */

type Props = {
  view: DraftRoomView;
  /**
   * Which franchise to open on. Falls back to the first in draft order.
   * The mock passes the franchise the commissioner is controlling.
   */
  initialTeamId?: string | null;
  /**
   * Left/right arrows cycle franchises. Off inside the mock, where the document
   * keyboard belongs to the name box and arrows would fight it.
   */
  keyboard?: boolean;
  /** Links through to /teams/[id] for keeper tenure and pick detail. */
  showTeamLink?: boolean;
  /** Extra chrome above the switcher — the mock puts its controls here. */
  children?: React.ReactNode;
  /** Season points keyed by player id; board order is the fallback. */
  projectedPoints?: LineupProjectionPoints;
};

export function RosterBoard({
  view,
  initialTeamId = null,
  keyboard = true,
  showTeamLink = true,
  projectedPoints = {},
  children,
}: Props) {
  const lineups = useMemo(
    () => buildFranchiseLineups(view, projectedPoints),
    [view, projectedPoints],
  );
  const [teamId, setTeamId] = useState<string | null>(initialTeamId);

  /*
   * Derived rather than stored, so a franchise that vanished from the board —
   * which a re-pulled snapshot could do — falls back to the first one instead
   * of rendering nothing.
   */
  const selected = lineups.find((l) => l.team.id === teamId) ?? lineups[0] ?? null;
  const at = selected ? lineups.findIndex((l) => l.team.id === selected.team.id) : -1;

  const step = useCallback(
    (delta: number) => {
      if (lineups.length === 0) return;
      const next = (at + delta + lineups.length) % lineups.length;
      setTeamId(lineups[next].team.id);
    },
    [at, lineups],
  );

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "ArrowRight" || event.key === "]") step(1);
      else if (event.key === "ArrowLeft" || event.key === "[") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, step]);

  if (!selected) {
    return (
      <p className="text-muted-foreground text-sm">
        The board carries no franchises, so there are no rosters to show.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {children}

      <FranchiseSwitcher
        lineups={lineups}
        selectedId={selected.team.id}
        onSelect={setTeamId}
      />

      <RosterCard
        lineup={selected}
        view={view}
        showTeamLink={showTeamLink}
      />
    </div>
  );
}

// --- The switcher -----------------------------------------------------------

/**
 * Ten buttons, always all ten visible.
 *
 * A dropdown would have been less code and worse: the reason to want this
 * screen is comparing franchises, and a dropdown hides the other nine behind a
 * click. Each button carries its roster count, so the row doubles as the
 * league-wide answer to "who has actually filled a team".
 *
 * One column on a phone. Two columns leaves roughly 100px for the name, and
 * "Fingers are for painting" cannot be told from "Fingers are for pain…" when
 * the whole job of the row is picking the right franchise. A full-width row
 * fits the franchise and the manager unabbreviated and costs only a scroll.
 */
function FranchiseSwitcher({
  lineups,
  selectedId,
  onSelect,
}: {
  lineups: FranchiseLineup[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Franchises"
      className="border-border bg-card grid grid-cols-2 gap-1 rounded-lg border p-1 max-md:grid-cols-1 sm:grid-cols-3 lg:grid-cols-5"
    >
      {lineups.map((l) => {
        const active = l.team.id === selectedId;
        return (
          <button
            key={l.team.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(l.team.id)}
            title={`${l.team.franchiseName} · ${l.team.manager}`}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors",
              active
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted text-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded font-mono text-xs font-bold",
                active
                  ? "bg-primary-foreground/15"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {l.team.slot}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm leading-tight font-semibold">
                {l.team.franchiseName}
              </span>
              <span
                className={cn(
                  "block truncate text-xs leading-tight",
                  active ? "opacity-75" : "text-muted-foreground",
                )}
              >
                {l.team.manager}
              </span>
            </span>
            <span
              className={cn(
                "shrink-0 font-mono text-xs font-bold tabular-nums",
                active ? "opacity-90" : "text-muted-foreground",
              )}
            >
              {l.rosterSize}
              <span className={active ? "opacity-60" : "opacity-50"}>
                /{l.rosterCap}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// --- The card ---------------------------------------------------------------

function RosterCard({
  lineup,
  view,
  showTeamLink,
}: {
  lineup: FranchiseLineup;
  view: DraftRoomView;
  showTeamLink: boolean;
}) {
  const startersFilled = lineup.starters.filter((s) => s.player).length;
  const legal = lineup.openStarterLabels.length === 0;
  /**
   * "Nothing drafted" is a property of the whole board, not of this franchise —
   * a franchise with no keepers and no picks yet is in the same pre-draft state
   * as one holding two, and both should read that way.
   */
  const preDraft = view.picksMade === 0;

  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      {/* --- Header ------------------------------------------------------- */}
      <div className="border-border bg-wash-primary flex flex-col gap-3 border-b px-5 py-4 max-md:px-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-xl leading-tight font-bold max-md:text-[17px]">
              {lineup.team.franchiseName}
            </h2>
            <Badge variant="outline" className="font-mono">
              {lineup.team.abbrev}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {lineup.team.manager}
            <span className="text-muted-foreground/60">
              {" "}
              &middot; draft slot {lineup.team.slot} &middot; called &ldquo;
              {lineup.team.name}&rdquo; in the room
            </span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {legal ? (
            <Badge variant="success">Lineup complete</Badge>
          ) : (
            <Badge variant="outline" title="Starting slots with nobody in them">
              Needs {lineup.openStarterLabels.join(", ")}
            </Badge>
          )}
          {showTeamLink && (
            <Link
              href={`/teams/${lineup.team.id}`}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm touch:min-h-11 max-md:px-1"
              title="Keeper tenure, cost rounds, and every pick this franchise holds"
            >
              Franchise detail
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </div>

      {/* --- Numbers ------------------------------------------------------ */}
      <div className="border-border divide-border grid grid-cols-2 divide-x border-b sm:grid-cols-4">
        <Figure
          label="Roster"
          value={`${lineup.rosterSize}`}
          of={`${lineup.rosterCap}`}
          note={`${lineup.benchSize} bench`}
        />
        <Figure
          label="Starters"
          value={`${startersFilled}`}
          of={`${STARTER_COUNT}`}
          note={legal ? "fillable lineup" : "holes to fill"}
          accent={legal}
        />
        <Figure
          label="Keepers"
          value={`${lineup.keeperCount}`}
          note={lineup.keeperCount === 1 ? "locked in" : "locked in"}
        />
        <Figure
          label="Picks left"
          value={`${lineup.picksRemaining}`}
          note={lineup.picksRemaining === 0 ? "board complete" : "still to make"}
        />
      </div>

      <div className="border-border flex flex-wrap items-center gap-1.5 border-b px-5 py-2.5 max-md:px-3.5">
        {DRAFTABLE_POSITIONS.map((pos) => {
          const n = lineup.byPosition[pos] ?? 0;
          const atCap = lineup.positionsAtCap.includes(pos);
          return (
            <span
              key={pos}
              title={atCap ? `${pos} is at the league roster limit` : `${n} ${pos}`}
              className={cn(
                "rounded px-2 py-0.5 text-xs font-bold tabular-nums ring-1",
                n === 0
                  ? "text-muted-foreground/50 ring-border"
                  : positionStyle(pos),
                atCap && "ring-2",
              )}
            >
              {pos} {n}
            </span>
          );
        })}
        {preDraft && (
          <span className="text-muted-foreground/70 ml-auto text-xs">
            Keepers only &mdash; the draft has not started
          </span>
        )}
      </div>

      {/* --- Lineup ------------------------------------------------------- */}
      <div className="grid gap-0 lg:grid-cols-2 lg:divide-x lg:divide-border">
        <section>
          <SectionHead
            title="Starting lineup"
            note={`${startersFilled} of ${STARTER_COUNT} filled`}
          />
          <ul className="divide-border divide-y">
            {lineup.starters.map((slot, i) => (
              <li key={`${slot.label}-${i}`}>
                {slot.player ? (
                  <PlayerRow slotLabel={slot.label} player={slot.player} />
                ) : (
                  <OpenRow
                    slotLabel={slot.label}
                    eligible={slot.eligible}
                    picksRemaining={lineup.picksRemaining}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="border-border border-t lg:border-t-0">
          <SectionHead
            title="Bench"
            note={`${lineup.bench.length} of ${lineup.benchSize} filled`}
          />
          <ul className="divide-border divide-y">
            {Array.from({ length: lineup.benchSize }, (_, i) => (
              <li key={`bench-${i}`}>
                {lineup.bench[i] ? (
                  <PlayerRow slotLabel={`BN${i + 1}`} player={lineup.bench[i]} muted />
                ) : (
                  <OpenRow
                    slotLabel={`BN${i + 1}`}
                    eligible={[]}
                    picksRemaining={lineup.picksRemaining}
                    muted
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {lineup.overflow.length > 0 && (
        <div className="border-destructive/40 bg-destructive/5 border-t px-5 py-3 max-md:px-3.5">
          <p className="text-destructive text-sm font-semibold">
            {lineup.overflow.length} player
            {lineup.overflow.length === 1 ? "" : "s"} beyond the{" "}
            {lineup.rosterCap}-man active roster
          </p>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {lineup.overflow.map((p) => p.name).join(", ")} &mdash; this roster is
            over the cap and could not be fielded as it stands.
          </p>
        </div>
      )}
    </div>
  );
}

function Figure({
  label,
  value,
  of,
  note,
  accent,
}: {
  label: string;
  value: string;
  of?: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className="px-5 py-3 max-md:px-3">
      <p className="text-muted-foreground text-[11px] font-bold tracking-[0.14em] uppercase max-md:text-[10px]">
        {label}
      </p>
      <p className="mt-1 font-mono text-2xl leading-none font-bold tabular-nums">
        <span className={accent ? "text-success" : undefined}>{value}</span>
        {of && <span className="text-muted-foreground/50 text-base">/{of}</span>}
      </p>
      {note && <p className="text-muted-foreground mt-1 text-xs">{note}</p>}
    </div>
  );
}

function SectionHead({ title, note }: { title: string; note: string }) {
  return (
    <div className="border-border bg-muted/30 flex items-baseline justify-between border-b px-5 py-2 max-md:px-3.5">
      <h3 className="text-xs font-bold tracking-[0.14em] uppercase">{title}</h3>
      <span className="text-muted-foreground font-mono text-xs tabular-nums">
        {note}
      </span>
    </div>
  );
}

/** The slot's name, in a fixed-width gutter so nine rows read as a column. */
function SlotTag({ label, muted }: { label: string; muted?: boolean }) {
  return (
    <span
      className={cn(
        "w-12 shrink-0 font-mono text-xs font-bold tracking-tight max-md:w-8 max-md:text-[11px]",
        muted ? "text-muted-foreground/50" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function PlayerRow({
  slotLabel,
  player,
  muted,
}: {
  slotLabel: string;
  player: LineupPlayer;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-2 max-md:gap-2 max-md:px-3">
      <SlotTag label={slotLabel} muted={muted} />
      {/*
       * The lock rides with the position, which is where every other surface
       * that prints one puts it — board cell, pick list, roster wall. Here it
       * used to trail the player's NAME, and a name truncates, so the padlock
       * landed at a different x on all sixteen rows and could not be scanned
       * down the card. Pinned to the right of a fixed-width chip it is a
       * column, and the keepers can be counted without reading a word.
       */}
      <span className="flex w-14 shrink-0 items-center gap-0.5 touch:w-11">
        <span
          className={cn(
            "flex h-6 w-10 shrink-0 items-center justify-center rounded text-xs font-bold max-md:w-8 max-md:text-[11px]",
            positionChipSolid(player.position),
          )}
        >
          {player.position}
        </span>
        {player.source === "keeper" && (
          <Lock className="text-keeper h-3.5 w-3.5 shrink-0" aria-label="Keeper" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        {/* Deliberately smaller than the desktop row. A complete "Marvin
            Harrison Jr." at 13px beats "Marvin Harri…" at 15px. */}
        <span className="block truncate text-[15px] font-semibold max-md:text-[13px]">
          {player.name}
        </span>
        <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <span className="font-mono">{player.nflTeam ?? "FA"}</span>
          {player.byeWeek != null && <span>bye {player.byeWeek}</span>}
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span
          className={cn(
            "block font-mono text-xs font-bold tabular-nums",
            player.source === "keeper" ? "text-keeper" : "text-muted-foreground",
          )}
          title={
            player.source === "keeper"
              ? `Kept at ${player.label} — the pick this keeper costs`
              : `Drafted at ${player.label}`
          }
        >
          {player.label}
        </span>
        {player.acquiredFrom && (
          /*
           * "via Kyle", not "→ Kyle".
           *
           * The draft board's own trade banner uses an arrow because there the
           * column belongs to the ORIGINAL owner and the banner names where the
           * pick went. Here the row already belongs to the current owner and the
           * name is where the pick came FROM, so the same arrow read backwards —
           * it looked like this player had been traded away. "via" cannot be
           * read in two directions.
           */
          <span
            className="text-trade block text-[11px] font-bold"
            title={`This pick was acquired from ${player.acquiredFrom}`}
          >
            via {player.acquiredFrom}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * An empty slot, which pre-draft is most of the card.
 *
 * Says what the slot takes rather than just being blank, so the layout teaches
 * the lineup rules to somebody who has never seen them — and so seven empty
 * rows read as a roster waiting to be filled rather than as a failed render.
 */
function OpenRow({
  slotLabel,
  eligible,
  picksRemaining,
  muted,
}: {
  slotLabel: string;
  eligible: string[];
  picksRemaining: number;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-2 max-md:gap-2 max-md:px-3">
      <SlotTag label={slotLabel} muted />
      {/* Same width as the position-and-lock group above, so the two kinds of
          row share one left edge for the name. */}
      <span className="flex w-14 shrink-0 items-center touch:w-11">
        <span className="border-border/70 h-6 w-10 shrink-0 rounded border border-dashed max-md:w-8" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground/60 text-[15px] max-md:text-[13px]">Open</span>
        {eligible.length > 1 && (
          <span className="text-muted-foreground/50 ml-1.5 text-xs">
            {eligible.join(" / ")}
          </span>
        )}
      </span>
      {!muted && picksRemaining > 0 && (
        <span className="text-muted-foreground/40 shrink-0 text-xs">
          {picksRemaining} pick{picksRemaining === 1 ? "" : "s"} left
        </span>
      )}
    </div>
  );
}
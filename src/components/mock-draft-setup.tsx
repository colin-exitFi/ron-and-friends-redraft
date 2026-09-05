"use client";

import { useMemo, useState } from "react";
import { Bot, Eye, Lock, Play, User, X } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import { LEAGUE } from "@/lib/league-config";
import { buildRoomView } from "@/lib/draft-engine";
import { Button } from "@/components/ui/button";
import { BOT_ARCHETYPES, MOCK_PACES, archetypeByKey } from "@/lib/mock-draft-bots";
import {
  defaultAssignment,
  fromMockFile,
  type ArchetypeAssignment,
} from "@/lib/mock-draft-run";
import type { BoardView } from "@/lib/board-types";
import type { MockDraftFile } from "@/lib/mock-draft-types";

/**
 * Setting the board before the mock runs.
 *
 * This screen exists because the mock used to start drafting the moment the tab
 * opened: the bot loop mounted with the run already going and every franchise on
 * a bot, so the first pick landed 420ms after the page did and there was no
 * moment in which to say who you were. Nothing on this screen advances
 * anything — the running mock is not mounted until Start is pressed, which is
 * enforced by `@/components/mock-draft` rather than by a flag in here.
 *
 * Only settings the engine actually honours are offered. The controlled
 * franchise and the per-team archetypes are read straight back out of
 * `MockDraftFile`, so a resumed mock keeps the same room; the pace is the one
 * addition, and it is session state rather than a persisted field — see the note
 * on it in `@/components/mock-draft`.
 *
 * It is uncluttered on purpose: this is on a projector at a live draft, and the
 * thing a room needs to read is which franchise is his and what the other nine
 * are doing.
 */

export type MockSettings = {
  /** Which franchise the commissioner drafts for. Null = watch all ten bots. */
  controlledTeamId: string | null;
  archetypes: ArchetypeAssignment;
  /** A key from `MOCK_PACES`. Resolved to milliseconds by the running mock. */
  paceKey: string;
};

type Props = {
  board: BoardView;
  /**
   * A mock that can be picked up again — either the one saved to disk, or one
   * stepped away from in this session without losing it.
   */
  parked: MockDraftFile | null;
  /** What the screen opens on, so coming back from a run is not a reset. */
  initial: MockSettings;
  onStart: (settings: MockSettings) => void;
  onResume: () => void;
  /** Shown small, so it stays obvious this is not the live board. */
  stateFile: string;
};

export function MockDraftSetup({
  board,
  parked,
  initial,
  onStart,
  onResume,
  stateFile,
}: Props) {
  const [controlledTeamId, setControlledTeamId] = useState(initial.controlledTeamId);
  const [archetypes, setArchetypes] = useState<ArchetypeAssignment>(initial.archetypes);
  const [paceKey, setPaceKey] = useState(initial.paceKey);

  /**
   * Where the parked mock left off, so resuming is a decision rather than a
   * gamble. Wrapped because a mock whose board has moved under it would throw
   * here, and losing the whole setup screen over a stale resume offer would be a
   * worse outcome than not offering it.
   */
  const resumeAt = useMemo(() => {
    if (!parked) return null;
    try {
      const view = buildRoomView(board, fromMockFile(parked).state);
      const slot = view.slots.find((s) => s.id === view.onTheClockSlotId) ?? null;
      const team = parked.controlledTeamId
        ? board.teams.find((t) => t.id === parked.controlledTeamId) ?? null
        : null;
      return { slot, entered: parked.picks.length, team };
    } catch {
      return null;
    }
  }, [board, parked]);

  const me = controlledTeamId
    ? board.teams.find((t) => t.id === controlledTeamId) ?? null
    : null;

  /** Every slot this franchise currently owns, traded picks included. */
  const mySlots = useMemo(
    () =>
      controlledTeamId
        ? board.slots.filter((s) => s.currentOwner.id === controlledTeamId)
        : [],
    [board, controlledTeamId],
  );

  const applyToAll = (key: string) =>
    setArchetypes(() => {
      const next: ArchetypeAssignment = {};
      for (const team of board.teams) next[team.id] = key;
      return next;
    });

  const randomise = () =>
    setArchetypes(() => {
      const next: ArchetypeAssignment = {};
      for (const team of board.teams) {
        next[team.id] = BOT_ARCHETYPES[Math.floor(Math.random() * BOT_ARCHETYPES.length)].key;
      }
      return next;
    });

  const picksToMake = board.totalPicks - board.keeperCount;

  return (
    <div className="bg-background bg-canvas text-foreground fixed inset-0 z-50 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-7 lg:px-10">
        <header className="flex flex-wrap items-center gap-3">
          <span className="bg-primary text-primary-foreground rounded px-2 py-1 text-[11px] font-black tracking-[0.08em] uppercase">
            Mock
          </span>
          <span className="text-muted-foreground text-[13px] font-semibold">
            {LEAGUE.name} &middot; real board, real order, real keepers
          </span>
          <Link
            href="/"
            title="Leave the mock"
            className="text-muted-foreground/40 hover:text-foreground ml-auto inline-flex items-center justify-center p-1 touch:size-11"
          >
            <X className="h-4 w-4" />
          </Link>
        </header>

        <div>
          <h1 className="text-2xl font-black tracking-tight">Set the board, then run it.</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Nothing is drafted until you press Start. Pick who you are, decide what the
            other nine managers are trying to do, and choose how fast they do it.
          </p>
        </div>

        {parked && resumeAt && (
          <div className="border-primary/60 bg-primary/5 flex flex-wrap items-center gap-4 rounded-lg border p-4">
            <div className="min-w-0 flex-1">
              <p className="text-eyebrow text-primary text-[10px]">Mock in progress</p>
              <p className="text-sm font-bold">
                {resumeAt.slot
                  ? `Round ${resumeAt.slot.round}, pick ${resumeAt.slot.label} — ${resumeAt.slot.currentOwner.name} on the clock`
                  : "Finished — every slot on the board is full"}
              </p>
              <p className="text-muted-foreground text-[12px]">
                {resumeAt.entered} of {picksToMake} picks entered
                {resumeAt.team
                  ? `, drafting for ${resumeAt.team.franchiseName}`
                  : ", nobody drafting"}
                . Starting a new mock below replaces it.
              </p>
            </div>
            <Button
              onClick={onResume}
              title="Pick the mock up where it stopped"
              className="touch:min-h-11"
            >
              <Play /> Resume mock
            </Button>
          </div>
        )}

        {/* --- 1. Who you are ---------------------------------------------- */}

        <Section
          step="1"
          title="Who are you?"
          note="You type this franchise's picks the same way you will on Saturday."
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {board.teams.map((team) => {
              const mine = team.id === controlledTeamId;
              return (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => setControlledTeamId(team.id)}
                  aria-pressed={mine}
                  title={`Draft for ${team.franchiseName} (${team.manager})`}
                  className={cn(
                    "flex min-w-0 flex-col gap-0.5 rounded-lg border p-2.5 text-left transition-colors",
                    mine
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {mine ? (
                      <User className="text-primary size-3.5 shrink-0" />
                    ) : (
                      <Bot className="text-muted-foreground/60 size-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 text-[13px] font-black uppercase md:truncate">
                      {team.name}
                    </span>
                    <span className="text-muted-foreground/70 shrink-0 font-mono text-[11px] tabular-nums">
                      {team.picks}
                    </span>
                  </span>
                  <span className="text-muted-foreground min-w-0 text-[12px] font-semibold md:truncate">
                    {team.franchiseName}
                  </span>
                  <span className="text-muted-foreground/70 min-w-0 text-[11px] md:truncate">
                    {team.manager}
                  </span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => setControlledTeamId(null)}
            aria-pressed={controlledTeamId === null}
            title="Watch all ten bots draft"
            className={cn(
              "mt-2 flex w-full items-center gap-2 rounded-lg border p-2.5 text-left transition-colors",
              controlledTeamId === null
                ? "border-primary bg-primary/10"
                : "border-border bg-card hover:bg-muted",
            )}
          >
            <Eye
              className={cn(
                "size-4 shrink-0",
                controlledTeamId === null ? "text-primary" : "text-muted-foreground/60",
              )}
            />
            <span className="text-[13px] font-bold">Watch only</span>
            <span className="text-muted-foreground text-[12px]">
              All ten franchises on bots. Nobody types.
            </span>
          </button>
        </Section>

        {/* --- 2. What the bots are doing ---------------------------------- */}

        <Section
          step="2"
          title="What are the other managers doing?"
          note="A personality is a set of numbers in the tuning table, not a script. Every one of them still fields a legal lineup."
        >
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground mr-1 text-[11px] font-semibold">
              Everyone:
            </span>
            <Chip
              onClick={() => setArchetypes(defaultAssignment(board))}
              title="One of each, dealt out by draft slot"
            >
              Mixed room
            </Chip>
            <Chip onClick={randomise} title="Deal every franchise a personality at random">
              Surprise me
            </Chip>
            {BOT_ARCHETYPES.map((a) => (
              <Chip
                key={a.key}
                onClick={() => applyToAll(a.key)}
                title={`Every bot drafts as ${a.name} — ${a.blurb}`}
              >
                All {a.name}
              </Chip>
            ))}
          </div>

          <div className="mt-3 grid gap-x-6 gap-y-1 md:grid-cols-2">
            {BOT_ARCHETYPES.map((a) => (
              <p key={a.key} className="text-[11px] leading-snug">
                <span className="font-bold">{a.name}</span>{" "}
                <span className="text-muted-foreground">{a.blurb}</span>
              </p>
            ))}
          </div>

          <div className="border-border/60 mt-4 grid gap-2 border-t pt-4 sm:grid-cols-2 lg:grid-cols-3">
            {board.teams.map((team) => {
              const mine = team.id === controlledTeamId;
              return (
                <div key={team.id} className="flex min-w-0 items-center gap-2">
                  <span className="w-14 shrink-0 truncate text-[12px] font-black uppercase">
                    {team.name}
                  </span>
                  {mine ? (
                    <span className="text-primary flex h-9 items-center text-[12px] font-bold">
                      you
                    </span>
                  ) : (
                    <select
                      aria-label={`Bot personality for ${team.franchiseName}`}
                      value={archetypeByKey(archetypes[team.id]).key}
                      onChange={(e) =>
                        setArchetypes((a) => ({ ...a, [team.id]: e.target.value }))
                      }
                      className="border-border bg-card select-chevron h-9 min-w-0 flex-1 appearance-none rounded-lg border py-2 pr-8 pl-3 text-[13px] outline-none touch:h-11 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {BOT_ARCHETYPES.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* --- 3. Pace ----------------------------------------------------- */}

        <Section
          step="3"
          title="How fast do the bots pick?"
          note="Changeable while the mock runs, and the bots can be paused or stepped one pick at a time."
        >
          <div className="flex flex-wrap gap-1.5">
            {MOCK_PACES.map((pace) => (
              <Chip
                key={pace.key}
                active={pace.key === paceKey}
                onClick={() => setPaceKey(pace.key)}
                title={pace.blurb}
              >
                {pace.name}
              </Chip>
            ))}
          </div>
        </Section>

        {/* --- 4. What you are drafting into ------------------------------- */}

        <Section step="4" title="What you are drafting into" note={null}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Board" value={`${board.rounds} rounds`} note={`${board.teamCount} franchises, ${board.totalPicks} slots`} />
            <Fact label="Picks to make" value={`${picksToMake}`} note="the rest are keepers" />
            <Fact label="Keepers placed" value={`${board.keeperCount}`} note="already on the board, undraftable" />
            <Fact label="Traded picks" value={`${board.tradedCount}`} note="in someone else's column" />
          </div>

          {me && (
            <div className="mt-4">
              <p className="text-[12px] font-semibold">
                {me.franchiseName} owns {me.picks} picks
                {me.keepers > 0 && ` — ${me.keepers} spent on keepers`}
                {me.acquired > 0 && `, ${me.acquired} acquired by trade`}
                {me.tradedAway > 0 && `, ${me.tradedAway} traded away`}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {mySlots.map((slot) => (
                  <span
                    key={slot.id}
                    title={
                      slot.isKeeper
                        ? `${slot.label} — keeper already placed${slot.player ? `: ${slot.player.name}` : ""}`
                        : slot.traded
                          ? `${slot.label} — acquired from ${slot.originalOwner.name}`
                          : slot.label
                    }
                    className={cn(
                      "flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums",
                      slot.isKeeper
                        ? "border-keeper/50 text-keeper"
                        : slot.traded
                          ? "border-trade/50 text-trade"
                          : "border-border text-muted-foreground",
                    )}
                  >
                    {slot.isKeeper && <Lock className="size-2.5" />}
                    {slot.label}
                  </span>
                ))}
              </div>
              <p className="text-muted-foreground/70 mt-1.5 text-[11px]">
                Keeper slots are locked. A pick shown in the trade colour was acquired from
                another franchise — it still drafts for you, in their column.
              </p>
            </div>
          )}
        </Section>

        {/* --- Start ------------------------------------------------------- */}

        <div className="border-border/60 flex flex-wrap items-center gap-4 border-t pt-5 pb-2">
          <Button
            size="lg"
            onClick={() => onStart({ controlledTeamId, archetypes, paceKey })}
            title="Begin the mock with these settings"
            className="touch:min-h-11"
          >
            <Play /> Start mock
          </Button>
          <p className="text-muted-foreground min-w-0 flex-1 text-[12px]">
            {me
              ? `You draft for ${me.franchiseName}. Nine bots draft the rest.`
              : "Ten bots draft the whole board and you watch."}{" "}
            {parked && "This replaces the mock in progress above."}
          </p>
          <span className="text-muted-foreground/40 shrink-0 font-mono text-[11px]">
            mock only &middot; {stateFile}
          </span>
        </div>
      </div>
    </div>
  );
}

function Section({
  step,
  title,
  note,
  children,
}: {
  step: string;
  title: string;
  note: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-card/40 rounded-lg border p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5">
        <span className="text-primary text-eyebrow text-[10px]">{step}</span>
        <h2 className="text-base font-bold">{title}</h2>
        {note && <p className="text-muted-foreground min-w-0 flex-1 text-[11px]">{note}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * A chip is either a choice or an action. `active` is omitted for the actions —
 * "Surprise me" is not a state the screen can be in, and claiming otherwise with
 * `aria-pressed="false"` would tell a screen reader it was an unset toggle.
 */
function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "inline-flex items-center justify-center rounded-sm border px-2.5 py-1 text-[12px] font-semibold transition-colors touch:min-h-11",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function Fact({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="border-border bg-card rounded-lg border p-2.5">
      <p className="text-muted-foreground text-eyebrow text-[10px]">{label}</p>
      <p className="text-lg font-black tabular-nums">{value}</p>
      <p className="text-muted-foreground/70 text-[11px] leading-snug">{note}</p>
    </div>
  );
}

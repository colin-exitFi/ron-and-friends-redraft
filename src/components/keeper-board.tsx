import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  Ban,
  Check,
  CircleAlert,
  HelpCircle,
  Info,
  RotateCcw,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Stat } from "@/components/ui/stat";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { acquisitionSeason } from "@/lib/keeper-clock";
import type {
  KeeperBoardView,
  KeeperEntry,
  PendingDeclaration,
} from "@/lib/league-view";

/**
 * Every declared keeper, what he costs, and where he sits on the clock.
 *
 * The clock is shown in SEASONS OF TENURE out of three — "Year 2 of 3" — which
 * is the league's own convention and the phrase the commissioner uses. The
 * acquisition season is year 1 however the player was acquired. The acquisition
 * season itself is printed underneath, so the count never has to be inferred.
 *
 * It previously said "Year 1 of 2", counting keeper seasons and hiding the
 * acquisition year, and the commissioner rejected that twice. Do not reintroduce
 * it; `npm run verify:tenure` asserts every displayed year against the sheet.
 */

const StatCard = Stat;

function ClockCell({ keeper, season }: { keeper: KeeperEntry; season: number }) {
  const disputed = keeper.tenureDispute;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5">
        {disputed ? (
          /*
           * An unsettled tenure gets its own treatment rather than borrowing
           * "final season" red or the ordinary secondary badge: both would read
           * as a decision. Outline plus a question mark says "no answer yet".
           */
          <Badge
            variant="outline"
            className="border-warning/50 text-warning"
            title={disputed.question}
          >
            <HelpCircle className="mr-1 h-3 w-3" />
            {disputed.badge}
          </Badge>
        ) : keeper.finalSeason ? (
          <Badge variant="destructive">{keeper.clockLabel}</Badge>
        ) : (
          <Badge variant="secondary">{keeper.clockLabel}</Badge>
        )}
        {keeper.clockResetByTrade && (
          <span
            className="text-muted-foreground inline-flex items-center gap-1 text-xs"
            title="A trade restarted his keeper eligibility with this franchise while his cost basis carried across."
          >
            <RotateCcw className="h-3 w-3" />
            reset
          </span>
        )}
      </div>
      {/*
       * The badge above already reads "Year 2 of 3", which IS the sheet's own
       * column, so repeating it added nothing. The acquisition season is the
       * fact that makes the count unambiguous — "year 2 of 3" plus "acquired
       * 2025" cannot be misread.
       */}
      <p className="text-muted-foreground font-mono text-[11px]">
        acquired{" "}
        {acquisitionSeason(season, keeper.seasonsKept, keeper.sheetTenureYear)}
      </p>
    </div>
  );
}

function CostCell({ keeper }: { keeper: KeeperEntry }) {
  return (
    <div className="space-y-0.5">
      <p className="font-mono font-semibold">R{keeper.costRound}</p>
      <p className="text-muted-foreground flex items-center gap-1 font-mono text-[11px]">
        {keeper.isUndrafted ? (
          <span>free agent</span>
        ) : keeper.basisRound != null ? (
          <>
            R{keeper.basisRound}
            <ArrowRight className="h-2.5 w-2.5" />R{keeper.costRound}
          </>
        ) : (
          <span>&mdash;</span>
        )}
      </p>
    </div>
  );
}

/**
 * One outstanding franchise.
 *
 * `awaiting` and `final` are drawn differently on purpose. "Has not answered"
 * is a job for the commissioner; "closed his list and is keeping fewer than the
 * maximum" is a settled decision. Collapsing them into "0 keepers" is what hides
 * a manager who never replied.
 */
function PendingRow({ pending }: { pending: PendingDeclaration }) {
  const awaiting = pending.status === "awaiting";
  return (
    <li
      className={
        awaiting
          ? "border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-2 rounded-md border-l-2 px-2.5 py-2"
          : "border-border bg-muted/30 flex flex-wrap items-center gap-2 rounded-md border-l-2 px-2.5 py-2"
      }
    >
      <Badge variant={awaiting ? "destructive" : "secondary"}>
        {awaiting ? <CircleAlert /> : <Check />}
        {awaiting ? "No answer yet" : "List closed"}
      </Badge>
      <span className="font-medium">{pending.franchiseName}</span>
      <span className="text-muted-foreground text-xs">
        {pending.manager}
        <span className="text-muted-foreground/60"> &middot; {pending.shortName}</span>
      </span>
      <span className="text-muted-foreground ml-auto font-mono text-xs">
        {pending.declared} of {pending.allowed} declared
      </span>
    </li>
  );
}

/**
 * What Smart Draft is still missing.
 *
 * The league has not adopted this app yet, so Smart Draft stays the operational
 * system and the commissioner keeps it current by hand. This app's board is
 * already correct without him doing anything — the reconciled layer places these
 * keepers itself — so this is a to-do for the other product, not a warning about
 * this one. Written that way round on purpose, and kept to one line per keeper.
 */
function RoomSyncNote({ board }: { board: KeeperBoardView }) {
  const missing = board.roomSync.missingFromRoom;
  if (!missing.length) return null;

  return (
    <div className="border-border bg-muted/30 flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-md border px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
        Not yet on the board
      </span>
      <span className="text-muted-foreground text-xs">
        {missing.length === 1
          ? "One keeper is recorded here but not in the room"
          : `${missing.length} keepers are recorded here but not in the room`}
        . The board below and{" "}
        <Link href="/draft" className="underline underline-offset-2 max-md:py-4">
          the draft board
        </Link>{" "}
        already show them.
      </span>
      <ul className="flex w-full flex-wrap gap-x-4 gap-y-1 pt-0.5">
        {missing.map((m) => (
          <li key={m.playerName} className="text-xs">
            <span className="font-medium">{m.playerName}</span>
            <span className="text-muted-foreground">
              {" "}
              &mdash; {m.manager}, round {m.costRound}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Declarations the rules refuse — in practice a first-round player, who cannot
 * be kept at all under the Aug 2026 ruling.
 *
 * Shown rather than dropped, and shown with the REASON. A manager who declared
 * his best player and then cannot find him on this page will assume the app
 * lost it; being told "he was a first-round pick, and a first-rounder is a
 * one-year rental" ends the conversation instead of starting it. Louder than the
 * Smart Draft note because this one costs a franchise a keeper slot.
 */
function IneligibleNote({ board }: { board: KeeperBoardView }) {
  if (!board.ineligible.length) return null;

  return (
    <Card className="ring-destructive/40">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Ban className="h-4 w-4" />
          Cannot be kept &mdash; {board.ineligible.length}{" "}
          {board.ineligible.length === 1 ? "declaration" : "declarations"} refused
        </CardTitle>
      </CardHeader>
      <CardContent className="divide-border divide-y p-0">
        {board.ineligible.map((p) => (
          <div key={`${p.teamId}-${p.playerName}`} className="px-4 py-3">
            <p className="text-sm">
              <span className="font-medium">{p.playerName}</span>
              <span className="text-muted-foreground">
                {" "}
                &mdash; {p.manager}
                {p.basisRound != null ? `, round ${p.basisRound} last season` : ""}
              </span>
            </p>
            <p className="text-muted-foreground mt-0.5 text-xs">{p.reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * Keepers whose tenure the league has not settled.
 *
 * States both readings and refuses to pick one. The app is not the adjudicator
 * here — the league commissioner is, and on the live case he is also not the
 * person operating this app — so printing a single final season would be the app
 * inventing authority it does not have. Equally, saying nothing would leave a
 * manager believing whichever number happened to render.
 */
function TenureDisputeNote({ board }: { board: KeeperBoardView }) {
  const disputed = board.keepers.filter((k) => k.tenureDispute);
  if (!disputed.length) return null;

  return (
    <Card className="ring-warning/40">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <HelpCircle className="h-4 w-4" />
          Tenure disputed &mdash; {disputed.length}{" "}
          {disputed.length === 1 ? "keeper" : "keepers"} awaiting a league vote
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Eligible this season either way. What is unsettled is the LAST season
          the franchise may keep him, so nothing below changes the {board.season}{" "}
          board.
        </p>
      </CardHeader>
      <CardContent className="divide-border divide-y p-0">
        {disputed.map((k) => {
          const d = k.tenureDispute!;
          return (
            <div key={`${k.teamId}-${k.playerId}`} className="px-4 py-3">
              <p className="text-sm">
                <span className="font-medium">{k.playerName}</span>
                <span className="text-muted-foreground">
                  {" "}
                  &mdash; {k.manager}, round {k.costRound}
                </span>
              </p>
              <p className="text-muted-foreground mt-1 text-xs">{d.question}</p>
              <ul className="mt-2 space-y-1.5">
                {d.readings.map((r) => (
                  <li key={r.countsFrom} className="flex gap-2 text-xs">
                    <Badge
                      variant="outline"
                      className="h-5 shrink-0 font-mono tabular-nums"
                    >
                      {r.finalSeason}
                    </Badge>
                    <span>
                      <span className="font-medium">
                        Counting from {r.countsFrom}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        &mdash; {r.argument}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 flex items-start gap-1.5 text-xs">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                {d.resolution}
              </p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export function KeeperBoard({ board }: { board: KeeperBoardView }) {
  // Split on the recorded state, NOT on `declared === 0`. A manager who closed
  // his list while keeping nobody looks identical to one who never replied if
  // you go by the count alone, and they are not the same thing.
  const awaiting = board.pending.filter((p) => p.status === "awaiting");
  const closedShort = board.pending.filter((p) => p.status === "final");

  return (
    <div className="space-y-6">
      <RoomSyncNote board={board} />
      <IneligibleNote board={board} />
      <TenureDisputeNote board={board} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Keepers declared"
          value={board.keepers.length}
          hint={`${board.maxPerTeam} per franchise`}
        />
        <StatCard
          label={`Expire after ${board.season}`}
          value={board.expiringCount}
          hint="Return to the draft pool"
          tone="warn"
        />
        <StatCard
          label={`Keepable in ${board.season + 1}`}
          value={board.keepableNextSeasonCount}
          hint="One round cheaper again"
        />
        <StatCard
          label="Awaiting an answer"
          value={board.awaitingCount}
          hint={`${board.awaitingCount === 1 ? "franchise has" : "franchises have"} not replied`}
          tone={board.awaitingCount > 0 ? "warn" : "default"}
        />
      </div>

      {board.pending.length > 0 && (
        <Card className={awaiting.length > 0 ? "ring-destructive/40" : undefined}>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HelpCircle className="h-4 w-4" />
              {/* The denominator is every franchise in the league. Adding the
                  pending count to the teams holding keepers double-counts a
                  manager who declared some but not all of his slots, which is
                  exactly Joe's one-keeper case. */}
              Keeper slots not filled &mdash; {board.pending.length} of{" "}
              {
                new Set([
                  ...board.pending.map((p) => p.teamId),
                  ...board.keepers.map((k) => k.teamId),
                ]).size
              }{" "}
              franchises
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {awaiting.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium tracking-wide uppercase">
                  Outstanding &mdash; chase these
                </p>
                <p className="text-muted-foreground text-xs">
                  No answer on record. This is <em>not</em> a decision to keep
                  nobody, and the keeper list is not final until every manager has
                  replied.
                </p>
                <ul className="space-y-1.5 pt-1">
                  {awaiting.map((p) => (
                    <PendingRow key={p.teamId} pending={p} />
                  ))}
                </ul>
              </div>
            )}

            {closedShort.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium tracking-wide uppercase">
                  Settled &mdash; deliberately keeping fewer
                </p>
                <p className="text-muted-foreground text-xs">
                  These managers have closed their lists. The unfilled slots are a
                  pass, not a missing answer.
                </p>
                <ul className="space-y-1.5 pt-1">
                  {closedShort.map((p) => (
                    <PendingRow key={p.teamId} pending={p} />
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/*
        Six columns will not fit a phone, and this table is a list of keepers
        rather than a matrix, so on a narrow screen the franchise, the clock and
        next season's verdict fold underneath the player instead of sliding off
        the side. Slot and cost stay in their columns because they are what the
        room reads down.
      */}
      <div className="border-border overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16 touch:w-11 max-md:px-2">Slot</TableHead>
              <TableHead className="max-md:px-2">Player</TableHead>
              <TableHead className="max-md:hidden">Franchise</TableHead>
              <TableHead className="w-24 max-md:w-14 max-md:px-2">Cost</TableHead>
              <TableHead className="w-44 max-md:hidden">Keeper clock</TableHead>
              <TableHead className="w-28 max-md:hidden">{board.season + 1}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {board.keepers.map((k) => (
              <TableRow key={k.playerId}>
                <TableCell className="text-primary font-mono font-medium max-md:px-2 max-md:align-top max-md:text-[11px]">
                  {k.boardLabel}
                </TableCell>
                <TableCell className="max-md:px-2 max-md:align-top max-md:whitespace-normal">
                  <p className="font-medium max-md:text-[13px]">{k.playerName}</p>
                  <p className="text-muted-foreground text-xs">
                    {k.position}
                    {k.nflTeam ? ` · ${k.nflTeam}` : ""}
                  </p>
                  <div className="mt-1.5 hidden flex-wrap items-center gap-x-2 gap-y-1 max-md:flex">
                    <span className="text-[12px] font-medium">{k.teamShortName}</span>
                    <span className="text-muted-foreground text-[11px]">{k.manager}</span>
                    {k.keepableIn2027 ? (
                      <Badge variant="secondary">Keepable {board.season + 1}</Badge>
                    ) : (
                      <Badge variant="destructive">Expires</Badge>
                    )}
                  </div>
                  <div className="mt-1 hidden max-md:block">
                    <ClockCell keeper={k} season={board.season} />
                  </div>
                </TableCell>
                <TableCell className="max-md:hidden">
                  <p className="font-medium">{k.teamShortName}</p>
                  <p className="text-muted-foreground truncate text-xs">{k.manager}</p>
                </TableCell>
                <TableCell className="max-md:px-2 max-md:align-top">
                  <CostCell keeper={k} />
                </TableCell>
                <TableCell className="max-md:hidden">
                  <ClockCell keeper={k} season={board.season} />
                </TableCell>
                <TableCell className="max-md:hidden">
                  {k.keepableIn2027 ? (
                    <Badge variant="secondary">Keepable</Badge>
                  ) : (
                    <Badge variant="destructive">Expires</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {board.keepers.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
                  No keeper declarations in the room yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {board.keepers.some((k) => k.conflicts.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Info className="h-4 w-4" />
              Rulings and open questions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {board.keepers
              .filter((k) => k.conflicts.length > 0)
              .map((k) => (
                <div key={k.playerId} className="space-y-1">
                  <p className="font-medium">
                    {k.playerName}{" "}
                    <span className="text-muted-foreground font-normal">
                      &middot; {k.teamShortName} &middot; R{k.costRound}
                    </span>
                  </p>
                  {k.conflicts.map((c, i) => (
                    <div key={i} className="text-muted-foreground space-y-0.5 text-xs">
                      <p>{c.summary}</p>
                      {c.resolution ? (
                        <p className="text-foreground">{c.resolution}</p>
                      ) : (
                        <p className="text-destructive">Unresolved &mdash; needs a ruling.</p>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

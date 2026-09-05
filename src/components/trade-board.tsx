import { ArrowRight, CircleAlert, Shuffle } from "lucide-react";

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
import { cn } from "@/lib/utils";
import { DRAFT } from "@/lib/league-config";
import type { TradeBoardView, TradeLogEntry, TradeLogSide } from "@/lib/league-view";

/**
 * Who owns which pick, and the trades that got them there.
 *
 * Two views of the same facts, because they answer different questions. The
 * pick table answers "who is on the clock at 1.08" and is what draft night
 * needs. The log answers "why", and is the commissioner's own record, players
 * and all.
 */

function SideColumn({ side }: { side: TradeLogSide }) {
  const faab = side.faabReceived ?? [];
  const hasNothing =
    !side.playersReceived.length && !side.picksReceived.length && !faab.length;
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="flex items-center gap-2 font-medium">
        <Badge variant="outline">{side.manager}</Badge>
        {side.franchiseName && (
          <span className="text-muted-foreground truncate text-xs">
            {side.franchiseName}
          </span>
        )}
      </p>
      {hasNothing ? (
        <p className="text-muted-foreground text-xs">Nothing recorded</p>
      ) : (
        <ul className="space-y-0.5 text-sm">
          {side.playersReceived.map((p, i) => (
            <li key={`p${i}`} className="flex items-baseline gap-1.5">
              <span className="truncate">{p.resolvedName ?? p.typedName}</span>
              {!p.playerId && (
                <span
                  className="text-muted-foreground shrink-0 text-[11px]"
                  title="This name did not match anyone in the Smart Draft pool — it is shown exactly as it was typed in the trade log."
                >
                  (unmatched)
                </span>
              )}
            </li>
          ))}
          {side.picksReceived.map((p, i) => (
            <li key={`k${i}`} className="text-muted-foreground font-mono text-xs">
              {p.label}
              {p.viaFranchise && ` (${p.viaFranchise}'s)`}
            </li>
          ))}
          {faab.map((amount, i) => (
            <li key={`f${i}`} className="text-muted-foreground font-mono text-xs">
              ${amount} FAAB
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TradeCard({ trade }: { trade: TradeLogEntry }) {
  return (
    <Card
      className={cn(
        trade.provisional && "ring-destructive/40",
        // A reversed trade no longer stands. Dimmed rather than dropped: the
        // assets have gone back, but the fact that it was once entered is part
        // of the record.
        trade.reversed && "opacity-60",
      )}
    >
      <CardHeader className="border-b">
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground font-mono">
            Trade #{trade.tradeNumber}
          </span>
          <span className="flex items-center gap-2">
            {trade.reversed && <Badge variant="destructive">Reversed</Badge>}
            {trade.unapplied && !trade.provisional && (
              <Badge
                variant="outline"
                title="Recorded as history but not applied to the pick ledger. The imported workbook trades sit here on purpose — the Smart Draft room snapshot already reflects their net 2026 result."
              >
                Not applied
              </Badge>
            )}
            {trade.provisional && (
              <Badge variant="destructive">
                <CircleAlert /> Provisional
              </Badge>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-start">
          <SideColumn side={trade.sideA} />
          <Shuffle className="text-muted-foreground hidden h-4 w-4 shrink-0 self-center sm:block" />
          <SideColumn side={trade.sideB} />
        </div>

        {trade.provisionalNote && (
          <p className="text-muted-foreground border-destructive/40 border-l-2 pl-3 text-xs leading-relaxed">
            {trade.provisionalNote}
          </p>
        )}

        {!trade.provisional && trade.notes.length > 0 && (
          <ul className="text-muted-foreground space-y-0.5 text-xs">
            {trade.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function TradeBoard({ board }: { board: TradeBoardView }) {
  const byRound = new Map<number, typeof board.tradedPicks>();
  for (const p of board.tradedPicks) {
    const arr = byRound.get(p.round) ?? [];
    arr.push(p);
    byRound.set(p.round, arr);
  }
  const rounds = [...byRound.keys()].sort((a, b) => a - b);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Picks moved"
          value={board.tradedPicks.length}
          hint={`of ${board.ledger.reduce((n, l) => n + l.picksHeld, 0)} board slots`}
        />
        <Stat
          label="Logged trades"
          value={board.log.length}
          hint={`${board.log.filter((t) => t.provisional).length} provisional`}
        />
        <Stat
          label="In-season deadline"
          value={`Week ${board.tradeDeadlineWeek}`}
          hint={`Picks tradable ${board.tradableSeasons.join(", ")}`}
        />
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm">Draft capital after trades</CardTitle>
          <p className="text-muted-foreground text-xs">
            Pick counts do not have to net out in this league, so a franchise can
            hold more or fewer than {DRAFT.rounds}.
          </p>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              {/* The three counts are the point of this table, so on a phone the
                  column labels wrap rather than the numbers going off-screen. */}
              <TableRow>
                <TableHead className="max-md:w-[108px] max-md:px-1.5">Franchise</TableHead>
                <TableHead className="w-24 text-right max-md:w-14 max-md:px-1.5 max-md:whitespace-normal">
                  Held
                </TableHead>
                <TableHead className="w-24 text-right max-md:w-14 max-md:px-1.5 max-md:whitespace-normal">
                  Acquired
                </TableHead>
                <TableHead className="w-28 text-right max-md:w-14 max-md:px-1.5 max-md:whitespace-normal">
                  Traded away
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {board.ledger.map((l) => {
                const net = l.picksHeld - DRAFT.rounds;
                return (
                  <TableRow key={l.teamId}>
                    <TableCell className="max-md:px-1.5 max-md:whitespace-normal">
                      <span className="font-medium max-md:block max-md:text-[13px]">
                        {l.shortName}
                      </span>
                      <span className="text-muted-foreground ml-2 text-xs max-md:ml-0 max-md:block max-md:text-[11px]">
                        {l.franchiseName}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono max-md:px-1.5">
                      {l.picksHeld}
                      {net !== 0 && (
                        <span
                          className={
                            net > 0 ? "text-primary ml-1.5 text-xs" : "text-destructive ml-1.5 text-xs"
                          }
                        >
                          {net > 0 ? `+${net}` : net}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right font-mono max-md:px-1.5">
                      {l.acquired || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-right font-mono max-md:px-1.5">
                      {l.tradedAway || "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm">
            Traded picks &mdash; {board.tradedPicks.length} slots
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            The board column belongs to the original owner all {DRAFT.rounds}{" "}
            rounds, so a traded pick shows up as a foreign name inside someone
            else&rsquo;s column rather than moving cells.
          </p>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              {/* Round is folded under the slot on a phone — "6.05" and "R6" are
                  the same fact twice, and five columns will not fit. */}
              <TableRow>
                <TableHead className="w-16 max-md:w-12 max-md:px-2">Slot</TableHead>
                <TableHead className="w-16 max-md:hidden">Round</TableHead>
                <TableHead className="max-md:w-[76px] max-md:px-2">Originally</TableHead>
                <TableHead className="max-md:hidden">Now held by</TableHead>
                <TableHead className="max-md:px-2">Player</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rounds.flatMap((round) =>
                (byRound.get(round) ?? [])
                  .sort((a, b) => a.overallPick - b.overallPick)
                  .map((p) => (
                    <TableRow key={p.overallPick}>
                      <TableCell className="text-primary font-mono font-medium max-md:px-2 max-md:align-top">
                        {p.label}
                        <span className="text-muted-foreground hidden text-[11px] max-md:block">
                          R{p.round}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono max-md:hidden">
                        R{p.round}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-md:px-2 max-md:align-top max-md:text-[12px]">
                        {p.originalOwner}
                        <span className="text-foreground hidden items-center gap-1 font-medium max-md:flex">
                          <ArrowRight className="text-muted-foreground h-3 w-3 shrink-0" />
                          {p.currentOwner}
                        </span>
                      </TableCell>
                      <TableCell className="max-md:hidden">
                        <span className="flex items-center gap-1.5 font-medium">
                          <ArrowRight className="text-muted-foreground h-3 w-3" />
                          {p.currentOwner}
                        </span>
                      </TableCell>
                      <TableCell className="max-md:px-2 max-md:align-top">
                        {p.playerName ? (
                          <span className="flex items-center gap-2 max-md:flex-col max-md:items-start max-md:gap-1">
                            <span className="truncate max-md:max-w-full max-md:text-[13px]">
                              {p.playerName}
                            </span>
                            {p.isKeeper && <Badge variant="secondary">Keeper</Badge>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">Open</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )),
              )}
              {board.tradedPicks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground py-8 text-center text-sm">
                    No picks have changed hands.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-heading text-base font-medium">
          Trade log &mdash; {board.log.length} trades
        </h2>
        <p className="text-muted-foreground text-sm">
          The commissioner&rsquo;s own record. Each side lists what that manager
          received, players included, which the pick table above cannot show.
        </p>
        <div className="grid gap-3 xl:grid-cols-2">
          {board.log.map((t) => (
            <TradeCard key={t.id} trade={t} />
          ))}
        </div>
      </div>
    </div>
  );
}

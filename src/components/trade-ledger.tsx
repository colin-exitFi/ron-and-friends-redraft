"use client";

import { useState } from "react";
import { ArrowRight, CalendarOff, Check, CircleAlert, Loader2, Undo2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  LedgerInvariant,
  LoggedTradeView,
  OwnershipGridView,
} from "@/lib/trade-entry-types";

/**
 * The standing reconciliation surface.
 *
 * ============================================================================
 * WHY THIS EXISTS AT ALL
 * ============================================================================
 * A trade logged in November changes nothing visible until the draft board goes
 * up the following August. Nine months with no feedback is the real risk in this
 * project, and there is no clever way to shorten it — but there are ten managers
 * who see each other every week and care intensely about which picks they own.
 *
 * So this is the feedback loop: sixteen rounds by ten franchises is small enough
 * to eyeball, and a manager who thinks he owns a pick he does not will say so in
 * November rather than at the draft table. That is free validation from people
 * who are motivated to check, and it is the only loop available during the quiet
 * stretch.
 *
 * The invariants underneath it cover what people cannot eyeball: that no pick
 * has gone missing, that the board and the ledger agree, and that a reversal
 * left nothing behind. Either the list is green or it is a list of things to fix.
 */

function OwnershipGrid({ grid }: { grid: OwnershipGridView }) {
  if (grid.empty) {
    return (
      <p className="text-muted-foreground text-sm">
        No {grid.season} pick ownership exists yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr>
            <th className="text-muted-foreground bg-card sticky left-0 z-10 border-b px-2 py-2 text-left font-medium">
              Round
            </th>
            {grid.teams.map((t) => (
              <th
                key={t.teamId}
                className="text-muted-foreground border-b px-1.5 py-2 text-center font-medium"
              >
                {t.shortName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rounds.map((round) => (
            <tr key={round}>
              <td className="text-muted-foreground bg-card sticky left-0 z-10 border-b px-2 py-1 font-mono">
                R{round}
              </td>
              {grid.teams.map((t) => {
                const cell = grid.cells[t.teamId]?.[round];
                const moved = cell && cell.holderId !== t.teamId;
                return (
                  <td
                    key={t.teamId}
                    className={cn(
                      "border-b px-1.5 py-1 text-center font-mono",
                      moved ? "text-primary font-semibold" : "text-muted-foreground/50",
                    )}
                    title={
                      cell
                        ? moved
                          ? `${t.shortName}'s round ${round} pick is held by ${cell.holderShortName}`
                          : `${t.shortName} still holds his own round ${round}`
                        : "no ownership row"
                    }
                  >
                    {cell ? (moved ? cell.holderShortName : "·") : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="text-muted-foreground bg-card sticky left-0 z-10 px-2 py-2 font-medium">
              Held
            </td>
            {grid.teams.map((t) => (
              <td key={t.teamId} className="px-1.5 py-2 text-center font-mono font-semibold">
                {grid.heldCounts[t.teamId] ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function Invariants({ invariants }: { invariants: LedgerInvariant[] }) {
  const failing = invariants.filter((i) => !i.ok);
  return (
    <div className="space-y-3">
      {failing.length === 0 ? (
        <p className="flex items-center gap-2 text-sm">
          <Check className="text-primary h-4 w-4 shrink-0" />
          <span>
            All {invariants.length} checks pass. Nothing in the ledger contradicts
            itself.
          </span>
        </p>
      ) : (
        <p className="text-destructive flex items-center gap-2 text-sm">
          <CircleAlert className="h-4 w-4 shrink-0" />
          {failing.length} of {invariants.length} checks need attention.
        </p>
      )}
      <ul className="space-y-1.5">
        {invariants.map((i) => (
          <li key={i.label} className="flex gap-2 text-sm">
            {i.ok ? (
              <Check className="text-muted-foreground mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <CircleAlert className="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span className={i.ok ? "text-muted-foreground" : undefined}>
              {i.label}
              {i.detail && (
                <span className="text-destructive block text-xs">{i.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Trades in the ledger, listed by party.
 *
 * Not a two-sided layout: a three-team trade is legal in this league, and a
 * shape built on "side A and side B" would silently drop the third leg —
 * exactly the kind of quiet loss this whole feature exists to stop.
 */
function LoggedTrades({
  trades,
  onReverse,
  busyId,
}: {
  trades: LoggedTradeView[];
  onReverse: (id: string) => void;
  busyId: string | null;
}) {
  if (!trades.length) {
    return <p className="text-muted-foreground text-sm">No trades recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      {trades.map((t) => (
        <div
          key={t.id}
          className={cn(
            "border-border rounded-lg border px-3.5 py-3",
            t.reversed && "opacity-60",
          )}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {/*
              The date the trade HAPPENED, never the date the row was written.
              An undated trade is called out rather than quietly falling back to
              created_at, which for the imported trades is the moment the seed
              ran and would read as a real date.
            */}
            {t.tradedAt ? (
              <span className="font-mono text-xs">
                {new Date(`${t.tradedAt}T12:00:00`).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {t.timingLabel && (
                  <span className="text-muted-foreground"> · {t.timingLabel}</span>
                )}
              </span>
            ) : (
              <Badge
                variant="destructive"
                title="No date on record, so this trade's keeper consequences cannot be computed. The workbook it came from carries no dates and is known to be incomplete, so nothing has been guessed."
              >
                <CalendarOff /> Date unknown
              </Badge>
            )}
            {t.parties.length > 2 && (
              <Badge variant="secondary">{t.parties.length}-team trade</Badge>
            )}
            {t.reversed && <Badge variant="destructive">Reversed</Badge>}
            {t.status === "proposed" && (
              <Badge
                variant="outline"
                title="Recorded but not applied to the ledger. The imported workbook log sits here on purpose — the room snapshot already reflects its 2026 result."
              >
                Not applied
              </Badge>
            )}
            {t.imported && (
              <Badge variant="outline" title="Imported from the commissioner's workbook">
                Imported
              </Badge>
            )}
          </div>

          <ul className="space-y-1 text-sm">
            {t.parties.map((p) => (
              <li key={p.teamId} className="leading-relaxed">
                <span className="font-medium">{p.shortName}</span>{" "}
                <ArrowRight className="text-muted-foreground inline h-3 w-3" />{" "}
                <span className="text-muted-foreground">
                  {p.receives.length ? p.receives.join(", ") : "nothing"}
                </span>
              </li>
            ))}
          </ul>

          {t.notes && (
            <p className="text-muted-foreground border-border mt-2 border-l-2 pl-3 text-xs leading-relaxed">
              {t.notes}
            </p>
          )}

          {/*
            A mis-logged trade recorded in November has to be fixable in
            November, so the control lives beside the trade rather than behind a
            support request. Only offered on a trade that was actually applied:
            reversing something never applied would claim to undo a move that
            never happened.
          */}
          {t.status === "accepted" && (
            <div className="mt-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReverse(t.id)}
                disabled={busyId === t.id}
                className="touch:h-11 max-md:px-4"
              >
                {busyId === t.id ? <Loader2 className="animate-spin" /> : <Undo2 />}
                Reverse this trade
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function TradeLedger({
  grids,
  invariants,
  trades,
}: {
  /** One grid per season in the tradable window. */
  grids: OwnershipGridView[];
  invariants: { season: number; checks: LedgerInvariant[] }[];
  trades: LoggedTradeView[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function reverse(id: string) {
    setBusyId(id);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/trades/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reverse" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not reverse the trade.");
      setDone(
        "Reversed. Pick ownership went back to whoever sent each pick, the movement " +
          "rows were deleted, and any keeper clock was restored to what it was. " +
          "Reload to see the ledger as it now stands.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const needBackfill = trades.filter((t) => t.needsDateBackfill && !t.reversed);

  return (
    <div className="space-y-6">
      {error && (
        <p className="border-destructive/40 text-destructive border-l-2 pl-3 text-sm">
          {error}
        </p>
      )}

      {/*
        Stated, not flagged. This was a red "needs attention" card until the
        commissioner confirmed on Aug 26 2026 that there were no pre-draft player
        trades this year — which is the only thing the date was needed to
        establish. All twelve are in-season, so the keeper sheet's "N of 3"
        already encodes their acquisition seasons correctly.

        Kept visible rather than deleted, because the absence of dates is still a
        real property of the imported rows and will matter if anyone ever
        recomputes from them directly. But it is no longer a problem, and dressing
        a settled fact as an outstanding one teaches people to ignore the warnings
        that do matter.
      */}
      {needBackfill.length > 0 && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarOff className="h-4 w-4" /> {needBackfill.length} imported
              trade{needBackfill.length === 1 ? "" : "s"} with no date &mdash;
              confirmed in-season
            </CardTitle>
            <p className="text-muted-foreground text-xs leading-relaxed">
              These came out of the commissioner&rsquo;s workbook, which records no
              dates. The keeper clock depends on whether a trade happened in-season
              or before the draft, and the commissioner has confirmed there were{" "}
              <span className="text-foreground font-medium">
                no pre-draft player trades this year
              </span>
              , so all of these are in-season and their acquisition season is
              simply the season they occurred &mdash; which is what the keeper
              sheet already records. No date has been invented for them. Every
              trade logged through this app from now on carries its own.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="text-muted-foreground space-y-1 text-sm">
              {needBackfill.map((t) => (
                <li key={t.id}>
                  {t.parties.map((p) => p.shortName).join(" ↔ ")}
                  {t.notes && (
                    <span className="text-xs"> &mdash; {t.notes}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {done && (
        <p className="border-primary/40 border-l-2 pl-3 text-sm leading-relaxed">{done}</p>
      )}

      {invariants.map((group) => (
        <Card key={group.season}>
          <CardHeader className="border-b">
            <CardTitle className="text-sm">
              {group.season} ledger checks
            </CardTitle>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Machine-checkable statements about the ledger. This is the difference
              between finding a problem in November and finding it at the draft
              table.
            </p>
          </CardHeader>
          <CardContent>
            <Invariants invariants={group.checks} />
          </CardContent>
        </Card>
      ))}

      {grids.map((grid) => (
        <Card key={grid.season}>
          <CardHeader className="border-b">
            <CardTitle className="text-sm">
              {grid.season} pick ownership &mdash; who holds what
            </CardTitle>
            <p className="text-muted-foreground text-xs leading-relaxed">
              A column is a franchise&rsquo;s OWN picks; a name in a cell is
              whoever holds that pick now, and a dot means the franchise still has
              it. Worth a glance whenever you are here &mdash; a manager who
              thinks he owns a pick he does not will say so long before August.
            </p>
          </CardHeader>
          <CardContent className="px-3">
            <OwnershipGrid grid={grid} />
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-sm">Recorded trades</CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Each line is what that franchise received. Listed by party rather than
            by side, so a three-team trade shows all three.
          </p>
        </CardHeader>
        <CardContent>
          <LoggedTrades trades={trades} onReverse={reverse} busyId={busyId} />
        </CardContent>
      </Card>
    </div>
  );
}

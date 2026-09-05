import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

import { DatabasePending } from "@/components/database-pending";
import { PageBody, PageHeader } from "@/components/page-header";
import { TradeLedger } from "@/components/trade-ledger";
import { Badge } from "@/components/ui/badge";
import { hasDatabase } from "@/lib/env";
import { CURRENT_SEASON, LEAGUE } from "@/lib/league-config";
import { pickTradableSeasons } from "@/lib/trade-rules";
import {
  checkLedgerInvariants,
  getOwnershipGrid,
  listLoggedTrades,
} from "@/lib/trade-entry";

/**
 * The ledger behind the trade tracker: who holds what, whether it is
 * self-consistent, and how to undo a mistake.
 *
 * Its own route because it is a working surface rather than a reading one. The
 * tracker at `/trades` answers "who owns 1.08" for ten managers; this answers
 * "is the ledger right, and what do I do if it is not" for one commissioner.
 */
export const metadata = { title: `Pick ledger · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Who holds every pick in the tradable window, a set of checks that are either " +
  "green or a list of problems, and a reversal for anything logged wrong. Built " +
  "to be glanced at during the nine months between a trade and the board it " +
  "affects.";

export default async function TradeLedgerPage() {
  if (!hasDatabase()) {
    return (
      <DatabasePending
        title="Pick ledger"
        description={DESCRIPTION}
        reason={
          "The ledger checks compare pick ownership, the draft board and the trade " +
          "log against each other, and reversing a trade writes to all three. None " +
          "of that has a snapshot equivalent."
        }
        needs={[
          { label: "Pick ownership", detail: "who holds each 2026 and 2027 pick right now" },
          { label: "Trade reversals", detail: "un-applying a mis-logged trade" },
        ]}
        worksToday="The trade tracker at /trades shows every pick that has already moved, read from the snapshots."
      />
    );
  }

  const seasons = pickTradableSeasons(CURRENT_SEASON);
  const [grids, invariantGroups, trades] = await Promise.all([
    Promise.all(seasons.map((s) => getOwnershipGrid(s))),
    Promise.all(
      seasons.map(async (season) => ({
        season,
        checks: await checkLedgerInvariants(season),
      })),
    ),
    listLoggedTrades(CURRENT_SEASON),
  ]);

  const failing = invariantGroups.reduce(
    (n, g) => n + g.checks.filter((c) => !c.ok).length,
    0,
  );

  return (
    <>
      <PageHeader title="Pick ledger" description={DESCRIPTION}>
        {failing === 0 ? (
          <Badge variant="outline">All checks passing</Badge>
        ) : (
          <Badge variant="destructive">{failing} checks failing</Badge>
        )}
        <Badge variant="outline">{trades.length} trades recorded</Badge>
      </PageHeader>
      <PageBody>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/trades"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs underline-offset-4 hover:underline touch:min-h-11"
          >
            <ArrowLeft className="h-3 w-3" /> Back to the trade tracker
          </Link>
          <Link
            href="/trades/new"
            className="text-primary inline-flex items-center gap-1.5 text-xs font-semibold underline-offset-4 hover:underline touch:min-h-11"
          >
            <Plus className="h-3 w-3" /> Log a trade
          </Link>
        </div>
        <TradeLedger grids={grids} invariants={invariantGroups} trades={trades} />
      </PageBody>
    </>
  );
}

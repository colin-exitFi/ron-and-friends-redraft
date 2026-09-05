import Link from "next/link";
import { ListChecks, Plus } from "lucide-react";

import { DataSourceNote } from "@/components/data-source-note";
import { PageBody, PageHeader } from "@/components/page-header";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { TradeBoard } from "@/components/trade-board";
import { Badge } from "@/components/ui/badge";
import { hasDatabase } from "@/lib/env";
import { getTradeBoard } from "@/lib/league-source";
import { LEAGUE, TRADES } from "@/lib/league-config";

export const metadata = { title: `Trades · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "Who owns which pick after trades, and the trade log that explains how. Pick " +
  "counts do not have to net out in this league, so a franchise may end the " +
  `offseason holding more or fewer picks than anyone else. In-season deadline: ` +
  `week ${TRADES.deadlineWeek}.`;

export default async function TradesPage() {
  const board = await getTradeBoard();
  const provisional = board.log.filter((t) => t.provisional).length;

  return (
    <>
      {hasDatabase() && (
        <RealtimeRefresher
          tables={["trades", "trade_assets", "pick_ownership", "draft_slots"]}
          showIndicator
        />
      )}
      <PageHeader title="Trade Tracker" description={DESCRIPTION}>
        <Badge variant="outline">{board.tradedPicks.length} picks moved</Badge>
        <Badge variant="outline">{board.log.length} trades</Badge>
        {provisional > 0 && (
          <Badge variant="destructive">{provisional} provisional</Badge>
        )}
      </PageHeader>
      <PageBody>
        {/*
          The two write surfaces. Kept as links rather than panels because this
          page is what ten managers read all year and it should stay a reading
          surface; logging a trade and reconciling the ledger are jobs one person
          does with intent.
        */}
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/trades/new"
            className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-semibold transition-colors touch:min-h-11"
          >
            <Plus className="h-4 w-4" /> Log a trade
          </Link>
          <Link
            href="/trades/ledger"
            className="bg-secondary text-secondary-foreground hover:bg-accent ring-border inline-flex items-center gap-2 rounded-sm px-4 py-2 text-sm font-semibold ring-1 transition-colors touch:min-h-11"
          >
            <ListChecks className="h-4 w-4" /> Pick ledger &amp; checks
          </Link>
        </div>
        <TradeBoard board={board} />
        <DataSourceNote
          fromDatabase={board.fromDatabase}
          fallbackReason={board.fallbackReason}
          fetchedAt={board.fetchedAt}
          snapshotLabel="the Smart Draft room snapshot and the commissioner's trade log"
        />
      </PageBody>
    </>
  );
}

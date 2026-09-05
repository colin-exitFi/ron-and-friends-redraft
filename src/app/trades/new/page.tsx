import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { DatabasePending } from "@/components/database-pending";
import { PageBody, PageHeader } from "@/components/page-header";
import { TradeEntry } from "@/components/trade-entry";
import { Badge } from "@/components/ui/badge";
import { hasDatabase } from "@/lib/env";
import { CURRENT_SEASON, LEAGUE } from "@/lib/league-config";
import { getTradeEntryContext } from "@/lib/trade-entry";

/**
 * Logging a trade.
 *
 * Its own route rather than a panel on `/trades` for two reasons. The tracker is
 * a read surface that ten managers look at all year and it should stay quiet;
 * and this is the one screen in the app the commissioner opens with a specific
 * job in mind, often on a phone minutes after ESPN approved a deal, so it
 * deserves the whole viewport.
 */
export const metadata = { title: `Log a trade · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "A trade is agreed and approved on Sleeper. Record it here and the ledger " +
  "stays correct without anyone rebuilding it from a spreadsheet. This league " +
  "trades players and FAAB only — draft picks are not tradable.";

export default async function LogTradePage() {
  if (!hasDatabase()) {
    return (
      <DatabasePending
        title="Log a trade"
        description={DESCRIPTION}
        reason={
          "Logging a trade WRITES to the ledger — it moves pick ownership and " +
          "transfers keeper rights — so unlike the trade tracker there is no " +
          "snapshot that can stand in for it."
        }
        needs={[
          {
            label: "Picks that changed hands",
            detail:
              "who holds each 2026 and 2027 pick after the trade, which is what next year's board draws from",
          },
          {
            label: "Players that changed hands",
            detail:
              "the new franchise plus the keeper clock reset the league's rules require on a trade",
          },
          { label: "FAAB dollars", detail: "recorded as a line item; Sleeper owns the budget" },
        ]}
        worksToday="The trade tracker at /trades reads the snapshots and shows every pick that has already moved."
      />
    );
  }

  const context = await getTradeEntryContext(CURRENT_SEASON);

  return (
    <>
      <PageHeader title="Log a trade" description={DESCRIPTION}>
        <Badge variant="outline">{context.season} season</Badge>
        <Badge variant="outline">
          Picks tradable {context.tradableSeasons.join(", ")}
        </Badge>
      </PageHeader>
      <PageBody>
        <Link
          href="/trades"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs underline-offset-4 hover:underline touch:min-h-11"
        >
          <ArrowLeft className="h-3 w-3" /> Back to the trade tracker
        </Link>
        <TradeEntry
          season={context.season}
          participants={context.participants}
          picksByTeam={context.picksByTeam}
          rostersByTeam={context.rostersByTeam}
          tradableSeasons={context.tradableSeasons}
          deadlineWeek={context.deadlineWeek}
          today={context.today}
        />
      </PageBody>
    </>
  );
}

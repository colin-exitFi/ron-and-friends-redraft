import { DataSourceNote } from "@/components/data-source-note";
import { KeeperBoard } from "@/components/keeper-board";
import { PageBody, PageHeader } from "@/components/page-header";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { Badge } from "@/components/ui/badge";
import { hasDatabase } from "@/lib/env";
import { SHEET_TENURE_TERM } from "@/lib/keeper-clock";
import { getKeeperBoard } from "@/lib/league-source";
import { KEEPERS, LEAGUE } from "@/lib/league-config";

export const metadata = { title: `Keepers · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

export default async function KeepersPage() {
  const board = await getKeeperBoard();

  const description =
    `Up to ${board.maxPerTeam} keepers per franchise, each on a ` +
    `${SHEET_TENURE_TERM}-season clock — the season you acquire him, then ` +
    `${board.maxKeeperSeasons} keeper seasons. A keeper costs one round less than ` +
    `the round he occupied last season, and a free-agent acquisition costs round ` +
    `${KEEPERS.undraftedDefaultRound}. There are no keeper fees.`;

  return (
    <>
      {hasDatabase() && (
        <RealtimeRefresher tables={["keepers", "draft_slots"]} showIndicator />
      )}
      <PageHeader title="Keepers" description={description}>
        <Badge variant="outline">{board.keepers.length} declared</Badge>
        {board.expiringCount > 0 && (
          <Badge variant="destructive">{board.expiringCount} expire after {board.season}</Badge>
        )}
      </PageHeader>
      <PageBody>
        <KeeperBoard board={board} />
        <DataSourceNote
          fromDatabase={board.fromDatabase}
          fallbackReason={board.fallbackReason}
          fetchedAt={board.fetchedAt}
          snapshotLabel="the board snapshot in data/"
        />
      </PageBody>
    </>
  );
}

import { DataSourceNote } from "@/components/data-source-note";
import { FranchiseRoster } from "@/components/franchise-roster";
import { PageBody, PageHeader } from "@/components/page-header";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { TeamsManager, type TeamRow } from "@/components/teams-manager";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { hasDatabase } from "@/lib/env";
import { getFranchises } from "@/lib/league-source";
import { createServiceClient } from "@/lib/supabase/server";
import { DRAFT, LEAGUE } from "@/lib/league-config";

/** Franchise admin. Only rendered when the database is the live source. */
async function FranchiseEditor() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("teams")
    .select("id, short_name, franchise_name, manager, draft_slot")
    .order("draft_slot", { ascending: true, nullsFirst: false })
    .order("short_name", { ascending: true });

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">Edit franchises</CardTitle>
        <p className="text-muted-foreground text-xs">
          The handle is what the draft room calls the franchise and what every
          data source joins on &mdash; changing it will break those joins until
          the snapshots agree.
        </p>
      </CardHeader>
      <div className="px-(--card-spacing)">
        <TeamsManager teams={(data ?? []) as TeamRow[]} />
      </div>
    </Card>
  );
}

export const metadata = { title: `Teams · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  `The ${LEAGUE.teams} franchises — manager, draft slot, keepers, and the picks ` +
  `each one actually holds after trades. The league plays on ${LEAGUE.platform}, ` +
  `so this app is the system of record for keepers and picks.`;

export default async function TeamsPage() {
  const { franchises, source } = await getFranchises();

  const withKeepers = franchises.filter((f) => f.keepers.length > 0).length;
  const awaiting = franchises.filter((f) => f.keeperSlotsPending > 0).length;

  return (
    <>
      {hasDatabase() && <RealtimeRefresher tables={["teams", "keepers", "draft_slots"]} />}
      <PageHeader title="Teams" description={DESCRIPTION}>
        <Badge variant="outline">
          {franchises.length} of {LEAGUE.teams} franchises
        </Badge>
        <Badge variant="outline">{DRAFT.rounds} rounds</Badge>
        {awaiting > 0 && (
          <Badge variant="secondary">
            {withKeepers} declared &middot; {awaiting} awaiting
          </Badge>
        )}
      </PageHeader>
      <PageBody>
        <FranchiseRoster franchises={franchises} />

        {/*
          Editing franchises writes, so it only appears once there is somewhere
          to write to. The roster above reads either source.
        */}
        {source.fromDatabase && <FranchiseEditor />}

        <DataSourceNote
          fromDatabase={source.fromDatabase}
          fallbackReason={source.fallbackReason}
          snapshotLabel="data/managers.json and the board snapshot, both read from Sleeper"
        />
      </PageBody>
    </>
  );
}

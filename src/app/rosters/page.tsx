import { AlertTriangle, Lock } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import { RosterBoard } from "@/components/roster-board";
import { Badge } from "@/components/ui/badge";
import { readRoom } from "@/lib/draft-service";
import { DRAFT, LEAGUE, ROSTER, draftDayLabel } from "@/lib/league-config";
import { readLineupProjectionPoints } from "@/lib/projections-store";
import { STARTER_COUNT } from "@/lib/roster-lineup";
import type { DraftRoomView } from "@/lib/draft-types";

export const metadata = { title: `Rosters · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

/**
 * Rosters — the surface that did not exist.
 *
 * A manager's friend went looking for rosters and could not find them: the only
 * way in was /teams and then a click through to a franchise, which showed a
 * keeper list rather than a roster and gave no way to flick to the next team.
 * This is the direct answer — a top-level tab, all ten franchises across the
 * top, and a lineup card underneath that switches without a page load.
 *
 * Reads the SAME board the draft room reads, so the moment a pick is entered on
 * Saturday it appears here. Before Saturday that means keepers and nothing
 * else, which is the honest state of a keeper league in August and is designed
 * for rather than apologised for.
 */
export default async function RostersPage() {
  let view: DraftRoomView;
  try {
    view = await readRoom();
  } catch (err) {
    return (
      <>
        <PageHeader title="Rosters" description={DESCRIPTION} />
        <PageBody>
          <div className="border-destructive/40 bg-destructive/5 flex gap-3 rounded-lg border p-5">
            <AlertTriangle className="text-destructive mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Rosters cannot be drawn.</p>
              <p className="text-muted-foreground mt-0.5 text-[13px]">
                {err instanceof Error ? err.message : "Unknown error"}
              </p>
            </div>
          </div>
        </PageBody>
      </>
    );
  }

  const preDraft = view.picksMade === 0;

  return (
    <>
      <PageHeader title="Rosters" description={DESCRIPTION}>
        <Badge variant="outline">
          {STARTER_COUNT} starters &middot; {ROSTER.bench} bench
        </Badge>
        <Badge variant="outline">
          {view.filled} of {view.totalPicks} board slots filled
        </Badge>
        {preDraft ? (
          <Badge variant="keeper">
            <Lock /> Keepers only
          </Badge>
        ) : (
          <Badge variant="default">{view.picksMade} picks entered</Badge>
        )}
      </PageHeader>

      <PageBody>
        {preDraft && (
          <div className="border-border bg-muted/30 rounded-lg border px-5 py-4">
            <p className="text-[13px] font-semibold">
              Nothing has been drafted yet, so a roster is its keepers.
            </p>
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              Each franchise below shows who is locked in and the pick that
              keeper costs. The other {STARTER_COUNT + ROSTER.bench - 2} places
              fill up over {DRAFT.rounds} rounds on {draftDayLabel()} &mdash;
              this page is the same view they will fill into. To see a full
              roster before then, run a{" "}
              {/* Vertical padding rather than a min-height: on an inline link it
                  grows the hit box to a thumb's width without stretching the
                  line it sits in. */}
              <a
                href="/mock"
                className="text-primary font-medium underline-offset-4 hover:underline max-md:py-4"
              >
                mock draft
              </a>
              .
            </p>
          </div>
        )}

        <RosterBoard view={view} projectedPoints={readLineupProjectionPoints()} />

        <p className="text-muted-foreground/70 text-[13px] leading-relaxed">
          Left and right arrows switch franchises. Keepers carry a{" "}
          <Lock className="inline h-3 w-3" aria-hidden /> and sit at the board
          cell they cost; a pick acquired in a trade names the franchise it came
          from. Read from the live board in{" "}
          <span className="font-mono">data/</span> and from the Smart Draft
          snapshot &mdash; the same two sources the draft room uses.
        </p>
      </PageBody>
    </>
  );
}

const DESCRIPTION =
  `Every franchise's roster, laid out by starting slot with the bench beneath. ` +
  `Switch franchises without leaving the page. Before the draft a roster is ` +
  `just its keepers and what they cost; after ${draftDayLabel()} it is all ` +
  `${ROSTER.activeCap} places.`;

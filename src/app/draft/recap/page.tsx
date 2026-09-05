import { AlertTriangle } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import { DraftRecap } from "@/components/draft-recap";
import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier, type RecapDossier } from "@/lib/recap-dossier";
import {
  readClosedKeeperLists,
  readKeeperOptions,
  readProjectedStandings,
} from "@/lib/recap-source";
import { noModelReason, recapModel } from "@/lib/recap-llm";
import { recapLocation, recapStore } from "@/lib/recap-store";
import { currentBoardFingerprint, readPool, readRoom } from "@/lib/draft-service";
import { CURRENT_SEASON, LEAGUE } from "@/lib/league-config";
import type { RecapDocument } from "@/lib/recap-types";

export const metadata = { title: `Recap · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "One verdict per franchise, written against the board and the keeper-adjusted " +
  "expected picks — with the numbers that justify it sitting next to each one.";

/**
 * The recap tab.
 *
 * NOTHING HERE CALLS A MODEL. The page builds the dossier — which is free,
 * deterministic and the same arithmetic the final board runs — and reads
 * whatever recap was last generated. Writing one is an explicit press of a
 * button, which posts to `/api/recap`. A page that generated on render would
 * cost a couple of dollars a refresh and say something different every time.
 *
 * THREE STATES, ALL OF THEM NORMAL:
 *
 *   no key           the numbers render, the button explains itself. The build
 *                    must succeed and this page must draw on a machine where
 *                    nobody has set `ANTHROPIC_API_KEY`, so a missing model is
 *                    a sentence rather than an exception.
 *   nothing yet      the numbers render and the button is live.
 *   generated        the blurbs render on top of the same numbers.
 *
 * The read is inside the `try`; the JSX is not. Rendering is lazy, so a
 * component constructed inside a `try` would throw outside it and sail past the
 * handler — the same trap `@/app/draft/final/page.tsx` documents.
 */
export default async function RecapPage() {
  let dossier: RecapDossier;
  let recap: RecapDocument | null;
  let boardFingerprint: string;
  try {
    const view = await readRoom();
    const pool = readPool();
    dossier = buildRecapDossier({
      view,
      expectedPick: buildExpectedPicks(pool, view.slots),
      pool,
      keeperOptions: readKeeperOptions(),
      closedKeeperLists: readClosedKeeperLists(),
      projectedStandings: readProjectedStandings(view),
    });
    recap = await recapStore.read(CURRENT_SEASON);
    boardFingerprint = currentBoardFingerprint();
  } catch (err) {
    return (
      <RecapUnavailable message={err instanceof Error ? err.message : "Unknown error"} />
    );
  }

  const model = recapModel();

  return (
    <DraftRecap
      dossier={dossier}
      recap={recap}
      /*
       * Whether the button can do anything, decided on the server. The key is
       * never sent to the browser and is never read from it — only this
       * boolean and, when it is false, the reason to print instead.
       */
      canGenerate={model !== null}
      noModelReason={model ? null : noModelReason()}
      modelName={model?.model ?? null}
      savesTo={recapLocation(CURRENT_SEASON)}
      /*
       * The board the dossier above was just built from. Paired with the
       * fingerprint stored inside the recap, this is what lets the page say the
       * blurbs and the receipts beneath them are about different boards.
       */
      boardFingerprint={boardFingerprint}
    />
  );
}

function RecapUnavailable({ message }: { message: string }) {
  return (
    <>
      <PageHeader title="Draft Recap" description={DESCRIPTION} eyebrow="Draft Hub" />
      <PageBody>
        <div className="border-destructive/40 bg-destructive/5 flex gap-3 rounded-lg border p-5">
          <AlertTriangle className="text-destructive mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">The recap cannot be drawn.</p>
            <p className="text-muted-foreground mt-0.5 text-[13px]">{message}</p>
          </div>
        </div>
      </PageBody>
    </>
  );
}

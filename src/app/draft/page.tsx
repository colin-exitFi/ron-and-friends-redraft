import { AlertTriangle } from "lucide-react";

import { DraftBoard } from "@/components/draft-board";
import { readPool, readRoom, saveLocation, savesAreShared } from "@/lib/draft-service";
import { LEAGUE } from "@/lib/league-config";
import { readLineupProjectionPoints } from "@/lib/projections-store";
import type { ClientPlayer, DraftRoomView } from "@/lib/draft-types";

export const metadata = { title: `Draft Board · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

/**
 * The draft board — the only draft surface there is.
 *
 * There is no separate projector mode. This page IS what goes on the TV, and it
 * is also the thing being typed into, so there are not two views to keep in
 * step on the night.
 *
 * Rendered once on the server with the board and the whole player pool, after
 * which it runs from what the browser already holds. Matching a name never goes
 * back to the server — that is the part that has to stay instant under a room
 * watching someone type.
 *
 * It goes back for two things: saving a pick, and re-reading the board when
 * another device saves one. The second is new, and it is why `sharedSaves` is
 * passed: two managers are remote and enter their own picks, so the board can no
 * longer assume the only thing that changes the draft is the person at the
 * keyboard.
 *
 * Run locally that save is a write to a JSON file and the room needs no internet
 * at all — and equally there is no second device to sync with. Run on a
 * deployment it is a row in the league database, because a deployment cannot
 * write to its own disk, and that shared row is what makes the live sync
 * possible.
 */
export default async function DraftPage() {
  let view: DraftRoomView;
  let pool: ClientPlayer[];
  try {
    view = await readRoom();
    pool = readPool();
  } catch (err) {
    return (
      <BoardUnavailable
        message={err instanceof Error ? err.message : "Unknown error"}
      />
    );
  }

  return (
    <DraftBoard
      initialView={view}
      pool={pool}
      stateFile={saveLocation()}
      sharedSaves={savesAreShared()}
      projectedPoints={readLineupProjectionPoints()}
    />
  );
}

function BoardUnavailable({ message }: { message: string }) {
  return (
    <div className="bg-background bg-canvas fixed inset-0 z-50 flex items-center justify-center p-10">
      <div className="border-destructive/40 bg-destructive/5 flex max-w-2xl gap-4 rounded-xl border p-6">
        <AlertTriangle className="text-destructive mt-0.5 h-6 w-6 shrink-0" />
        <div className="space-y-1">
          <p className="text-lg font-semibold">The board cannot be drawn.</p>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}

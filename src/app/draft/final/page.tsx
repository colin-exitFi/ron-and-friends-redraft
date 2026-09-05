import { AlertTriangle } from "lucide-react";

import { FinalBoard } from "@/components/final-board";
import { readPool, readRoom } from "@/lib/draft-service";
import { buildExpectedPicks } from "@/lib/expected-pick";
import { LEAGUE } from "@/lib/league-config";
import { readLineupProjectionPoints } from "@/lib/projections-store";
import type { DraftRoomView } from "@/lib/draft-types";

export const metadata = { title: `Final Board · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

/**
 * The board for after the draft, when everyone stands around the screen.
 *
 * Separate from `/draft` rather than a mode on it. The live board is the thing
 * being typed into on draft night and it is not worth adding a state to it that
 * could be entered by accident mid-draft; this reads the same room view and
 * regroups it, so there is nothing to keep in sync.
 *
 * The read is in the `try`; the JSX is not. Rendering is lazy, so a component
 * constructed inside a `try` would throw outside it and sail past this handler.
 */
export default async function FinalBoardPage() {
  let view: DraftRoomView;
  let expectedPick: Record<string, number | null>;
  try {
    view = await readRoom();
    /*
     * Reach and steal are measured against where a player was expected to go on
     * THIS board, which is not his consensus ADP — the league's keepers are out
     * of the draft and the feeds are not this league's format. `buildExpectedPicks`
     * converts ADP order into real slot numbers so the subtraction in
     * `buildFinalBoard` compares like with like. See `expected-pick.ts`.
     */
    expectedPick = buildExpectedPicks(readPool(), view.slots);
  } catch (err) {
    return (
      <BoardUnavailable
        message={err instanceof Error ? err.message : "Unknown error"}
      />
    );
  }

  return (
    <FinalBoard
      view={view}
      expectedPick={expectedPick}
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
          <p className="text-lg font-semibold">
            The final board cannot be drawn.
          </p>
          <p className="text-muted-foreground text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}

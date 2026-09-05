import { AlertTriangle } from "lucide-react";

import { MockDraft } from "@/components/mock-draft";
import { boardFingerprint } from "@/lib/draft-engine";
import { CURRENT_SEASON, LEAGUE } from "@/lib/league-config";
import { toMockPool } from "@/lib/mock-draft-run";
import { mockStateLocation, readMockDraft } from "@/lib/mock-draft-store";
import { readLineupProjectionPoints } from "@/lib/projections-store";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import type { BoardView } from "@/lib/board-types";
import type { MockDraftFile, MockPlayer } from "@/lib/mock-draft-types";

export const metadata = { title: `Mock Draft · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

/**
 * The mock draft page.
 *
 * Note what this does NOT do: it never calls `readRoom` and never touches
 * `data/draft-state-2026.json`. It hands the client the BOARD — the draft order,
 * the 29 traded picks and the pre-placed keepers — and the player pool, and
 * nothing else. A mock is a rehearsal from pick one, so there is no reason to
 * read the live picks, and not reading them means the file the mock must not
 * disturb is not even opened on this route.
 *
 * The only state this page reads is the mock's own file, through
 * `@/lib/mock-draft-store`, which cannot name the live one.
 */
export default async function MockPage() {
  let board: BoardView;
  let pool: MockPlayer[];
  try {
    board = getBoard();
    pool = toMockPool(getPlayerPool());
  } catch (err) {
    return (
      <div className="bg-background bg-canvas fixed inset-0 z-50 flex items-center justify-center p-10">
        <div className="border-destructive/40 bg-destructive/5 flex max-w-2xl gap-4 rounded-xl border p-6">
          <AlertTriangle className="text-destructive mt-0.5 h-6 w-6 shrink-0" />
          <div className="space-y-1">
            <p className="text-lg font-semibold">The mock cannot be set up.</p>
            <p className="text-muted-foreground text-sm">
              {err instanceof Error ? err.message : "Unknown error"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /*
   * A saved mock is only offered back if it ran against THIS board. The
   * fingerprint covers which slots exist and who owns them, so a trade entered
   * since the mock was saved invalidates it — and resuming onto a board that has
   * moved would put picks in slots their franchise no longer holds.
   */
  const saved = readMockDraft(CURRENT_SEASON);
  const resumed: MockDraftFile | null =
    saved && saved.boardFingerprint === boardFingerprint(board) ? saved : null;

  return (
    <MockDraft
      board={board}
      pool={pool}
      resumed={resumed}
      stateFile={mockStateLocation(CURRENT_SEASON)}
      projectedPoints={readLineupProjectionPoints()}
    />
  );
}

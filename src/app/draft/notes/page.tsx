import { AlertTriangle, NotebookPen } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import { DraftNotesBoard } from "@/components/draft-notes-board";
import { buildDraftNotes, type DraftNotes } from "@/lib/draft-notes";
import { readRoom } from "@/lib/draft-service";
import { LEAGUE } from "@/lib/league-config";

export const metadata = { title: `Draft Notes · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "What the room actually said, written down while it was being said. Scott " +
  "keeps the notes every year; the picks beside them come off the board.";

/**
 * The scribe's minutes.
 *
 * Every other page in this app is about what was drafted. This one is the only
 * record of the two hours around it, and it exists because Scott sat there with
 * his workbook open and typed while people talked. The board supplies the pick,
 * the player and the franchise; his column supplies the only part that was never
 * going to survive anywhere else.
 *
 * NOTHING HERE CALLS A MODEL and nothing is summarised. The quotes are his text,
 * split into speakers and printed. Where he named nobody, nobody is named — see
 * `@/lib/draft-notes` for why that is a hard rule rather than a nicety.
 *
 * The read is inside the `try` and the JSX is not, for the reason
 * `@/app/draft/recap/page.tsx` and `@/app/draft/final/page.tsx` both spell out:
 * rendering is lazy, so a component built inside a `try` throws outside it and
 * sails straight past the handler.
 */
export default async function DraftNotesPage() {
  let notes: DraftNotes | null;
  try {
    notes = buildDraftNotes(await readRoom());
  } catch (err) {
    return <NotesProblem message={err instanceof Error ? err.message : "Unknown error"} />;
  }

  if (!notes) return <NoNotesYet />;

  return (
    <>
      <PageHeader
        title="Draft Notes"
        description={DESCRIPTION}
        eyebrow="Draft Hub"
      />
      <PageBody>
        <DraftNotesBoard notes={notes} />
      </PageBody>
    </>
  );
}

/**
 * No workbook has been imported for this season.
 *
 * A normal state, not an error: the notes only exist once Scott has sent the
 * file and somebody has run the importer. Says which command, because the person
 * reading this is the person who needs to run it.
 */
function NoNotesYet() {
  return (
    <>
      <PageHeader title="Draft Notes" description={DESCRIPTION} eyebrow="Draft Hub" />
      <PageBody>
        <div className="border-border bg-muted/20 flex gap-3 rounded-lg border p-5">
          <NotebookPen className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">No notes for this season yet.</p>
            <p className="text-muted-foreground mt-1 text-[13px]">
              The scribe&rsquo;s workbook has not been imported. Once it arrives:
            </p>
            <code className="text-muted-foreground mt-2 block font-mono text-[12px]">
              python3 scripts/import-draft-notes.py &lt;workbook.xlsx&gt;
            </code>
          </div>
        </div>
      </PageBody>
    </>
  );
}

function NotesProblem({ message }: { message: string }) {
  return (
    <>
      <PageHeader title="Draft Notes" description={DESCRIPTION} eyebrow="Draft Hub" />
      <PageBody>
        <div className="border-destructive/40 bg-destructive/5 flex gap-3 rounded-lg border p-5">
          <AlertTriangle className="text-destructive mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">The notes cannot be drawn.</p>
            <p className="text-muted-foreground mt-0.5 text-[13px]">{message}</p>
          </div>
        </div>
      </PageBody>
    </>
  );
}

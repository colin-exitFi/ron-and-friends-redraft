import { PageBody, PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { LEAGUE, PRESEASON_CHECKLIST } from "@/lib/league-config";

export const metadata = { title: `Preseason Checklist · ${LEAGUE.name}` };

export default function ChecklistPage() {
  return (
    <>
      <PageHeader
        title="Preseason Checklist"
        description="What the commissioner needs to settle before the draft clock starts."
      />
      <PageBody>
        <Card>
          <CardContent className="divide-border divide-y p-0">
            {PRESEASON_CHECKLIST.map((item, i) => (
              <div key={item} className="flex items-start gap-4 px-5 py-4">
                <span className="bg-accent text-accent-foreground flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-sm">
                  {i + 1}
                </span>
                <p className="pt-0.5 text-sm">{item}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <p className="text-muted-foreground text-xs">
          Reference only for now — per-item completion, assignees, and due dates come later.
        </p>
      </PageBody>
    </>
  );
}

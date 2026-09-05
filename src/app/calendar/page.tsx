import { PageBody, PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CALENDAR_EVENTS, LEAGUE } from "@/lib/league-config";

export const metadata = { title: `League Calendar · ${LEAGUE.name}` };

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        title="League Calendar"
        description="The recurring offseason and in-season windows that drive lock states — keeper lock, board publish, waivers, and the trade deadline."
      />
      <PageBody>
        <Card>
          <CardContent className="p-0">
            <ol className="relative">
              {CALENDAR_EVENTS.map((e, i) => (
                <li
                  key={e.key}
                  className="border-border flex items-start gap-4 border-b px-5 py-4 last:border-b-0"
                >
                  <div className="flex flex-col items-center">
                    <span className="bg-primary mt-1.5 h-2.5 w-2.5 rounded-full" />
                    {i < CALENDAR_EVENTS.length - 1 && (
                      <span className="bg-border mt-1 w-px flex-1" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-sm font-medium">{e.label}</h3>
                      {e.article !== "TBD" && (
                        <Badge variant="outline" className="font-mono text-xs">
                          {e.article}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground text-sm">{e.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
        <p className="text-muted-foreground text-xs">
          Only the shape of the calendar is set. Once the commissioner fixes the draft date and the
          NFL schedule lands, the timeline computes concrete datetimes and live lock states.
        </p>
      </PageBody>
    </>
  );
}

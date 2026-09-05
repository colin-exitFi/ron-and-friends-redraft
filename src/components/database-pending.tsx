import Link from "next/link";
import { Check, Database, ListOrdered } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Stands in for a surface that genuinely cannot work without somewhere to
 * WRITE.
 *
 * /teams, /keepers and /trades no longer use this: everything they display is a
 * fact already sitting in `data/`, so they read the snapshots and upgrade to
 * database reads when there is one. What is left here is the surface that
 * records new state rather than displaying existing state, and for that a
 * placeholder is the honest answer.
 *
 * It names what it is waiting for, because "waiting on the league database"
 * tells the commissioner nothing he can act on.
 */
export function DatabasePending({
  title,
  description,
  /** Why no snapshot can stand in for this page. */
  reason,
  /** The specific records that have nowhere to live yet. */
  needs,
  /** What DOES work today, so the page is not a dead end. */
  worksToday,
}: {
  title: string;
  description: string;
  reason: string;
  needs: { label: string; detail: string }[];
  worksToday?: string;
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <PageBody>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2.5">
              <span className="bg-accent text-accent-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <Database className="h-4 w-4" />
              </span>
              Needs the league database
            </CardTitle>
            <p className="text-muted-foreground text-sm leading-relaxed">{reason}</p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                What has nowhere to be recorded
              </p>
              <ul className="space-y-2.5">
                {needs.map((n) => (
                  <li key={n.label} className="flex gap-2.5 text-sm">
                    <span className="bg-muted-foreground/40 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                    <span>
                      <span className="font-medium">{n.label}</span>
                      <span className="text-muted-foreground"> &mdash; {n.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-border border-t pt-4">
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
                What is blocking it
              </p>
              <p className="text-sm leading-relaxed">
                The schema and seed are written and verified. The only thing
                outstanding is the Supabase project&rsquo;s{" "}
                <span className="font-mono text-xs">anon</span> key,{" "}
                <span className="font-mono text-xs">service_role</span> key, and
                database password in{" "}
                <span className="font-mono text-xs">.env.local</span>. Once those
                are in, the migrations and seed run in one command and this page
                turns on.
              </p>
            </div>

            {worksToday && (
              <div className="border-border border-t pt-4">
                <p className="flex gap-2.5 text-sm leading-relaxed">
                  <Check className="text-primary mt-0.5 h-4 w-4 shrink-0" />
                  <span className="text-muted-foreground">{worksToday}</span>
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Link
                href="/draft"
                className="bg-secondary text-secondary-foreground hover:bg-accent ring-border inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold ring-1 transition-colors touch:min-h-11"
              >
                <ListOrdered className="h-4 w-4" /> Open the draft board
              </Link>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  );
}

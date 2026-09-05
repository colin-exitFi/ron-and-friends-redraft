import { XCircle } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BASE_SCORING,
  DST_POINTS_ALLOWED,
  DST_SCORING,
  EXPLOSIVE_BONUSES,
  LEAGUE,
  MILESTONE_BONUSES,
  PLATFORM_SETTINGS,
  ROSTER,
  SCORING_EXCLUSIONS,
  SCORING_FORMAT,
  STARTING_LINEUP,
  TURNOVER_SCORING,
  type ScoringRow,
} from "@/lib/league-config";

export const metadata = { title: `Scoring · ${LEAGUE.name}` };

/**
 * `categoryLabel` exists for the points-allowed ladder, whose first column is a
 * band of points conceded rather than a scoring category. Heading it "Category"
 * would read as though "7–13" were the name of a rule.
 */
function ScoringTable({
  rows,
  categoryLabel = "Category",
}: {
  rows: ScoringRow[];
  categoryLabel?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{categoryLabel}</TableHead>
          <TableHead className="w-28 text-right">Value</TableHead>
          <TableHead className="hidden sm:table-cell">Notes</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.category}>
            <TableCell className="font-medium">{r.category}</TableCell>
            <TableCell className="text-right font-mono tabular-nums">{r.value}</TableCell>
            {/* Notes run long; wrapping beats being clipped by the card edge. */}
            <TableCell className="text-muted-foreground hidden whitespace-normal sm:table-cell">
              {r.note}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Bonus cards drop out rather than rendering an empty grid if a league ever
 * turns them off. Ron & Friends runs both, and the "Excluded" card below is
 * what states an absence — a missing card must never be how the page says no.
 */
const BONUS_SECTIONS: { title: string; description: string; rows: ScoringRow[] }[] = [
  {
    title: "Yardage Milestone Bonuses",
    description:
      "Two separate bonuses per category, not a ladder. Clear both lines in one game and you are paid both.",
    rows: MILESTONE_BONUSES,
  },
  {
    title: "Explosive Play Bonuses",
    description: "One point per 40+ yard play, on top of the yardage and any touchdown.",
    rows: EXPLOSIVE_BONUSES,
  },
].filter((s) => s.rows.length > 0);

export default function ScoringPage() {
  return (
    <>
      <PageHeader
        title="Scoring Specification"
        description={`${SCORING_FORMAT} — half a point per reception, a full point for a tight end. Every value on this page was read from the league's own ${LEAGUE.platform} settings.`}
      />
      <PageBody>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Base Offensive Scoring</CardTitle>
              <CardDescription>
                Note the 6-point passing touchdown — {LEAGUE.platform}&apos;s default is 4, so
                imported rankings undervalue quarterbacks here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoringTable rows={BASE_SCORING} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Turnovers &amp; Ball Security</CardTitle>
              <CardDescription>
                The two &ldquo;additional&rdquo; rows stack on the row above them: a pick-six costs
                the quarterback −6 in all, and an ordinary lost fumble costs −2.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoringTable rows={TURNOVER_SCORING} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team Defense &amp; Special Teams</CardTitle>
              <CardDescription>
                The D/ST unit&apos;s own scoring. A return touchdown by an individual player pays
                the same 6.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoringTable rows={DST_SCORING} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">D/ST Points Allowed</CardTitle>
              <CardDescription>
                All seven bands. Points allowed is the only band {LEAGUE.platform} scores for this
                league — there is no yards-allowed bonus.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoringTable rows={DST_POINTS_ALLOWED} categoryLabel="Points Allowed" />
            </CardContent>
          </Card>
          {BONUS_SECTIONS.map((s) => (
            <Card key={s.title}>
              <CardHeader>
                <CardTitle className="text-base">{s.title}</CardTitle>
                <CardDescription>{s.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ScoringTable rows={s.rows} />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Excluded Scoring Features</CardTitle>
            <CardDescription>Categories this league deliberately does not score.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 sm:grid-cols-2">
              {SCORING_EXCLUSIONS.map((x) => (
                <li key={x} className="text-muted-foreground flex items-start gap-2 text-sm">
                  <XCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
                  <span>{x}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Starting Lineup</CardTitle>
              <CardDescription>
                {ROSTER.starters} starters · {ROSTER.bench} bench · {ROSTER.irSlots} IR
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Slot</TableHead>
                    <TableHead className="w-16 text-right">Count</TableHead>
                    <TableHead>Position</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {STARTING_LINEUP.map((s) => (
                    <TableRow key={s.slot}>
                      <TableCell className="font-medium">{s.slot}</TableCell>
                      <TableCell className="text-right font-mono tabular-nums">{s.count}</TableCell>
                      <TableCell className="text-muted-foreground whitespace-normal">
                        {s.note}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{LEAGUE.platform} Settings</CardTitle>
              <CardDescription>What to configure on the platform.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">Area</TableHead>
                    <TableHead>Configuration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PLATFORM_SETTINGS.map((p) => (
                    <TableRow key={p.area}>
                      <TableCell className="font-medium">{p.area}</TableCell>
                      <TableCell className="text-muted-foreground">{p.configuration}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </>
  );
}

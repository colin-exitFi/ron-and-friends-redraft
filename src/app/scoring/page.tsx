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

function ScoringTable({ rows }: { rows: ScoringRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Category</TableHead>
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

/** This league has no bonus categories at all, so these render as nothing rather
 *  than as an empty grid. They are confirmed absent, not awaiting confirmation —
 *  the "Excluded" card below says so explicitly. */
const BONUS_SECTIONS: { title: string; rows: ScoringRow[] }[] = [
  { title: "Yardage Milestone Bonuses", rows: MILESTONE_BONUSES },
  { title: "Explosive Play Bonuses", rows: EXPLOSIVE_BONUSES },
].filter((s) => s.rows.length > 0);

export default function ScoringPage() {
  return (
    <>
      <PageHeader
        title="Scoring Specification"
        description={`${SCORING_FORMAT} — one point per reception. Read from the league's own ${LEAGUE.platform} settings, which have been identical every season since 2022.`}
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
              <CardTitle className="text-base">Turnovers &amp; Defense</CardTitle>
              <CardDescription>
                Points and yards allowed are scored on {LEAGUE.platform}&apos;s tiered bands.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoringTable rows={TURNOVER_SCORING} />
            </CardContent>
          </Card>
          {BONUS_SECTIONS.map((s) => (
            <Card key={s.title}>
              <CardHeader>
                <CardTitle className="text-base">{s.title}</CardTitle>
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

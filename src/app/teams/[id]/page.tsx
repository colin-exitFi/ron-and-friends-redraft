import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, HelpCircle, Lock, Ticket } from "lucide-react";

import { DataSourceNote } from "@/components/data-source-note";
import { PageBody, PageHeader } from "@/components/page-header";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { hasDatabase } from "@/lib/env";
import { SHEET_TENURE_TERM } from "@/lib/keeper-clock";
import { DRAFT, KEEPERS } from "@/lib/league-config";
import { getFranchiseDetail } from "@/lib/league-source";
import type { FranchisePickView } from "@/lib/league-view";
import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { franchise } = await getFranchiseDetail(id);
  return { title: franchise ? franchise.franchiseName : "Franchise" };
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <Card className={accent ? "ring-primary/40" : undefined}>
      <CardContent className="py-1">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">{label}</p>
        <p className={cn("font-display mt-1 text-2xl font-bold", accent && "text-primary")}>
          {value}
        </p>
        {sub && <p className="text-muted-foreground mt-0.5 text-xs">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function PickChip({ pick, direction }: { pick: FranchisePickView; direction: "held" | "gone" }) {
  if (direction === "gone") {
    return (
      <span
        className="border-destructive/40 bg-destructive/5 text-destructive inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium"
        title={`${pick.label} — traded to ${pick.currentOwner}`}
      >
        <span className="line-through">R{pick.round}</span>
        <span className="text-destructive/80 text-[10px] font-semibold">
          &rarr; {pick.currentOwner}
        </span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium",
        pick.acquired ? "border-primary/50 bg-primary/10 text-primary" : "border-border bg-card",
      )}
      title={
        pick.acquired
          ? `${pick.label} — acquired from ${pick.originalOwner}`
          : `${pick.label} — original pick`
      }
    >
      R{pick.round}
      {pick.acquired && (
        <span className="text-primary/80 text-[10px] font-semibold">
          &larr; {pick.originalOwner}
        </span>
      )}
      {pick.isKeeper && <Lock className="h-2.5 w-2.5" />}
    </span>
  );
}

export default async function FranchisePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { franchise, source } = await getFranchiseDetail(id);
  if (!franchise) notFound();

  const netPicks = franchise.picksHeld - DRAFT.rounds;

  return (
    <>
      {hasDatabase() && (
        <RealtimeRefresher tables={["teams", "keepers", "draft_slots", "pick_ownership"]} />
      )}
      <PageHeader
        eyebrow="Franchise"
        title={franchise.franchiseName}
        description={
          `${franchise.manager}` +
          (franchise.draftSlot ? ` · draft slot ${franchise.draftSlot}` : "") +
          ` · known in the draft room as “${franchise.shortName}”`
        }
      >
        <Badge variant="outline" className="font-mono">
          {franchise.abbrev}
        </Badge>
        <Link
          href="/teams"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm touch:min-h-11"
        >
          <ArrowLeft className="h-4 w-4" /> All franchises
        </Link>
      </PageHeader>

      <PageBody>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Picks held"
            value={String(franchise.picksHeld)}
            sub={
              netPicks === 0
                ? `level with the ${DRAFT.rounds}-round board`
                : netPicks > 0
                  ? `${netPicks} more than the ${DRAFT.rounds} rounds`
                  : `${Math.abs(netPicks)} fewer than the ${DRAFT.rounds} rounds`
            }
          />
          <Stat
            label="Keepers"
            value={`${franchise.keepers.length} / ${KEEPERS.maxPerTeam}`}
            sub={
              franchise.keeperSlotsPending > 0
                ? `${franchise.keeperSlotsPending} still to declare`
                : "declarations complete"
            }
            accent
          />
          <Stat
            label="Pick movement"
            value={`+${franchise.picksAcquired} / −${franchise.picksTradedAway}`}
            sub="acquired / traded away"
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="font-display flex items-center gap-2 text-base">
                <Lock className="text-primary h-4 w-4" /> Keepers
              </CardTitle>
              <CardDescription>
                Cost round, board slot, and where each one sits on the{" "}
                {SHEET_TENURE_TERM}-season clock &mdash; the season he was
                acquired, then {KEEPERS.maxConsecutiveSeasons} keeper seasons.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {franchise.keepers.length === 0 ? (
                <p className="text-muted-foreground flex items-start gap-2 py-3 text-sm">
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    No declarations yet. That is an outstanding answer rather than a
                    decision to keep nobody &mdash; the keeper list is not final until
                    declarations close.
                  </span>
                </p>
              ) : (
                <ul className="space-y-2">
                  {franchise.keepers.map((k) => (
                    <li
                      key={k.playerId}
                      className="border-border/60 flex items-center gap-3 rounded-lg border p-2.5"
                    >
                      <span className="font-display text-primary w-10 shrink-0 text-center text-lg font-bold">
                        R{k.costRound}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{k.playerName}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {k.boardLabel} &middot; {k.clockLabel}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex h-5 w-9 shrink-0 items-center justify-center rounded text-[10px] font-bold ring-1",
                          positionStyle(k.position),
                        )}
                      >
                        {k.position}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {franchise.keeperSlotsPending > 0 && franchise.keepers.length > 0 && (
                <p className="text-muted-foreground mt-2.5 flex items-center gap-1.5 text-xs">
                  <Clock className="h-3.5 w-3.5" />
                  {franchise.keeperSlotsPending === 1
                    ? "One keeper slot still open"
                    : `${franchise.keeperSlotsPending} keeper slots still open`}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="font-display flex items-center gap-2 text-base">
                <Ticket className="text-primary h-4 w-4" /> Draft capital
              </CardTitle>
              <CardDescription>
                Picks held, including acquired ones, and picks traded away.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {franchise.picks.map((p) => (
                  <PickChip key={`held-${p.overallPick}`} pick={p} direction="held" />
                ))}
              </div>

              {franchise.picksGivenAway.length > 0 && (
                <div className="border-border space-y-1.5 border-t pt-3">
                  <p className="text-destructive/80 text-eyebrow text-[9px]">Traded away</p>
                  <div className="flex flex-wrap gap-1.5">
                    {franchise.picksGivenAway.map((p) => (
                      <PickChip key={`gone-${p.overallPick}`} pick={p} direction="gone" />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="font-display text-base">Board slots in order</CardTitle>
            <CardDescription>
              Every pick this franchise will make, earliest first.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {franchise.picks.map((p) => (
                <div
                  key={`slot-${p.overallPick}`}
                  className="border-border/60 flex items-center gap-2.5 rounded-lg border p-2"
                >
                  <span className="text-primary w-10 shrink-0 font-mono text-[11px] font-medium">
                    {p.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {p.playerName ?? (
                      <span className="text-muted-foreground">Open</span>
                    )}
                  </span>
                  {p.isKeeper && <Badge variant="secondary">Keeper</Badge>}
                  {p.acquired && !p.isKeeper && (
                    <span className="text-primary shrink-0 text-[10px] font-semibold">
                      &larr; {p.originalOwner}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <DataSourceNote
          fromDatabase={source.fromDatabase}
          fallbackReason={source.fallbackReason}
          snapshotLabel="data/managers.json and the board snapshot, both read from Sleeper"
        />
      </PageBody>
    </>
  );
}

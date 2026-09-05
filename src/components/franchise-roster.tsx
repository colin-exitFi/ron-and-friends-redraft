import Link from "next/link";
import { ArrowUpRight, Check, CircleAlert, HelpCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DRAFT } from "@/lib/league-config";
import type { FranchiseView } from "@/lib/league-view";

/**
 * The ten franchises, each with its draft capital and keeper commitments.
 *
 * Read-only. Editing franchises needs the database, so the /teams page mounts
 * the editor separately once there is one to write to.
 */

/** "1, 2, 3, 5, 7×2" — a franchise's rounds, collapsing duplicates. */
function summarizeRounds(rounds: number[]): string {
  if (!rounds.length) return "—";
  const counts = new Map<number, number>();
  for (const r of rounds) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, n]) => (n > 1 ? `${round}\u00d7${n}` : `${round}`))
    .join(", ");
}

function PickDelta({ franchise }: { franchise: FranchiseView }) {
  const net = franchise.picksHeld - DRAFT.rounds;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-base font-semibold">{franchise.picksHeld}</span>
      {net !== 0 && (
        <span
          className={
            net > 0 ? "text-primary text-xs font-medium" : "text-destructive text-xs font-medium"
          }
        >
          {net > 0 ? `+${net}` : net}
        </span>
      )}
    </span>
  );
}

function KeeperLine({
  keeper,
}: {
  keeper: FranchiseView["keepers"][number];
}) {
  return (
    /*
     * Stacks on a phone. Side by side, the clock label ("Year 2 of 3 — first
     * keeper season") is unshrinkable and ate the name down to "Ladd…"; giving
     * the name its own line means both read in full.
     */
    <li className="flex items-center justify-between gap-2 py-1 max-md:flex-col max-md:items-start max-md:gap-0.5 max-md:py-1.5">
      <span className="flex min-w-0 items-center gap-2 max-md:w-full">
        <span className="text-muted-foreground w-10 shrink-0 font-mono text-xs">
          {keeper.boardLabel}
        </span>
        <span className="truncate font-medium max-md:text-[13px]">{keeper.playerName}</span>
        <span className="text-muted-foreground shrink-0 text-xs">{keeper.position}</span>
      </span>
      {keeper.tenureDispute ? (
        <Badge
          variant="outline"
          className="border-warning/50 text-warning shrink-0 max-md:ml-12"
          title={`${keeper.tenureDispute.question} ${keeper.tenureDispute.resolution}`}
        >
          <HelpCircle className="mr-1 h-3 w-3" />
          {keeper.tenureDispute.badge}
        </Badge>
      ) : keeper.finalSeason ? (
        <Badge variant="destructive" className="shrink-0 max-md:ml-12">
          Final season
        </Badge>
      ) : (
        <span className="text-muted-foreground shrink-0 text-xs max-md:pl-12">
          {keeper.clockLabel}
        </span>
      )}
    </li>
  );
}

/**
 * Says where a franchise stands on declaring.
 *
 * Driven by `declarationStatus`, never by `keepers.length`. A manager who has
 * closed his list while keeping nobody and a manager who has not replied both
 * show zero keepers, and the commissioner needs to tell them apart.
 */
function DeclarationNote({ franchise }: { franchise: FranchiseView }) {
  if (franchise.declarationStatus === "complete") return null;

  const outstanding = franchise.declarationStatus === "awaiting";
  const slots =
    franchise.keeperSlotsPending === 1
      ? "one keeper slot"
      : `${franchise.keeperSlotsPending} keeper slots`;

  return (
    <div
      className={
        outstanding
          ? "border-destructive/40 bg-destructive/5 mt-2 flex items-start gap-2 rounded-md border-l-2 px-2.5 py-2"
          : "border-border bg-muted/30 mt-2 flex items-start gap-2 rounded-md border-l-2 px-2.5 py-2"
      }
    >
      {outstanding ? (
        <CircleAlert className="text-destructive mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <p className="text-xs leading-relaxed">
        {outstanding ? (
          <>
            <span className="font-medium">No answer yet.</span>{" "}
            <span className="text-muted-foreground">
              {slots}{" "}
              unfilled, and no declaration on record &mdash; not a decision to
              keep nobody.
            </span>
          </>
        ) : (
          <>
            <span className="font-medium">List closed.</span>{" "}
            <span className="text-muted-foreground">
              Deliberately leaving {slots}{" "}
              empty
              {franchise.declarationsClosedAt
                ? ` (settled ${new Date(franchise.declarationsClosedAt).toLocaleDateString()})`
                : ""}
              .
            </span>
          </>
        )}
      </p>
    </div>
  );
}

export function FranchiseRoster({ franchises }: { franchises: FranchiseView[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {franchises.map((f) => (
        <Card key={f.id}>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center justify-between gap-3">
              <Link
                href={`/teams/${f.id}`}
                className="group hover:text-primary flex min-w-0 items-center gap-2.5 transition-colors touch:min-h-11"
              >
                <span className="bg-secondary text-secondary-foreground ring-border flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold ring-1">
                  {f.draftSlot ?? "—"}
                </span>
                <span className="truncate">{f.franchiseName}</span>
                {/* A touch screen has no hover, so on a phone the only signal
                    that a franchise name leads somewhere has to be drawn. */}
                <ArrowUpRight className="text-muted-foreground/0 group-hover:text-primary h-3.5 w-3.5 shrink-0 transition-colors max-md:text-muted-foreground" />
              </Link>
              <Badge variant="outline" className="shrink-0 font-mono">
                {f.abbrev}
              </Badge>
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              {f.manager}
              <span className="text-muted-foreground/60"> &middot; {f.shortName}</span>
            </p>
          </CardHeader>

          <CardContent className="space-y-4">
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Picks held</dt>
                <dd className="mt-0.5">
                  <PickDelta franchise={f} />
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Picks acquired</dt>
                <dd className="mt-0.5 font-mono text-base font-semibold">
                  {f.picksAcquired}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Picks traded away</dt>
                <dd className="mt-0.5 font-mono text-base font-semibold">
                  {f.picksTradedAway}
                </dd>
              </div>
            </dl>

            <div>
              <p className="text-muted-foreground mb-1 text-xs">Picks by round</p>
              <p className="font-mono text-xs leading-relaxed">
                {summarizeRounds(f.roundsHeld)}
              </p>
            </div>

            <div className="border-border border-t pt-3">
              <p className="text-muted-foreground mb-1 text-xs">
                Keepers ({f.keepers.length})
                {f.keepers.length > 0 && (
                  <span className="text-muted-foreground/60">
                    {" "}
                    &middot; and the pick each one costs
                  </span>
                )}
              </p>
              {f.keepers.length > 0 && (
                <ul className="divide-border divide-y text-sm">
                  {f.keepers.map((k) => (
                    <KeeperLine key={k.playerId} keeper={k} />
                  ))}
                </ul>
              )}
              <DeclarationNote franchise={f} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

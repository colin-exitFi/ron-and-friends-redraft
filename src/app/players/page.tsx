import { Radio, TriangleAlert } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import { CheatSheet } from "@/components/cheat-sheet";
import { FantasyProsRefresh } from "@/components/fantasypros-refresh";
import { cn } from "@/lib/utils";
import { buildCheatSheet } from "@/lib/cheat-sheet";
import { draftedFromView, type DraftedBy } from "@/lib/cheat-sheet-view";
import { getPoolFetchedAt, getPoolScoringFormat } from "@/lib/smartdraft";
import { getLivePlayerFeed } from "@/lib/fantasypros/feed";
import { joinKey } from "@/lib/fantasypros/players";
import { readRoom, savesAreShared } from "@/lib/draft-service";
import { LEAGUE, SCORING_FORMAT } from "@/lib/league-config";

export const metadata = { title: `Cheat Sheet · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

/**
 * The research page: the player pool, priced in this league's points, that
 * keeps itself current with the board being run in the room.
 *
 * WHY THIS IS NOT A PANEL ON THE DRAFT BOARD. It was suggested as a toggle
 * there and it belongs here instead, for two reasons. The board goes on a
 * television and is the one screen that cannot break; and the people who need
 * this are reading it on phones at the same time, which is a different screen
 * with different constraints. A separate route also means nothing on this page
 * can take the board down with it.
 *
 * The server's job here is only to assemble static things — the pool, the
 * projections, the ADP. WHO HAS BEEN DRAFTED IS DELIBERATELY HANDED OVER TO THE
 * CLIENT after first paint: the initial set is rendered server-side so the page
 * is correct the moment it loads, and `CheatSheet` then keeps it current over
 * the realtime channel without re-rendering the tree. See that component for
 * why a `router.refresh()` would be the wrong mechanism.
 */
export default async function PlayersPage() {
  /*
   * The live ADP layer. `getLivePlayerFeed` never throws — it falls through the
   * shared cache to the committed snapshot and reports which one it used — so
   * the worst case is the table shows the numbers it would have shown anyway,
   * with a line saying so.
   */
  const live = await getLivePlayerFeed();
  const liveAdp = new Map(
    live.players
      .filter((p) => p.adp != null)
      .map((p) => [joinKey(p.name, p.position), p.adp!] as const),
  );

  const { rows, meta } = buildCheatSheet(liveAdp);

  /*
   * The board as it stands at first paint.
   *
   * Wrapped, and a failure here degrades to "nobody is drafted yet" rather than
   * a 500. A cheat sheet that has lost the board is still a sortable pool with
   * projections in it, which is most of what this page is for — and the client
   * re-fetches the same endpoint seconds later anyway, so a transient database
   * hiccup at render time heals itself without the manager doing anything.
   */
  let drafted: DraftedBy = {};
  let boardProblem: string | null = null;
  try {
    drafted = draftedFromView(await readRoom());
  } catch (cause) {
    boardProblem =
      cause instanceof Error ? cause.message : "The board could not be read.";
  }

  const poolScope = getPoolScoringFormat();
  const scopeMatchesLeague = poolScope === SCORING_FORMAT;
  const fetchedAt = new Date(getPoolFetchedAt());

  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "an unknown time";

  const degraded =
    live.source === "stale" || live.source === "snapshot" || live.source === "unavailable";
  const liveLabel =
    live.source === "fresh" || live.source === "cache"
      ? `ADP is live from FantasyPros for ${liveAdp.size.toLocaleString()} ranked players at ${live.scoring} scoring, fetched ${when(live.fetchedAt)}.`
      : live.source === "stale"
        ? `FantasyPros could not be reached, so the ADP is the last good set, from ${when(live.fetchedAt)}. ${live.reason ?? ""}`
        : live.source === "snapshot"
          ? `FantasyPros could not be reached, so the ADP is the committed snapshot's, pulled ${when(live.fetchedAt)}. ${live.reason ?? ""}`
          : `No FantasyPros data is available, so the ADP is the base pool's. ${live.reason ?? ""}`;

  return (
    <>
      <PageHeader
        eyebrow="Player pool"
        title="Cheat Sheet"
        description={`Every draftable player, scored in this league's own rules — ${SCORING_FORMAT}, ${meta.passTd}-point passing touchdowns — next to the market's ADP. Drafted players drop out as the picks happen. No kickers: the position is not used in this league.`}
      />
      <PageBody>
        {/*
          WHERE EACH COLUMN CAME FROM, SAID SEPARATELY FOR EACH COLUMN.
          These two numbers have completely different pedigrees and only one of
          them is right for this league, so a single paragraph covering both is
          the one thing this block must not be. The ADP is somebody else's
          consensus at somebody else's scoring and it is a week old; the Proj is
          computed here, today, from this league's own rules. A manager who
          takes the wrong one on trust is exactly the person this page was
          built to reassure.
        */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid max-w-prose gap-2 text-xs">
            <p
              className={cn(
                "flex items-start gap-2",
                scopeMatchesLeague ? "text-muted-foreground" : "text-warning",
              )}
            >
              {scopeMatchesLeague && !degraded ? (
                <Radio className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span>
                <span className="font-medium">ADP</span> — {liveLabel}
                {!scopeMatchesLeague && (
                  <>
                    {" "}
                    <span className="font-semibold">
                      It is {poolScope ?? "of unrecorded"} scoring, and this league is{" "}
                      {SCORING_FORMAT}.
                    </span>{" "}
                    So the ADP column understates tight ends and quarterbacks here.
                    That is not a defect to work around — it is the market price,
                    and the Proj column is what this league thinks. Run{" "}
                    <code className="bg-secondary rounded px-1 py-0.5 font-mono">
                      npm run auth:fantasypros
                    </code>{" "}
                    then{" "}
                    <code className="bg-secondary rounded px-1 py-0.5 font-mono">
                      npm run pull:fantasypros
                    </code>{" "}
                    to re-scope it.
                  </>
                )}{" "}
                Pool as of{" "}
                {fetchedAt.toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                .
              </span>
            </p>

            <p className="text-muted-foreground flex items-start gap-2">
              {meta.projectionsProblem ? (
                <TriangleAlert className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <Radio className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              {meta.projectionsProblem ? (
                <span className="text-warning">{meta.projectionsProblem}</span>
              ) : (
                <span>
                  <span className="font-medium">Proj</span> —{" "}
                  <span className="text-foreground font-medium">projected</span>, not
                  actual, and computed in{" "}
                  <span className="text-foreground">{SCORING_FORMAT}</span>.{" "}
                  {meta.projectedCount.toLocaleString()} players&apos; raw{" "}
                  {meta.projectionSeason} stat lines from FantasyPros, pulled{" "}
                  {when(meta.projectionsPulledAt)} and scored here with this
                  league&apos;s own rules — nobody else&apos;s points column is used.
                  Unlike the ADP, this one is correctly scoped whatever FantasyPros
                  is doing.
                  {meta.vendorScoredCount > 0 && (
                    <>
                      {" "}
                      {meta.vendorScoredCount} rows carry FantasyPros&apos; own total
                      because no stat line came back — team defences, mostly, which no
                      feed breaks into the parts this league scores.
                    </>
                  )}
                </span>
              )}
            </p>
          </div>
          <FantasyProsRefresh />
        </div>

        {boardProblem && (
          <p className="text-warning flex items-start gap-2 text-xs">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The draft board could not be read just now, so everyone below is showing
              as available. This page re-checks every few seconds and will correct
              itself. ({boardProblem})
            </span>
          </p>
        )}

        <CheatSheet
          rows={rows}
          initialDrafted={drafted}
          liveEnabled={savesAreShared()}
          meta={meta}
        />
      </PageBody>
    </>
  );
}

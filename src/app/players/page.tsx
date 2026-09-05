import { ChevronDown, Radio, TriangleAlert } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import { CheatSheet } from "@/components/cheat-sheet";
import { buildCheatSheet } from "@/lib/cheat-sheet";
import { draftedFromView, type DraftedBy } from "@/lib/cheat-sheet-view";
import { getPoolFetchedAt, getPoolProvenance } from "@/lib/smartdraft";
import { getLivePlayerFeed } from "@/lib/fantasypros/feed";
import { joinKey } from "@/lib/fantasypros/players";
import { readRoom, savesAreShared } from "@/lib/draft-service";
import { LEAGUE, SCORING_FORMAT } from "@/lib/league-config";

export const metadata = { title: `Cheat Sheet · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

/** Where the league is. Every timestamp this page prints is in this zone. */
const LEAGUE_TIMEZONE = "America/Chicago";

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

  /*
   * WHAT SCOPE THE ADP IS REALLY AT.
   *
   * There are two answers and only one of them is the one a manager cares
   * about. `scoringFormat` is the SMART DRAFT base snapshot's scope, which is
   * old and full-PPR and covers the tail of the pool. `fantasyPros.scoring` is
   * the overlay the commissioner pulls, which is fresh and now HALF, and it is
   * what nearly every draftable player's ADP actually comes from.
   *
   * The page used to print the base snapshot's scope, which was honest before
   * the overlay existed and became actively misleading the moment he re-pulled
   * at HALF: it warned about a full-PPR ADP that was no longer being shown for
   * anybody worth drafting. The overlay is what gets named.
   *
   * HALF IS STILL NOT THIS LEAGUE'S SCORING, and that is stated rather than
   * treated as solved. FantasyPros' half-PPR gives every position half a point
   * a catch; it knows nothing about the tight end premium. So the ADP column is
   * closer than it was and is still not the league's price — which is exactly
   * why the ordering comes from the league-configured export instead.
   */
  const pool = getPoolProvenance();
  const adpScope = pool.fantasyPros?.scoring ?? pool.scoringFormat;
  const adpIsHalf = adpScope?.toUpperCase() === "HALF";
  const fetchedAt = new Date(getPoolFetchedAt());

  /*
   * EVERY TIMESTAMP ON THIS PAGE IS STATED IN THE LEAGUE'S OWN TIMEZONE, AND
   * SAYS SO.
   *
   * This page renders on the server, and the deployment's server runs in UTC.
   * Without an explicit `timeZone` the formatter used the runtime's zone and
   * printed a 2:20 PM export as "7:20 pm" — a literal UTC clock reading offered
   * to ten managers in Missouri as the freshness of their cheat sheet. It was
   * not wrong by a rounding error, it was wrong by five hours, in the direction
   * that makes an hour-old export look like it was pulled after dinner.
   *
   * Formatting still happens on the server, deliberately: doing it in the
   * browser would resolve in the viewer's zone, which is right for nine of them
   * and would also rewrite the text after hydration. Pinning the zone gets the
   * correct reading AND a stable one.
   *
   * The label is the word "Central" rather than `timeZoneName: "short"`, which
   * emits "CDT" in September. That is technically exact and reads as a typo to
   * anybody who calls it CST all year.
   */
  const when = (iso: string | null) =>
    iso
      ? `${new Date(iso).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
          timeZone: LEAGUE_TIMEZONE,
        })} Central`
      : "an unknown time";

  /*
   * Whether the summary line can be stated plainly or has to carry a warning.
   * The ADP being mis-scoped is NOT counted here: it is expected, it is
   * explained inside, and the league-scoped Rk column is what the page orders
   * by regardless. Warning on it every time would train the room to ignore the
   * icon that also means "there is no league board at all".
   */
  const sheetIsHealthy = Boolean(meta.board?.scopedToLeague) && !meta.projectionsProblem;
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
        {/*
          WHERE EACH COLUMN CAME FROM — ONE LINE, THEN A DISCLOSURE.
          The full provenance runs to three paragraphs and it all matters, but
          on a 390px screen it pushed the first player below the fold. The two
          managers this page was built for open it to look at players; a wall of
          caveats before the first name is how a research tool loses to a sheet
          of paper. So the headline is one scannable line and the detail is one
          tap away — collapsed, not deleted, because none of it is optional
          once somebody wants to know why the numbers disagree.
        */}
        {/*
          NO "REFRESH FROM FANTASYPROS" BUTTON, AND NOTHING RED.

          It advertised a capability that does not work — FantasyPros cannot be
          reached from the deployment — and its failure message ("could not be
          reached, these are the last good ones") turned a page whose numbers are
          correct into one that looks broken. Ten managers are about to read this
          on their phones during a live draft, and red text beside a column of
          figures is an invitation to distrust the figures. The provenance is
          stated plainly instead, below and in the disclosure inside this block.

          `FantasyProsRefresh` and `/api/fantasypros/refresh` are left in the
          repo. The commissioner still refreshes from the command line, and
          deleting a working route to hide a button nobody can see is a change
          with more ways to go wrong than to go right.
        */}
        <details className="group border-border bg-card/40 min-w-0 rounded-lg border">
            <summary className="text-muted-foreground flex cursor-pointer list-none items-start gap-2 p-3 text-xs touch:min-h-11">
              {sheetIsHealthy ? (
                <Radio className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
              ) : (
                <TriangleAlert className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1">
                {meta.board?.scopedToLeague ? (
                  <>
                    Ordered by FantasyPros&apos; consensus{" "}
                    <span className="text-foreground font-medium">
                      exported for this league&apos;s scoring
                    </span>
                    , {when(meta.board.exportedAt)}. Points computed in{" "}
                    {SCORING_FORMAT}. ADP is the market&apos;s, at{" "}
                    {adpScope ?? "unknown"} scope.
                  </>
                ) : (
                  <span className="text-warning">
                    {meta.boardProblem ?? "No league-scoped board — ordering by ADP."}
                  </span>
                )}
                <span className="text-muted-foreground/60 ml-1 underline underline-offset-2 group-open:hidden">
                  Where these numbers come from
                </span>
              </span>
              <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
            </summary>

            <div className="border-border grid gap-2 border-t p-3 text-xs">
              {meta.board?.scopedToLeague ? (
                <p className="text-muted-foreground">
                  <span className="text-foreground font-medium">Rk (the order)</span> —
                  FantasyPros expert consensus, exported by the commissioner against his
                  own league configuration
                  {meta.board.leagueLabel ? ` (“${meta.board.leagueLabel}”)` : ""} on{" "}
                  {when(meta.board.exportedAt)}, covering{" "}
                  {meta.board.rankedCount.toLocaleString()} players. Because it is
                  scoped to this league it already prices the tight end premium and the{" "}
                  {meta.passTd}-point passing touchdown — Brock Bowers comes out five
                  places higher on it than on the public board. Tiers on it come from
                  FantasyPros&apos; <span className="text-foreground">generic</span>{" "}
                  board, so they group the ordinary ranking rather than this one.
                </p>
              ) : (
                <p className="text-warning">{meta.boardProblem}</p>
              )}

              <p className="text-muted-foreground">
                {meta.projectionsProblem ? (
                  <span className="text-warning">{meta.projectionsProblem}</span>
                ) : (
                  <>
                    <span className="text-foreground font-medium">Proj</span> —{" "}
                    <span className="text-foreground font-medium">projected</span>, not
                    actual. {meta.projectedCount.toLocaleString()} players&apos; raw{" "}
                    {meta.projectionSeason} stat lines from FantasyPros, pulled{" "}
                    {when(meta.projectionsPulledAt)} and scored here under{" "}
                    {SCORING_FORMAT} — nobody else&apos;s points column is used, so this
                    is correctly scoped whatever FantasyPros is serving.
                    {meta.vendorScoredCount > 0 && (
                      <>
                        {" "}
                        {meta.vendorScoredCount} rows carry FantasyPros&apos; own total
                        because no stat line came back — team defences, mostly, which no
                        feed breaks into the parts this league scores.
                      </>
                    )}
                  </>
                )}
              </p>

              {(meta.lastSeason || meta.lastSeasonProblem) && (
                <p className="text-muted-foreground">
                  {meta.lastSeason ? (
                    <>
                      <span className="text-foreground font-medium">
                        {meta.lastSeason.season} (what happened)
                      </span>{" "}
                      — <span className="text-foreground font-medium">actual</span>, not
                      projected. Raw {meta.lastSeason.season} stat lines from
                      Sleeper&apos;s public stats API, pulled{" "}
                      {when(meta.lastSeason.pulledAt)} and scored here under the same{" "}
                      {SCORING_FORMAT} rules, covering{" "}
                      {meta.lastSeason.scoredCount.toLocaleString()} players. Because it
                      is a finished season rather than a forecast, the yardage and
                      explosive-play bonuses are applied too — a projection cannot do
                      that, since it has no way to know how many 100-yard games are
                      inside a season total. Team defences carry no figure on purpose:
                      this league&apos;s points-allowed ladder is a per-game band, and
                      scoring one off a season total would produce a confident wrong
                      answer.
                    </>
                  ) : (
                    <span className="text-warning">{meta.lastSeasonProblem}</span>
                  )}
                </p>
              )}

              <p className="text-muted-foreground">
                <span className="font-medium">ADP</span> — {liveLabel}
                {pool.fantasyPros && (
                  <>
                    {" "}
                    Pulled at{" "}
                    <span className="text-foreground font-medium">
                      {pool.fantasyPros.scoring}
                    </span>{" "}
                    scoring, {when(pool.fantasyPros.fetchedAt)}, covering{" "}
                    {pool.fantasyPros.playersWithLiveAdp.toLocaleString()} players.
                    {adpIsHalf ? (
                      <>
                        {" "}
                        That is half PPR, which is this league&apos;s base rate —{" "}
                        <span className="text-foreground">
                          but it still has no tight end premium
                        </span>
                        , because no public feed prices one. So ADP remains the
                        market&apos;s number and understates tight ends here. The Rk
                        column is the one that accounts for it.
                      </>
                    ) : (
                      <>
                        {" "}
                        This league is {SCORING_FORMAT}, so ADP understates tight ends
                        and quarterbacks. Run{" "}
                        <code className="bg-secondary rounded px-1 py-0.5 font-mono">
                          npm run pull:fantasypros
                        </code>{" "}
                        to re-scope it.
                      </>
                    )}
                  </>
                )}{" "}
                Below FantasyPros&apos; ranked depth the tail falls back to the Smart
                Draft snapshot at {pool.scoringFormat ?? "unrecorded"} scope, pulled{" "}
                {fetchedAt.toLocaleString("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: LEAGUE_TIMEZONE,
                })}{" "}
                Central.
              </p>
            </div>
        </details>

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
          /*
           * FORMATTED HERE, ON THE SERVER, rather than from the ISO string in
           * `meta` inside the client component. `toLocaleString` in a client
           * render resolves in the viewer's timezone and this deployment's
           * server runs in UTC, so the two would disagree by five hours and
           * React would replace the text after hydration — a provenance line
           * that changes its own timestamp in front of somebody is worse than
           * no provenance line.
           */
          rankingsUpdated={meta.board ? when(meta.board.exportedAt) : null}
          /*
           * The same instant, unformatted, for `verify:cheat-sheet:browser` to
           * check the rendered text against. Without it the harness can only
           * assert that SOME time is printed, which is exactly what passed while
           * the page was five hours out.
           */
          rankingsUpdatedIso={meta.board?.exportedAt ?? null}
        />
      </PageBody>
    </>
  );
}

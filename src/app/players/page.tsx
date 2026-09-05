import Link from "next/link";
import { Lock, Radio, Search, TriangleAlert } from "lucide-react";

import { PageBody, PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";
import { DRAFTABLE_POSITIONS } from "@/lib/board-types";
import { browsePlayers } from "@/lib/player-search";
import { getPoolFetchedAt, getPoolProvenance, getPoolScoringFormat } from "@/lib/smartdraft";
import { getLivePlayerFeed } from "@/lib/fantasypros/feed";
import { joinKey } from "@/lib/fantasypros/players";
import { FantasyProsRefresh } from "@/components/fantasypros-refresh";
import { LEAGUE, SCORING_FORMAT } from "@/lib/league-config";

export const metadata = { title: `Players · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const RANKED_LIMIT = 400; // everyone the base pool has an ADP for, and then some
const ALL_LIMIT = 250;

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; pos?: string; view?: string }>;
}) {
  const { q = "", pos = "", view = "" } = await searchParams;
  const showAll = view === "all";
  const position = (DRAFTABLE_POSITIONS as readonly string[]).includes(pos) ? pos : "";

  // The default view is the cheat sheet: only players somebody is drafting.
  const { rows: poolRows, matched } = browsePlayers({
    q,
    pos: position || undefined,
    rankedOnly: !showAll,
    limit: showAll ? ALL_LIMIT : RANKED_LIMIT,
  });
  /*
   * The live layer, and the only surface in the app that awaits it.
   *
   * This page can afford to: it is a browsing screen, not the draft board, and
   * `getLivePlayerFeed` never throws — it falls back through the shared cache
   * to the committed snapshot and says which one it used. So the worst case
   * here is that the table shows the same numbers it would have shown anyway,
   * with a line saying so.
   */
  const live = await getLivePlayerFeed();
  const liveAdp = new Map(
    live.players
      .filter((p) => p.adp != null)
      .map((p) => [joinKey(p.name, p.position), p.adp!] as const),
  );

  const fetchedAt = new Date(getPoolFetchedAt());
  // The base pool's ADP was pulled at a stated scope, so a pool pulled at the wrong one
  // would look identical here while quietly undervaluing receivers.
  const poolScope = getPoolScoringFormat();
  const scopeMatchesLeague = poolScope === SCORING_FORMAT;
  // Where the ADP in this table actually came from. FantasyPros covers the
  // players anyone is drafting and the base pool covers the tail, so saying "as
  // of" once over the whole table would be a claim about the wrong file.
  const { fantasyPros } = getPoolProvenance();

  /*
   * The live number wins over the snapshot's where there is one, and the rows
   * are re-sorted so the table still reads top-down in draft order. Only the
   * page already selected is re-ordered, not the pool — the draft board's
   * ordering is decided by the snapshot and is not touched from here.
   */
  const rows = poolRows
    .map((p) => ({ ...p, adp: liveAdp.get(joinKey(p.name, p.position)) ?? p.adp }))
    .sort((a, b) => (a.adp ?? Infinity) - (b.adp ?? Infinity) || a.name.localeCompare(b.name));

  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "an unknown time";

  const degraded = live.source === "stale" || live.source === "snapshot" || live.source === "unavailable";
  const liveLabel =
    live.source === "fresh" || live.source === "cache"
      ? `Live from FantasyPros — a fresh ADP for ${liveAdp.size.toLocaleString()} ranked players at ${live.scoring} scoring, fetched ${when(live.fetchedAt)}. That is FantasyPros' ranking depth, not the size of this pool.`
      : live.source === "stale"
        ? `FantasyPros could not be reached, so these are the last good numbers, from ${when(live.fetchedAt)}. ${live.reason ?? ""}`
        : live.source === "snapshot"
          ? `FantasyPros could not be reached, so these are the committed snapshot's numbers, pulled ${when(live.fetchedAt)}. ${live.reason ?? ""}`
          : `No FantasyPros data is available, so this is the base pool's board. ${live.reason ?? ""}`;

  function href(next: { pos?: string; view?: string }) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    const nextPos = next.pos ?? position;
    const nextView = next.view ?? (showAll ? "all" : "");
    if (nextPos) params.set("pos", nextPos);
    if (nextView) params.set("view", nextView);
    const s = params.toString();
    return s ? `/players?${s}` : "/players";
  }

  return (
    <>
      <PageHeader
        eyebrow="Player pool"
        title="Players"
        description={`FantasyPros' live consensus board, with the base pool behind it for the players FantasyPros does not rank. ${SCORING_FORMAT} scoring, and no kickers: the K position is not used in this league.`}
      />
      <PageBody>
        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span>
            <span className="text-foreground font-mono font-medium">
              {matched.toLocaleString()}
            </span>{" "}
            {showAll ? "" : "ranked "}
            {position || "players"}
          </span>
          <span>·</span>
          <span>
            Rankings as of{" "}
            {fetchedAt.toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
          <span>·</span>
          <span className={cn(!scopeMatchesLeague && "text-destructive font-medium")}>
            {scopeMatchesLeague
              ? `ADP at ${poolScope} scope`
              : `ADP scope ${poolScope ?? "unrecorded"} — re-pull at ${SCORING_FORMAT}`}
          </span>
        </div>

        {/*
          Says which of the four layers these numbers came from, because "as of"
          on its own would be a claim about the wrong file. A degraded read is
          stated rather than dressed up as live: the whole point of the fallback
          is that it keeps working, and hiding it would turn a working fallback
          into a silent one.
        */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="text-muted-foreground flex max-w-prose items-start gap-2 text-xs">
            {degraded ? (
              <TriangleAlert className="text-warning mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <Radio className="text-primary mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            <span>
              {liveLabel}
              {fantasyPros && (
                <>
                  {" "}
                  Below FantasyPros&apos; ranked pool everyone keeps the base pool&apos;s
                  number — it stops around ADP 270, a hundred picks past the end of
                  this draft, so nobody the room will reach is affected.
                </>
              )}
            </span>
          </p>
          <FantasyProsRefresh />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <form className="relative w-full sm:max-w-xs" action="/players" method="get">
            {position && <input type="hidden" name="pos" value={position} />}
            {showAll && <input type="hidden" name="view" value="all" />}
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search players…"
              className="pl-9 touch:h-11"
            />
          </form>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="border-border bg-card/50 mr-1 inline-flex rounded-md border p-0.5">
              {[
                { label: "Ranked", value: "" },
                { label: "All", value: "all" },
              ].map((v) => (
                <Link
                  key={v.label}
                  href={href({ view: v.value })}
                  className={cn(
                    "inline-flex items-center justify-center rounded px-2.5 py-1 text-xs font-medium transition-colors touch:min-h-11 touch:min-w-14",
                    (v.value === "all") === showAll
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v.label}
                </Link>
              ))}
            </div>
            <Link
              href={href({ pos: "" })}
              className={cn(
                "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors touch:min-h-11 touch:min-w-14",
                !position
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              All pos
            </Link>
            {DRAFTABLE_POSITIONS.map((p) => (
              <Link
                key={p}
                href={href({ pos: p })}
                className={cn(
                  "inline-flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors touch:min-h-11 touch:min-w-11",
                  position === p
                    ? positionStyle(p)
                    : "bg-secondary text-muted-foreground ring-transparent hover:text-foreground",
                )}
              >
                {p}
              </Link>
            ))}
          </div>
        </div>

        {/*
          On a phone the seven columns cannot coexist with a readable name, and a
          400-row cheat sheet is scanned in ADP order — so the four narrow columns
          fold into a sub-line under the name rather than sliding off the side.
          Nothing is dropped; the row just becomes two lines instead of seven
          cells, and the name still gets a whole line to itself.
        */}
        <div className="border-border bg-card/40 overflow-hidden rounded-xl border">
          <div className="max-h-[calc(100vh-320px)] overflow-auto max-md:max-h-[72dvh]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-card/95 sticky top-0 z-10 backdrop-blur">
                <tr className="border-border text-muted-foreground border-b text-left text-[11px] tracking-wide uppercase">
                  <th className="w-16 px-3 py-2.5 text-right font-medium max-md:w-10 max-md:px-2">
                    ADP
                  </th>
                  <th className="px-3 py-2.5 font-medium max-md:px-2">Player</th>
                  <th className="w-16 px-3 py-2.5 font-medium max-md:hidden">Pos</th>
                  <th className="w-16 px-3 py-2.5 font-medium max-md:hidden">Rank</th>
                  <th className="w-16 px-3 py-2.5 font-medium max-md:hidden">Team</th>
                  <th className="w-14 px-3 py-2.5 text-right font-medium max-md:hidden">
                    Bye
                  </th>
                  <th className="w-32 px-3 py-2.5 font-medium max-md:w-[76px] max-md:px-2">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-muted-foreground py-12 text-center">
                      No players match your search.
                    </td>
                  </tr>
                ) : (
                  rows.map((p) => (
                    <tr
                      key={p.id}
                      className={cn(
                        "border-border/50 hover:bg-accent/40 border-b transition-colors last:border-0",
                        p.keptBy && "bg-keeper/[0.04]",
                      )}
                    >
                      <td className="text-muted-foreground/70 px-3 py-2 text-right font-mono text-xs tabular-nums max-md:px-2 max-md:text-[10px]">
                        {p.adp ?? "—"}
                      </td>
                      <td className="px-3 py-2 font-medium max-md:px-2">
                        <span
                          className={cn(
                            "block max-md:truncate max-md:text-[13px]",
                            p.keptBy && "decoration-keeper/50 text-muted-foreground line-through",
                          )}
                        >
                          {p.name}
                        </span>
                        <span className="text-muted-foreground/70 mt-0.5 hidden items-center gap-1.5 font-mono text-[10px] max-md:flex">
                          <span
                            className={cn(
                              "inline-flex h-4 min-w-[1.75rem] items-center justify-center rounded px-1 font-sans text-[9px] font-bold ring-1",
                              positionStyle(p.position),
                            )}
                          >
                            {p.position}
                          </span>
                          {p.positionRank ? `${p.position}${p.positionRank}` : "—"} ·{" "}
                          {p.team ?? "FA"}
                          {p.bye != null && ` · bye ${p.bye}`}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-md:hidden">
                        <span
                          className={cn(
                            "inline-flex h-5 min-w-[2rem] items-center justify-center rounded px-1 text-[10px] font-bold ring-1",
                            positionStyle(p.position),
                          )}
                        >
                          {p.position}
                        </span>
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono text-xs max-md:hidden">
                        {p.positionRank ? `${p.position}${p.positionRank}` : "—"}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 font-mono text-xs max-md:hidden">
                        {p.team ?? "FA"}
                      </td>
                      <td className="text-muted-foreground px-3 py-2 text-right font-mono text-xs tabular-nums max-md:hidden">
                        {p.bye ?? "—"}
                      </td>
                      <td className="px-3 py-2 max-md:px-2">
                        {p.keptBy ? (
                          <span className="text-keeper inline-flex items-center gap-1.5 text-xs max-md:gap-1 max-md:text-[10px]">
                            <Lock className="h-3 w-3 shrink-0" /> Kept · {p.keptBy}
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60 text-xs max-md:text-[10px]">
                            Available
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        {matched > rows.length && (
          <p className="text-muted-foreground text-xs">
            Showing {rows.length.toLocaleString()} of {matched.toLocaleString()}
            {showAll ? "" : " ranked"} players. Search or filter to narrow.
          </p>
        )}
      </PageBody>
    </>
  );
}

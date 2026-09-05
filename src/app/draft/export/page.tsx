import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";

import { readRoom } from "@/lib/draft-service";
import { buildTeamRosters } from "@/lib/draft-roster";
import { CURRENT_SEASON, LEAGUE, SCORING_FORMAT } from "@/lib/league-config";
import { Button } from "@/components/ui/button";
import { PrintButton } from "./print-button";
import type { LiveSlot } from "@/lib/draft-types";

export const metadata = { title: `Draft Export · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

/**
 * The paper artifact: the full board and every roster, on one printable page.
 *
 * PRINT STYLING IS THE EXCEPTION TO THE NO-HARDCODED-COLOUR RULE. The app is a
 * dark product and a dark page cannot be printed — it comes out as a black
 * rectangle and empties a cartridge. The `@media print` block below therefore
 * forces black on white. It is scoped strictly to print, so it can never affect
 * the screen, and every on-screen colour here is still a brand token.
 */
const PRINT_CSS = `
@media print {
  @page { size: landscape; margin: 10mm; }
  html, body { background: #fff !important; color: #000 !important; }
  .no-print { display: none !important; }
  .print-sheet { color: #000 !important; }
  .print-sheet * { color: #000 !important; border-color: #999 !important; }
  .print-sheet .cell { background: #fff !important; }
  .print-sheet .cell-keeper { background: #f2f2f2 !important; }
  .print-sheet .cell-traded { background: #e8eef4 !important; }
  .print-break { break-before: page; }
  .roster-card { break-inside: avoid; }
}
`;

export default async function DraftExportPage() {
  const view = await readRoom();
  const rosters = buildTeamRosters(view);

  const byRound = new Map<number, LiveSlot[]>();
  for (const slot of view.slots) {
    const arr = byRound.get(slot.round) ?? [];
    arr.push(slot);
    byRound.set(slot.round, arr);
  }
  for (const arr of byRound.values()) arr.sort((a, b) => a.column - b.column);

  return (
    <div className="print-sheet mx-auto max-w-[1400px] p-6">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/*
        `nativeButton={false}` on every Button rendered as a link. Base UI
        defaults it to true and then warns — correctly — that rendering an <a>
        strips native button semantics and adds attributes an anchor should not
        carry. Telling it the truth about the element is the fix; the warning is
        pointing at a real accessibility problem, not being noisy.
      */}
      <div className="no-print mb-6 flex flex-wrap items-center gap-2">
        <Button variant="ghost" nativeButton={false} render={<Link href="/draft" />}>
          <ArrowLeft className="h-4 w-4" /> Back to the board
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href="/api/draft/export?what=board" />}
          >
            <Download className="h-4 w-4" /> Board CSV
          </Button>
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href="/api/draft/export?what=rosters" />}
          >
            <Download className="h-4 w-4" /> Rosters CSV
          </Button>
          {/*
            The one to actually use when entering the result on Sleeper. Ordered
            by roster slot, because the platform's offline-draft form takes no
            file and is filled in by typing, one franchise at a time.
          */}
          <Button
            nativeButton={false}
            title="Roster-slot order, for typing the result into Sleeper"
            render={<a href="/api/draft/export?what=espn" />}
          >
            <Download className="h-4 w-4" /> Lineup entry CSV
          </Button>
          <PrintButton />
        </div>
      </div>

      <header className="border-border mb-4 border-b pb-3">
        <h1 className="font-display text-2xl font-bold">
          {LEAGUE.name} — {CURRENT_SEASON} Draft
        </h1>
        <p className="text-muted-foreground text-sm">
          {view.teamCount} teams · {view.rounds} rounds · {view.totalPicks} picks ·{" "}
          {SCORING_FORMAT}, 6-point passing TD, no kicker · {view.keeperCount} keepers ·{" "}
          {view.tradedCount} traded picks
          {view.remaining > 0 && ` · IN PROGRESS, ${view.remaining} slots still open`}
        </p>
      </header>

      {/* --- The board ------------------------------------------------------- */}
      <table className="w-full border-collapse text-[10px]">
        <thead>
          <tr>
            <th className="border-border w-8 border p-1 text-left font-semibold">R</th>
            {view.teams.map((team) => (
              <th key={team.id} className="border-border border p-1 text-left font-semibold">
                {team.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: view.rounds }, (_, i) => i + 1).map((round) => (
            <tr key={round}>
              <td className="border-border text-muted-foreground border p-1 text-center font-bold">
                {round}
              </td>
              {(byRound.get(round) ?? []).map((slot) => (
                <td
                  key={slot.id}
                  className={[
                    "border-border border p-1 align-top",
                    "cell",
                    slot.fill === "keeper" ? "cell-keeper bg-keeper/10" : "",
                    slot.traded && slot.fill !== "keeper" ? "cell-traded bg-trade/10" : "",
                  ].join(" ")}
                >
                  <div className="text-muted-foreground/70 font-mono text-[8px]">
                    {slot.label}
                    {slot.traded && ` → ${slot.currentOwner.name}`}
                    {slot.fill === "keeper" && " · K"}
                  </div>
                  <div className="font-semibold">
                    {slot.player ? (
                      <>
                        {slot.player.name}{" "}
                        <span className="font-normal">
                          {slot.player.position}
                          {slot.player.nflTeam ? ` ${slot.player.nflTeam}` : ""}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground/40">—</span>
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* --- Rosters ---------------------------------------------------------- */}
      <div className="print-break mt-8">
        <h2 className="font-display mb-3 text-xl font-bold">Rosters</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {rosters.map((roster) => (
            <div
              key={roster.team.id}
              className="roster-card border-border break-inside-avoid rounded border p-2"
            >
              <div className="border-border mb-1.5 flex items-baseline justify-between border-b pb-1">
                <div>
                  <p className="text-sm font-bold">{roster.team.franchiseName}</p>
                  <p className="text-muted-foreground text-[10px]">{roster.team.manager}</p>
                </div>
                <span className="font-mono text-[10px]">
                  {roster.rosterSize}/{roster.rosterCap}
                </span>
              </div>
              <table className="w-full text-[10px]">
                <tbody>
                  {roster.players.map((slot) => (
                    <tr key={slot.id}>
                      <td className="text-muted-foreground/60 w-9 py-px font-mono">
                        {slot.label}
                      </td>
                      <td className="w-8 py-px font-semibold">{slot.player!.position}</td>
                      <td className="py-px">{slot.player!.name}</td>
                      <td className="text-muted-foreground/70 py-px text-right font-mono">
                        {slot.player!.nflTeam ?? "FA"}
                        {slot.player!.byeWeek != null && ` ·${slot.player!.byeWeek}`}
                      </td>
                      <td className="w-4 py-px text-right font-mono">
                        {slot.fill === "keeper" ? "K" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {roster.needs.length > 0 && (
                <p className="text-muted-foreground mt-1 text-[10px]">
                  Still needs: {roster.needs.join(", ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground mt-6 text-[10px]">
        K = keeper. An arrow in a cell header names the franchise that acquired that pick.
        Generated{" "}
        {new Date().toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" })}.
      </p>
    </div>
  );
}

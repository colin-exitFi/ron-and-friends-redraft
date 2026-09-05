import { buildTeamRosters } from "@/lib/draft-roster";
import { readRoom } from "@/lib/draft-service";
import { buildFranchiseLineups } from "@/lib/roster-lineup";
import { CURRENT_SEASON } from "@/lib/league-config";
import { readLineupProjectionPoints } from "@/lib/projections-store";

export const dynamic = "force-dynamic";

/**
 * CSV of the finished board or of every roster, so the draft leaves a file
 * behind as well as a printout. `?what=board` (default), `rosters`, or `espn`.
 */

/**
 * ESPN accepts no file.
 *
 * There is no CSV or Excel import for draft results anywhere in ESPN fantasy
 * football — the only route in is LM Tools → Input Offline Draft Results, where
 * you click a roster slot, type until the player appears in an autocomplete,
 * pick him, and hit Save Roster. One franchise at a time.
 *
 * So `?what=espn` is not an import file, because no such thing exists. It is a
 * TYPING SCRIPT, ordered to match that form exactly: franchises in draft order,
 * and within each one the nine starting slots by name and then the bench, so
 * the operator reads straight down a column and never has to search the sheet
 * for "who goes in FLEX2". `?what=rosters` is ordered by pick instead, which is
 * the right shape for a record and the wrong shape for data entry.
 *
 * Empty slots are emitted as blank rows rather than skipped. A roster with a
 * hole in it is a thing the operator needs to SEE on the sheet — silently
 * dropping the row makes a nine-man lineup look complete at eight.
 */

/**
 * ESPN lists team defences as "Texans D/ST", where the pool calls them "Houston
 * Texans". The autocomplete does not find the latter, so the nickname is what
 * gets printed — last word of the name, which holds for every club including
 * the two-word cities ("Los Angeles Rams" → "Rams").
 */
function espnPlayerName(name: string, position: string): string {
  if (position !== "DST") return name;
  const nickname = name.trim().split(/\s+/).pop() ?? name;
  return `${nickname} D/ST`;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: (string | number | null)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export async function GET(request: Request) {
  const what = new URL(request.url).searchParams.get("what") ?? "board";

  try {
    const view = await readRoom();
    let rows: (string | number | null)[][];
    let name: string;

    if (what === "espn") {
      name = `ukl-${CURRENT_SEASON}-espn-entry.csv`;
      rows = [
        ["Franchise", "Manager", "Slot", "Type in ESPN", "Pos", "NFL", "Bye", "Keeper", "Drafted"],
      ];
      for (const lineup of buildFranchiseLineups(view, readLineupProjectionPoints())) {
        const line = (
          slotLabel: string,
          player: (typeof lineup.bench)[number] | null,
        ) =>
          rows.push([
            lineup.team.franchiseName,
            lineup.team.manager,
            slotLabel,
            player ? espnPlayerName(player.name, player.position) : null,
            player?.position ?? null,
            player?.nflTeam ?? null,
            player?.byeWeek ?? null,
            player?.source === "keeper" ? "Y" : "",
            player?.label ?? null,
          ]);

        for (const starter of lineup.starters) line(starter.label, starter.player);
        lineup.bench.forEach((player, i) => line(`BN${i + 1}`, player));
        // Bench slots nobody filled, so the sheet shows the full 16.
        for (let i = lineup.bench.length; i < lineup.benchSize; i += 1) {
          line(`BN${i + 1}`, null);
        }
        // A 17th man cannot be entered — ESPN refuses the roster. Flagged loudly
        // rather than truncated, because the fix is a cut, not a smaller sheet.
        for (const player of lineup.overflow) line("OVER ROSTER CAP", player);
      }
    } else if (what === "rosters") {
      name = `ukl-${CURRENT_SEASON}-rosters.csv`;
      rows = [
        ["Franchise", "Manager", "Pick", "Round", "Position", "Player", "NFL", "Bye", "Keeper"],
      ];
      for (const roster of buildTeamRosters(view)) {
        for (const slot of roster.players) {
          rows.push([
            roster.team.franchiseName,
            roster.team.manager,
            slot.label,
            slot.round,
            slot.player!.position,
            slot.player!.name,
            slot.player!.nflTeam,
            slot.player!.byeWeek,
            slot.fill === "keeper" ? "Y" : "",
          ]);
        }
      }
    } else {
      name = `ukl-${CURRENT_SEASON}-board.csv`;
      rows = [
        [
          "Overall",
          "Pick",
          "Round",
          "Original owner",
          "Current owner",
          "Manager",
          "Traded",
          "Keeper",
          "Position",
          "Player",
          "NFL",
          "Bye",
        ],
      ];
      for (const slot of view.slots) {
        rows.push([
          slot.overallPick,
          slot.label,
          slot.round,
          slot.originalOwner.name,
          slot.currentOwner.name,
          slot.currentOwner.manager,
          slot.traded ? "Y" : "",
          slot.fill === "keeper" ? "Y" : "",
          slot.player?.position ?? null,
          slot.player?.name ?? null,
          slot.player?.nflTeam ?? null,
          slot.player?.byeWeek ?? null,
        ]);
      }
    }

    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Unknown error", { status: 500 });
  }
}

import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

import { CURRENT_SEASON } from "@/lib/league-config";

/**
 * The commissioner's hand-exported FantasyPros board, read off disk.
 *
 * ============================================================================
 * WHY THIS EXISTS AND WHY IT OUTRANKS ADP
 * ============================================================================
 * The app's FantasyPros OAuth grant is not connected, so the live ranking feed
 * is a week old and — worse — scoped to FULL PPR. This league plays half PPR
 * with a tight end premium and six-point passing touchdowns, which means the
 * imported ADP systematically underprices tight ends and quarterbacks. That is
 * not a small effect and it is not correctable after the fact.
 *
 * The commissioner solved it by exporting a cheat sheet from FantasyPros
 * against HIS OWN LEAGUE CONFIGURATION. The resulting order already prices the
 * premium: Brock Bowers comes out 13th overall on it against 18th on the
 * generic public board, which is exactly the lift a full point per tight end
 * reception buys. So `leagueRank` is the best ordering this app has, and it is
 * the one the sheet sorts by out of the box.
 *
 * ADP IS KEPT ANYWAY, AND SHOWN NEXT TO IT. It is the market price — what the
 * room will actually pay — and the gap between the two is the most useful thing
 * on the page. A manager wants to know that this league rates a tight end four
 * rounds above where he will go, because that is a decision he can act on.
 * Overwriting ADP with the league rank would destroy exactly that information.
 *
 * THE TIERS ARE FROM THE GENERIC BOARD AND THE FILE SAYS SO. FantasyPros draws
 * tier boundaries against its own scoring, so they group the generic order
 * rather than this one. They are still worth showing — a tier break is the
 * clearest signal on a cheat sheet that a run is about to matter — but they are
 * labelled rather than passed off as league-specific.
 *
 * Refresh with `npm run pull:cheatsheet`. Read with `fs` rather than imported
 * for the reasons `@/lib/smartdraft` gives: it never lands in a client bundle,
 * and a re-export takes effect on the next request without a rebuild.
 */

export type CheatSheetExportPlayer = {
  playerId: string;
  name: string;
  team: string | null;
  position: string;
  /** Overall rank on the LEAGUE-SCOPED export. The ordering to draft against. */
  leagueRank: number | null;
  /** Rank within position on the same export. */
  leaguePositionRank: number | null;
  bye: number | null;
  /** FantasyPros tier — from the GENERIC board. See the note above. */
  tier: number | null;
  genericRank: number | null;
  genericPositionRank: number | null;
  /**
   * FantasyPros' own expert-consensus-versus-ADP figure, in places. Positive
   * means the experts like him more than the drafting public does.
   */
  ecrVsAdp: number | null;
  avgDiff: number | null;
  upside: number | null;
  bust: number | null;
  sos: number | null;
};

export type CheatSheetExport = {
  provenance: {
    source: string;
    leagueLabel: string;
    rankingScopedToLeague: boolean;
    rankingScopeNote: string;
    tierScope: string;
    tierScopeNote: string;
    exportedAt: string;
    season: number;
  };
  players: CheatSheetExportPlayer[];
};

export type CheatSheetExportState =
  | { state: "ok"; export: CheatSheetExport; byPlayerId: Map<string, CheatSheetExportPlayer> }
  | { state: "missing" }
  | { state: "unreadable"; reason: string };

let cache: { season: number; result: CheatSheetExportState } | null = null;

function isExport(value: unknown): value is CheatSheetExport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<CheatSheetExport>;
  return Array.isArray(v.players) && typeof v.provenance?.leagueLabel === "string";
}

/**
 * The export, or a stated reason there isn't one. Never throws.
 *
 * Missing is a normal state: the file is a manual export and the app has to
 * come up without it. The sheet then falls back to ADP ordering and says so,
 * which is the pre-existing behaviour rather than a broken page.
 */
export function readCheatSheetExport(
  season: number = CURRENT_SEASON,
): CheatSheetExportState {
  if (cache && cache.season === season) return cache.result;

  let result: CheatSheetExportState;
  try {
    const file = path.join(process.cwd(), `data/fantasypros-cheatsheet-${season}.json`);
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    result = isExport(parsed)
      ? {
          state: "ok",
          export: parsed,
          byPlayerId: new Map(parsed.players.map((p) => [p.playerId, p])),
        }
      : { state: "unreadable", reason: "not a cheat sheet export — re-run `npm run pull:cheatsheet`" };
  } catch (cause) {
    result =
      (cause as { code?: string })?.code === "ENOENT"
        ? { state: "missing" }
        : { state: "unreadable", reason: String((cause as Error)?.message ?? cause) };
  }

  cache = { season, result };
  return result;
}

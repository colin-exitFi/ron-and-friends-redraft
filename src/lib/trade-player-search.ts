import "server-only";

import { getPlayerPool } from "@/lib/smartdraft";
import { buildSearchIndex, searchPlayers, type SearchIndex } from "@/lib/draft-search";
import type { PoolPlayer } from "@/lib/board-types";

/**
 * Player matching for the trade log.
 *
 * ============================================================================
 * WHY THIS USES THE DRAFT ROOM'S MATCHER AND NOT `@/lib/player-search`
 * ============================================================================
 * `player-search.ts` — which `/api/players/search` and the `/players` table run
 * on — is a prefix-and-subsequence matcher. It is fine for browsing a cheat
 * sheet, where a near miss costs a keystroke.
 *
 * `draft-search.ts` is the one the draft room uses under time pressure, and it
 * is a different class of tool: it folds punctuation and accents, knows
 * generational suffixes the pool does not store, carries whole-player nicknames,
 * ranks a surname above a full-name prefix because one word shouted across a
 * room is almost always a surname, resolves all 32 team defenses by what the
 * room calls them, and falls back to bounded edit distance for a genuine
 * misspelling.
 *
 * That is exactly the failure this feature exists to close. The imported trade
 * log contains "Puca Nakua" for Puka Nacua, "Treyveon Henderson" for TreVeyon,
 * and "Packers D/ST" against a pool that stores "Green Bay Packers" — three
 * names that needed a hand-written alias map to resolve, and a fourth
 * (`Oronde Gadsen`) waiting in the keeper sheet. Every one of them is a name
 * TYPED INTO A FREE-TEXT FIELD and stored as text.
 *
 * So this flow stores a player id and never a name, and the matcher it stores
 * that id from is the good one. `draft-search.ts` is imported and NOT modified:
 * it is on the draft's critical path three days before the draft, and it was
 * verified across thousands of spellings in its current form.
 */

let cachedIndex: SearchIndex<PoolPlayer> | null = null;

/** Built once per process — re-deriving it per keystroke is the slow way. */
function index(): SearchIndex<PoolPlayer> {
  if (!cachedIndex) cachedIndex = buildSearchIndex(getPlayerPool());
  return cachedIndex;
}

export type TradePlayerHit = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  /**
   * Franchise the ledger says holds him, or null when it has no opinion.
   *
   * Shown at the moment of SELECTION rather than only in the preview, because
   * seeing "held by Zach" while entering a trade Kyle is sending in is the
   * cheapest possible place to notice the wrong player.
   */
  ledgerHolder: string | null;
  /** Held as a 2026 keeper, per the reconciled keeper layer. */
  keptBy: string | null;
};

/**
 * Ranked matches for the trade log, annotated with who the ledger thinks holds
 * each player.
 *
 * Deliberately does NOT filter anyone out. A trade can legitimately involve a
 * player the ledger has never heard of — before Saturday's import it knows the
 * pedigree of 18 players, and in-season waiver adds happen in ESPN and are
 * never reported here — so an unrecognised player is annotated, not hidden.
 */
export async function searchTradePlayers(
  query: string,
  options: { position?: string | null; limit?: number } = {},
): Promise<TradePlayerHit[]> {
  const hits = searchPlayers(index(), query, {
    limit: options.limit ?? 8,
    position: options.position ?? null,
  });
  if (!hits.length) return [];

  const holders = await resolveLedgerHolders(hits.map((h) => h.item.id));

  return hits.map((h) => ({
    id: h.item.id,
    name: h.item.name,
    position: h.item.position,
    nflTeam: h.item.nflTeam,
    ledgerHolder: holders.get(h.item.id) ?? null,
    keptBy: h.item.keptBy,
  }));
}

/**
 * Who the keeper-rights ledger says holds each of these players.
 *
 * Best-effort: a database that is unreachable or unseeded means no annotation,
 * which is strictly better than failing the search. The commissioner can still
 * log the trade; he just does not get the extra hint.
 */
async function resolveLedgerHolders(playerIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const { hasDatabase } = await import("@/lib/env");
    if (!hasDatabase()) return out;
    const { createServiceClient } = await import("@/lib/supabase/server");
    const supabase = createServiceClient();
    const { data: rights } = await supabase
      .from("keeper_rights")
      .select("player_id, current_team_id")
      .in("player_id", playerIds)
      .not("current_team_id", "is", null);
    if (!rights?.length) return out;

    const { data: teams } = await supabase.from("teams").select("id, short_name");
    const shortName = new Map((teams ?? []).map((t) => [t.id, t.short_name]));
    for (const r of rights) {
      const holder = shortName.get(r.current_team_id as string);
      if (holder) out.set(r.player_id, holder);
    }
  } catch {
    // Annotation is a nicety. Losing it must not cost the search.
  }
  return out;
}

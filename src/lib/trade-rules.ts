import { DRAFT, TRADES } from "@/lib/league-config";

/**
 * Three tradable assets: players, draft picks, and FAAB dollars.
 *
 * FAAB is a LINE ITEM, not a balance. ESPN owns the acquisition budget; this
 * app records that a trade moved $20 and derives nothing from it. There is no
 * balance to overdraw and therefore nothing here that checks one.
 */
export type TradeAssetInput = {
  fromTeam: string;
  toTeam: string;
  assetType: "player" | "pick" | "keeper_right" | "faab";
  ref: string;
  keeperClockReset?: boolean;
};

export type PickRef = {
  season: number;
  round: number;
  /**
   * The franchise the pick was BORN TO, which is its permanent identity. Null
   * when the ref does not say, meaning "the sender's own pick".
   *
   * A round and a season do not identify a pick in this league. Multi-hop
   * trading is routine — `Sheet3` of the commissioner's workbook tracks round 1
   * pick 2 going Stefan → Witte → Zach, and it needs two hop columns to do it —
   * so at the moment Witte sends that pick on, "2026 round 1 from Witte" is
   * ambiguous between Stefan's pick and Witte's own. `pick_ownership` is keyed
   * on (season, round, original_team), so resolving to the wrong original owner
   * moves the wrong pick and the board draws two cells backwards.
   */
  originalTeam: string | null;
};

/**
 * Parse a pick ref: `season:round` or `season:round:originalTeamId`.
 *
 * The two-segment form is kept for the trades imported from the workbook, all
 * of which are first hops, and it means "the sender's own pick". Anything that
 * might be a later hop should write the three-segment form; `trades.ts` refuses
 * an ambiguous two-segment ref rather than picking a pick.
 */
export function parsePickRef(ref: string): PickRef {
  const [s, r, originalTeam] = ref.split(":");
  const season = Number(s);
  const round = Number(r);
  if (!season || !round || round < 1 || round > DRAFT.rounds) {
    throw new Error(
      `Invalid pick ref "${ref}" — use season:round (e.g. 2027:3), or ` +
        `season:round:originalTeamId to name whose pick it is.`,
    );
  }
  return { season, round, originalTeam: originalTeam?.trim() || null };
}

export function formatPickRef(
  season: number,
  round: number,
  originalTeam?: string | null,
): string {
  return originalTeam ? `${season}:${round}:${originalTeam}` : `${season}:${round}`;
}

/**
 * A FAAB line's `ref` is the whole-dollar amount and nothing else. Whole
 * dollars because ESPN's budget is whole dollars, and a positive amount because
 * direction is carried by `from_team` / `to_team` — a negative here would mean
 * the same movement twice over, in opposite directions.
 */
export function parseFaabRef(ref: string): number {
  const amount = Number(ref.trim().replace(/^\$/, ""));
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(
      `Invalid FAAB amount "${ref}" — use a positive whole number of dollars, and ` +
        `let the from/to franchises carry the direction.`,
    );
  }
  return amount;
}

export function formatFaabRef(amount: number): string {
  return String(amount);
}

export function validateTradeShape(assets: TradeAssetInput[]): string | null {
  if (!assets.length) return "Add at least one asset.";
  for (const a of assets) {
    if (a.fromTeam === a.toTeam) return "From and to teams must differ.";
    if (!a.ref.trim()) return "Every asset needs a reference value.";
    if (a.assetType === "pick") {
      try {
        parsePickRef(a.ref);
      } catch (e) {
        return e instanceof Error ? e.message : "Invalid pick ref.";
      }
    }
    if (a.assetType === "faab") {
      try {
        parseFaabRef(a.ref);
      } catch (e) {
        return e instanceof Error ? e.message : "Invalid FAAB amount.";
      }
    }
  }
  return null;
}

export function isFuturePick(pickSeason: number, currentSeason: number): boolean {
  return pickSeason > currentSeason;
}

export function pickTradableSeasons(currentSeason: number): number[] {
  const out: number[] = [currentSeason];
  for (let i = 1; i <= TRADES.futurePicksSeasonsOut; i++) {
    out.push(currentSeason + i);
  }
  return out;
}

export { TRADES, DRAFT };

/**
 * View types for the draft board and the player pool.
 *
 * Deliberately free of `server-only` and of any I/O so client components can
 * import them. `@/lib/smartdraft` is the only module that knows the shape of
 * the Smart Draft JSON; when the source becomes Supabase, that module changes
 * and these types — and therefore the UI — do not.
 */

export type BoardPlayer = {
  id: string;
  name: string;
  /** QB | RB | WR | TE | DST. Kickers are filtered out; this league has no K. */
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
};

export type BoardTeam = {
  id: string;
  /** Draft slot, 1…LEAGUE.teams. Also the column this franchise heads. */
  slot: number;
  /**
   * Short handle — "Greg", "Witte". What the dense grid cells and the traded-pick
   * table show, because a 40-pixel column cannot hold "Fingers are for painting".
   */
  name: string;
  /** Real ESPN franchise name, for the places with room to print it. */
  franchiseName: string;
  abbrev: string;
  manager: string;
};

export type BoardSlot = {
  id: string;
  round: number;
  /** Position within the round in pick order, 1…LEAGUE.teams. */
  pickInRound: number;
  overallPick: number;
  /** "4.06" — the label the room calls a pick by. */
  label: string;
  /**
   * Grid column, 1…LEAGUE.teams. Equals the ORIGINAL owner's draft slot: a
   * franchise keeps its column all 16 rounds, and a traded pick shows up as a
   * foreign owner inside someone else's column rather than moving cells.
   */
  column: number;
  originalOwner: BoardTeam;
  currentOwner: BoardTeam;
  /** Current owner differs from the franchise whose slot this is. */
  traded: boolean;
  isKeeper: boolean;
  player: BoardPlayer | null;
  onTheClock: boolean;
};

/**
 * What the reconciled keeper layer had to add to the board the Smart Draft room
 * supplied, and what it could not place.
 *
 * Smart Draft is the league's operational system for now and the commissioner
 * maintains it by hand, so this is the list of keepers he still needs to key in
 * over there. Worth showing compactly: it is reconciliation work he is currently
 * doing from memory.
 */
export type KeeperDivergence = {
  /** Reconciled keepers placed on the board because the room lacked them. */
  placed: {
    playerName: string;
    teamShortName: string;
    costRound: number;
    /** Board cell it landed in, e.g. "6.05". */
    label: string;
    /** False when it had to consume a pick the franchise acquired. */
    onOwnPick: boolean;
  }[];
  /** Keepers that could not be placed, with the reason. Needs a human. */
  unplaceable: {
    playerName: string;
    teamShortName: string;
    costRound: number;
    reason: string;
  }[];
  /** Keepers the room already carried. */
  inRoomCount: number;
};

/** Per-franchise draft capital, after trades. */
export type BoardTeamSummary = BoardTeam & {
  /** Slots currently held (may differ from DRAFT.rounds — trades need not net out). */
  picks: number;
  keepers: number;
  /** Held picks that started life as another franchise's. */
  acquired: number;
  /** Own picks now held by someone else. */
  tradedAway: number;
};

export type BoardView = {
  season: number;
  rounds: number;
  teamCount: number;
  totalPicks: number;
  /** In draft order — index 0 is slot 1, who picks at 1.01. */
  teams: BoardTeamSummary[];
  slots: BoardSlot[];
  keeperCount: number;
  tradedCount: number;
  /** When the snapshot behind this board was pulled. */
  fetchedAt: string | null;
  /**
   * What the reconciled layer added on top of the room's own keepers. Empty
   * `placed` and `unplaceable` means the room is fully in step.
   */
  keeperDivergence: KeeperDivergence;
};

export type PoolPlayer = BoardPlayer & {
  /**
   * Consensus ADP, at this league's PPR scoring. FantasyPros' live number where
   * the snapshot has one, and Smart Draft's for the tail FantasyPros does not
   * rank. Both are the average overall pick in real PPR redrafts, so they are
   * the same measurement — see `@/lib/fantasypros/snapshot`. Null for players
   * nobody is drafting.
   */
  adp: number | null;
  /** Rank within position, derived from ADP order. Null when unranked. */
  positionRank: number | null;
  /** Franchise holding him as a keeper, so the pool can grey him out. */
  keptBy: string | null;
  /** Whose ADP the `adp` above is. Shown as provenance rather than assumed. */
  adpSource: "fantasypros" | "smartdraft";
  /** FantasyPros player id, where the snapshot could supply one. */
  fpId: number | null;
  /**
   * Headshot URL, already resolved and known to exist. Null means FantasyPros
   * has no picture of him and the UI should draw its own fallback.
   *
   * Carried on the pool — and therefore already in the browser before the draft
   * starts — precisely so that showing a face costs no network call at the
   * moment a pick is made.
   */
  headshotUrl: string | null;
};

/** Positions this league drafts, in the order they belong in a filter row. */
export const DRAFTABLE_POSITIONS = ["QB", "RB", "WR", "TE", "DST"] as const;

export type DraftablePosition = (typeof DRAFTABLE_POSITIONS)[number];

export function isDraftablePosition(pos: string): pos is DraftablePosition {
  return (DRAFTABLE_POSITIONS as readonly string[]).includes(pos);
}

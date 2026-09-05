/**
 * Types for logging a trade that has already happened.
 *
 * Free of `server-only` and of any I/O, so the wizard and the route handlers
 * share one vocabulary. The implementation lives in `@/lib/trade-entry`.
 *
 * ============================================================================
 * WHAT THIS FLOW IS, AND WHAT IT DELIBERATELY IS NOT
 * ============================================================================
 * ESPN runs the season. A trade is proposed, negotiated and approved there; the
 * commissioner then comes here and records what happened. So this is a LOG OF
 * AN ACCEPTED FACT, not an approval workflow. There is no propose step, no
 * acceptance, no voting and no veto, because every one of those decisions was
 * already taken somewhere else. A logged trade is applied to the ledger
 * immediately, and the correction mechanism is a reversal rather than a refusal.
 *
 * There is also exactly one writer — the commissioner, on his own machine, with
 * no accounts anywhere in the product. So nothing here does optimistic locking,
 * conflict resolution or permission checking.
 *
 * ============================================================================
 * THE DESIGN PROBLEM THIS SHAPE IS BUILT AROUND
 * ============================================================================
 * The payoff is nine months away. A trade logged in November changes nothing
 * visible until the draft board goes up the following August, so there is no
 * natural feedback loop and A MISTAKE STAYS INVISIBLE FOR NINE MONTHS before
 * surfacing as a wrong cell in front of ten people. This project has already
 * been burned exactly that way: the imported trade log contains "Puca Nakua",
 * "Treyveon Henderson" and "Packers D/ST", a pick that changed hands twice was
 * resolved from the wrong franchise and silently moved the wrong pick, and a
 * real Stefan/Witte round-4 swap is simply missing from the log.
 *
 * Hence three structural choices, each aimed at one of those failures:
 *
 *   PICKS come from what the ledger says the sender CURRENTLY holds, so a pick
 *   he does not own cannot be offered at all. `PickOption` therefore always
 *   names the original owner — a pick's permanent identity is
 *   (season, round, original owner), and that is what a multi-hop ref needs.
 *
 *   PLAYERS are chosen by id from the matcher the draft room uses, never typed.
 *   `PlayerLine` has no free-text name field for the same reason `PickOption`
 *   has no free-text round: there is nowhere to put a typo.
 *
 *   THE CONSEQUENCE is confirmed rather than the form. `TradePreview` exists so
 *   the commissioner approves "Zach now holds Kyle's 2027 round 6, and Ladd
 *   McConkey's clock resets" rather than approving a filled-in form. A wrong
 *   entry reads wrong as an outcome far more often than it reads wrong as a
 *   recap of what was typed.
 */

// --- Assets -----------------------------------------------------------------

/**
 * A pick the ledger says a franchise currently holds, and may therefore offer.
 *
 * `originalTeamId` is not decoration. A pick's identity is
 * (season, round, ORIGINAL owner) and the sender is the original owner only on
 * the pick's first move, so a ref that omits it stops identifying anything the
 * moment the pick changes hands twice. Every ref this flow generates names it.
 */
export type PickOption = {
  /** `season:round:originalTeamId` — always three segments, never ambiguous. */
  ref: string;
  season: number;
  round: number;
  originalTeamId: string;
  originalTeamShortName: string;
  /** Held by this franchise but born to another — already acquired once. */
  acquired: boolean;
  /** "2027 R4 (originally Kyle's)" / "2027 R4 (own)". */
  label: string;
};

/**
 * A player the ledger says a franchise currently holds.
 *
 * Offered as a shortlist beside the full search, because after the draft import
 * the ledger knows all 160 rostered players and picking from a roster is both
 * faster and harder to get wrong than searching the whole pool.
 */
export type RosterOption = {
  playerId: string;
  name: string;
  position: string;
  nflTeam: string | null;
  /** Keeper seasons already served with this franchise. */
  seasonsKept: number;
  /** "Year 1 of 2" */
  clockLabel: string;
  basisRound: number | null;
};

export type ParticipantOption = {
  teamId: string;
  shortName: string;
  franchiseName: string;
  manager: string;
};

// --- The draft the wizard holds ---------------------------------------------

export type DraftLineAsset =
  | { kind: "player"; playerId: string }
  | { kind: "pick"; ref: string }
  | { kind: "faab"; amount: number };

/**
 * One asset moving one way.
 *
 * THE WHOLE TRADE IS A SET OF THESE, and that is the load-bearing modelling
 * decision. Two franchises and five franchises produce the same shape, so
 * N-team support costs nothing and needs no widening later. The commissioner
 * reports one three-team trade in league history and confirms they are legal,
 * which is a poor reason to build a parties table and an excellent reason not
 * to hardcode a pair.
 *
 * The UI takes the opposite trade-off deliberately: it is optimised hard for
 * two franchises, since that is essentially every trade, and a third is added
 * on request. The common case must not pay for the rare one.
 */
export type DraftLine = {
  /** Client-side row identity, so React keys survive reordering. */
  key: string;
  fromTeamId: string;
  toTeamId: string;
  asset: DraftLineAsset;
  /**
   * Display text the wizard already has to hand, e.g. the name shown in the
   * search result a player was chosen from.
   *
   * PURELY COSMETIC, and the server never reads it. The authority is the id in
   * `asset`; a label is convenience so the row does not have to be looked up
   * again to render it. Trusting it would reintroduce the free-text name that
   * this whole flow exists to remove.
   */
  label?: string;
};

export type TradeDraft = {
  /**
   * The date the trade actually happened, `YYYY-MM-DD`.
   *
   * NOT metadata — it is an input to the keeper rules. The term is an
   * acquisition season plus two keeper seasons, and which season is which
   * depends on whether the trade fell before the draft or during the season. So
   * the same trade logged in November and in August gives the receiving
   * franchise a different number of keeper years, and without the date the clock
   * cannot be computed at all. That is the live cost of the Nacua case: two
   * records that disagree by a season and no data to settle them with.
   *
   * A full date rather than an in-season/pre-draft flag, on the commissioner's
   * choice, which is the right one: a date answers questions nobody has asked
   * yet, a flag answers only this one.
   */
  tradedAt: string;
  /**
   * DERIVED FROM `tradedAt`, never asked for separately.
   *
   * Present on the draft so the client can show what was derived, but the server
   * recomputes it and does not trust this. Two fields that must agree are two
   * fields that can disagree.
   */
  season: number;
  /** Every franchise involved. Two in practice; the model does not care. */
  participantIds: string[];
  lines: DraftLine[];
  /**
   * Free text, and the ONLY free-text field in the flow.
   *
   * Deliberately unstructured. The league has not decided whether contingent
   * trades are allowed at all — the one that exists was arranged privately
   * between two managers, hinges on an injury, and was tracked in a Word
   * document — so structured condition support would encode a rule that does
   * not exist and quietly legitimise the practice. A note is the honest
   * representation of "this happened; the league has not ruled on whether it
   * should have", and it is what gets read next August.
   */
  notes: string;
};

// --- The preview ------------------------------------------------------------

/** Where a moving pick ends up on the board it belongs to. */
export type PickMovePreview = {
  ref: string;
  pickSeason: number;
  round: number;
  originalTeamShortName: string;
  fromShortName: string;
  toShortName: string;
  /** Born to the sender, or acquired by him earlier — this move's hop number. */
  hop: number;
  /**
   * Plain-language statement of where the pick will draw. Named for the
   * ORIGINAL owner's column, because the column belongs to him for all 16
   * rounds and a traded pick appears as a foreign name inside it rather than
   * moving cells.
   */
  boardNote: string;
};

/** What a trade does to a player's keeper clock and to what he would cost. */
export type PlayerMovePreview = {
  playerId: string;
  name: string;
  position: string;
  fromShortName: string;
  toShortName: string;
  clockBeforeLabel: string;
  clockAfterLabel: string;
  seasonsKeptBefore: number;
  seasonsKeptAfter: number;
  basisRound: number | null;
  /** Round he would cost his NEW franchise next preseason, or null if barred. */
  nextCostRound: number | null;
  /** Why the cost is what it is, or why there isn't one. */
  costNote: string;
  /**
   * THROUGH WHICH SEASON he can now be kept, derived from the trade date.
   *
   * The whole reason the date is captured. Stated in the preview because a wrong
   * date shows up here as a wrong terminal season, and this is the only moment
   * anyone will notice it — nine months before the board that would otherwise
   * reveal it.
   */
  lastKeeperSeason: number;
  firstKeeperSeason: number;
  /** Plain-language consequence of the timing. */
  timingSummary: string;
  /**
   * Set when the outcome turns on the rule reading the league has not settled —
   * a pre-draft acquisition. Null when the timing raises no question.
   */
  timingDisputeNote: string | null;
};

export type FaabMovePreview = {
  amount: number;
  fromShortName: string;
  toShortName: string;
};

export type PickCountPreview = {
  teamId: string;
  shortName: string;
  /** Picks held in the season the moving picks belong to. */
  before: number;
  after: number;
  delta: number;
};

/**
 * What the trade will do, computed against the live ledger and writing nothing.
 *
 * `blockers` must be empty before a commit is allowed; `warnings` are shown and
 * do not stop anything. The split matters: a pick the sender does not own is a
 * fact the ledger can settle, so it blocks. A player the ledger thinks someone
 * else holds is a strong hint and nothing more — before the draft import the
 * ledger knows only 18 players, and in-season ESPN waiver activity is never
 * reported here — so blocking on it would refuse legitimate trades.
 */
export type TradePreview = {
  season: number;
  /** The date, echoed back so the preview describes a specific trade. */
  tradedAt: string;
  /** "in-season 2026 (after the Aug 29 draft)" — the derived classification. */
  timingLabel: string;
  participants: ParticipantOption[];
  blockers: string[];
  warnings: string[];
  pickMoves: PickMovePreview[];
  playerMoves: PlayerMovePreview[];
  faabMoves: FaabMovePreview[];
  /** Only for seasons a pick actually moved in. */
  pickCounts: { pickSeason: number; rows: PickCountPreview[] }[];
  /** One line per franchise: what it gives up and what it gets. */
  summaryByTeam: {
    teamId: string;
    shortName: string;
    receives: string[];
    sends: string[];
  }[];
};

export type CommitResult = {
  tradeId: string;
  /** The preview as it stood when the trade was applied. */
  applied: TradePreview;
};

// --- The standing reconciliation view ---------------------------------------

/**
 * Pick ownership for one season, as a grid of franchises by rounds.
 *
 * The point of showing it all year rather than building it next August: sixteen
 * rounds by ten franchises is small enough to eyeball, and a manager who thinks
 * he owns a pick he does not will say so in November. That is the only feedback
 * loop available during the nine quiet months, and it comes free from ten people
 * who care.
 */
export type OwnershipGridView = {
  season: number;
  rounds: number[];
  teams: { teamId: string; shortName: string }[];
  /** `cells[originalTeamId][round]` — who holds the pick born to that team. */
  cells: Record<string, Record<number, { holderId: string; holderShortName: string }>>;
  heldCounts: Record<string, number>;
  /** True when this season has no ownership rows yet. */
  empty: boolean;
};

/**
 * A machine-checkable statement about the ledger that is either true or a
 * problem. One page that is green or a list of things to fix.
 */
export type LedgerInvariant = {
  label: string;
  ok: boolean;
  /** Present when it failed: what is wrong, specifically enough to act on. */
  detail: string | null;
};

/** A trade logged through this app, N-party by construction. */
export type LoggedTradeView = {
  id: string;
  season: number;
  status: string;
  executedAt: string | null;
  createdAt: string;
  /** When the trade happened. Null for the imported workbook trades. */
  tradedAt: string | null;
  /** Derived from `tradedAt`; null when there is no date to derive from. */
  timingLabel: string | null;
  /** No date on record, so its keeper consequences cannot be computed. */
  needsDateBackfill: boolean;
  notes: string | null;
  /** True once the trade has been un-applied. */
  reversed: boolean;
  /** Imported from the commissioner's workbook rather than logged here. */
  imported: boolean;
  /**
   * Every franchise appearing on any asset row. Two almost always; the display
   * does not assume it, because a two-sided layout would silently drop the
   * third leg of a three-team trade.
   */
  parties: {
    teamId: string;
    shortName: string;
    receives: string[];
    sends: string[];
  }[];
};

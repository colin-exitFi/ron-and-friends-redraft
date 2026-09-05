/**
 * Ultimate Keeper League — single source of truth for league configuration.
 *
 * This file replaces the previous league's constitution module. Every value the
 * app derives behaviour from lives here so the whole league can be re-pointed
 * from one place.
 *
 * Provenance markers, most authoritative first:
 *
 *  `@fromContract`    — stated in the executed Johnston/Blome trade agreement
 *                       (Nov 12 2025), whose recitals spell out the keeper
 *                       rules. Recorded in `data/DECISIONS.md`.
 *  `@fromEspn`        — read from the ESPN league itself (441239). The extracts
 *                       live in `data/espn/`; every value marked this way was
 *                       identical across 2022–2026, so it is settled
 *                       configuration rather than a fresh mistake.
 *  `@fromSmartDraft`  — read out of the live Smart Draft room
 *                       (`data/smartdraft-room-snapshot.json`).
 *
 * ============================================================================
 * PLACEHOLDER VALUES ARE MARKED `@placeholder`. They are guesses that keep the
 * app compiling and the draft board usable. Each one needs to be confirmed by
 * the commissioner before the league treats it as real. Only a handful are
 * left: the two branding strings, the advisory draft clock, the keeper
 * lock-out window, the round-1 keeper rule, and the governance blocks.
 * ============================================================================
 */

// --- Identity ---------------------------------------------------------------

export const LEAGUE = {
  name: "Ultimate Keeper League",
  /** @placeholder Short wordmark used in the sidebar and page titles. */
  shortName: "Ultimate Keeper",
  /** @placeholder Tagline under the wordmark. */
  tagline: "Fantasy Football",
  teams: 10,
  /** @fromEspn ESPN calls the league "The Ultimate Keeper League", season 2026. */
  currentSeason: 2026,
  /** The league plays on ESPN. There is no platform API integration. */
  platform: "ESPN",
  /** @fromEspn Weeks 1–14 regular season, 15–17 playoffs, one week per round. */
  regularSeasonWeeks: [1, 14] as const,
  playoffWeeks: [15, 17] as const,
  /** @fromEspn `playoffTeamCount` — 6, so the top two seeds get a bye. */
  playoffTeams: 6,
} as const;

/**
 * The season the app reads and writes by default. Previously exported from the
 * Sleeper module; it now lives with the rest of the league config.
 */
export const CURRENT_SEASON: number = LEAGUE.currentSeason;

// --- Franchises -------------------------------------------------------------

/**
 * The ten franchises, keyed by the short name the Smart Draft room uses as its
 * team name. That short name is the only handle the room gives us — every team
 * in the snapshot has a null `ownerName` — so it is the join key.
 *
 * @fromEspn Franchise names and abbreviations. Neither the Smart Draft room nor
 * the workbooks carry a franchise nickname (`2026 DRAFT.xlsx` has exactly one,
 * "DHB Sandmen", in a 2017 tab); ESPN has all ten. Joined by PERSON rather than
 * by draft slot, so the ESPN/Smart Draft disagreement over slots 8 and 10 does
 * not corrupt the pairing. Full names come from the `KEEPER LIST` sheets — note
 * two Kyles and two Scotts, which is why the room's short name for the second
 * of each is a surname.
 *
 * "Perpetually Impaired" is listed in ESPN under Ted Buckman; the commissioner
 * has ruled that Ted and Zach Rakowski are the same person, an inside joke on
 * the ESPN account, so the franchise is Zach's.
 */
export type Franchise = {
  /** Smart Draft team name — the join key, and what the dense board cells show. */
  shortName: string;
  franchiseName: string;
  abbrev: string;
  manager: string;
};

export const FRANCHISES: Franchise[] = [
  { shortName: "Zach", franchiseName: "Perpetually Impaired", abbrev: "PI", manager: "Zach Rakowski" },
  { shortName: "Witte", franchiseName: "The Replacement Team", abbrev: "DinP", manager: "Kyle Witte" },
  { shortName: "Joe", franchiseName: "Fingers are for painting", abbrev: "HOJO", manager: "Joe Murray" },
  { shortName: "Josh", franchiseName: "Teddys Trouser Snake", abbrev: "TITS", manager: "Josh Grainger" },
  { shortName: "Elbe", franchiseName: "A.D.B. Rombusters II", abbrev: "ADB", manager: "Scott Elbe" },
  { shortName: "Kyle", franchiseName: "Tushy Booth Ballers", abbrev: "TBB", manager: "Kyle Mertens" },
  { shortName: "Scott", franchiseName: "DHB Sandmen", abbrev: "DHB", manager: "Scott Johnston" },
  { shortName: "Stefan", franchiseName: "Mound City Dogs", abbrev: "DOGS", manager: "Stefan Albers" },
  { shortName: "Greg", franchiseName: "Jimmy's Johnson", abbrev: "JJ", manager: "Greg Blome" },
  { shortName: "Colin", franchiseName: "Flurp McDerp", abbrev: "CT", manager: "Colin Tracy" },
];

const FRANCHISES_BY_SHORT_NAME = new Map(FRANCHISES.map((f) => [f.shortName.toLowerCase(), f]));

/** Look up a franchise by the Smart Draft room's team name. */
export function franchiseByShortName(shortName: string): Franchise | null {
  return FRANCHISES_BY_SHORT_NAME.get(shortName.trim().toLowerCase()) ?? null;
}

// --- Feature switches -------------------------------------------------------

/**
 * Features carried over from the source app that this league does not use.
 * They are switches rather than deletions where a surface is still referenced,
 * so nothing 404s and turning one back on is a one-line change.
 */
export const FEATURES = {
  /** Keepers are LIVE: three seasons of tenure — acquisition year plus two keeper seasons. */
  keepers: true,
  /** No transaction fees, dues, or payout ledger. */
  treasury: false,
  /** Draft order is set by the commissioner, not drawn. */
  lottery: false,
  /** ESPN league — no platform sync. */
  platformSync: false,
  /** Traded picks and traded players are central to this league. */
  tradedPicks: true,
  /** In-person draft: the clock is advisory, not enforced. */
  offlineDraft: true,
} as const;

// --- Roster -----------------------------------------------------------------

/**
 * Starting lineup. NO KICKER — this league does not use the K position, so it
 * is absent from positions, lineup slots, scoring, and player filtering.
 *
 * @fromEspn Exact match to ESPN's `lineupSlotCounts`, including the zero kicker
 * slot, and to the live Smart Draft room's `rosterConfig`.
 *
 * The ORDER is the league's own, not ESPN's: the commissioner reads a lineup
 * card as QB, RB1, RB2, WR1, WR2, FLEX1, FLEX2, TE, DST. Only the counts came
 * from ESPN, and every surface that names slots derives its row order from this
 * array, so this is the one place that order is decided.
 */
export const STARTING_LINEUP: { slot: string; count: number; note: string }[] = [
  { slot: "QB", count: 1, note: "Quarterback" },
  { slot: "RB", count: 2, note: "Running Back" },
  { slot: "WR", count: 2, note: "Wide Receiver" },
  { slot: "FLEX", count: 2, note: "RB / WR / TE" },
  { slot: "TE", count: 1, note: "Tight End" },
  { slot: "DST", count: 1, note: "Team Defense / Special Teams" },
];

/**
 * Starting slots this league fills AFTER the draft, off waivers, as a matter of
 * routine — so leaving one open on draft night is a plan, not a hole.
 *
 * ============================================================================
 * THIS IS A COMMISSIONER'S RULING AND IT OVERRIDES THE ARITHMETIC.
 * ============================================================================
 *
 * `STARTING_LINEUP` says the league starts one DST, and every roster check that
 * counts filled slots will therefore report a franchise that drafted none as
 * unable to field a legal nine. That count is correct and the conclusion drawn
 * from it is not. Team defences are streamed here: the position turns over on
 * waivers every week, the drop-off between the best defence and the twentieth is
 * a rounding error next to a flex slot, and spending a sixteenth-round pick on
 * one is the cheapest thing on the board to replace. Two managers went into 2026
 * without one on purpose and picked defences up in the days after the draft.
 *
 * The recap docked them for it, and the commissioner overruled it: "DST will be
 * picked up after the draft. And he has a point." A grade that marks a man down
 * for declining to spend a pick on a position he can have for free a week later
 * is the same error as `penalises-defensible-decline` — the page holding a
 * correct decision against the man who made it.
 *
 * This is deliberately NOT the same rule as `sharedByFranchises === ofFranchises`.
 * That one says a hole everybody shares is a stage of the draft; it goes quiet
 * the moment eight of ten franchises fill the slot, which is exactly what
 * happened here. A post-draft slot is not a deficiency at ANY share.
 */
export const POST_DRAFT_STARTER_SLOTS: readonly string[] = ["DST"];

/**
 * Whether a starting slot is one the league routinely fills off waivers.
 *
 * Takes a lineup-card LABEL as well as a bare slot name. `lineupSlots` drops the
 * index where the league starts exactly one of something, so today's label is
 * "DST" and this would be a plain lookup — but it is "DST1" the day anybody sets
 * the count to 2, and a silent miss there would put the docking back with no
 * test failing. Stripping the index costs a regex and removes that trap.
 */
export function isPostDraftSlot(slot: string): boolean {
  const base = slot.replace(/\d+$/, "").toUpperCase();
  return POST_DRAFT_STARTER_SLOTS.includes(base);
}

/**
 * @fromEspn 9 starters + 7 bench + 1 IR. The `Roster` sheet in
 * `2026 DRAFT.xlsx` agrees on 7 bench, and 9 + 7 = 16 is the only figure that
 * reconciles with a 16-round draft. The Smart Draft room's `BN: 5` is simply
 * misconfigured and is not used here.
 */
export const ROSTER = {
  starters: 9,
  bench: 7,
  irSlots: 1,
  activeCap: 16,
  /**
   * @fromEspn `positionLimits` — the most players of a position a franchise may
   * roster at once. K is absent because the K limit is 0 and this league has no
   * kicker slot, so a kicker cannot be rostered at all.
   */
  positionalMax: { QB: 4, RB: 8, WR: 9, TE: 3, DST: 3 } as Record<string, number>,
} as const;

export const IR_ELIGIBILITY: { designation: string; eligible: boolean; note: string }[] = [
  { designation: "Injured Reserve (IR)", eligible: true, note: "Eligible for IR / Reserve slot" },
  { designation: "Physically Unable to Perform (PUP)", eligible: true, note: "Eligible for IR / Reserve slot" },
  { designation: "Non-Football Injury (NFI)", eligible: true, note: "Eligible for IR / Reserve slot" },
  { designation: "Out (O)", eligible: true, note: "Eligible for IR / Reserve slot" },
  { designation: "Suspended (SUSP)", eligible: false, note: "Must occupy an active roster or bench slot" },
  { designation: "Questionable / Doubtful / Bye / Healthy Scratch", eligible: false, note: "Not eligible for IR / Reserve" },
];

// --- Draft ------------------------------------------------------------------

/**
 * Offline, in-person draft.
 *
 * @fromSmartDraft rounds and snake come from the live room (160 slots over
 * 10 teams, `draftFormat: "snake"`).
 */
export const DRAFT = {
  /** Number of rounds. Board size = rounds × LEAGUE.teams = 160. @fromEspn 16. */
  rounds: 16,
  /** @fromEspn Snake confirmed — ESPN's own board reverses every other round. */
  snake: true,
  /**
   * Advisory pick clock in seconds, shown in the draft room. The draft is run
   * in person, so nothing is auto-advanced when it expires. Smart Draft has no
   * pick timer set (`pickTimerSeconds: null`) and ESPN's 90 s
   * `timePerSelection` applies to an online draft this league never runs, so
   * neither is evidence for what the room should be told.
   * @placeholder
   */
  clockSeconds: 120,
  /** @placeholder Hours before the draft that keeper declarations lock. */
  keeperLockHoursBeforeDraft: 48,
  /**
   * Draft day, local date only — the start time is not settled yet.
   *
   * @placeholder The app has carried the string "Saturday, Aug 29" as dashboard
   * copy for a while; 2026-08-29 is in fact a Saturday, so this encodes what was
   * already being asserted rather than introducing a new claim. It drives the
   * countdown and the keeper-declaration lock, so **confirm it with the
   * commissioner before the countdown is quoted to managers.**
   */
  date: "2026-08-29",
} as const;

/**
 * Whole days from today until draft day, floor 0. Date-only arithmetic in local
 * time: a countdown that flips at midnight is what a manager expects, and the
 * draft's start time is not known anyway.
 */
export function daysUntilDraft(now: Date = new Date()): number {
  const [y, m, d] = DRAFT.date.split("-").map(Number);
  const draftDay = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((draftDay.getTime() - today.getTime()) / 86_400_000);
  return Math.max(0, days);
}

/** "Saturday, Aug 29" — draft day for headings and body copy. */
export function draftDayLabel(): string {
  const [y, m, d] = DRAFT.date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/** Total pick slots on the board. Derived — do not hardcode. */
export const TOTAL_PICKS: number = DRAFT.rounds * LEAGUE.teams;

// --- Keepers ----------------------------------------------------------------

/**
 * Keepers are ACTIVE. The clock semantics live in `@/lib/keeper-clock` — this
 * block is only the tunable numbers.
 *
 * ESPN cannot corroborate any of this: its keeper feature has been switched off
 * for five straight seasons and its data model has no keeper-duration field at
 * all, so this app is the league's system of record for keepers. The evidence
 * is the trade agreement and the historical keeper sheets.
 */
export const KEEPERS_ACTIVE_FOR_CURRENT_SEASON = FEATURES.keepers;

export const KEEPERS = {
  /** @fromContract "two keepers per team", automatically redrafted. */
  maxPerTeam: 2,
  /**
   * @fromContract KEEPER SEASONS, not seasons of tenure — see the note on
   * counting conventions in `@/lib/keeper-clock`. The contract's "up to three
   * (3) consecutive seasons" counts the season the player was acquired, so a
   * franchise gets him the year he is drafted and may then KEEP him for the two
   * following seasons. Two is therefore the right number here.
   */
  maxConsecutiveSeasons: 2,
  /**
   * @ruling Aug 26 2026 — NO. A player who occupied a round-1 slot last season
   * cannot be kept, so **every first-round pick is a one-year rental**. Offered
   * the choice between flooring the cost at a 1st, ineligibility, and a forfeit
   * penalty, the commissioner chose ineligibility and separately confirmed that
   * full consequence. He reports the league already plays this way, which the
   * data supports: ten managers held a round-1 player going into 2026 and not
   * one declared him.
   *
   * This was the "round 0" open question. Enforced in `@/lib/keeper-clock` by
   * `occupiedRound1`, keyed on the round OCCUPIED rather than the original draft
   * round, so it catches a round-2 pick who was kept down to a first as well.
   */
  round1Eligible: false,
  /**
   * @fromContract "a free-agent acquisition costs the 9th round" — the cost in
   * his first keeper season. Equivalent to treating an undrafted player as
   * having been drafted in round 10 and applying the −1 rule once.
   */
  undraftedDefaultRound: 9,
  /** @fromContract The 9th-round basis with the −1 rule applied a second time. */
  undraftedYear2Round: 8,
  /**
   * @fromContract "cost round = one round lower than the player's draft round
   * the previous season". Applied ONCE per season against last season's round,
   * which is why the escalation is not multiplied by the keeper year.
   */
  costRoundEscalationPerSeason: 1,
  /** No keeper fees in this league — the previous league's fee model is gone. */
  fees: false,
} as const;

// --- Scoring ----------------------------------------------------------------

export type ScoringRow = { category: string; value: string; note: string };

/**
 * @fromEspn Full PPR — one point per reception, confirmed against the league's
 * own ESPN settings and matching the Smart Draft room's `scoringFormat: "PPR"`.
 */
export const SCORING_FORMAT = "PPR" as const;

/**
 * @fromEspn Every value below is the league's real ESPN setting, identical in
 * 2022, 2023, 2024, 2025 and 2026. Full decode in
 * `data/espn/espn-scoring-settings.json`.
 *
 * The one that matters on draft day is the passing touchdown: this league pays
 * **6**, not ESPN's 4-point default. No public ADP feed prices that in, so
 * quarterbacks are systematically cheap on any imported ranking.
 */
export const BASE_SCORING: ScoringRow[] = [
  { category: "Passing Yards", value: "0.04", note: "1 point per 25 yards" },
  { category: "Rushing Yards", value: "0.1", note: "1 point per 10 yards" },
  { category: "Receiving Yards", value: "0.1", note: "1 point per 10 yards" },
  { category: "Reception", value: "1.0", note: "Full PPR" },
  { category: "Passing TD", value: "6", note: "Six, not ESPN's 4-point default — raises QB value" },
  { category: "Rushing TD", value: "6", note: "" },
  { category: "Receiving TD", value: "6", note: "" },
  { category: "2-Point Conversion", value: "2", note: "Passing, rushing, or receiving" },
];

export const TURNOVER_SCORING: ScoringRow[] = [
  { category: "Interception Thrown", value: "−2", note: "" },
  { category: "Fumble Lost", value: "−2", note: "" },
  { category: "Fumble Recovered for TD", value: "6", note: "" },
  { category: "D/ST Touchdown", value: "6", note: "Interception, fumble, kickoff, punt, or blocked kick" },
  { category: "D/ST Sack", value: "1", note: "" },
  { category: "D/ST Takeaway", value: "2", note: "Interception, fumble recovery, blocked kick, or safety" },
  { category: "D/ST Points Allowed", value: "5 → −5", note: "Tiered: 5 at a shutout down to −5 at 46+" },
  { category: "D/ST Yards Allowed", value: "5 → −7", note: "Tiered: 5 under 100 yards down to −7 at 550+" },
];

/**
 * @fromEspn CONFIRMED EMPTY, not unknown. ESPN carries no yardage-milestone and
 * no long-play bonuses in any season checked, so these arrays are the league's
 * real configuration rather than a gap waiting to be filled.
 */
export const MILESTONE_BONUSES: ScoringRow[] = [];
export const EXPLOSIVE_BONUSES: ScoringRow[] = [];

export const SCORING_EXCLUSIONS: string[] = [
  "No kicker — ESPN has both the K lineup slot and the K roster limit at 0, so no kicker can be rostered. Kicker point values still exist in ESPN but are inert.",
  "No yardage milestone bonuses — confirmed absent in ESPN, not merely unconfirmed.",
  "No explosive / long-play bonuses — confirmed absent in ESPN.",
  "No tiebreaker bonus — matchup ties stand, and there is no home-team bonus.",
];

/** @fromEspn Machine-readable scoring spec stored in scoring_config.spec. */
export const SCORING_SPEC = {
  kicker: false,
  ppr: 1,
  passYardsPerPoint: 25,
  rushRecYardsPerPoint: 10,
  passTd: 6,
  rushTd: 6,
  recTd: 6,
  interceptionThrown: -2,
  fumbleLost: -2,
  twoPointConversion: 2,
  milestoneBonuses: false,
  explosiveBonuses: false,
} as const;

// --- Trades -----------------------------------------------------------------

/**
 * Traded picks AND traded players are central to this league.
 *
 * @placeholder How far out picks may be traded, and whether counts must balance.
 */
export const TRADES = {
  /**
   * @fromEspn ESPN's deadline is 2026-11-20T08:00Z — 02:00 Central on Friday
   * Nov 20, which falls inside week 11 (Nov 19–23), not week 12. The mid-week
   * timing is odd and worth confirming, but the week number is not in doubt.
   */
  deadlineWeek: 11,
  /**
   * How many future seasons of draft picks may be traded. 1 means "this season
   * and next". Set above 0 because pick trading is a real part of this league.
   */
  futurePicksSeasonsOut: 1,
  /**
   * Picks do NOT have to net to zero per team. This league lets a franchise end
   * up with more or fewer picks than anyone else, so the board must tolerate an
   * uneven distribution.
   */
  requirePickCountBalance: false,
  reviewHours: 0,
} as const;

// --- Governance -------------------------------------------------------------

/** @placeholder Voting thresholds need confirming. */
export const VOTING_THRESHOLDS: { decision: string; approval: string; examples: string }[] = [
  { decision: "Officer Election", approval: "Simple majority", examples: "Placeholder — confirm" },
  { decision: "Standard Rule Change", approval: "Simple majority", examples: "Placeholder — confirm" },
  { decision: "Major Structural Change", approval: "Two-thirds of active managers", examples: "Scoring, keeper system, roster format" },
  { decision: "Manager Removal", approval: "Two-thirds excl. manager under review", examples: "Placeholder — confirm" },
];

/** @placeholder Officer roles need confirming. */
export const OFFICERS: { role: string; responsibilities: string }[] = [
  { role: "Commissioner", responsibilities: "Runs the league, sets ESPN settings, draft logistics, resolves disputes." },
  { role: "Vice Commissioner", responsibilities: "Placeholder — confirm whether this league has one." },
];

// --- Preseason checklist ----------------------------------------------------

/** @placeholder Rewritten generically; confirm against how this league runs. */
export const PRESEASON_CHECKLIST: string[] = [
  `Confirm ${LEAGUE.teams} active managers and their franchise names.`,
  "Confirm the keeper list and each keeper's cost round.",
  "Confirm the draft order and record any traded picks.",
  `Configure roster slots and scoring in ${LEAGUE.platform} (no kicker).`,
  "Confirm draft date, time, and location.",
  "Publish the final keeper list and draft board before the draft.",
  "Confirm waiver rules and the in-season trade deadline.",
];

// --- Platform settings reference --------------------------------------------

/**
 * Mirror of what is configured on ESPN. Every line except the keeper row was
 * read back off the live league, so this is a record rather than a to-do list.
 * Keepers are the exception: ESPN has its keeper feature switched off and
 * cannot represent the clock, so that row describes what this app enforces.
 */
export const PLATFORM_SETTINGS: { area: string; configuration: string }[] = [
  { area: "League", configuration: `${LEAGUE.teams} teams; keepers active; ${LEAGUE.platform}` },
  { area: "Draft", configuration: `${DRAFT.snake ? "Snake" : "Linear"} draft; ${DRAFT.rounds} rounds; run in person` },
  { area: "Starting Lineup", configuration: STARTING_LINEUP.map((s) => `${s.count} ${s.slot}`).join(", ") + "; 0 K" },
  { area: "Bench / IR", configuration: `${ROSTER.bench} bench; ${ROSTER.irSlots} IR slot` },
  {
    area: "Position Limits",
    configuration: Object.entries(ROSTER.positionalMax)
      .map(([pos, max]) => `${pos} ${max}`)
      .join(", "),
  },
  { area: "Scoring", configuration: `${SCORING_FORMAT}; 6-point passing TD; no kicker` },
  { area: "Playoffs", configuration: `${LEAGUE.playoffTeams} teams; weeks ${LEAGUE.playoffWeeks[0]}–${LEAGUE.playoffWeeks[1]}` },
  {
    area: "Keepers",
    configuration: `${KEEPERS.maxPerTeam} max per team; ${KEEPERS.maxConsecutiveSeasons + 1} seasons of tenure (acquisition year + ${KEEPERS.maxConsecutiveSeasons} keeper seasons); no fees — tracked here, not on ${LEAGUE.platform}`,
  },
  { area: "Trades", configuration: `Players and picks; deadline week ${TRADES.deadlineWeek}` },
];

// --- Calendar ---------------------------------------------------------------

export type CalendarEvent = {
  key: string;
  label: string;
  description: string;
  article: string;
};

/** @placeholder Dates are not encoded here — only the shape of the calendar. */
export const CALENDAR_EVENTS: CalendarEvent[] = [
  { key: "trade_window_open_offseason", label: "Offseason trade window opens", description: "Placeholder — confirm timing.", article: "TBD" },
  { key: "keeper_lock", label: "Keeper declarations lock", description: `Placeholder — ${DRAFT.keeperLockHoursBeforeDraft}h before the draft.`, article: "TBD" },
  { key: "board_publish", label: "Final keeper list + draft board published", description: "Placeholder — confirm timing.", article: "TBD" },
  { key: "draft", label: "Annual draft", description: `In-person ${DRAFT.snake ? "snake" : "linear"} draft, ${DRAFT.rounds} rounds.`, article: "TBD" },
  { key: "trade_window_reopen", label: "Trade window reopens", description: "Immediately after the draft completes.", article: "TBD" },
  { key: "waivers_weekly", label: "Weekly waiver processing", description: "Placeholder — confirm day and time.", article: "TBD" },
  { key: "trade_deadline", label: "In-season trade deadline", description: `Placeholder — end of week ${TRADES.deadlineWeek}.`, article: "TBD" },
];

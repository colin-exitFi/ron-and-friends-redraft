/**
 * Ron and Friends — single source of truth for league configuration.
 *
 * Every value the app derives behaviour from lives here, so the whole league
 * can be re-pointed from one place.
 *
 * Provenance markers, most authoritative first:
 *
 *  `@fromProposal`  — stated in "Ron & Friends — 2026 Season Proposal", the
 *                     league's ratified ruleset. The document says it controls
 *                     where it and Sleeper disagree.
 *  `@fromSleeper`   — read from the live Sleeper league (1394372619427381248)
 *                     by `npm run pull:sleeper`. The extracts live in
 *                     `data/sleeper/`. Sleeper is what actually scores the
 *                     season, so it is the check on the document.
 *  `@fromCommissioner` — a ruling that overrides both of the above.
 *
 * ============================================================================
 * THE ONE PLACE THE DOCUMENT AND THE LEAGUE DISAGREE: TEAM COUNT.
 * ============================================================================
 * The proposal says twelve teams throughout — the lottery odds table, the
 * $1,800 base pool and the six-plus-six playoff/Toilet Bowl split are all built
 * on twelve. The league shrank to TEN after the document was written, Sleeper
 * reports ten rosters, and the commissioner has ruled ten. Ten wins everywhere
 * in this file. The twelve-team artifacts in the document are stale rather than
 * contradictory, and none of them are draft-board concerns.
 */

// --- Identity ---------------------------------------------------------------

export const LEAGUE = {
  /** @fromSleeper The Sleeper league's own name. */
  name: "Ron and Friends",
  /** Short wordmark used in the sidebar and page titles. */
  shortName: "Ron & Friends",
  /** @fromProposal "Fantasy Football League — Redraft". */
  tagline: "Fantasy Football · Redraft",
  /**
   * @fromCommissioner TEN, not the document's twelve. See the header note —
   * `total_rosters` is 10 on Sleeper and the commissioner has confirmed it.
   */
  teams: 10,
  /** @fromSleeper `season`. */
  currentSeason: 2026,
  /** @fromProposal Sleeper is the system of record for the season itself. */
  platform: "Sleeper",
  /** @fromProposal Regular season Weeks 1–14. */
  regularSeasonWeeks: [1, 14] as const,
  /** @fromProposal Playoffs Weeks 15–17. @fromSleeper `playoff_week_start` 15. */
  playoffWeeks: [15, 17] as const,
  /** @fromProposal Six playoff teams. @fromSleeper `playoff_teams` 6. */
  playoffTeams: 6,
  /** @fromSleeper The league this app reads. Public identifier, not a secret. */
  sleeperLeagueId: "1394372619427381248",
} as const;

/** The season the app reads and writes by default. */
export const CURRENT_SEASON: number = LEAGUE.currentSeason;

// --- Franchises -------------------------------------------------------------

/**
 * The ten franchises, keyed by the short name the board prints in a cell.
 *
 * @fromSleeper Every id, draft slot and franchise name is read from
 * `/league/{id}/users` and `/draft/{id}`; the join lives in
 * `data/managers.json`, which is the file to edit.
 *
 * MANAGER NAMES ARE NOT SLEEPER'S TO GIVE. The API carries handles and optional
 * team names and no real names at all, so the names below cannot come from the
 * pull. They were the commissioner's own transcription on 2026-09-05 and are no
 * longer guesses derived from the handle.
 *
 * THIS LIST IS A SECOND COPY AND MUST BE KEPT IN STEP WITH
 * `data/managers.json`. `league-json.ts` does read the file and fall back here
 * only for a missing field, but `recap-grade.ts` and `verify-recap-clean.mts`
 * import `FRANCHISES` directly, so a short name left stale here reaches the
 * recap even when the JSON is correct. Edit the JSON first, then mirror it.
 *
 * Two entries are deliberately asymmetric: slot 10 prints `Dre` but the manager
 * is Andrew, and slot 7 prints `Colin` though the franchise is CullenGPT.
 *
 * Unlike the previous league, no two managers share a first name, so short
 * names are unambiguous.
 */
export type Franchise = {
  /** Board cell label and the join key across every data source. */
  shortName: string;
  franchiseName: string;
  abbrev: string;
  manager: string;
};

export const FRANCHISES: Franchise[] = [
  { shortName: "Steve", franchiseName: "Mahomies", abbrev: "MAH", manager: "Steve" },
  { shortName: "Dennis", franchiseName: "dennisphinney", abbrev: "DEN", manager: "Dennis" },
  { shortName: "Chris", franchiseName: "BigboofieBiff", abbrev: "BIF", manager: "Chris" },
  { shortName: "Scott", franchiseName: "ScottBrennanstl", abbrev: "SCO", manager: "Scott" },
  { shortName: "Nick", franchiseName: "LeCapitalG", abbrev: "LCG", manager: "Nick" },
  { shortName: "Tom", franchiseName: "TopNotchTom", abbrev: "TNT", manager: "Tom" },
  { shortName: "Colin", franchiseName: "CullenGPT", abbrev: "CGP", manager: "Colin Tracy" },
  { shortName: "Ryan", franchiseName: "ChillyWonka", abbrev: "CHW", manager: "Ryan" },
  { shortName: "Keith", franchiseName: "JollyRushers", abbrev: "JOL", manager: "Keith" },
  { shortName: "Dre", franchiseName: "GizzyDillespie", abbrev: "GIZ", manager: "Andrew" },
];

const FRANCHISES_BY_SHORT_NAME = new Map(FRANCHISES.map((f) => [f.shortName.toLowerCase(), f]));

/** Look up a franchise by the short name the board and the snapshot use. */
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
  /**
   * @fromProposal Section 10 — the keeper framework is written and deliberately
   * NOT activated for 2026. 2026 is a pure redraft.
   *
   * KEEPERS ARE TURNED OFF IN THE DATA, WHICH IS THE LAYER THAT DECIDES. The
   * board pre-places keepers from `data/keeper-declarations.json` and friends
   * via `applyKeeperOverlay`; those files are empty, so nothing is placed and
   * every one of the `TOTAL_PICKS` cells is open. This flag gates SURFACES only.
   */
  keepers: false,
  /**
   * The draft-notes surface: a scribe's account of the night, typed up and
   * matched to picks. The previous league had somebody who did that all night
   * and read it back to the room. Ron and Friends does not, so the surface is
   * hidden — the route and the code stay, and this is the switch.
   */
  draftNotes: false,
  /** Dues, transaction fees and payouts are tracked outside this app for now. */
  treasury: false,
  /** @fromProposal 2026 order was drawn by lottery; the result is already set. */
  lottery: false,
  /** Sleeper is read-only — settings come in, picks do not go out. */
  platformSync: false,
  /**
   * @fromProposal Section 6 — "No draft-pick trading. This is a redraft league;
   * only current-season players and FAAB may be traded." Every board slot is
   * therefore owned by the franchise it was born to.
   */
  tradedPicks: false,
  /** The draft is run in this app, in the room. The clock is advisory. */
  offlineDraft: true,
} as const;

// --- Roster -----------------------------------------------------------------

/**
 * Starting lineup. NO KICKER — @fromProposal Section 2 sets K to 0 slots, and
 * @fromSleeper the league's `roster_positions` contains no K at all, so a
 * kicker cannot be started.
 *
 * @fromSleeper Exact match to the draft's `slots_*` settings.
 * The ORDER is the league's own: a lineup card reads QB, RB, WR, FLEX, TE, DST.
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
 * Team defences are streamed: the position turns over on waivers every week and
 * spending a last-round pick on one is the cheapest thing on the board to
 * replace. A live waiver market is what makes that true, and it still is.
 *
 * THE OLD REASONING HERE IS RETIRED. This used to argue from "only five bench
 * spots", which was a twelve-team constraint meant to thin the free-agent pool
 * and force fee-paying transactions. The commissioner retired it on 2026-09-05:
 * at ten teams the pool is comfortable and the transactions happen anyway. The
 * bench is six, and streaming a defence is a choice rather than a squeeze.
 */
export const POST_DRAFT_STARTER_SLOTS: readonly string[] = ["DST"];

/**
 * Whether a starting slot is one the league routinely fills off waivers.
 *
 * Takes a lineup-card LABEL as well as a bare slot name: `lineupSlots` drops the
 * index where the league starts exactly one of something, so today's label is
 * "DST" — but it would be "DST1" the day anybody sets the count to 2, and a
 * silent miss there would be invisible. Stripping the index removes that trap.
 */
export function isPostDraftSlot(slot: string): boolean {
  const base = slot.replace(/\d+$/, "").toUpperCase();
  return POST_DRAFT_STARTER_SLOTS.includes(base);
}

/**
 * @fromCommissioner 2026-09-05 — 9 starters + 6 bench = 15 active, plus 2 IR.
 *
 * THE SIXTH BENCH SPOT SUPERSEDES THE PROPOSAL AND SLEEPER. Section 2 said 5
 * bench and Sleeper's `slots_bn` still said 5 when it was last pulled. The
 * commissioner raised it to 6 on the afternoon of the draft.
 *
 * His reasoning is the load-bearing part, because it retires an argument rather
 * than just changing a number: the five-bench rule was designed for a TWELVE
 * team league, to keep the free-agent pool thin and force transactions, which
 * grew the pot through $1-per-move fees. At ten teams the pool is comfortable
 * anyway and the transactions will happen regardless, so the constraint has
 * lost its purpose. The old "roster construction is self-policing with only
 * five bench spots" rationale is therefore OBSOLETE — it must not survive as
 * stale copy anywhere.
 *
 * 15 is also exactly the round count, which is what makes a 15-round draft fill
 * every active seat. `positionalMax` is deliberately empty rather than unknown:
 * there are still no positional maximums.
 */
export const ROSTER = {
  starters: 9,
  bench: 6,
  irSlots: 2,
  activeCap: 15,
  positionalMax: {} as Record<string, number>,
} as const;

/** @fromProposal Section 2 — IR, PUP, NFI and Out are eligible; nothing else. */
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
 * @fromCommissioner 2026-09-05 — fifteen rounds, snake, 120-second clock.
 *
 * THE ROUND COUNT SUPERSEDES BOTH THE PROPOSAL AND SLEEPER. Section 4 said
 * "Snake draft; fourteen (14) rounds" and Sleeper's `rounds` read 14 when it
 * was last pulled. The commissioner moved it to 15 on draft afternoon so the
 * board fills the sixth bench spot, and he is editing Sleeper by hand.
 *
 * SO A FRESH SLEEPER PULL MAY STILL SAY 14. That is him not having saved yet,
 * not a conflict to resolve, and this file must NOT be "corrected" back to 14
 * on the strength of it. Sleeper does have to say 15 before kickoff, because
 * Sleeper is what runs the clock in the room tonight.
 *
 * `type` snake and `pick_timer` 120 are unchanged and still agree everywhere.
 */
export const DRAFT = {
  /** Board size = rounds × LEAGUE.teams = 150. */
  rounds: 15,
  snake: true,
  /**
   * The room drafts in person off this board, so the clock is advisory:
   * nothing is auto-advanced and nothing is auto-picked when it expires.
   */
  clockSeconds: 120,
  /** No keepers in 2026, so nothing locks. Retained for a future keeper season. */
  keeperLockHoursBeforeDraft: 48,
  /** @fromSleeper The draft's `start_time` — Saturday 5 Sep 2026, 7:30pm local. */
  date: "2026-09-05",
} as const;

/**
 * Whole days from today until draft day, floor 0. Date-only arithmetic in local
 * time: a countdown that flips at midnight is what a manager expects.
 */
export function daysUntilDraft(now: Date = new Date()): number {
  const [y, m, d] = DRAFT.date.split("-").map(Number);
  const draftDay = new Date(y, m - 1, d);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((draftDay.getTime() - today.getTime()) / 86_400_000);
  return Math.max(0, days);
}

/** "Saturday, Sep 5" — draft day for headings and body copy. */
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
 * NOT ACTIVE FOR 2026.
 *
 * @fromProposal Section 10 — a complete keeper framework exists for this league
 * and is deliberately not switched on: "If the league wants to layer keepers on
 * for 2027, the framework gets proposed in the offseason with real lead time
 * and a proper vote. Until then: pure redraft, clean and simple."
 *
 * The numbers below are therefore a PLACEHOLDER for a rule set that has not
 * been voted on. They keep the keeper modules compiling and are not used by any
 * live surface, because the keeper data files are empty and nothing is placed
 * on the board. Do not quote them to a manager as this league's keeper rules —
 * they are the previous league's, retained only so the machinery still builds.
 */
export const KEEPERS_ACTIVE_FOR_CURRENT_SEASON = FEATURES.keepers;

export const KEEPERS = {
  maxPerTeam: 2,
  maxConsecutiveSeasons: 2,
  round1Eligible: false,
  undraftedDefaultRound: 9,
  undraftedYear2Round: 8,
  costRoundEscalationPerSeason: 1,
  fees: false,
} as const;

// --- Scoring ----------------------------------------------------------------

export type ScoringRow = { category: string; value: string; note: string };

/**
 * HALF-PPR, WITH A TIGHT END PREMIUM.
 *
 * @fromProposal Section 3. @fromSleeper `rec` 0.5 and `bonus_rec_te` 0.5.
 *
 * THE WHOLE SCORING SECTION BELOW WAS REBUILT FROM A LIVE PULL ON 2026-09-05,
 * after the commissioner re-saved his settings on Sleeper. Every one of the
 * fifty-five keys in `scoring_settings` was walked: it is either a row in one of
 * the tables below or a named line in `SCORING_EXCLUSIONS`. Where the document
 * and the platform describe the same points differently — the yardage bonuses —
 * the platform's model wins, because the platform is what pays out.
 *
 * ============================================================================
 * TWO THINGS NO PUBLIC ADP FEED PRICES IN. BOTH MATTER ON DRAFT DAY.
 * ============================================================================
 *  1. THE TIGHT END PREMIUM. A tight end catches at a full point here and
 *     everywhere else at half, so a TE is worth materially more to this league
 *     than to the market that produced the rankings on the board. Tight ends
 *     will look expensive when they are fairly priced, and the board will call
 *     a correct TE pick a reach. It is not one.
 *  2. THE SIX-POINT PASSING TOUCHDOWN. Most consensus ADP assumes four, so
 *     quarterbacks read cheap on any imported ranking — the same caveat the
 *     previous league carried, and for the same reason.
 *
 * The ADP column is a market price, not this league's price. Read it knowing
 * which way each of those two pushes.
 */
export const SCORING_FORMAT = "Half PPR (TE premium)" as const;

/**
 * The scope the FantasyPros pull asks for. Half-PPR is what this league plays,
 * so it is what the ADP should be scoped to; `getPoolScoringFormat()` surfaces
 * whatever the committed snapshot was actually pulled at, so a mis-scoped pool
 * is visible in the UI rather than silently wrong.
 */
export const ADP_SCORING_SCOPE = "HALF" as const;

/** @fromProposal 3.1 Base Offense. @fromSleeper exact match on all nine. */
export const BASE_SCORING: ScoringRow[] = [
  { category: "Passing Yards", value: "0.05", note: "1 point per 20 yards" },
  { category: "Rushing Yards", value: "0.1", note: "1 point per 10 yards" },
  { category: "Receiving Yards", value: "0.1", note: "1 point per 10 yards" },
  { category: "Reception", value: "0.5", note: "Half PPR — every position catches at 0.5" },
  { category: "Tight End Reception", value: "1.0", note: "0.5 base plus a 0.5 TE premium — no ADP feed prices this" },
  { category: "Passing TD", value: "6", note: "Six, not the 4-point default — raises QB value" },
  { category: "Rushing TD", value: "6", note: "" },
  { category: "Receiving TD", value: "6", note: "" },
  { category: "2-Point Conversion", value: "2", note: "Passing, rushing or receiving — 2 for each" },
];

/**
 * @fromProposal 3.2 Turnovers & Ball Security. The two "additional" rows are
 * increments on the row above, not standalone values — a pick-six costs the
 * quarterback 6 in total and an ordinary lost fumble costs 2.
 *
 * @fromSleeper `pass_int` −2, `pass_int_td` −4, `fum` −1, `fum_lost` −1,
 * `fum_rec_td` 0.
 *
 * TEAM DEFENCE USED TO LIVE IN THIS ARRAY and now has its own, below. Mixing
 * them meant the six D/ST rows were read as a footnote to the quarterback's
 * turnovers, which is how the points-allowed ladder ended up compressed into a
 * single "10 → −4" cell nobody could draft against.
 */
export const TURNOVER_SCORING: ScoringRow[] = [
  { category: "Interception Thrown", value: "−2", note: "Applies to the passer" },
  { category: "Pick-Six (INT returned for TD)", value: "additional −4", note: "Total QB penalty on a pick-six: −6" },
  { category: "Fumble", value: "−1", note: "Any credited fumble" },
  { category: "Fumble Lost", value: "additional −1", note: "Ordinary lost fumble total: −2" },
  { category: "Offensive Fumble Recovered for TD", value: "0", note: "Explicitly zero on Sleeper — falling on a loose ball in the end zone pays nothing" },
];

/**
 * TEAM DEFENCE, WITH THE REAL NUMBERS RATHER THAN "SLEEPER DEFAULTS".
 *
 * Every row below was read off the live league's `scoring_settings` on
 * 2026-09-05, after the commissioner re-saved his scoring. The page used to
 * gloss five of them as "Sleeper default", which told a manager nothing and
 * would have gone stale silently the moment one of them was edited.
 *
 * @fromSleeper `sack` 1, `int` 2, `fum_rec` 2, `ff` 1, `safe` 2, `blk_kick` 2,
 * `def_td` 6, `def_st_td` 6, `def_st_ff` 1, `def_st_fum_rec` 1.
 *
 * The three `st_*` keys (`st_td` 6, `st_ff` 1, `st_fum_rec` 1) are the same
 * special-teams events credited to an INDIVIDUAL player rather than to the
 * defence — the wide receiver who returns the punt, not the unit. They pay the
 * same, so they are folded into the rows below rather than doubled up.
 */
export const DST_SCORING: ScoringRow[] = [
  { category: "Sack", value: "1", note: "" },
  { category: "Interception", value: "2", note: "" },
  { category: "Fumble Recovery", value: "2", note: "" },
  { category: "Forced Fumble", value: "1", note: "Paid on top of the recovery when the same unit gets both" },
  { category: "Safety", value: "2", note: "" },
  { category: "Blocked Kick", value: "2", note: "" },
  { category: "Defensive Touchdown", value: "6", note: "Interception or fumble returned for a score" },
  { category: "Special Teams Touchdown", value: "6", note: "Kickoff, punt or blocked-kick return — same 6 to a player who returns one" },
  { category: "Special Teams Forced Fumble", value: "1", note: "On a kick or punt return" },
  { category: "Special Teams Fumble Recovery", value: "1", note: "On a kick or punt return" },
];

/**
 * THE POINTS-ALLOWED LADDER, ALL SEVEN RUNGS.
 *
 * This is what the page was getting wrong. It carried a single row reading
 * "10 → −4" with a note that named the shutout, the zero band and the floor —
 * so the extremes were visible and the four bands in between were not. A
 * scoring page that shows a manager the top and bottom of a ladder and asks him
 * to infer the middle is worse than one that shows nothing, because he will
 * guess and he will be confident.
 *
 * @fromSleeper `pts_allow_0` 10, `pts_allow_1_6` 7, `pts_allow_7_13` 4,
 * `pts_allow_14_20` 1, `pts_allow_21_27` 0, `pts_allow_28_34` −1,
 * `pts_allow_35p` −4. Pulled live on 2026-09-05 and identical, band for band,
 * to the ladder the commissioner read out of the platform himself.
 *
 * THERE IS NO YARDS-ALLOWED SCORING. The live payload has no `yds_allow_*` key
 * of any kind, and the page used to claim in its own subtitle that "points and
 * yards allowed are scored on Sleeper's tiered bands". Only points are.
 */
export const DST_POINTS_ALLOWED: ScoringRow[] = [
  { category: "0 (shutout)", value: "10", note: "" },
  { category: "1–6", value: "7", note: "" },
  { category: "7–13", value: "4", note: "" },
  { category: "14–20", value: "1", note: "" },
  { category: "21–27", value: "0", note: "The neutral band — a defence that allows this scores nothing either way" },
  { category: "28–34", value: "−1", note: "" },
  { category: "35+", value: "−4", note: "No further floor — 35 and 60 cost the same" },
];

/**
 * @fromProposal 3.3 Bonuses. THE PREVIOUS LEAGUE HAD NONE OF THESE — its
 * milestone and explosive arrays were empty and documented as confirmed absent,
 * so this is the single largest scoring difference between the two leagues.
 *
 * @fromSleeper `bonus_pass_yd_300` 1, `bonus_pass_yd_400` 1,
 * `bonus_rush_yd_100` 1, `bonus_rush_yd_200` 1, `bonus_rec_yd_100` 1,
 * `bonus_rec_yd_200` 1. All six are ONE point.
 *
 * ============================================================================
 * THESE STACK. THEY ARE NOT TIERS, AND THE PAGE USED TO SAY THEY WERE.
 * ============================================================================
 * The old rows read +1 and +2 with the note "total, not cumulative", which is
 * the phrasing the ruleset PDF uses. It arrives at the right number — a 410-yard
 * game is worth 2 — but it describes a ladder where the higher rung REPLACES the
 * lower one, and that is not what Sleeper does or how the commissioner thinks
 * about it. Sleeper stores six independent one-point increments and pays both
 * when both are earned: 410 yards clears 300 for +1 and clears 400 for another
 * +1. Same total, different model.
 *
 * The distinction is not pedantic. Read as tiers, "+2 at 400" invites the guess
 * that 200 rushing yards is worth 2 and 100 is worth 1, so the second hundred is
 * worth as much as the first. Read as increments, it is plain that the bonus for
 * the second hundred is the same single point as the first. He asked for the
 * increments, so the increments are what render.
 */
export const MILESTONE_BONUSES: ScoringRow[] = [
  { category: "Passing 300–399 yards", value: "+1", note: "" },
  { category: "Passing 400+ yards", value: "+1", note: "Stacks with the 300 bonus — a 400-yard game earns both, so +2 in all" },
  { category: "Rushing 100–199 yards", value: "+1", note: "" },
  { category: "Rushing 200+ yards", value: "+1", note: "Stacks with the 100 bonus — a 200-yard game earns both, so +2 in all" },
  { category: "Receiving 100–199 yards", value: "+1", note: "" },
  { category: "Receiving 200+ yards", value: "+1", note: "Stacks with the 100 bonus — a 200-yard game earns both, so +2 in all" },
];

/**
 * @fromProposal 3.3 — "Explosive Play: 40+ yard pass, rush, or reception, +1".
 * @fromSleeper `pass_cmp_40p`, `rush_40p`, `rec_40p`, all 1.
 *
 * Note the passing one is credited on a 40+ yard COMPLETION, so a single long
 * play can pay both the passer and the receiver.
 */
export const EXPLOSIVE_BONUSES: ScoringRow[] = [
  { category: "40+ Yard Pass Completion", value: "+1", note: "Credited to the passer" },
  { category: "40+ Yard Rush", value: "+1", note: "Credited to the ball carrier" },
  { category: "40+ Yard Reception", value: "+1", note: "Credited to the receiver" },
];

/**
 * @fromProposal 3.3 — the explicit exclusions, quoted rather than inferred.
 *
 * ALSO THE CATCH-ALL FOR SLEEPER KEYS THE TABLES ABOVE DO NOT RENDER. Every
 * key in the live `scoring_settings` payload is now either a row on the page or
 * a line in this list. A scoring page that quietly drops a category is worse
 * than one that says "not used", because silence reads as "does not exist"
 * rather than "set to zero" — and the two are only the same until somebody
 * edits the league.
 */
export const SCORING_EXCLUSIONS: string[] = [
  "No kicker — the position has zero lineup slots and Sleeper's roster carries no K, so a kicker cannot be started. Sleeper still stores the values (3 under 40 yards, 4 from 40–49, 5 from 50–59, 6 from 60+, 1 per PAT, −1 for either miss) but nothing can earn them.",
  "No yards-allowed scoring for defences — Sleeper carries no yards-allowed band in this league at all. Points allowed is the only band that scores.",
  "No full PPR — receptions are 0.5, with tight ends at 1.0 via the TE premium.",
  "No wide receiver reception premium — Sleeper's WR bonus is set to 0.0, so the premium is the tight end's alone.",
  "No tight end first-down bonus.",
  "No separate 40-yard touchdown bonus — a 40+ yard score earns the explosive-play point and the touchdown, and nothing further.",
  "No QB-specific rushing bonus.",
  "No defensive 2-point return, and no individual defensive players — the only defensive scoring is the D/ST unit's.",
  "No oversized mega-bonuses — the yardage bonuses are 1 point each and a player can hold at most two of them in a game.",
];

/** Machine-readable scoring spec. Mirrors Sleeper's own keys where they exist. */
export const SCORING_SPEC = {
  kicker: false,
  ppr: 0.5,
  recTePremium: 0.5,
  passYardsPerPoint: 20,
  rushRecYardsPerPoint: 10,
  passTd: 6,
  rushTd: 6,
  recTd: 6,
  twoPointConversion: 2,
  interceptionThrown: -2,
  pickSixAdditional: -4,
  /** Any credited fumble. */
  fumble: -1,
  /** The INCREMENT on top of `fumble` when the fumble is lost. */
  fumbleLostAdditional: -1,
  /**
   * What a LOST fumble costs in total — the −1 for the fumble plus the −1 for
   * losing it. Scorers work from a "fumbles lost" stat rather than from the two
   * events, so this is the coefficient they need; it is derived from the two
   * above rather than being a third independent number.
   */
  fumbleLost: -2,
  dstTd: 6,
  milestoneBonuses: true,
  explosiveBonuses: true,
  /**
   * INCREMENTS, MIRRORING SLEEPER'S KEYS ONE FOR ONE. Each is worth 1 on its
   * own and the pair stacks, so a 400-yard passing game collects `bonusPass300`
   * AND `bonusPass400` for 2. These read 1/2/1/2/1/2 until 2026-09-05, which
   * was the ruleset PDF's "total" phrasing transcribed into fields Sleeper
   * treats as separate payments — right total, wrong model, and it would have
   * double-counted the moment anything summed the two.
   */
  bonusPass300: 1,
  bonusPass400: 1,
  bonusRush100: 1,
  bonusRush200: 1,
  bonusRec100: 1,
  bonusRec200: 1,
  bonusPlay40: 1,
  /** @fromSleeper Team defence and special teams, read live 2026-09-05. */
  dstSack: 1,
  dstInterception: 2,
  dstFumbleRecovery: 2,
  dstForcedFumble: 1,
  dstSafety: 2,
  dstBlockedKick: 2,
  dstSpecialTeamsTd: 6,
  dstSpecialTeamsForcedFumble: 1,
  dstSpecialTeamsFumbleRecovery: 1,
  /**
   * Points allowed, as [inclusive lower bound, value]. Descending so a lookup
   * takes the first band whose bound the total clears; the top band has no
   * upper limit, which is why the bounds and not the printed labels are the
   * machine-readable form.
   */
  dstPointsAllowed: [
    [35, -4],
    [28, -1],
    [21, 0],
    [14, 1],
    [7, 4],
    [1, 7],
    [0, 10],
  ],
  /** No yards-allowed band exists in this league's Sleeper settings. */
  dstYardsAllowed: false,
} as const;

// --- Trades -----------------------------------------------------------------

/**
 * @fromProposal Section 6. Players and FAAB only.
 *
 * NO DRAFT-PICK TRADING, AND THAT IS A RULE RATHER THAN AN EMPTY LEDGER:
 * "This is a redraft league — only current-season players and FAAB may be
 * traded." Every slot on the board is owned by the franchise it was born to,
 * which is why `futurePicksSeasonsOut` is 0 and `FEATURES.tradedPicks` is off.
 */
export const TRADES = {
  /** @fromProposal "Trade deadline: conclusion of Week 12." @fromSleeper 12. */
  deadlineWeek: 12,
  /** No pick trading at all, this season or any future one. */
  futurePicksSeasonsOut: 0,
  /** Moot with no pick trading, but the honest value is "nothing to balance". */
  requirePickCountBalance: false,
  /**
   * @fromProposal Trades process immediately on acceptance. The exception is a
   * same-household trade, which gets an automatic 48-hour review window unless
   * a majority of independent managers fast-track it.
   */
  reviewHours: 0,
  sameHouseholdReviewHours: 48,
} as const;

// --- Money ------------------------------------------------------------------

/**
 * @fromProposal Sections 5 and 7. RECORDED, NOT IMPLEMENTED — this app runs the
 * draft and does not keep the ledger. These values exist so a surface can quote
 * the league's real numbers instead of a placeholder.
 *
 * The document's $1,800 base pool assumes twelve buy-ins; at ten it is $1,500.
 * The base is therefore DERIVED from the team count rather than quoted, so it
 * cannot silently disagree with the size of the league.
 */
export const MONEY = {
  buyIn: 150,
  perRosterMove: 1,
  faabBudget: 200,
  toiletBowlPenalty: 50,
  get basePool(): number {
    return this.buyIn * LEAGUE.teams;
  },
} as const;

// --- Governance -------------------------------------------------------------

/** @fromProposal Section 9 — the motion process and its thresholds. */
export const VOTING_THRESHOLDS: { decision: string; approval: string; examples: string }[] = [
  { decision: "Standard Rule Change", approval: "Simple majority", examples: "Anything not touching scoring, rosters, or money" },
  { decision: "Structural Change", approval: "Two-thirds", examples: "Scoring, rosters, money" },
  { decision: "Manager Removal", approval: "Two-thirds of the other managers", examples: "Persistent bad faith, collusion, abandonment" },
  { decision: "Trade Reversal", approval: "Formal challenge, then a vote", examples: "Collusion, bribery, sabotage, provable bad faith" },
];

/** @fromProposal Tom ran the modernization; the commissioner is the new one. */
export const OFFICERS: { role: string; responsibilities: string }[] = [
  { role: "Commissioner", responsibilities: "Runs the league, configures Sleeper, draft logistics, resolves disputes, keeps the fee ledger." },
];

// --- Preseason checklist ----------------------------------------------------

export const PRESEASON_CHECKLIST: string[] = [
  `Confirm ${LEAGUE.teams} active managers and their franchise names.`,
  "Confirm the lottery draft order and lock it on the board.",
  `Confirm scoring on ${LEAGUE.platform} matches the proposal — half PPR, TE premium, 6-point passing TD, bonuses on.`,
  "Turn OFF draft-pick trading on Sleeper — the proposal forbids it and Sleeper currently allows it.",
  "Collect the $150 buy-ins before the draft begins.",
  "Confirm draft date, time, and location.",
];

// --- Platform settings reference --------------------------------------------

/**
 * Mirror of what is configured on Sleeper, read back off the live league by
 * `npm run pull:sleeper`. A record rather than a to-do list.
 */
export const PLATFORM_SETTINGS: { area: string; configuration: string }[] = [
  { area: "League", configuration: `${LEAGUE.teams} teams; redraft; ${LEAGUE.platform}` },
  { area: "Draft", configuration: `${DRAFT.snake ? "Snake" : "Linear"} draft; ${DRAFT.rounds} rounds; ${DRAFT.clockSeconds}s clock; run in person` },
  { area: "Starting Lineup", configuration: STARTING_LINEUP.map((s) => `${s.count} ${s.slot}`).join(", ") + "; 0 K" },
  { area: "Bench / IR", configuration: `${ROSTER.bench} bench; ${ROSTER.irSlots} IR slots; ${ROSTER.activeCap} active` },
  { area: "Position Limits", configuration: `None — the ${ROSTER.activeCap}-man roster is the only constraint` },
  { area: "Scoring", configuration: `${SCORING_FORMAT}; 6-point passing TD; yardage and explosive bonuses; no kicker` },
  { area: "Playoffs", configuration: `${LEAGUE.playoffTeams} teams; weeks ${LEAGUE.playoffWeeks[0]}–${LEAGUE.playoffWeeks[1]}` },
  { area: "Keepers", configuration: "Not activated for 2026 — pure redraft. Framework deferred to a 2027 vote." },
  { area: "Trades", configuration: `Players and FAAB only — no pick trading. Deadline week ${TRADES.deadlineWeek}` },
  { area: "Waivers", configuration: `$${MONEY.faabBudget} FAAB; processes Wednesday 10:00 Central; $${MONEY.perRosterMove} per roster move` },
];

// --- Calendar ---------------------------------------------------------------

export type CalendarEvent = {
  key: string;
  label: string;
  description: string;
  article: string;
};

export const CALENDAR_EVENTS: CalendarEvent[] = [
  { key: "dues_due", label: "Buy-ins due", description: `$${MONEY.buyIn} per team, payable before the draft begins.`, article: "Section 7" },
  { key: "draft", label: "Annual draft", description: `In-person ${DRAFT.snake ? "snake" : "linear"} draft, ${DRAFT.rounds} rounds, ${DRAFT.clockSeconds}s clock.`, article: "Section 4" },
  { key: "trade_window_reopen", label: "Trade window reopens", description: "Immediately after the draft completes.", article: "Section 4" },
  { key: "waivers_weekly", label: "Weekly waiver processing", description: "Wednesday, 10:00 Central / 08:00 Pacific. Unclaimed players are then first-come free agents until kickoff.", article: "Section 5" },
  { key: "trade_deadline", label: "In-season trade deadline", description: `Conclusion of week ${TRADES.deadlineWeek}.`, article: "Section 6" },
  { key: "playoffs", label: "Playoffs", description: `Weeks ${LEAGUE.playoffWeeks[0]}–${LEAGUE.playoffWeeks[1]}; ${LEAGUE.playoffTeams} teams, top two seeds get byes.`, article: "Section 8" },
  { key: "fees_due", label: "Transaction fees due", description: "Ledger finalised after the championship; balances due by the following Wednesday waiver deadline.", article: "Section 5" },
  { key: "payouts", label: "Payouts", description: "Issued by the Sunday following the championship.", article: "Section 7" },
];

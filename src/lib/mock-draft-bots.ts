/**
 * Bot personalities for the mock draft — the tuning table.
 *
 * THIS IS THE FILE TO EDIT. Everything about how the nine AI franchises behave
 * is a number in this file. Nothing in `@/lib/mock-draft-ai` needs touching to
 * make a bot greedier, more patient, or more obsessed with wide receivers.
 *
 * WHY HEURISTICS AND NOT AN LLM. An API key was offered and turned down, on
 * purpose. The draft board holds an offline guarantee: `verify:draft:typing`
 * blocks every non-local request and asserts a pick still commits, because the
 * venue's wifi is not trusted and Saturday does not get a second attempt. A
 * language model in the pick loop would put a network dependency inside the one
 * surface that must work with the internet unplugged. It would also be slower
 * than a keystroke, cost money on every one of the hundreds of mocks he will
 * run, and be undebuggable — when a bot does something stupid you want to read
 * the number that caused it, not re-prompt. The reasoning a draft bot needs is
 * arithmetic over ADP and roster holes, which is exactly what a table of
 * weights does well.
 *
 * WHAT EVERY BOT GUARANTEES, regardless of personality. These are league
 * legality rather than style, so they are not tunable per archetype:
 *
 *   · a fillable starting lineup — 1 QB, 2 RB, 2 WR, 1 TE, 2 FLEX, 1 DST
 *   · never a third quarterback, and never a third tight end
 *   · exactly one defense, and not before the late rounds
 *   · NO KICKER, EVER. This league has no K slot. The pool the mock is handed
 *     is already filtered to QB/RB/WR/TE/DST by `@/lib/smartdraft`, and
 *     `@/lib/mock-draft-ai` filters again on the way in, so a kicker cannot be
 *     drafted even if a future snapshot starts carrying them.
 */

import { ROSTER } from "@/lib/league-config";

/**
 * A tilt is what makes an archetype an archetype: a position the bot values
 * differently from the consensus board, over a band of rounds. Zero-RB is
 * nothing more than "RB × 0.15 through round four, RB × 1.45 from round seven".
 *
 * WHAT THE NUMBER MEANS. A tilt shifts the position's PERCEIVED ADP by
 * `reach × (factor − 1)`. So with a `reach` of 6, a factor of 1.5 makes every
 * running back look three ADP points better than the market says, and a factor
 * of 0.15 makes them look five points worse. One notch of `factor` is therefore
 * one `reach`-width of ADP the bot is willing to pay up — or demands as a
 * discount.
 *
 * That is the whole mechanism: an archetype is a bot reading a slightly bent
 * version of the same consensus board. It bends who is in the candidate window
 * and how much a reach costs, which is exactly how a manager with a plan
 * behaves. Roster legality is NOT tilted — see `BOT_LIMITS`.
 *
 * `through` and `from` are inclusive round numbers. Omit both for a tilt that
 * applies all draft long.
 */
export type BotTilt = {
  positions: string[];
  through?: number;
  from?: number;
  /** 1 is neutral. Above 1 pays up for the position, below 1 demands a discount. */
  factor: number;
};

export type BotArchetype = {
  key: string;
  /** Shown on the bot label under each franchise column. */
  name: string;
  /** One line, shown when he clicks the label to swap personalities. */
  blurb: string;
  /**
   * How far past the best player still on the board this bot will reach, in ADP
   * points. The commissioner's spec was "±5 of ADP", which is the default and
   * what `balanced` uses; a value hunter reaches less, a gambler more.
   */
  reach: number;
  /** How much an empty roster slot counts against raw ADP value. 0 = pure ADP. */
  needWeight: number;
  /**
   * How much falling below ADP counts. Overrides `BOT_LIMITS.valueWeight`.
   *
   * This is the other side of `needWeight`: together they set whether a bot is a
   * planner or a bargain hunter. Value is measured in window-widths, so a value
   * weight of 1 means "a player at the far edge of my window is worth one whole
   * starting-slot need less than the man at the top of it".
   */
  valueWeight?: number;
  /**
   * How much "he will not survive until my next pick" counts. This is the term
   * that produces positional runs — see the note in `@/lib/mock-draft-ai`.
   */
  scarcityWeight: number;
  /** The roster this bot is trying to end up with. Must sum to the active cap. */
  target: Record<string, number>;
  tilt: BotTilt[];
  /**
   * Overrides `BOT_LIMITS.secondFromRound` — the earliest round this bot will
   * take a SECOND player at a position. Only QB and TE are gated; RB and WR
   * depth is the point of the draft.
   */
  secondFrom?: Record<string, number>;
  /** Randomness on the final score. Higher is a less predictable manager. */
  noise: number;
};

/**
 * The archetypes, most conventional first.
 *
 * Every `target` sums to `ROSTER.activeCap` (16) and respects `BOT_LIMITS.hardMax`
 * — asserted by `verify:mock` rather than trusted, because a target that does
 * not add up produces a bot that quietly cannot finish a roster.
 */
export const BOT_ARCHETYPES: BotArchetype[] = [
  {
    key: "balanced",
    name: "Balanced",
    blurb:
      "Follows the consensus board and takes what the roster is missing. The default room.",
    reach: 5,
    needWeight: 1,
    scarcityWeight: 0.9,
    target: { QB: 2, RB: 5, WR: 6, TE: 2, DST: 1 },
    tilt: [],
    noise: 0.25,
  },
  {
    key: "value",
    name: "Value hunter",
    blurb:
      "Barely looks at his roster — takes whoever has fallen furthest below ADP and sorts the lineup out later.",
    reach: 3,
    needWeight: 0.3,
    valueWeight: 1.3,
    scarcityWeight: 0.35,
    target: { QB: 2, RB: 6, WR: 6, TE: 1, DST: 1 },
    tilt: [],
    noise: 0.2,
  },
  {
    key: "zero-rb",
    name: "Zero RB",
    blurb:
      "Will not touch a running back for four rounds, buys receivers instead, then hammers RB from round seven.",
    reach: 6,
    needWeight: 1.15,
    scarcityWeight: 0.9,
    target: { QB: 2, RB: 5, WR: 7, TE: 1, DST: 1 },
    tilt: [
      { positions: ["RB"], through: 4, factor: 0.1 },
      { positions: ["WR"], through: 5, factor: 1.5 },
      { positions: ["RB"], from: 7, factor: 1.7 },
    ],
    noise: 0.25,
  },
  {
    key: "robust-rb",
    name: "Robust RB",
    blurb:
      "Backs up the truck on running backs early and lives with a thin receiver room.",
    reach: 6,
    needWeight: 1.1,
    scarcityWeight: 1,
    target: { QB: 2, RB: 7, WR: 5, TE: 1, DST: 1 },
    tilt: [
      { positions: ["RB"], through: 6, factor: 2.3 },
      { positions: ["WR"], through: 3, factor: 0.7 },
    ],
    noise: 0.25,
  },
  {
    key: "hero-rb",
    name: "Hero RB",
    blurb:
      "One elite back in the first two rounds, then receivers all the way down.",
    reach: 5,
    needWeight: 1.1,
    scarcityWeight: 0.9,
    target: { QB: 2, RB: 4, WR: 7, TE: 2, DST: 1 },
    tilt: [
      // Through round ONE, not two. Most franchises pick twice in the first two
      // rounds, so a two-round band bought two elite backs and the archetype
      // stopped being "hero RB" and started being "robust RB with extra steps".
      { positions: ["RB"], through: 1, factor: 2.4 },
      { positions: ["RB"], from: 2, through: 9, factor: 0.2 },
      { positions: ["WR"], from: 2, factor: 1.5 },
    ],
    noise: 0.25,
  },
  {
    key: "early-qb",
    name: "Early QB",
    blurb:
      "Has noticed this league pays six for a passing touchdown and that no public ADP feed prices that in. Takes a quarterback early and a second one soon after.",
    reach: 7,
    needWeight: 1.2,
    scarcityWeight: 0.8,
    target: { QB: 2, RB: 5, WR: 6, TE: 2, DST: 1 },
    tilt: [
      { positions: ["QB"], through: 7, factor: 2.0 },
      { positions: ["TE"], through: 6, factor: 0.7 },
    ],
    secondFrom: { QB: 5, TE: 9 },
    noise: 0.3,
  },
  {
    key: "late-everything",
    name: "Streamer",
    blurb:
      "Refuses to spend a pick on a quarterback or a tight end until the back end of the draft, and puts everything into RB and WR.",
    reach: 5,
    needWeight: 1.05,
    scarcityWeight: 0.85,
    target: { QB: 1, RB: 6, WR: 7, TE: 1, DST: 1 },
    tilt: [
      { positions: ["QB", "TE"], through: 9, factor: 0.15 },
      { positions: ["RB", "WR"], through: 9, factor: 1.35 },
    ],
    secondFrom: { QB: 13, TE: 13 },
    noise: 0.25,
  },
];

export const BOT_ARCHETYPES_BY_KEY = new Map(BOT_ARCHETYPES.map((a) => [a.key, a]));

export const DEFAULT_ARCHETYPE_KEY = "balanced";

export function archetypeByKey(key: string | undefined | null): BotArchetype {
  return (
    (key ? BOT_ARCHETYPES_BY_KEY.get(key) : undefined) ??
    BOT_ARCHETYPES_BY_KEY.get(DEFAULT_ARCHETYPE_KEY)!
  );
}

/**
 * Rules no personality may break. Legality and league shape, not style.
 *
 * `hardMax` is the one the commissioner asked for by name — Smart Draft's bots
 * "won't sit on three quarterbacks" and neither will these. RB and WR ride the
 * league's own roster limits from `league-config` rather than a number invented
 * here.
 */
export const BOT_LIMITS = {
  hardMax: {
    QB: 2,
    TE: 2,
    DST: 1,
    RB: ROSTER.positionalMax.RB,
    WR: ROSTER.positionalMax.WR,
  } as Record<string, number>,
  /**
   * A defense before this round is a bot doing something no manager does. The
   * best defense on the board sits at ADP 101, which lands in round 11 of a
   * 16-round, 10-team board, so this is barely a thumb on the scale — it just
   * stops one landing in round 6.
   */
  dstEarliestRound: 12,
  /** No defense by here and the bot takes one, wherever the value sits. */
  dstForcedRound: 15,
  /**
   * A SECOND quarterback or tight end before this round is hoarding rather than
   * strategy, whatever the archetype. `early-qb` still gets its second one
   * quickly because it is the only archetype whose first one goes early.
   */
  secondFromRound: { QB: 9, TE: 9 } as Record<string, number>,
  /**
   * How hard legality pressure ramps as a bot runs out of picks relative to
   * unfilled starting slots. At zero slack this dominates everything else, which
   * is what guarantees a fillable lineup.
   */
  urgencyWeight: 2.5,
  /**
   * How much a reach costs, per window-width of ADP. The counterweight to
   * `need` below, and the single most important number in the file: set it too
   * high and every personality collapses into "best available", which is
   * exactly what happened at 1.0 — all seven archetypes finished with the same
   * roster to within a tenth of a player.
   */
  valueWeight: 0.5,
  /**
   * Weights for the three kinds of roster hole, in descending order of how
   * badly a bot should want to fill one. Shared across archetypes; an
   * archetype's tilts scale these, they do not replace them.
   */
  need: {
    /** An empty QB / RB / WR / TE / DST starting slot. */
    startingSlot: 1.15,
    /** An empty FLEX, which three positions can fill, so it is worth less. */
    flexSlot: 0.75,
    /** Starters full — this is bench depth, and it chases the archetype's target. */
    depth: 0.9,
  },
  /** ADP stand-in for a player no feed ranks. Keeps them out of every window. */
  unrankedAdp: 900,
  /**
   * The beat between AI picks, in milliseconds. Not thinking time — the pick is
   * computed in well under a millisecond. It exists so a run of nine bot picks
   * reads as nine events rather than one flicker.
   */
  pickDelayMs: 420,
} as const;

/**
 * How long the room gets between bot picks.
 *
 * `BOT_LIMITS.pickDelayMs` is the beat the announcement was tuned against and
 * is the default. The other three exist because one pace cannot serve both jobs
 * this surface has: a whole board at that beat runs the better part of ten
 * minutes, which is right when it is on the projector and a room is reading each
 * pick, and wrong when he is rehearsing his own first three rounds for the fifth
 * time this evening.
 *
 * Instant is not a substitute for Finish. It still renders every pick, so the
 * board animates through the whole draft; Finish computes the rest in one go
 * and skips to the result.
 */
export const MOCK_PACES = [
  { key: "instant", name: "Instant", blurb: "As fast as the board can draw", delayMs: 0 },
  { key: "fast", name: "Fast", blurb: "Quick — for rehearsing your own picks", delayMs: 140 },
  {
    key: "readable",
    name: "Readable",
    blurb: "One pick at a time, as tuned",
    delayMs: BOT_LIMITS.pickDelayMs,
  },
  { key: "projector", name: "Projector", blurb: "Slow enough for a room to follow", delayMs: 900 },
] as const;

export type MockPace = (typeof MOCK_PACES)[number];

export const DEFAULT_PACE_KEY = "readable";

export function paceByKey(key: string | undefined | null): MockPace {
  return (
    MOCK_PACES.find((p) => p.key === key) ??
    MOCK_PACES.find((p) => p.key === DEFAULT_PACE_KEY)!
  );
}

/**
 * Deals archetypes out to the AI franchises so a fresh mock is a mixed room
 * rather than nine copies of the same manager.
 *
 * Walks the table in order and repeats, keyed off the franchise's draft slot, so
 * the assignment is stable for a given board instead of shuffling every render.
 * He can change any of them from the UI afterwards.
 */
export function defaultArchetypeFor(draftSlot: number): string {
  return BOT_ARCHETYPES[(draftSlot - 1) % BOT_ARCHETYPES.length].key;
}

/** The tilt multiplier this archetype applies to a position in a given round. */
export function tiltFor(archetype: BotArchetype, position: string, round: number): number {
  let factor = 1;
  for (const rule of archetype.tilt) {
    if (!rule.positions.includes(position)) continue;
    if (rule.through != null && round > rule.through) continue;
    if (rule.from != null && round < rule.from) continue;
    factor *= rule.factor;
  }
  return factor;
}

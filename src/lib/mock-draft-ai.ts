/**
 * The mock draft AI. Pure functions over (board, pool, roster) — no I/O, no
 * `server-only`, no React, no network, and nothing that can write anything
 * anywhere. It decides; the caller applies.
 *
 * All of the tunable numbers live in `@/lib/mock-draft-bots`. This file is the
 * arithmetic that consumes them.
 *
 * ============================================================================
 * HOW A BOT DECIDES
 * ============================================================================
 *
 * The commissioner's spec was "pick within roughly ±5 ADP when it's their turn,
 * but they need to fill out a real roster". Taken literally that is two rules,
 * and both are here — but a bot that only does that ends the draft with eight
 * running backs, so there is a third.
 *
 *   1. THE WINDOW. Candidates are the players within `reach` ADP points of the
 *      best player still on the board. That is the ±5. It means a bot never
 *      takes somebody absurd, and it means the early rounds look like a real
 *      draft rather than a shuffle, because the top of the board is consensus.
 *
 *      Note what `reach` is measured FROM: the best available, not the current
 *      pick number. The league's keepers are pre-placed at their cost rounds, so
 *      board position and ADP drift apart as the draft runs; measuring from the
 *      best available is self-correcting and can never produce an empty window.
 *
 *      The window is measured on the bot's PERCEIVED board, not the consensus
 *      one. An archetype's tilts shift a position's apparent ADP — a robust-RB
 *      bot genuinely thinks running backs are better than the market does — so
 *      the same window admits different players for different personalities.
 *      This is the only place taste enters, and it is why the archetypes are
 *      visible in the finished rosters instead of being averaged away by a
 *      window that only the consensus board controls.
 *
 *   2. NEED. Within the window, a player who fills an empty starting slot beats
 *      one who does not, and a position the bot already has five of is worth
 *      little. This is what stops the eight running backs.
 *
 *   3. WHO WILL NOT SURVIVE UNTIL MY NEXT PICK. The interesting one, and the
 *      one that makes a mock feel like a room. Before choosing, a bot works out
 *      how many picks happen before it is up again, assumes those picks come off
 *      the top of the board in ADP order, and asks per position: how much worse
 *      is the best player at this position going to be by the time I am back?
 *
 *      When that drop is small the bot waits. When a position is about to fall
 *      off a cliff it takes one now. Because taking one thins the position
 *      further, the NEXT bot sees a bigger cliff and is more likely to take one
 *      too — so positional runs emerge from the arithmetic rather than being
 *      injected by a rule that says "sometimes do a run". Turn
 *      `scarcityWeight` to 0 in the archetype table and the runs disappear,
 *      which is how you can tell they are real.
 *
 *   4. LEGALITY, which is not negotiable and not a personality trait. A bot may
 *      not paint itself into a corner: if it has as many picks left as it has
 *      empty starting slots, it must fill one. That single rule is what
 *      guarantees ten fillable lineups, and it is enforced as a filter on the
 *      candidate set rather than as a preference, so no weighting can override
 *      it.
 *
 * A kicker cannot be chosen. The pool arrives already filtered by
 * `@/lib/smartdraft` and is filtered again here against the league's draftable
 * positions, so it takes two independent failures rather than one.
 */

import { DRAFTABLE_POSITIONS } from "@/lib/board-types";
import { ROSTER } from "@/lib/league-config";
import {
  BOT_LIMITS,
  tiltFor,
  type BotArchetype,
} from "@/lib/mock-draft-bots";
import { buildFranchiseLineups, type FranchiseLineup } from "@/lib/roster-lineup";
import type { DraftRoomView, LiveSlot } from "@/lib/draft-types";
import type { MockPlayer } from "@/lib/mock-draft-types";

const DRAFTABLE = new Set<string>(DRAFTABLE_POSITIONS);

/** Cap on the scarcity term, so one pathological gap cannot swamp the score. */
const MAX_DROPOFF_MULTIPLE = 2.5;

/**
 * How much worse a position is assumed to get once it runs out of ranked
 * players entirely. Any large number does; this is "a lot worse".
 */
const POSITION_EXHAUSTED_PENALTY = 60;

/**
 * How much of an archetype's tilt is spent on PRICE rather than on APPETITE.
 *
 * A tilt does two things: it changes how badly a bot wants a position (its
 * need), and it changes how much it will overpay for one (its perceived ADP).
 * The need channel is naturally bounded — need is at most a starting slot's
 * worth, and it competes against a value term that is at most 1 inside the
 * window. The price channel is not bounded, and at full strength it swamped
 * everything: a zero-RB bot ended a test run with seven running backs, because
 * a +4 ADP discount on every back beat a depth need that had correctly fallen
 * to zero.
 *
 * Half strength keeps the price channel meaningful without letting it overrule
 * a filled roster. Raise it for a room of bots that chase their plan off a
 * cliff; drop it to 0 to make tilts purely about appetite.
 */
const TILT_PRICE_SENSITIVITY = 0.5;

/** A starting slot with nobody in it, and what can fill it. */
type Requirement = { label: string; accepts: string[] };

/**
 * How far the candidate set had to be relaxed to find a legal pick.
 *
 * `preferred` is the normal answer and the only one that should ever appear.
 * The others exist so that an impossible board produces a pick and a recorded
 * reason rather than a crash — and so `verify:mock` can assert that they never
 * fire across a full draft.
 */
export type ChoiceTier =
  | "preferred"
  | "relaxed-reservation"
  | "relaxed-gates"
  | "relaxed-shape";

export type MockChoice = {
  player: MockPlayer;
  tier: ChoiceTier;
  /** Why, in words. Shown in the bot inspector and printed by the verifier. */
  reason: string;
  /** True when legality forced the position rather than value choosing it. */
  forced: boolean;
};

export function adpOf(player: MockPlayer): number {
  return player.adp ?? BOT_LIMITS.unrankedAdp;
}

/**
 * Seeded RNG, so a mock can be replayed exactly.
 *
 * The UI passes `Math.random`; `verify:mock` passes a seed, because a
 * verification that cannot reproduce its own failure is not much use.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Removes one requirement that this position can fill, narrowest first.
 *
 * Narrowest first matters: a tight end should be counted against the TE slot
 * rather than against a FLEX, or the bot would believe it had covered TE when
 * it had actually only covered a slot three positions could have filled.
 */
function consumeOne(reqs: Requirement[], position: string): Requirement[] {
  let bestIndex = -1;
  let bestWidth = Infinity;
  for (let i = 0; i < reqs.length; i++) {
    if (!reqs[i].accepts.includes(position)) continue;
    if (reqs[i].accepts.length < bestWidth) {
      bestWidth = reqs[i].accepts.length;
      bestIndex = i;
    }
  }
  if (bestIndex === -1) return reqs;
  return reqs.filter((_, i) => i !== bestIndex);
}

/**
 * Open slots between this pick and the next one this franchise owns.
 *
 * The horizon for "will he still be there". Returns the number of remaining
 * open slots when the franchise has no further picks, which makes the scarcity
 * term irrelevant — correctly, since there is no next pick to protect.
 */
export function picksUntilNextTurn(
  view: DraftRoomView,
  slot: LiveSlot,
  teamId: string,
): number {
  const open = view.slots.filter((s) => s.fill === null);
  const at = open.findIndex((s) => s.id === slot.id);
  const after = at === -1 ? open : open.slice(at + 1);
  const next = after.findIndex((s) => s.currentOwner.id === teamId);
  return next === -1 ? after.length : next;
}

/**
 * The single decision. Everything above is in service of this function.
 *
 * `lineups` may be passed in when the caller already has them for this view,
 * which is the common case — the board is rendering them anyway.
 */
export function chooseMockPick({
  view,
  pool,
  slot,
  archetype,
  rng = Math.random,
  lineups,
}: {
  view: DraftRoomView;
  /** The full player pool. Order does not matter; it is sorted here. */
  pool: MockPlayer[];
  slot: LiveSlot;
  archetype: BotArchetype;
  rng?: () => number;
  lineups?: FranchiseLineup[];
}): MockChoice {
  const teamId = slot.currentOwner.id;
  const round = slot.round;
  const taken = new Set(view.draftedPlayerIds);

  const lineup =
    (lineups ?? buildFranchiseLineups(view)).find((l) => l.team.id === teamId) ?? null;
  if (!lineup) {
    throw new Error(`${slot.label} belongs to a franchise that is not on the board.`);
  }

  // Second, independent no-kicker filter. See the note at the top of the file.
  const available = pool
    .filter((p) => DRAFTABLE.has(p.position) && !taken.has(p.id))
    .sort((a, b) => adpOf(a) - adpOf(b));

  if (available.length === 0) {
    throw new Error("The player pool is empty, which cannot happen mid-draft.");
  }

  const reach = Math.max(0.1, archetype.reach);

  /**
   * The bot's own view of a player's ADP — the price channel of a tilt.
   *
   * One notch of tilt is worth half a `reach`-width of ADP, so a factor of 2.3
   * on running backs with a reach of 6 means this bot reads every back as about
   * four points better than the consensus does. That is a plan expressed as a
   * number: not "prefers RB" but "will pay four spots for one".
   */
  const perceived = (p: MockPlayer): number =>
    adpOf(p) -
    reach * TILT_PRICE_SENSITIVITY * (tiltFor(archetype, p.position, round) - 1);

  const openReqs: Requirement[] = lineup.starters
    .filter((s) => s.player === null)
    .map((s) => ({ label: s.label, accepts: s.eligible }));

  // --- Who will not survive until this franchise is up again ---------------

  const byPosition = new Map<string, MockPlayer[]>();
  for (const p of available) {
    const list = byPosition.get(p.position);
    if (list) list.push(p);
    else byPosition.set(p.position, [p]);
  }

  const gap = picksUntilNextTurn(view, slot, teamId);
  /*
   * The assumption behind the whole term: the next `gap` picks come off the top
   * of the board in ADP order. It is wrong in detail and right in aggregate,
   * which is all it needs to be — it is deciding whether to wait a round, not
   * predicting names.
   */
  const consumedAtPosition = new Map<string, number>();
  for (const p of available.slice(0, gap)) {
    consumedAtPosition.set(p.position, (consumedAtPosition.get(p.position) ?? 0) + 1);
  }

  /** How much worse this position gets by the franchise's next pick, in ADP. */
  const dropoff = (position: string): number => {
    const list = byPosition.get(position);
    if (!list || list.length === 0) return 0;
    const now = adpOf(list[0]);
    const consumed = consumedAtPosition.get(position) ?? 0;
    const later =
      consumed < list.length
        ? adpOf(list[consumed])
        : adpOf(list[list.length - 1]) + POSITION_EXHAUSTED_PENALTY;
    return Math.max(0, later - now);
  };

  // --- Need ----------------------------------------------------------------

  const slack = Math.max(0, lineup.picksRemaining - openReqs.length);

  /**
   * How badly this bot wants a player at this position right now.
   *
   * Tilted, and this is the second half of what makes an archetype visible. A
   * zero-RB manager with an empty RB1 slot in round three does not feel that
   * hole the way a robust-RB manager does — he knows he is filling it in round
   * seven. Damping the need is how that belief gets expressed; shifting the
   * perceived ADP alone only changes what he will pay, not what he is shopping
   * for, which is why the archetypes were washing out with the tilt applied in
   * one place.
   *
   * Legality pressure (`urgencyFor`) and the candidate filters are deliberately
   * NOT tilted. A bot may believe what it likes about running backs; it may not
   * believe its way out of fielding nine starters.
   */
  const needFor = (position: string): number => {
    const tilt = tiltFor(archetype, position, round);

    const dedicated = openReqs.find(
      (r) => r.accepts.length === 1 && r.accepts[0] === position,
    );
    if (dedicated) return BOT_LIMITS.need.startingSlot * tilt;
    const flex = openReqs.find(
      (r) => r.accepts.length > 1 && r.accepts.includes(position),
    );
    if (flex) return BOT_LIMITS.need.flexSlot * tilt;

    /*
     * Starters are covered, so this is bench depth, and it chases the shape the
     * archetype is trying to build.
     *
     * A STEP, not a ramp: a position below its target is a full depth need and a
     * position at or above it is none. A proportional shortfall was too gentle
     * to be visible — a robust-RB bot two backs short of its target of seven
     * only preferred one by a fifth of a window, which the value term ate. The
     * step is also easier to reason about from the table: `target` reads as "how
     * many of these I am collecting", which is what it should mean.
     */
    const target = archetype.target[position] ?? 0;
    if (target <= 0) return 0;
    const have = lineup.byPosition[position] ?? 0;
    const shortfall = Math.max(0, Math.min(1, target - have));
    return BOT_LIMITS.need.depth * shortfall * tilt;
  };

  /**
   * Legality pressure. Rises as the franchise runs out of picks relative to its
   * unfilled starting slots and dominates everything else at zero slack.
   * Deliberately archetype-independent: fielding a legal lineup is not a matter
   * of taste.
   */
  const urgencyFor = (position: string): number =>
    openReqs.some((r) => r.accepts.includes(position))
      ? BOT_LIMITS.urgencyWeight / (1 + slack)
      : 0;

  // --- Candidate filters, in order of how much they give up ----------------

  const underLeagueCap = (p: MockPlayer): boolean =>
    (lineup.byPosition[p.position] ?? 0) <
    (ROSTER.positionalMax[p.position] ?? Infinity);

  const underShapeCap = (p: MockPlayer): boolean =>
    (lineup.byPosition[p.position] ?? 0) < (BOT_LIMITS.hardMax[p.position] ?? Infinity);

  const pastGates = (p: MockPlayer): boolean => {
    if (p.position === "DST" && round < BOT_LIMITS.dstEarliestRound) return false;
    // The archetype may bring its own deadline forward or push it back — an
    // early-QB bot wants its second quarterback long before a streamer does.
    const secondFrom =
      archetype.secondFrom?.[p.position] ?? BOT_LIMITS.secondFromRound[p.position];
    if (
      secondFrom != null &&
      (lineup.byPosition[p.position] ?? 0) >= 1 &&
      round < secondFrom
    ) {
      return false;
    }
    return true;
  };

  /** Leaves enough picks behind to still fill every empty starting slot. */
  const leavesRoomForStarters = (p: MockPlayer): boolean =>
    lineup.picksRemaining - 1 >= consumeOne(openReqs, p.position).length;

  const tiers: { tier: ChoiceTier; players: MockPlayer[] }[] = [
    {
      tier: "preferred",
      players: available.filter(
        (p) =>
          underLeagueCap(p) && underShapeCap(p) && pastGates(p) && leavesRoomForStarters(p),
      ),
    },
    {
      tier: "relaxed-reservation",
      players: available.filter(
        (p) => underLeagueCap(p) && underShapeCap(p) && pastGates(p),
      ),
    },
    {
      tier: "relaxed-gates",
      players: available.filter((p) => underLeagueCap(p) && underShapeCap(p)),
    },
    // Never drops `underLeagueCap`: rostering a tenth wide receiver is not a
    // legal fallback, it is a broken roster.
    { tier: "relaxed-shape", players: available.filter(underLeagueCap) },
  ];

  const chosenTier = tiers.find((t) => t.players.length > 0);
  if (!chosenTier) {
    throw new Error(
      `${slot.currentOwner.name} has no legal pick at ${slot.label} — every position is at its league cap.`,
    );
  }

  let candidates = chosenTier.players;
  let forced = false;
  let forcedReason = "";

  /*
   * A defense is the one position with an absolute deadline: exactly one per
   * roster, and the board will not offer it to a bot that keeps deferring.
   * Checked before the window, because by round 15 the best defense left is
   * usually nowhere near the best player left.
   */
  if (
    (lineup.byPosition.DST ?? 0) === 0 &&
    round >= BOT_LIMITS.dstForcedRound &&
    candidates.some((p) => p.position === "DST")
  ) {
    candidates = candidates.filter((p) => p.position === "DST");
    forced = true;
    forcedReason = `round ${round} and still no defense`;
  } else if (openReqs.length > 0 && lineup.picksRemaining <= openReqs.length) {
    /*
     * Out of slack: every remaining pick has to fill a starting slot. The
     * reservation filter above has already removed anything that does not, but
     * narrowing explicitly means the reason string says so.
     */
    const fillers = candidates.filter((p) =>
      openReqs.some((r) => r.accepts.includes(p.position)),
    );
    if (fillers.length > 0) {
      candidates = fillers;
      forced = true;
      forcedReason = `${lineup.picksRemaining} picks left for ${openReqs.length} empty starting slots`;
    }
  }

  // --- The window, on this bot's own reading of the board -------------------

  const bestPerceived = Math.min(...candidates.map(perceived));
  const inWindow = candidates.filter((p) => perceived(p) <= bestPerceived + reach);
  // At least the player who set `bestPerceived` is always in it.
  const shortlist = inWindow.length > 0 ? inWindow : [candidates[0]];

  // --- Score ---------------------------------------------------------------

  let best = shortlist[0];
  let bestScore = -Infinity;
  let bestParts = { need: 0, scarcity: 0, urgency: 0, value: 0 };

  for (const p of shortlist) {
    const pos = p.position;
    const need = needFor(pos);
    /*
     * Scarcity is measured on the CONSENSUS board, not the perceived one: how
     * fast a position is really drying up is a fact about the room, not a
     * matter of this bot's taste. Multiplied by need, because losing a player
     * at a position you have already filled is not a loss.
     */
    const scarcity =
      archetype.scarcityWeight *
      need *
      Math.min(dropoff(pos) / reach, MAX_DROPOFF_MULTIPLE);
    const urgency = urgencyFor(pos);
    const value =
      ((perceived(p) - bestPerceived) / reach) *
      (archetype.valueWeight ?? BOT_LIMITS.valueWeight);

    const score =
      archetype.needWeight * need + scarcity + urgency - value + archetype.noise * rng();

    if (score > bestScore) {
      bestScore = score;
      best = p;
      bestParts = { need, scarcity, urgency, value };
    }
  }

  /**
   * Why, in words — for the bot inspector in the UI and for the verifier's log.
   *
   * The roster-hole label is read off the requirement list rather than off the
   * need number, because a need number that has been through a weighting is no
   * longer recognisable as "this filled the WR2 slot".
   */
  const fillsStartingSlot = openReqs.some(
    (r) => r.accepts.length === 1 && r.accepts[0] === best.position,
  );
  const fillsFlex =
    !fillsStartingSlot && openReqs.some((r) => r.accepts.includes(best.position));

  const reason = forced
    ? `${archetype.name}: forced — ${forcedReason}`
    : [
        `${archetype.name}:`,
        fillsStartingSlot
          ? `fills ${best.position}`
          : fillsFlex
            ? `fills FLEX with a ${best.position}`
            : bestParts.need > 0
              ? `${best.position} depth`
              : "best value",
        bestParts.scarcity > 0.4
          ? `— ${best.position} thins out inside the next ${gap} picks`
          : "",
        bestParts.value < 0.05
          ? "— top of his board"
          : `— reached ${(bestParts.value * reach).toFixed(1)} ADP`,
      ]
        .filter(Boolean)
        .join(" ");

  return { player: best, tier: chosenTier.tier, reason, forced };
}

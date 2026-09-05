import "server-only";

/**
 * What this league actually pays for each position, computed from its own
 * eleven years of sheets.
 *
 * ============================================================================
 * THE ERROR THIS EXISTS TO KILL, IN THE COMMISSIONER'S WORDS
 * ============================================================================
 *
 * A shipped blurb told Josh: "Joe Burrow was keepable at a round-3 price, in a
 * league that pays six points for a passing touchdown, and you let him walk."
 * His reply: "No one would touch a 3rd round QB keeper, not even close."
 *
 * He is right, and the recap was confidently criticising a correct decision in
 * the imperative voice, which is the worst possible combination — authoritative
 * and wrong about a named man's named decision.
 *
 * THE HEURISTIC BEHIND IT: six points per passing touchdown ⇒ quarterbacks are
 * premium ⇒ declining a quarterback keeper is a blunder. The scoring setting is
 * real and it is genuinely worth knowing, but it is not the economy. The league
 * starts ONE quarterback. Ten franchises, one slot each, so roughly a dozen
 * quarterbacks matter across a 160-slot board, which is the shallowest
 * demand-to-supply ratio of any position here and puts replacement-level
 * quarterback very cheap. And a keeper price is an OPPORTUNITY COST, not a
 * valuation: paying a round-3 slot for a position you can fill in round 10 is
 * bad business whatever a passing touchdown is worth.
 *
 * The same broken yardstick was praising as well as condemning — it called a
 * round-10 Mahomes keeper price "the best fantasy quarterback price on this
 * entire board" when round 10 is, on the record below, the MEDIAN quarterback
 * keeper price in this league's history.
 *
 * ============================================================================
 * WHY THIS IS DATA AND NOT AN INSTRUCTION
 * ============================================================================
 *
 * "Be careful about quarterback prices" is a hedge, and this repo has already
 * documented what happens to hedges: "swear when it lands" was one bullet
 * against fourteen thousand tokens of accuracy discipline, and it lost. A
 * number does not lose. So the norms are computed and handed over as fact, in
 * the same way every reach and steal on the page is.
 *
 * THE HEADLINE, and it settles the Burrow question by itself: across every
 * season where the records allow keepers to be separated from picks, the most
 * expensive quarterback anybody in this league has EVER declared is a round-6
 * price. A round-3 quarterback keeper would be three full rounds beyond
 * anything in the league's recorded history. Nobody has ever kept a defence at
 * any price.
 *
 * ============================================================================
 * METHOD, AND ITS ONE REAL SUBTLETY
 * ============================================================================
 *
 * A KEEPER OCCUPIES HIS COST-ROUND SLOT ON THESE SHEETS, so a draft sheet alone
 * cannot tell a kept player from a drafted one — they look identical, and
 * `data/RECONCILIATION.md` says so. Counting "quarterbacks off the board by
 * round 4" off a raw sheet therefore mixes decisions with declarations.
 *
 * So a season is only usable when BOTH a draft sheet and that season's keeper
 * list survive, and a player is counted as a DECLARED KEEPER when the board has
 * him at round R and the keeper list prices him at R for the same season. That
 * is the league's own mechanic used as a join, and it recovers 24-29 keepers a
 * season against a permitted maximum of 20 — the excess is the older sheets
 * carrying more than two per franchise, which is what the keeper rules were at
 * the time.
 *
 * Six seasons qualify. 2023 has a draft sheet and no keeper list, 2022 has a
 * keeper list and no draft sheet, and 2017 is a text dump in a different shape;
 * all three are excluded rather than guessed at, and `seasons` says which were
 * used so a blurb can never overstate the sample.
 *
 * NULL IS A FIRST-CLASS ANSWER, as everywhere else in this codebase. If the
 * sheets cannot be read the prompt simply carries no norms section and says
 * nothing about positional prices, which is correct — inventing a threshold
 * would be a worse failure than having none. Nothing here may ever be a
 * fallback constant.
 *
 * Read once and cached for the life of the process, like `@/lib/league-lore`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { DRAFT, LEAGUE, STARTING_LINEUP } from "@/lib/league-config";

/** Positions as the rest of the app names them. The sheets say `DEF`. */
export type PositionKey = "QB" | "RB" | "WR" | "TE" | "DST";

/** Sheet position string to the league's own label. Anything else is noise. */
const POSITION: Record<string, PositionKey> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  DEF: "DST",
};

const POSITION_ORDER: PositionKey[] = ["QB", "RB", "WR", "TE", "DST"];

/**
 * Seasons where a draft sheet and that season's keeper list both survive, so
 * keepers can be told apart from picks. See the header for what is excluded.
 */
const SEASON_SOURCES: { season: number; draft: string; keepers: string }[] = [
  { season: 2018, draft: "2018-draft-by-round", keepers: "keeper-list-for-2018" },
  { season: 2019, draft: "2019-draft-by-round", keepers: "keeper-list-for-2019" },
  { season: 2020, draft: "2020-draft", keepers: "keeper-list-for-2020" },
  { season: 2021, draft: "2021-draft", keepers: "keeper-list-for-2021" },
  { season: 2024, draft: "2024-draft", keepers: "keeper-list-for-2024" },
  { season: 2025, draft: "2025-draft", keepers: "keeper-list-for-2025" },
];

/** What this league has actually been willing to pay to keep a position. */
export type KeeperPriceNorm = {
  position: PositionKey;
  /** Declarations found across `seasons`. The sample size, stated. */
  declarations: number;
  /** Earliest — most expensive — round anybody has ever paid. Null if never. */
  mostExpensiveRound: number | null;
  /** Who, and when, so the claim is checkable rather than asserted. */
  mostExpensiveExample: { player: string; season: number; manager: string } | null;
  medianRound: number | null;
  /** Latest round anybody has kept this position at. */
  cheapestRound: number | null;
};

/** Where the position actually comes off the board when people draft it. */
export type DraftPriceNorm = {
  position: PositionKey;
  /** How many the league starts in total — teams × slots. The demand. */
  starterDemand: number;
  /** Median round of the first one DRAFTED, keepers excluded. */
  firstDraftedMedianRound: number | null;
  firstDraftedRange: [number, number] | null;
  /**
   * Median round by which `starterDemand` of them are off the board, keepers
   * INCLUDED — a kept quarterback is a quarterback nobody else can have, so
   * for supply he counts. Null in seasons where that many never went at all,
   * which is itself the answer for defences.
   */
  demandMetMedianRound: number | null;
  demandMetRange: [number, number] | null;
  /** Seasons in which the league never took `starterDemand` of them at all. */
  seasonsDemandNeverMet: number;
};

export type PositionalNorms = {
  /** Seasons the figures are computed from. Never overstate this. */
  seasons: number[];
  /** Total declarations recovered, all positions. */
  declarations: number;
  keeperPrices: KeeperPriceNorm[];
  draftPrices: DraftPriceNorm[];
};

type Sheet = { rows: unknown[][] };

function sheet(name: string): Sheet | null {
  try {
    const file = path.join(process.cwd(), "data", "spreadsheets", `2026-draft__${name}.json`);
    return JSON.parse(readFileSync(file, "utf8")) as Sheet;
  } catch {
    return null;
  }
}

const text = (value: unknown): string => String(value ?? "").trim();

/**
 * Case-folded, punctuation- and suffix-stripped, for joining two spreadsheets
 * that disagree about both. Same forgiving shape as the dossier's own join, and
 * for the same reason: a missed match here silently turns a keeper into a pick
 * and moves a number the prompt then states as fact.
 */
function nameKey(value: unknown): string {
  return text(value)
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, "")
    .trim();
}

/** A row off a draft sheet, columns located by header rather than by position. */
type BoardRow = {
  player: string;
  position: PositionKey;
  round: number;
  pick: number;
  manager: string;
};

/**
 * The draft sheets do not agree on column ORDER — 2018 and 2019 lead with
 * `Pick`, 2020 onward with `Round`, and 2021 leads with `Player` — so every
 * column is found by its header name. Reading these by index is how a
 * positional norm quietly becomes a norm about the wrong column.
 */
function board(name: string): BoardRow[] {
  const data = sheet(name);
  if (!data?.rows?.length) return [];

  const header = (data.rows[0] ?? []).map((c) => text(c).toLowerCase());
  const at = (label: string) => header.indexOf(label);
  const iRound = at("round");
  const iPick = at("pick");
  const iPlayer = at("player");
  const iPosition = at("position");
  const iManager = at("league member");
  if (iRound < 0 || iPlayer < 0 || iPosition < 0) return [];

  const rows: BoardRow[] = [];
  for (const raw of data.rows.slice(1)) {
    const player = text(raw[iPlayer]);
    const position = POSITION[text(raw[iPosition]).toUpperCase()];
    const round = Number(raw[iRound]);
    // A few sheets carry stray rows whose columns have shifted, which show up
    // as an NFL team abbreviation in the position column. Unknown position is
    // the discriminator, and dropping those rows is right.
    if (!player || !position || !Number.isFinite(round) || round < 1 || round > DRAFT.rounds) {
      continue;
    }
    rows.push({
      player,
      position,
      round,
      pick: Number(raw[iPick]) || 0,
      manager: iManager < 0 ? "" : text(raw[iManager]),
    });
  }
  return rows.sort((a, b) => a.round - b.round || a.pick - b.pick);
}

/**
 * That season's keeper price for every eligible player.
 *
 * The keeper lists come in two shapes across the years. The newer ones carry a
 * column headed "2025 Round to Keep"; the older ones carry bare year columns
 * headed 2018, 2019, 2020, 2021 side by side, which is the same concept for
 * several seasons at once. Both are located by looking for the season, never by
 * index, and a sheet that offers neither returns nothing rather than a guess.
 */
function keeperPrices(name: string, season: number): Map<string, number> {
  const prices = new Map<string, number>();
  const data = sheet(name);
  if (!data?.rows?.length) return prices;

  const headerRow = data.rows.findIndex((r) =>
    (r ?? []).some((c) => text(c).toLowerCase() === "player"),
  );
  if (headerRow < 0) return prices;

  const header = (data.rows[headerRow] ?? []).map((c) => text(c));
  const lower = header.map((c) => c.toLowerCase());
  const iPlayer = lower.indexOf("player");
  let iPrice = lower.indexOf(`${season} round to keep`);
  if (iPrice < 0) iPrice = header.findIndex((c) => Number(c) === season);
  if (iPlayer < 0 || iPrice < 0) return prices;

  for (const raw of data.rows.slice(headerRow + 1)) {
    const player = nameKey(raw[iPlayer]);
    if (!player) continue;
    const price = Number(raw[iPrice]);
    // "N/A" and 0 both mean not keepable — 0 is the older sheets' way of saying
    // a round-1 price minus one round, which is not a round.
    if (!Number.isFinite(price) || price < 1 || price > DRAFT.rounds) continue;
    prices.set(player, price);
  }
  return prices;
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function range(values: readonly number[]): [number, number] | null {
  return values.length ? [Math.min(...values), Math.max(...values)] : null;
}

/** Total starting slots the league fields at a position: teams × slot count. */
function starterDemand(position: PositionKey): number {
  const slots = STARTING_LINEUP.filter((s) => s.slot === position).reduce(
    (n, s) => n + s.count,
    0,
  );
  return slots * LEAGUE.teams;
}

let cached: PositionalNorms | null | undefined;

export function positionalNorms(): PositionalNorms | null {
  if (cached !== undefined) return cached;

  type Declaration = { position: PositionKey; round: number; player: string; season: number; manager: string };
  const declarations: Declaration[] = [];
  const seasons: number[] = [];
  /** Per position, per season: first DRAFTED round, and demand-met round. */
  const firstDrafted = new Map<PositionKey, number[]>();
  const demandMet = new Map<PositionKey, number[]>();
  const demandUnmet = new Map<PositionKey, number>();

  for (const source of SEASON_SOURCES) {
    const rows = board(source.draft);
    const prices = keeperPrices(source.keepers, source.season);
    if (!rows.length || !prices.size) continue;
    seasons.push(source.season);

    for (const position of POSITION_ORDER) {
      const all = rows.filter((r) => r.position === position);
      const picks: BoardRow[] = [];
      for (const row of all) {
        if (prices.get(nameKey(row.player)) === row.round) {
          declarations.push({
            position,
            round: row.round,
            player: row.player,
            season: source.season,
            manager: row.manager,
          });
        } else {
          picks.push(row);
        }
      }

      if (picks.length) {
        firstDrafted.set(position, [...(firstDrafted.get(position) ?? []), picks[0].round]);
      }
      const demand = starterDemand(position);
      if (demand > 0 && all.length >= demand) {
        demandMet.set(position, [...(demandMet.get(position) ?? []), all[demand - 1].round]);
      } else if (demand > 0) {
        demandUnmet.set(position, (demandUnmet.get(position) ?? 0) + 1);
      }
    }
  }

  if (!seasons.length) {
    cached = null;
    return cached;
  }

  cached = {
    seasons,
    declarations: declarations.length,
    keeperPrices: POSITION_ORDER.map((position) => {
      const rows = declarations
        .filter((d) => d.position === position)
        .sort((a, b) => a.round - b.round);
      const top = rows[0];
      return {
        position,
        declarations: rows.length,
        mostExpensiveRound: top?.round ?? null,
        mostExpensiveExample: top
          ? { player: top.player, season: top.season, manager: top.manager }
          : null,
        medianRound: median(rows.map((r) => r.round)),
        cheapestRound: rows.length ? rows[rows.length - 1].round : null,
      };
    }),
    draftPrices: POSITION_ORDER.map((position) => {
      const first = firstDrafted.get(position) ?? [];
      const met = demandMet.get(position) ?? [];
      return {
        position,
        starterDemand: starterDemand(position),
        firstDraftedMedianRound: median(first),
        firstDraftedRange: range(first),
        demandMetMedianRound: median(met),
        demandMetRange: range(met),
        seasonsDemandNeverMet: demandUnmet.get(position) ?? 0,
      };
    }),
  };
  return cached;
}

/**
 * The marker the prompt's norms section is headed with, exported so a verifier
 * can prove the block still reaches the model.
 *
 * A heading rather than a sentence, for the same reason as the other markers in
 * `@/lib/recap-prompt`: prose gets reworded in ways that silently delete an
 * instruction, and a heading survives being moved.
 */
export const NORMS_MARKER = "WHAT THIS LEAGUE ACTUALLY PAYS FOR EACH POSITION";

/**
 * The norms as the prompt receives them: the principle, then the table.
 *
 * Empty string when there are no norms, so the caller can interpolate it
 * unconditionally and the prompt simply carries no positional-price section on
 * a checkout without the sheets. It must never fall back to prose thresholds —
 * the whole point is that these are measured.
 */
export function positionalNormsBlock(): string {
  const norms = positionalNorms();
  if (!norms) return "";

  const round = (value: number | null) => (value === null ? "—" : `R${value}`);

  const keeperLines = norms.keeperPrices.map((k) => {
    if (!k.declarations || k.mostExpensiveRound === null) {
      return `- **${k.position}: NOBODY HAS EVER KEPT ONE.** Not once, at any price, in ${norms.seasons.length} recorded seasons. A ${k.position} keeper would be unprecedented in this league.`;
    }
    const example = k.mostExpensiveExample;
    return (
      `- **${k.position}: the most expensive ever declared is ${round(k.mostExpensiveRound)}** ` +
      `(${example?.player}, ${example?.season}${example?.manager ? `, ${example.manager}` : ""}). ` +
      `Median ${round(k.medianRound)}, cheapest ${round(k.cheapestRound)}, across ${k.declarations} declaration${k.declarations === 1 ? "" : "s"}.`
    );
  });

  const draftLines = norms.draftPrices
    .filter((d) => d.starterDemand > 0)
    .map((d) => {
      const met =
        d.demandMetMedianRound === null
          ? `the league has never taken ${d.starterDemand} of them in a single draft`
          : `the ${d.starterDemand}th is off the board by ${round(d.demandMetMedianRound)} typically` +
            (d.demandMetRange && d.demandMetRange[0] !== d.demandMetRange[1]
              ? ` (${round(d.demandMetRange[0])}–${round(d.demandMetRange[1])})`
              : "") +
            (d.seasonsDemandNeverMet
              ? `, and in ${d.seasonsDemandNeverMet} of these seasons it never got there at all`
              : "");
      return (
        `- **${d.position}** — the league starts ${d.starterDemand} in total. ` +
        `First one DRAFTED usually goes ${round(d.firstDraftedMedianRound)}` +
        (d.firstDraftedRange && d.firstDraftedRange[0] !== d.firstDraftedRange[1]
          ? ` (${round(d.firstDraftedRange[0])}–${round(d.firstDraftedRange[1])})`
          : "") +
        `; ${met}.`
      );
    });

  return `## ${NORMS_MARKER}

Computed from this league's own sheets for ${norms.seasons.join(", ")} — ${norms.declarations} keeper declarations and every pick of six drafts. These are the yardstick. **A keeper price is defensible relative to where THIS LEAGUE actually drafts that position — never relative to the scoring settings, and never relative to external ADP.**

### Keeper prices anybody has actually been willing to pay

${keeperLines.join("\n")}

**A price more expensive than the most expensive ever paid at that position is not a bargain somebody passed up. It is a price no manager in the history of this league has accepted, and declining it is the obvious call rather than a blunder.** Say so that way round if you say anything at all.

### Where the position actually comes off the board

${draftLines.join("\n")}

### The trap this closes, because a blurb already fell in it

**${LEAGUE.teams} franchises start ONE quarterback each.** That is the shallowest demand in the draft, and it means replacement-level quarterback is cheap however many points a passing touchdown pays. The scoring rule in Part 3 is real and it is worth knowing, but it prices the PLAYER, not the SLOT — and a keeper price is an opportunity cost against the slot.

A shipped blurb told a manager to explain to the room why he had declined a quarterback at a round-3 keeper price, "in a league that pays six points for a passing touchdown". The most expensive quarterback keeper in this league's recorded history is a round-6 price. Nobody would pay a round 3, the manager's decision was obvious, and the recap criticised him for it in the imperative. The commissioner's verdict: "No one would touch a 3rd round QB keeper, not even close."

So, mechanically, before you praise OR condemn any keeper price:

1. Look up that position's most expensive and median price above.
2. **Cheaper than the median is good business and may be praised.** Sitting near the most expensive ever paid is a real argument to have. **More expensive than anything ever paid is a price nobody sane accepts, and passing on it is correct.**
3. The six-point passing touchdown is a reason a quarterback is worth ROSTERING, and an argument about WHEN to draft one. It is never on its own a reason a keeper price was worth paying.

**DO NOT DO ARITHMETIC ON THESE NUMBERS EITHER.** State the price and state the norm, side by side, and let the room do the subtraction — that is a stronger sentence anyway. A run that had these figures still got the gap wrong twice in one page, calling a round-10 quarterback keeper "one round cheaper than the median" when round 10 IS the median, and a round-12 one "three rounds cheaper" when it is two. Both times the error flattered the argument the sentence was already making, which is exactly how a wrong number gets past you. "He kept a quarterback at a twelfth; the median in this league is a tenth" needs no subtraction and cannot be wrong.

Where the table above says a norm could not be established, you have no norm. Say nothing about that price rather than reaching for the scoring settings again.`;
}

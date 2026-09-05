/**
 * Player matching for the draft board.
 *
 * This is the whole interaction. One practiced operator enters 160 picks while
 * ten people call names across a table, so the bar is: the player he means is
 * the top match after as few keystrokes as possible, and he never has to look
 * away from the board to check.
 *
 * Local and synchronous over the whole pool — no debounce, no request, no
 * network. The venue's wifi is not invited.
 *
 * What it forgives, in the order it prefers matches:
 *
 *   "gibbs"        last name alone, which is how names get called out loud
 *   "jahmyr"       first name
 *   "ja gi"        both, abbreviated
 *   "jamarr"       apostrophes and accents folded away ("Ja'Marr")
 *   "cmc"          well-known nicknames and initialisms
 *   "mike evans"   a nickname standing in for the real first name
 *   "jg"           initials
 *   "qb allen"     a leading position narrows the pool
 *   "jefferon"     a dropped letter
 *   "mccaffery"    a misspelling, via bounded edit distance
 *   "niners"       a team defense by what the room calls it
 *   "ravens dst"   a trailing D marker, which narrows to defenses
 *   "walker iii"   a suffix the pool does not store
 *
 * The edit-distance pass is the expensive one, so it only runs for tokens whose
 * length is close enough to be plausible and only after the cheap checks have
 * failed. Over ~1,200 players that keeps a keystroke well inside a frame.
 */

import { DRAFTABLE_POSITIONS } from "@/lib/board-types";

export type Searchable = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  /** Consensus ADP. Breaks ties, so the better-known player wins an equal match. */
  adp: number | null;
};

export type SearchIndexEntry<T extends Searchable> = {
  item: T;
  /** Lowercased, unaccented, punctuation stripped: "Ja'Marr Chase" → "jamarr chase". */
  normalized: string;
  /** Same, with spaces removed, for run-together typing. */
  collapsed: string;
  tokens: string[];
  /** Tokens minus generational suffixes — what a surname match should look at. */
  nameTokens: string[];
  initials: string;
  /** Nicknames and initialisms that should resolve to this player. */
  aliases: string[];
};

export type SearchIndex<T extends Searchable> = SearchIndexEntry<T>[];

const POSITION_SET = new Set<string>(DRAFTABLE_POSITIONS);
/** Generational suffixes are noise in a name match and break initials. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

/**
 * Given-name equivalences. The room calls a player what it calls him, which is
 * not always what the ranking feed calls him. Keyed by what gets TYPED; the
 * values are what might be in the data, and vice versa — the lookup runs both
 * ways so "mike"→"michael" and "michael"→"mike" both work.
 */
const GIVEN_NAME_VARIANTS: string[][] = [
  ["mike", "michael"],
  ["chris", "christopher"],
  ["rob", "robert", "bob", "bobby"],
  ["will", "william", "bill", "billy"],
  ["jim", "james", "jimmy", "jamie"],
  ["joe", "joseph", "joey"],
  ["tony", "anthony"],
  ["nick", "nicholas"],
  ["dave", "david"],
  ["dan", "daniel", "danny"],
  ["matt", "matthew"],
  ["josh", "joshua"],
  ["zach", "zachary", "zack"],
  ["ben", "benjamin", "benny"],
  ["sam", "samuel", "sammy"],
  ["tom", "thomas", "tommy"],
  ["ken", "kenneth", "kenny"],
  ["ted", "theodore", "teddy"],
  ["jeff", "jeffrey"],
  ["greg", "gregory"],
  ["rick", "richard", "rich", "richie"],
  ["andy", "andrew", "drew"],
  ["alex", "alexander"],
  ["nate", "nathaniel", "nathan"],
  ["gabe", "gabriel"],
  ["cam", "cameron"],
  ["ty", "tyler"],
  ["ken", "kendrick"],
  ["tre", "trey"],
  ["deebo", "debo"],
  ["marv", "marvin"],
  ["calvin", "cal"],
  ["kenny", "kenneth"],
  ["jon", "jonathan", "john", "johnny"],
  ["pat", "patrick"],
  ["steve", "stephen", "steven"],
  ["tj", "t j"],
  ["aj", "a j"],
  ["dj", "d j"],
  ["cj", "c j"],
  ["jk", "j k"],
  ["dk", "d k"],
];

const VARIANTS_BY_TOKEN = new Map<string, string[]>();
for (const group of GIVEN_NAME_VARIANTS) {
  for (const token of group) {
    const others = group.filter((t) => t !== token);
    VARIANTS_BY_TOKEN.set(token, [...(VARIANTS_BY_TOKEN.get(token) ?? []), ...others]);
  }
}

/**
 * True for a given name this file deliberately treats as interchangeable with a
 * more common spelling. Typing one of these bare surfaces the common form
 * first — "tommy" leads with the Thomases — which is the intended trade, and
 * the verification exempts these rather than asserting the opposite.
 */
export function isGivenNameVariant(token: string): boolean {
  return VARIANTS_BY_TOKEN.has(token);
}

/**
 * Whole-player nicknames — the ones a room shouts that bear no resemblance to
 * the roster name. Keyed by the nickname, valued by a substring of the real
 * normalized name. Deliberately short: a wrong entry here would silently
 * mis-resolve a pick, which is worse than making him type two more letters.
 */
export const PLAYER_NICKNAMES: Record<string, string> = {
  cmc: "christian mccaffrey",
  jsn: "jaxon smith njigba",
  zeke: "ezekiel elliott",
  hollywood: "marquise brown",
  ceedee: "ceedee lamb",
  bijan: "bijan robinson",
  saquon: "saquon barkley",
  jjettas: "justin jefferson",
  jettas: "justin jefferson",
  jamo: "jameson williams",
  etn: "travis etienne",
  aiyuk: "brandon aiyuk",
  amon: "amon ra st brown",
  amonra: "amon ra st brown",
  strown: "amon ra st brown",
  arsb: "amon ra st brown",
  nabers: "malik nabers",
  bowers: "brock bowers",
  lamb: "ceedee lamb",
  jayden: "jayden daniels",
  jj: "justin jefferson",
  pittman: "michael pittman",
  // Matched against the NORMALIZED name, where "T.J. Hockenson" is
  // "t j hockenson" — so a target of "tj hockenson" would never fire.
  hock: "hockenson",
  mhj: "marvin harrison",
  btj: "brian thomas",
  dhop: "deandre hopkins",
  okc: "oronde gadsden",
  tank: "tank dell",
  quon: "saquon barkley",
  gibby: "jahmyr gibbs",
};

/**
 * A nickname standing in for the given name, so "hollywood brown" reaches
 * Marquise Brown the same way "mike evans" reaches Michael.
 *
 * Derived from the table above rather than written out twice, and applied ONLY
 * when the query has another token to go with it. On its own, "pittman" already
 * resolves through the alias; expanding it to "michael" as well would fill the
 * rest of the list with unrelated Michaels and push the other candidates out of
 * the six the overlay shows.
 */
const NICKNAME_GIVEN_NAME = new Map<string, string>();
for (const [nickname, target] of Object.entries(PLAYER_NICKNAMES)) {
  const given = target.split(" ")[0];
  if (given && given !== nickname) NICKNAME_GIVEN_NAME.set(nickname, given);
}

/**
 * Team defenses, by what gets shouted rather than what the feed calls them.
 *
 * The pool stores all 32 as full city names — "New England Patriots" — and no
 * one in the room says that. Ten defenses go on Saturday, all in the late
 * rounds when the table is loud and nobody is patient, so this is the position
 * most likely to cost the operator time.
 *
 * Keyed by NFL code, which is stable and is what the board already prints in
 * the cell. The code ITSELF is registered automatically, so it never needs
 * repeating below — "ne", "sf", "jax" all work without an entry.
 *
 * Only add what the canonical name does not already cover. The mascot alone
 * ("patriots", "ravens", "49ers") and the city alone ("seattle", "denver")
 * already resolve on their own and are deliberately absent. Multi-word entries
 * are fine; spaces are folded away when the index is built.
 *
 * This is meant to be edited on Friday night by someone who is not a
 * programmer. Add a line, restart, done.
 *
 * Exported so the verification can walk it. An alias pointing at somebody the
 * pool no longer carries is dead weight that fails silently — four of the
 * player nicknames had rotted that way before anything checked.
 */
export const DEFENSE_ALIASES: Record<string, string[]> = {
  ARI: ["az", "cards"],
  ATL: ["dirty birds"],
  BAL: ["ratbirds"],
  BUF: ["bflo"],
  CAR: ["panthers d", "cats"],
  CHI: ["da bears"],
  CIN: ["cincy", "bungles"],
  CLE: ["dawgs"],
  DAL: ["boys", "cowboys d"],
  DEN: ["broncs"],
  DET: ["lions d"],
  GB: ["pack", "green bay"],
  HOU: ["texans d"],
  IND: ["indy"],
  JAX: ["jags", "jacksonville"],
  KC: ["chiefs d"],
  LV: ["vegas", "raiders d"],
  LAC: ["bolts", "chargers d"],
  LAR: ["rams d"],
  MIA: ["fins", "phins"],
  MIN: ["vikes", "skol"],
  NE: ["pats", "patriots d"],
  NO: ["nola", "saints d"],
  NYG: ["gmen", "g men", "giants d"],
  NYJ: ["jets d"],
  PHI: ["birds", "iggles"],
  PIT: ["steel curtain"],
  SF: ["niners", "9ers"],
  SEA: ["hawks", "legion of boom"],
  TB: ["bucs", "tampa"],
  TEN: ["titans d"],
  WAS: ["skins", "commies", "washington d"],
};

/**
 * The marker people habitually put after a team: "patriots d", "ravens dst",
 * "eagles d/st". It means "the defense", so it is treated exactly like the
 * leading position token in "qb allen" — dropped from the query, and used to
 * narrow the pool to defenses.
 *
 * This is what makes a bare ambiguous city work. Nine players are named
 * Washington and they all legitimately outrank the Commanders for
 * "washington"; "washington d" is unambiguous and lands on the defense.
 */
const DEFENSE_MARKERS = new Set(["d", "dst", "def", "defense", "ds"]);

/**
 * Strips a trailing defense marker. Returns the query without it, or null when
 * there is no marker — or when removing it would leave nothing to search for,
 * since "d" on its own is a letter rather than a request for every defense.
 */
function stripDefenseMarker(tokens: string[]): string[] | null {
  // "d/st" normalizes to two tokens and has to come off as a pair.
  if (tokens.length >= 3 && tokens[tokens.length - 2] === "d" && tokens[tokens.length - 1] === "st") {
    return tokens.slice(0, -2);
  }
  if (tokens.length >= 2 && DEFENSE_MARKERS.has(tokens[tokens.length - 1])) {
    return tokens.slice(0, -1);
  }
  return null;
}

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Initials that survive an internal capital: "McCaffrey" contributes both "m"
 * and "c", which is what makes "cmc" reachable.
 */
function initialsFor(rawName: string, nameTokens: string[]): string[] {
  const plain = nameTokens.map((t) => t[0]).join("");
  const withInnerCaps = rawName
    .replace(/[^A-Za-z\s]/g, "")
    .split(/\s+/)
    .flatMap((word) => word.match(/[A-Z]/g) ?? [word[0]?.toUpperCase() ?? ""])
    .join("")
    .toLowerCase();
  return withInnerCaps && withInnerCaps !== plain ? [plain, withInnerCaps] : [plain];
}

/** Build once per pool. Re-deriving this per keystroke is the slow way. */
export function buildSearchIndex<T extends Searchable>(items: T[]): SearchIndex<T> {
  const nicknameTargets = Object.entries(PLAYER_NICKNAMES);

  return items.map((item) => {
    const normalized = normalizeName(item.name);
    const tokens = normalized.split(" ").filter(Boolean);
    const nameTokens = tokens.filter((t) => !SUFFIXES.has(t));
    const initials = initialsFor(item.name, nameTokens);
    const aliases = nicknameTargets
      .filter(([, target]) => normalized.includes(target))
      .map(([nickname]) => nickname);

    /**
     * A defense answers to its NFL code and to whatever the room calls it.
     * Collapsed on the way in so multi-word entries ("dirty birds") match the
     * same way everything else does.
     */
    if (item.position === "DST" && item.nflTeam) {
      const code = item.nflTeam.toUpperCase();
      aliases.push(normalizeName(code).replace(/ /g, ""));
      for (const alias of DEFENSE_ALIASES[code] ?? []) {
        aliases.push(normalizeName(alias).replace(/ /g, ""));
      }
    }

    return {
      item,
      normalized,
      collapsed: normalized.replace(/ /g, ""),
      tokens,
      nameTokens,
      initials: initials[0],
      aliases: [...aliases, ...initials.slice(1)],
    };
  });
}

/** True when every character of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

/**
 * Edit distance capped at `max`, counting adjacent transpositions as one edit
 * ("Damerau"), because transposing two letters is the classic fast-typing slip.
 * Returns `max + 1` for anything further away, so callers can compare cheaply.
 */
function boundedEditDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  let previous2: number[] = [];
  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = [];

  for (let i = 1; i <= a.length; i++) {
    current = [i];
    let rowBest = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, previous2[j - 2] + 1);
      }
      current[j] = value;
      if (value < rowBest) rowBest = value;
    }
    // Every future row can only grow, so an entire row above the cap is fatal.
    if (rowBest > max) return max + 1;
    previous2 = previous;
    previous = current;
  }
  return previous[b.length];
}

/** How wrong a typed word is allowed to be before it stops being that word. */
function editBudget(length: number): number {
  if (length >= 7) return 2;
  if (length >= 4) return 1;
  return 0;
}

/**
 * Every query token must prefix a distinct name token, left to right. This is
 * what makes "ja gi" resolve to Jahmyr Gibbs.
 */
function tokensPrefixInOrder(queryTokens: string[], nameTokens: string[]): boolean {
  let from = 0;
  for (const q of queryTokens) {
    const at = nameTokens.findIndex((t, i) => i >= from && t.startsWith(q));
    if (at === -1) return false;
    from = at + 1;
  }
  return true;
}

/**
 * Score for one player against one already-normalized query. Higher is better;
 * 0 means no match. The bands are spaced widely so a later tie-break on ADP
 * never promotes a worse KIND of match above a better one.
 */
function scoreEntry<T extends Searchable>(
  entry: SearchIndexEntry<T>,
  query: string,
  queryTokens: string[],
  collapsedQuery: string,
): number {
  if (entry.normalized === query) return 1200;
  if (entry.aliases.includes(collapsedQuery)) return 1100;

  const lastToken = entry.nameTokens[entry.nameTokens.length - 1];

  /**
   * A whole token typed exactly beats the same token merely being a prefix.
   * Without this, "brown" resolves to the Cleveland Browns — "browns" starts
   * with "brown" — ahead of every actual player named Brown.
   */
  if (lastToken === query) return 990;
  if (entry.nameTokens.includes(query)) return 985;

  const tokenPrefix = entry.nameTokens.findIndex((t) => t.startsWith(query));
  const isSurname = tokenPrefix !== -1 && tokenPrefix === entry.nameTokens.length - 1;

  /**
   * A SURNAME prefix outranks a full-name prefix, which is not the obvious
   * ordering and is there for a specific reason: one word shouted across a room
   * is almost always a surname. "chase" has to reach Ja'Marr Chase, not Chase
   * Brown, even though "Chase Brown" literally starts with the letters typed.
   * Getting this backwards is a wrong pick, not a slow one.
   */
  if (isSurname) return 980;
  // Run-together and first-name typing: "jahmyr", "jamarr", "chasebro".
  if (entry.collapsed.startsWith(collapsedQuery)) return 950;
  // A middle name, or any other token that is neither first nor last.
  if (tokenPrefix !== -1) return 900;

  if (collapsedQuery.length >= 2 && entry.initials.startsWith(collapsedQuery)) return 860;
  if (queryTokens.length > 1 && tokensPrefixInOrder(queryTokens, entry.nameTokens)) return 800;
  if (entry.normalized.includes(query)) return 600;

  // Misspellings. Compared against each name token and against the whole
  // collapsed name, so both "mccaffery" and "chrismccaffery" land.
  const tokenBudget = editBudget(collapsedQuery.length);
  if (tokenBudget > 0) {
    let best = tokenBudget + 1;
    for (const token of entry.nameTokens) {
      const distance = boundedEditDistance(collapsedQuery, token, tokenBudget);
      if (distance < best) best = distance;
    }
    if (best <= tokenBudget) return 520 - best * 40;

    if (collapsedQuery.length >= 6) {
      const whole = boundedEditDistance(collapsedQuery, entry.collapsed, tokenBudget);
      if (whole <= tokenBudget) return 500 - whole * 40;
    }
  }

  // Last resort: dropped letters anywhere. Only for queries long enough that a
  // subsequence hit means something.
  if (collapsedQuery.length >= 4 && isSubsequence(collapsedQuery, entry.collapsed)) return 300;

  return 0;
}

export type SearchOptions = {
  limit?: number;
  /**
   * Players already on the board. NOT filtered out — the commissioner overrules
   * the software, so a drafted player stays findable and the board warns
   * instead. They are pushed below every undrafted match.
   */
  drafted?: ReadonlySet<string>;
  position?: string | null;
};

export type SearchResult<T extends Searchable> = {
  item: T;
  score: number;
  /** True when this player is already on the board somewhere. */
  drafted: boolean;
};

/** Expands a query into the variants worth scoring: the typed one plus nicknames. */
function queryVariants(query: string, tokens: string[]): string[] {
  if (tokens.length === 0) return [query];
  const variants = new Set<string>([query]);
  for (let i = 0; i < tokens.length; i++) {
    const swaps = [...(VARIANTS_BY_TOKEN.get(tokens[i]) ?? [])];
    // Only with something else alongside it — see NICKNAME_GIVEN_NAME.
    if (tokens.length > 1) {
      const given = NICKNAME_GIVEN_NAME.get(tokens[i]);
      if (given) swaps.push(given);
    }
    for (const swap of swaps) {
      const copy = [...tokens];
      copy[i] = swap;
      variants.add(copy.join(" "));
    }
  }
  return [...variants];
}

/**
 * Ranked matches. An empty query returns nothing: this board has no browsable
 * player list, and showing one uninvited would be exactly the panel the
 * commissioner asked to have removed.
 */
export function searchPlayers<T extends Searchable>(
  index: SearchIndex<T>,
  rawQuery: string,
  options: SearchOptions = {},
): SearchResult<T>[] {
  const { limit = 8, drafted, position } = options;

  let query = normalizeName(rawQuery);
  let positionFilter = position ?? null;

  // A leading position narrows the pool: "qb allen", "rb hen".
  const firstSpace = query.indexOf(" ");
  const head = (firstSpace === -1 ? query : query.slice(0, firstSpace)).toUpperCase();
  if (POSITION_SET.has(head) && firstSpace !== -1) {
    positionFilter = head;
    query = query.slice(firstSpace + 1).trim();
  }

  if (!query) return [];

  /**
   * Generational suffixes come off the query, because the pool drops them
   * entirely: it stores "Kenneth Walker", while ESPN and the league's own
   * spreadsheets say "Kenneth Walker III". The index already strips them from
   * the stored side, so doing it here just makes the two agree.
   *
   * Without this the shorter suffixes survive on edit distance alone — "jr" and
   * "ii" are within budget, "iii" is not, so every III in the pool was
   * unreachable while every Jr worked. That is the kind of accident that holds
   * until the one name it breaks on is called out loud.
   */
  {
    const tokens = query.split(" ").filter(Boolean);
    let end = tokens.length;
    while (end > 1 && SUFFIXES.has(tokens[end - 1])) end--;
    if (end < tokens.length) query = tokens.slice(0, end).join(" ");
  }

  /**
   * A trailing "d" / "dst" / "d/st" narrows to defenses the same way a leading
   * position does. If it turns out nothing matches under that reading, the
   * original query is retried unfiltered — so a name that merely happens to end
   * in one of those letters is never made unfindable by this.
   */
  let markerless: string | null = null;
  if (!positionFilter) {
    const stripped = stripDefenseMarker(query.split(" ").filter(Boolean));
    if (stripped && stripped.length > 0) markerless = stripped.join(" ");
  }

  const run = (effective: string, filter: string | null): SearchResult<T>[] => {
    const variants = queryVariants(effective, effective.split(" ").filter(Boolean)).map((v) => ({
      query: v,
      tokens: v.split(" ").filter(Boolean),
      collapsed: v.replace(/ /g, ""),
    }));

    const results: SearchResult<T>[] = [];
    for (const entry of index) {
      if (filter && entry.item.position !== filter) continue;

      let score = 0;
      for (const variant of variants) {
        // The typed spelling is authoritative; a nickname expansion that happens
        // to score higher must not outrank a literal match.
        const candidate = scoreEntry(entry, variant.query, variant.tokens, variant.collapsed);
        const adjusted = variant.query === effective ? candidate : candidate - 1;
        if (adjusted > score) score = adjusted;
      }

      if (score > 0) {
        results.push({ item: entry.item, score, drafted: drafted?.has(entry.item.id) ?? false });
      }
    }

    results.sort((a, b) => {
      // Anyone already drafted sinks, however well he matched.
      if (a.drafted !== b.drafted) return a.drafted ? 1 : -1;
      if (b.score !== a.score) return b.score - a.score;
      const aa = a.item.adp ?? Number.POSITIVE_INFINITY;
      const ba = b.item.adp ?? Number.POSITIVE_INFINITY;
      if (aa !== ba) return aa - ba;
      return a.item.name.localeCompare(b.item.name);
    });

    return results.slice(0, limit);
  };

  if (markerless) {
    const defenses = run(markerless, "DST");
    if (defenses.length > 0) return defenses;
  }

  return run(query, positionFilter);
}

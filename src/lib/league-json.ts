import "server-only";

import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  CURRENT_SEASON,
  DRAFT,
  KEEPERS,
  LEAGUE,
  TRADES,
  franchiseByShortName,
} from "@/lib/league-config";
import {
  clockPosition,
  describeClock,
  evaluateKeeperEligibility,
  keeperCostRound,
  seasonsKeptEnteringSheetSeason,
} from "@/lib/keeper-clock";
import {
  describeDisputedClock,
  findTenureDispute,
} from "@/lib/keeper-tenure-dispute";
import { pickTradableSeasons } from "@/lib/trade-rules";
import {
  pickLabel,
  pickRefLabel,
  type FranchiseDetailView,
  type FranchiseKeeper,
  type KeeperDeclarationStatus,
  type FranchisePickView,
  type FranchiseView,
  type IneligibleDeclaration,
  type KeeperBoardView,
  type KeeperConflict,
  type KeeperEntry,
  type KeeperRoomSync,
  type PendingDeclaration,
  type TradeBoardView,
  type TradeLogEntry,
  type TradeLogPick,
  type TradeLogPlayer,
  type TradeLogSide,
  type TradedPickView,
} from "@/lib/league-view";

/**
 * The league's franchises, keepers, and trades read straight out of `data/`.
 *
 * This is the no-database path, and it is the one that has to work on Saturday.
 * It follows the same shape as the draft board's reader: the files are read with
 * `fs` rather than imported, so nothing large lands in a bundle and a re-pull of
 * a snapshot takes effect on the next request without a rebuild.
 *
 * This module is the ONLY place that knows the shape of these JSON files.
 * Everything upstream consumes `@/lib/league-view`.
 *
 * Sources, most authoritative first:
 *
 *   data/DECISIONS.md                    the commissioner's rulings. Encoded
 *                                        below as explicit overrides, each one
 *                                        commented with what it settles.
 *   data/managers.json                   the ten franchises, their managers, and
 *                                        the 2026 draft slots.
 *   data/smartdraft-room-snapshot.json   the live room: 160 slots, who owns each
 *                                        one now, and the keeper declarations.
 *   data/keepers-2026-resolved.json      keeper clock, already reconciled
 *                                        against the KEEPER LIST sheet.
 *   data/keeper-eligibility-2026.json    the full 167-row keeper sheet, used for
 *                                        declarations the resolved file predates.
 *   data/trade-log-2026-spreadsheet.json the commissioner's own 12-trade log.
 */

const ROOM_FILE = "smartdraft-room-snapshot.json";
const MANAGERS_FILE = "managers.json";
const KEEPERS_RESOLVED_FILE = "keepers-2026-resolved.json";
const KEEPER_ELIGIBILITY_FILE = "keeper-eligibility-2026.json";
const TRADE_LOG_FILE = "trade-log-2026-spreadsheet.json";
const DECLARATIONS_FILE = "keeper-declarations.json";
const PLAYERS_FILE = "smartdraft-players.json";

// --- Raw file shapes --------------------------------------------------------

type RawTeam = {
  id: string;
  name: string;
  ownerName: string | null;
  orderKey: number;
  deletedAt: string | null;
};

type RawPlayer = {
  id: number;
  name: string;
  position: string;
  nflTeam: string | null;
  byeWeek: number | null;
};

type RawSlot = {
  slotKey: string;
  originalOwnerTeamId: string;
  currentOwnerTeamId: string;
  pickType: string | null;
  player: RawPlayer | null;
  displayRound: number;
  pickInRound: number;
  overallPick: number;
};

type RawRoom = {
  state: {
    draftRoundCount: number;
    teams: RawTeam[];
    slots: RawSlot[];
  };
};

type RawManager = {
  shortName: string;
  fullName: string;
  franchiseName: string;
  smartDraftTeamId: string;
  draftSlot2026: number;
  franchiseAbbrev: string;
  espnTeamId: number | null;
};

type RawManagers = { managers: RawManager[] };

type RawResolvedKeeper = {
  player: string;
  owner: string;
  costRound: number;
  priorSeasonCostRound: number | null;
  /** The sheets' "N of 3" for 2026. Null where it could not be resolved. */
  clockYear2026: number | null;
  isFinalKeeperSeason: boolean | null;
  keepableIn2027: boolean | null;
  acquiredByTradePerSpreadsheet: boolean;
  conflicts: string[];
  UNRESOLVED?: string;
};

type RawResolved = { keepers: RawResolvedKeeper[] };

type RawEligibilityPlayer = {
  player: string;
  position: string;
  /** Short name — the safe key. */
  manager: string;
  /** Full name, for messages. Two Scotts and two Kyles, so never a match key. */
  managerFullName?: string | null;
  round2025: number | null;
  status2026: string | null;
  roundToKeep2026: number | null;
};

type RawEligibility = { players: RawEligibilityPlayer[] };

type RawTradeSide = {
  member: string;
  playersReceived: string[] | null;
  picksReceived: { round: number | string; year: number }[] | null;
};

type RawTrade = {
  tradeNumber: number;
  sideA: RawTradeSide;
  sideB: RawTradeSide;
  notes: string[] | null;
};

type RawTradeLog = { trades: RawTrade[] };

/** Declarations the commissioner has taken that the room does not show yet. */
type RawDeclaration = {
  /** SHORT name, never a first name. Four managers share a first name. */
  managerShortName: string;
  players: string[];
  declaredAt?: string | null;
  /**
   * The manager's list is FINAL and any slot he left empty is a deliberate
   * pass. Nobody is required to fill every keeper slot, and without this the
   * short list is indistinguishable from one that never arrived.
   */
  closesList?: boolean | null;
  note?: string | null;
};

type RawDeclarations = { declarations: RawDeclaration[] };

type RawPoolPlayer = RawPlayer & { adp: number | null };
type RawPool = { players: RawPoolPlayer[] };

// --- File access ------------------------------------------------------------

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}

function readData<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(dataPath(file), "utf8")) as T;
  } catch (cause) {
    throw new Error(
      `Could not read data/${file}. The snapshots in data/ are what these ` +
        `pages run on until the league database is connected.`,
      { cause },
    );
  }
}

/** These files carry no timestamp of their own, so the file's mtime is it. */
function mtime(file: string): string | null {
  try {
    return statSync(dataPath(file)).mtime.toISOString();
  } catch {
    return null;
  }
}

// ===========================================================================
// COMMISSIONER RULINGS
// ===========================================================================
// Recorded in `data/DECISIONS.md`. These override both the Smart Draft room and
// the ESPN league, so they are applied here rather than left to whichever file
// happens to be read last.

/**
 * Puka Nacua is Scott's at R11.
 *
 * The Johnston/Blome contract structures two trades. The 2025 leg sent Nacua to
 * Greg; the contingent 2026 leg sends him back to Scott the day before the
 * draft, and fires unless Nacua is projected to miss six or more weeks. The
 * commissioner has ruled that the contingency is downside protection that has
 * not triggered, so Nacua is Scott's — which is what the live room already
 * says, and what the keeper sheet (which has him on Greg) does not.
 *
 * The contract also removes all doubt about the price: he "shall retain his 2026
 * League Draft 11th round draft Keeper eligibility whether or not the Contingent
 * 2026 Trade is consummated."
 *
 * The clock is the subtle part. A trade restarts keeper eligibility with the new
 * team while the player keeps his previous season's round, so 2026 is Scott's
 * ACQUISITION season — tenure "1 of 3", no keeper seasons served — and the rule
 * as written lets him hold Nacua through 2028. `data/DECISIONS.md` flags that as
 * a loophole for the league to close rather than a bug to work around here.
 */
const NACUA_RULING = {
  playerName: "Puka Nacua",
  ownerShortName: "Scott",
  sheetTenureYear: 1,
  clockResetByTrade: true,
  conflict: {
    summary: "Keeper sheet has him on Greg Blome at 2 of 3; the live room has him on Scott.",
    resolution:
      "Commissioner ruling: Nacua is Scott's at R11. The trade restarted his clock, " +
      "so 2026 is his acquisition season and he stays keepable through 2028.",
  },
} as const;

/**
 * Colston Loveland costs R9, not the sheet's R8.
 *
 * He was a free-agent acquisition, and the contract prices a free agent at the
 * 9th round. Two further facts point the same way: Stefan owns no round-8 pick
 * in 2026, having traded it to Witte, so R8 is unusable; and the `9` in the
 * sheet's round column is the free-agent placeholder rather than a real 2025
 * round. So the `9` values in the 2026 keeper sheet are correct rather than a
 * formula bug.
 */
const LOVELAND_RULING = {
  playerName: "Colston Loveland",
  costRound: 9,
  isUndrafted: true,
  conflict: {
    summary: "Keeper sheet computes R8; the live room has R9.",
    resolution:
      "Commissioner ruling: R9. He was a free-agent acquisition, and a free agent " +
      "costs the 9th round. Stefan also holds no round-8 pick, having traded it away.",
  },
} as const;

/** The day the contingent Nacua leg executes — the day before the draft. */
const CONTINGENT_TRADE_RESOLVES = "2026-08-28";

const CONTINGENT_TRADE_NOTE =
  "Provisional until " +
  CONTINGENT_TRADE_RESOLVES +
  ", the day before the draft. This is the Johnston/Blome contingent leg: it " +
  "returns Puka Nacua to Scott unless a majority of media outlets project him " +
  "to miss six or more weeks of 2026 through injury, in which case Scott — not " +
  "Greg — chooses whether to go through with it. The commissioner has ruled " +
  "Nacua is Scott's; worth one last check on Friday before the board is printed.";

// --- Franchise roster -------------------------------------------------------

type Franchise = {
  id: string;
  shortName: string;
  franchiseName: string;
  abbrev: string;
  manager: string;
  draftSlot: number | null;
  espnTeamId: number | null;
};

/**
 * The ten franchises. `data/managers.json` is the join of three sources — Smart
 * Draft short names, the KEEPER LIST sheets' full names, and the ESPN franchise
 * names — and already carries the ruling that Ted Buckman and Zach Rakowski are
 * the same person, so "Perpetually Impaired" is Zach's.
 *
 * Falls back to `league-config`'s roster for anything the file is missing, so a
 * franchise can never lose its name to a stale snapshot.
 */
function readFranchises(): Franchise[] {
  const { managers } = readData<RawManagers>(MANAGERS_FILE);
  const franchises = managers.map((m) => {
    const configured = franchiseByShortName(m.shortName);
    return {
      id: m.smartDraftTeamId,
      shortName: m.shortName,
      franchiseName: m.franchiseName || configured?.franchiseName || m.shortName,
      abbrev: m.franchiseAbbrev || configured?.abbrev || m.shortName.slice(0, 4).toUpperCase(),
      manager: m.fullName || configured?.manager || m.shortName,
      draftSlot: m.draftSlot2026 ?? null,
      espnTeamId: m.espnTeamId ?? null,
    };
  });
  assertShortNamesAreUnique(franchises);
  return franchises;
}

// ===========================================================================
// MANAGER IDENTITY — FIRST NAMES ARE NOT UNIQUE IN THIS LEAGUE
// ===========================================================================
// Four of the ten managers share a first name with someone else:
//
//   Scott Elbe      -> short name "Elbe"
//   Scott Johnston  -> short name "Scott"
//   Kyle Witte      -> short name "Witte"
//   Kyle Mertens    -> short name "Kyle"
//
// Note the trap: "Scott" and "Kyle" are BOTH a legitimate short name for one
// manager AND the first name of a different one. So a first-name match does not
// merely fail, it silently resolves to the wrong franchise — and puts a wrong
// name in a wrong cell on the board.
//
// THE RULE: match a manager on the SHORT NAME or on a stable id
// (`smartDraftTeamId`, `espnTeamId`, or the database's `teams.id`). NEVER on a
// first name, and never on a full name without an exact match. The guards below
// make a violation loud instead of silent.
// ===========================================================================

function assertShortNamesAreUnique(franchises: Franchise[]): void {
  const seen = new Map<string, string>();
  for (const f of franchises) {
    const key = f.shortName.trim().toLowerCase();
    const clash = seen.get(key);
    if (clash) {
      throw new Error(
        `data/${MANAGERS_FILE}: "${f.shortName}" is the short name of both ` +
          `${clash} and ${f.manager}. Short names are the join key for every ` +
          `other source, so they must be unique.`,
      );
    }
    seen.set(key, f.manager);
  }
}

/**
 * Resolve a franchise by the short name a data file supplied.
 *
 * Refuses to guess. A value that is not a short name but IS the first name of
 * two managers throws rather than picking one, because that is the exact shape
 * of the bug this league is prone to.
 */
function franchiseByName(
  franchises: Franchise[],
  supplied: string,
  context: string,
): Franchise | null {
  const key = supplied.trim().toLowerCase();
  const exact = franchises.find((f) => f.shortName.trim().toLowerCase() === key);
  if (exact) return exact;

  const sharingFirstName = franchises.filter(
    (f) => f.manager.split(/\s+/)[0].toLowerCase() === key,
  );
  if (sharingFirstName.length > 1) {
    throw new Error(
      `${context}: "${supplied}" is ambiguous — it is the first name of ` +
        `${sharingFirstName.map((f) => `${f.manager} (short name "${f.shortName}")`).join(" and ")}. ` +
        `Use the short name, not the first name.`,
    );
  }

  const byFullName = franchises.find((f) => f.manager.toLowerCase() === key);
  return byFullName ?? null;
}

// --- Room snapshot ----------------------------------------------------------

type Room = {
  slots: RawSlot[];
  /** Smart Draft team id -> short name, for slots that reference a team. */
  nameById: Map<string, string>;
  rounds: number;
};

function readRoom(): Room {
  const { state } = readData<RawRoom>(ROOM_FILE);
  const active = state.teams.filter((t) => !t.deletedAt);
  return {
    slots: [...state.slots].sort((a, b) => a.overallPick - b.overallPick),
    nameById: new Map(active.map((t) => [t.id, t.name])),
    rounds: state.draftRoundCount || DRAFT.rounds,
  };
}

/**
 * Normalized names of every player the Smart Draft room carries on a KEEPER
 * slot. Exported because `@/lib/league-db` needs the same answer: the room file
 * is local, so this works on either data path and with the network down.
 */
export function roomKeeperNames(): Set<string> {
  try {
    const { state } = readData<RawRoom>(ROOM_FILE);
    return new Set(
      state.slots
        .filter((s) => s.pickType === "KEEPER" && s.player)
        .map((s) => normalizeName(s.player!.name)),
    );
  } catch {
    return new Set();
  }
}

/** Build the room-sync summary from a set of reconciled keepers. */
export function buildRoomSync(
  keepers: { playerName: string; teamShortName: string; manager: string; costRound: number }[],
): KeeperRoomSync {
  const inRoomNames = roomKeeperNames();
  const missingFromRoom = keepers
    .filter((k) => !inRoomNames.has(normalizeName(k.playerName)))
    .map((k) => ({
      playerName: k.playerName,
      teamShortName: k.teamShortName,
      manager: k.manager,
      costRound: k.costRound,
    }));
  return { inRoom: keepers.length - missingFromRoom.length, missingFromRoom };
}

// --- Keeper clock resolution ------------------------------------------------

/** `"2 of 3"` -> 2. Null for `"N/A"`, an empty cell, or anything unparseable. */
function parseSheetTenure(status: string | null | undefined): number | null {
  if (!status) return null;
  const m = /^\s*(\d+)\s+of\s+\d+\s*$/i.exec(status);
  return m ? Number(m[1]) : null;
}

/** Names are typed by hand across four files, so compare them loosely. */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z\s]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ClockFacts = {
  sheetTenureYear: number | null;
  basisRound: number | null;
  keepableIn2027: boolean | null;
  sources: string[];
  conflicts: KeeperConflict[];
};

/**
 * Assemble one keeper's clock from every file that mentions him.
 *
 * The resolved file is preferred because it has already been reconciled against
 * the sheet, but it predates the most recent declarations — Javonte Williams and
 * Cam Skattebo are in the room and not in it — so the full 167-row sheet is the
 * fallback. Either way the answer is the sheets' "N of 3" for 2026, and the
 * conversion to keeper seasons served happens in exactly one place below.
 *
 * OWNER-MATCHED, NOT NAME-MATCHED. Both source files are keyed by player, but a
 * row is only used when its manager agrees with the franchise the LIVE ROOM says
 * holds the player. A row belonging to another franchise is declined and
 * reported rather than silently believed: its round and clock describe that
 * franchise's tenure, not this one's, and the room is authoritative on
 * ownership. Puka Nacua is the live case — the sheet still has him on Greg while
 * the room and the commissioner have him on Scott — and it is exactly the shape
 * of mistake that the two Scotts and two Kyles make easy.
 */
function resolveClockFacts(
  playerName: string,
  ownerShortName: string,
  resolved: Map<string, RawResolvedKeeper>,
  sheet: Map<string, RawEligibilityPlayer>,
): ClockFacts {
  const key = normalizeName(playerName);
  const owner = ownerShortName.trim().toLowerCase();
  const sameOwner = (rowOwner: string | null | undefined) =>
    !!rowOwner && rowOwner.trim().toLowerCase() === owner;

  const rRow = resolved.get(key);
  const sRow = sheet.get(key);

  const r = sameOwner(rRow?.owner) ? rRow : undefined;
  const s = sameOwner(sRow?.manager) ? sRow : undefined;

  const sources: string[] = ["Smart Draft room"];
  const conflicts: KeeperConflict[] = [];

  // Declined rows are surfaced, because a keeper priced off another franchise's
  // tenure is worse than a keeper with an unknown clock.
  if (rRow && !r) {
    conflicts.push({
      summary:
        `The reconciled keeper list has ${playerName} on ${rRow.owner}, but the live ` +
        `room has him on ${ownerShortName}, so its clock was not used.`,
      resolution: null,
    });
  }
  if (sRow && !s) {
    conflicts.push({
      summary:
        `The keeper sheet has ${playerName} under ${sRow.managerFullName ?? sRow.manager}, ` +
        `but the live room has him on ${ownerShortName}, so its clock was not used.`,
      resolution: null,
    });
  }

  let sheetTenureYear: number | null = null;
  let basisRound: number | null = null;
  let keepableIn2027: boolean | null = null;

  if (r) {
    sources.push("2026 keeper list (reconciled)");
    sheetTenureYear = r.clockYear2026;
    basisRound = r.priorSeasonCostRound;
    keepableIn2027 = r.keepableIn2027;
    // Carry any disagreement the reconciliation already found, so the page can
    // show it rather than presenting a settled-looking number.
    for (const c of r.conflicts ?? []) {
      conflicts.push({ summary: c, resolution: null });
    }
  }

  if (sheetTenureYear == null && s) {
    sheetTenureYear = parseSheetTenure(s.status2026);
    basisRound ??= s.round2025;
  }
  if (s && !sources.includes("2026 keeper sheet")) {
    sources.push("2026 keeper sheet");
  }

  if (sheetTenureYear == null) {
    conflicts.push({
      summary: `No keeper-sheet row for ${playerName} on ${ownerShortName}.`,
      resolution: null,
    });
  }

  return { sheetTenureYear, basisRound, keepableIn2027, sources, conflicts };
}

/**
 * The three declaration states.
 *
 * Neither the Smart Draft room nor the workbooks can express "my list is
 * done" — they only ever show declared keepers, never a declaration of none.
 * The one place that records it is `closesList` in
 * `data/keeper-declarations.json`, which is also what the seed writes into
 * `teams.keeper_declarations_closed_at`, so both paths reach the same verdict.
 *
 * Absent that flag the answer is `awaiting`, which is the honest default: an
 * outstanding reply is the safer thing to show a commissioner than a settled
 * pass he never actually got.
 */
function declarationStatusFor(
  declared: number,
  allowed: number,
  closedAt: string | null,
): KeeperDeclarationStatus {
  if (declared >= allowed) return "complete";
  return closedAt ? "final" : "awaiting";
}

// --- Keepers ----------------------------------------------------------------

function buildKeeperBoard(): KeeperBoardView {
  const room = readRoom();
  const franchises = readFranchises();

  const resolvedRaw = readData<RawResolved>(KEEPERS_RESOLVED_FILE);
  const resolved = new Map(
    resolvedRaw.keepers.map((k) => [normalizeName(k.player), k]),
  );

  const sheetRaw = readData<RawEligibility>(KEEPER_ELIGIBILITY_FILE);
  const sheet = new Map(sheetRaw.players.map((p) => [normalizeName(p.player), p]));

  const keeperSlots = room.slots.filter((s) => s.pickType === "KEEPER" && s.player);

  const keepers: KeeperEntry[] = keeperSlots.map((slot) => {
    const player = slot.player!;

    // The room is authoritative for WHO holds the keeper — that is the ruling on
    // Nacua, whose sheet row still says Greg. Resolved from the room's team UUID
    // through to a franchise, so the two Scotts can never be swapped.
    const ownerShortName = room.nameById.get(slot.currentOwnerTeamId) ?? "?";
    const franchise = franchises.find((f) => f.id === slot.currentOwnerTeamId)
      ?? franchiseByName(franchises, ownerShortName, `keeper ${player.name}`);

    const facts = resolveClockFacts(player.name, ownerShortName, resolved, sheet);

    let sheetTenureYear = facts.sheetTenureYear;
    let costRound = slot.displayRound;
    // Only the commissioner's ruling establishes a free-agent acquisition. The
    // sheet's 9 in the round column is a real R9 cost, not a placeholder to
    // infer from — DECISIONS.md is explicit about that.
    let isUndrafted = false;
    let clockResetByTrade = false;
    const conflicts = [...facts.conflicts];
    const sources = [...facts.sources];

    if (normalizeName(player.name) === normalizeName(NACUA_RULING.playerName)) {
      sheetTenureYear = NACUA_RULING.sheetTenureYear;
      clockResetByTrade = NACUA_RULING.clockResetByTrade;
      sources.unshift("Commissioner ruling");
      // Replace the reconciliation's open conflict with the settled one.
      conflicts.length = 0;
      conflicts.push({ ...NACUA_RULING.conflict });
    }

    if (normalizeName(player.name) === normalizeName(LOVELAND_RULING.playerName)) {
      costRound = LOVELAND_RULING.costRound;
      isUndrafted = LOVELAND_RULING.isUndrafted;
      sources.unshift("Commissioner ruling");
      conflicts.length = 0;
      conflicts.push({ ...LOVELAND_RULING.conflict });
    }

    // THE OFF-BY-ONE. The sheets count the acquisition season; the clock counts
    // keeper seasons served. This conversion happens here and nowhere else.
    const seasonsKept =
      sheetTenureYear == null ? 0 : seasonsKeptEnteringSheetSeason(sheetTenureYear);
    const clock = clockPosition(seasonsKept);

    // Prefer the sheets' own answer on 2027 where it exists, because a reset
    // clock (Nacua) buys a season the raw position would not show.
    const clockAllows2027 =
      sheetTenureYear != null
        ? sheetTenureYear < 3
        : (facts.keepableIn2027 ?? !clock.isFinalSeason);

    /**
     * R6 overrides the clock: a keeper occupying a round-1 slot THIS season has
     * no cheaper round to be kept at next season, so he is done regardless of
     * how much clock is left. Nobody on the 2026 board is close — the cheapest
     * cost round is a 4th — but the outlook must be right rather than
     * accidentally right.
     */
    const keepableIn2027 =
      clockAllows2027 &&
      keeperCostRound({ basisRound: costRound, seasonsKept: seasonsKept + 1, isUndrafted }) != null;

    /**
     * Where the league has not settled how long he may be kept, the clock label
     * must not assert an answer. Nacua is the live case: the sheet's tenure year
     * and the keeper clock imply different final seasons, and the app used to
     * print both without saying so.
     */
    const tenureDispute = findTenureDispute(player.name, ownerShortName);

    return {
      playerId: String(player.id),
      playerName: player.name,
      position: player.position,
      nflTeam: player.nflTeam,
      teamId: slot.currentOwnerTeamId,
      teamShortName: ownerShortName,
      franchiseName: franchise?.franchiseName ?? ownerShortName,
      manager: franchise?.manager ?? ownerShortName,
      costRound,
      boardLabel: pickLabel(slot.displayRound, slot.pickInRound),
      overallPick: slot.overallPick,
      basisRound: isUndrafted ? null : facts.basisRound,
      isUndrafted,
      sheetTenureYear,
      seasonsKept,
      clockLabel: tenureDispute
        ? describeDisputedClock(tenureDispute)
        : describeClock(seasonsKept, sheetTenureYear),
      finalSeason: clock.isFinalSeason,
      keepableIn2027,
      tenureDispute,
      clockResetByTrade,
      sources,
      conflicts,
    };
  });

  // ---------------------------------------------------------------------
  // Declarations that have reached the commissioner but not the room yet.
  //
  // Cost rounds are DERIVED here through `keeperCostRound` — the same authority
  // the rest of the app uses — from the eligibility sheet's 2025 round. The
  // declaration file never carries a cost round, because a hand-entered one is
  // how a wrong number reaches the board.
  // ---------------------------------------------------------------------
  const ineligible: IneligibleDeclaration[] = [];
  const alreadyInRoom = new Set(keepers.map((k) => normalizeName(k.playerName)));
  // Resolved against the pool so a declaration carries the SAME player id the
  // room would have used. A synthetic id would break the board's duplicate
  // check and leave the player un-greyed in /players.
  const poolIndex = readPoolIndex();
  let declarations: RawDeclaration[] = [];
  try {
    declarations = readData<RawDeclarations>(DECLARATIONS_FILE).declarations ?? [];
  } catch {
    // The file is optional: with no late declarations, the room is the whole story.
  }

  for (const decl of declarations) {
    const franchise = franchiseByName(
      franchises,
      decl.managerShortName,
      `data/${DECLARATIONS_FILE}`,
    );
    if (!franchise) continue;

    for (const playerName of decl.players ?? []) {
      const key = normalizeName(playerName);
      if (alreadyInRoom.has(key)) continue;

      const pooled = poolIndex.get(key);
      const sRow = sheet.get(key);
      // Owner-matched, like everywhere else: another franchise's row describes
      // that franchise's tenure.
      const owned =
        sRow && sRow.manager.trim().toLowerCase() === franchise.shortName.trim().toLowerCase();

      const sheetTenureYear = owned ? parseSheetTenure(sRow!.status2026) : null;
      const seasonsKept =
        sheetTenureYear == null ? 0 : seasonsKeptEnteringSheetSeason(sheetTenureYear);
      const basisRound = owned ? sRow!.round2025 : null;
      const isUndrafted = basisRound == null;
      const derivedCostRound = keeperCostRound({ basisRound, seasonsKept, isUndrafted });
      const clock = clockPosition(seasonsKept);

      /**
       * No cost round means the rules do not allow him to be kept at all — in
       * practice a round-1 basis (rule R6). He cannot go on the board, because
       * there is no round for him to occupy, but the declaration must not vanish
       * silently: the manager who made it is owed the reason.
       */
      if (derivedCostRound == null) {
        const evaluated = evaluateKeeperEligibility({
          basisRound,
          seasonsKept,
          isUndrafted,
          originalRound: basisRound,
        });
        ineligible.push({
          playerName: pooled ? pooled.name : playerName,
          teamId: franchise.id,
          teamShortName: franchise.shortName,
          franchiseName: franchise.franchiseName,
          manager: franchise.manager,
          basisRound,
          reason: evaluated.reason ?? "Not keeper-eligible.",
        });
        alreadyInRoom.add(key);
        continue;
      }
      const costRound: number = derivedCostRound;

      const conflicts: KeeperConflict[] = [];
      if (!owned) {
        conflicts.push({
          summary:
            `${playerName} was declared by ${franchise.manager}, but the 2026 keeper ` +
            `sheet has no row for him under that franchise, so his cost round could ` +
            `not be derived from his 2025 round.`,
          resolution: null,
        });
      }
      if (!pooled) {
        conflicts.push({
          summary:
            `${playerName} was declared by ${franchise.manager} but does not match any ` +
            `player in the Smart Draft pool, so he cannot be placed on the board. ` +
            `Check the spelling in data/${DECLARATIONS_FILE}.`,
          resolution: null,
        });
      }

      const declaredDispute = findTenureDispute(
        pooled ? pooled.name : playerName,
        franchise.shortName,
      );

      keepers.push({
        playerId: pooled ? String(pooled.id) : `unmatched:${key.replace(/\s+/g, "-")}`,
        playerName: pooled ? pooled.name : playerName,
        position: pooled?.position ?? "",
        nflTeam: pooled?.nflTeam ?? null,
        teamId: franchise.id,
        teamShortName: franchise.shortName,
        franchiseName: franchise.franchiseName,
        manager: franchise.manager,
        costRound,
        boardLabel: `R${costRound}`,
        // Sorts after the room's keepers in the same round rather than claiming
        // a board position the room has not assigned.
        overallPick: costRound * 100,
        basisRound: isUndrafted ? null : basisRound,
        isUndrafted,
        sheetTenureYear,
        seasonsKept,
        clockLabel: declaredDispute
          ? describeDisputedClock(declaredDispute)
          : describeClock(seasonsKept, sheetTenureYear),
        finalSeason: clock.isFinalSeason,
        keepableIn2027:
          sheetTenureYear != null ? sheetTenureYear < 3 : !clock.isFinalSeason,
        tenureDispute: declaredDispute,
        clockResetByTrade: false,
        sources: [
          `Declared to the commissioner${decl.declaredAt ? ` on ${decl.declaredAt}` : ""}`,
          ...(owned ? ["2026 keeper sheet"] : []),
        ],
        conflicts,
      });
      alreadyInRoom.add(key);
    }
  }

  keepers.sort((a, b) => a.overallPick - b.overallPick);

  // A franchise with unfilled keeper slots has not answered yet. That is a
  // different thing from keeping nobody, and the room is not final until
  // declarations close, so it is shown as pending rather than as zero.
  const declaredByTeam = new Map<string, number>();
  for (const k of keepers) {
    declaredByTeam.set(k.teamId, (declaredByTeam.get(k.teamId) ?? 0) + 1);
  }

  // Which managers have closed their lists, from the same declaration file the
  // seed reads. Keyed by franchise id so a first-name collision cannot leak one
  // manager's closure onto another's franchise.
  const closedAtByTeam = new Map<string, string | null>();
  for (const decl of declarations) {
    if (!decl.closesList) continue;
    const franchise = franchiseByName(
      franchises,
      decl.managerShortName,
      `data/${DECLARATIONS_FILE}`,
    );
    if (franchise) closedAtByTeam.set(franchise.id, decl.declaredAt ?? null);
  }

  const pending: PendingDeclaration[] = franchises
    .map((f) => {
      const declared = declaredByTeam.get(f.id) ?? 0;
      const closed = closedAtByTeam.has(f.id);
      return {
        teamId: f.id,
        shortName: f.shortName,
        franchiseName: f.franchiseName,
        manager: f.manager,
        declared,
        allowed: KEEPERS.maxPerTeam,
        status: (closed ? "final" : "awaiting") as "final" | "awaiting",
        declarationsClosedAt: closed ? closedAtByTeam.get(f.id) ?? null : null,
      };
    })
    .filter((p) => p.declared < p.allowed)
    .sort((a, b) => a.declared - b.declared || a.shortName.localeCompare(b.shortName));

  return {
    season: CURRENT_SEASON,
    maxKeeperSeasons: KEEPERS.maxConsecutiveSeasons,
    maxPerTeam: KEEPERS.maxPerTeam,
    keepers,
    ineligible,
    pending,
    awaitingCount: pending.filter((p) => p.status === "awaiting").length,
    expiringCount: keepers.filter((k) => k.finalSeason).length,
    keepableNextSeasonCount: keepers.filter((k) => k.keepableIn2027).length,
    fetchedAt: mtime(ROOM_FILE),
    fromDatabase: false,
    roomSync: buildRoomSync(keepers),
  };
}

// --- Franchises -------------------------------------------------------------

function buildFranchises(): FranchiseView[] {
  const room = readRoom();
  const franchises = readFranchises();
  const board = buildKeeperBoard();

  const keepersByTeam = new Map<string, FranchiseKeeper[]>();
  for (const k of board.keepers) {
    const arr = keepersByTeam.get(k.teamId) ?? [];
    arr.push({
      playerId: k.playerId,
      playerName: k.playerName,
      position: k.position,
      costRound: k.costRound,
      boardLabel: k.boardLabel,
      seasonsKept: k.seasonsKept,
      clockLabel: k.clockLabel,
      finalSeason: k.finalSeason,
      tenureDispute: k.tenureDispute,
    });
    keepersByTeam.set(k.teamId, arr);
  }

  const pendingByTeam = new Map(board.pending.map((p) => [p.teamId, p]));

  return franchises
    .map((f) => {
      const held = room.slots.filter((s) => s.currentOwnerTeamId === f.id);
      const keepers = (keepersByTeam.get(f.id) ?? []).sort(
        (a, b) => a.costRound - b.costRound,
      );
      const pendingRow = pendingByTeam.get(f.id);

      return {
        id: f.id,
        shortName: f.shortName,
        franchiseName: f.franchiseName,
        abbrev: f.abbrev,
        manager: f.manager,
        draftSlot: f.draftSlot,
        espnTeamId: f.espnTeamId,
        picksHeld: held.length,
        picksAcquired: held.filter((s) => s.originalOwnerTeamId !== f.id).length,
        picksTradedAway: room.slots.filter(
          (s) => s.originalOwnerTeamId === f.id && s.currentOwnerTeamId !== f.id,
        ).length,
        roundsHeld: held.map((s) => s.displayRound).sort((a, b) => a - b),
        keepers,
        keeperSlotsPending: pendingRow ? pendingRow.allowed - pendingRow.declared : 0,
        keeperSlotsAllowed: KEEPERS.maxPerTeam,
        declarationStatus: declarationStatusFor(
          keepers.length,
          KEEPERS.maxPerTeam,
          pendingRow?.declarationsClosedAt ?? null,
        ),
        declarationsClosedAt: pendingRow?.declarationsClosedAt ?? null,
      };
    })
    .sort((a, b) => (a.draftSlot ?? 99) - (b.draftSlot ?? 99));
}

function buildFranchiseDetail(id: string): FranchiseDetailView | null {
  const franchise = getFranchisesFromJson().find((f) => f.id === id);
  if (!franchise) return null;

  const room = readRoom();

  const toPick = (s: RawSlot): FranchisePickView => ({
    round: s.displayRound,
    pickInRound: s.pickInRound,
    overallPick: s.overallPick,
    label: pickLabel(s.displayRound, s.pickInRound),
    originalOwner: room.nameById.get(s.originalOwnerTeamId) ?? "?",
    currentOwner: room.nameById.get(s.currentOwnerTeamId) ?? "?",
    acquired: s.originalOwnerTeamId !== id && s.currentOwnerTeamId === id,
    isKeeper: s.pickType === "KEEPER",
    playerName: s.player?.name ?? null,
  });

  return {
    ...franchise,
    picks: room.slots
      .filter((s) => s.currentOwnerTeamId === id)
      .map(toPick)
      .sort((a, b) => a.overallPick - b.overallPick),
    picksGivenAway: room.slots
      .filter((s) => s.originalOwnerTeamId === id && s.currentOwnerTeamId !== id)
      .map(toPick)
      .sort((a, b) => a.overallPick - b.overallPick),
  };
}

// --- Trades -----------------------------------------------------------------

/** `"1 (Stefan's)"` -> round 1 via Stefan. A plain number has no annotation. */
function parseTradeLogRound(raw: number | string): {
  round: number;
  viaFranchise: string | null;
} {
  if (typeof raw === "number") return { round: raw, viaFranchise: null };
  const m = /^\s*(\d+)\s*(?:\(([^)]*?)'?s?\))?\s*$/.exec(raw);
  if (!m) return { round: Number.parseInt(raw, 10) || 0, viaFranchise: null };
  return { round: Number(m[1]), viaFranchise: m[2]?.trim() || null };
}

/**
 * Match the names in the trade log against the Smart Draft pool.
 *
 * The log is typed by hand and contains spelling variants — "Puca Nakua" for
 * Puka Nacua, "Treyveon Henderson" for TreVeyon Henderson — and names a defence
 * as "Packers D/ST" where the pool calls it "Green Bay Packers". An unmatched
 * name is reported as unmatched rather than guessed at; the typed name is always
 * shown, so a failed match costs context and never correctness.
 */
const PLAYER_NAME_ALIASES: Record<string, string> = {
  // Misspellings rather than variants, so no amount of fuzzy matching resolves
  // them. Listed explicitly so a wrong guess is impossible.
  "puca nakua": "Puka Nacua",
  "treyveon henderson": "TreVeyon Henderson",
};

/** Pool index keyed by normalized name, for resolving declared players. */
function readPoolIndex(): Map<string, RawPoolPlayer> {
  const index = new Map<string, RawPoolPlayer>();
  try {
    for (const p of readData<RawPool>(PLAYERS_FILE).players) {
      index.set(normalizeName(p.name), p);
    }
  } catch {
    // Optional: without the pool a declaration still shows, just unplaceable.
  }
  return index;
}

function buildPlayerResolver(): (typedName: string) => TradeLogPlayer {
  let index: Map<string, { id: number; name: string }> | null = null;

  function ensureIndex() {
    if (index) return index;
    index = new Map();
    try {
      const pool = readData<RawPool>(PLAYERS_FILE);
      for (const p of pool.players) {
        index.set(normalizeName(p.name), { id: p.id, name: p.name });
        // Defences are "Green Bay Packers" in the pool and "Packers D/ST" in the
        // log, so index the last word of a team name too.
        if (p.position === "DST") {
          const nickname = p.name.split(/\s+/).slice(-1)[0];
          if (nickname) index.set(normalizeName(nickname), { id: p.id, name: p.name });
        }
      }
      for (const [typed, real] of Object.entries(PLAYER_NAME_ALIASES)) {
        const hit = index.get(normalizeName(real));
        if (hit) index.set(normalizeName(typed), hit);
      }
    } catch {
      // The pool is optional here — the trade log still renders without it.
    }
    return index;
  }

  return (typedName: string): TradeLogPlayer => {
    const idx = ensureIndex();
    const cleaned = typedName.replace(/\bD\/ST\b/i, "").trim();
    const hit = idx.get(normalizeName(typedName)) ?? idx.get(normalizeName(cleaned));
    return {
      typedName,
      playerId: hit ? String(hit.id) : null,
      resolvedName: hit ? hit.name : null,
    };
  };
}

function buildTradeBoard(): TradeBoardView {
  const room = readRoom();
  const franchises = readFranchises();
  const resolvePlayer = buildPlayerResolver();

  const tradedPicks: TradedPickView[] = room.slots
    .filter((s) => s.originalOwnerTeamId !== s.currentOwnerTeamId)
    .map((s) => {
      const originalOwner = room.nameById.get(s.originalOwnerTeamId) ?? "?";
      const currentOwner = room.nameById.get(s.currentOwnerTeamId) ?? "?";
      return {
        round: s.displayRound,
        pickInRound: s.pickInRound,
        overallPick: s.overallPick,
        label: pickLabel(s.displayRound, s.pickInRound),
        originalOwnerId: s.originalOwnerTeamId,
        originalOwner,
        currentOwnerId: s.currentOwnerTeamId,
        currentOwner,
        isKeeper: s.pickType === "KEEPER",
        playerName: s.player?.name ?? null,
      };
    });

  const ledger = franchises.map((f) => {
    const held = room.slots.filter((s) => s.currentOwnerTeamId === f.id);
    return {
      teamId: f.id,
      shortName: f.shortName,
      franchiseName: f.franchiseName,
      picksHeld: held.length,
      acquired: held.filter((s) => s.originalOwnerTeamId !== f.id).length,
      tradedAway: room.slots.filter(
        (s) => s.originalOwnerTeamId === f.id && s.currentOwnerTeamId !== f.id,
      ).length,
    };
  });

  function toSide(raw: RawTradeSide): TradeLogSide {
    // The log names managers by SHORT name ("Scott" is Johnston, "Elbe" is
    // Elbe). `franchiseByName` throws rather than guessing if a first name ever
    // appears here.
    const franchise = franchiseByName(
      franchises,
      raw.member,
      `trade log side "${raw.member}"`,
    );
    return {
      manager: raw.member,
      franchiseName: franchise?.franchiseName ?? null,
      playersReceived: (raw.playersReceived ?? []).map(resolvePlayer),
      picksReceived: (raw.picksReceived ?? []).map((p): TradeLogPick => {
        const { round, viaFranchise } = parseTradeLogRound(p.round);
        return {
          season: p.year,
          round,
          viaFranchise,
          label: pickRefLabel(p.year, round),
        };
      }),
    };
  }

  const { trades } = readData<RawTradeLog>(TRADE_LOG_FILE);
  const log: TradeLogEntry[] = trades.map((t) => {
    const notes = t.notes ?? [];
    // The commissioner annotated the Nacua deal "Contingent on something may
    // reverse will denote later"; DECISIONS.md is what says what that means.
    const provisional = notes.some((n) => /conting/i.test(n));
    return {
      id: `trade-log-${t.tradeNumber}`,
      tradeNumber: t.tradeNumber,
      sideA: toSide(t.sideA),
      sideB: toSide(t.sideB),
      notes,
      provisional,
      provisionalNote: provisional ? CONTINGENT_TRADE_NOTE : null,
    };
  });

  return {
    season: CURRENT_SEASON,
    tradedPicks,
    ledger,
    log,
    tradeDeadlineWeek: TRADES.deadlineWeek,
    tradableSeasons: pickTradableSeasons(CURRENT_SEASON),
    fetchedAt: mtime(ROOM_FILE),
    fromDatabase: false,
  };
}

// --- Cached accessors -------------------------------------------------------
//
// Built once per server process, the same way the draft board caches itself. In
// dev the module is re-evaluated on change, so a re-pulled snapshot still shows
// up without a restart.

let franchiseCache: FranchiseView[] | null = null;
let keeperCache: KeeperBoardView | null = null;
let tradeCache: TradeBoardView | null = null;

export function getFranchisesFromJson(): FranchiseView[] {
  franchiseCache ??= buildFranchises();
  return franchiseCache;
}

/** Not cached: one franchise is cheap, and it reads the cached board anyway. */
export function getFranchiseDetailFromJson(id: string): FranchiseDetailView | null {
  return buildFranchiseDetail(id);
}

export function getKeeperBoardFromJson(): KeeperBoardView {
  keeperCache ??= buildKeeperBoard();
  return keeperCache;
}

export function getTradeBoardFromJson(): TradeBoardView {
  tradeCache ??= buildTradeBoard();
  return tradeCache;
}

/** Franchise count check, so a bad snapshot is loud rather than quietly short. */
export function assertLeagueSize(): void {
  const count = getFranchisesFromJson().length;
  if (count !== LEAGUE.teams) {
    throw new Error(
      `data/${MANAGERS_FILE} lists ${count} franchises but the league is configured for ${LEAGUE.teams}.`,
    );
  }
}

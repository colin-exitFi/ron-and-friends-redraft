/**
 * Prove the trade-entry flow records the right thing, refuses the wrong thing,
 * and can be undone exactly.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/verify-trade-entry.mts
 *
 * The scenarios are taken from THIS LEAGUE'S OWN HISTORY rather than invented,
 * because the invented ones are the ones that pass:
 *
 *   1. The Stefan → Witte → Zach multi-hop from `Sheet3` of the commissioner's
 *      workbook, driven through the entry flow end to end. This is the defect
 *      that used to move the SENDER'S OWN pick on the second hop and leave two
 *      board cells backwards, and it is checked at the source — the pick a
 *      franchise no longer holds must not be offerable at all.
 *
 *   2. A trade carrying FAAB dollars, which the enum could not represent until
 *      now.
 *
 *   3. A player trade that resets a keeper clock — rule R5, the rule behind
 *      Nacua, Skattebo and McConkey.
 *
 *   4. A three-team trade. Rare (the commissioner reports one in league
 *      history) and legal, so the model has to carry it.
 *
 *   5. A reversal, checked by comparing a full state snapshot taken before the
 *      trade against the state after the reversal. Not "did it look undone" —
 *      byte-for-byte the same rows, keeper clock included.
 *
 * POINT IT AT A SCRATCH DATABASE. It creates and reverses real trades, then
 * puts the ledger back. It refuses a hosted project unless `--allow-remote`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { CURRENT_SEASON } from "@/lib/league-config";
import { formatPickRef } from "@/lib/trade-rules";
import type { DraftLine, TradeDraft } from "@/lib/trade-entry-types";

const ROOT = process.cwd();
const SEASON = CURRENT_SEASON;
/** Next season's picks: inside the one-year-out window, and no board yet. */
const PICK_SEASON = SEASON + 1;

function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    let raw: string;
    try {
      raw = readFileSync(path.join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let value = m[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (value && !process.env[m[1]]) process.env[m[1]] = value;
    }
  }
}
loadEnvLocal();

const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(target);
if (!isLocal && !process.argv.includes("--allow-remote")) {
  console.error(
    `\nREFUSING to run against ${target || "an unset URL"}.\n\n` +
      `This suite logs real trades, moves pick ownership and transfers keeper\n` +
      `rights. Point it at a scratch stack:\n\n` +
      `  node scripts/seed-local-stack.mjs up\n` +
      `  # export the URL and keys it prints, then re-run\n\n` +
      `Pass --allow-remote if you really mean to write to a hosted project.\n`,
  );
  process.exit(1);
}

const { createServiceClient } = await import("@/lib/supabase/server");
const {
  checkLedgerInvariants,
  commitTrade,
  listLoggedTrades,
  listSendablePicks,
  previewTrade,
} = await import("@/lib/trade-entry");
const { reverseTrade } = await import("@/lib/trades");
const { getRights } = await import("@/lib/keeper-rights");

const db = createServiceClient();

let failures = 0;
function check(label: string, pass: boolean, detail = "") {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures += 1;
}
function section(title: string) {
  console.log(`\n${title}`);
  console.log("─".repeat(title.length));
}

// --- setup ------------------------------------------------------------------

const { data: teams } = await db.from("teams").select("id, short_name").order("short_name");
if (!teams || teams.length < 4) {
  console.error("Need a seeded database with at least four franchises. Run `npm run db:seed`.");
  process.exit(1);
}
const byName = new Map(teams.map((t) => [t.short_name, t.id]));
const nameOf = (id: string | null | undefined) =>
  teams.find((t) => t.id === id)?.short_name ?? "none";

// The real franchises, which also exercises the name-collision guard: there are
// two Scotts and two Kyles, and "Witte" is Kyle Witte while "Kyle" is Kyle
// Mertens. A first-name match here would silently pick the wrong franchise.
const STEFAN = byName.get("Stefan")!;
const WITTE = byName.get("Witte")!;
const ZACH = byName.get("Zach")!;
const KYLE = byName.get("Kyle")!;
for (const [label, id] of [
  ["Stefan", STEFAN],
  ["Witte", WITTE],
  ["Zach", ZACH],
  ["Kyle", KYLE],
] as const) {
  if (!id) {
    console.error(`Expected franchise ${label}. Re-seed.`);
    process.exit(1);
  }
}

/** Round 1, to mirror the workbook's real round-1-pick-2 chain. */
const ROUND = 1;
/** A second round for the FAAB and three-team scenarios. */
const ROUND_B = 14;

const createdTrades: string[] = [];
let lineSeq = 0;
const line = (
  fromTeamId: string,
  toTeamId: string,
  asset: DraftLine["asset"],
): DraftLine => ({ key: `k${++lineSeq}`, fromTeamId, toTeamId, asset });

/**
 * An in-season date for the current season, which is the ordinary case: a trade
 * approved in ESPN during the year and logged the same day.
 */
const IN_SEASON_DATE = `${SEASON}-11-12`;
/** Before the season's draft — the timing at the heart of the Nacua dispute. */
const PRE_DRAFT_DATE = `${SEASON}-08-28`;

const draft = (
  participantIds: string[],
  lines: DraftLine[],
  notes = "",
  tradedAt: string = IN_SEASON_DATE,
): TradeDraft => ({
  season: SEASON,
  tradedAt,
  participantIds,
  lines,
  notes,
});

async function ownerOf(originalTeam: string, round = ROUND): Promise<string | null> {
  const { data } = await db
    .from("pick_ownership")
    .select("current_team")
    .eq("season", PICK_SEASON)
    .eq("round", round)
    .eq("original_team", originalTeam)
    .maybeSingle();
  return data?.current_team ?? null;
}

async function log(d: TradeDraft): Promise<string> {
  const result = await commitTrade(d);
  createdTrades.push(result.tradeId);
  return result.tradeId;
}

/** Everything this suite could disturb, for an exact before/after comparison. */
async function snapshot() {
  const { data: ownership } = await db
    .from("pick_ownership")
    .select("season, round, original_team, current_team")
    .in("season", [SEASON, PICK_SEASON])
    .order("season")
    .order("round")
    .order("original_team");
  return JSON.stringify(ownership ?? []);
}

const ownershipAtStart = await snapshot();

// --- 1. the multi-hop, at the point of entry --------------------------------

section("1. Stefan → Witte → Zach: the pick a franchise no longer holds is not offerable");

check(
  `Stefan and Witte each hold their own ${PICK_SEASON} R${ROUND} to begin with`,
  (await ownerOf(STEFAN)) === STEFAN && (await ownerOf(WITTE)) === WITTE,
  `Stefan's → ${nameOf(await ownerOf(STEFAN))}, Witte's → ${nameOf(await ownerOf(WITTE))}`,
);

const before1 = await listSendablePicks(SEASON);
const stefanOwnRef = formatPickRef(PICK_SEASON, ROUND, STEFAN);
check(
  "the entry flow offers Stefan his own R1",
  before1[STEFAN].some((p) => p.ref === stefanOwnRef),
  `${before1[STEFAN].length} picks offered`,
);
check(
  "and every ref it generates names the original owner, so no ref is ambiguous",
  Object.values(before1)
    .flat()
    .every((p) => p.ref.split(":").length === 3),
  "three-segment refs throughout",
);

const hop1 = await log(
  draft(
    [STEFAN, WITTE],
    [line(STEFAN, WITTE, { kind: "pick", ref: stefanOwnRef })],
    "verify-trade-entry: hop one",
  ),
);
void hop1;

check(
  "after hop one Witte holds Stefan's pick",
  (await ownerOf(STEFAN)) === WITTE,
  `Stefan's → ${nameOf(await ownerOf(STEFAN))}`,
);

const after1 = await listSendablePicks(SEASON);
check(
  "STEFAN CAN NO LONGER OFFER IT — the ledger, not the form, decides",
  !after1[STEFAN].some((p) => p.ref === stefanOwnRef),
  `Stefan is offered ${after1[STEFAN].filter((p) => p.round === ROUND && p.season === PICK_SEASON).length} R${ROUND} pick(s)`,
);

const witteR1 = after1[WITTE].filter((p) => p.season === PICK_SEASON && p.round === ROUND);
check(
  "Witte is offered TWO distinct round-1 picks, told apart by original owner",
  witteR1.length === 2 && new Set(witteR1.map((p) => p.ref)).size === 2,
  witteR1.map((p) => p.label).join(" | "),
);
check(
  "and the acquired one is labelled as Stefan's, so the wrong one is not picked by accident",
  witteR1.some((p) => p.acquired && p.originalTeamShortName === "Stefan"),
  witteR1.find((p) => p.acquired)?.label ?? "no acquired pick labelled",
);

// --- 2. hop two: the pick that used to move wrongly -------------------------

section("2. Hop two — Witte sends STEFAN'S pick onward, and only that pick moves");

const hop2Preview = await previewTrade(
  draft([WITTE, ZACH], [line(WITTE, ZACH, { kind: "pick", ref: stefanOwnRef })]),
);
check(
  "the preview names the pick by its original owner and counts the hop",
  hop2Preview.pickMoves.length === 1 &&
    hop2Preview.pickMoves[0].originalTeamShortName === "Stefan" &&
    hop2Preview.pickMoves[0].hop === 2,
  `${hop2Preview.pickMoves[0]?.originalTeamShortName}'s, hop ${hop2Preview.pickMoves[0]?.hop}`,
);
check(
  "and states where it will draw, in the ORIGINAL owner's column",
  /Stefan's column/.test(hop2Preview.pickMoves[0]?.boardNote ?? ""),
  hop2Preview.pickMoves[0]?.boardNote ?? "",
);

const hop2 = await log(
  draft(
    [WITTE, ZACH],
    [line(WITTE, ZACH, { kind: "pick", ref: stefanOwnRef })],
    "verify-trade-entry: hop two",
  ),
);

check(
  "Stefan's pick moved on to Zach — the right pick moved",
  (await ownerOf(STEFAN)) === ZACH,
  `Stefan's → ${nameOf(await ownerOf(STEFAN))}`,
);
check(
  "WITTE'S OWN R1 DID NOT MOVE — this is the defect that silently moved it",
  (await ownerOf(WITTE)) === WITTE,
  `Witte's → ${nameOf(await ownerOf(WITTE))}`,
);

const { data: hop2Rows } = await db
  .from("traded_picks")
  .select("original_team, from_team, current_team")
  .eq("trade_id", hop2);
check(
  "the provenance log names Stefan as original owner and Witte as this hop's sender",
  hop2Rows?.length === 1 &&
    hop2Rows[0].original_team === STEFAN &&
    hop2Rows[0].from_team === WITTE &&
    hop2Rows[0].current_team === ZACH,
  `${nameOf(hop2Rows?.[0]?.original_team)} pick, ${nameOf(hop2Rows?.[0]?.from_team)} → ${nameOf(hop2Rows?.[0]?.current_team)}`,
);

section("3. Offering a pick you do not own is refused, not guessed");

const stolen = await previewTrade(
  draft([WITTE, KYLE], [line(WITTE, KYLE, { kind: "pick", ref: stefanOwnRef })]),
);
check(
  "Witte can no longer send the pick he already sent on",
  stolen.blockers.some((b) => /does not hold/.test(b)),
  stolen.blockers[0] ?? "it was allowed",
);

const twice = await previewTrade(
  draft(
    [WITTE, KYLE],
    [
      line(WITTE, KYLE, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND, WITTE) }),
      line(WITTE, KYLE, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND, WITTE) }),
    ],
  ),
);
check(
  "the same pick listed twice in one trade is refused",
  twice.blockers.some((b) => /listed twice/.test(b)),
  twice.blockers[0] ?? "it was allowed",
);

const wrongWindow = await previewTrade(
  draft(
    [WITTE, KYLE],
    [line(WITTE, KYLE, { kind: "pick", ref: formatPickRef(SEASON + 5, 3, WITTE) })],
  ),
);
check(
  `a ${SEASON + 5} pick is refused — picks are tradable one year out only`,
  wrongWindow.blockers.some((b) => /cannot be traded/.test(b)),
  wrongWindow.blockers[0] ?? "it was allowed",
);

const emptyParty = await previewTrade(
  draft(
    [WITTE, KYLE, ZACH],
    [line(WITTE, KYLE, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND, WITTE) })],
  ),
);
check(
  "a franchise listed in the trade that neither sends nor receives is refused",
  emptyParty.blockers.some((b) => /neither sends nor receives/.test(b)),
  emptyParty.blockers[0] ?? "it was allowed",
);
check(
  "a one-sided trade warns without blocking — the likeliest entry slip",
  emptyParty.warnings.some((w) => /receives nothing|gives up nothing/.test(w)),
  emptyParty.warnings[0] ?? "no warning",
);

// --- 4. FAAB ----------------------------------------------------------------

section("4. A trade carrying FAAB dollars");

const faabPreview = await previewTrade(
  draft(
    [KYLE, ZACH],
    [
      line(KYLE, ZACH, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND_B, KYLE) }),
      line(KYLE, ZACH, { kind: "faab", amount: 20 }),
      line(ZACH, KYLE, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND_B, ZACH) }),
    ],
    "verify-trade-entry: FAAB leg",
  ),
);
check(
  "the preview reports $20 moving Kyle → Zach",
  faabPreview.faabMoves.length === 1 &&
    faabPreview.faabMoves[0].amount === 20 &&
    faabPreview.faabMoves[0].fromShortName === "Kyle" &&
    faabPreview.faabMoves[0].toShortName === "Zach",
  JSON.stringify(faabPreview.faabMoves),
);
check("and nothing blocks it", faabPreview.blockers.length === 0, faabPreview.blockers.join(" "));

const badFaab = await previewTrade(
  draft([KYLE, ZACH], [line(KYLE, ZACH, { kind: "faab", amount: -5 })]),
);
check(
  "a negative FAAB amount is refused — direction is carried by from/to",
  badFaab.blockers.some((b) => /Invalid FAAB/.test(b)),
  badFaab.blockers[0] ?? "it was allowed",
);

const faabTrade = await log(
  draft(
    [KYLE, ZACH],
    [
      line(KYLE, ZACH, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND_B, KYLE) }),
      line(KYLE, ZACH, { kind: "faab", amount: 20 }),
      line(ZACH, KYLE, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND_B, ZACH) }),
    ],
    "verify-trade-entry: FAAB leg",
  ),
);

const { data: faabAssets } = await db
  .from("trade_assets")
  .select("asset_type, ref, from_team, to_team")
  .eq("trade_id", faabTrade)
  .eq("asset_type", "faab");
check(
  "the FAAB line is stored as a trade asset, whole dollars, with a direction",
  faabAssets?.length === 1 && faabAssets[0].ref === "20" && faabAssets[0].from_team === KYLE,
  JSON.stringify(faabAssets),
);
check(
  "the two picks swapped and FAAB moved no picks of its own",
  (await ownerOf(KYLE, ROUND_B)) === ZACH && (await ownerOf(ZACH, ROUND_B)) === KYLE,
  `Kyle's R${ROUND_B} → ${nameOf(await ownerOf(KYLE, ROUND_B))}, Zach's → ${nameOf(await ownerOf(ZACH, ROUND_B))}`,
);

// --- 5. a player trade resets the keeper clock ------------------------------

section("5. A player trade resets the keeper clock and carries the cost basis");

const { data: withClock } = await db
  .from("keeper_rights")
  .select("player_id, current_team_id, consecutive_seasons, basis_round, is_undrafted")
  .gt("consecutive_seasons", 0)
  .not("current_team_id", "is", null)
  .limit(1);

let playerTradeId: string | null = null;
let subjectId: string | null = null;
let subjectHolder: string | null = null;
let subjectClock = 0;
let subjectRightsBefore = "";

if (!withClock?.length) {
  check("a keeper with clock already served exists to test with", false, "none found — re-seed");
} else {
  const subject = withClock[0];
  subjectId = subject.player_id;
  subjectHolder = subject.current_team_id!;
  subjectClock = subject.consecutive_seasons;
  const receiver = teams.find((t) => t.id !== subjectHolder)!.id;

  const { data: playerRow } = await db
    .from("players")
    .select("full_name")
    .eq("player_id", subjectId)
    .maybeSingle();
  console.log(
    `  (subject: ${playerRow?.full_name ?? subjectId}, held by ${nameOf(subjectHolder)} ` +
      `at clock ${subjectClock}, basis R${subject.basis_round})`,
  );

  subjectRightsBefore = JSON.stringify(await getRights(subjectId));

  const playerPreview = await previewTrade(
    draft([subjectHolder, receiver], [line(subjectHolder, receiver, { kind: "player", playerId: subjectId })]),
  );
  const move = playerPreview.playerMoves[0];
  check(
    "the preview states the clock before and after, and they differ",
    !!move && move.seasonsKeptBefore === subjectClock && move.seasonsKeptAfter === 0,
    move ? `${move.clockBeforeLabel} → ${move.clockAfterLabel}` : "no player move",
  );
  check(
    "and states what he would cost his NEW franchise, off the carried basis",
    !!move && move.basisRound === subject.basis_round && move.nextCostRound != null,
    move ? move.costNote : "",
  );

  playerTradeId = await log(
    draft(
      [subjectHolder, receiver],
      [line(subjectHolder, receiver, { kind: "player", playerId: subjectId })],
      "verify-trade-entry: player leg",
    ),
  );

  const mid = await getRights(subjectId);
  check(
    "the trade moved him and reset his clock to zero (rule R5)",
    mid?.currentTeamId === receiver && mid?.consecutiveSeasons === 0,
    `${nameOf(mid?.currentTeamId)}, clock ${mid?.consecutiveSeasons}`,
  );
  check(
    "the cost basis carried across untouched",
    mid?.basisRound === subject.basis_round,
    `basis R${mid?.basisRound}`,
  );
  check(
    "and the pre-trade clock was stamped, so a reversal has an exact value to restore",
    mid?.priorOwnerClocks[subjectHolder] === subjectClock,
    `stamped ${mid?.priorOwnerClocks[subjectHolder]}, was ${subjectClock}`,
  );

  const backAgain = await previewTrade(
    draft([receiver, subjectHolder], [line(receiver, subjectHolder, { kind: "player", playerId: subjectId })]),
  );
  check(
    "trading him straight back is refused — hard rule, never overridable",
    backAgain.blockers.some((b) => /cannot go\s+back/.test(b)),
    backAgain.blockers[0] ?? "it was allowed",
  );
}

// --- 6. a three-team trade --------------------------------------------------

section("6. A three-team trade — rare, legal, and the model carries it");

const threeWay = await log(
  draft(
    [STEFAN, WITTE, KYLE],
    [
      line(STEFAN, WITTE, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND_B, STEFAN) }),
      line(WITTE, KYLE, { kind: "pick", ref: formatPickRef(PICK_SEASON, ROUND_B, WITTE) }),
      line(KYLE, STEFAN, { kind: "faab", amount: 5 }),
    ],
    "verify-trade-entry: three-team",
  ),
);

check(
  "all three legs applied: Stefan's pick to Witte, Witte's to Kyle",
  (await ownerOf(STEFAN, ROUND_B)) === WITTE && (await ownerOf(WITTE, ROUND_B)) === KYLE,
  `Stefan's R${ROUND_B} → ${nameOf(await ownerOf(STEFAN, ROUND_B))}, Witte's → ${nameOf(await ownerOf(WITTE, ROUND_B))}`,
);

const logged = await listLoggedTrades(SEASON);
const threeWayView = logged.find((t) => t.id === threeWay);
check(
  "and it lists THREE parties rather than being squeezed into two sides",
  threeWayView?.parties.length === 3,
  `${threeWayView?.parties.length} parties: ${threeWayView?.parties.map((p) => p.shortName).join(", ")}`,
);
check(
  "each party's line says what that franchise received",
  !!threeWayView?.parties.find((p) => p.shortName === "Stefan" && p.receives.some((r) => /\$5 FAAB/.test(r))),
  JSON.stringify(threeWayView?.parties.map((p) => ({ [p.shortName]: p.receives }))),
);

// --- 7. reversal restores the state exactly ---------------------------------

section("7. Reversing a trade returns the state exactly, keeper clock included");

if (playerTradeId && subjectId && subjectHolder) {
  await reverseTrade(playerTradeId);
  const restored = JSON.stringify(await getRights(subjectId));
  check(
    "the keeper-rights row is byte-for-byte what it was before the trade",
    restored === subjectRightsBefore,
    restored === subjectRightsBefore
      ? `clock back to ${subjectClock} with ${nameOf(subjectHolder)}`
      : `before ${subjectRightsBefore}\n        after  ${restored}`,
  );
  const { data: leftovers } = await db
    .from("traded_picks")
    .select("id")
    .eq("trade_id", playerTradeId);
  check("and the reversed trade left no movement rows", (leftovers?.length ?? 0) === 0);
  const { data: status } = await db
    .from("trades")
    .select("status")
    .eq("id", playerTradeId)
    .maybeSingle();
  check(`the trade reads "reversed"`, status?.status === "reversed", status?.status);
}

// Reversing the three-team trade must unwind all three legs, not just two.
await reverseTrade(threeWay);
check(
  "reversing a three-team trade unwinds every leg",
  (await ownerOf(STEFAN, ROUND_B)) === STEFAN && (await ownerOf(WITTE, ROUND_B)) === WITTE,
  `Stefan's R${ROUND_B} → ${nameOf(await ownerOf(STEFAN, ROUND_B))}, Witte's → ${nameOf(await ownerOf(WITTE, ROUND_B))}`,
);

check(
  "reversing twice is safe and changes nothing further",
  await (async () => {
    await reverseTrade(threeWay);
    return (await ownerOf(STEFAN, ROUND_B)) === STEFAN;
  })(),
);

// --- 8. the date, which the keeper clock cannot be computed without ---------

section("8. The trade date drives the keeper clock, and is derived not asked for");

const { classifyTradeDate, keeperConsequenceOfTrade, seasonForDate } = await import(
  "@/lib/trade-timing"
);

check(
  `${IN_SEASON_DATE} is classified in-season ${SEASON}`,
  classifyTradeDate(IN_SEASON_DATE).phase === "in_season" &&
    classifyTradeDate(IN_SEASON_DATE).season === SEASON,
  classifyTradeDate(IN_SEASON_DATE).label,
);
check(
  `${PRE_DRAFT_DATE} is classified pre-draft for ${SEASON} — one day before the draft`,
  classifyTradeDate(PRE_DRAFT_DATE).phase === "pre_draft" &&
    classifyTradeDate(PRE_DRAFT_DATE).season === SEASON,
  classifyTradeDate(PRE_DRAFT_DATE).label,
);
check(
  `a January date belongs to the season that started the previous autumn`,
  seasonForDate(`${SEASON + 1}-01-15`) === SEASON,
  `${SEASON + 1}-01-15 → season ${seasonForDate(`${SEASON + 1}-01-15`)}`,
);

const inSeasonConsequence = keeperConsequenceOfTrade(IN_SEASON_DATE);
const preDraftConsequence = keeperConsequenceOfTrade(PRE_DRAFT_DATE);
check(
  "THE SAME TRADE GIVES DIFFERENT KEEPER OUTCOMES on the two dates",
  inSeasonConsequence.lastKeeperSeason !== preDraftConsequence.lastKeeperSeason,
  `in-season → through ${inSeasonConsequence.lastKeeperSeason}, ` +
    `pre-draft → through ${preDraftConsequence.lastKeeperSeason}`,
);
check(
  `in-season: ${SEASON} is the acquisition season, so keepable ${SEASON + 1}–${SEASON + 2}`,
  inSeasonConsequence.firstKeeperSeason === SEASON + 1 &&
    inSeasonConsequence.lastKeeperSeason === SEASON + 2,
  inSeasonConsequence.summary,
);
check(
  `pre-draft: ${SEASON} is itself a keeper season, so keepable ${SEASON}–${SEASON + 1}`,
  preDraftConsequence.firstKeeperSeason === SEASON &&
    preDraftConsequence.lastKeeperSeason === SEASON + 1,
  preDraftConsequence.summary,
);
check(
  "and the pre-draft case declares the unresolved rule rather than picking a side",
  preDraftConsequence.disputeNote !== null &&
    preDraftConsequence.disputedLastKeeperSeason === SEASON + 2,
  `alternative reading: through ${preDraftConsequence.disputedLastKeeperSeason}`,
);
check(
  "the in-season case raises no dispute, because its timing is not in question",
  inSeasonConsequence.disputeNote === null,
);

const badDate = await previewTrade(
  draft([STEFAN, WITTE], [line(STEFAN, WITTE, { kind: "pick", ref: stefanOwnRef })], "", "not-a-date"),
);
check(
  "an unparseable date is refused before anything else is computed",
  badDate.blockers.some((b) => /Invalid date/.test(b)),
  badDate.blockers[0] ?? "it was allowed",
);

const impossibleDate = await previewTrade(
  draft([STEFAN, WITTE], [line(STEFAN, WITTE, { kind: "pick", ref: stefanOwnRef })], "", `${SEASON}-02-31`),
);
check(
  "a date that does not exist is refused rather than rolled into March",
  impossibleDate.blockers.some((b) => /not a real date/.test(b)),
  impossibleDate.blockers[0] ?? "it was allowed",
);

const unknownSeason = await previewTrade(
  draft([STEFAN, WITTE], [line(STEFAN, WITTE, { kind: "pick", ref: stefanOwnRef })], "", "2019-11-12"),
);
check(
  "a date in a season the league has no record of is refused readably",
  unknownSeason.blockers.some((b) => /has no record of/.test(b)),
  unknownSeason.blockers[0] ?? "it was allowed",
);

// The date has to reach the ledger, not just the preview.
section("9. The date is stamped onto the player's keeper rights, not assumed");

const { data: datedSubjectRow } = await db
  .from("keeper_rights")
  .select("player_id, current_team_id, consecutive_seasons")
  .not("current_team_id", "is", null)
  .limit(1);

if (datedSubjectRow?.length) {
  const s = datedSubjectRow[0];
  const holder = s.current_team_id!;
  const receiver = teams.find((t) => t.id !== holder)!.id;
  const rightsBefore = JSON.stringify(await getRights(s.player_id));

  const datedTrade = await log(
    draft(
      [holder, receiver],
      [line(holder, receiver, { kind: "player", playerId: s.player_id })],
      "verify-trade-entry: date stamping",
      PRE_DRAFT_DATE,
    ),
  );

  const { data: storedTrade } = await db
    .from("trades")
    .select("traded_at, season")
    .eq("id", datedTrade)
    .maybeSingle();
  check(
    "the trade stores the date it happened, and the season derived from it",
    storedTrade?.traded_at === PRE_DRAFT_DATE && storedTrade?.season === SEASON,
    `traded_at ${storedTrade?.traded_at}, season ${storedTrade?.season}`,
  );

  const stamped = await getRights(s.player_id);
  check(
    "keeper_rights records WHEN the new franchise acquired him",
    stamped?.acquiredAt === PRE_DRAFT_DATE && stamped?.acquisitionSeason === SEASON,
    `acquired ${stamped?.acquiredAt}, season ${stamped?.acquisitionSeason}`,
  );

  await reverseTrade(datedTrade);
  const rightsAfter = JSON.stringify(await getRights(s.player_id));
  check(
    "and a reversal restores the acquisition stamp exactly, not just the clock",
    rightsAfter === rightsBefore,
    rightsAfter === rightsBefore
      ? "identical"
      : `before ${rightsBefore}\n        after  ${rightsAfter}`,
  );
}

section("10. Undated imported trades are surfaced, never guessed");

const { count: undatedCount } = await db
  .from("trades")
  .select("id", { count: "exact", head: true })
  .eq("season", SEASON)
  .is("traded_at", null);
check(
  "the twelve workbook trades still carry no date — nothing was invented for them",
  (undatedCount ?? 0) > 0,
  `${undatedCount} undated`,
);

const loggedWithDates = await listLoggedTrades(SEASON);
check(
  "and they are still surfaced as dateless rather than falling back to created_at",
  loggedWithDates.filter((t) => t.needsDateBackfill).length === (undatedCount ?? 0),
  `${loggedWithDates.filter((t) => t.needsDateBackfill).length} flagged`,
);

// The commissioner confirmed on Aug 26 2026 that there were NO pre-draft player
// trades this year, so all twelve are in-season and the keeper sheet's "N of 3"
// already encodes their acquisition seasons. The ledger check therefore STATES
// that fact and passes, where it used to fail as an outstanding backfill. A
// permanently failing check trains the reader to ignore the output.
const dateChecks = await checkLedgerInvariants(SEASON);
check(
  "the ledger states the dateless trades are confirmed in-season, and passes",
  dateChecks.some((c) => /confirmed in-season/.test(c.label) && c.ok),
  dateChecks.find((c) => /in-season/.test(c.label))?.label ?? "no such check",
);
check(
  "while no APPLIED trade is missing a date",
  dateChecks.find((c) => /applied to the ledger records the date/.test(c.label))?.ok === true,
  dateChecks.find((c) => /applied to the ledger records the date/.test(c.label))?.detail ??
    "clean",
);

// --- 11. the ledger invariants ---------------------------------------------

section("11. The ledger checks agree the ledger is self-consistent");

for (const season of [SEASON, PICK_SEASON]) {
  const checks = await checkLedgerInvariants(season);
  // No exclusion any more. The date item used to be expected to fail; with
  // pre-draft trades ruled out for this year it states a fact and passes, so
  // EVERY ledger check must now be green and a failure here is a real one.
  const failing = checks.filter((c) => !c.ok);
  check(
    `${season}: every ledger check passes, with no acknowledged exceptions`,
    failing.length === 0,
    failing.map((f) => `${f.label}: ${f.detail}`).join("; ") || `${checks.length} checks`,
  );
}

// --- cleanup ---------------------------------------------------------------

section("12. Putting the ledger back the way it was found");

for (const id of createdTrades) {
  await db.from("traded_picks").delete().eq("trade_id", id);
  await db.from("trades").delete().eq("id", id);
}

for (const round of [ROUND, ROUND_B]) {
  for (const original of [STEFAN, WITTE, ZACH, KYLE]) {
    await db
      .from("pick_ownership")
      .update({ current_team: original, updated_at: new Date().toISOString() })
      .eq("season", PICK_SEASON)
      .eq("round", round)
      .eq("original_team", original);
  }
}

if (subjectId && subjectHolder) {
  await db
    .from("keeper_rights")
    .update({
      current_team_id: subjectHolder,
      consecutive_seasons: subjectClock,
      last_team_id: null,
      prior_owner_clocks: {},
    })
    .eq("player_id", subjectId);
}

const ownershipAtEnd = await snapshot();
check(
  "pick ownership across both seasons is identical to how this suite found it",
  ownershipAtEnd === ownershipAtStart,
  ownershipAtEnd === ownershipAtStart ? "unchanged" : "DIFFERS — inspect before re-running",
);

const { data: strays } = await db
  .from("trades")
  .select("id")
  .like("notes", "verify-trade-entry%");
check("no test trades left behind", (strays?.length ?? 0) === 0, `${strays?.length} left`);

console.log(
  `\n${"=".repeat(72)}\n${
    failures === 0 ? "ALL TRADE-ENTRY CHECKS PASSED" : `${failures} CHECK(S) FAILED`
  }\n${"=".repeat(72)}\n`,
);
process.exit(failures === 0 ? 0 : 1);

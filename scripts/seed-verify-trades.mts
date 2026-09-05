/**
 * Prove the two quiet trade defects are actually fixed.
 *
 *   node --experimental-strip-types --no-warnings \
 *     --import ./scripts/seed-verify-loader.mjs scripts/seed-verify-trades.mts
 *
 * Both defects corrupt data without complaining, which is why they need a test
 * rather than a read-through:
 *
 *   1. A pick's identity is (season, round, ORIGINAL owner). Resolving it from
 *      the SENDER is only right on the first hop, and multi-hop is routine here
 *      — `Sheet3` of the workbook tracks round 1 pick 2 going
 *      Stefan → Witte → Zach. Getting it wrong moves a different pick than the
 *      one being traded, and the board then draws two cells backwards.
 *
 *   2. `reversed` used to flip a status word and un-apply nothing, so a
 *      mis-logged trade could not be corrected. The ledger stayed moved while
 *      the trade read as undone.
 *
 * POINT IT AT A SCRATCH DATABASE. It creates and reverses real trades. It
 * refuses to run against a database whose 2026 draft is under way, but the
 * honest protection is the env override — see `seed-verify-import.mts`.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { CURRENT_SEASON } from "@/lib/league-config";
import { formatPickRef } from "@/lib/trade-rules";

const ROOT = process.cwd();
const SEASON = CURRENT_SEASON;

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

const { createServiceClient } = await import("@/lib/supabase/server");
const { acceptTrade, proposeTrade, reverseTrade, setTradeStatus, listPickOwnership } =
  await import("@/lib/trades");
const { getRights } = await import("@/lib/keeper-rights");

const db = createServiceClient();

/**
 * REFUSE TO MUTATE A HOSTED PROJECT.
 *
 * This suite creates trades, accepts them, moves pick ownership and transfers
 * keeper rights, then puts it all back. The cleanup works — but a suite that
 * writes to the league's real ledger as a side effect of "run everything" is a
 * hazard, and a crash part-way through three days before the draft would leave
 * the commissioner reconciling a ledger by hand.
 *
 * So the target must be local. A scratch stack lives on 127.0.0.1; the hosted
 * project does not. `--allow-remote` exists for the case where someone genuinely
 * means it, and has to be typed.
 */
const target = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(target);
if (!isLocal && !process.argv.includes("--allow-remote")) {
  console.error(
    `\nREFUSING to run against ${target || "an unset URL"}.\n\n` +
      `This suite writes to the ledger — trades, pick ownership and keeper rights —\n` +
      `and only cleans up if it finishes. Point it at a scratch stack:\n\n` +
      `  node scripts/seed-local-stack.mjs up\n` +
      `  # export the URL and keys it prints, then re-run\n\n` +
      `Pass --allow-remote if you really mean to write to a hosted project.\n`,
  );
  process.exit(1);
}

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
if (!teams || teams.length < 3) {
  console.error("Need a seeded database with at least three franchises. Run `npm run db:seed`.");
  process.exit(1);
}
const byName = new Map(teams.map((t) => [t.short_name, t.id]));

// The real multi-hop from the workbook: Stefan's R1 goes to Witte, then on to
// Zach. Uses the actual franchises so a name-collision regression shows up here
// too (there are two Scotts and two Kyles; "Witte" is Kyle Witte).
const STEFAN = byName.get("Stefan")!;
const WITTE = byName.get("Witte")!;
const ZACH = byName.get("Zach")!;
if (!STEFAN || !WITTE || !ZACH) {
  console.error("Expected franchises Stefan, Witte and Zach. Re-seed.");
  process.exit(1);
}

/** A round nothing in the seeded data has traded, so the test starts clean. */
const ROUND = 13;
const PICK_SEASON = SEASON + 1; // Next season's picks: tradable, and no board.

async function ownerOf(originalTeam: string): Promise<string | null> {
  const { data } = await db
    .from("pick_ownership")
    .select("current_team")
    .eq("season", PICK_SEASON)
    .eq("round", ROUND)
    .eq("original_team", originalTeam)
    .maybeSingle();
  return data?.current_team ?? null;
}

const nameOf = (id: string | null) => teams.find((t) => t.id === id)?.short_name ?? "none";

section("0. Starting position");
check(
  `Stefan and Witte each hold their own ${PICK_SEASON} R${ROUND}`,
  (await ownerOf(STEFAN)) === STEFAN && (await ownerOf(WITTE)) === WITTE,
  `Stefan's → ${nameOf(await ownerOf(STEFAN))}, Witte's → ${nameOf(await ownerOf(WITTE))}`,
);

const createdTrades: string[] = [];

// --- 1. hop one -------------------------------------------------------------

section("1. Hop one — Stefan sends his own R13 to Witte");

const hop1 = await proposeTrade({
  season: SEASON,
  notes: "seed-verify-trades: hop one",
  assets: [
    {
      fromTeam: STEFAN,
      toTeam: WITTE,
      assetType: "pick",
      ref: formatPickRef(PICK_SEASON, ROUND),
    },
  ],
});
createdTrades.push(hop1.id);
await acceptTrade(hop1.id);

check(`Stefan's pick is now Witte's`, (await ownerOf(STEFAN)) === WITTE, nameOf(await ownerOf(STEFAN)));
check(`Witte still holds his own`, (await ownerOf(WITTE)) === WITTE, nameOf(await ownerOf(WITTE)));

const { data: hop1Log } = await db
  .from("traded_picks")
  .select("original_team, from_team, current_team")
  .eq("trade_id", hop1.id);
check(
  "the log records Stefan as the original owner on the first hop",
  hop1Log?.length === 1 && hop1Log[0].original_team === STEFAN,
  `original_team = ${nameOf(hop1Log?.[0]?.original_team ?? null)}`,
);

// --- 2. hop two: the defect --------------------------------------------------

section("2. Hop two — Witte sends STEFAN'S pick on to Zach");

// An unqualified ref is now ambiguous only if the sender does not hold his own;
// Witte does, so `2027:13` would silently mean HIS pick. Naming the original
// owner is what makes the intent unambiguous.
const hop2 = await proposeTrade({
  season: SEASON,
  notes: "seed-verify-trades: hop two",
  assets: [
    {
      fromTeam: WITTE,
      toTeam: ZACH,
      assetType: "pick",
      ref: formatPickRef(PICK_SEASON, ROUND, STEFAN),
    },
  ],
});
createdTrades.push(hop2.id);
await acceptTrade(hop2.id);

check(
  "Stefan's pick moved on to Zach — the right pick moved",
  (await ownerOf(STEFAN)) === ZACH,
  `Stefan's → ${nameOf(await ownerOf(STEFAN))}`,
);
check(
  "Witte's OWN pick did not move — the bug would have sent this one",
  (await ownerOf(WITTE)) === WITTE,
  `Witte's → ${nameOf(await ownerOf(WITTE))}`,
);

const { data: hop2Log } = await db
  .from("traded_picks")
  .select("original_team, from_team, current_team")
  .eq("trade_id", hop2.id);
check(
  "the log still names Stefan as the original owner on the second hop",
  hop2Log?.length === 1 && hop2Log[0].original_team === STEFAN,
  `original_team = ${nameOf(hop2Log?.[0]?.original_team ?? null)}`,
);
check(
  "and records Witte as the sender of that hop, so the chain reconstructs",
  hop2Log?.[0]?.from_team === WITTE && hop2Log?.[0]?.current_team === ZACH,
  `${nameOf(hop2Log?.[0]?.from_team ?? null)} → ${nameOf(hop2Log?.[0]?.current_team ?? null)}`,
);

// --- 3. ambiguity is refused, not guessed ----------------------------------

section("3. An ambiguous pick ref is refused rather than guessed");

// Zach now holds Stefan's R13 but not his own (he has his own, actually — so
// construct the genuinely ambiguous case: a franchise holding ONLY an acquired
// pick in that round). Give Zach's own R13 away first.
const giveAway = await proposeTrade({
  season: SEASON,
  notes: "seed-verify-trades: clear Zach's own",
  assets: [
    { fromTeam: ZACH, toTeam: WITTE, assetType: "pick", ref: formatPickRef(PICK_SEASON, ROUND, ZACH) },
  ],
});
createdTrades.push(giveAway.id);
await acceptTrade(giveAway.id);

check(
  "Zach now holds only the pick he acquired from Stefan",
  (await ownerOf(ZACH)) === WITTE && (await ownerOf(STEFAN)) === ZACH,
  `Zach's own → ${nameOf(await ownerOf(ZACH))}, Stefan's → ${nameOf(await ownerOf(STEFAN))}`,
);

let refused = "";
try {
  await proposeTrade({
    season: SEASON,
    notes: "seed-verify-trades: should be refused",
    assets: [
      { fromTeam: ZACH, toTeam: WITTE, assetType: "pick", ref: formatPickRef(PICK_SEASON, ROUND) },
    ],
  });
} catch (err) {
  refused = err instanceof Error ? err.message : String(err);
}
check(
  "an unqualified ref from a franchise holding only an acquired pick is refused",
  /Ambiguous pick/.test(refused),
  refused || "it was allowed",
);

// --- 4. reversal actually reverses ------------------------------------------

section("4. Reversing hop two puts the pick back");

await reverseTrade(hop2.id);

check(
  "Stefan's pick returned to Witte, who sent it",
  (await ownerOf(STEFAN)) === WITTE,
  `Stefan's → ${nameOf(await ownerOf(STEFAN))}`,
);
const { data: hop2After } = await db
  .from("traded_picks")
  .select("id")
  .eq("trade_id", hop2.id);
check("the reversed trade's hop rows are gone", (hop2After?.length ?? 0) === 0, `${hop2After?.length} left`);
const { data: hop2Status } = await db
  .from("trades")
  .select("status")
  .eq("id", hop2.id)
  .maybeSingle();
check(`the trade reads "reversed"`, hop2Status?.status === "reversed", hop2Status?.status);

check(
  "hop one is untouched — reversing one trade does not unwind the chain",
  hop1Log?.length === 1 &&
    (await db.from("traded_picks").select("id").eq("trade_id", hop1.id)).data?.length === 1,
);

section("5. Reversing twice is safe");
await reverseTrade(hop2.id);
check(
  "a second reversal changes nothing",
  (await ownerOf(STEFAN)) === WITTE,
  `Stefan's → ${nameOf(await ownerOf(STEFAN))}`,
);

section("6. Vetoing an applied trade is refused, because it would not un-apply");
let vetoRefused = "";
try {
  await setTradeStatus(hop1.id, "vetoed");
} catch (err) {
  vetoRefused = err instanceof Error ? err.message : String(err);
}
check(
  "veto on an accepted trade is refused and points at reverse",
  /Reverse it instead/.test(vetoRefused),
  vetoRefused || "it was allowed",
);

// --- 7. keeper rights survive a reversal exactly ---------------------------

section("7. A reversed player trade restores the keeper clock exactly");

// Pick a player with a real rights row and a non-zero clock, so a reversal that
// quietly writes zero would show up.
const { data: withClock } = await db
  .from("keeper_rights")
  .select("player_id, current_team_id, consecutive_seasons")
  .gt("consecutive_seasons", 0)
  .not("current_team_id", "is", null)
  .limit(1);

if (!withClock?.length) {
  check("a keeper with clock served exists to test with", false, "none found — re-seed");
} else {
  const subject = withClock[0];
  const holder = subject.current_team_id!;
  const other = teams.find((t) => t.id !== holder)!.id;
  const before = subject.consecutive_seasons;

  const playerTrade = await proposeTrade({
    season: SEASON,
    notes: "seed-verify-trades: player leg",
    assets: [
      { fromTeam: holder, toTeam: other, assetType: "player", ref: subject.player_id },
    ],
  });
  createdTrades.push(playerTrade.id);
  await acceptTrade(playerTrade.id);

  const mid = await getRights(subject.player_id);
  check(
    "the trade moved him and reset his clock, per rule R5",
    mid?.currentTeamId === other && mid?.consecutiveSeasons === 0,
    `${nameOf(mid?.currentTeamId ?? null)}, clock ${mid?.consecutiveSeasons}`,
  );
  check(
    "and stamped the clock he left with, so a reversal has something exact to restore",
    mid?.priorOwnerClocks[holder] === before,
    `stamped ${mid?.priorOwnerClocks[holder]}, was ${before}`,
  );

  await reverseTrade(playerTrade.id);

  const after = await getRights(subject.player_id);
  check(
    `he is back with his original franchise carrying his original clock of ${before}`,
    after?.currentTeamId === holder && after?.consecutiveSeasons === before,
    `${nameOf(after?.currentTeamId ?? null)}, clock ${after?.consecutiveSeasons}`,
  );
  check(
    "the trade-back guard set by the undone trade is cleared too",
    after?.lastTeamId === null,
    `last_team_id = ${nameOf(after?.lastTeamId ?? null)}`,
  );

  /**
   * A trade APPLIED before the clock stamp existed leaves no record of the
   * pre-trade clock. Simulated by accepting a trade and then wiping the stamp,
   * which is exactly the row shape such a trade would have left behind. The
   * reversal must refuse rather than write a clock it cannot know.
   */
  const unstamped = await proposeTrade({
    season: SEASON,
    notes: "seed-verify-trades: applied before the stamp existed",
    assets: [{ fromTeam: holder, toTeam: other, assetType: "player", ref: subject.player_id }],
  });
  createdTrades.push(unstamped.id);
  await acceptTrade(unstamped.id);
  await db
    .from("keeper_rights")
    .update({ prior_owner_clocks: {} })
    .eq("player_id", subject.player_id);

  let restoreRefused = "";
  try {
    await reverseTrade(unstamped.id);
  } catch (err) {
    restoreRefused = err instanceof Error ? err.message : String(err);
  }
  check(
    "with no stamped clock, the reversal refuses rather than writing a wrong one",
    /no record of the keeper clock/.test(restoreRefused),
    restoreRefused || "it silently reversed",
  );
  check(
    "and the refusal leaves the trade marked accepted, not falsely undone",
    (await db.from("trades").select("status").eq("id", unstamped.id).maybeSingle()).data
      ?.status === "accepted",
  );

  // Leave the ledger as it was found.
  await db
    .from("keeper_rights")
    .update({
      current_team_id: holder,
      consecutive_seasons: before,
      last_team_id: null,
      prior_owner_clocks: {},
    })
    .eq("player_id", subject.player_id);
}

// --- cleanup ----------------------------------------------------------------

section("8. Cleaning up after the test");

for (const id of createdTrades) {
  await db.from("traded_picks").delete().eq("trade_id", id);
  await db.from("trades").delete().eq("id", id);
}

// Put the two rounds back the way they were found.
for (const original of [STEFAN, WITTE, ZACH]) {
  await db
    .from("pick_ownership")
    .update({ current_team: original, updated_at: new Date().toISOString() })
    .eq("season", PICK_SEASON)
    .eq("round", ROUND)
    .eq("original_team", original);
}

const restored = await Promise.all([ownerOf(STEFAN), ownerOf(WITTE), ownerOf(ZACH)]);
check(
  "every pick this test moved is back with its original franchise",
  restored[0] === STEFAN && restored[1] === WITTE && restored[2] === ZACH,
  restored.map(nameOf).join(", "),
);

const ownership = await listPickOwnership(SEASON);
check(
  `the ${SEASON} board's own ownership ledger is unchanged (${ownership.filter((o) => o.traded).length} traded)`,
  ownership.filter((o) => o.traded).length === 29,
  `${ownership.filter((o) => o.traded).length} traded, expected 29`,
);

console.log(
  `\n${"=".repeat(72)}\n${failures === 0 ? "ALL TRADE CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n${"=".repeat(72)}\n`,
);
process.exit(failures === 0 ? 0 : 1);

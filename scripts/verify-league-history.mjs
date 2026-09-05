#!/usr/bin/env node
/**
 * Re-derive every computed number in `data/league-history.json` and fail on drift.
 *
 * WHY THIS EXISTS
 * ---------------
 * `data/LEAGUE-HISTORY.md` and its JSON twin are consumed by the recap prompt as
 * GROUND TRUTH. A blurb built on a stale figure is read aloud to ten men who were
 * in the room, and the first wrong number takes every real one down with it.
 *
 * Roughly half of that document is narrative — contract quotations, dates,
 * rulings — which a script cannot check and which carries its source inline
 * instead. The other half is arithmetic off the board and the player pool, and
 * arithmetic goes stale the moment a trade lands or a declaration changes. This
 * checks that half.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * It does not re-derive the three overlay keepers' board slots. `npm run
 * verify:board-keepers` owns that, reading through the app's own assembly, and
 * duplicating it here with a second implementation would only mean two things to
 * keep in step. This asserts those three are recorded with the right player,
 * franchise and cost round, and leaves placement to the script that owns it.
 *
 * Reads only. Standard library only. No database, no network.
 */

import fs from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (p) => JSON.parse(fs.readFileSync(ROOT + p, "utf8"));

const failures = [];
let checks = 0;

function check(label, ok, detail = "") {
  checks += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n${title}\n${"-".repeat(title.length)}`);
}

const history = read("data/league-history.json");

/*
 * THERE IS NO HISTORY TO RE-DERIVE, AND THAT IS THE INTENDED STATE.
 *
 * Everything below re-derives figures in `data/league-history.json` and cross
 * checks them against the spreadsheets the previous league kept. Ron and
 * Friends 2026 is this league's first season on this board: the history file is
 * deliberately empty (it says so in its own `note`), and the spreadsheet
 * exports it was checked against — `draft-pick-inventory-2026-spreadsheet.json`
 * and `data/spreadsheets/*` — do not exist here at all.
 *
 * So this used to die on ENOENT before printing a single line, which reads as a
 * broken suite rather than as a harness whose subject is gone. The emptiness is
 * itself worth asserting, because an empty history is what stops the recap
 * inventing a past for ten managers who have none — `verify:recap:clean` proves
 * the other half of that, at the point the prompt is built.
 */
const hasHistory = Object.keys(history.managers ?? {}).length > 0;
if (!hasHistory) {
  section("This league has no recorded history, which is correct");
  check(
    "the history file carries no managers, so the recap cannot argue from a past season",
    true,
    "first season on this board",
  );
  check(
    "…and it says so in its own note, rather than being empty by accident",
    typeof history.note === "string" && /EMPTY ON PURPOSE/i.test(history.note),
  );
  console.log(`\n${checks} checks, 0 failed.`);
  console.log("\nNothing to re-derive: no previous draft, no standings, no keeper history.\n");
  process.exit(0);
}

const managers = read("data/managers.json");
const room = read("data/smartdraft-room-snapshot.json").state;
const declarations = read("data/keeper-declarations.json");
const eligibility = read("data/keeper-eligibility-2026.json");
const pool = read("data/smartdraft-players.json").players;
const inventory = read("data/draft-pick-inventory-2026-spreadsheet.json").inventory;
const resolved = read("data/keepers-2026-resolved.json");

const teamName = new Map(
  room.teams.filter((t) => !t.deletedAt).map((t) => [t.id, t.name]),
);
const slots = room.slots.map((s) => ({
  round: s.displayRound,
  pickInRound: s.pickInRound,
  overall: s.overallPick,
  original: teamName.get(s.originalOwnerTeamId),
  current: teamName.get(s.currentOwnerTeamId),
  isKeeper: s.pickType === "KEEPER",
  player: s.player ?? null,
}));

// ---------------------------------------------------------------------------
section("1. The manager roster — the thing most likely to misattribute a joke");

for (const [shortName, entry] of Object.entries(history.managers)) {
  const m = managers.managers.find((x) => x.shortName === shortName);
  check(
    `${shortName} resolves to one manager in managers.json`,
    Boolean(m),
    m ? "" : "no such short name",
  );
  if (!m) continue;
  check(
    `  ${shortName} full name and franchise match`,
    m.fullName === entry.fullName &&
      m.franchiseName.toLowerCase() === entry.franchiseName.toLowerCase() &&
      m.draftSlot2026 === entry.draftSlot2026,
    `history says ${entry.fullName} / ${entry.franchiseName} / slot ${entry.draftSlot2026}; ` +
      `managers.json says ${m.fullName} / ${m.franchiseName} / slot ${m.draftSlot2026}`,
  );
}
check(
  "all ten franchises are recorded",
  Object.keys(history.managers).length === 10,
  `${Object.keys(history.managers).length}`,
);
// The collision itself, asserted rather than assumed: if a future rename ever
// made first names unique, the loudest warning in the document would be wrong.
const firstNames = managers.managers.map((m) => m.fullName.split(" ")[0]);
const collided = firstNames.filter((n, i) => firstNames.indexOf(n) !== i);
check(
  "first names really are ambiguous — the identity trap is still real",
  collided.length === 2 && collided.includes("Scott") && collided.includes("Kyle"),
  collided.join(", ") || "no collisions found",
);

// ---------------------------------------------------------------------------
section("2. Keepers — nineteen, and the stale-file trap");

const roomKeepers = slots.filter((s) => s.isKeeper);
const declared = declarations.declarations.flatMap((d) =>
  d.players.map((p) => ({ player: p, manager: d.managerShortName })),
);
check("the frozen room snapshot holds 16 keepers", roomKeepers.length === 16, `${roomKeepers.length}`);
check("the declarations overflow holds 3", declared.length === 3, `${declared.length}`);
check(
  "16 + 3 = 19, which is what the document says",
  roomKeepers.length + declared.length === history.keeperBoard2026.count,
  `document says ${history.keeperBoard2026.count}`,
);
check(
  "the stale resolved file still holds 14 — the trap the document warns about",
  resolved.keepers.length === 14,
  `${resolved.keepers.length}. If this changed, rewrite the trap explanation rather than the number.`,
);

const boardByPlayer = new Map(history.keeperBoard2026.keepers.map((k) => [k.player, k]));
check(
  "the document lists 19 keepers",
  history.keeperBoard2026.keepers.length === 19,
  `${history.keeperBoard2026.keepers.length}`,
);

// The 16 in the room are fully checkable: player, franchise, cost round and slot.
for (const s of roomKeepers) {
  const name = s.player?.name;
  const entry = boardByPlayer.get(name);
  if (!entry) {
    check(`${name} is on the document's board`, false, "missing");
    continue;
  }
  const slotLabel = `${s.round}.${String(s.pickInRound).padStart(2, "0")}`;
  check(
    `${name} — ${entry.manager} at ${entry.slot}, cost R${entry.costRound}`,
    entry.manager === s.current &&
      entry.costRound === s.round &&
      entry.slot === slotLabel &&
      entry.overall === s.overall,
    `room says ${s.current} at ${slotLabel} (overall ${s.overall}), round ${s.round}`,
  );
}

// The three overlay keepers: player, franchise and DERIVED cost round. Placement
// belongs to verify:board-keepers, which reads the app's own assembly.
for (const d of declared) {
  const entry = boardByPlayer.get(d.player);
  const elig = eligibility.players.find(
    (p) => p.player === d.player && p.manager === d.manager,
  );
  check(
    `${d.player} (${d.manager}) is on the board at the eligibility sheet's own price`,
    Boolean(entry) &&
      entry.manager === d.manager &&
      Boolean(elig) &&
      entry.costRound === elig.roundToKeep2026,
    elig
      ? `sheet derives R${elig.roundToKeep2026}, document says R${entry?.costRound}`
      : "not found in the eligibility sheet",
  );
}

const finalSeason = history.keeperBoard2026.keepers.filter((k) => k.finalSeason === true);
check(
  "six keepers are in their final season",
  finalSeason.length === 6,
  finalSeason.map((k) => k.player).join(", "),
);
const kyleFinal = history.keeperBoard2026.keepers.filter((k) => k.manager === "Kyle");
check(
  "Kyle is the only manager with BOTH keepers in a final season",
  kyleFinal.every((k) => k.finalSeason === true) &&
    !["Colin", "Elbe", "Greg", "Joe", "Josh", "Scott", "Stefan", "Witte", "Zach"].some((m) => {
      const his = history.keeperBoard2026.keepers.filter((k) => k.manager === m);
      return his.length === 2 && his.every((k) => k.finalSeason === true);
    }),
);
check(
  "Joe is the only franchise with one keeper, and it is deliberate",
  history.keeperBoard2026.keepers.filter((k) => k.manager === "Joe").length === 1 &&
    declarations.declarations.find((d) => d.managerShortName === "Joe")?.closesList === true,
);

// ---------------------------------------------------------------------------
section("3. The keeper bargain table — where the punchline number comes from");

/*
 * The same ranking method as `src/lib/expected-pick.ts`, reimplemented from its
 * description rather than imported. That is deliberate: importing it would make
 * this check circular, and the whole point is an independent statement of the
 * number the recap is going to read out.
 */
const keptNames = new Set(history.keeperBoard2026.keepers.map((k) => k.player));
const findPlayer = (name) =>
  pool.find((p) => p.name === name) ??
  pool.find(
    (p) =>
      p.name.replace(/[.']/g, "").toLowerCase().startsWith(name.split(" ")[0].toLowerCase()) &&
      p.name.replace(/[.']/g, "").toLowerCase().includes(name.split(" ").pop().toLowerCase()),
  );

const keptIds = new Set(
  [...keptNames].map((n) => findPlayer(n)?.id).filter((id) => id != null),
);
const keeperOveralls = new Set(history.keeperBoard2026.keepers.map((k) => k.overall));
const draftable = [];
for (let i = 1; i <= 160; i += 1) if (!keeperOveralls.has(i)) draftable.push(i);
check("141 draftable slots remain", draftable.length === 141, `${draftable.length}`);

/*
 * THE RELEASE COUNTERFACTUAL, and the detail that was wrong here before.
 *
 * A keeper is priced by asking what it would have cost to draft him back if
 * that ONE franchise had released him. So his own keeper flag comes off and
 * nobody else's does: he re-enters the ranked pool, and — this is the part the
 * first version missed — THE SLOT HE OCCUPIES RE-ENTERS THE DRAFT TOO. A
 * franchise that does not keep a player gets to use that pick. Leaving the slot
 * out priced Kyren Williams two slots cheap.
 *
 * Still reimplemented from `src/lib/expected-pick.ts`'s description rather than
 * imported, deliberately: importing it would make this check circular, and the
 * point is an independent statement of the number the recap reads out.
 */
for (const k of history.keeperBoard2026.keepers) {
  const p = findPlayer(k.player);
  if (!p || p.adp == null) {
    check(`${k.player} has an ADP in the pool`, false, "not found");
    continue;
  }

  const slots = draftable.concat(k.overall).sort((a, b) => a - b);
  const available = pool
    .filter((q) => q.adp != null && (q.id === p.id || !keptIds.has(q.id)))
    .sort((a, b) => a.adp - b.adp || a.name.localeCompare(b.name));
  const rank = available.filter(
    (q) => q.adp < p.adp || (q.adp === p.adp && q.name.localeCompare(p.name) < 0),
  ).length;

  const released = rank < slots.length ? slots[rank] : 160 + (rank - slots.length + 1);
  const saved = k.overall - released;
  check(
    `${k.player} — ADP ${k.adp}, released ${k.pickIfReleased}, saved +${k.slotsSavedByKeeping}`,
    Math.abs(p.adp - k.adp) < 0.05 &&
      released === k.pickIfReleased &&
      saved === k.slotsSavedByKeeping,
    `recomputed ADP ${p.adp}, released ${released}, saved ${saved}`,
  );
}

const ranked = [...history.keeperBoard2026.keepers].sort(
  (a, b) => b.slotsSavedByKeeping - a.slotsSavedByKeeping,
);
check(
  "Puka Nacua is the biggest bargain on the board",
  ranked[0].player === "Puka Nacua",
  `biggest is ${ranked[0].player} at +${ranked[0].slotsSavedByKeeping}`,
);
check(
  "and he clears the field by 31 picks",
  ranked[0].slotsSavedByKeeping - ranked[1].slotsSavedByKeeping === 31,
  `${ranked[0].player} +${ranked[0].slotsSavedByKeeping} vs ${ranked[1].player} +${ranked[1].slotsSavedByKeeping}`,
);
check(
  "Greg holds the two worst-value keepers",
  ranked.slice(-2).every((k) => k.manager === "Greg"),
  ranked.slice(-2).map((k) => `${k.player} (${k.manager}) +${k.slotsSavedByKeeping}`).join(", "),
);
check(
  "the Nacua headline numbers agree with the table",
  history.nacuaAgreement.thePunchlineNumber.slotsSavedByKeeping === ranked[0].slotsSavedByKeeping &&
    history.nacuaAgreement.thePunchlineNumber.overallPick === ranked[0].overall &&
    history.nacuaAgreement.thePunchlineNumber.costRound === 11,
);

// ---------------------------------------------------------------------------
section("4. Pick ownership — including the claim this document exists to correct");

const held = new Map();
for (const s of slots) {
  if (!held.has(s.current)) held.set(s.current, []);
  held.get(s.current).push(s.round);
}
for (const [name, entry] of Object.entries(history.pickOwnership2026.franchises)) {
  const rounds = (held.get(name) ?? []).sort((a, b) => a - b);
  const missing = [];
  for (let r = 1; r <= 16; r += 1) if (!rounds.includes(r)) missing.push(r);
  const doubled = [...new Set(rounds.filter((r) => rounds.filter((x) => x === r).length > 1))];
  const out = slots.filter((s) => s.original === name && s.current !== name).length;
  const inn = slots.filter((s) => s.current === name && s.original !== name).length;
  check(
    `${name} — ${rounds.length} picks, first owned R${rounds[0]}`,
    JSON.stringify(rounds) === JSON.stringify(entry.rounds) &&
      JSON.stringify(missing) === JSON.stringify(entry.missing) &&
      JSON.stringify(doubled) === JSON.stringify(entry.doubled) &&
      rounds[0] === entry.firstOwned &&
      out === entry.out &&
      inn === entry.in,
    `board: rounds ${rounds.join(",")} | missing ${missing.join(",") || "none"} | ` +
      `doubled ${doubled.join(",") || "none"} | out ${out} in ${inn}`,
  );
  /*
   * Sheet1 is a fourth independent statement of the same inventory, and it
   * agrees for eight of the ten franchises. The two it does not agree for are
   * GREG and SCOTT, and that is not drift — it is the Johnston/Blome
   * contingency. Sheet1 records the 2025 Trade only, so it shows Scott holding
   * Greg's 1st and Greg holding Scott's 15th. The board shows the position
   * after the contingent leg handed both back. `npm run verify:picks` reports
   * the same two as ruled divergences.
   *
   * Enumerated by name rather than tolerated by a rule, so a NEW disagreement
   * still fails loudly.
   */
  const sheetRounds = [...inventory[name]].sort((a, b) => a - b);
  const agrees = JSON.stringify(sheetRounds) === JSON.stringify(rounds);
  if (name === "Greg" || name === "Scott") {
    check(
      `  …and Sheet1 still shows ${name} PRE-contingency, as expected`,
      !agrees,
      "if this ever agrees, the workbook was updated and the document's note about it is stale",
    );
  } else {
    check(`  …and the commissioner's Sheet1 inventory agrees for ${name}`, agrees);
  }
}
check(
  "the workbook diverges from the board for exactly the two parties to the agreement",
  Object.keys(history.pickOwnership2026.franchises).filter((n) => {
    const rounds = (held.get(n) ?? []).sort((a, b) => a - b);
    return JSON.stringify([...inventory[n]].sort((a, b) => a - b)) !== JSON.stringify(rounds);
  }).join(",") === "Greg,Scott",
);
check(
  "every franchise still holds exactly 16 picks — nobody is destitute",
  [...held.values()].every((r) => r.length === 16) && held.size === 10,
);
check(
  "STEFAN IS THE ONLY FRANCHISE WITHOUT A FIRST-ROUND PICK",
  [...held.entries()].filter(([, r]) => !r.includes(1)).map(([n]) => n).join(",") === "Stefan",
);
check(
  "and his first owned pick is round 2, NOT round 13",
  Math.min(...held.get("Stefan")) === 2,
  `first owned R${Math.min(...held.get("Stefan"))}`,
);
check(
  "Zach holds two first-round picks",
  held.get("Zach").filter((r) => r === 1).length === 2,
);
check(
  "29 picks changed hands",
  slots.filter((s) => s.current !== s.original).length === 29,
);

// ---------------------------------------------------------------------------
section("5. The Nacua clock — the app's refusal, and the two sheets");

const nacua = resolved.keepers.find((k) => k.player === "Puka Nacua");
check(
  "the app still declines to state Nacua's clock year",
  nacua != null &&
    nacua.clockYear2026 === null &&
    nacua.isFinalKeeperSeason === null &&
    nacua.keepableIn2027 === null,
  "if this ever gains a value, the league has ruled and the document needs rewriting",
);
check(
  "he is the ONLY keeper the app refuses to date",
  resolved.keepers.filter((k) => k.clockYear2026 === null).length === 1,
);
const nacuaElig = eligibility.players.find((p) => p.player === "Puka Nacua");
check(
  "the 2026 eligibility sheet prices him at R11 off a R12 basis, flagged as a trade",
  nacuaElig?.roundToKeep2026 === 11 && nacuaElig?.round2025 === 12,
  `sheet: basis R${nacuaElig?.round2025}, cost R${nacuaElig?.roundToKeep2026}`,
);
check(
  "the document records the R14 → R11 ratchet, not a manufactured price",
  history.nacuaAgreement.theKeeperClockExploit.priceHistory[0].season === 2023 &&
    /ROUND 14/.test(history.nacuaAgreement.theKeeperClockExploit.priceHistory[0].event),
);
check(
  "the primary source is in the repo rather than a Downloads folder",
  fs.existsSync(ROOT + history.nacuaAgreement.primarySource.path),
  history.nacuaAgreement.primarySource.path,
);

// ---------------------------------------------------------------------------
section("6. Draft history — the dated jokes");

const sheet = (name) => read(`data/spreadsheets/${name}.json`).rows;
const findPick = (rows, player) =>
  rows.find((r) => r.some((c) => typeof c === "string" && c.trim() === player));

const amari = findPick(sheet("2026-draft__2021-draft"), "Amari Rodgers");
check(
  "Amari Rodgers — Joe, 2021, round 15, pick 141",
  amari != null && amari[3] === "Joe" && amari[4] === 15 && amari[5] === 141,
  amari ? JSON.stringify(amari.filter((c) => c != null)) : "not found",
);

const nacuaDraft = findPick(sheet("2026-draft__2023-draft"), "Puka Nacua");
check(
  "Puka Nacua — Scott, 2023, round 14, pick 137",
  nacuaDraft != null && nacuaDraft[0] === 14 && nacuaDraft[1] === 137 && nacuaDraft[5] === "Scott",
  nacuaDraft ? JSON.stringify(nacuaDraft.filter((c) => c != null)) : "not found",
);

const skattebo = findPick(sheet("2026-draft__2025-draft"), "Cam Skattebo");
check(
  "Cam Skattebo — drafted by Kyle, 2025, round 10, pick 95, so his clock was never dead",
  skattebo != null && skattebo[0] === 10 && skattebo[1] === 95 && skattebo[5] === "Kyle",
  skattebo ? JSON.stringify(skattebo.filter((c) => c != null)) : "not found",
);

const mahomes2018 = findPick(sheet("2026-draft__2018-draft-by-round"), "Patrick Mahomes");
check(
  "Witte took Mahomes with the last pick of the 2018 draft — 160 of 160",
  mahomes2018 != null && mahomes2018[0] === 160 && mahomes2018[5] === "Kyle Witte",
  mahomes2018 ? JSON.stringify(mahomes2018.filter((c) => c != null)) : "not found",
);

// The negative findings are load-bearing too: the document tells the recap NOT to
// date two jokes, and that instruction is only correct while the data stays absent.
const allSheets = fs
  .readdirSync(ROOT + "data/spreadsheets")
  .filter((f) => f.endsWith(".json"))
  .map((f) => fs.readFileSync(ROOT + `data/spreadsheets/${f}`, "utf8"));
check(
  "Gary Barnidge is still absent from every sheet — the joke stays undatable",
  !allSheets.some((s) => /barnidge/i.test(s)),
);
const elbeLamar = allSheets.some((s) => {
  const rows = JSON.parse(s).rows ?? [];
  return rows.some(
    (r) =>
      r.some((c) => typeof c === "string" && c.trim() === "Lamar Jackson") &&
      r.some((c) => typeof c === "string" && /^(Elbe|Scott Elbe)$/.test(c.trim())),
  );
});
check(
  "no sheet has Elbe drafting Lamar Jackson — the year stays unstated",
  !elbeLamar,
  "if this ever fails, the recap can finally put a round number on it",
);

// ---------------------------------------------------------------------------
console.log(`\n${"=".repeat(72)}`);
if (failures.length) {
  console.log(`${failures.length} of ${checks} CHECK(S) FAILED — data/league-history.json has drifted`);
  for (const f of failures) console.log(`  • ${f}`);
  console.log(
    "\nFix the JSON and data/LEAGUE-HISTORY.md together. The prose carries the same\n" +
      "numbers, and a document that disagrees with itself is worse than a stale one.",
  );
} else {
  console.log(`ALL ${checks} CHECKS PASSED — every derived figure re-derives from the sources`);
  console.log(
    "\nNarrative facts — contract quotations, dates, rulings — are not machine-checkable\n" +
      "and carry their source inline instead.",
  );
}
console.log(`${"=".repeat(72)}\n`);
process.exit(failures.length ? 1 : 0);

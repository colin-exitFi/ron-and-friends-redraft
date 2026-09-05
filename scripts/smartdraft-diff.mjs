/**
 * Diffs two Smart Draft room snapshots and validates the newer one against the
 * league's keeper rules.
 *
 *   npm run diff:room                       # newest archive vs the live snapshot
 *   npm run diff:room -- <old.json> [new.json]
 *
 * The room is still being filled in ahead of the draft — keepers arrive late,
 * one manager at a time — so after every `npm run pull:room` this answers the
 * only two questions that matter: what moved, and is any of it illegal.
 *
 * Rule checks come from `data/DECISIONS.md`:
 *   - at most two keepers per team;
 *   - cost round = the round the player occupied last season, minus one;
 *   - a free-agent acquisition costs round 9 instead;
 *   - a player whose keeper clock is exhausted cannot be kept at all.
 *
 * Clock status and last season's round are read from
 * `data/keeper-eligibility-2026.json`, which is the `KEEPER LIST for 2026` sheet.
 * Exits non-zero if a rule is violated, so this can gate a pull.
 */
import { readdirSync, readFileSync } from "node:fs";

const DATA = new URL("../data/", import.meta.url);
const ARCHIVE = new URL("snapshots/", DATA);

const read = (url) => JSON.parse(readFileSync(url, "utf8"));

function resolveInputs() {
  const [oldArg, newArg] = process.argv.slice(2);
  const newUrl = newArg ? new URL(newArg, `file://${process.cwd()}/`) : new URL("smartdraft-room-snapshot.json", DATA);
  if (oldArg) return [new URL(oldArg, `file://${process.cwd()}/`), newUrl];

  const archives = readdirSync(ARCHIVE)
    .filter((f) => f.startsWith("smartdraft-room-") && f.endsWith(".json"))
    .sort();
  if (!archives.length) throw new Error("No archived snapshots in data/snapshots/ to diff against.");
  return [new URL(archives.at(-1), ARCHIVE), newUrl];
}

// --- Snapshot shape ---------------------------------------------------------

function summarise(snapshot) {
  const s = snapshot.state ?? {};
  const teams = new Map((s.teams ?? []).filter((t) => !t.deletedAt).map((t) => [t.id, t]));
  const slots = s.slots ?? [];
  const name = (id) => teams.get(id)?.name ?? `<unknown ${id}>`;

  return {
    status: s.status,
    rounds: s.draftRoundCount,
    keeperRoundCount: s.keeperRoundCount,
    slotCount: slots.length,
    settings: s.settings ?? {},
    teams: [...teams.values()].sort((a, b) => a.orderKey - b.orderKey),
    order: [...teams.values()].sort((a, b) => a.orderKey - b.orderKey).map((t) => t.name),
    keepers: slots
      .filter((x) => x.pickType === "KEEPER")
      .map((x) => ({
        key: `${name(x.currentOwnerTeamId)}|${x.player?.name ?? "<empty>"}`,
        team: name(x.currentOwnerTeamId),
        player: x.player?.name ?? "<empty>",
        position: x.player?.position ?? "?",
        round: x.displayRound,
        slot: `${x.displayRound}.${String(x.pickInRound).padStart(2, "0")}`,
        overall: x.overallPick,
        tradedSlot: x.originalOwnerTeamId !== x.currentOwnerTeamId,
        from: name(x.originalOwnerTeamId),
      }))
      .sort((a, b) => a.overall - b.overall),
    traded: slots
      .filter((x) => x.originalOwnerTeamId !== x.currentOwnerTeamId)
      .map((x) => ({
        key: `${x.displayRound}|${name(x.originalOwnerTeamId)}|${name(x.currentOwnerTeamId)}`,
        slot: `${x.displayRound}.${String(x.pickInRound).padStart(2, "0")}`,
        from: name(x.originalOwnerTeamId),
        to: name(x.currentOwnerTeamId),
      }))
      .sort((a, b) => a.slot.localeCompare(b.slot)),
  };
}

// --- Reporting -------------------------------------------------------------

const problems = [];
const unexpected = [];

/** Compares serialised, because settings values include nested objects. */
function scalarDiff(label, before, after) {
  const a = JSON.stringify(before);
  const b = JSON.stringify(after);
  if (a === b) return;
  unexpected.push(`${label}: ${a} -> ${b}`);
}

function main() {
  const [oldUrl, newUrl] = resolveInputs();
  const before = summarise(read(oldUrl));
  const after = summarise(read(newUrl));

  console.log(`OLD  ${oldUrl.pathname.split("/data/").at(-1)}`);
  console.log(`NEW  ${newUrl.pathname.split("/data/").at(-1)}\n`);

  console.log(
    `keepers      ${before.keepers.length} -> ${after.keepers.length}\n` +
      `traded picks ${before.traded.length} -> ${after.traded.length}\n` +
      `teams        ${before.teams.length} -> ${after.teams.length}\n` +
      `rounds       ${before.rounds} -> ${after.rounds}\n` +
      `slots        ${before.slotCount} -> ${after.slotCount}`,
  );

  // Anything below is a change nobody asked for and should be looked at.
  scalarDiff("room status", before.status, after.status);
  scalarDiff("keeperRoundCount", before.keeperRoundCount, after.keeperRoundCount);
  scalarDiff("draft order", before.order.join(" > "), after.order.join(" > "));
  for (const k of new Set([...Object.keys(before.settings), ...Object.keys(after.settings)])) {
    scalarDiff(`settings.${k}`, before.settings[k], after.settings[k]);
  }

  const beforeKeepers = new Map(before.keepers.map((k) => [k.key, k]));
  const afterKeepers = new Map(after.keepers.map((k) => [k.key, k]));
  const added = after.keepers.filter((k) => !beforeKeepers.has(k.key));
  const removed = before.keepers.filter((k) => !afterKeepers.has(k.key));
  const moved = after.keepers.filter((k) => {
    const was = beforeKeepers.get(k.key);
    return was && was.slot !== k.slot;
  });

  console.log("\n--- KEEPERS ADDED ---");
  if (!added.length) console.log("(none)");
  for (const k of added) {
    console.log(
      `+ ${k.team.padEnd(7)} ${k.player.padEnd(22)} ${k.position.padEnd(4)} R${String(k.round).padEnd(2)} slot ${k.slot} (overall ${k.overall})` +
        (k.tradedSlot ? `  [in a slot acquired from ${k.from}]` : ""),
    );
  }
  for (const k of removed) console.log(`- ${k.team} ${k.player} R${k.round}`);
  for (const k of moved) console.log(`~ ${k.team} ${k.player} moved slot`);

  const beforeTraded = new Set(before.traded.map((t) => t.key));
  const afterTraded = new Set(after.traded.map((t) => t.key));
  const tradeAdds = after.traded.filter((t) => !beforeTraded.has(t.key));
  const tradeDrops = before.traded.filter((t) => !afterTraded.has(t.key));
  console.log("\n--- TRADED PICKS CHANGED ---");
  if (!tradeAdds.length && !tradeDrops.length) console.log("(none — identical set)");
  for (const t of tradeAdds) console.log(`+ ${t.slot} ${t.from} -> ${t.to}`);
  for (const t of tradeDrops) console.log(`- ${t.slot} ${t.from} -> ${t.to}`);

  const beforeTeams = new Map(before.teams.map((t) => [t.id, t]));
  console.log("\n--- TEAMS ---");
  let teamChanges = 0;
  for (const t of after.teams) {
    const was = beforeTeams.get(t.id);
    if (!was) {
      console.log(`+ new team ${t.name}`);
      teamChanges++;
    } else if (was.name !== t.name || was.orderKey !== t.orderKey) {
      console.log(`~ ${was.name} -> ${t.name} (orderKey ${was.orderKey} -> ${t.orderKey})`);
      teamChanges++;
    }
  }
  for (const t of before.teams) {
    if (!after.teams.some((x) => x.id === t.id)) {
      console.log(`- team removed: ${t.name}`);
      teamChanges++;
    }
  }
  if (!teamChanges) console.log("(none — same 10 teams, same order)");

  validate(after);

  console.log("\n--- UNEXPECTED CHANGES ---");
  console.log(unexpected.length ? unexpected.map((u) => `! ${u}`).join("\n") : "(none)");

  console.log("\n--- RULE CHECK ---");
  console.log(problems.length ? problems.map((p) => `VIOLATION: ${p}`).join("\n") : "All keepers pass.");

  console.log("\n--- KEEPER COUNT BY TEAM ---");
  const perTeam = new Map(after.teams.map((t) => [t.name, 0]));
  for (const k of after.keepers) perTeam.set(k.team, (perTeam.get(k.team) ?? 0) + 1);
  for (const [team, n] of perTeam) {
    console.log(`${team.padEnd(8)} ${n}${n === 0 ? "   <- none declared yet" : ""}`);
  }

  process.exit(problems.length ? 1 : 0);
}

// --- Rule validation -------------------------------------------------------

const FREE_AGENT_COST_ROUND = 9;
const MAX_KEEPERS_PER_TEAM = 2;

/**
 * Keepers the sheet assigns to a different manager than the room does, where the
 * commissioner has already ruled on who owns them. The sheet predates the trade,
 * so a mismatch here is expected rather than a violation.
 */
const OWNER_RULINGS = {
  "puka nacua": {
    team: "Scott",
    ruling:
      "commissioner ruled Nacua is Scott's; the contract also fixes his R11 eligibility " +
      "either way, and the trade restarts his clock (data/DECISIONS.md)",
  },
};

const normalise = (s) =>
  String(s)
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii)\b/g, "")
    .replace(/[^a-z]/g, "");

function validate(after) {
  const eligibility = read(new URL("keeper-eligibility-2026.json", DATA)).players;
  const byName = new Map(eligibility.map((p) => [normalise(p.player), p]));

  const perTeam = new Map();
  for (const k of after.keepers) perTeam.set(k.team, (perTeam.get(k.team) ?? 0) + 1);
  for (const [team, n] of perTeam) {
    if (n > MAX_KEEPERS_PER_TEAM) {
      problems.push(`${team} holds ${n} keepers; the limit is ${MAX_KEEPERS_PER_TEAM}.`);
    }
  }

  for (const k of after.keepers) {
    const sheet = byName.get(normalise(k.player));
    if (!sheet) {
      problems.push(`${k.player} (${k.team}) is not on the 2026 keeper-eligibility sheet at all.`);
      continue;
    }
    const ruling = OWNER_RULINGS[k.player.toLowerCase()];
    if (sheet.manager !== k.team) {
      if (ruling?.team === k.team) {
        console.log(`\nNOTE ${k.player}: sheet says ${sheet.manager}, room says ${k.team} — ${ruling.ruling}.`);
      } else {
        problems.push(
          `${k.player} is kept by ${k.team} but the sheet has him on ${sheet.manager}'s roster.`,
        );
      }
    }
    // A traded keeper's clock restarts with his new team, so the sheet's clock for
    // his old manager says nothing about whether the new one may keep him.
    if (sheet.eligible2026 === false && !ruling) {
      problems.push(
        `${k.player} (${k.team}) is kept at R${k.round} but his clock is exhausted — ` +
          `the sheet shows ${sheet.status2025} for 2025 and ${sheet.status2026} for 2026.`,
      );
    }
    // Either the −1 rule off last season's round, or the free-agent flat round.
    const decremented = sheet.round2025 - 1;
    if (k.round !== decremented && k.round !== FREE_AGENT_COST_ROUND) {
      problems.push(
        `${k.player} (${k.team}) is at R${k.round}; last season's round ${sheet.round2025} ` +
          `implies R${decremented}, and the free-agent round is R${FREE_AGENT_COST_ROUND}.`,
      );
    }
  }
}

main();

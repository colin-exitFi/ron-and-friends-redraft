/**
 * Re-pulls the live Smart Draft room into `data/smartdraft-room-snapshot.json`,
 * which is what the draft board renders from.
 *
 *   npm run pull:room
 *
 * SMART DRAFT IS NO LONGER THE SOURCE OF TRUTH FOR KEEPERS. Commissioner ruling,
 * Aug 28 2026: this app and its database are, and the room has not been updated
 * since he began building this app. So a pull brings in a board that is behind on
 * declarations by design, and the keeper count it prints below is the ROOM's, not
 * the league's. `data/keeper-declarations.json` holds what never reached the room,
 * and the reconciliation overlay adds it. Read the real figure with
 * `npm run verify:board-keepers`.
 *
 * The room is not final until draft day — traded picks may still be entered — so
 * this needs re-running on Friday and probably again on Saturday morning. It must
 * therefore stay a one-command operation with the room id baked in.
 *
 * Every run first archives the outgoing snapshot to `data/snapshots/`, stamped
 * with the time it was pulled, so pulls can be diffed against each other in the
 * run-up to the draft. Losing the prior state would make a late change to the
 * board impossible to spot.
 *
 * There is no REST endpoint for room state; the room only exists over socket.io,
 * so joining it as a viewer and catching the first `room_state` broadcast is the
 * only way to read it.
 */
import { copyFileSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { io } from "socket.io-client";

const ROOM_ID = process.argv[2] ?? process.env.SMARTDRAFT_ROOM_ID ?? "465dc002-920d-4490-9926-70165387b6bb";
const API = "https://api.smartdraft.app";
const TIMEOUT_MS = 25_000;

const DATA_DIR = new URL("../data/", import.meta.url);
const SNAPSHOT = new URL("smartdraft-room-snapshot.json", DATA_DIR);
const ARCHIVE_DIR = new URL("snapshots/", DATA_DIR);

/**
 * Archive the outgoing snapshot under the time it was pulled rather than the
 * time it was archived, so the filenames line up with when the room actually
 * looked that way. Colons are stripped because they travel badly.
 */
function archiveCurrentSnapshot() {
  let pulledAt;
  try {
    pulledAt = statSync(SNAPSHOT).mtime.toISOString();
  } catch {
    return null; // First ever pull — nothing to preserve.
  }
  mkdirSync(ARCHIVE_DIR, { recursive: true });
  const stamp = pulledAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  const target = new URL(`smartdraft-room-${stamp}.json`, ARCHIVE_DIR);
  copyFileSync(SNAPSHOT, target);
  return path.basename(target.pathname);
}

const socket = io(API, {
  transports: ["websocket", "polling"],
  path: "/socket.io",
  withCredentials: true,
});

const done = (code) => {
  socket.close();
  process.exit(code);
};

const timer = setTimeout(() => {
  console.error(`TIMEOUT: no room_state after ${TIMEOUT_MS / 1000}s`);
  done(1);
}, TIMEOUT_MS);

socket.on("connect", () => {
  console.log(`Connected to ${API} (${socket.id}); joining room ${ROOM_ID}`);
  socket.emit("join_room", { roomId: ROOM_ID, claimTokens: {}, actorName: "Viewer" });
});

socket.on("error", (e) => console.error("ERROR", JSON.stringify(e)));
socket.on("connect_error", (e) => console.error("CONNECT_ERROR", e.message));

socket.on("room_state", (payload) => {
  clearTimeout(timer);

  const archived = archiveCurrentSnapshot();

  const state = payload?.state ?? {};
  const slots = state.slots ?? [];
  const teams = (state.teams ?? []).filter((t) => !t.deletedAt);
  const keepers = slots.filter((s) => s.pickType === "KEEPER").length;
  const traded = slots.filter((s) => s.originalOwnerTeamId !== s.currentOwnerTeamId).length;

  /*
   * Written back on every pull, ahead of the payload, so re-pulling cannot
   * silently drop the warning. Anyone opening the file hits this before the data.
   * Readers destructure `state`, so the extra key is inert.
   */
  const provenance = {
    FROZEN_HISTORICAL_IMPORT:
      "NOT AUTHORITATIVE for the keeper set or the keeper count. Commissioner ruling, " +
      "Aug 28 2026: this app and its database are the source of truth for keepers, and " +
      "Smart Draft has NOT been updated since he began building this app.",
    pulledAt: new Date().toISOString().slice(0, 10),
    keeperSlotsInThisSnapshot: keepers,
    whyThatIsNotTheLeagueTotal:
      "Declarations that never reached Smart Draft live in data/keeper-declarations.json " +
      "and are added by the reconciliation overlay. This number plus those is the board.",
    doNotDoThis:
      "Do not add this count to any other file's count, and do not add " +
      "data/keepers-2026-resolved.json's 14 to data/keeper-declarations.json's 3 to get " +
      "17 — that drops Scott Elbe's two twice.",
    readInstead: "npm run verify:board-keepers",
  };
  writeFileSync(SNAPSHOT, `${JSON.stringify({ _PROVENANCE: provenance, ...payload }, null, 2)}\n`);

  if (archived) console.log(`Archived previous snapshot to data/snapshots/${archived}`);
  console.log(
    `Wrote data/smartdraft-room-snapshot.json — ${teams.length} teams, ` +
      `${state.draftRoundCount} rounds, ${slots.length} slots, ` +
      `${keepers} keepers, ${traded} traded picks.`,
  );
  console.log(
    `  NOTE: ${keepers} is the ROOM's keeper count, not the league's. ` +
      `Run npm run verify:board-keepers for the real figure.`,
  );
  done(0);
});

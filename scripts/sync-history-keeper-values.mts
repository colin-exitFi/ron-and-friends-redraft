/**
 * Re-derives the keeper valuation in `data/league-history.json` from the
 * current player pool.
 *
 *   npm run sync:history-keepers
 *
 * WHY THIS HAS TO EXIST. The history document is a dated artefact; the recap's
 * dossier recomputes from whatever pool is on disk right now. Re-pulling ADP
 * moves the second and not the first, so the two drift apart by a slot or two
 * on a handful of keepers — which is harmless in the document and NOT harmless
 * in a prompt, because the model reads the document's figures and the card
 * prints the dossier's, and the room sees both on one line.
 *
 * `verify:recap` reports that drift and names the keepers. This closes it.
 *
 * The counterfactual is the release one: this keeper's flag cleared and nobody
 * else's, so he re-enters the ranked pool and his slot re-enters the draft.
 * Same `buildExpectedPicks` the board uses; only the premise changes. See the
 * two-measures note in `@/lib/recap-dossier`.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { buildExpectedPicks } from "@/lib/expected-pick";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";

const board = getBoard();
const pool = getPlayerPool();
const file = "data/league-history.json";
const doc = JSON.parse(readFileSync(file, "utf8"));

/*
 * FULL NAME, NOT SURNAME. Javonte Williams and Kyren Williams are both keepers
 * in this league, and a surname key silently collapses them onto one slot.
 */
const norm = (n: string) => n.toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();
const byName = new Map(
  board.slots.filter((s) => s.isKeeper && s.player).map((s) => [norm(s.player!.name), s]),
);

let changed = 0;
for (const k of doc.keeperBoard2026.keepers) {
  const slot = byName.get(norm(String(k.player)));
  if (!slot) throw new Error(`no board keeper for ${k.player}`);

  const expected = buildExpectedPicks(
    pool,
    board.slots.map((s) => (s.id === slot.id ? { ...s, isKeeper: false } : s)),
  )[slot.player!.id];
  if (expected == null) throw new Error(`no expectation for ${k.player}`);

  const saved = slot.overallPick - expected;
  if (k.expected !== expected || k.steal !== saved) changed++;

  k.pickIfReleased = expected;
  k.slotsSavedByKeeping = saved;
}

doc.keeperBoard2026.note =
  "Every 2026 keeper priced against the RELEASE counterfactual: where this board " +
  "would have taken him had that one franchise not kept him — everybody else's " +
  "keepers standing, and his own slot returned to the draft. " +
  "`slotsSavedByKeeping` is `overall - pickIfReleased`; positive means keeping " +
  "him cost a later pick than redrafting him would have. This is the KEEPER " +
  "measure and is not comparable to the reach/steal figure on a drafted pick, " +
  "which is measured against the board that actually existed. See the two-measures " +
  "note in src/lib/recap-dossier.ts.";

writeFileSync(file, `${JSON.stringify(doc, null, 1)}\n`);
console.log(`rewrote ${doc.keeperBoard2026.keepers.length} keepers, ${changed} value(s) changed`);

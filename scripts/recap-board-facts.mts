/**
 * Prints `{ picksEntered, boardFingerprint, teamIds }` for whatever board is in
 * `data/` right now, as JSON on stdout.
 *
 * Run through `scripts/draft-loader.mjs`; see `scripts/recap-fixture.mjs` for
 * why the loader is needed and why this has to be its own process.
 *
 * It exists so a harness can mint a recap document that the page will treat as
 * FRESH against the current board. `recapStaleness` compares a stored recap's
 * pick count and board fingerprint with the live ones, so a fixture recap
 * carrying the fixture board's numbers always draws a staleness banner — which
 * is a real state worth checking, but it is not the state the league actually
 * looks at, and it cannot be screenshotted around.
 */

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import { readClosedKeeperLists, readKeeperOptions } from "@/lib/recap-source";
import { currentBoardFingerprint, readPool, readRoom } from "@/lib/draft-service";
import { SUBJECT_LABEL, gradeSubject } from "@/lib/recap-grade";

const view = await readRoom();
const pool = readPool();
const dossier = buildRecapDossier({
  view,
  expectedPick: buildExpectedPicks(pool, view.slots),
  pool,
  keeperOptions: readKeeperOptions(),
  closedKeeperLists: readClosedKeeperLists(),
});

process.stdout.write(
  JSON.stringify({
    picksEntered: dossier.picksEntered,
    keepersOutOfPool: dossier.keepersOutOfPool,
    boardComplete: dossier.boardComplete,
    boardFingerprint: currentBoardFingerprint(),
    /*
     * What a letter on THIS board is allowed to call itself. Re-pointed onto a
     * fixture recap for the same reason the pick count is: the fixture is a
     * finished draft and the harness also shows it over a board with nothing on
     * it, and "Draft grade" printed there would be the fixture asserting a
     * draft that has not happened — the exact claim the label exists to stop.
     */
    gradeSubjectLabel: SUBJECT_LABEL[gradeSubject(dossier)],
    teams: dossier.franchises.map((f) => ({ teamId: f.teamId, teamName: f.teamName })),
  }),
);

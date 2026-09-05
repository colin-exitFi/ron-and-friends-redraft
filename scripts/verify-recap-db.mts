/**
 * Proves the recap round-trips through POSTGRES, not just through a file.
 *
 *   npm run verify:recap:db
 *
 * WHY THIS IS A SEPARATE CHECK. `verify:recap` proves the numbers and
 * `verify:recap:browser` proves the tab draws them, and both run against the
 * FILE store, because that is what a laptop with a writable `data/` gets. The
 * deployment gets the other branch — its filesystem is read-only, so the recap
 * has nowhere to go but `draft_recap` — and that branch is therefore the one
 * that has never been exercised by anything. A recap that saves fine on the
 * commissioner's laptop and throws on Vercel is a failure this repo has already
 * had once with the draft board itself (see `@/lib/draft-store`), and the cost
 * of finding out is a room of ten people watching a button do nothing.
 *
 * So this forces `RECAP_STORE=database` and drives the real store: write, read
 * back, confirm the document survived the jsonb round trip byte-for-byte in the
 * fields the page indexes by, and confirm a second write replaces the row
 * rather than colliding on the primary key — last-write-wins being the store's
 * stated contract.
 *
 * WRITES TO SEASON 1999, NOT 2026. The real season's row is the league's
 * record; a verification script has no business touching it. The scratch row is
 * deleted at the end, and the run reports whether the 2026 row exists so a
 * clobbered one would be visible rather than silent.
 *
 * Needs the Supabase service-role key, so it is run with `--env-file`.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { recapStore, recapLocation } from "@/lib/recap-store";
import {
  RECAP_VERSION,
  isRecapDocument,
  recapStaleness,
  type RecapDocument,
} from "@/lib/recap-types";
import { createServiceClient } from "@/lib/supabase/server";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    failures++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function section(title: string) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

/** A season this league will never play, so the 2026 row is never at risk. */
const SEASON = 1999;

/**
 * The fingerprint is a plain string to both stores, so the fixture only has to
 * be two distinguishable ones. Shaped like the real thing — `boardFingerprint`
 * returns `<slots>-<base36>` — so a store that tried to parse it would fail here
 * rather than in the room.
 */
const WRITTEN_AGAINST = "160-17uvmpv";
const SOME_OTHER_BOARD = "160-9zzqk1x";

function fixture(overrides: Partial<RecapDocument> = {}): RecapDocument {
  /*
   * Ten blurbs with sources, which is the shape and roughly the order of size a
   * real generation produces. Built here rather than imported from the recap
   * fixture so this check does not need a whole simulated draft to run.
   */
  const blurbs = Array.from({ length: 10 }, (_, i) => ({
    teamId: `verification-${i}`,
    verdict: `verdict ${i}`,
    blurb:
      `Blurb ${i}. A paragraph of roughly the length the model writes, repeated ` +
      "enough that the stored jsonb is a realistic size rather than a token. ".repeat(6),
    sources: [{ title: "the board", url: "https://example.invalid/board" }],
  }));
  return {
    version: RECAP_VERSION,
    season: SEASON,
    generatedAt: new Date().toISOString(),
    provider: "verification",
    model: "verification",
    keepersOutOfPool: 19,
    picksEntered: 141,
    boardFingerprint: WRITTEN_AGAINST,
    blurbs,
    citations: [{ title: "the board", url: "https://example.invalid/board" }],
    usage: { inputTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0 },
    ...overrides,
  };
}

/**
 * THE FILE BRANCH, RUN IN A CHILD RATHER THAN HERE.
 *
 * `@/lib/recap-store` resolves its backend once per process and memoises it, so
 * a single run cannot drive both stores — and it must not be made to, because
 * that memo is the behaviour the deployment depends on. So the file half runs as
 * this same script re-invoked with `RECAP_STORE=file`, in a temp directory
 * OUTSIDE the repo: the file store writes to `<cwd>/data`, and a verification
 * that dirtied the real `data/` hours before a draft would be its own incident.
 *
 * Both halves assert the same things about the same document, which is the whole
 * point — the field has to survive jsonb and `JSON.stringify` alike, and an old
 * row without it has to read back on both.
 */
if (process.env.__UKL_RECAP_FILE_BACKEND === "1") {
  section("The FILE backend, in a scratch directory outside the repo");
  console.log(`  store reports: ${recapLocation(SEASON)}`);
  check(
    "RECAP_STORE=file selected the JSON file store",
    recapLocation(SEASON) !== "the league database",
    "the database store was selected, so the file branch is untested",
  );

  const doc = fixture();
  await recapStore.write(doc);
  const back = await recapStore.read(SEASON);
  check("the document reads back", back !== null && isRecapDocument(back));
  check(
    "the fingerprint survived the file round trip",
    back?.boardFingerprint === WRITTEN_AGAINST,
    String(back?.boardFingerprint),
  );
  check("picksEntered survived with it", back?.picksEntered === 141);

  // The pre-existing recap: written by code that had never heard of the field.
  const { boardFingerprint: _dropped, ...old } = fixture();
  await recapStore.write(old as RecapDocument);
  const oldBack = await recapStore.read(SEASON);
  check(
    "a document written before the field existed still reads back",
    oldBack !== null && isRecapDocument(oldBack),
  );
  check(
    "and it reads back with no fingerprint rather than an invented one",
    oldBack?.boardFingerprint === undefined,
    String(oldBack?.boardFingerprint),
  );
  check(
    "so the page calls it unknown, not stale and not fresh",
    recapStaleness(oldBack, { picksEntered: 141, boardFingerprint: WRITTEN_AGAINST })
      ?.kind === "unknown",
  );

  console.log(failures === 0 ? "\nFile backend OK." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

section("1. The database branch is the one under test");
console.log(`  store reports: ${recapLocation(SEASON)}`);
check(
  "RECAP_STORE=database selected the Postgres store",
  recapLocation(SEASON) === "the league database",
  "run this with RECAP_STORE=database, or the file store is being tested twice",
);

section("2. A season with no recap is a normal state");
const before = await recapStore.read(SEASON);
check("it reads as null rather than raising", before === null, JSON.stringify(before));

const doc = fixture();
const blurbs = doc.blurbs;

section("3. The round trip");
check("the document is valid before it is stored", isRecapDocument(doc));
console.log(`  ${blurbs.length} blurbs, ${(JSON.stringify(doc).length / 1024).toFixed(1)} KB of JSON`);

let raised: unknown = null;
await recapStore.write(doc).catch((e: unknown) => {
  raised = e;
});
check("writing it to Postgres succeeds", raised === null, String(raised));

const readBack = await recapStore.read(SEASON);
check("it reads back at all", readBack !== null);
check("it reads back as a document this build will render", isRecapDocument(readBack));
/*
 * Asserted on the fields the page actually indexes by. `verdict` and `blurb`
 * are the two strings printed on a card, so comparing them is what proves the
 * text survived jsonb rather than merely that a row came back.
 */
check(
  "every blurb's text survived the jsonb round trip",
  readBack?.blurbs.length === blurbs.length &&
    readBack.blurbs.every(
      (b, i) => b.blurb === blurbs[i].blurb && b.verdict === blurbs[i].verdict,
    ),
  `${readBack?.blurbs.length ?? 0} blurbs back`,
);
check(
  "the sources survived with it",
  readBack?.blurbs[0]?.sources[0]?.url === blurbs[0].sources[0].url,
  JSON.stringify(readBack?.blurbs[0]?.sources),
);
check("generatedAt survived", readBack?.generatedAt === doc.generatedAt);
check(
  "the derived counts survived, so a stale recap can still say what it was written from",
  readBack?.keepersOutOfPool === 19 && readBack?.picksEntered === 141,
);
check(
  "the board fingerprint survived the jsonb round trip",
  readBack?.boardFingerprint === WRITTEN_AGAINST,
  String(readBack?.boardFingerprint),
);

/*
 * THE SIGNAL ITSELF, on the document that just came out of Postgres rather than
 * on one built in memory. What the tab prints is decided by `recapStaleness`
 * reading a stored recap, so this is the assertion that the field is worth
 * storing at all.
 */
section("4. What the tab concludes from the row it read back");
check(
  "same board, same pick count — no banner",
  recapStaleness(readBack, {
    picksEntered: 141,
    boardFingerprint: WRITTEN_AGAINST,
  })?.kind === "fresh",
);
const drafted = recapStaleness(readBack, {
  picksEntered: 160,
  boardFingerprint: WRITTEN_AGAINST,
});
check(
  "the draft moved on — stale, which is the case this whole field exists for",
  drafted?.kind === "stale",
);
check(
  "and it can say 141 then against 160 now",
  drafted?.picksThen === 141 && drafted?.picksNow === 160,
  JSON.stringify(drafted),
);
check(
  "a pick count that did not move is not reported as a trade",
  drafted?.kind === "stale" && drafted.boardMoved === false,
);
const traded = recapStaleness(readBack, {
  picksEntered: 141,
  boardFingerprint: SOME_OTHER_BOARD,
});
check(
  "ownership moved under an unchanged pick count — stale, and named as a trade",
  traded?.kind === "stale" && traded.boardMoved === true,
  JSON.stringify(traded),
);

section("5. A row written before the field existed");
/*
 * The row the deployment may genuinely be holding right now. It must read back,
 * render, and be described as unknown — never quietly treated as current, and
 * never accused of being stale when nothing is known either way.
 */
const { boardFingerprint: _dropped, ...legacy } = fixture();
await recapStore.write(legacy as RecapDocument);
const legacyBack = await recapStore.read(SEASON);
check("it reads back rather than throwing", legacyBack !== null);
check("it is still a document this build will render", isRecapDocument(legacyBack));
check(
  "it has no fingerprint rather than an invented one",
  legacyBack?.boardFingerprint === undefined,
  String(legacyBack?.boardFingerprint),
);
check(
  "the page calls it unknown — not stale, not fresh",
  recapStaleness(legacyBack, {
    picksEntered: 141,
    boardFingerprint: WRITTEN_AGAINST,
  })?.kind === "unknown",
);
check(
  "but a moved pick count still convicts it without a fingerprint",
  recapStaleness(legacyBack, {
    picksEntered: 160,
    boardFingerprint: WRITTEN_AGAINST,
  })?.kind === "stale",
);

section("6. Re-generating replaces the row rather than colliding");
const second: RecapDocument = { ...doc, generatedAt: new Date(Date.now() + 1000).toISOString() };
await recapStore.write(second);
const after = await recapStore.read(SEASON);
check("the second write won", after?.generatedAt === second.generatedAt);
/*
 * Counting is the whole point of the section: a second write that appended
 * instead of replacing would still satisfy the check above, because `read`
 * returns the newest row either way. This is the only thing here that can tell
 * a real upsert from a duplicate the reader happens to be sorting past.
 */
const { count: seasonRows } = await createServiceClient()
  .from("draft_recap")
  .select("season", { count: "exact", head: true })
  .eq("season", SEASON);
check(
  "and there is still exactly one row for the season",
  seasonRows === 1,
  `${seasonRows ?? "unknown"} row(s)`,
);

section("7. Cleanup");
const { error } = await createServiceClient().from("draft_recap").delete().eq("season", SEASON);
check("the scratch row was removed", !error, error?.message ?? "");
check("and the season reads as empty again", (await recapStore.read(SEASON)) === null);

const real = await recapStore.read(2026);
console.log(
  `  the 2026 recap row is ${real ? `present (generated ${real.generatedAt})` : "absent — not generated yet"}`,
);

section("8. The same document through the FILE backend");
// See the note on `__UKL_RECAP_FILE_BACKEND` above for why this is a child.
const here = path.dirname(fileURLToPath(import.meta.url));
const scratch = mkdtempSync(path.join(tmpdir(), "ukl-recap-file-"));
try {
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      path.join(here, "draft-loader.mjs"),
      path.join(here, "verify-recap-db.mts"),
    ],
    {
      cwd: scratch,
      encoding: "utf8",
      env: {
        ...process.env,
        RECAP_STORE: "file",
        __UKL_RECAP_FILE_BACKEND: "1",
        // The loader's re-entry guard is an env var and would be inherited,
        // leaving the child with no `@/*` resolution at all.
        __UKL_DRAFT_LOADER: undefined,
      },
    },
  );
  for (const line of (child.stdout ?? "").trimEnd().split("\n")) console.log(`  ${line}`);
  check("every file-backend check passed", child.status === 0, (child.stderr ?? "").trim());
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

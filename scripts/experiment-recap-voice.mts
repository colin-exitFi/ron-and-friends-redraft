/**
 * The bench the recap's voice was chosen on.
 *
 *   npm run experiment:recap -- --replay --variants=shipped,beat,plain
 *
 * The recap has one acceptance criterion — the room laughs — and that is not a
 * thing you can assert in a test. So this does the only useful mechanical part:
 * it builds ONE complete board with the mock draft, runs it through several
 * candidate system prompts against the live API, and prints every blurb side by
 * side so a human can read them and pick. Same board every time, seeded, so the
 * only variable is the prompt.
 *
 * Kept in the repo rather than thrown away because "why is the prompt shaped
 * like this" is a question somebody will ask, and the honest answer is "these
 * three were tried on this board and one of them was funnier".
 *
 * COSTS REAL MONEY, AND MORE THAN YOU THINK — WITHOUT `--replay`. A live variant
 * is a full ten-team Opus generation with web search in the loop, and the loop
 * is what costs: each search result re-bills the whole prefix on the next turn,
 * so a ~24k-token prompt lands as 305,000–427,000 billed input tokens. Measured
 * runs came in at $0.89, $1.07, $1.24 and — before prompt caching was added —
 * $2.20. So a three-variant live invocation is three to six dollars, not the
 * thirty cents an earlier version of this comment claimed.
 *
 * That understatement is the whole reason this warning is now this long. Thirteen
 * live generations were run against this script in one evening on the strength of
 * it, which is where a twenty-dollar balance went — and all thirteen ran the SAME
 * searches, because what was being tuned was the writing. Hence:
 *
 *   --replay             write from the newest recording in data/recap-recordings/
 *   --replay=<path>      …or from a named one   (--fixture=<path> also works)
 *   --pages=<n>          cap pages per recorded search; cheaper, less faithful
 *   --cache              leave a prompt cache for the next replay. Only worth it
 *                        if the prompt is being held still — a temperature sweep
 *                        — because a cache write costs 1.25× and voice tuning
 *                        changes the system prompt, which is first in the prefix
 *                        and so invalidates everything behind it.
 *   --read               print a recording's blurbs and stop. No API call at all.
 *   --variants=a,b,c     which system prompts to try
 *   --temp=1             sampling temperature
 *   --team=<name>        one franchise only, which is most of the output cost
 *   --live               write about THE ACTUAL BOARD instead of the mock. The
 *                        real board is what the room is reading right now, and
 *                        before draft night it has zero picks on it — which is
 *                        a different prompt (`recapStage`, Part 0), so it is
 *                        the only way to hear the pre-draft branch. Every other
 *                        mode here exercises the post-draft one.
 *
 *                        WHICH board depends on `DRAFT_STORE`, exactly as it
 *                        does for the app: unset reads `data/draft-state-*.json`
 *                        on a writable checkout, and `DRAFT_STORE=database`
 *                        reads the one production is serving. That distinction
 *                        is not academic — a local file gets fixtures written
 *                        into it by other tooling, and a run that silently
 *                        picked one up reported POSTDRAFT while the deployed tab
 *                        was still pre-draft. The stage is printed on every run
 *                        for exactly this reason; read it before trusting the
 *                        blurbs underneath it.
 *   --shape=<key>        redeal the board into tiers before writing, so the
 *                        prose can be read on a field that actually separated.
 *                        Keys are in `./recap-board-shapes.mts`. The mock alone
 *                        is always a pack, so without this there is no way to
 *                        see whether the model swings when it is allowed to.
 *
 * A replay is a REAL generation on the REAL model — same prompt, same Opus,
 * same schema — with the search tool absent and the recorded searches replayed
 * into the conversation. One un-amplified turn instead of eight, so the research
 * is billed once ever instead of once per turn per iteration. Every live run
 * writes its recording automatically, so nobody has to remember to.
 *
 * MEASURED, ON THE SAME BOARD, TEN BLURBS EACH:
 *
 *   live     196,280 in / 11,329 out · 4 searches, 35 pages · $0.894 · 164s
 *   replay    79,727 in /  3,952 out · 0 searches            · $0.497 ·  68s
 *
 * Two thirds off the billed input and a good half off the latency, and the
 * output halves too — a live run spends thinking tokens deciding what to search
 * for, and a replay has nothing to decide.
 *
 * WHERE THE REMAINING FIFTY CENTS GOES, because it is worth knowing that this
 * is now most of the bill and that replaying is not what causes it: the prompt
 * itself is 46,100 tokens before any research at all — 14,300 of system prompt
 * and 31,800 of dossier — and ten blurbs are about 4,000 tokens out. That is a
 * $0.33 floor under any full-league generation on Opus, replay or not. The 35
 * recorded pages are the other 33,600 input tokens; `--pages=3` takes them to
 * 12,500 and the run to about $0.36. Cheaper is available by writing for one
 * franchise (`--team`) rather than by economising on the research.
 *
 * Every run prints its own measured cost, and a replay also prints what the
 * recording's live run cost, so the saving on screen is two real numbers rather
 * than a claim. It is not part of any verify run and nothing calls it
 * automatically.
 */

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import { defaultAssignment, runWholeMock, toMockPool } from "@/lib/mock-draft-run";
import { getBoard, getPlayerPool } from "@/lib/smartdraft";
import { readRoom } from "@/lib/draft-service";
import {
  readClosedKeeperLists,
  readKeeperOptions,
  readProjectedStandings,
} from "@/lib/recap-source";
import { recapModel, researchFromError } from "@/lib/recap-llm";
import {
  RANGE_MARKER,
  recapStage,
  recapSystemPrompt,
  recapUserMessage,
  type RecapStage,
} from "@/lib/recap-prompt";
import { readProjectionIndex } from "@/lib/projections-store";
import { positionalNorms } from "@/lib/positional-norms";
import { buildGradeInput, validateGrades } from "@/lib/recap-grade";
import { readGradeHistory } from "@/lib/recap-grade-source";
import { BOARD_SHAPES, reshape } from "./recap-board-shapes.mts";
import { digest, RECORDING_VERSION, type RecapRecording } from "@/lib/recap-recording";
import {
  latestRecording,
  readRecording,
  recordingsDir,
  writeRecording,
} from "@/lib/recap-recording-store";

const args = new Map(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith("--"))
    .map((a) => {
      const [k, v = "true"] = a.slice(2).split("=");
      return [k, v];
    }),
);

const wanted = (args.get("variants") ?? "shipped").split(",");
const temperature = args.has("temp") ? Number(args.get("temp")) : undefined;
const only = args.get("team");
const researchPages = args.has("pages") ? Number(args.get("pages")) : undefined;

/**
 * `--grade` asks for the letters as well as the prose, and runs them back
 * through `validateGrades` exactly as the route does.
 *
 * OPT-IN, because the two jobs this script does are different. Voice tuning
 * wants the cheapest possible turn and has no use for a rubric or a 50 KB
 * evidence payload; proving that the grading path actually comes back with
 * findable figures wants both. Same model, same schema and the same validator
 * the route saves through, so a pass here means a pass there.
 */
const grading = args.has("grade");

/**
 * `--replay` alone means the newest recording; `--replay=<path>` or
 * `--fixture=<path>` names one. Both spellings because both are the obvious
 * guess and neither is worth a failed run to look up.
 */
const replayArg = args.get("fixture") ?? args.get("replay");
const replayPath =
  replayArg === undefined ? null : replayArg === "true" ? latestRecording() : replayArg;

if (replayArg !== undefined && !replayPath) {
  console.error(
    `No recording to replay — ${recordingsDir()}/ is empty.\n` +
      `Run once without --replay to make one (that run pays for the research; ` +
      `every run after it does not).`,
  );
  process.exit(1);
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/*
 * The candidates.
 *
 * `shipped` is whatever `@/lib/recap-prompt` currently says. The others are
 * MATERIALLY different bets rather than nudges — a different persona, the
 * shipped prompt with its worked examples cut out, and the voice as it stood
 * before the range/praise/profanity pass — because the useful question is which
 * approach wins, not which adjective.
 *
 * Each takes the stage, because the prompt is a different document before the
 * draft and after it, and a variant that hardcoded one of them would be
 * measuring the wrong prompt on half the boards this script can build.
 */
const VARIANTS: Record<string, (stage: RecapStage) => string> = {
  shipped: (stage) => recapSystemPrompt(stage),

  /** A columnist with a grudge. Distant, written rather than spoken. */
  beat: (stage) =>
    recapSystemPrompt(stage)
      .replace(
        "You are not a broadcaster, an analyst, or a content creator. You are the guy at the table who has known all ten of these people for ten years, has watched them draft badly for most of them, and is not being paid to be nice about it.",
        "You are a beat writer who has covered this league for a decade and has run out of patience with every single one of them. You write a column after every draft. It is the only thing anybody reads and it is read out loud because it is cruel.",
      )
      .replace(/# Part 8: how a blurb ends[\s\S]*?(?=# Part 9: output)/, ""),

  /** The shipped prompt with the closing-line demonstrations removed. */
  plain: (stage) =>
    recapSystemPrompt(stage).replace(
      /# Part 8: how a blurb ends[\s\S]*?(?=# Part 9: output)/,
      "",
    ),

  /**
   * The voice as it shipped before the range/praise/profanity pass, so a
   * before-and-after can be read off one board instead of remembered.
   *
   * It cuts the three sections that pass added — the assigned range, the
   * praise rule, the profanity licence — and restores the two one-line
   * versions they replaced, which is exactly what the model was working from
   * when it produced ten blurbs at one temperature and no swearing. Kept in
   * the repo because "was it actually the prompt" is a fair question and this
   * is the only honest way to answer it.
   */
  "pre-range": (stage) =>
    recapSystemPrompt(stage)
      .replace(new RegExp(`## ${RANGE_MARKER}[\\s\\S]*?(?=\\*\\*Specificity is the engine)`), "")
      .replace(/## An observation is not a joke[\s\S]*?(?=\*\*Land the plane)/, "")
      .replace(
        /## Praise, and the compliment you are not allowed to take back[\s\S]*?(?=## Swear, properly)/,
        "**Praise has to be funny too.** Whoever drafted well gets real credit, delivered so it stings the other nine. No compliment sandwiches, no participation trophies.\n\n",
      )
      .replace(
        /## Swear, properly[\s\S]*?(?=## Everything else)/,
        "**Swear when it lands.** Profanity is fine and often the right word. Do not force it into every blurb, do not censor it, do not asterisk it.\n\n",
      )
      .replace(/# Part 8: how a blurb ends[\s\S]*?(?=# Part 9: output)/, ""),
};

const board = getBoard();
const pool = getPlayerPool();

/*
 * `--live` READS THE ACTUAL BOARD instead of running the mock, and it is the
 * only way to see what the room is currently looking at.
 *
 * The mock exists because the real board is empty until draft night and ten
 * franchises of keepers gave the writing nothing to chew on. But "empty until
 * draft night" IS a state this page ships in — the tab is open now, with zero
 * picks and nineteen keepers, and the prompt takes a different shape on it
 * (`recapStage`, and Part 0 in `@/lib/recap-prompt`). Every mock-based run in
 * this script exercises the post-draft branch, so without this flag the
 * pre-draft branch could only ever be read, never heard.
 *
 * Not compatible with `--shape`, which redeals a finished draft into tiers and
 * has nothing to redeal on a board with no picks on it.
 */
const live = args.has("live");
const { view: mockView } = live
  ? { view: await readRoom() }
  : runWholeMock({
      board,
      pool: toMockPool(pool),
      archetypes: defaultAssignment(board),
      rng: mulberry32(20260829),
    });

/*
 * `--shape=<key>` redeals the finished mock into tiers before the dossier is
 * built. The mock comes out bunched — ten reasonable archetypes drafting off
 * one ranked pool build ten reasonable rosters — so it can only ever show what
 * the prose does with a `pack`. The night this runs for real, the board may not
 * be a pack, and the question that cannot be answered by reading the prompt is
 * whether the model actually swings when it is told it may. `verify:recap:spread`
 * asserts what SHAPE each of these boards produces; this is how somebody reads
 * what the WRITING does with one.
 */
const shapeKey = args.get("shape");
if (shapeKey && live) {
  console.error("--shape redeals a finished draft into tiers. --live has no picks to redeal.");
  process.exit(1);
}
if (shapeKey && !BOARD_SHAPES[shapeKey]) {
  console.error(
    `Unknown --shape=${shapeKey}. Available: ${Object.keys(BOARD_SHAPES).join(", ")}`,
  );
  process.exit(1);
}
const projections = shapeKey ? readProjectionIndex() : null;
if (shapeKey && !projections) {
  console.error("--shape needs a projections snapshot to deal on. Run `npm run pull:projections`.");
  process.exit(1);
}
const view = shapeKey
  ? reshape(
      mockView,
      BOARD_SHAPES[shapeKey].tiers(
        [...mockView.teams].sort((a, b) => a.slot - b.slot).map((t) => t.id),
      ),
      (id) => projections!.byPlayerId.get(id)?.points ?? 0,
    )
  : mockView;

const dossier = buildRecapDossier({
  view,
  expectedPick: buildExpectedPicks(pool, view.slots),
  pool,
  keeperOptions: readKeeperOptions(),
  closedKeeperLists: readClosedKeeperLists(),
  projectedStandings: readProjectedStandings(view),
});

const teamIds = only
  ? dossier.franchises.filter((f) => f.teamName === only).map((f) => f.teamId)
  : dossier.franchises.map((f) => f.teamId);

/*
 * The evidence, built once. Off unless `--grade`, and refused outright on a
 * board the coverage block says cannot support a letter — there is no point
 * buying ten grades that `validateGrades` is certain to drop, and the route
 * makes the same call for the same reason.
 */
const gradeInput = grading
  ? buildGradeInput({
      dossier,
      history: readGradeHistory(),
      positionalNorms: positionalNorms(),
    })
  : null;
if (gradeInput && !gradeInput.coverage.sufficientToGrade) {
  console.error(
    `This board cannot support a grade, so --grade would buy ten letters the\n` +
      `validator is certain to drop. Missing: ${gradeInput.coverage.missing.join("; ")}\n`,
  );
  process.exit(1);
}

/** How a blurb is put on screen, shared by a fresh run and a re-read one. */
function show(blurb: { teamId: string; verdict: string; blurb: string; sources: { url: string }[] }) {
  const team = dossier.franchises.find((f) => f.teamId === blurb.teamId);
  const rank = dossier.valueLeaderboard.find((r) => r.teamId === blurb.teamId);
  console.log(
    `── ${team?.teamName ?? blurb.teamId} (${team?.manager ?? "?"}) · ` +
      `#${rank?.rank} on value, ${(rank?.valueGained ?? 0) > 0 ? "+" : ""}${rank?.valueGained}`,
  );
  console.log(`   [${blurb.verdict}]`);
  console.log(`   ${blurb.blurb}`);
  if (blurb.sources.length) {
    console.log(`   sources: ${blurb.sources.map((s) => s.url).join(" , ")}`);
  }
  console.log();
}

const recording = replayPath ? readRecording(replayPath) : null;

/*
 * A RECORDING IS ABOUT ONE BOARD. The mock is seeded so it does not move, but
 * the pool underneath it does — re-pulling ADP shifts every expectation — and
 * replaying research about a board that no longer exists would produce blurbs
 * quoting numbers the cards do not print. Said out loud rather than enforced:
 * the research is pages about football players, most of it survives a shifted
 * board, and refusing to run is worse than saying so.
 */
if (recording && recording.board.userMessageDigest !== digest(recapUserMessage(dossier, teamIds))) {
  console.log(
    `! ${replayPath} was recorded against a different board or team list ` +
      `(recorded: ${recording.board.picksEntered} picks, ${recording.board.teamIds.length} ` +
      `franchises; now: ${dossier.picksEntered} picks, ${teamIds.length}). The research is ` +
      `replayed anyway — pages about players age better than a dossier does — but the blurbs ` +
      `are being written from research gathered for something slightly else.\n`,
  );
}

/*
 * `--read` is the answer to "what did that dollar buy again". Every live run's
 * output is on disk, and re-reading it should not involve the API at all — the
 * whole reason this feature exists is that regenerating used to be the only way
 * to see a generation twice.
 */
if (args.has("read")) {
  if (!recording) {
    console.error("--read needs a recording: --read --replay, or --read --fixture=<path>.");
    process.exit(1);
  }
  console.log(
    `${replayPath} · variant "${recording.variant}" · ${recording.model} · ` +
      `recorded ${recording.recordedAt}`,
  );
  console.log(
    `Paid for once: ${recording.usage.inputTokens} in / ${recording.usage.outputTokens} out · ` +
      `${recording.usage.webSearches} searches · $${recording.usage.costUsd.toFixed(3)}. ` +
      `This read cost nothing.\n`,
  );
  for (const blurb of recording.blurbs) show(blurb);
  console.log(
    `${recording.research.queries.length} recorded searches over ` +
      `${recording.research.pages.length} pages:\n` +
      recording.research.queries.map((q) => `   · ${q}`).join("\n"),
  );
  process.exit(0);
}

const model = recapModel();
if (!model) {
  console.error("No ANTHROPIC_API_KEY. Run with: node --env-file=.env.local …");
  process.exit(1);
}

/*
 * The stage decides which prompt the model is handed, so it is printed rather
 * than inferred from the pick count by whoever is reading the output. A run
 * that says PREDRAFT is exercising Part 0; a run that says POSTDRAFT is not.
 */
const stage = recapStage(dossier);

console.log(
  `Board: ${live ? "THE LIVE BOARD" : "seeded mock"} — ${dossier.picksEntered} picks, ` +
    `${dossier.keepersOutOfPool} keepers out of the pool. Prompt stage: ${stage.toUpperCase()}.`,
);
if (dossier.projectedStandings) {
  const s = dossier.projectedStandings.spread;
  console.log(
    `Shape: ${s.shape.toUpperCase()}${shapeKey ? ` (dealt "${shapeKey}" — ${BOARD_SHAPES[shapeKey].label})` : ""} · ` +
      `${s.pointsFirstToLast} points and ${s.winsFirstToLast ?? "—"} wins first to last · ` +
      `biggest gap ${s.largestAdjacentPointsGap} at ranks ${s.largestGapBetweenRanks?.join("–") ?? "—"}` +
      `${s.dominantCliff ? " (a real cliff)" : " (ordinary spacing)"}`,
  );
}
console.log(
  `Model: ${model.model}${temperature === undefined ? "" : ` at temperature ${temperature}`}`,
);
if (recording) {
  console.log(
    `Replaying ${replayPath}: ${recording.research.queries.length} recorded searches, ` +
      `${recording.research.pages.length} pages` +
      `${researchPages === undefined ? "" : `, capped at ${researchPages} per search`}. ` +
      `No search tool is offered.`,
  );
} else {
  console.log(
    `LIVE — web search in the loop, and the loop is what costs. Recordings land in ` +
      `${recordingsDir()}/ so the next iteration can be a --replay.`,
  );
}
console.log();

/**
 * What this invocation has spent so far, printed after every variant.
 *
 * A per-run figure is easy to read past when three of them scroll by; the total
 * is the number that decides whether to run it a fourth time.
 */
let spentUsd = 0;
let billedRuns = 0;

/**
 * Puts a live run's research on disk, whether or not anybody asked for it.
 *
 * The money is spent by the time this is reached and the only alternative is
 * spending it again, so there is no flag to forget. Named by timestamp and
 * variant, so `--replay` with no path picks up the newest and two variants in
 * one invocation cannot overwrite each other.
 *
 * `usage` is what the run cost, kept so a later replay can print the saving as
 * two measured numbers rather than as a claim. Zeroes mean the run failed after
 * searching and the usage block never came back — the research is still worth
 * keeping, and a zero is a more honest placeholder than a guess.
 */
function keep(
  variant: string,
  research: RecapRecording["research"],
  blurbs: RecapRecording["blurbs"],
  citations: RecapRecording["citations"],
  usage: RecapRecording["usage"],
): void {
  if (!research.blocks.length) {
    console.log("   nothing recorded: this run never searched, so there is no research to keep");
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = writeRecording(
    {
      version: RECORDING_VERSION,
      recordedAt: new Date().toISOString(),
      provider: "anthropic",
      model: model!.model,
      variant,
      board: {
        picksEntered: dossier.picksEntered,
        keepersOutOfPool: dossier.keepersOutOfPool,
        teamIds,
        userMessageDigest: digest(recapUserMessage(dossier, teamIds)),
      },
      research,
      blurbs,
      citations,
      usage,
    },
    `${stamp}-${variant}`,
  );
  console.log(
    `   recorded to ${file} (${research.queries.length} searches, ${research.pages.length} pages) — ` +
      `re-run with --replay and the research is free from here on`,
  );
}

for (const name of wanted) {
  const build = VARIANTS[name];
  if (!build) {
    console.log(`(no variant called "${name}" — skipped)`);
    continue;
  }

  const bar = `VARIANT: ${name}`;
  console.log(`\n${"█".repeat(78)}\n${bar}\n${"█".repeat(78)}\n`);

  const started = Date.now();
  try {
    const result = await model.generate({
      dossier,
      teamIds,
      temperature,
      system: build(stage),
      research: recording?.research,
      researchPages,
      cachePrefix: args.has("cache"),
      grades: gradeInput,
    });

    for (const blurb of result.blurbs) show(blurb);

    /*
     * THE LETTERS, AND THE CHECK, PRINTED SIDE BY SIDE. This is the only place
     * a person sees what came back before the route decides whether to save it,
     * so it prints the grades as assigned AND the verdict on them — including
     * the warnings, which do not block and which nobody would otherwise read.
     */
    if (gradeInput) {
      const verdict = validateGrades({
        dossier,
        input: gradeInput,
        grades: result.grades,
      });

      console.log(`${"─".repeat(78)}\n${gradeInput.subjectLabel.toUpperCase()}S\n`);
      for (const grade of result.grades) {
        const team = dossier.franchises.find((f) => f.teamId === grade.teamId);
        console.log(`   ${grade.letter.padEnd(3)} ${team?.teamName ?? grade.teamId}`);
        console.log(`       ${grade.reason}`);
        console.log(
          `       ${grade.citations.map((c) => `${c.label}: ${c.value}`).join(" · ")}`,
        );
      }

      console.log(
        `\n   spread ${verdict.spanSteps} steps · ` +
          `${verdict.distribution.map((d) => `${d.count}×${d.letter}`).join(", ")}`,
      );
      if (!verdict.flags.length) {
        console.log("   the validator found nothing to say.");
      }
      for (const flag of verdict.flags) {
        console.log(
          `   ${flag.severity === "blocking" ? "✗ BLOCKING" : "! warning "} ` +
            `${flag.code}: ${flag.message}`,
        );
      }
      console.log(
        verdict.blocking
          ? `\n   → the route would SAVE THE BLURBS AND DROP ALL ${result.grades.length} LETTERS, ` +
              `and print why in the footer.`
          : `\n   → the route would save ${verdict.accepted.length} letters.`,
      );
      console.log();
    }

    spentUsd += result.usage.costUsd;
    billedRuns++;
    console.log(
      `${recording ? "replayed" : `${result.usage.webSearches} web searches`} · ` +
        `${result.citations.length} pages read · ` +
        `${result.usage.inputTokens} in / ${result.usage.outputTokens} out · ` +
        `$${result.usage.costUsd.toFixed(3)} · ${((Date.now() - started) / 1000).toFixed(0)}s`,
    );

    if (recording) {
      /*
       * TWO MEASURED NUMBERS, NOT A CLAIM. Both sides of this comparison are
       * usage blocks the API sent back — the recording's from the run that paid
       * for the research, this run's from the one that did not. An earlier
       * version of this script printed a cost it had guessed at and was wrong by
       * a factor of three, so nothing here is allowed to be an estimate.
       */
      const saved = recording.usage.costUsd - result.usage.costUsd;
      console.log(
        `   versus the live run this was recorded from: ` +
          `${recording.usage.inputTokens} in / ${recording.usage.outputTokens} out · ` +
          `$${recording.usage.costUsd.toFixed(3)} — ` +
          `${saved >= 0 ? "saved" : "COST AN EXTRA"} $${Math.abs(saved).toFixed(3)}` +
          ` (${((Math.abs(saved) / recording.usage.costUsd) * 100).toFixed(0)}%)`,
      );
    } else {
      keep(name, result.research, result.blurbs, result.citations, result.usage);
    }
  } catch (err) {
    /*
     * A FAILED RUN WAS STILL BILLED. The throw comes from parsing or from a
     * blown output ceiling — both of which happen after Anthropic has generated
     * and charged for the tokens — so it must not read as free. The cost is not
     * knowable here, because the usage block never got back to us.
     */
    billedRuns++;
    console.log(`FAILED (but billed): ${err instanceof Error ? err.message : String(err)}`);

    /*
     * The research is knowable, though, and it is the expensive half. A failed
     * live run that threw away its searches would send the next attempt back to
     * buy the same fifty pages, which is the thing this feature exists to stop.
     * Kept with no blurbs on it: enough to replay from, honest about the fact
     * that the writing never landed.
     */
    const rescued = recording ? null : researchFromError(err);
    if (rescued) {
      console.log("   the searches survived it, though —");
      keep(name, rescued, [], rescued.pages, {
        inputTokens: 0,
        outputTokens: 0,
        webSearches: rescued.queries.length,
        costUsd: 0,
      });
    }
  }
}

if (wanted.length > 1 || billedRuns > 1) {
  console.log(
    `\n${"─".repeat(78)}\n${billedRuns} ${recording ? "replayed" : "live"} generation` +
      `${billedRuns === 1 ? "" : "s"} billed · about $${spentUsd.toFixed(2)} this invocation` +
      `\n${"─".repeat(78)}`,
  );
}

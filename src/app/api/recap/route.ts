import { NextResponse } from "next/server";

import { buildExpectedPicks } from "@/lib/expected-pick";
import { buildRecapDossier } from "@/lib/recap-dossier";
import {
  readClosedKeeperLists,
  readKeeperOptions,
  readProjectedStandings,
} from "@/lib/recap-source";
import { noModelReason, recapModel } from "@/lib/recap-llm";
import { recapStore } from "@/lib/recap-store";
import { positionalNorms } from "@/lib/positional-norms";
import {
  buildGradeInput,
  validateGrades,
  type AssignedGrade,
  type GradeInput,
} from "@/lib/recap-grade";
import { readGradeHistory } from "@/lib/recap-grade-source";
import { currentBoardFingerprint, readPool, readRoom } from "@/lib/draft-service";
import { CURRENT_SEASON } from "@/lib/league-config";
import type { RecapDossier } from "@/lib/recap-dossier";
import { RECAP_VERSION, type RecapDocument, type RecapGrades } from "@/lib/recap-types";

export const dynamic = "force-dynamic";

/**
 * Claude writes for as long as it wants to, and with web search in the loop the
 * first live run took two and a half minutes. The platform default would cut
 * that off partway through and bill for it, so the ceiling is raised to the
 * maximum a function gets.
 */
export const maxDuration = 300;

/**
 * Generating the recap, explicitly and on request.
 *
 * NOT ON RENDER, and that is the whole reason this route exists. A page that
 * called a model every time somebody opened it would cost a couple of dollars
 * per refresh, take two minutes, and give a different answer each time — so the
 * recap is made once, saved, and read back. The page is a read of the store.
 *
 * `teamIds` narrows a generation to a single franchise, which is the re-roll
 * the room will actually use: one blurb lands flat, somebody presses the button
 * next to it, and the other nine are untouched. The model still SEES all ten
 * franchises so the new blurb can compare and cross-reference — see
 * `recapUserMessage`.
 *
 * There is no confirmation on any of this. Re-generating is itself the
 * recovery, which is the league's stated preference; putting a gate in front of
 * the thing that undoes a bad recap would be the wrong way round.
 */
export async function POST(request: Request) {
  const model = recapModel();
  if (!model) {
    return NextResponse.json({ ok: false, error: noModelReason() }, { status: 503 });
  }

  let teamIds: string[] | undefined;
  try {
    const body = (await request.json()) as { teamIds?: unknown };
    if (Array.isArray(body?.teamIds)) {
      teamIds = body.teamIds.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // No body is the ordinary "regenerate everything" case.
  }

  try {
    const view = await readRoom();
    const pool = readPool();
    const dossier = buildRecapDossier({
      view,
      /*
       * Keeper-adjusted, in board slots. The same call the final board makes,
       * so the reach and steal numbers a blurb quotes are the ones printed on
       * the board the room is looking at.
       */
      expectedPick: buildExpectedPicks(pool, view.slots),
      pool,
      keeperOptions: readKeeperOptions(),
      closedKeeperLists: readClosedKeeperLists(),
      projectedStandings: readProjectedStandings(view),
    });

    const all = dossier.franchises.map((f) => f.teamId);
    const wanted = teamIds?.length
      ? all.filter((id) => teamIds!.includes(id))
      : all;
    if (!wanted.length) {
      return NextResponse.json(
        { ok: false, error: "No franchise on this board matches that id." },
        { status: 400 },
      );
    }

    /*
     * GRADES ARE ASKED FOR ONLY ON A WHOLE-BOARD RUN, and that is not a saving.
     * The letters are relative to each other — `GradeValidation` says so at
     * length and enforces it, dropping the set when one is missing — so there is
     * no such thing as re-grading one franchise. A re-roll rewrites a blurb and
     * leaves the curve exactly where it was, which is also the honest answer:
     * the letter was about the man's draft, not about the sentence next to it.
     *
     * The evidence is built BEFORE the call so that a board which cannot
     * support a grade is discovered for free rather than for a dollar. See
     * `gradeCoverage`: no way to price a pick means no way to say one beat its
     * slot, and a letter assigned on what is left would be a roster ranking.
     */
    const full = wanted.length === all.length;
    const evidence = full
      ? buildGradeInput({
          dossier,
          history: readGradeHistory(),
          positionalNorms: positionalNorms(),
        })
      : null;
    const gradable = evidence?.coverage.sufficientToGrade === true;

    const generated = await model.generate({
      dossier,
      teamIds: wanted,
      grades: gradable ? evidence : null,
    });

    /*
     * A re-roll REPLACES one blurb and keeps the other nine, so the previous
     * recap is read back and merged rather than overwritten. Without this the
     * room would press the button next to one flat blurb and lose the other
     * nine, which is the opposite of the recovery it is meant to be.
     */
    const previous = full ? null : await recapStore.read(CURRENT_SEASON);
    const kept = (previous?.blurbs ?? []).filter((b) => !wanted.includes(b.teamId));

    const recap: RecapDocument = {
      version: RECAP_VERSION,
      season: dossier.season,
      generatedAt: new Date().toISOString(),
      provider: generated.provider,
      model: generated.model,
      keepersOutOfPool: dossier.keepersOutOfPool,
      picksEntered: dossier.picksEntered,
      /*
       * Stamped from the board this generation actually read, so the tab can
       * later tell the room the prose and the numbers under it describe
       * different boards. Written on a re-roll too: a re-roll replaces one
       * blurb against the CURRENT board, so the document as a whole is now as
       * fresh as its newest blurb and claiming otherwise would be the same lie
       * in the other direction.
       */
      boardFingerprint: currentBoardFingerprint(),
      blurbs: [...kept, ...generated.blurbs],
      grades: evidence
        ? settleGrades(dossier, evidence, gradable ? generated.grades : null)
        : previous?.grades,
      citations: mergeCitations(previous, generated.citations, wanted.length === all.length),
      usage: generated.usage,
    };

    await recapStore.write(recap);
    return NextResponse.json({ ok: true, recap });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/** The recap as stored, for anything that wants it without rendering the page. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    recap: await recapStore.read(CURRENT_SEASON),
    /** So a caller can tell "no key" from "not generated yet". */
    canGenerate: recapModel() !== null,
  });
}

/**
 * The letters, run back over the evidence they claim to rest on, and the
 * decision about what to save.
 *
 * TWO RULES, BOTH FROM `@/lib/recap-grade` AND NEITHER RE-DECIDED HERE. Nothing
 * rewrites a grade — the model was given the judgement, and a silent correction
 * would put a letter on a card that neither the model nor a person chose. And a
 * blocking flag drops ALL TEN rather than the offending one, because the
 * letters are a curve and nine of ten is not one; the blurbs, which cost most
 * of the bill and pass their own checks, are kept either way.
 *
 * THE REFUSAL IS RECORDED, WHICH IS THE PART THAT IS DECIDED HERE. Dropping the
 * set silently leaves a page indistinguishable from one nobody has graded, and
 * on draft night that is the difference between "it failed its own check" and
 * "the button was never pressed" — two facts the commissioner has to be able to
 * tell apart from the screen, with no log to open. So the flags travel with the
 * document and the footer prints them. `GradeFlag.message` is already written
 * to be read by a human without reformatting, which is why nothing is
 * rephrased on the way through.
 *
 * `assigned: null` is the board that was never asked: coverage said it could
 * not support a letter, so no money was spent finding out and the reason is the
 * coverage report itself.
 */
function settleGrades(
  dossier: RecapDossier,
  input: GradeInput,
  assigned: AssignedGrade[] | null,
): RecapGrades {
  if (assigned === null) {
    return {
      subjectLabel: input.subjectLabel,
      assigned: [],
      withheld: {
        returned: 0,
        reasons: [
          `This board cannot support a grade, so none was asked for. Missing: ` +
            `${input.coverage.missing.join("; ") || "unstated"}.`,
        ],
      },
    };
  }

  const verdict = validateGrades({ dossier, input, grades: assigned });
  if (!verdict.blocking) {
    return { subjectLabel: input.subjectLabel, assigned: verdict.accepted, withheld: null };
  }

  return {
    subjectLabel: input.subjectLabel,
    assigned: [],
    withheld: {
      returned: assigned.length,
      reasons: verdict.flags
        .filter((f) => f.severity === "blocking")
        .map((f) => f.message),
    },
  };
}

/**
 * On a full regeneration the citation list is replaced; on a re-roll it grows.
 * Deduplicated by URL either way, so pressing re-roll five times does not leave
 * the sources panel five times as long.
 */
function mergeCitations(
  previous: RecapDocument | null,
  fresh: { title: string; url: string }[],
  full: boolean,
): { title: string; url: string }[] {
  if (full || !previous) return fresh;
  const byUrl = new Map(previous.citations.map((c) => [c.url, c]));
  for (const c of fresh) if (!byUrl.has(c.url)) byUrl.set(c.url, c);
  return [...byUrl.values()];
}

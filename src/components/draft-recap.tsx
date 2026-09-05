"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { DataSourceNote } from "@/components/data-source-note";
import { PageBody, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { positionText } from "@/lib/positions";
import {
  blurbFor,
  gradeFor,
  recapStaleness,
  type RecapDocument,
  type RecapGrade,
  type RecapStaleness,
} from "@/lib/recap-types";
import { gradeBand, gradeIndex, isGradeLetter } from "@/lib/recap-grade";
import type {
  FranchiseDossier,
  PickCapital,
  RecapDossier,
} from "@/lib/recap-dossier";

/**
 * The recap, one card per franchise: what the model said, and directly beneath
 * it the figures it said it from.
 *
 * THE RECEIPTS ARE THE POINT. A blurb on its own is a machine being rude about
 * somebody's afternoon, and the first thing anybody will say is "that's not
 * true". So every card carries the three or four numbers the verdict rests on —
 * the best steal, the worst reach, the net value, the keeper surplus, the
 * lineup holes — in the same box, in the same glance. The joke and its evidence
 * arrive together or the joke does not survive the room.
 *
 * THE RE-ROLL IS PER TEAM. One flat blurb should cost one button press, not a
 * regeneration of the other nine good ones. The route merges the replacement
 * back into the stored recap, so the rest are untouched. There is no
 * confirmation on it, or on the full regenerate: re-rolling IS the recovery,
 * and gating the undo is the wrong way round.
 *
 * Type is set large deliberately. This gets read off a screen in a room, and a
 * 13px paragraph is the house body size for a laptop, not for six feet away.
 *
 * ============================================================================
 * THE PAGE HAS THREE SHAPES AND EVERY ONE OF THEM IS NORMAL
 * ============================================================================
 *
 * `Phase` below is the whole of it, and almost every layout decision on this
 * tab turns on it. It exists because the tab was written and shipped without
 * anybody looking at it against an EMPTY board, which is the state it sits in
 * for eleven months of the year — and in that state it read as broken. Ten
 * cards, each announcing in red that the franchise could not field a starting
 * lineup and had no quarterback, above a rank of "#1 of 10" that was really
 * just array order and a headline figure of "0".
 *
 * None of that was wrong. All of it was the default. The league's own rule
 * about the draft board applies here word for word: an alarm on a condition
 * that is simply where everyone starts is decoration, and it was most of the
 * colour on the screen.
 */
type Phase =
  /** Not a pick entered. Everything on the board is a keeper. */
  | "before"
  /** Picks are landing, owned slots are still empty. */
  | "during"
  /** Every owned slot is filled. The board this page was built for. */
  | "complete";

/**
 * A recap that reached the page without this tab asking for it.
 *
 * `dropped` is this tab's own run, finished after the socket did. `elsewhere` is
 * anything else — a reload that beat the generation to the punch, or a re-roll
 * somebody made on another laptop. Different sentences because they call for
 * different things from the reader: one means "do not press it again", the other
 * means "what you were reading has been replaced".
 */
type AdoptedRecap =
  | { kind: "dropped"; detail: string }
  | { kind: "elsewhere" };

/**
 * Whichever recap is newer, the server's or this session's.
 *
 * WHY THIS IS NOT `useState(recap)`. That reads the prop once, at mount, and
 * every later server render is ignored — so the page could sit on a document
 * older than the one in the store with no way for anybody to tell. The
 * receipts under each blurb come from `dossier`, which IS a prop and does
 * re-render, and the two drifting apart is exactly the bug the commissioner
 * hit: fresh numbers under stale prose.
 *
 * Compared on `generatedAt` rather than preferring one side, because both
 * directions are real. A generation that has just come back is newer than the
 * prop that rendered the page. A reload, or a re-roll made on somebody else's
 * laptop, is newer than whatever this tab last generated.
 */
function newerRecap(
  fromServer: RecapDocument | null,
  fromThisSession: RecapDocument | null,
): RecapDocument | null {
  if (!fromServer) return fromThisSession;
  if (!fromThisSession) return fromServer;
  return isNewerThan(fromThisSession, fromServer.generatedAt)
    ? fromThisSession
    : fromServer;
}

/** Whether a document was generated after the given stamp. Missing = newer. */
function isNewerThan(recap: RecapDocument, stamp: string | null): boolean {
  if (!stamp) return true;
  const then = Date.parse(stamp);
  const now = Date.parse(recap.generatedAt);
  if (Number.isNaN(then) || Number.isNaN(now)) return false;
  return now > then;
}

/**
 * The stored recap, read back without generating one.
 *
 * Only used to find out whether a generation landed after the browser stopped
 * listening, so a failure to read it is not worth surfacing — the caller is
 * already holding a real error to report.
 */
async function readStoredRecap(): Promise<RecapDocument | null> {
  try {
    const response = await fetch("/api/recap", { cache: "no-store" });
    const body = (await response.json()) as { ok?: boolean; recap?: RecapDocument };
    return body?.ok && body.recap ? body.recap : null;
  } catch {
    return null;
  }
}

export function DraftRecap({
  dossier,
  recap,
  canGenerate,
  noModelReason,
  modelName,
  savesTo,
  boardFingerprint,
}: {
  dossier: RecapDossier;
  recap: RecapDocument | null;
  canGenerate: boolean;
  noModelReason: string | null;
  modelName: string | null;
  savesTo: string;
  /** The board the dossier above was built from. See `recapStaleness`. */
  boardFingerprint: string;
}) {
  /*
   * What this session generated, which is NOT the same thing as what is on
   * screen. See `newerRecap`: the page shows whichever of the server's copy and
   * this one is newer, and it used to show `useState(recap)` — the server's copy
   * as it stood the first time this component mounted, forever.
   *
   * That is how the commissioner ended up reading last night's prose over
   * tonight's numbers. `dossier` is a prop and re-renders with the server;
   * `current` was state and did not, so "Projected finish" moved and the ten
   * verdicts above it did not.
   */
  const [generated, setGenerated] = useState<RecapDocument | null>(null);
  /** Team id being re-rolled, "all" for the whole board, or null when idle. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * A recap that arrived without this tab asking — either a run that finished
   * after the browser stopped listening, or one written somewhere else. Not an
   * error, and not silent: see `adoptStoredIfNewer`.
   */
  const [adopted, setAdopted] = useState<AdoptedRecap | null>(null);

  const current = newerRecap(recap, generated);

  /*
   * What is on screen right now, and whether a run is in flight — readable from
   * an event listener without making the listener a dependency. Re-subscribing
   * on every render would be pointless churn, and capturing the values in the
   * closure would freeze them at subscribe time, which is the whole bug this
   * component is being fixed for, one level down.
   */
  const latest = useRef<{ showing: string | null; running: boolean }>({
    showing: null,
    running: false,
  });
  useEffect(() => {
    latest.current = {
      showing: current?.generatedAt ?? null,
      running: busy !== null,
    };
  });

  /** Reads the store; adopts what it finds if it is newer than the screen. */
  const adoptStoredIfNewer = useCallback(async (): Promise<boolean> => {
    const stored = await readStoredRecap();
    if (!stored || !isNewerThan(stored, latest.current.showing)) return false;
    setGenerated(stored);
    return true;
  }, []);

  /*
   * NOTICING A RECAP THIS TAB DID NOT ASK FOR.
   *
   * The dropped-connection recovery in `generate` only helps a tab that still
   * has the request in hand. The commissioner's actual sequence had no request
   * left: a whole-board run takes two and a half minutes, he reloaded partway
   * through, and the generation landed afterwards — so the page he was reading
   * had been rendered BEFORE the new recap existed and had no reason to ask
   * again. Fresh numbers, previous night's prose, nothing on screen to say so.
   *
   * Checked on focus and on the tab becoming visible rather than on a timer.
   * The story is always somebody coming back to the screen — from the room, from
   * another tab, from his phone — and a poll would spend a request every few
   * seconds all year to catch a document that changes twice a season. It also
   * covers a re-roll made on somebody else's laptop, which nothing did before.
   */
  useEffect(() => {
    function check() {
      if (document.visibilityState !== "visible") return;
      // A run in flight reports its own result; racing it would only confuse.
      if (latest.current.running) return;
      void adoptStoredIfNewer().then((found) => {
        if (found) setAdopted({ kind: "elsewhere" });
      });
    }
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [adoptStoredIfNewer]);

  async function generate(teamIds?: string[]) {
    setBusy(teamIds?.length === 1 ? teamIds[0] : "all");
    setError(null);
    setAdopted(null);
    try {
      const response = await fetch("/api/recap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(teamIds?.length ? { teamIds } : {}),
      });
      const body = (await response.json()) as {
        ok: boolean;
        recap?: RecapDocument;
        error?: string;
      };
      if (!body.ok || !body.recap) throw new Error(body.error ?? "Unknown error");
      setGenerated(body.recap);
    } catch (err) {
      /*
       * THE REQUEST FAILING DOES NOT MEAN THE RECAP FAILED, and this page used
       * to assert that it did — "The recap was not written." over prose that had
       * just been replaced.
       *
       * A whole-board generation runs for two and a half minutes with web search
       * in the loop, and the function keeps going after the browser gives up on
       * it. So a dropped connection, a backgrounded tab or a proxy timeout all
       * end here with the work DONE and paid for — the run that prompted this
       * change cost $1.46 and saved ten new blurbs the room never saw. Losing
       * sight of it is the expensive failure, not the socket.
       *
       * So: ask the store what it has. If something newer than the screen is
       * sitting there, the run landed — adopt it and say what happened. Only if
       * nothing arrived is this the error it claims to be.
       */
      const landed = await adoptStoredIfNewer();
      if (landed) {
        setAdopted({
          kind: "dropped",
          detail: err instanceof Error ? err.message : "the connection dropped",
        });
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setBusy(null);
    }
  }

  const staleness = recapStaleness(current, {
    picksEntered: dossier.picksEntered,
    boardFingerprint,
  });

  const phase: Phase =
    dossier.picksEntered === 0
      ? "before"
      : dossier.boardComplete
        ? "complete"
        : "during";

  /*
   * WHETHER THERE IS A STANDING TO PRINT AT ALL, which is not the same question
   * as whether the draft has started.
   *
   * `valueLeaderboard` is `franchises` sorted by `valueGained`, and rank is the
   * index. On a board with no picks every franchise has gained exactly zero, so
   * the sort is stable over the original order and the "standing" is iteration
   * order wearing a number — which seated Zach first and the commissioner tenth
   * in his own league on the strength of nothing whatsoever.
   *
   * Gating on `phase` fixed the zero-pick case and only that case. This asks the
   * question the badge actually claims to answer: do the franchises differ? One
   * pick in, they do; ten-way tied, they do not, whatever the pick count says.
   */
  const valueSeparates =
    new Set(dossier.valueLeaderboard.map((r) => r.valueGained)).size > 1;

  /*
   * The weakest starting slot per franchise, lifted off the projected table so
   * a card whose lineup is legal can still say something. Keyed rather than
   * searched per card: ten linear scans of ten rows is nothing, but the map
   * makes it obvious that the two surfaces are quoting one number.
   */
  const weakestSlots = new Map(
    (dossier.projectedStandings?.rows ?? []).map((row) => [
      row.teamId,
      { slot: row.weakestSlot, deficit: row.weakestSlotDeficit },
    ]),
  );

  return (
    <>
      <PageHeader
        title="Draft Recap"
        eyebrow="Draft Hub"
        /*
         * The keeper clause is dropped entirely where there are none. "With 0
         * keepers already out of the pool" is technically true and reads as a
         * page describing a different league — and on a redraft the yardstick
         * argument it exists to make simply does not apply, because with the
         * whole pool live consensus ADP IS very close to the right yardstick.
         */
        description={
          phase === "before"
            ? `Nothing has been drafted yet. When it has, this page argues about it — ` +
              `one verdict per franchise, measured against where a player was expected ` +
              `to go on THIS board` +
              (dossier.keepersOutOfPool > 0
                ? `, with ${dossier.keepersOutOfPool} keepers already out of the pool.`
                : `.`)
            : dossier.keepersOutOfPool > 0
              ? `Every verdict is measured against where a player was expected to go on THIS ` +
                `board — ${dossier.keepersOutOfPool} keepers are out of the pool, so consensus ADP is not the yardstick.`
              : `Every verdict is measured against where a player was expected to go on THIS ` +
                `board — the whole pool was live, so nobody was drafting round a locked roster.`
        }
      >
        {current && (
          <Badge variant="outline" className="tabular-nums">
            {current.usage.webSearches} web searches
          </Badge>
        )}
        <Button
          onClick={() => generate()}
          disabled={!canGenerate || busy !== null}
          title={
            canGenerate
              ? "Run Recap for all ten franchises"
              : (noModelReason ?? "")
          }
        >
          {busy === "all" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {/*
            ONE ACTION, ONE NAME, EVERYWHERE ON THIS PAGE. It used to be "Write
            the recap" before there was one and "Write a new recap" after,
            while the per-card control called the identical operation a
            re-roll — three names for one button on one screen. The label no
            longer changes with state; what has already been written is
            obvious from the ten cards underneath it.
          */}
          {busy === "all" ? "Running…" : "Run Recap"}
        </Button>
      </PageHeader>

      <PageBody>
        {!canGenerate && (
          <Notice tone="muted">
            {noModelReason}{" "}
            <span className="text-muted-foreground">
              Set it in <code>.env.local</code> and reload.
            </span>
          </Notice>
        )}

        {/*
          The pre-draft card below says all of this and says it better, so the
          two do not both appear. The notice is what covers the case the card
          does not: a recap that has already been written sitting above a board
          nobody has drafted into, which is exactly what production looked like
          when this pass was asked for.
        */}
        {!(phase === "before" && !current) && (
          <UnfinishedNotice dossier={dossier} phase={phase} />
        )}

        <StalenessNotice
          staleness={staleness}
          draftableSlots={dossier.draftableSlots}
        />

        {error && (
          <Notice tone="bad">
            <span className="font-semibold">The recap was not written.</span> {error}
          </Notice>
        )}

        {/*
          A recap arrived that this page did not render with. Worth a line rather
          than a silent swap, because the alternative is the room reading the
          previous recap with no reason to doubt it — and in the dropped case,
          because the next thing anybody would otherwise do is press the button
          again and buy the same two and a half minutes twice.
        */}
        {adopted && (
          <Notice tone="muted">
            {adopted.kind === "dropped" ? (
              <>
                <span className="font-semibold">
                  The connection dropped, but the recap finished.
                </span>{" "}
                What is below was read back from {savesTo} afterwards, so it is
                the run you just paid for and not the one before it. No need to
                run it again.{" "}
                <span className="font-mono text-xs">{adopted.detail}</span>
              </>
            ) : (
              <>
                <span className="font-semibold">
                  A newer recap was written after this page loaded.
                </span>{" "}
                The verdicts below have been replaced with it, so they are the
                current ones rather than whatever was on screen a moment ago.
              </>
            )}
          </Notice>
        )}

        {/*
          The one card the page shows when it has nothing to show. It is here
          rather than a row of ten empty skeletons because an empty skeleton
          reads as a page that failed to load, and this page is legitimately
          empty for most of the year.
        */}
        {phase === "before" && !current && (
          <BeforeTheDraft
            canGenerate={canGenerate}
            modelName={modelName}
            hasProjections={!!dossier.projectedStandings?.rows.length}
            keepersOutOfPool={dossier.keepersOutOfPool}
          />
        )}

        {canGenerate && !current && busy === null && phase !== "before" && (
          <Notice tone="muted">
            No recap has been written yet. The numbers below are the draft as it
            happened and need no model; press{" "}
            <span className="text-foreground font-semibold">Run Recap</span> to have{" "}
            {modelName} argue about them.
          </Notice>
        )}

        <Section
          label="Projected finish"
          caption={<ProjectedCaption dossier={dossier} phase={phase} />}
        >
          <ProjectedStandings dossier={dossier} />
        </Section>

        <Section
          label={current ? "The verdicts" : "Franchise by franchise"}
          caption={
            current
              ? "One card per franchise: the verdict, and directly beneath it every " +
                "figure that verdict rests on. The control on a card runs the recap " +
                "for that franchise alone and leaves the other nine standing." +
                (phase === "before"
                  ? " These were written against a board with no picks on it, so they " +
                    "are arguing about keepers."
                  : "")
              : phase === "before"
                ? "No picks have been made, so these carry only what is already true: " +
                  "what each manager kept, and what he walks in holding."
                : "One card per franchise. The figures below each name are the draft " +
                  "itself and need no model; the prose is what the button adds."
          }
        >
          {/*
            `items-stretch` is the grid default and is what makes a pair of
            cards the same height; `h-full` on the card is what makes the card
            actually take that height rather than shrink to its prose. Together
            with the `flex-1` on the blurb they put both cards' receipt boxes on
            one line, which is the difference between a row that looks laid out
            and a row that looks like two independent accidents.
          */}
          <div className="grid gap-4 xl:grid-cols-2">
            {dossier.franchises.map((franchise) => (
              <FranchiseCard
                key={franchise.teamId}
                franchise={franchise}
                dossier={dossier}
                phase={phase}
                valueSeparates={valueSeparates}
                weakest={weakestSlots.get(franchise.teamId) ?? null}
                blurb={blurbFor(current, franchise.teamId)}
                grade={gradeFor(current, franchise.teamId)}
                gradeLabel={current?.grades?.subjectLabel ?? null}
                busy={busy === franchise.teamId}
                disabled={!canGenerate || busy !== null}
                onRunOne={() => generate([franchise.teamId])}
              />
            ))}
          </div>
        </Section>

        <Provenance recap={current} savesTo={savesTo} />
      </PageBody>
    </>
  );
}

// --- Page furniture ---------------------------------------------------------

/**
 * A section marker: a letterspaced label with a rule running off it, and the
 * section's explanation directly underneath at a size somebody can read.
 *
 * The page had no such thing. It was a stack of cards and notices in one
 * undifferentiated column, so the shape of it — standings, then ten verdicts,
 * then the provenance — had to be inferred from the content rather than seen.
 * The label is `text-eyebrow`, the house treatment for exactly this, rather
 * than another outing for the display face.
 */
function Section({
  label,
  caption,
  children,
}: {
  label: string;
  caption?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-eyebrow text-foreground text-[11px] whitespace-nowrap">
          {label}
        </h2>
        <span aria-hidden className="bg-border h-px min-w-0 flex-1" />
      </div>
      {caption && (
        <p className="text-muted-foreground max-w-[92ch] text-[12.5px] leading-relaxed">
          {caption}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * `warn` is `--warning`, the token the palette reserves for exceptional cautions
 * off the position grid — see `globals.css`. It is deliberately not `bad`: red
 * on this page means "the thing you asked for did not happen", and a stale
 * recap is the opposite, a thing that happened perfectly well and has since been
 * overtaken. Two different failures should not wear the same colour on a page
 * read from six feet away.
 */
function Notice({
  tone,
  children,
}: {
  tone: "muted" | "warn" | "bad";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-4 text-[13px] leading-relaxed",
        tone === "bad" && "border-destructive/40 bg-destructive/5",
        tone === "warn" && "border-warning/50 bg-warning/[0.07]",
        tone === "muted" && "border-border bg-foreground/[0.03]",
      )}
    >
      {tone === "bad" && (
        <AlertTriangle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
      )}
      {tone === "warn" && (
        <AlertTriangle className="text-warning mt-0.5 h-5 w-5 shrink-0" />
      )}
      <div className="min-w-0 max-w-[92ch]">{children}</div>
    </div>
  );
}

/**
 * "The draft is not finished" — except on a board with nothing on it at all,
 * where that sentence badly understates the position.
 *
 * Zero picks and a hundred and forty-one picks are both "not finished", and the
 * old copy described them identically. It is worth two sentences to say which
 * one the reader is looking at, because everything else on the page reads
 * differently depending on the answer.
 */
function UnfinishedNotice({
  dossier,
  phase,
}: {
  dossier: RecapDossier;
  phase: Phase;
}) {
  if (phase === "complete") return null;

  if (phase === "before") {
    return (
      <Notice tone="muted">
        <span className="text-foreground font-semibold">
          Nothing has been drafted yet — the board is all keepers.
        </span>{" "}
        Everything on this page is computed from the keeper rosters and from who
        owns which pick, both of which are already settled. The steals, the
        reaches and the value column arrive with the picks.
      </Notice>
    );
  }

  return (
    <Notice tone="muted">
      <span className="text-foreground font-semibold">
        The draft is not finished.
      </span>{" "}
      {dossier.picksEntered} of {dossier.draftableSlots} picks are in and some
      franchises still hold empty slots. A recap written now judges an unfinished
      board.
    </Notice>
  );
}

/**
 * The one banner that says the prose and the receipts are about different
 * boards.
 *
 * WHY IT IS LOUDER THAN THE REST OF THE PAGE. Every other notice here describes
 * a state the reader can see for himself — no key, no recap yet, an unfinished
 * board. This one describes a thing that is INVISIBLE: ten paragraphs that read
 * as current sitting flush against numbers that were recomputed underneath them
 * a moment ago. Nobody in the room can tell by looking, so the page has to say
 * it outright or it does not get said.
 *
 * IT DOES NOT GATE ANYTHING, and that is deliberate. The stored recap stays on
 * screen, the generate button stays live, the per-card re-roll stays live. This
 * league's rule is that a bad state should be fixable in one keystroke in front
 * of ten people rather than made unreachable, so the banner's job is to point at
 * the two buttons that already fix it — not to take the recap away or to argue
 * about whether the room is allowed to have one.
 *
 * `fresh` renders nothing. A page that congratulates itself on being correct is
 * noise on a tab that is read once.
 */
function StalenessNotice({
  staleness,
  draftableSlots,
}: {
  staleness: RecapStaleness | null;
  draftableSlots: number;
}) {
  if (!staleness || staleness.kind === "fresh") return null;

  const { picksThen, picksNow } = staleness;

  if (staleness.kind === "unknown") {
    return (
      <Notice tone="muted">
        <span className="text-foreground font-semibold">
          There is no record of which board this recap was written against.
        </span>{" "}
        It was generated before this check existed. The pick count still matches
        — {picksNow} of {draftableSlots} — which is reassuring but is not proof,
        because a trade can move a pick without changing any total. Press{" "}
        <span className="text-foreground font-semibold">Run Recap</span> if anything
        below reads wrong.
      </Notice>
    );
  }

  return (
    <Notice tone="warn">
      <span className="text-foreground text-[15px] font-bold">
        These blurbs describe a different board. Regenerate before reading them
        out.
      </span>
      <p className="mt-1">
        The recap was written after {picksThen} of {draftableSlots} picks; the
        board and every number beside it is now at {picksNow}.
        {staleness.boardMoved &&
          " Pick ownership has moved as well — a trade landed after these blurbs were written, so they are about slots that now belong to somebody else."}{" "}
        The text below is the older board and has not been thrown away.
      </p>
      <p className="text-muted-foreground mt-1">
        <span className="text-foreground font-semibold">Run Recap</span> above
        replaces all ten; the same control on a card replaces that one franchise
        and leaves the rest.
      </p>
    </Notice>
  );
}

/**
 * What this page will be, said out loud on a board nobody has drafted into.
 *
 * The alternative — which is what shipped — is ten cards of blanks and red
 * shortage warnings, and the commissioner's verdict on that was "it's a little
 * confusing-ish… it looks like some stuff might be cut off". Nothing was cut
 * off. The page was simply describing an absence as though it were a finding.
 * A stated, deliberate empty state costs one card and removes the entire
 * question.
 */
function BeforeTheDraft({
  canGenerate,
  modelName,
  hasProjections,
  keepersOutOfPool,
}: {
  canGenerate: boolean;
  modelName: string | null;
  hasProjections: boolean;
  /** Zero on a redraft, which changes what this page can honestly promise. */
  keepersOutOfPool: number;
}) {
  const coming: { head: string; body: string }[] = [
    {
      head: "A verdict on every franchise",
      body: `Ten paragraphs, each measured against where a player was expected to go on ${
        keepersOutOfPool > 0
          ? "this keeper-thinned board"
          : "this board, with the whole pool live"
      } rather than against public ADP.`,
    },
    {
      head: "The steal and the reach",
      body: "Where each pick actually landed against where the board expected it, in slots, per franchise and league-wide.",
    },
    {
      head: "The receipts, in the same box",
      body: "Every figure a verdict rests on printed directly beneath it, so an argument about a blurb is settled without leaving the card.",
    },
  ];

  return (
    <Card className="gap-5">
      <div className="px-(--card-spacing)">
        <div className="text-primary text-eyebrow text-[10px]">
          Waiting on the draft
        </div>
        <h2 className="mt-2.5 text-[22px] leading-[1.2] font-bold">
          The recap is written after the draft.
        </h2>
        <p className="text-muted-foreground mt-2.5 max-w-[68ch] text-[14px] leading-relaxed">
          This page reads the finished board and argues about it.{" "}
          {keepersOutOfPool > 0
            ? "The board is still all keepers, so there is nothing yet to argue about"
            : "Not a pick has been entered yet, so there is nothing to argue about"}{" "}
          &mdash; but nothing here is broken and nothing is missing. The
          projected finish below goes live as the picks land
          {hasProjections ? "" : ", once the projections snapshot is pulled"}.
        </p>
      </div>

      <div className="grid gap-px px-(--card-spacing) sm:grid-cols-3 sm:gap-4">
        {coming.map((item) => (
          <div
            key={item.head}
            className="border-border/60 bg-foreground/[0.025] rounded-md border p-3.5"
          >
            <div className="text-foreground text-[13px] leading-snug font-semibold">
              {item.head}
            </div>
            <p className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">
              {item.body}
            </p>
          </div>
        ))}
      </div>

      <p className="text-muted-foreground px-(--card-spacing) text-[12.5px] leading-relaxed">
        {canGenerate ? (
          <>
            It costs one press of{" "}
            <span className="text-foreground font-semibold">Run Recap</span>
            {modelName ? ` — ${modelName} writes it` : ""} — and any single
            franchise can be run again afterwards, on its own, as often as the
            room likes.
          </>
        ) : (
          <>
            No model key is set on this machine, so the button is inert here. The
            numbers on this page never needed one.
          </>
        )}
      </p>
    </Card>
  );
}

// --- Projected standings ----------------------------------------------------

/**
 * The legend for the table, which is load-bearing and used to be set at 11px in
 * a narrow right-hand gutter beside the heading — the least readable thing on
 * a page whose whole subject is numbers that need qualifying. It is now the
 * section's caption, full measure, at body size.
 */
function ProjectedCaption({
  dossier,
  phase,
}: {
  dossier: RecapDossier;
  phase: Phase;
}) {
  const standings = dossier.projectedStandings;
  if (!standings?.rows.length) {
    return <>Season projections have not been pulled into this checkout yet.</>;
  }

  const { basis, rows } = standings;
  const simulated = rows.some((r) => r.projectedWins !== null);

  return (
    <>
      {phase === "before" && (
        <>
          <span className="text-foreground font-semibold">
            Keepers only — nobody has drafted yet.
          </span>{" "}
        </>
      )}
      {basis.disclaimer}
      {simulated && basis.simulation
        ? ` Wins and playoff odds are ${basis.simulation.runs.toLocaleString()} simulated seasons over the real ${basis.simulation.weeks}-week schedule (${basis.simulation.games} fixtures); the ORDER is on points, not on simulated wins.`
        : " No schedule was available, so there are no simulated wins."}
    </>
  );
}

/**
 * The projected 1-to-10 finish.
 *
 * The heaviest thing on the page, deliberately. Ten people will crowd a
 * projector for this and every one of them looks for his own line before he
 * reads a word of prose, so the rank numeral and the franchise handle are set
 * large, the bar makes the shape of the league readable before any number is,
 * and the row a manager is hunting for is findable from across a room.
 *
 * IT SAYS EXACTLY WHAT IT IS. The ORDER is on projected season points from each
 * franchise's best legal lineup. The wins and the playoff odds beside it come
 * from a Monte Carlo over the real ESPN schedule and are NOT what the table
 * sorts by — which is why a franchise can sit third here and fourth on wins.
 * `basis.disclaimer` is printed verbatim in the section caption above rather
 * than paraphrased.
 *
 * EVERY COLUMN IS LABELLED, INCLUDING THE BAR. The bar had no heading at all,
 * which left the widest element in the table as the only unexplained one. It is
 * each franchise's points as a share of the leader's, and saying so costs a
 * word.
 *
 * Absent projections are a sentence, not an empty table: the snapshot is pulled
 * into the repo rather than fetched at runtime, so "nobody has run the pull on
 * this checkout" is an ordinary state and never a fabricated order.
 */
function ProjectedStandings({ dossier }: { dossier: RecapDossier }) {
  const standings = dossier.projectedStandings;

  if (!standings?.rows.length) {
    return (
      <Notice tone="muted">
        <span className="text-foreground font-semibold">
          No projected standings yet.
        </span>{" "}
        Season projections are pulled into the repo rather than fetched live —
        run <code>npm run pull:projections</code> and reload. Everything below
        works without them.
      </Notice>
    );
  }

  const { basis, rows, spread } = standings;
  const best = Math.max(...rows.map((r) => r.projectedPoints));

  return (
    <Card className="gap-4">
      <Spread spread={spread} teams={rows.length} />

      <div className="px-(--card-spacing)">
        {/*
          Column headings, so a bare number in a row is never ambiguous. Hidden
          on narrow screens where the row collapses to rank, name and points.
          10px rather than 9px and at full `--muted-foreground` rather than 70%
          of it: these are the labels for every figure in the table and they
          were the smallest, faintest type on the page.
        */}
        <div className="text-muted-foreground border-border/60 hidden items-center gap-3 border-b pb-2 text-[10px] font-bold tracking-[0.12em] uppercase lg:flex">
          <span className="w-8 shrink-0 text-right">#</span>
          <span className="w-44 shrink-0">Franchise</span>
          <span className="min-w-0 flex-1">Vs leader</span>
          <span className="w-20 shrink-0 text-right">Points</span>
          <span className="w-16 shrink-0 text-right">Record</span>
          <span className="w-16 shrink-0 text-right">Playoff</span>
          <span className="w-36 shrink-0">Weakest slot</span>
        </div>

        {rows.map((row) => (
          <div
            key={row.teamId}
            className="border-border/50 flex items-center gap-3 border-b py-2.5 last:border-b-0"
          >
            <span className="text-muted-foreground/70 w-8 shrink-0 text-right text-[20px] leading-[1.1] font-black tabular-nums">
              {row.rank}
            </span>
            <span className="flex w-44 shrink-0 items-baseline gap-1.5">
              <span className="shrink-0 text-[15px] font-bold uppercase">
                {row.teamName}
              </span>
              <span className="text-muted-foreground min-w-0 truncate text-[11px]">
                {row.manager}
              </span>
            </span>
            <span className="bg-foreground/[0.06] hidden h-2.5 min-w-0 flex-1 overflow-hidden rounded-full sm:block">
              <span
                className="bg-primary block h-full rounded-full"
                style={{ width: `${Math.max(4, (row.projectedPoints / best) * 100)}%` }}
              />
            </span>
            <span className="w-20 shrink-0 text-right text-[14px] font-bold tabular-nums">
              {Math.round(row.projectedPoints).toLocaleString()}
            </span>
            <span className="text-muted-foreground hidden w-16 shrink-0 text-right text-[12px] tabular-nums lg:block">
              {row.projectedWins === null
                ? "—"
                : `${row.projectedWins.toFixed(1)}-${row.projectedLosses!.toFixed(1)}`}
            </span>
            <span className="hidden w-16 shrink-0 text-right text-[12px] font-semibold tabular-nums lg:block">
              {row.playoffOdds === null ? "—" : `${Math.round(row.playoffOdds * 100)}%`}
            </span>
            <span className="text-muted-foreground hidden w-36 shrink-0 truncate text-[12px] tabular-nums lg:block">
              {row.weakestSlot
                ? `${row.weakestSlot}${row.weakestSlotDeficit ? ` −${Math.round(row.weakestSlotDeficit)}` : ""}`
                : "—"}
            </span>
          </div>
        ))}
      </div>

      <div className="px-(--card-spacing)">
        {/*
          The projections are a pulled snapshot, never a live read, so this is
          the same note every other snapshot-backed surface carries.
        */}
        <DataSourceNote
          fromDatabase={false}
          snapshotLabel={`the ${basis.projectionsSource} projections`}
          fetchedAt={basis.projectionsPulledAt}
        />
        {!basis.complete && (
          <p className="text-muted-foreground mt-1.5 text-xs leading-relaxed">
            Some rostered players had no projection at all, so the franchises
            holding them are understated here rather than wrong.
          </p>
        )}
      </div>
    </Card>
  );
}

/**
 * How tight the table actually is, said out loud above the table.
 *
 * A column of ranks one through ten looks like a hierarchy even when nine of
 * the ten franchises are inside a single projected win of each other, and the
 * man on row nine reads his numeral before he reads his points. The prompt makes
 * the model narrate `spread` rather than the numbering — this is the receipt for
 * that, printed where the two can be compared. A blurb calling the field
 * bunched and a page implying a procession is the same failure as a blurb
 * disagreeing with its own steal.
 */
function Spread({
  spread,
  teams,
}: {
  spread: NonNullable<RecapDossier["projectedStandings"]>["spread"];
  teams: number;
}) {
  const headline =
    spread.shape === "pack"
      ? "This is a scrum, not a table."
      : spread.shape === "tiered"
        ? "One real gap, and a crowd either side of it."
        : "Genuinely stratified.";

  const pack =
    spread.teamsWithinOneWin !== null
      ? `${spread.teamsWithinOneWin} of ${teams} project within one win of the median`
      : `${spread.teamsWithinPointsBand} of ${teams} project within ${spread.pointsBand} points of the median`;

  return (
    <p className="text-muted-foreground max-w-[88ch] px-(--card-spacing) text-[13px] leading-relaxed">
      <span className="text-foreground font-semibold">{headline}</span> {pack}, and
      the typical distance between neighbouring rows is{" "}
      {spread.medianAdjacentPointsGap} points across a season.
      {spread.largestGapBetweenRanks && (
        <>
          {" "}
          The one real step down is {spread.largestAdjacentPointsGap} points,
          between {spread.largestGapBetweenRanks[0]} and{" "}
          {spread.largestGapBetweenRanks[1]}.
        </>
      )}
      {spread.teamsWithLivePlayoffOdds !== null && (
        <>
          {" "}
          The simulation cannot call {spread.teamsWithLivePlayoffOdds} of these
          either way.
        </>
      )}
    </p>
  );
}

// --- One franchise ----------------------------------------------------------

function FranchiseCard({
  franchise,
  dossier,
  phase,
  valueSeparates,
  weakest,
  blurb,
  grade,
  gradeLabel,
  busy,
  disabled,
  onRunOne,
}: {
  franchise: FranchiseDossier;
  dossier: RecapDossier;
  phase: Phase;
  /** False when every franchise has gained the same. See `DraftRecap`. */
  valueSeparates: boolean;
  weakest: { slot: string | null; deficit: number | null } | null;
  blurb: ReturnType<typeof blurbFor>;
  /** Null is the ordinary case and draws nothing. See `GradeSlot`. */
  grade: RecapGrade | null;
  /** "Keeper slate grade" / "Partial draft grade" / "Draft grade". */
  gradeLabel: string | null;
  busy: boolean;
  disabled: boolean;
  onRunOne: () => void;
}) {
  const value =
    dossier.valueLeaderboard.find((r) => r.teamId === franchise.teamId)
      ?.valueGained ?? 0;

  /*
   * COMPETITION RANKING, COMPUTED HERE RATHER THAN READ OFF THE DOSSIER.
   *
   * The dossier's `rank` is the array index after a sort, so franchises tied on
   * value are handed consecutive numbers and whichever the sort happened to
   * emit first is printed as the better draft. That is the zero-pick libel in
   * miniature and it does not go away once the draft starts: three managers
   * level on +5 would read as fourth, fifth and sixth.
   *
   * "One more than the number of franchises strictly above me" gives all three
   * the same rank, which is the only honest thing a tie can be shown as. The
   * dossier's own ordering is left alone — the prompt layer reads it, and it is
   * not this component's to redefine.
   */
  const rank =
    1 + dossier.valueLeaderboard.filter((r) => r.valueGained > value).length;

  return (
    <Card className="h-full gap-4">
      {/*
        THE HEADER WRAPS BEFORE THE NAME BLOCK DOES, WHICH THE GRADE MADE
        NECESSARY.

        This row was already at capacity on a phone: name block on the left,
        value figure, rank and control on the right, with about thirty pixels
        of slack. Adding a labelled letter to the cluster took ninety-six, and
        the left column — being `min-w-0`, so free to shrink below its own
        content — gave them up rather than wrapping. The result was a franchise
        whose verdict read "COMMISSIONER GIFTED MAYE AW" in a sixty-pixel
        column, which is the truncation a prior pass had just removed from the
        name one line above.

        So the left column now keeps a floor and the ROW wraps instead. Above
        roughly 500px of card there is no visible change at all and everything
        stays on one line; below it the cluster drops to its own right-aligned
        line, which is what a phone had room for all along. `min-w-0` is kept
        beside the floor so a single unbreakable word still cannot push the
        card wider than the screen.
      */}
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2.5 px-(--card-spacing)">
        <div className="min-w-0 flex-1 basis-44">
          {/*
            Wraps rather than truncates. On a phone this line was losing 84px
            of "Perpetually Impaired · Zach Rakowski" to an ellipsis, which is
            the franchise name and half the manager's name gone — on a page
            whose entire organising principle is one card per manager.
          */}
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-display text-[17px] leading-[1.15] font-bold tracking-[0.02em] uppercase">
              {franchise.teamName}
            </span>
            <span className="text-muted-foreground text-[12px] leading-snug">
              {franchise.franchiseName} · {franchise.manager}
            </span>
          </div>
          {blurb?.verdict && (
            <div className="text-primary mt-2 text-[11px] font-bold tracking-[0.14em] uppercase">
              {blurb.verdict}
            </div>
          )}
        </div>

        {/*
          THE CARD'S VERDICT CLUSTER. One flex row, read right from the
          franchise name: the letter grade, the value figure, the rank, the
          control that rewrites the card. Everything in it is optional except
          the control, and it collapses left as pieces drop out.

          A GRADE BELONGS AT THE HEAD OF THIS ROW. A separate pass is wiring a
          per-franchise A+..F letter, and the slot marked below is where it
          goes: first child, so it sits nearest the franchise name and reads as
          a verdict on the franchise rather than as another statistic; on its
          own it needs nothing but a `shrink-0` span at roughly `text-[24px]
          leading-none font-black` to out-rank the value figure beside it.
          Nothing here is sized to the row's height, so a taller grade simply
          sets it. Do not put the grade on the left next to the name — the
          verdict eyebrow already lives under there and the two would compete.

          THE VALUE FIGURE AND ITS RANK ARE ABSENT UNTIL THEY MEAN SOMETHING.
          On an empty board every franchise has gained exactly zero slots, so
          the card printed a bare grey "0" beside a "#1 of 10" that was really
          the order the franchises happened to come out of the array — which
          reads as a broken counter next to an award, and seated the
          commissioner tenth in his own league for no reason at all. Neither
          number exists until the franchises differ, which is what
          `valueSeparates` asks. Once they do, both appear, and the figure
          carries the label it always needed rather than relying on a tooltip
          nobody hovers on a television.
        */}
        {/*
          `ml-auto` and not just the row's `justify-between`, because those two
          only agree while both children are on one line. Once the row wraps
          the cluster is alone on its line, `justify-between` puts a lone item
          at the start, and the whole right-hand stack — which is right-aligned
          internally — jumped to the left edge reading ragged. `ml-auto` keeps
          it against the right margin in both layouts.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {/* GRADE SLOT — see above. */}
          <GradeSlot grade={grade} label={gradeLabel} />
          {valueSeparates && (
            <>
              <div className="flex flex-col items-end gap-1">
                <span className="text-muted-foreground/70 text-[8px] leading-none font-bold tracking-[0.14em] uppercase">
                  Slots gained
                </span>
                <span
                  className={cn(
                    "text-[19px] leading-[1.2] font-black tabular-nums",
                    value > 0
                      ? "text-success"
                      : value < 0
                        ? "text-destructive"
                        : "text-muted-foreground",
                  )}
                  title="Slots of value gained against the keeper-adjusted expectation"
                >
                  {value > 0 ? "+" : ""}
                  {value}
                </span>
              </div>
              <Badge variant="outline" className="shrink-0 tabular-nums">
                #{rank} of {dossier.teamCount}
              </Badge>
            </>
          )}
          <RunRecapButton
            teamName={franchise.teamName}
            busy={busy}
            disabled={disabled}
            onRunOne={onRunOne}
          />
        </div>
      </div>

      {/*
        `flex-1` is what bottom-anchors the receipts. Two cards side by side
        almost never hold the same length of prose, and without this the slack
        collected UNDER the receipt box — so a row read as one finished card
        and one card that had given up, and neither box lined up with the
        other. The slack now collects between the prose and the box, where it
        is just margin.
      */}
      <div className="flex-1 px-(--card-spacing)">
        {blurb ? (
          <p className="max-w-[68ch] text-[15px] leading-[1.7]">{blurb.blurb}</p>
        ) : phase === "before" ? null : (
          <p className="text-muted-foreground text-[14px] italic">
            No blurb yet. The receipts below stand on their own.
          </p>
        )}
        <GradeReason grade={grade} />
      </div>

      <Receipts franchise={franchise} phase={phase} weakest={weakest} />

      {blurb && blurb.sources.length > 0 && <Sources sources={blurb.sources} />}
    </Card>
  );
}

/**
 * One tone per band, and the whole design of this map is in the C row.
 *
 * FIVE BANDS, FIVE TONES, AND ONLY TWO OF THEM ARE ALARMS. `gradeBand` collapses
 * thirteen steps to five, and the letters must be legible as a scale from six
 * feet away without the card editorialising past what the letter says.
 *
 *   A  the accent. The one grade that gets to be a colour.
 *   B  plain foreground. A good draft is not an event.
 *   C  MUTED, AND DELIBERATELY NOT A WARNING. The rubric tells the model in
 *      terms that C means "par… nothing here is a mistake and nothing here is
 *      an edge… putting a franchise here is not an insult", and most competent
 *      drafts in a tight league land in it. Painting the modal grade amber
 *      would make the card call ten years of ordinary drafting a failure, and
 *      would contradict the standard the letter was assigned under.
 *   D  warning.
 *   F  destructive.
 *
 * Keyed on the band rather than the letter so a B+ and a B- cannot drift apart,
 * which is the same reason `gradeBand` exists.
 */
const GRADE_TONE: Record<"A" | "B" | "C" | "D" | "F", string> = {
  A: "text-primary",
  B: "text-foreground",
  C: "text-muted-foreground",
  D: "text-warning",
  F: "text-destructive",
};

/**
 * The letter, at the head of the card's verdict cluster.
 *
 * ABSENT IS A NORMAL STATE AND IT DRAWS NOTHING. Three ordinary situations
 * produce no grade: a recap written before grading existed — which includes the
 * one live in the league database — a board that cannot support a letter, and a
 * set the validator refused. In the third case NOBODY has one, and a dash or a
 * skeleton in this slot would read as a franchise that scored badly, which is a
 * claim nobody made. The reason the set was dropped goes in the footer, where a
 * fact about the run belongs; it is not ten copies of an apology.
 *
 * THE LABEL IS THE SUBJECT, NOT "DRAFT GRADE". It comes off the stored document
 * rather than off today's board, because the board moves and the letter does
 * not. On this morning's board — nineteen keepers, no picks — it says "Keeper
 * slate grade", and calling that a draft grade would assert a draft that has
 * not happened. That is the exact class of claim this page has spent the
 * session removing.
 */
function GradeSlot({
  grade,
  label,
}: {
  grade: RecapGrade | null;
  label: string | null;
}) {
  if (!grade) return null;
  const band = isGradeLetter(grade.letter) ? gradeBand(grade.letter) : null;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {/*
        Wraps rather than truncates, on the same principle as the franchise
        name above: "Keeper slate grade" is three words at 8px and a phone has
        room for two of them per line. An ellipsis here would leave "Keeper
        slate…" over a letter, which is a label that has stopped rather than
        finished.
      */}
      <span className="text-muted-foreground/70 max-w-[86px] text-right text-[8px] leading-[1.35] font-bold tracking-[0.14em] uppercase">
        {label ?? "Grade"}
      </span>
      {/*
        `leading-[1.2]`, matching the value figure beside it, and NOT
        `leading-none`. A 24px black glyph overflows a 24px line box by about
        two pixels, the card clips its overflow, and `audit:recap:layout`
        reports that as clipping on all ten cards at every viewport. It is not
        visible — the letter has the whole cluster to sit in — but a measured
        check that cries wolf ten times a run is a check nobody reads, and the
        row is not sized to anything this has to fight for.
      */}
      <span
        className={cn(
          "text-[24px] leading-[1.2] font-black",
          band ? GRADE_TONE[band] : "text-foreground",
        )}
      >
        {grade.letter}
      </span>
    </div>
  );
}

/**
 * Why the letter, and the two to four figures it rests on.
 *
 * Set under the blurb behind a rule, because without one a second paragraph in
 * the same column is more blurb — and these are different registers. The blurb
 * is a man at the table being rude; this is the sentence that has to survive
 * being read back by its subject, which is the whole reason a grade carries one.
 *
 * The citations are a receipt line rather than a table. Every number in them
 * has already been found in this franchise's own evidence — an unfindable
 * figure drops the whole set before it is saved — so the job here is to let the
 * room check the letter at a glance, not to explain the arithmetic.
 */
function GradeReason({ grade }: { grade: RecapGrade | null }) {
  if (!grade?.reason && !grade?.citations.length) return null;

  return (
    <div className="border-border/70 mt-4 max-w-[68ch] border-l-2 py-0.5 pl-3">
      {grade.reason && (
        <p className="text-muted-foreground text-[13.5px] leading-[1.6]">
          {grade.reason}
        </p>
      )}
      {grade.citations.length > 0 && (
        <div className="text-muted-foreground/70 mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">
          {grade.citations.map((citation, i) => (
            <span key={`${citation.label}-${i}`}>
              {citation.label}{" "}
              <span className="text-foreground/80 font-semibold tabular-nums">
                {citation.value}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function RunRecapButton({
  teamName,
  busy,
  disabled,
  onRunOne,
}: {
  teamName: string;
  busy: boolean;
  disabled: boolean;
  onRunOne: () => void;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 shrink-0"
      onClick={onRunOne}
      disabled={disabled}
      /*
       * Named for the page-level action with the scope bolted on, not for the
       * mechanism. "Re-roll" and "Write a new blurb" were two more names for
       * the button in the masthead, and a control that does the same thing
       * under a third name is a control the room has to be told about.
       */
      title={`Run Recap for ${teamName} only`}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      <span className="sr-only">Run Recap for {teamName} only</span>
    </Button>
  );
}

/**
 * The pages a blurb cites, one per line and led by the site.
 *
 * They were chips on a wrapped row clipped at 22 characters, which produced
 * "Cam Skatteboo still top optio…" and "Colston Loveland is becomi…" — long
 * enough to be a headline and short enough to be useless, and two chips from
 * the same site were indistinguishable from each other. A row apiece costs
 * about fourteen pixels a source and lets a real headline finish; the site is
 * printed first so a source is identifiable even when a very long title still
 * runs out of room.
 */
function Sources({
  sources,
}: {
  sources: NonNullable<ReturnType<typeof blurbFor>>["sources"];
}) {
  return (
    <div className="border-border/60 mx-(--card-spacing) flex flex-col gap-1 border-t pt-3">
      {sources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground flex min-w-0 items-baseline gap-1.5 text-[11.5px] transition-colors"
          title={`${source.title} — ${source.url}`}
        >
          <ExternalLink className="h-3 w-3 shrink-0 translate-y-[2px]" />
          <span className="text-foreground/70 shrink-0 font-semibold">
            {siteOf(source.url)}
          </span>
          <span className="min-w-0 truncate">{source.title}</span>
        </a>
      ))}
    </div>
  );
}

/** "www.theathletic.com/…" → "theathletic.com". Never throws on a bad URL. */
function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

/**
 * The evidence strip.
 *
 * ONE COLUMN OF LABEL-AND-VALUE ROWS, NOT A 2×2 GRID. It was two columns, and
 * the two columns were coupled: a grid row took the height of its tallest cell,
 * so a one-line "Roster" fact sat opposite a four-line "Pick capital" and the
 * box bottomed out at two very different depths on the left and the right. It
 * got worse rather than better as the draft progressed — "Cannot field" empties
 * out on a finished board, which knocked the right column's first row away and
 * left a hole with everything below it shunted up out of alignment. A single
 * column cannot develop a hole, every label lines up with every other label by
 * construction, and each value gets the full width of the card, which is what
 * takes the pick-capital sentence from four wrapped lines to two.
 *
 * `items-baseline` on the grid, not `items-start`: the label is 10px and the
 * value is 12.5px, so aligning their boxes leaves their baselines about three
 * pixels apart. Baseline alignment is what the eye actually reads a table by.
 *
 * ONLY THE FIGURE IS COLOURED. Whole sentences used to be set in `--success` or
 * `--destructive`, which made the box a block of red and green prose at 12px —
 * the least legible thing on the card, on the part of the card whose job is to
 * be checkable. The sentence is body text at 19:1 and the number inside it
 * carries the colour, which is also the only part that has a direction.
 *
 * Only facts that exist get a row — a franchise with no reach over the
 * threshold shows no reach row rather than a dash. And nothing that is merely
 * the default state gets one at all: before a pick is entered, "cannot field a
 * lineup" and "no QB at all" are true of all ten franchises and are not
 * findings about any of them.
 */
function Receipts({
  franchise,
  phase,
  weakest,
}: {
  franchise: FranchiseDossier;
  phase: Phase;
  weakest: { slot: string | null; deficit: number | null } | null;
}) {
  const steal = franchise.bestSteal;
  const reach = franchise.worstReach;
  const bargain = [...franchise.keepers].sort(
    (a, b) => (b.slotsSavedByKeeping ?? 0) - (a.slotsSavedByKeeping ?? 0),
  )[0];
  const missed = franchise.passedOnKeepers.find(
    (p) => (p.roundsCheaperToKeep ?? 0) > 0,
  );
  const open = franchise.openStarterSlots;

  /*
   * THE ROSTER ROW ONLY EVER WANTED THE STACK FACTS, and it decides that
   * structurally rather than by reading the sentences.
   *
   * `oddities` leads with shortages — "no QB at all; the league starts 1 QB" —
   * and a shortage is precisely what the Lineup row above already reports, in
   * different words, one line apart. Worse, on a board nobody has drafted into
   * it is true of all ten franchises for the same reason, so ten cards carried
   * one identical sentence about nobody.
   *
   * This filtered those out by matching their opening words, which worked and
   * was wrong: the strings belong to `recap-dossier.ts` and the prompt layer
   * rewords them, so the filter would have failed silently the first time
   * somebody improved the copy — and the row would quietly come back.
   *
   * A shortage exists if and only if a starting slot is unfilled, so an empty
   * `openStarterSlots` is a guarantee that every remaining oddity is a stack
   * ("4 QB rostered; the league starts 1 QB"), whatever words it uses. No
   * shortage, no duplication, and nothing here to break when the copy moves.
   */
  const oddity = open.length === 0 ? franchise.oddities[0] : undefined;

  return (
    /*
     * A FIXED LABEL COLUMN, not `auto`. `auto` sizes to the widest label in
     * THAT card, so a franchise with no keeper row got a narrower label column
     * than the card beside it and the two value columns started at different
     * x — the raggedness moved from inside one box to between two. 5.5rem
     * clears "KEEPER VALUE", the longest label the box can hold.
     */
    <dl className="border-border/60 bg-foreground/[0.025] mx-(--card-spacing) grid grid-cols-[5.5rem_1fr] items-baseline gap-x-4 gap-y-2.5 rounded-md border p-3.5 text-[12.5px] leading-[1.55]">
      {steal?.slotsVsBoard != null && steal.slotsVsBoard < 0 && (
        <Receipt label="Best steal">
          <Player name={steal.player} position={steal.position} /> at {steal.label}{" "}
          —{" "}
          <Fig tone="good">
            {Math.abs(steal.slotsVsBoard)} slot
            {Math.abs(steal.slotsVsBoard) === 1 ? "" : "s"} later
          </Fig>{" "}
          than this board expected
        </Receipt>
      )}
      {reach?.slotsVsBoard != null && reach.slotsVsBoard > 0 && (
        <Receipt label="Worst reach">
          <Player name={reach.player} position={reach.position} /> at {reach.label}{" "}
          —{" "}
          <Fig tone="bad">
            {reach.slotsVsBoard} slot{reach.slotsVsBoard === 1 ? "" : "s"} earlier
          </Fig>{" "}
          than this board expected
        </Receipt>
      )}
      {bargain?.slotsSavedByKeeping != null && (
        <Receipt label="Keeper value">
          <Player name={bargain.player} position={bargain.position} /> at R
          {bargain.costRound} —{" "}
          <Fig tone={bargain.slotsSavedByKeeping > 0 ? "good" : "bad"}>
            {bargain.slotsSavedByKeeping > 0 ? "+" : ""}
            {bargain.slotsSavedByKeeping} slot
            {Math.abs(bargain.slotsSavedByKeeping) === 1 ? "" : "s"}
          </Fig>{" "}
          against redrafting him
        </Receipt>
      )}
      {missed && (
        <Receipt label="Passed on">
          <Player name={missed.player} position={missed.position} /> — keepable at R
          {missed.costRound}, <Fig tone="bad">went R{missed.draftedAtRound}</Fig>
        </Receipt>
      )}
      <LineupReceipt phase={phase} open={open} weakest={weakest} />
      {phase !== "before" && oddity && <Receipt label="Roster">{oddity}</Receipt>}
      {!franchise.draftCapital.hasFirstRoundPick && (
        <Receipt label="First pick">
          no first-round pick; opened at {franchise.draftCapital.firstPickLabel}
        </Receipt>
      )}
      <PickCapitalReceipt capital={franchise.pickCapital} phase={phase} />
      {franchise.unusedKeeperSlots.deliberate &&
        franchise.unusedKeeperSlots.count > 0 && (
          <Receipt label="Keepers">
            left{" "}
            <Fig tone="bad">
              {franchise.unusedKeeperSlots.count} keeper slot
              {franchise.unusedKeeperSlots.count === 1 ? "" : "s"}
            </Fig>{" "}
            empty on purpose
          </Receipt>
        )}
    </dl>
  );
}

/**
 * The lineup row, which inverts rather than disappearing.
 *
 * "Cannot field" is a row that only exists while something is wrong with the
 * roster, and on the board this page is actually for — a finished one — most
 * franchises have nothing wrong with theirs. A row that is present on an empty
 * board, screaming, and absent on a full one is exactly backwards: it is loudest
 * when it means least.
 *
 * So it says nothing at all before a pick is entered, where every franchise is
 * missing every slot and the fact is about the calendar rather than the
 * manager; it names the holes while they exist; and on a finished board with no
 * holes it turns into the affirmative — a legal nine, and the slot that is
 * nonetheless dragging it down, which is the same figure the projected table
 * prints in its own last column.
 */
function LineupReceipt({
  phase,
  open,
  weakest,
}: {
  phase: Phase;
  open: string[];
  weakest: { slot: string | null; deficit: number | null } | null;
}) {
  if (phase === "before") return null;

  if (open.length > 0) {
    return (
      <Receipt label="Lineup">
        cannot fill <Fig tone="bad">{open.join(", ")}</Fig>
      </Receipt>
    );
  }

  if (phase !== "complete") return null;

  return (
    <Receipt label="Lineup">
      <Fig tone="good">a legal starting nine</Fig>
      {weakest?.slot ? (
        <>
          , weakest at <Fig>{weakest.slot}</Fig>
          {weakest.deficit != null && (
            <>
              {" "}
              — <Fig tone="bad">{Math.round(weakest.deficit)} points</Fig> behind
              the league at that slot
            </>
          )}
        </>
      ) : null}
    </Receipt>
  );
}

/**
 * What the manager walked in holding, measured against the room.
 *
 * Always rendered, unlike the rest of the strip, because every franchise has an
 * answer to this one and the comparison is the whole value of it: "seven picks
 * through round six" means nothing until "league median four" is sitting beside
 * it. The other rows describe events that may not have happened; this one
 * describes a board that always exists.
 *
 * PAST TENSE ONCE THE BOARD IS FINISHED. "Holds seven draftable picks" is a
 * statement about capital he still has, and on a completed board he has none of
 * it — every one of those slots has a name in it. The figures are identical
 * either way; the verb is the only thing that has to move.
 *
 * THE SHAPE AND THE TRADES CAME OFF THE END OF THE SENTENCE. It used to run
 * "…against a league median of 4.5 — 2× R1, 3× R4, 2× R12; no pick to make
 * R5–R10; 5 in, 5 out by trade" as one string, four wrapped lines of clauses
 * separated by three different punctuation marks. The comparison is the
 * headline and now stands alone; the shape sits under it in muted type; the
 * trades are their own labelled row, and vanish entirely for a franchise that
 * made none rather than printing "nothing traded".
 *
 * DELIBERATELY SAYS DRAFTABLE. Zach owns a sixth-rounder with a keeper sitting
 * in it, and a row that counted that as capital would be contradicted by the
 * blurb printed directly above it.
 */
function PickCapitalReceipt({
  capital,
  phase,
}: {
  capital: PickCapital;
  phase: Phase;
}) {
  const shape = capital.doubledRounds.map((d) => `${d.count}× R${d.round}`).join(", ");
  const gapFrom = capital.longestGapAfterRound;
  const drought =
    capital.longestGapRounds > 1 && gapFrom !== null
      ? `no pick to make R${gapFrom + 1}–R${gapFrom + capital.longestGapRounds}`
      : null;
  const detail = [shape, drought].filter(Boolean).join(" · ");
  const tone =
    capital.earlyPicksVsMedian > 0
      ? "good"
      : capital.earlyPicksVsMedian < 0
        ? "bad"
        : undefined;
  const traded = capital.acquired.length + capital.surrendered.length > 0;

  return (
    <>
      <Receipt label="Pick capital">
        {phase === "complete" ? "walked in with " : "holds "}
        <Fig tone={tone}>
          {capital.earlyPicks} draftable pick{capital.earlyPicks === 1 ? "" : "s"}
        </Fig>{" "}
        through R{capital.earlyThroughRound} against a league median of{" "}
        <span className="tabular-nums">{capital.earlyPicksLeagueMedian}</span>
        {detail && (
          <span className="text-muted-foreground mt-0.5 block tabular-nums">
            {detail}
          </span>
        )}
      </Receipt>
      {traded && (
        <Receipt label="Pick trades">
          <Fig>{capital.acquired.length}</Fig> in,{" "}
          <Fig>{capital.surrendered.length}</Fig> out
        </Receipt>
      )}
    </>
  );
}

/**
 * One row of the strip. A fragment rather than a wrapper so that the `<dt>` and
 * the `<dd>` are direct children of the grid — which is what lets every label
 * in the box share one column edge and every value share another, instead of
 * each row negotiating its own alignment.
 */
function Receipt({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-muted-foreground text-[10px] font-bold tracking-[0.1em] whitespace-nowrap uppercase">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </>
  );
}

/**
 * The one quantity a row turns on, and the only thing in the box that carries a
 * colour. `tabular-nums` so a column of these lines up when two cards sit side
 * by side.
 */
function Fig({
  tone,
  children,
}: {
  tone?: "good" | "bad";
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "font-semibold tabular-nums",
        tone === "good" && "text-success",
        tone === "bad" && "text-destructive",
      )}
    >
      {children}
    </span>
  );
}

/** Name plus a position-coloured tag, the app's usual treatment. */
function Player({ name, position }: { name: string; position: string }) {
  return (
    <>
      <span className="font-semibold">{name}</span>{" "}
      <span className={cn("text-[10px] font-black", positionText(position))}>
        {position}
      </span>
    </>
  );
}

// --- Footer -----------------------------------------------------------------

/**
 * Who wrote it, when, what it cost, and every page it read.
 *
 * The cost is printed because the room will press the re-roll button and
 * somebody should know what that spends. The full citation list is here rather
 * than on the cards because it is the answer to "where did it get that" for the
 * whole run, and per-card sources already cover the specific claims.
 *
 * It sits behind its own section rule and is set smaller than anything above
 * it. As one undifferentiated grey paragraph hanging off the last card it read
 * as a sentence somebody had forgotten to finish styling.
 */
function Provenance({
  recap,
  savesTo,
}: {
  recap: RecapDocument | null;
  savesTo: string;
}) {
  if (!recap) return null;

  const written = new Date(recap.generatedAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  /*
   * `figures` decides whether the value gets `tabular-nums`. A model name and a
   * file path both contain digits and neither is a column of them, and lining
   * those digits up makes "claude-opus-5" and "draft-recap-2026.json" render
   * with gaps around every numeral, as though the string were broken.
   */
  const facts: {
    label: string;
    value: string;
    figures?: boolean;
    warn?: boolean;
  }[] = [
    { label: "Model", value: recap.model },
    { label: "Written", value: written, figures: true },
    {
      label: "Board",
      value: `${recap.picksEntered} picks · ${recap.keepersOutOfPool} keepers out of the pool`,
      figures: true,
    },
    {
      label: "Run",
      value:
        `${recap.usage.webSearches} web searches · ${recap.usage.inputTokens.toLocaleString()} tokens in / ` +
        `${recap.usage.outputTokens.toLocaleString()} out · about $${recap.usage.costUsd.toFixed(2)}`,
      figures: true,
    },
  ];

  /*
   * THE GRADES ROW, AND ITS ABSENCE, ARE BOTH FACTS ABOUT THE RUN.
   *
   * A blocking flag from `validateGrades` drops all ten letters — the curve is
   * the unit, and one blank card among nine reads as an accusation. That is the
   * right behaviour and it has one bad property: the page then looks exactly
   * like a page nobody has graded. In front of the room, on the night, "it
   * failed its own check" and "the button was never pressed" are different
   * facts and there is no log to open.
   *
   * So the refusal is printed here, where the run already accounts for itself,
   * rather than on ten cards where it would be ten copies of an apology beside
   * ten franchises who did nothing wrong. Three states, three appearances:
   *
   *   letters saved     a row saying how many and what the spread was
   *   letters withheld   a warned row, and the checker's own words under it
   *   never graded      NO ROW AT ALL, which is the honest rendering of a
   *                     recap written before grades existed — the one in the
   *                     league database right now is exactly that
   */
  const grades = recap.grades ?? null;
  const withheld = grades?.withheld ?? null;

  if (grades && !withheld && grades.assigned.length > 0) {
    const ordered = [...grades.assigned]
      .map((g) => g.letter)
      .filter(isGradeLetter)
      .sort((a, b) => gradeIndex(a) - gradeIndex(b));
    const spread =
      ordered.length && ordered[0] !== ordered[ordered.length - 1]
        ? ` · ${ordered[0]} through ${ordered[ordered.length - 1]}`
        : ordered.length
          ? ` · all ${ordered[0]}`
          : "";
    facts.push({
      label: "Grades",
      value: `${grades.assigned.length} × ${grades.subjectLabel.toLowerCase()}${spread}`,
      figures: true,
    });
  }

  if (withheld) {
    facts.push({
      label: "Grades",
      value:
        withheld.returned > 0
          ? `Withheld — ${withheld.returned} came back and did not pass the consistency check, ` +
            `so none were saved`
          : "Withheld — none were assigned",
      warn: true,
    });
  }

  facts.push({ label: "Saved to", value: savesTo });

  return (
    <Section label="How this was written">
      <div className="text-muted-foreground flex flex-col gap-3 text-[11.5px] leading-relaxed">
        <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
          {facts.map((fact) => (
            <Receipt key={fact.label} label={fact.label}>
              <span
                className={cn(
                  fact.figures && "tabular-nums",
                  fact.warn && "text-warning font-semibold",
                )}
              >
                {fact.value}
              </span>
            </Receipt>
          ))}
        </dl>
        {withheld && withheld.reasons.length > 0 && (
          <details className="group/grades">
            <summary className="text-foreground/70 hover:text-foreground w-fit cursor-pointer text-[11.5px] font-semibold">
              why {withheld.reasons.length === 1 ? "it was" : "they were"} withheld
            </summary>
            {/*
              The checker's own sentences, unedited. `GradeFlag.message` is
              written to be printed without reformatting precisely so that the
              person reading it here is reading what the check actually
              objected to, rather than a summary of it made by the thing that
              is reporting its own failure.
            */}
            <ul className="mt-2 flex flex-col gap-1.5">
              {withheld.reasons.map((reason, i) => (
                <li key={i} className="max-w-[92ch] leading-relaxed">
                  {reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {recap.citations.length > 0 && (
          <details className="group/cites">
            <summary className="text-foreground/70 hover:text-foreground w-fit cursor-pointer text-[11.5px] font-semibold">
              {recap.citations.length} pages read
            </summary>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {recap.citations.map((c) => (
                <li key={c.url} className="flex min-w-0 items-baseline gap-1.5">
                  <span className="text-foreground/60 shrink-0 font-semibold">
                    {siteOf(c.url)}
                  </span>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-foreground min-w-0 truncate"
                    title={`${c.title} — ${c.url}`}
                  >
                    {c.title}
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Section>
  );
}

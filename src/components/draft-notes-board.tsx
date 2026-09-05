"use client";

import { useMemo, useState } from "react";
import { NotebookPen, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { positionCell, positionText } from "@/lib/positions";
import type { DraftNotes, NotedPick, ScribeSegment } from "@/lib/draft-notes";

/**
 * The scribe's notes, as a transcript.
 *
 * ============================================================================
 * A TRANSCRIPT, NOT A TABLE
 * ============================================================================
 *
 * The obvious build is a table: pick, player, comment. It was tried and it is
 * wrong for this data. A third of the cells hold four or five people talking
 * over each other, so the comment column ends up eight lines tall next to a
 * one-line pick, and a table whose rows vary from one line to nine reads worse
 * than the spreadsheet it came from. What this actually is — a room, in order,
 * with occasional notes about who was on the clock — is a transcript, so the
 * pick becomes a header and the quotes hang underneath it.
 *
 * ============================================================================
 * THE SPEAKER IS THE THING BEING READ
 * ============================================================================
 *
 * Managers come here to find themselves and their friends, so the speaker's name
 * is the strongest element on each line and the filter matches it. Quotes Scott
 * left unattributed are set in the same shape with the name slot empty rather
 * than being labelled "unknown": an em dash is a man who was not identified, and
 * "Unknown" reads like a manager nobody remembers.
 *
 * Stage directions are set apart from speech — dimmer, italic, no quote mark —
 * because "[Zach finished his beer]" is Scott describing the room and printing it
 * as dialogue would attribute an action to nobody as though somebody said it.
 *
 * SEARCH IS OVER THE WORDS, THE NAMES AND THE PLAYERS. Somebody will remember a
 * line and not who said it, or remember the pick and not the line. One box,
 * matching all three, is what a person hunting for the Dolly Parton exchange
 * will actually type into.
 */
export function DraftNotesBoard({ notes }: { notes: DraftNotes }) {
  const [query, setQuery] = useState("");
  const [speaker, setSpeaker] = useState<string | null>(null);

  const visible = useMemo(() => filterPicks(notes.picks, query, speaker), [
    notes.picks,
    query,
    speaker,
  ]);

  const quoteCount = notes.talkers.reduce((sum, t) => sum + t.quotes, 0) + notes.unattributed;
  const filtered = query.trim().length > 0 || speaker !== null;

  /*
   * NO NOTE MATCHED ANYTHING. Not a broken import — it is what this page looks
   * like when the board it reads has no draft in it: a fresh local checkout on
   * the file store, or a board that has just been reset. Saying so beats listing
   * sixty-three notes as errors, which is what the straggler panel below would
   * otherwise do and would read as the notes being lost.
   */
  if (notes.picks.length === 0) {
    return (
      <div className="border-border bg-muted/20 flex gap-3 rounded-lg border p-5">
        <NotebookPen className="text-muted-foreground mt-0.5 h-5 w-5 shrink-0" />
        <div>
          <p className="font-semibold">The notes are here; the draft is not.</p>
          <p className="text-muted-foreground mt-1 text-[13px]">
            {notes.scribe.shortName}&rsquo;s {notes.unmatched.length} notes are loaded, but the
            board this page is reading has no drafted picks to hang them on. Nothing has been
            lost — the notes key on pick number and will reappear with the board.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Ledger notes={notes} quoteCount={quoteCount} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the room — a line, a name, a player"
            className="pl-9"
            aria-label="Search the draft notes"
          />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery("");
              setSpeaker(null);
            }}
            className="shrink-0"
          >
            <X className="mr-1.5 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      <Talkers notes={notes} selected={speaker} onSelect={setSpeaker} />

      {visible.length === 0 ? (
        <p className="text-muted-foreground border-border rounded-lg border border-dashed p-8 text-center text-[13px]">
          Nothing in the notes matches that.
        </p>
      ) : (
        <div className="space-y-3">
          {filtered && (
            <p className="text-muted-foreground text-[12px]">
              {visible.length} of {notes.picks.length} commented picks
              {speaker ? ` with ${speaker} on the record` : ""}.
            </p>
          )}
          {visible.map((pick) => (
            <PickBlock key={pick.overallPick} pick={pick} highlight={query.trim()} />
          ))}
        </div>
      )}

      {/*
       * Should always be empty — `verify:draft:notes` fails the build's sibling
       * check if it is not. Rendered anyway rather than dropped, because a note
       * that silently does not appear is the one failure nobody would notice.
       */}
      {notes.unmatched.length > 0 && (
        <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-4">
          <p className="text-[13px] font-semibold">
            {notes.unmatched.length} note{notes.unmatched.length === 1 ? "" : "s"} could not be
            matched to a pick on the board.
          </p>
          <ul className="text-muted-foreground mt-2 space-y-1 text-[12px]">
            {notes.unmatched.map((note) => (
              <li key={note.overallPick}>
                #{note.overallPick} — {note.said}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Provenance and scale, in one line, above the transcript. */
function Ledger({ notes, quoteCount }: { notes: DraftNotes; quoteCount: number }) {
  return (
    <div className="border-border bg-muted/20 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border p-4">
      <div className="flex items-center gap-2.5">
        <NotebookPen className="text-muted-foreground h-4 w-4 shrink-0" />
        <p className="text-[13px]">
          Kept by <span className="font-semibold">{notes.scribe.fullName}</span>, live at the
          table.
        </p>
      </div>
      <p className="text-muted-foreground text-[13px]">
        <span className="text-foreground font-semibold">{quoteCount}</span> lines on the record
        over <span className="text-foreground font-semibold">{notes.picks.length}</span> picks
        {notes.unattributed > 0 &&
          `, ${notes.unattributed} of them said by someone he didn't name`}
        .
      </p>
    </div>
  );
}

/**
 * Who talked, as filters.
 *
 * Doubles as the night's scoreboard, which is why the counts are on the chips
 * rather than in a separate table — the funniest fact in the data is that two
 * people accounted for half the room, and it should not need a second component
 * to say so.
 */
function Talkers({
  notes,
  selected,
  onSelect,
}: {
  notes: DraftNotes;
  selected: string | null;
  onSelect: (speaker: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {notes.talkers.map((talker) => {
        const active = selected === talker.speaker;
        return (
          <button
            key={talker.speaker}
            type="button"
            onClick={() => onSelect(active ? null : talker.speaker)}
            aria-pressed={active}
            className={[
              "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
              "text-[12px] transition-colors focus-visible:ring-2 focus-visible:outline-none",
              active
                ? "border-foreground bg-foreground text-background font-semibold"
                : "border-border hover:bg-muted/60",
            ].join(" ")}
          >
            <span className={talker.guest ? "italic" : ""}>{talker.speaker}</span>
            <span className={active ? "opacity-70" : "text-muted-foreground"}>
              {talker.quotes}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One pick: what happened, then what was said about it. */
function PickBlock({ pick, highlight }: { pick: NotedPick; highlight: string }) {
  return (
    <article className="border-border bg-card overflow-hidden rounded-lg border">
      <header className="border-border/60 flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <span className="text-muted-foreground font-mono text-[12px] tabular-nums">
          {pick.label}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${positionCell(pick.position)} ${positionText(pick.position)}`}
        >
          {pick.position}
        </span>
        <span className="text-[14px] font-semibold">{pick.playerName}</span>
        {pick.nflTeam && (
          <span className="text-muted-foreground font-mono text-[11px]">{pick.nflTeam}</span>
        )}
        <span className="text-muted-foreground ml-auto text-[12px]">
          {pick.team}
          {pick.acquiredFrom && (
            <span className="ml-1.5 opacity-70">via {pick.acquiredFrom}</span>
          )}
        </span>
        {pick.isKeeper && (
          <Badge variant="outline" className="text-[10px]">
            Keeper
          </Badge>
        )}
      </header>

      <div className="divide-border/40 divide-y">
        {pick.segments.map((segment, i) => (
          <Segment key={i} segment={segment} highlight={highlight} />
        ))}
      </div>
    </article>
  );
}

/**
 * One line of the transcript.
 *
 * SPEAKER FIRST, on a shared left edge. Scott wrote them the other way round —
 * quote, then name — and rendering it that way was tried: it costs two lines for
 * a four-word quip and turns the name into a footnote, which is backwards for a
 * page whose main use is finding your own lines and your friends'. Every name
 * starting at the same x is what makes 105 of these scannable.
 *
 * The column is narrow enough to suit the ten short handles and lets the one long
 * guest name wrap, rather than being sized for its widest member and leaving
 * ninety pixels of nothing beside "Joe".
 */
function Segment({ segment, highlight }: { segment: ScribeSegment; highlight: string }) {
  /*
   * A stage direction takes the same row shape with an empty name slot, so it
   * lines up with the speech without needing to restate the column width as an
   * arbitrary padding that would drift the moment the column changed.
   */
  if (segment.kind === "action") {
    return (
      <div className="flex gap-3 px-4 py-1.5">
        <span className="w-20 shrink-0" aria-hidden />
        <p className="text-muted-foreground/70 min-w-0 text-[12px] leading-relaxed italic">
          <Mark text={segment.text} query={highlight} />
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-3 px-4 py-1.5">
      <span className="w-20 shrink-0 pt-px text-right text-[12px] leading-relaxed break-words">
        {segment.speaker ? (
          <span className="font-semibold">{segment.speaker}</span>
        ) : (
          /*
           * A dash rather than "Unknown". Four quotes have no name against them
           * and inventing a label for them would read like a manager nobody
           * remembers; the ledger above says how many there are. Titled and
           * labelled because a bare dash means nothing read aloud.
           */
          <span
            className="text-muted-foreground/60"
            title="The scribe didn't record who said this"
            aria-label="speaker not recorded"
          >
            &mdash;
          </span>
        )}
      </span>
      <p className="min-w-0 text-[14px] leading-relaxed">
        <span className="text-muted-foreground/50">&ldquo;</span>
        <Mark text={segment.said} query={highlight} />
        <span className="text-muted-foreground/50">&rdquo;</span>
        {segment.aside && (
          <span className="text-muted-foreground ml-1.5 text-[12px]">{segment.aside}</span>
        )}
      </p>
    </div>
  );
}

/**
 * The matched text, lit.
 *
 * Splits on the query rather than injecting markup, because these strings are
 * somebody's freehand typing and half of them contain characters that would have
 * to be escaped. Case-insensitive; the query is escaped for the regex since a
 * search for "(" is a thing a person will do by accident.
 */
function Mark({ text, query }: { text: string; query: string }) {
  if (query.length < 2) return <>{text}</>;

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  if (parts.length === 1) return <>{text}</>;

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-primary/25 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * Matches over speech, speakers and the board's own facts.
 *
 * The speaker filter is deliberately a filter over PICKS rather than over quotes:
 * pressing "Kyle" shows the exchanges Kyle was part of, other people's replies
 * included, because a one-sided transcript of an argument is not readable. His
 * lines are already the ones bearing his name.
 */
function filterPicks(
  picks: NotedPick[],
  query: string,
  speaker: string | null,
): NotedPick[] {
  const needle = query.trim().toLowerCase();

  return picks.filter((pick) => {
    if (
      speaker &&
      !pick.segments.some((s) => s.kind === "quote" && s.speaker === speaker)
    ) {
      return false;
    }
    if (!needle) return true;

    if (
      pick.playerName.toLowerCase().includes(needle) ||
      pick.team.toLowerCase().includes(needle) ||
      pick.franchiseName.toLowerCase().includes(needle) ||
      pick.label.includes(needle)
    ) {
      return true;
    }

    return pick.segments.some((segment) =>
      segment.kind === "quote"
        ? segment.said.toLowerCase().includes(needle) ||
          (segment.speaker?.toLowerCase().includes(needle) ?? false) ||
          (segment.aside?.toLowerCase().includes(needle) ?? false)
        : segment.text.toLowerCase().includes(needle),
    );
  });
}

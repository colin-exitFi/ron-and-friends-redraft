"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CircleAlert,
  Loader2,
  Plus,
  Scale,
  Search,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { positionStyle } from "@/lib/positions";
import type {
  CommitResult,
  DraftLine,
  PickOption,
  RosterOption,
  TradeDraft,
  TradePreview,
} from "@/lib/trade-entry-types";

/**
 * Logging a trade that has already happened.
 *
 * ============================================================================
 * WHAT THIS SCREEN IS OPTIMISED FOR
 * ============================================================================
 * Two franchises, a handful of assets, entered minutes after ESPN approved the
 * deal — often from a phone. Every trade in the league's recorded history is
 * two-sided, so THE COMMON CASE MUST NOT PAY FOR THE RARE ONE: a two-team trade
 * is enterable without ever encountering the possibility of a third. A third
 * franchise is one deliberate click away and, once added, the from-franchise
 * selectors appear on every line. Nothing about that machinery is visible until
 * it is asked for.
 *
 * ============================================================================
 * WHY THERE IS ALMOST NOTHING TO TYPE
 * ============================================================================
 * The failure this screen exists to prevent is not a slow entry, it is a WRONG
 * entry that stays invisible for nine months and then prints a bad cell in
 * front of ten people. So every field that could hold a mistake has been turned
 * into a choice from what the ledger already knows:
 *
 *   PICKS are chosen from what the sending franchise CURRENTLY HOLDS. A pick
 *   already traded away is not in the list, so it cannot be offered. There is
 *   no round field to mistype and no way to move a pick somebody else owns.
 *   Note that the sender is IMPLIED BY THE PICK rather than chosen: whoever
 *   holds it is the only franchise who can send it, which removes a control
 *   from the common case and a whole class of mismatch with it.
 *
 *   PLAYERS are chosen from the draft room's matcher and stored as ids. There is
 *   no free-text name field anywhere on this screen, which is what permanently
 *   closes the "Puca Nakua" class of error rather than patching it downstream
 *   with an alias map.
 *
 *   FAAB is a whole-dollar amount, and the only number typed on the page.
 *
 * Everything else is derived: the season, the keeper-clock reset (a league rule,
 * not a per-trade choice), the executed timestamp, and the fact that the trade
 * is already accepted.
 *
 * The one free-text field is the note, and it is deliberately prominent. The
 * league has not ruled on whether contingent trades are allowed at all, so
 * there is no structured condition support to hide behind — a note the
 * commissioner can read next August beats silently losing the condition.
 */

// --- small primitives -------------------------------------------------------

function Select({
  value,
  onChange,
  children,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "border-border bg-card select-chevron h-10 w-full appearance-none rounded-lg border py-2.5 pr-9 pl-3.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 touch:h-11",
        className,
      )}
    >
      {children}
    </select>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground text-eyebrow text-[10px]">{children}</p>
  );
}

// --- player search ----------------------------------------------------------

type PlayerHit = {
  id: string;
  name: string;
  position: string;
  nflTeam: string | null;
  ledgerHolder: string | null;
};

/**
 * Search over the whole pool, annotated with who the ledger thinks holds each
 * player.
 *
 * The annotation is the point. Seeing "held by Zach" while entering a trade
 * Kyle is sending in catches the wrong player at the cheapest possible moment —
 * at selection, before the preview and nine months before the draft board.
 */
function PlayerSearch({
  onPick,
  onCancel,
}: {
  onPick: (hit: PlayerHit) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PlayerHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);

  const run = useCallback(async () => {
    if (!q.trim()) {
      setHits([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/trades/players?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (res.ok) {
        setHits(data.players ?? []);
        setActive(0);
      }
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(run, 180);
    return () => clearTimeout(t);
  }, [run]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        {loading && (
          <Loader2 className="text-muted-foreground absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
        )}
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, hits.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (hits[active]) onPick(hits[active]);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder="Name, nickname, or defense — misspellings are fine"
          className="pl-9 touch:h-11"
        />
      </div>
      {hits.length > 0 && (
        <ul className="border-border bg-card/40 max-h-56 divide-y divide-[var(--color-border)] overflow-y-auto rounded-lg border">
          {hits.map((h, i) => (
            <li key={h.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(h)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors max-md:py-3",
                  i === active ? "bg-primary/10" : "hover:bg-accent/50",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ring-1",
                    positionStyle(h.position),
                  )}
                >
                  {h.position}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
                {h.ledgerHolder && (
                  <span className="text-muted-foreground shrink-0 text-[11px]">
                    held by {h.ledgerHolder}
                  </span>
                )}
                {h.nflTeam && (
                  <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
                    {h.nflTeam}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={onCancel}
        className="text-muted-foreground hover:text-foreground inline-flex items-center text-xs underline-offset-4 hover:underline touch:min-h-11"
      >
        Cancel
      </button>
    </div>
  );
}

// --- the wizard -------------------------------------------------------------

type Participant = { teamId: string; shortName: string; franchiseName: string; manager: string };

export type TradeEntryProps = {
  season: number;
  participants: Participant[];
  picksByTeam: Record<string, PickOption[]>;
  rostersByTeam: Record<string, RosterOption[]>;
  tradableSeasons: number[];
  deadlineWeek: number;
  /** Today, `YYYY-MM-DD`, computed on the server so it matches the ledger's clock. */
  today: string;
};

type AddMode = null | "player" | "pick" | "faab";

let lineSeq = 0;
const nextKey = () => `line-${++lineSeq}`;

export function TradeEntry({
  season,
  participants,
  picksByTeam,
  rostersByTeam,
  tradableSeasons,
  deadlineWeek,
  today,
}: TradeEntryProps) {
  const [participantIds, setParticipantIds] = useState<string[]>(["", ""]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [notes, setNotes] = useState("");
  /**
   * Defaulted to today, because he is usually logging a trade the same day ESPN
   * approved it — but freely editable, because he will sometimes catch up on
   * several at once, and for a calculation that pays off in nine months a date
   * that is merely convenient is worse than useless.
   */
  const [tradedAt, setTradedAt] = useState(today);
  /**
   * The preview, tagged with the trade it described.
   *
   * Tagged rather than cleared by an effect because a preview is only
   * meaningful for the exact draft it was computed from, and the consequence
   * shown here is the thing being confirmed. Deriving staleness makes a stale
   * preview unrenderable by construction; clearing it on change would leave a
   * frame in which the old consequence is on screen next to the new trade.
   */
  const [preview, setPreview] = useState<{ signature: string; data: TradePreview } | null>(
    null,
  );
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<Record<string, AddMode>>({});
  const [faabAmount, setFaabAmount] = useState<Record<string, string>>({});

  const byId = useMemo(
    () => new Map(participants.map((p) => [p.teamId, p])),
    [participants],
  );
  const chosen = participantIds.filter(Boolean);
  const name = (id: string) => byId.get(id)?.shortName ?? "?";
  const multiParty = chosen.length > 2;

  /** Picks already spoken for in this trade, so none can be listed twice. */
  const usedPickRefs = useMemo(
    () => new Set(lines.filter((l) => l.asset.kind === "pick").map((l) => (l.asset as { ref: string }).ref)),
    [lines],
  );
  const usedPlayerIds = useMemo(
    () =>
      new Set(
        lines
          .filter((l) => l.asset.kind === "player")
          .map((l) => (l.asset as { playerId: string }).playerId),
      ),
    [lines],
  );

  /**
   * Identity of the trade currently on screen.
   *
   * The date is part of it for a reason: changing it changes the keeper outcome,
   * so a preview computed against the old date describes a different trade even
   * though every other field is identical.
   */
  const signature = JSON.stringify({ chosen, lines, notes, tradedAt });
  const activePreview = preview?.signature === signature ? preview.data : null;

  function setParticipant(index: number, teamId: string) {
    setParticipantIds((prev) => {
      const next = [...prev];
      next[index] = teamId;
      return next;
    });
    // A franchise leaving the trade takes its assets with it, rather than
    // leaving orphaned lines pointing at somebody who is no longer involved.
    const leaving = participantIds[index];
    if (leaving && leaving !== teamId) {
      setLines((prev) => prev.filter((l) => l.fromTeamId !== leaving && l.toTeamId !== leaving));
    }
  }

  function removeParticipant(index: number) {
    const leaving = participantIds[index];
    setParticipantIds((prev) => prev.filter((_, i) => i !== index));
    if (leaving) {
      setLines((prev) => prev.filter((l) => l.fromTeamId !== leaving && l.toTeamId !== leaving));
    }
  }

  /**
   * Who sends an asset to `toTeamId` when the UI has not asked.
   *
   * With two franchises there is exactly one answer and asking would be noise.
   * With three or more, a hint is used when it is unambiguous — the franchise
   * the ledger says holds the player — and otherwise the line is left incomplete
   * so the selector on it has to be answered.
   */
  function defaultFrom(toTeamId: string, hintTeamId?: string | null): string {
    const others = chosen.filter((id) => id !== toTeamId);
    if (others.length === 1) return others[0];
    if (hintTeamId && others.includes(hintTeamId)) return hintTeamId;
    return "";
  }

  function addLine(line: DraftLine) {
    setLines((prev) => [...prev, line]);
  }

  function removeLine(key: string) {
    setLines((prev) => prev.filter((l) => l.key !== key));
  }

  function setLineFrom(key: string, fromTeamId: string) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, fromTeamId } : l)));
  }

  async function runPreview() {
    setPreviewing(true);
    setError(null);
    try {
      const draft: TradeDraft = { season, tradedAt, participantIds: chosen, lines, notes };
      const res = await fetch("/api/trades/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Preview failed.");
      setPreview({ signature, data: data.preview as TradePreview });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPreviewing(false);
    }
  }

  async function commit() {
    setCommitting(true);
    setError(null);
    try {
      const draft: TradeDraft = { season, tradedAt, participantIds: chosen, lines, notes };
      const res = await fetch("/api/trades/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not log the trade.");
      setResult(data as CommitResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  async function reverse(tradeId: string) {
    setCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/trades/${tradeId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reverse" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not reverse the trade.");
      setResult(null);
      setPreview(null);
      setLines([]);
      setParticipantIds(["", ""]);
      setNotes("");
      setTradedAt(today);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(false);
    }
  }

  function reset() {
    setResult(null);
    setPreview(null);
    setLines([]);
    setParticipantIds(["", ""]);
    setNotes("");
    setTradedAt(today);
    setError(null);
  }

  // --- the applied state ---------------------------------------------------

  if (result) {
    return (
      <AppliedTrade
        result={result}
        onReverse={() => reverse(result.tradeId)}
        onAnother={reset}
        busy={committing}
        error={error}
      />
    );
  }

  const ready = chosen.length >= 2 && lines.length > 0;

  return (
    <div className="space-y-6">
      {/* ---------- 1. who was involved ---------- */}
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" /> Who traded
          </CardTitle>
          <p className="text-muted-foreground text-xs leading-relaxed">
            ESPN already approved this trade — you are recording what happened, not
            proposing it. Picks are tradable for {tradableSeasons.join(" and ")}.
            ESPN&rsquo;s deadline is week {deadlineWeek}; this app shows it and does
            not police it, so a late-logged trade still records.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/*
            THE DATE COMES FIRST because it is an input to the rules, not a
            timestamp. The keeper term is an acquisition season plus two keeper
            seasons, and whether the trade fell before the draft or during the
            season decides which season is which — so the same trade logged in
            November and in August gives the receiving franchise a different
            number of keeper years. Nacua is the standing proof: two records that
            disagree by a season, and no data to settle them with.

            The season is derived from it and never asked for separately.
          */}
          <div className="space-y-1.5">
            <Eyebrow>Date of the trade</Eyebrow>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative w-full sm:w-48">
                <CalendarDays className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <Input
                  type="date"
                  aria-label="Date the trade happened"
                  value={tradedAt}
                  onChange={(e) => setTradedAt(e.target.value)}
                  className="pl-9 touch:h-11"
                />
              </div>
              {tradedAt !== today && (
                <button
                  type="button"
                  onClick={() => setTradedAt(today)}
                  className="text-muted-foreground hover:text-foreground inline-flex items-center text-xs underline-offset-4 hover:underline touch:min-h-11"
                >
                  Back to today
                </button>
              )}
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Defaults to today. Back-date it if you are catching up &mdash; this
              decides how long a traded player can be kept, so an approximate date
              is worse than no feature at all. The season and whether it counts as
              in-season or pre-draft are worked out from it.
            </p>
          </div>

          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            {participantIds.map((id, i) => (
              <div key={i} className="space-y-1.5">
                <Eyebrow>{i < 2 ? `Franchise ${i + 1}` : `Franchise ${i + 1} (third party)`}</Eyebrow>
                <div className="flex gap-2">
                  <Select
                    aria-label={`Franchise ${i + 1}`}
                    value={id}
                    onChange={(v) => setParticipant(i, v)}
                  >
                    <option value="">Choose a franchise…</option>
                    {participants
                      .filter((p) => p.teamId === id || !chosen.includes(p.teamId))
                      .map((p) => (
                        <option key={p.teamId} value={p.teamId}>
                          {p.shortName} — {p.franchiseName}
                        </option>
                      ))}
                  </Select>
                  {i >= 2 && (
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Remove this franchise"
                      onClick={() => removeParticipant(i)}
                      className="touch:size-11"
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/*
            Deliberately understated. One three-team trade has happened in the
            league's history and they are legal, so this must exist — but every
            other trade is between two franchises and should not be made to look
            past this control on the way in.
          */}
          {participantIds.length < participants.length && (
            <button
              type="button"
              onClick={() => setParticipantIds((prev) => [...prev, ""])}
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs underline-offset-4 hover:underline touch:min-h-11"
            >
              <Plus className="h-3 w-3" /> Add a third franchise (rare)
            </button>
          )}
        </CardContent>
      </Card>

      {/* ---------- 2. what each side received ---------- */}
      {chosen.length >= 2 && (
        <div
          className={cn(
            "grid gap-4",
            chosen.length === 2 ? "lg:grid-cols-2" : "lg:grid-cols-3",
          )}
        >
          {chosen.map((teamId) => (
            <SideCard
              key={teamId}
              teamId={teamId}
              teamName={name(teamId)}
              franchiseName={byId.get(teamId)?.franchiseName ?? ""}
              lines={lines.filter((l) => l.toTeamId === teamId)}
              chosen={chosen}
              nameOf={name}
              multiParty={multiParty}
              picksByTeam={picksByTeam}
              rostersByTeam={rostersByTeam}
              usedPickRefs={usedPickRefs}
              usedPlayerIds={usedPlayerIds}
              addMode={addMode[teamId] ?? null}
              setAddMode={(m) => setAddMode((prev) => ({ ...prev, [teamId]: m }))}
              faabAmount={faabAmount[teamId] ?? ""}
              setFaabAmount={(v) => setFaabAmount((prev) => ({ ...prev, [teamId]: v }))}
              onAdd={addLine}
              onRemove={removeLine}
              onSetFrom={setLineFrom}
              defaultFrom={defaultFrom}
            />
          ))}
        </div>
      )}

      {/* ---------- 3. the note ---------- */}
      {chosen.length >= 2 && (
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="text-sm">Anything worth remembering</CardTitle>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Optional, and the only free-text field here. Write down anything the
              asset rows cannot carry — above all a{" "}
              <span className="text-foreground font-medium">condition</span>. The
              league has not ruled on whether conditional trades are allowed, so
              this app does not model them: record the condition in plain language,
              resolve it yourself, and log the outcome as a normal trade. Someone
              will read this next August.
            </p>
          </CardHeader>
          <CardContent>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Reverses to Scott the day before the 2027 draft unless Nacua is projected to miss six or more weeks. Scott holds the option to cancel."
              className="border-border bg-card focus-visible:border-ring focus-visible:ring-ring/50 w-full resize-y rounded-lg border px-3.5 py-2.5 text-sm outline-none focus-visible:ring-3"
            />
          </CardContent>
        </Card>
      )}

      {/* ---------- 4. the consequence ---------- */}
      {error && (
        <p className="border-destructive/40 text-destructive border-l-2 pl-3 text-sm">
          {error}
        </p>
      )}

      {ready && !activePreview && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runPreview} disabled={previewing} className="touch:h-11">
            {previewing ? <Loader2 className="animate-spin" /> : <ArrowRight />}
            Show me what this does
          </Button>
          <p className="text-muted-foreground text-xs">
            Nothing is written until you confirm the consequence.
          </p>
        </div>
      )}

      {activePreview && (
        <PreviewPanel
          preview={activePreview}
          onCommit={commit}
          onEdit={() => setPreview(null)}
          busy={committing}
        />
      )}
    </div>
  );
}

// --- one franchise's side ---------------------------------------------------

function SideCard({
  teamId,
  teamName,
  franchiseName,
  lines,
  chosen,
  nameOf,
  multiParty,
  picksByTeam,
  rostersByTeam,
  usedPickRefs,
  usedPlayerIds,
  addMode,
  setAddMode,
  faabAmount,
  setFaabAmount,
  onAdd,
  onRemove,
  onSetFrom,
  defaultFrom,
}: {
  teamId: string;
  teamName: string;
  franchiseName: string;
  lines: DraftLine[];
  chosen: string[];
  nameOf: (id: string) => string;
  multiParty: boolean;
  picksByTeam: Record<string, PickOption[]>;
  rostersByTeam: Record<string, RosterOption[]>;
  usedPickRefs: Set<string>;
  usedPlayerIds: Set<string>;
  addMode: AddMode;
  setAddMode: (m: AddMode) => void;
  faabAmount: string;
  setFaabAmount: (v: string) => void;
  onAdd: (line: DraftLine) => void;
  onRemove: (key: string) => void;
  onSetFrom: (key: string, fromTeamId: string) => void;
  defaultFrom: (toTeamId: string, hintTeamId?: string | null) => string;
}) {
  const others = chosen.filter((id) => id !== teamId);

  /**
   * Every pick the other franchises hold, grouped by holder.
   *
   * The grouping is what removes a control from the common case: a pick can only
   * be sent by whoever holds it, so choosing the pick chooses the sender. There
   * is no way to pair a pick with a franchise that does not own it.
   */
  const pickGroups = others
    .map((ownerId) => ({
      ownerId,
      ownerName: nameOf(ownerId),
      picks: (picksByTeam[ownerId] ?? []).filter((p) => !usedPickRefs.has(p.ref)),
    }))
    .filter((g) => g.picks.length > 0);

  const rosterGroups = others
    .map((ownerId) => ({
      ownerId,
      ownerName: nameOf(ownerId),
      players: (rostersByTeam[ownerId] ?? []).filter((p) => !usedPlayerIds.has(p.playerId)),
    }))
    .filter((g) => g.players.length > 0);

  const [pickChoice, setPickChoice] = useState("");
  const [rosterChoice, setRosterChoice] = useState("");

  function describe(line: DraftLine): { primary: string; secondary: string | null } {
    const asset = line.asset;
    switch (asset.kind) {
      case "pick": {
        const option = Object.values(picksByTeam)
          .flat()
          .find((p) => p.ref === asset.ref);
        if (!option) return { primary: asset.ref, secondary: null };
        return {
          primary: `${option.season} R${option.round}`,
          secondary: option.acquired
            ? `originally ${option.originalTeamShortName}'s`
            : `${option.originalTeamShortName}'s own`,
        };
      }
      case "player": {
        const known = Object.values(rostersByTeam)
          .flat()
          .find((p) => p.playerId === asset.playerId);
        return {
          primary: known?.name ?? line.label ?? asset.playerId,
          secondary: known?.clockLabel ?? null,
        };
      }
      case "faab":
        return { primary: `$${asset.amount} FAAB`, secondary: null };
    }
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-baseline gap-2 text-sm">
          <Badge variant="outline">{teamName}</Badge>
          <span className="text-muted-foreground truncate text-xs font-normal">
            received
          </span>
        </CardTitle>
        <p className="text-muted-foreground truncate text-xs">{franchiseName}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {lines.length === 0 && (
          <p className="text-muted-foreground text-xs">Nothing recorded yet.</p>
        )}

        <ul className="space-y-1.5">
          {lines.map((line) => {
            const d = describe(line);
            return (
              <li
                key={line.key}
                className="border-border bg-card/50 flex items-center gap-2 rounded-md border px-2.5 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{d.primary}</span>
                  {d.secondary && (
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {d.secondary}
                    </span>
                  )}
                </span>
                {multiParty ? (
                  <Select
                    aria-label="From which franchise"
                    value={line.fromTeamId}
                    onChange={(v) => onSetFrom(line.key, v)}
                    className={cn(
                      "h-7 w-28 shrink-0 py-0 pr-7 pl-2 text-xs touch:h-11",
                      !line.fromTeamId && "border-destructive",
                    )}
                  >
                    <option value="">from…</option>
                    {others.map((o) => (
                      <option key={o} value={o}>
                        {nameOf(o)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <span className="text-muted-foreground shrink-0 text-xs">
                    from {nameOf(line.fromTeamId)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove"
                  onClick={() => onRemove(line.key)}
                  className="touch:size-11"
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>

        {addMode === null && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddMode("player")}
              className="touch:h-11 max-md:px-4"
            >
              <Plus /> Player
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddMode("pick")}
              disabled={pickGroups.length === 0}
              className="touch:h-11 max-md:px-4"
            >
              <Plus /> Pick
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddMode("faab")}
              className="touch:h-11 max-md:px-4"
            >
              <Plus /> FAAB
            </Button>
          </div>
        )}

        {addMode === "pick" && (
          <div className="space-y-2">
            <Eyebrow>Picks these franchises hold right now</Eyebrow>
            <Select
              aria-label="Pick received"
              value={pickChoice}
              onChange={(ref) => {
                setPickChoice("");
                const group = pickGroups.find((g) => g.picks.some((p) => p.ref === ref));
                if (!group) return;
                onAdd({
                  key: nextKey(),
                  // The holder sends it. Not a choice, and not derivable wrongly.
                  fromTeamId: group.ownerId,
                  toTeamId: teamId,
                  asset: { kind: "pick", ref },
                });
                setAddMode(null);
              }}
            >
              <option value="">Choose a pick…</option>
              {pickGroups.map((g) => (
                <optgroup key={g.ownerId} label={`${g.ownerName} holds`}>
                  {g.picks.map((p) => (
                    <option key={p.ref} value={p.ref}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Only picks the sending franchise currently owns are listed, so a pick
              already traded away cannot be offered twice.
            </p>
            <CancelAdd onCancel={() => setAddMode(null)} />
          </div>
        )}

        {addMode === "player" && (
          <div className="space-y-3">
            {rosterGroups.length > 0 && (
              <div className="space-y-1.5">
                <Eyebrow>On these rosters, per the ledger</Eyebrow>
                <Select
                  aria-label="Player from a roster"
                  value={rosterChoice}
                  onChange={(playerId) => {
                    setRosterChoice("");
                    const group = rosterGroups.find((g) =>
                      g.players.some((p) => p.playerId === playerId),
                    );
                    if (!group) return;
                    onAdd({
                      key: nextKey(),
                      fromTeamId: group.ownerId,
                      toTeamId: teamId,
                      asset: { kind: "player", playerId },
                    });
                    setAddMode(null);
                  }}
                >
                  <option value="">Choose from a roster…</option>
                  {rosterGroups.map((g) => (
                    <optgroup key={g.ownerId} label={`${g.ownerName}'s roster`}>
                      {g.players.map((p) => (
                        <option key={p.playerId} value={p.playerId}>
                          {p.name} ({p.position})
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Eyebrow>Or search the whole pool</Eyebrow>
              <PlayerSearch
                onPick={(hit) => {
                  onAdd({
                    key: nextKey(),
                    fromTeamId: defaultFrom(
                      teamId,
                      others.find((o) => nameOf(o) === hit.ledgerHolder) ?? null,
                    ),
                    toTeamId: teamId,
                    asset: { kind: "player", playerId: hit.id },
                    label: hit.name,
                  });
                  setAddMode(null);
                }}
                onCancel={() => setAddMode(null)}
              />
            </div>
          </div>
        )}

        {addMode === "faab" && (
          <div className="space-y-2">
            <Eyebrow>Dollars received</Eyebrow>
            <div className="flex gap-2">
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={faabAmount}
                onChange={(e) => setFaabAmount(e.target.value)}
                placeholder="20"
                className="h-9 touch:h-11"
              />
              {multiParty && (
                <Select
                  aria-label="From which franchise"
                  value=""
                  onChange={(from) => {
                    const amount = Number(faabAmount);
                    if (!Number.isInteger(amount) || amount <= 0) return;
                    onAdd({
                      key: nextKey(),
                      fromTeamId: from,
                      toTeamId: teamId,
                      asset: { kind: "faab", amount },
                    });
                    setFaabAmount("");
                    setAddMode(null);
                  }}
                  className="h-9 w-32 shrink-0 touch:h-11"
                >
                  <option value="">from…</option>
                  {others.map((o) => (
                    <option key={o} value={o}>
                      {nameOf(o)}
                    </option>
                  ))}
                </Select>
              )}
              {!multiParty && (
                <Button
                  size="sm"
                  className="h-9 touch:h-11 max-md:px-4"
                  onClick={() => {
                    const amount = Number(faabAmount);
                    if (!Number.isInteger(amount) || amount <= 0) return;
                    onAdd({
                      key: nextKey(),
                      fromTeamId: defaultFrom(teamId),
                      toTeamId: teamId,
                      asset: { kind: "faab", amount },
                    });
                    setFaabAmount("");
                    setAddMode(null);
                  }}
                >
                  Add
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px] leading-relaxed">
              Recorded as a line item only. ESPN owns the budget — this app never
              computes a balance.
            </p>
            <CancelAdd onCancel={() => setAddMode(null)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CancelAdd({ onCancel }: { onCancel: () => void }) {
  return (
    <button
      type="button"
      onClick={onCancel}
      className="text-muted-foreground hover:text-foreground inline-flex items-center text-xs underline-offset-4 hover:underline touch:min-h-11"
    >
      Cancel
    </button>
  );
}

// --- the consequence --------------------------------------------------------

/**
 * What the trade does, stated as outcomes.
 *
 * This is the error-catching step, and the reason it echoes back consequences
 * rather than the form: "Zach now holds Kyle's 2027 round 6, and Ladd McConkey's
 * clock resets to year 1 of 2" reads wrong to a human far more reliably than a
 * correctly-filled-in form does.
 */
function PreviewPanel({
  preview,
  onCommit,
  onEdit,
  busy,
}: {
  preview: TradePreview;
  onCommit: () => void;
  onEdit: () => void;
  busy: boolean;
}) {
  const blocked = preview.blockers.length > 0;

  return (
    <Card className={blocked ? "ring-destructive/40" : "border-primary/25"}>
      <CardHeader className="border-b">
        <CardTitle className="text-sm">
          {blocked ? "This trade cannot be recorded yet" : "What this trade will do"}
        </CardTitle>
        {!blocked && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Read this rather than the form above. Recorded as{" "}
            <span className="text-foreground font-medium">{preview.timingLabel}</span>,
            derived from the date you gave. Confirming applies it to the ledger
            immediately &mdash; and it stays reversible.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {blocked && (
          <ul className="space-y-2">
            {preview.blockers.map((b, i) => (
              <li key={i} className="text-destructive flex gap-2 text-sm">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        )}

        {preview.warnings.length > 0 && (
          <div className="space-y-2">
            <Eyebrow>Worth a second look</Eyebrow>
            <ul className="space-y-2">
              {preview.warnings.map((w, i) => (
                <li key={i} className="text-muted-foreground flex gap-2 text-sm leading-relaxed">
                  <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!blocked && (
          <>
            {preview.summaryByTeam.length > 0 && (
              <div className="space-y-2">
                <Eyebrow>In plain terms</Eyebrow>
                <ul className="space-y-1.5 text-sm">
                  {preview.summaryByTeam.map((t) => (
                    <li key={t.teamId} className="leading-relaxed">
                      <span className="font-medium">{t.shortName}</span> gets{" "}
                      {t.receives.length ? t.receives.join(", ") : "nothing"}
                      {t.sends.length ? `, and gives up ${t.sends.join(", ")}` : ""}.
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.pickMoves.length > 0 && (
              <div className="space-y-2">
                <Eyebrow>Where the picks land</Eyebrow>
                <ul className="space-y-2">
                  {preview.pickMoves.map((p) => (
                    <li key={p.ref} className="text-sm leading-relaxed">
                      <span className="font-medium">
                        {p.pickSeason} R{p.round}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        (originally {p.originalTeamShortName}&rsquo;s)
                      </span>{" "}
                      moves {p.fromShortName} <ArrowRight className="inline h-3 w-3" />{" "}
                      {p.toShortName}
                      {p.hop > 1 && (
                        <Badge variant="secondary" className="ml-2">
                          hop {p.hop}
                        </Badge>
                      )}
                      <span className="text-muted-foreground block text-xs">
                        {p.boardNote}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.playerMoves.length > 0 && (
              <div className="space-y-2">
                <Eyebrow>What it does to the keeper clocks</Eyebrow>
                <ul className="space-y-3">
                  {preview.playerMoves.map((p) => (
                    <li key={p.playerId} className="text-sm leading-relaxed">
                      <span className="font-medium">{p.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {p.fromShortName} <ArrowRight className="inline h-3 w-3" />{" "}
                        {p.toShortName}
                      </span>
                      {/*
                        The terminal season, stated outright. This is what the
                        date buys, and it is the number a wrong date shows up in
                        — the only place anyone will catch it before the board
                        does, nine months from now.
                      */}
                      <span className="block text-xs">
                        <span className="text-primary font-semibold">
                          Keepable by {p.toShortName} through {p.lastKeeperSeason}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          ({p.firstKeeperSeason}
                          {p.lastKeeperSeason !== p.firstKeeperSeason &&
                            `–${p.lastKeeperSeason}`}
                          )
                        </span>
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {p.clockBeforeLabel === p.clockAfterLabel
                          ? p.clockAfterLabel
                          : `${p.clockBeforeLabel} → ${p.clockAfterLabel} (a trade restarts the clock)`}
                        . {p.timingSummary} {p.costNote}
                      </span>
                      {p.timingDisputeNote && (
                        <span className="text-muted-foreground border-border mt-1 flex gap-2 border-l-2 pl-2.5 text-xs leading-relaxed">
                          <Scale className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{p.timingDisputeNote}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.faabMoves.length > 0 && (
              <div className="space-y-2">
                <Eyebrow>FAAB</Eyebrow>
                <ul className="space-y-1 text-sm">
                  {preview.faabMoves.map((f, i) => (
                    <li key={i}>
                      <span className="font-medium">${f.amount}</span> moves{" "}
                      {f.fromShortName} <ArrowRight className="inline h-3 w-3" />{" "}
                      {f.toShortName}
                      <span className="text-muted-foreground text-xs">
                        {" "}
                        — recorded only; ESPN owns the budget.
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {preview.pickCounts.map((group) => (
              <div key={group.pickSeason} className="space-y-2">
                <Eyebrow>{group.pickSeason} pick counts after this</Eyebrow>
                <ul className="space-y-1 text-sm">
                  {group.rows.map((r) => (
                    <li key={r.teamId} className="font-mono text-xs">
                      {r.shortName}: {r.before} → {r.after}{" "}
                      <span className={r.delta > 0 ? "text-primary" : "text-destructive"}>
                        ({r.delta > 0 ? `+${r.delta}` : r.delta})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}

        <div className="flex flex-wrap gap-3 border-t pt-4">
          {!blocked && (
            <Button onClick={onCommit} disabled={busy} className="touch:h-11">
              {busy ? <Loader2 className="animate-spin" /> : <Check />}
              Yes — log this trade
            </Button>
          )}
          <Button variant="outline" onClick={onEdit} disabled={busy} className="touch:h-11">
            Go back and change it
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function AppliedTrade({
  result,
  onReverse,
  onAnother,
  busy,
  error,
}: {
  result: CommitResult;
  onReverse: () => void;
  onAnother: () => void;
  busy: boolean;
  error: string | null;
}) {
  const p = result.applied;
  return (
    <Card className="border-primary/25">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Check className="text-primary h-4 w-4" /> Recorded and applied to the ledger
        </CardTitle>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Recorded as {p.timingLabel}. The {p.season} ledger now reflects it, and
          next year&rsquo;s board will draw from it.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="space-y-1.5 text-sm">
          {p.summaryByTeam.map((t) => (
            <li key={t.teamId} className="leading-relaxed">
              <span className="font-medium">{t.shortName}</span> got{" "}
              {t.receives.length ? t.receives.join(", ") : "nothing"}.
            </li>
          ))}
        </ul>

        {p.playerMoves.length > 0 && (
          <div className="space-y-1.5">
            <Eyebrow>Keeper clocks now</Eyebrow>
            {p.playerMoves.map((m) => (
              <p key={m.playerId} className="text-muted-foreground text-xs leading-relaxed">
                <span className="text-foreground font-medium">{m.name}</span> is with{" "}
                {m.toShortName} at {m.clockAfterLabel}, keepable through{" "}
                <span className="text-foreground font-medium">{m.lastKeeperSeason}</span>.{" "}
                {m.costNote}
              </p>
            ))}
          </div>
        )}

        {error && (
          <p className="border-destructive/40 text-destructive border-l-2 pl-3 text-sm">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-3 border-t pt-4">
          <Button onClick={onAnother} variant="outline" className="touch:h-11">
            Log another trade
          </Button>
          {/*
            Surfaced right here, on purpose. A mis-logged trade recorded in
            November must be fixable in November, and the moment the commissioner
            is most likely to spot a mistake is the moment he has just read the
            consequence. A reversal genuinely un-applies: pick ownership returns,
            the movement rows are deleted, and keeper clocks are restored to what
            they were.
          */}
          <Button
            variant="destructive"
            onClick={onReverse}
            disabled={busy}
            className="touch:h-11"
          >
            {busy ? <Loader2 className="animate-spin" /> : <Undo2 />}
            That&rsquo;s wrong — reverse it
          </Button>
          <Link
            href="/trades"
            className="text-muted-foreground hover:text-foreground inline-flex items-center self-center text-xs underline-offset-4 hover:underline touch:min-h-11"
          >
            Back to the trade tracker
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

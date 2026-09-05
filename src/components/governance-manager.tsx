"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Gavel,
  Lock,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MOTION_PRESETS, THRESHOLD_LABELS } from "@/lib/governance-rules";
import type { GovernanceView, MotionView } from "@/lib/governance";
import type {
  MotionStatus,
  MotionThreshold,
  OfficerRole,
  VoteChoice,
} from "@/lib/supabase/types";

const STATUS_STYLE: Record<MotionStatus, string> = {
  proposed: "bg-muted text-muted-foreground",
  seconded: "bg-info/15 text-info",
  discussion: "bg-warning/15 text-warning",
  voting: "bg-primary/20 text-primary",
  ratified: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  withdrawn: "bg-muted text-muted-foreground line-through",
};

export function GovernanceManager({
  initial,
  season,
}: {
  initial: GovernanceView;
  season: number;
}) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);

  /*
   * `call` sets the view from its own response so a vote lands instantly, and
   * then `router.refresh()` re-runs the server component, which hands down a
   * fresh `initial` — the server, not the response, is the record. Adopted
   * during render rather than in an effect: React's documented shape for
   * "reset state when a prop changes" is to compare against the last prop
   * seen, and it means the page never paints a frame of governance the server
   * has already superseded.
   */
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setView(initial);
  }

  async function call(url: string, method: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      if (data.governance) setView(data.governance as GovernanceView);
      router.refresh();
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {view.ruleFrozen && (
        <div className="border-warning/40 bg-warning/10 text-warning flex items-center gap-2 rounded-xl border px-4 py-3 text-sm">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            <strong>Rules frozen.</strong> The {season} draft has begun — the rules and the
            Sleeper league settings are locked for the season. Amendments resume in the
            offseason window.
          </span>
        </div>
      )}

      <OfficersCard view={view} busy={busy} call={call} season={season} />
      <MotionsCard view={view} busy={busy} call={call} season={season} />
      <ThresholdsCard />
      <AuditCard view={view} busy={busy} call={call} season={season} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Officers
// ---------------------------------------------------------------------------

function OfficersCard({
  view,
  busy,
  call,
  season,
}: {
  view: GovernanceView;
  busy: boolean;
  call: (url: string, method: string, body?: unknown) => Promise<unknown>;
  season: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="text-primary h-4 w-4" /> Officers
        </CardTitle>
        <CardDescription>
          Service roles (Article XI §11.1). Officers get no extra voting power — one franchise,
          one vote. Assignments are set by league vote.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {view.officers.map((o) => (
          <OfficerSlot
            /*
             * Keyed on the ASSIGNMENT, not just the role, so a slot whose
             * saved holder changes is a new component with fresh fields. That
             * is the whole reset: the alternative is an effect that overwrites
             * what is typed in the boxes, and an effect that writes state on
             * every render of a ten-slot grid.
             */
            key={`${o.role}:${o.teamId ?? ""}:${o.manager ?? ""}`}
            role={o.role}
            label={o.label}
            responsibilities={o.responsibilities}
            teamId={o.teamId}
            manager={o.manager}
            teams={view.teams}
            busy={busy}
            onSave={(teamId, manager) =>
              call("/api/governance/officer", "POST", { season, role: o.role, teamId, manager })
            }
            onClear={() =>
              call("/api/governance/officer", "POST", {
                season,
                role: o.role,
                teamId: null,
                manager: null,
              })
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

function OfficerSlot({
  label,
  responsibilities,
  teamId,
  manager,
  teams,
  busy,
  onSave,
  onClear,
}: {
  role: OfficerRole;
  label: string;
  responsibilities: string;
  teamId: string | null;
  manager: string | null;
  teams: { id: string; name: string }[];
  busy: boolean;
  onSave: (teamId: string | null, manager: string | null) => void;
  onClear: () => void;
}) {
  // Reset by remounting on a new assignment — see the `key` in `OfficersCard`.
  const [team, setTeam] = useState(teamId ?? "");
  const [mgr, setMgr] = useState(manager ?? "");

  const dirty = team !== (teamId ?? "") || mgr !== (manager ?? "");

  return (
    <div className="border-border/60 rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold">{label}</p>
        {teamId && (
          <button
            type="button"
            onClick={onClear}
            disabled={busy}
            className="text-muted-foreground hover:text-destructive inline-flex items-center justify-center text-xs touch:min-h-11 touch:min-w-11 touch:px-2"
          >
            Vacate
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-3 mt-0.5 text-xs leading-snug">{responsibilities}</p>
      {/* Stacked on a phone: side by side, the manager field and the save button
          were squeezed onto a second line at half a thumb's height each. */}
      <div className="flex flex-wrap items-center gap-2 max-md:flex-col max-md:items-stretch">
        {/* `flex-1` governs height once the row stacks, which capped the select
            below the 44px its own class asks for. */}
        <Select value={team} onChange={setTeam} className="min-w-[10rem] flex-1 max-md:flex-none">
          <option value="">— Unassigned —</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <Input
          value={mgr}
          onChange={(e) => setMgr(e.target.value)}
          placeholder="Manager"
          className="h-9 w-28 touch:h-11 max-md:w-full"
        />
        <Button
          size="sm"
          variant={dirty ? "default" : "secondary"}
          disabled={busy || !dirty}
          onClick={() => onSave(team || null, mgr || null)}
          className="touch:h-11 max-md:self-end max-md:px-6"
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Motions
// ---------------------------------------------------------------------------

function MotionsCard({
  view,
  busy,
  call,
  season,
}: {
  view: GovernanceView;
  busy: boolean;
  call: (url: string, method: string, body?: unknown) => Promise<unknown>;
  season: number;
}) {
  const [presetIdx, setPresetIdx] = useState(0);
  const [title, setTitle] = useState("");
  const [proposer, setProposer] = useState("");
  const [docs, setDocs] = useState("");
  const [threshold, setThreshold] = useState<MotionThreshold>(MOTION_PRESETS[0].threshold);

  function onPreset(idx: number) {
    setPresetIdx(idx);
    setThreshold(MOTION_PRESETS[idx].threshold);
  }

  async function submit() {
    const type = title.trim() || MOTION_PRESETS[presetIdx].type;
    await call("/api/governance/motion", "POST", {
      season,
      type,
      threshold,
      proposerTeam: proposer || null,
      documentation: docs || null,
    });
    setTitle("");
    setDocs("");
    setProposer("");
    toast.success("Motion proposed.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="text-primary h-4 w-4" /> Motions
        </CardTitle>
        <CardDescription>
          The formal process: propose → second → discuss → vote → ratify (Article XI §11.5).
          Nothing is league law until ratified and documented.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* New motion */}
        <div className="border-border/60 bg-card/40 grid gap-3 rounded-xl border p-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-muted-foreground text-eyebrow text-[10px]">Category</span>
            <Select value={String(presetIdx)} onChange={(v) => onPreset(Number(v))}>
              {MOTION_PRESETS.map((p, i) => (
                <option key={p.type} value={i}>
                  {p.type}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-eyebrow text-[10px]">Threshold</span>
            <Select value={threshold} onChange={(v) => setThreshold(v as MotionThreshold)}>
              {Object.entries(THRESHOLD_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className="text-muted-foreground text-eyebrow text-[10px]">Title</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={MOTION_PRESETS[presetIdx].type + " — " + MOTION_PRESETS[presetIdx].examples}
              className="touch:h-11"
            />
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-eyebrow text-[10px]">Proposer</span>
            <Select value={proposer} onChange={setProposer}>
              <option value="">— Select team —</option>
              {view.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1">
            <span className="text-muted-foreground text-eyebrow text-[10px]">
              Proposed language / reason
            </span>
            <Input
              value={docs}
              onChange={(e) => setDocs(e.target.value)}
              placeholder="What changes, and why"
              className="touch:h-11"
            />
          </label>
          <div className="sm:col-span-2">
            <Button onClick={submit} disabled={busy} className="touch:h-11">
              <Plus className="h-4 w-4" /> Propose motion
            </Button>
          </div>
        </div>

        {/* Motion list */}
        {view.motions.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center text-sm">
            No motions yet. Propose one above.
          </p>
        ) : (
          <div className="space-y-3">
            {view.motions.map((m) => (
              <MotionRow
                key={m.id}
                motion={m}
                teams={view.teams}
                busy={busy}
                call={call}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MotionRow({
  motion,
  teams,
  busy,
  call,
}: {
  motion: MotionView;
  teams: { id: string; name: string }[];
  busy: boolean;
  call: (url: string, method: string, body?: unknown) => Promise<unknown>;
}) {
  const [seconder, setSeconder] = useState("");
  const m = motion;
  const patch = (body: Record<string, unknown>) =>
    call("/api/governance/motion", "PATCH", { motionId: m.id, ...body });

  const total = m.tally.for + m.tally.against + m.tally.abstain;

  return (
    <div className="border-border/60 rounded-xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                STATUS_STYLE[m.status],
              )}
            >
              {m.status}
            </span>
            <span className="font-medium">{m.type}</span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {m.thresholdLabel} · needs {m.required} of {m.denominator}
            {m.proposerName ? ` · proposed by ${m.proposerName}` : ""}
            {m.secondedByName ? ` · seconded by ${m.secondedByName}` : ""}
          </p>
          {m.documentation && (
            <p className="text-foreground/80 mt-1 text-sm">{m.documentation}</p>
          )}
        </div>
        {!m.decided && (
          <button
            type="button"
            onClick={() =>
              call(`/api/governance/motion?id=${m.id}`, "DELETE").catch(() => {})
            }
            disabled={busy}
            title="Delete motion"
            className="text-muted-foreground hover:text-destructive inline-flex shrink-0 items-center justify-center touch:size-11"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Voting tally */}
      {(m.status === "voting" || m.decided) && m.threshold !== "commissioner_ruling" && (
        <div className="mt-3">
          <div className="bg-muted flex h-2 w-full overflow-hidden rounded-full">
            <div
              className="bg-success"
              style={{ width: `${total ? (m.tally.for / total) * 100 : 0}%` }}
            />
            <div
              className="bg-destructive"
              style={{ width: `${total ? (m.tally.against / total) * 100 : 0}%` }}
            />
            <div
              className="bg-muted-foreground/40"
              style={{ width: `${total ? (m.tally.abstain / total) * 100 : 0}%` }}
            />
          </div>
          <p className="text-muted-foreground mt-1 text-xs">
            <span className="text-success">{m.tally.for} for</span> ·{" "}
            <span className="text-destructive">{m.tally.against} against</span> ·{" "}
            {m.tally.abstain} abstain
            {m.meetsThreshold && (
              <span className="text-primary ml-1 font-semibold">· threshold met</span>
            )}
          </p>
        </div>
      )}

      {/* Per-team vote grid while voting */}
      {m.status === "voting" && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {teams.map((t) => {
            const choice = m.votesByTeam.find((v) => v.teamId === t.id)?.choice ?? null;
            return (
              <div
                key={t.id}
                className="border-border/40 flex items-center gap-2 rounded-lg border px-2 py-1"
              >
                <span className="min-w-0 flex-1 truncate text-xs">{t.name}</span>
                <VoteButtons
                  value={choice}
                  busy={busy}
                  onVote={(choice) =>
                    call("/api/governance/vote", "POST", {
                      motionId: m.id,
                      teamId: t.id,
                      choice,
                    })
                  }
                />
              </div>
            );
          })}
        </div>
      )}

      {/* Lifecycle controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {m.status === "proposed" && (
          <>
            <Select value={seconder} onChange={setSeconder} className="h-8 w-40 touch:h-11">
              <option value="">Record second…</option>
              {teams
                .filter((t) => t.id !== m.proposerTeamId)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </Select>
            <Button
              size="sm"
              disabled={busy || !seconder}
              onClick={() => patch({ status: "seconded", secondedByTeam: seconder })}
              className="touch:h-11 max-md:px-4"
            >
              Second
            </Button>
          </>
        )}
        {m.status === "seconded" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => patch({ status: "discussion" })}
            className="touch:h-11 max-md:px-4"
          >
            Open discussion
          </Button>
        )}
        {m.status === "discussion" && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => patch({ status: "voting" })}
            className="touch:h-11 max-md:px-4"
          >
            Move to vote
          </Button>
        )}
        {m.status === "voting" && (
          <>
            <Button
              size="sm"
              disabled={busy || !m.meetsThreshold}
              onClick={() => patch({ status: "ratified" })}
              className="touch:h-11 max-md:px-4"
            >
              <Check className="h-4 w-4" /> Ratify
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => patch({ status: "rejected" })}
              className="touch:h-11 max-md:px-4"
            >
              <X className="h-4 w-4" /> Reject
            </Button>
          </>
        )}
        {!m.decided && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => patch({ status: "withdrawn" })}
            className="touch:h-11 max-md:px-4"
          >
            Withdraw
          </Button>
        )}
        {m.status === "ratified" && m.effectiveDate && (
          <span className="text-success text-xs">
            Ratified · effective {m.effectiveDate}
          </span>
        )}
        {m.status === "rejected" && (
          <span className="text-destructive text-xs">Rejected</span>
        )}
      </div>
    </div>
  );
}

function VoteButtons({
  value,
  busy,
  onVote,
}: {
  value: VoteChoice | null;
  busy: boolean;
  onVote: (c: VoteChoice) => void;
}) {
  const opts: { c: VoteChoice; label: string; on: string }[] = [
    { c: "for", label: "For", on: "bg-success/20 text-success border-success/40" },
    { c: "against", label: "Ag", on: "bg-destructive/20 text-destructive border-destructive/40" },
    { c: "abstain", label: "Ab", on: "bg-muted text-foreground border-border" },
  ];
  return (
    <div className="flex gap-1">
      {opts.map((o) => (
        <button
          key={o.c}
          type="button"
          disabled={busy}
          onClick={() => onVote(o.c)}
          className={cn(
            "inline-flex items-center justify-center rounded border px-1.5 py-0.5 text-[10px] font-semibold transition-colors touch:min-h-11 touch:min-w-11",
            value === o.c
              ? o.on
              : "border-border/50 text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thresholds reference
// ---------------------------------------------------------------------------

function ThresholdsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="text-primary h-4 w-4" /> Voting thresholds
        </CardTitle>
        <CardDescription>Approval standards per decision type (Article XI §11.4).</CardDescription>
      </CardHeader>
      <CardContent>
        {/* The rows stack on a phone. The threshold label is `shrink-0` and
            claims over half a 375px row, which left the examples line 79px and
            spilling out of the card. */}
        <ul className="divide-border divide-y">
          {MOTION_PRESETS.map((p) => (
            <li
              key={p.type}
              className="flex items-start justify-between gap-3 py-2 text-sm max-md:flex-col max-md:gap-1"
            >
              <div className="min-w-0">
                <p className="font-medium">{p.type}</p>
                <p className="text-muted-foreground text-xs">{p.examples}</p>
              </div>
              <span className="text-primary shrink-0 text-xs font-semibold">
                {THRESHOLD_LABELS[p.threshold]}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Audit log / commissioner actions
// ---------------------------------------------------------------------------

function AuditCard({
  view,
  busy,
  call,
  season,
}: {
  view: GovernanceView;
  busy: boolean;
  call: (url: string, method: string, body?: unknown) => Promise<unknown>;
  season: number;
}) {
  const [type, setType] = useState("Emergency Platform Fix");
  const [desc, setDesc] = useState("");
  const [disclosure, setDisclosure] = useState("");

  async function submit() {
    if (!desc.trim() && !type.trim()) return;
    await call("/api/governance/action", "POST", {
      season,
      type,
      description: desc || null,
      disclosureNote: disclosure || null,
    });
    setDesc("");
    setDisclosure("");
    toast.success("Logged to the audit trail.");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="text-primary h-4 w-4" /> Commissioner actions & audit log
        </CardTitle>
        <CardDescription>
          Emergency platform fixes are commissioner rulings followed by disclosure (§11.4).
          Ratified motions are logged here automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="border-border/60 bg-card/40 grid gap-2 rounded-xl border p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="Action type"
            className="touch:h-11"
          />
          <Input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="What was done"
            className="touch:h-11"
          />
          <Button onClick={submit} disabled={busy} className="touch:h-11">
            <Plus className="h-4 w-4" /> Log
          </Button>
          <Input
            value={disclosure}
            onChange={(e) => setDisclosure(e.target.value)}
            placeholder="Disclosure note (optional)"
            className="touch:h-11 sm:col-span-3"
          />
        </div>

        {view.actions.length === 0 ? (
          <p className="text-muted-foreground py-2 text-center text-sm">No actions logged.</p>
        ) : (
          <ul className="space-y-2">
            {view.actions.map((a) => (
              <li
                key={a.id}
                className="border-border/50 flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{a.type}</p>
                  {a.description && (
                    <p className="text-muted-foreground text-xs">{a.description}</p>
                  )}
                  {a.disclosureNote && (
                    <p className="text-warning/80 mt-0.5 text-xs">Disclosure: {a.disclosureNote}</p>
                  )}
                  <p className="text-muted-foreground/60 mt-0.5 text-[10px]">
                    {new Date(a.createdAt).toLocaleString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => call(`/api/governance/action?id=${a.id}`, "DELETE").catch(() => {})}
                  disabled={busy}
                  className="text-muted-foreground hover:text-destructive inline-flex shrink-0 items-center justify-center touch:size-11"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Small styled native select
// ---------------------------------------------------------------------------

function Select({
  value,
  onChange,
  children,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        // Matches the Input primitive, plus a drawn chevron in place of the
        // platform arrow so the control does not read as a foreign widget.
        "border-border bg-card select-chevron h-10 w-full appearance-none rounded-lg border py-2.5 pr-9 pl-3.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 touch:h-11",
        className,
      )}
    >
      {children}
    </select>
  );
}

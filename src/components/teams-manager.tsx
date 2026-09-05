"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LEAGUE } from "@/lib/league-config";

export type TeamRow = {
  id: string;
  /** Smart Draft handle — "Greg". The key everything joins on. */
  short_name: string;
  /** Real ESPN franchise name — "Jimmy's Johnson". */
  franchise_name: string;
  /** The human — "Greg Blome". */
  manager: string;
  draft_slot: number | null;
};

const blankDraft = { shortName: "", franchiseName: "", manager: "", draftSlot: "" };

export function TeamsManager({ teams }: { teams: TeamRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(blankDraft);

  function startAdd() {
    setEditingId(null);
    setDraft(blankDraft);
    setAdding(true);
  }

  function startEdit(t: TeamRow) {
    setAdding(false);
    setEditingId(t.id);
    setDraft({
      shortName: t.short_name,
      franchiseName: t.franchise_name,
      manager: t.manager,
      draftSlot: t.draft_slot != null ? String(t.draft_slot) : "",
    });
  }

  function cancel() {
    setAdding(false);
    setEditingId(null);
    setDraft(blankDraft);
  }

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shortName: draft.shortName,
          franchiseName: draft.franchiseName,
          manager: draft.manager,
          draftSlot: draft.draftSlot ? Number(draft.draftSlot) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Create failed");
      toast.success(`Added ${data.team.franchise_name}.`);
      cancel();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function save(id: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/teams", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          shortName: draft.shortName,
          franchiseName: draft.franchiseName,
          manager: draft.manager,
          draftSlot: draft.draftSlot ? Number(draft.draftSlot) : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      toast.success("Saved.");
      cancel();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(t: TeamRow) {
    if (!confirm(`Delete ${t.franchise_name}? This can't be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/teams?id=${t.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Delete failed");
      toast.info(`Deleted ${t.franchise_name}.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {teams.length} of {LEAGUE.teams} franchises
        </p>
        {!adding && (
          <Button size="sm" onClick={startAdd} disabled={busy} className="touch:h-11 max-md:px-4">
            <Plus className="h-4 w-4" /> Add franchise
          </Button>
        )}
      </div>

      {/*
        The one table here that keeps its columns and scrolls on a phone: it is a
        grid of editable fields, so collapsing it would mean two layouts of the
        same four inputs. The slot column is pinned instead, which is what tells
        you whose row you are editing once the actions are scrolled into view.
      */}
      <div className="border-border overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="bg-card w-16 max-md:sticky max-md:left-0 max-md:z-20 max-md:w-12 max-md:px-2">
                Slot
              </TableHead>
              <TableHead className="w-28">Handle</TableHead>
              <TableHead>Franchise</TableHead>
              <TableHead>Manager</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {adding && (
              <TableRow>
                <TableCell className="bg-card max-md:sticky max-md:left-0 max-md:z-10 max-md:px-2">
                  <Input
                    value={draft.draftSlot}
                    onChange={(e) => setDraft({ ...draft, draftSlot: e.target.value })}
                    placeholder="#"
                    inputMode="numeric"
                    className="h-8 w-14 touch:h-11 max-md:w-10 max-md:px-2"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={draft.shortName}
                    onChange={(e) => setDraft({ ...draft, shortName: e.target.value })}
                    placeholder="Greg"
                    className="h-8 touch:h-11"
                    autoFocus
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={draft.franchiseName}
                    onChange={(e) => setDraft({ ...draft, franchiseName: e.target.value })}
                    placeholder="Franchise name"
                    className="h-8 touch:h-11"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={draft.manager}
                    onChange={(e) => setDraft({ ...draft, manager: e.target.value })}
                    placeholder="Manager"
                    className="h-8 touch:h-11"
                  />
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={create}
                      disabled={busy}
                      className="touch:size-11"
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={cancel}
                      disabled={busy}
                      className="touch:size-11"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {teams.map((t) => {
              const editing = editingId === t.id;
              return (
                <TableRow key={t.id}>
                  <TableCell className="bg-card max-md:sticky max-md:left-0 max-md:z-10 max-md:px-2">
                    {editing ? (
                      <Input
                        value={draft.draftSlot}
                        onChange={(e) => setDraft({ ...draft, draftSlot: e.target.value })}
                        placeholder="#"
                        inputMode="numeric"
                        className="h-8 w-14 touch:h-11 max-md:w-10 max-md:px-2"
                      />
                    ) : t.draft_slot != null ? (
                      <span className="text-primary font-mono font-medium">{t.draft_slot}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <Input
                        value={draft.shortName}
                        onChange={(e) => setDraft({ ...draft, shortName: e.target.value })}
                        className="h-8 touch:h-11"
                      />
                    ) : (
                      <span className="font-mono text-xs">{t.short_name}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <Input
                        value={draft.franchiseName}
                        onChange={(e) => setDraft({ ...draft, franchiseName: e.target.value })}
                        className="h-8 touch:h-11"
                      />
                    ) : (
                      <Link
                        href={`/teams/${t.id}`}
                        className="group hover:text-primary inline-flex items-center gap-1 font-medium transition-colors touch:min-h-11"
                      >
                        {t.franchise_name}
                        <ArrowUpRight className="text-muted-foreground/0 group-hover:text-primary h-3.5 w-3.5 transition-colors max-md:text-muted-foreground" />
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>
                    {editing ? (
                      <Input
                        value={draft.manager}
                        onChange={(e) => setDraft({ ...draft, manager: e.target.value })}
                        className="h-8 touch:h-11"
                      />
                    ) : (
                      <span className="text-muted-foreground">{t.manager}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {editing ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => save(t.id)}
                            disabled={busy}
                            className="touch:size-11"
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={cancel}
                            disabled={busy}
                            className="touch:size-11"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => startEdit(t)}
                            disabled={busy}
                            className="touch:size-11"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => remove(t)}
                            disabled={busy}
                            className="text-destructive hover:text-destructive touch:size-11"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}

            {teams.length === 0 && !adding && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground py-8 text-center text-sm">
                  No franchises yet — add all {LEAGUE.teams} here.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

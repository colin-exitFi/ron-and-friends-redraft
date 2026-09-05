import "server-only";

import { createServiceClient } from "@/lib/supabase/server";
import { CURRENT_SEASON, LEAGUE } from "@/lib/league-config";
import {
  OFFICER_ROLES,
  THRESHOLD_LABELS,
  denominatorFor,
  requiredVotes,
} from "@/lib/governance-rules";
import type {
  MotionStatus,
  MotionThreshold,
  OfficerRole,
  OfficerStatus,
  VoteChoice,
} from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// View types
// ---------------------------------------------------------------------------

export type OfficerView = {
  role: OfficerRole;
  label: string;
  responsibilities: string;
  teamId: string | null;
  teamName: string | null;
  manager: string | null;
  since: string | null;
  status: OfficerStatus;
};

export type MotionVoteTally = { for: number; against: number; abstain: number };

export type MotionView = {
  id: string;
  season: number;
  type: string;
  status: MotionStatus;
  threshold: MotionThreshold;
  thresholdLabel: string;
  proposerTeamId: string | null;
  proposerName: string | null;
  secondedByTeamId: string | null;
  secondedByName: string | null;
  discussionOpens: string | null;
  discussionCloses: string | null;
  effectiveDate: string | null;
  documentation: string | null;
  createdAt: string;
  tally: MotionVoteTally;
  votesByTeam: { teamId: string; teamName: string; choice: VoteChoice }[];
  required: number;
  denominator: number;
  meetsThreshold: boolean;
  decided: boolean;
};

export type AuditEntry = {
  id: string;
  type: string;
  description: string | null;
  disclosureNote: string | null;
  createdAt: string;
};

export type GovernanceView = {
  season: number;
  teams: { id: string; name: string }[];
  officers: OfficerView[];
  motions: MotionView[];
  actions: AuditEntry[];
  activeManagers: number;
  ruleFrozen: boolean;
};

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export async function getGovernance(
  season: number = CURRENT_SEASON,
): Promise<GovernanceView> {
  const supabase = createServiceClient();
  const [
    { data: teams },
    { data: officerRows },
    { data: motionRows },
    { data: voteRows },
    { data: actionRows },
    { data: draftState },
  ] = await Promise.all([
    supabase.from("teams").select("id, short_name").order("short_name"),
    supabase.from("officers").select("*").eq("season", season),
    supabase
      .from("motions")
      .select("*")
      .eq("season", season)
      .order("created_at", { ascending: false }),
    supabase.from("votes").select("motion_id, team_id, choice"),
    supabase
      .from("commissioner_actions")
      .select("*")
      .eq("season", season)
      .order("created_at", { ascending: false }),
    supabase.from("draft_state").select("status").eq("season", season).maybeSingle(),
  ]);

  const teamList = (teams ?? []).map((t) => ({ id: t.id, name: t.short_name }));
  const nameOf = (id: string | null) =>
    id ? teamList.find((t) => t.id === id)?.name ?? null : null;
  const activeManagers = teamList.length || LEAGUE.teams;

  // Officers — one slot per role, filled from the latest active row.
  const officers: OfficerView[] = OFFICER_ROLES.map((def) => {
    const row = (officerRows ?? []).find((o) => o.role === def.role && o.status !== "removed");
    return {
      role: def.role,
      label: def.label,
      responsibilities: def.responsibilities,
      teamId: row?.team_id ?? null,
      teamName: nameOf(row?.team_id ?? null),
      manager: row?.manager ?? null,
      since: row?.since ?? null,
      status: row?.status ?? "inactive",
    };
  });

  const votesByMotion = new Map<string, { team_id: string; choice: VoteChoice }[]>();
  for (const v of voteRows ?? []) {
    const arr = votesByMotion.get(v.motion_id) ?? [];
    arr.push({ team_id: v.team_id, choice: v.choice });
    votesByMotion.set(v.motion_id, arr);
  }

  const motions: MotionView[] = (motionRows ?? []).map((m) => {
    const vs = votesByMotion.get(m.id) ?? [];
    const tally: MotionVoteTally = {
      for: vs.filter((v) => v.choice === "for").length,
      against: vs.filter((v) => v.choice === "against").length,
      abstain: vs.filter((v) => v.choice === "abstain").length,
    };
    const required = requiredVotes(m.threshold, activeManagers);
    const denominator = denominatorFor(m.threshold, activeManagers);
    return {
      id: m.id,
      season: m.season,
      type: m.type,
      status: m.status,
      threshold: m.threshold,
      thresholdLabel: THRESHOLD_LABELS[m.threshold],
      proposerTeamId: m.proposer_team,
      proposerName: nameOf(m.proposer_team),
      secondedByTeamId: m.seconded_by_team,
      secondedByName: nameOf(m.seconded_by_team),
      discussionOpens: m.discussion_opens,
      discussionCloses: m.discussion_closes,
      effectiveDate: m.effective_date,
      documentation: m.documentation,
      createdAt: m.created_at,
      tally,
      votesByTeam: vs.map((v) => ({
        teamId: v.team_id,
        teamName: nameOf(v.team_id) ?? "?",
        choice: v.choice,
      })),
      required,
      denominator,
      meetsThreshold:
        m.threshold === "commissioner_ruling" ? true : tally.for >= required && required > 0,
      decided: m.status === "ratified" || m.status === "rejected" || m.status === "withdrawn",
    };
  });

  const actions: AuditEntry[] = (actionRows ?? []).map((a) => ({
    id: a.id,
    type: a.type,
    description: a.description,
    disclosureNote: a.disclosure_note,
    createdAt: a.created_at,
  }));

  const ruleFrozen =
    !!draftState &&
    ["in_progress", "paused", "complete"].includes(draftState.status);

  return { season, teams: teamList, officers, motions, actions, activeManagers, ruleFrozen };
}

// ---------------------------------------------------------------------------
// Officers
// ---------------------------------------------------------------------------

export async function setOfficer(input: {
  season?: number;
  role: OfficerRole;
  teamId?: string | null;
  manager?: string | null;
  status?: OfficerStatus;
}): Promise<GovernanceView> {
  const season = input.season ?? CURRENT_SEASON;
  const supabase = createServiceClient();
  // single active row per role per season
  await supabase.from("officers").delete().eq("season", season).eq("role", input.role);
  if (input.teamId || input.manager) {
    const { error } = await supabase.from("officers").insert({
      season,
      role: input.role,
      team_id: input.teamId ?? null,
      manager: input.manager ?? null,
      since: new Date().toISOString().slice(0, 10),
      status: input.status ?? "active",
    });
    if (error) throw new Error(error.message);
  }
  return getGovernance(season);
}

// ---------------------------------------------------------------------------
// Motions
// ---------------------------------------------------------------------------

export async function createMotion(input: {
  season?: number;
  type: string;
  threshold: MotionThreshold;
  proposerTeam?: string | null;
  documentation?: string | null;
}): Promise<GovernanceView> {
  const season = input.season ?? CURRENT_SEASON;
  if (!input.type?.trim()) throw new Error("Motion type/title is required.");
  const supabase = createServiceClient();
  const { error } = await supabase.from("motions").insert({
    season,
    type: input.type.trim(),
    threshold: input.threshold,
    proposer_team: input.proposerTeam ?? null,
    status: "proposed",
    documentation: input.documentation ?? null,
  });
  if (error) throw new Error(error.message);
  return getGovernance(season);
}

const STATUS_FLOW: Record<MotionStatus, MotionStatus[]> = {
  proposed: ["seconded", "withdrawn"],
  seconded: ["discussion", "withdrawn"],
  discussion: ["voting", "withdrawn"],
  voting: ["ratified", "rejected", "withdrawn"],
  ratified: [],
  rejected: [],
  withdrawn: [],
};

export async function updateMotion(input: {
  motionId: string;
  status?: MotionStatus;
  secondedByTeam?: string | null;
}): Promise<GovernanceView> {
  const supabase = createServiceClient();
  const { data: motion } = await supabase
    .from("motions")
    .select("*")
    .eq("id", input.motionId)
    .maybeSingle();
  if (!motion) throw new Error("Motion not found.");

  const patch: {
    seconded_by_team?: string | null;
    status?: MotionStatus;
    discussion_opens?: string;
    discussion_closes?: string;
    effective_date?: string;
  } = {};

  if (input.secondedByTeam !== undefined) {
    if (input.secondedByTeam && input.secondedByTeam === motion.proposer_team) {
      throw new Error("A motion must be seconded by a different manager.");
    }
    patch.seconded_by_team = input.secondedByTeam;
  }

  if (input.status && input.status !== motion.status) {
    const allowed = STATUS_FLOW[motion.status as MotionStatus] ?? [];
    if (!allowed.includes(input.status)) {
      throw new Error(`Cannot move a ${motion.status} motion to ${input.status}.`);
    }
    if (input.status === "seconded" && !patch.seconded_by_team && !motion.seconded_by_team) {
      throw new Error("Record who seconded the motion first.");
    }
    patch.status = input.status;
    if (input.status === "discussion") {
      patch.discussion_opens = new Date().toISOString();
    }
    if (input.status === "voting") {
      patch.discussion_closes = new Date().toISOString();
    }
    if (input.status === "ratified") {
      patch.effective_date = new Date().toISOString().slice(0, 10);
    }
  }

  if (Object.keys(patch).length === 0) return getGovernance(motion.season);

  const { error } = await supabase.from("motions").update(patch).eq("id", input.motionId);
  if (error) throw new Error(error.message);

  // Log ratifications to the audit trail.
  if (patch.status === "ratified") {
    await supabase.from("commissioner_actions").insert({
      season: motion.season,
      type: "Motion ratified",
      description: `“${motion.type}” passed (${motion.threshold}).`,
      related_id: motion.id,
    });
  }

  return getGovernance(motion.season);
}

export async function deleteMotion(motionId: string): Promise<GovernanceView> {
  const supabase = createServiceClient();
  const { data: motion } = await supabase
    .from("motions")
    .select("season")
    .eq("id", motionId)
    .maybeSingle();
  await supabase.from("motions").delete().eq("id", motionId);
  return getGovernance(motion?.season ?? CURRENT_SEASON);
}

export async function castVote(input: {
  motionId: string;
  teamId: string;
  choice: VoteChoice;
}): Promise<GovernanceView> {
  const supabase = createServiceClient();
  const { data: motion } = await supabase
    .from("motions")
    .select("season, status")
    .eq("id", input.motionId)
    .maybeSingle();
  if (!motion) throw new Error("Motion not found.");
  if (motion.status !== "voting") throw new Error("Motion is not open for voting.");

  const { error } = await supabase.from("votes").upsert(
    {
      motion_id: input.motionId,
      team_id: input.teamId,
      choice: input.choice,
    },
    { onConflict: "motion_id,team_id" },
  );
  if (error) throw new Error(error.message);
  return getGovernance(motion.season);
}

export async function clearVote(input: {
  motionId: string;
  teamId: string;
}): Promise<GovernanceView> {
  const supabase = createServiceClient();
  const { data: motion } = await supabase
    .from("motions")
    .select("season")
    .eq("id", input.motionId)
    .maybeSingle();
  await supabase
    .from("votes")
    .delete()
    .eq("motion_id", input.motionId)
    .eq("team_id", input.teamId);
  return getGovernance(motion?.season ?? CURRENT_SEASON);
}

// ---------------------------------------------------------------------------
// Commissioner actions / audit log
// ---------------------------------------------------------------------------

export async function recordAction(input: {
  season?: number;
  type: string;
  description?: string | null;
  disclosureNote?: string | null;
}): Promise<GovernanceView> {
  const season = input.season ?? CURRENT_SEASON;
  if (!input.type?.trim()) throw new Error("Action type is required.");
  const supabase = createServiceClient();
  const { error } = await supabase.from("commissioner_actions").insert({
    season,
    type: input.type.trim(),
    description: input.description ?? null,
    disclosure_note: input.disclosureNote ?? null,
  });
  if (error) throw new Error(error.message);
  return getGovernance(season);
}

export async function deleteAction(id: string): Promise<GovernanceView> {
  const supabase = createServiceClient();
  const { data: row } = await supabase
    .from("commissioner_actions")
    .select("season")
    .eq("id", id)
    .maybeSingle();
  await supabase.from("commissioner_actions").delete().eq("id", id);
  return getGovernance(row?.season ?? CURRENT_SEASON);
}

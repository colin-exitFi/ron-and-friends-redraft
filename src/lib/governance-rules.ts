import type { MotionThreshold, OfficerRole } from "@/lib/supabase/types";

// Officer reference data + threshold math. No server-only — safe on the client.

/**
 * The three offices this league recognises. `treasurer` was dropped from the
 * `officer_role` enum along with the treasury it existed to manage.
 */
export const OFFICER_ROLES: { role: OfficerRole; label: string; responsibilities: string }[] = [
  {
    role: "commissioner",
    label: "Commissioner",
    responsibilities:
      "Core operations, ESPN league settings, draft logistics, coordinates votes, resolves disputes.",
  },
  {
    role: "vice_commissioner",
    label: "Vice Commissioner",
    responsibilities:
      "Deputy and backup decision-maker; first escalation point when the Commissioner is conflicted or unavailable.",
  },
  {
    role: "cto",
    label: "League CTO",
    responsibilities:
      "Owns league technology — this app, the draft board, keeper and trade tooling, exports. Advisory unless adopted by vote.",
  },
];

export const THRESHOLD_LABELS: Record<MotionThreshold, string> = {
  simple_majority: "Simple majority",
  two_thirds: "Two-thirds of active managers",
  two_thirds_excl_subject: "Two-thirds excl. subject",
  commissioner_ruling: "Commissioner ruling + disclosure",
};

/** Motion presets → default threshold. Mirrors VOTING_THRESHOLDS in league-config. */
export const MOTION_PRESETS: {
  type: string;
  threshold: MotionThreshold;
  examples: string;
}[] = [
  {
    type: "Officer Election",
    threshold: "simple_majority",
    examples: "Commissioner, Vice Commissioner, League CTO",
  },
  {
    type: "Standard Rule Change",
    threshold: "simple_majority",
    examples: "Waiver timing, administrative process, non-structural settings",
  },
  {
    type: "Major Structural Change",
    threshold: "two_thirds",
    examples: "Scoring, keeper system, roster format, draft format",
  },
  {
    type: "Officer Removal",
    threshold: "two_thirds",
    examples: "Neglected role, abused authority, unresolved conflict",
  },
  {
    type: "Manager Removal",
    threshold: "two_thirds_excl_subject",
    examples: "Abandonment, collusion, sabotage, repeated bad faith",
  },
  {
    type: "Emergency Platform Fix",
    threshold: "commissioner_ruling",
    examples: "Clear technical or ESPN implementation problem",
  },
];

export function requiredVotes(threshold: MotionThreshold, active: number): number {
  switch (threshold) {
    case "simple_majority":
      return Math.floor(active / 2) + 1; // > half of active managers
    case "two_thirds":
      return Math.ceil((active * 2) / 3);
    case "two_thirds_excl_subject":
      return Math.ceil(((active - 1) * 2) / 3);
    case "commissioner_ruling":
      return 0;
  }
}

export function denominatorFor(threshold: MotionThreshold, active: number): number {
  return threshold === "two_thirds_excl_subject" ? active - 1 : active;
}

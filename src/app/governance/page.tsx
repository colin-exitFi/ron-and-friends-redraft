import { PageBody, PageHeader } from "@/components/page-header";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { GovernanceManager } from "@/components/governance-manager";
import { DatabasePending } from "@/components/database-pending";
import { getGovernance } from "@/lib/governance";
import { hasDatabase } from "@/lib/env";
import { CURRENT_SEASON, LEAGUE } from "@/lib/league-config";

export const metadata = { title: `Governance · ${LEAGUE.name}` };
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "The league ballot, officers, vote tallies, and the log of commissioner " +
  "rulings. This app records the questions and does not decide them. The " +
  "thresholds come from the 2026 Season Proposal, section 9: a simple majority " +
  "for a standard rule change, two-thirds for anything structural — scoring, " +
  "rosters, or money.";

export default async function GovernancePage() {
  if (!hasDatabase()) {
    return (
      <DatabasePending
        title="Governance"
        description={DESCRIPTION}
        reason={
          "Unlike the other pages, there is no snapshot that can stand in here. " +
          "Motions, seconds and votes are new facts the league creates by voting — " +
          "nothing on Sleeper records them, so there is nothing to read them from."
        }
        needs={[
          {
            label: "Motions",
            detail:
              "a proposal, a second, a short discussion and then a vote, per section 9 of the proposal. Nothing is on the ballot yet — 2026's ruleset was settled before the draft and the rules are locked for the season once it starts",
          },
          {
            label: "Votes",
            detail:
              "one per franchise per motion, tallied against the threshold. None has been cast, and none is seeded — a seeded vote would be a fabricated one",
          },
          {
            label: "Officers",
            detail:
              "the commissioner, recorded against a franchise id rather than a name, so the office cannot detach from the man if he renames his team",
          },
          {
            label: "The decisions log",
            detail:
              "the commissioner's rulings, so the league can see what was decided unilaterally and why",
          },
        ]}
        worksToday={
          "Everything that only needs to be read already works: the draft board, " +
          "the player pool, the ten franchises and their rosters. Governance is the " +
          "one surface that has nothing to fall back on, because its content does " +
          "not exist until somebody votes."
        }
      />
    );
  }

  const governance = await getGovernance(CURRENT_SEASON);

  return (
    <>
      <RealtimeRefresher
        tables={["officers", "motions", "votes", "commissioner_actions", "teams"]}
        showIndicator
      />
      <PageHeader title="Governance" description={DESCRIPTION} />
      <PageBody>
        <GovernanceManager initial={governance} season={CURRENT_SEASON} />
      </PageBody>
    </>
  );
}

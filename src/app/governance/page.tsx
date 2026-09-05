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
  "rulings. Kyle Mertens is the commissioner and the league's only officer. " +
  "Five items are on the ballot, each recorded as a motion awaiting a vote — " +
  "this app records the questions and does not decide them. The league has no " +
  "ratified constitution, so the vote thresholds come from league-config and " +
  "are defaults until the league adopts them.";

export default async function GovernancePage() {
  if (!hasDatabase()) {
    return (
      <DatabasePending
        title="Governance"
        description={DESCRIPTION}
        reason={
          "Unlike the other pages, there is no snapshot that can stand in here. " +
          "Motions, seconds and votes are new facts the league creates by voting — " +
          "they do not exist in the Smart Draft room, the ESPN league, or the " +
          "commissioner's workbooks, so there is nothing to read them from."
        }
        needs={[
          {
            label: "The ballot — five motions",
            detail:
              "the Puka Nacua keeper timeline, the trade-and-reset loophole, whether contingent trades are permitted at all, how future-season picks may be traded, and the round-2 keeper consequence. All five are written up in full in data/DECISIONS.md, each with the question stated neutrally, what turns on it, and its deadline — two of them must be settled before the 2027 keeper clocks are computed",
          },
          {
            label: "Votes",
            detail:
              "one per franchise per motion, tallied against the threshold. None has been cast, and none is seeded — a seeded vote would be a fabricated one",
          },
          {
            label: "Officers",
            detail:
              "Kyle Mertens is the commissioner and the only officer — no vice commissioner, no treasurer. Recorded against his franchise id rather than the name 'Kyle', because that string is also Kyle Witte's first name",
          },
          {
            label: "The decisions log",
            detail:
              "the commissioner's rulings, so the league can see what was decided unilaterally and why — Nacua to Scott at R11, the Smart Draft draft order over ESPN's, Loveland at R9, and Ted Buckman being Zach Rakowski",
          },
        ]}
        worksToday={
          "Everything that only needs to be read already works: the draft board, " +
          "the player pool, the ten franchises, every declared keeper with his tenure, " +
          "and the full trade log. The rulings above are applied to those pages " +
          "today — they just are not yet recorded here as votable decisions."
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

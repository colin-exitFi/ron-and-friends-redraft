import {
  CURRENT_SEASON,
  DRAFT,
  FEATURES,
  KEEPERS,
  LEAGUE,
  SCORING_FORMAT,
  TOTAL_PICKS,
  daysUntilDraft,
  draftDayLabel,
} from "@/lib/league-config";
import { getKeeperBoard, getTradeBoard } from "@/lib/league-source";

/**
 * One line in the activity panel.
 *
 * `when` is deliberately a free-text ordering key rather than a timestamp.
 * Keeper declarations and the trade log carry no times at all — the trade log
 * has only a trade number, and declarations have none — so anything resembling
 * "20m ago" would be invented. Each entry states the strongest true thing it
 * has: a trade number, a franchise, or nothing.
 */
export type ActivityEntry = {
  id: string;
  /** Short uppercase label, e.g. "Trade logged". */
  kind: string;
  /** Ordering key shown on the right. Null when nothing true is available. */
  when: string | null;
  body: string;
  tone: "accent" | "neutral" | "muted";
};

/**
 * One headline tile.
 *
 * The three parts are deliberately kept to a fixed shape: a label of one or two
 * short words, a value short enough never to wrap, and a `hint` carrying the
 * qualifier. Anything long that used to live in the label ("provisional /
 * logged") or in the value ("2026 keeper", "3 days") belongs in the hint —
 * otherwise labels wrap to different line counts across a row and the numbers
 * stop lining up.
 */
export type DashboardStat = {
  label: string;
  value: string;
  hint: string;
  tone?: "accent";
};

export type DashboardView = {
  season: number;
  /** Phase eyebrow, e.g. "Preseason phase". */
  phase: string;
  /** The dim line beside the phase — what is open and how long is left. */
  phaseNote: string;
  tagline: string;
  stats: DashboardStat[];
  /** The banner under the header. Null when there is nothing to chase. */
  alert: { lead: string; strong: string; tail: string } | null;
  activity: ActivityEntry[];
  /** Counts the command tiles quote, so they are never stale copy. */
  counts: {
    franchises: number;
    keepersDeclared: number;
    provisionalTrades: number;
    tradedPicks: number;
  };
  fromDatabase: boolean;
};

export async function getDashboardView(): Promise<DashboardView> {
  const [keeperBoard, tradeBoard] = await Promise.all([
    getKeeperBoard(),
    getTradeBoard(),
  ]);

  const days = daysUntilDraft();
  const keeperSlots = LEAGUE.teams * KEEPERS.maxPerTeam;
  const declared = keeperBoard.keepers.length;
  const provisional = tradeBoard.log.filter((t) => t.provisional).length;

  /*
   * Declarations lock a fixed number of hours before the draft, so the window is
   * open until that point. Expressed in whole days to match the countdown.
   */
  const lockDaysBefore = Math.ceil(DRAFT.keeperLockHoursBeforeDraft / 24);
  const daysUntilLock = Math.max(0, days - lockDaysBefore);
  /*
   * A redraft has no declaration window, so the phase note cannot be about one.
   * Reporting "keeper declarations locked" to a league that does not keep
   * anybody is the sort of confident wrongness that makes a room stop trusting
   * the rest of the numbers on the page.
   */
  const phaseNote = !FEATURES.keepers
    ? days === 0
      ? "Every pick is live — nobody is kept"
      : `${TOTAL_PICKS} picks across ${DRAFT.rounds} rounds`
    : days === 0
      ? "Draft day"
      : daysUntilLock === 0
        ? "Keeper declarations locked"
        : `Keeper declarations open · ${daysUntilLock} ${
            daysUntilLock === 1 ? "day" : "days"
          } remaining`;

  return {
    season: CURRENT_SEASON,
    phase: days === 0 ? "Draft day" : "Preseason phase",
    phaseNote,
    tagline: `A ${LEAGUE.teams}-team ${SCORING_FORMAT} ${
      FEATURES.keepers ? "keeper league" : "redraft league"
    } on ${LEAGUE.platform}, drafted in person.`,
    stats: [
      {
        label: "Season",
        value: String(CURRENT_SEASON),
        hint: `${SCORING_FORMAT} ${FEATURES.keepers ? "keeper" : "redraft"}`,
      },
      /*
       * The keeper tile is replaced rather than left showing "0 / 20", which
       * reads as twenty declarations nobody has made yet. On a redraft the
       * equivalent fact — and the one the room actually wants on draft day — is
       * how much of the board is still to come.
       */
      FEATURES.keepers
        ? {
            label: "Keepers declared",
            value: `${declared} / ${keeperSlots}`,
            hint: `${KEEPERS.maxPerTeam} per franchise`,
          }
        : {
            label: "Picks on the board",
            value: String(TOTAL_PICKS),
            hint: `${DRAFT.rounds} rounds · ${LEAGUE.teams} franchises`,
          },
      {
        label: "Trades logged",
        value: String(tradeBoard.log.length),
        hint: provisional ? `${provisional} provisional` : "All settled",
      },
      {
        /* The unit lives in the label, so the value stays a bare numeral like
         * the other three rather than "3 days". */
        label: "Days to draft",
        value: days === 0 ? "Today" : String(days),
        hint: draftDayLabel(),
        tone: "accent",
      },
    ],
    alert: buildAlert(keeperBoard, keeperSlots, declared),
    activity: buildActivity(keeperBoard, tradeBoard),
    counts: {
      franchises: LEAGUE.teams,
      keepersDeclared: declared,
      provisionalTrades: provisional,
      tradedPicks: tradeBoard.tradedPicks.length,
    },
    fromDatabase: keeperBoard.fromDatabase && tradeBoard.fromDatabase,
  };
}

/**
 * The banner names the single most actionable gap. Franchises that have not
 * answered outrank everything else, because that is the one thing that stops the
 * keeper list being final.
 */
function buildAlert(
  keeperBoard: Awaited<ReturnType<typeof getKeeperBoard>>,
  keeperSlots: number,
  declared: number,
): DashboardView["alert"] {
  /*
   * EVERY ALERT BELOW IS ABOUT KEEPERS, AND ON A REDRAFT EVERY ONE OF THEM
   * FIRES WRONG. `pending` lists a franchise whenever it has declared fewer
   * keepers than the maximum, so with keepers off it lists ALL TEN and the
   * dashboard opens with "10 franchises have not answered on keepers" — about a
   * question nobody was asked. That is the empty-data failure this whole page
   * is most exposed to, and it would have been the first thing on the screen.
   */
  if (!FEATURES.keepers) return null;

  const awaiting = keeperBoard.pending.filter((p) => p.status === "awaiting");
  if (awaiting.length) {
    const names = awaiting.map((p) => p.manager).join(", ");
    return {
      lead:
        awaiting.length === 1
          ? "One franchise has not answered on keepers — "
          : `${awaiting.length} franchises have not answered on keepers — `,
      strong: names,
      tail: `. ${declared} of ${keeperSlots} slots are declared, and the list is not final until every manager replies.`,
    };
  }

  const missing = keeperBoard.roomSync.missingFromRoom?.length ?? 0;
  if (missing) {
    return {
      lead: "Keeper list is settled, but Smart Draft is behind — ",
      strong: `${missing} ${missing === 1 ? "keeper" : "keepers"} not yet keyed into the room`,
      tail: ". The board here already shows them.",
    };
  }

  if (keeperBoard.ineligible.length) {
    const n = keeperBoard.ineligible.length;
    return {
      lead: "",
      strong: `${n} ${n === 1 ? "declaration" : "declarations"} the rules do not allow`,
      tail: " — resolve these before the board is published.",
    };
  }

  return null;
}

/**
 * Real activity only, most actionable first.
 *
 * Anything still waiting on a manager leads, then barred declarations, then
 * trades — provisional ahead of settled, and otherwise newest-first by trade
 * number, which is the only ordering the log actually carries. Without this
 * ordering the twelve settled trades bury the one franchise that has not
 * replied, which is the whole reason to look at this panel.
 */
function buildActivity(
  keeperBoard: Awaited<ReturnType<typeof getKeeperBoard>>,
  tradeBoard: Awaited<ReturnType<typeof getTradeBoard>>,
): ActivityEntry[] {
  const awaiting: ActivityEntry[] = keeperBoard.pending
    .filter((p) => p.status === "awaiting")
    .map((p) => ({
      id: `awaiting-${p.teamId}`,
      kind: "Awaiting declaration",
      when: null,
      body: `${p.manager} (${p.franchiseName}) has not answered — ${p.declared} of ${p.allowed} keeper slots declared.`,
      tone: "accent",
    }));

  const barred: ActivityEntry[] = keeperBoard.ineligible.map((i) => ({
    id: `ineligible-${i.teamId}-${i.playerName}`,
    kind: "Declaration barred",
    when: null,
    body: `${i.manager} declared ${i.playerName} — ${i.reason}`,
    tone: "accent",
  }));

  const trades: ActivityEntry[] = [...tradeBoard.log]
    .sort(
      (a, b) =>
        Number(b.provisional) - Number(a.provisional) ||
        b.tradeNumber - a.tradeNumber,
    )
    .map((trade) => ({
      id: `trade-${trade.id}`,
      kind: trade.provisional ? "Trade provisional" : "Trade logged",
      when: `Trade #${trade.tradeNumber}`,
      body: describeTrade(trade),
      tone: trade.provisional ? "accent" : "neutral",
    }));

  return [...awaiting, ...barred, ...trades].slice(0, 6);
}

function describeTrade(
  trade: Awaited<ReturnType<typeof getTradeBoard>>["log"][number],
): string {
  const side = (s: (typeof trade)["sideA"]) => {
    const got = [
      ...s.playersReceived.map((p) => p.resolvedName ?? p.typedName),
      ...s.picksReceived.map((p) => p.label),
    ];
    return got.length ? `${s.manager} got ${got.join(", ")}` : s.manager;
  };
  const sentence = `${side(trade.sideA)}; ${side(trade.sideB)}.`;
  return trade.provisionalNote
    ? `${sentence} ${trade.provisionalNote}`
    : sentence;
}

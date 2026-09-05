import Image from "next/image";
import Link from "next/link";
import {
  CalendarDays,
  ClipboardCheck,
  Gauge,
  Landmark,
  ListOrdered,
  Lock,
  Repeat,
  UserSearch,
  Users,
} from "lucide-react";

import { Stat } from "@/components/ui/stat";
import { getDashboardView } from "@/lib/dashboard-view";
import {
  CURRENT_SEASON,
  DRAFT,
  LEAGUE,
  TOTAL_PICKS,
  draftDayLabel,
} from "@/lib/league-config";
import { cn } from "@/lib/utils";

/**
 * The commissioner's landing page: what phase the league is in, the one thing
 * still outstanding, the four numbers that matter, every destination in one
 * grid, and the real activity log.
 */
export default async function Home() {
  const view = await getDashboardView();

  return (
    <>
      <DashboardHeader view={view} />

      <div className="flex flex-col gap-10 px-6 pt-8 pb-11 md:px-11">
        {view.alert && <AlertBar alert={view.alert} />}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {view.stats.map((s) => (
            <Stat
              key={s.label}
              variant="display"
              label={s.label}
              value={s.value}
              hint={s.hint}
              tone={s.tone}
            />
          ))}
        </div>

        <div className="flex flex-col gap-10 xl:flex-row xl:gap-12">
          <section className="min-w-0 flex-1">
            <SectionLabel>League commands</SectionLabel>
            <CommandGrid counts={view.counts} />
          </section>

          <section className="xl:w-[288px] xl:shrink-0">
            <SectionLabel>League activity</SectionLabel>
            <ActivityPanel activity={view.activity} />
          </section>
        </div>
      </div>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-muted-foreground/80 pb-5 text-[9px] font-bold tracking-[0.2em] uppercase">
      {children}
    </h2>
  );
}

function DashboardHeader({
  view,
}: {
  view: Awaited<ReturnType<typeof getDashboardView>>;
}) {
  return (
    <header className="border-border relative overflow-hidden border-b">
      {/* The grid comes from the page canvas now. This band keeps only its extra
       * wash, which is what still makes it read as a masthead. */}
      <div className="bg-wash-hero pointer-events-none absolute inset-0" />

      <div className="relative flex flex-col gap-6 px-6 py-7 max-md:portrait:gap-4 max-md:portrait:py-5 md:px-11 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-6 lg:gap-8">
          {/*
            The crest is the one thing here with real presence, so it gets a glow
            behind it rather than the whole band being lit — and it is sized to be
            the masthead's subject, not an icon beside the title. Two stacked
            blurs: a wide one to lift the crest off the canvas and a tighter one
            to keep the light behind the artwork itself.

            Neutral white rather than the accent. The crest artwork is orange and
            navy, so a cyan bloom behind it reads as a complementary clash at the
            exact centre of the masthead. White light lifts the same silhouette
            without arguing with it.
          */}
          <span className="relative hidden shrink-0 sm:block">
            <span className="absolute -inset-2 -z-10 rounded-full bg-white/12 blur-3xl" />
            <span className="absolute inset-6 -z-10 rounded-full bg-white/10 blur-2xl" />
            <Image
              src="/brand/crest-v2.png"
              alt={`${LEAGUE.name} crest`}
              width={512}
              height={512}
              priority
              className="crest-lift relative h-[146px] w-[146px] object-contain md:h-[184px] md:w-[184px] xl:h-[224px] xl:w-[224px]"
            />
          </span>

          <div className="flex min-w-0 flex-col gap-2.5 max-md:portrait:gap-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="bg-primary size-[5px] shrink-0 rounded-[1px]" />
              <span className="text-primary text-[9px] font-bold tracking-[0.2em] uppercase">
                {view.phase}
              </span>
              <span className="text-muted-foreground/80 text-[9px] font-medium">
                {view.phaseNote}
              </span>
            </div>
            {/*
              Grows with the crest, so the pairing stays a title beside a mark
              rather than a mark that swallowed a title. Held to `xl` — between
              1024 and 1280 the row is crest, title and CTA in the same line, and
              36px is where "· 2026" breaks onto a line of its own.
            */}
            <h1 className="font-display text-[30px] leading-tight font-bold max-md:portrait:text-[22px] xl:text-[36px]">
              {LEAGUE.name} · {view.season}
            </h1>
            <p className="text-muted-foreground/80 text-[12px] xl:text-[13px]">
              {view.tagline}
            </p>
          </div>
        </div>

        <Link
          href="/keepers"
          className="bg-primary text-primary-foreground hover:bg-primary/85 flex shrink-0 items-center gap-2 self-start rounded-sm px-5 py-3 text-[10px] font-bold tracking-[0.15em] uppercase transition-colors touch:min-h-11 lg:self-auto"
        >
          <Lock className="h-3 w-3" />
          Review keeper list
        </Link>
      </div>
    </header>
  );
}

function AlertBar({
  alert,
}: {
  alert: NonNullable<Awaited<ReturnType<typeof getDashboardView>>["alert"]>;
}) {
  return (
    <div className="border-border bg-card flex items-stretch gap-3 rounded-lg border px-4 py-3">
      {/* Stretches rather than a fixed height, so it still reads as a rule down
       * the side of the message once the copy wraps on a narrow screen. */}
      <span className="bg-primary w-[2px] shrink-0" />
      <p className="text-muted-foreground text-[12px] leading-relaxed">
        {alert.lead}
        <span className="text-foreground font-semibold">{alert.strong}</span>
        {alert.tail}
      </p>
    </div>
  );
}

type Command = {
  href: string;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Small accent note above the label, e.g. "2 provisional". */
  note?: string;
};

function CommandGrid({
  counts,
}: {
  counts: Awaited<ReturnType<typeof getDashboardView>>["counts"];
}) {
  /*
   * Every description quotes a real number rather than fixed copy, so a tile can
   * never claim something the rest of the app disagrees with.
   */
  const commands: Command[] = [
    {
      href: "/draft",
      label: "Draft Board",
      desc: `${DRAFT.rounds} rounds · ${TOTAL_PICKS} picks · run in person`,
      icon: ListOrdered,
    },
    {
      href: "/keepers",
      label: "Keepers",
      desc: `${counts.keepersDeclared} declared on a ${CURRENT_SEASON} clock`,
      icon: Lock,
    },
    {
      href: "/trades",
      label: "Trades",
      desc: `${counts.tradedPicks} picks changed hands`,
      icon: Repeat,
      note: counts.provisionalTrades
        ? `${counts.provisionalTrades} provisional`
        : undefined,
    },
    {
      href: "/teams",
      label: "Teams",
      desc: `All ${counts.franchises} franchises`,
      icon: Users,
    },
    {
      href: "/players",
      label: "Players",
      desc: "Ranked pool and keeper status",
      icon: UserSearch,
    },
    {
      href: "/governance",
      label: "Governance",
      desc: "Officers, motions, decisions",
      icon: Landmark,
    },
    {
      href: "/scoring",
      label: "Scoring",
      desc: "PPR settings, read from ESPN",
      icon: Gauge,
    },
    {
      href: "/calendar",
      label: "Calendar",
      desc: `Draft day ${draftDayLabel()}`,
      icon: CalendarDays,
    },
    {
      href: "/checklist",
      label: "Preseason",
      desc: "What to settle before the clock",
      icon: ClipboardCheck,
    },
  ];

  /*
   * One bordered container divided by hairlines rather than nine separate cards,
   * which is what makes it read as a control panel. The negative right/bottom
   * margins swallow the trailing dividers so no line ever sits on the container
   * edge, at any column count.
   */
  return (
    <div className="border-border bg-card overflow-hidden rounded-lg border">
      <div className="-mr-px -mb-px flex flex-wrap">
        {commands.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="border-border hover:bg-muted/40 group flex w-full min-w-0 flex-col gap-2 border-r border-b px-5 py-5 transition-colors sm:w-1/2 lg:w-1/3"
            >
              <span className="flex items-center gap-2">
                <Icon className="text-muted-foreground group-hover:text-primary h-[13px] w-[13px] shrink-0 transition-colors" />
                {c.note && (
                  <span className="text-primary text-[9px] font-bold tracking-[0.1em] uppercase">
                    {c.note}
                  </span>
                )}
              </span>
              <span className="text-foreground/90 group-hover:text-foreground truncate text-[13px] font-semibold transition-colors">
                {c.label}
              </span>
              <span className="text-muted-foreground/80 truncate text-[11px]">
                {c.desc}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function ActivityPanel({
  activity,
}: {
  activity: Awaited<ReturnType<typeof getDashboardView>>["activity"];
}) {
  if (!activity.length) {
    return (
      <div className="border-border bg-card text-muted-foreground rounded-lg border px-4 py-5 text-[12px]">
        Nothing logged yet. Trades and outstanding keeper declarations show up
        here.
      </div>
    );
  }

  return (
    <div className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border">
      {activity.map((e) => (
        <div key={e.id} className="flex flex-col gap-1.5 p-4">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "text-[8px] font-bold tracking-[0.15em] uppercase",
                e.tone === "accent" && "text-primary",
                e.tone === "neutral" && "text-foreground",
                e.tone === "muted" && "text-muted-foreground/80",
              )}
            >
              {e.kind}
            </span>
            {e.when && (
              <span className="text-muted-foreground/70 shrink-0 text-[9px] tabular-nums">
                {e.when}
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-[12px] leading-[1.6]">
            {e.body}
          </p>
        </div>
      ))}
    </div>
  );
}

"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  ClipboardCheck,
  Flame,
  Gauge,
  Landmark,
  LayoutGrid,
  LayoutList,
  ListOrdered,
  Lock,
  Menu,
  NotebookPen,
  Repeat,
  Search,
  Settings,
  Trophy,
  UserSearch,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { CURRENT_SEASON, FEATURES, LEAGUE } from "@/lib/league-config";
import { SHEET_TENURE_TERM } from "@/lib/keeper-clock";
import { DRAFT, TOTAL_PICKS } from "@/lib/league-config";

/*
 * The footer slot the design gives to the signed-in manager. This app has no
 * accounts, so it carries the thing that is always true and worth having on
 * screen — and what that IS depends on whether the league keeps players. On a
 * redraft the keeper clock is not a fact about the season, it is a fact about a
 * different league, so the slot states the shape of the draft instead.
 */
const SEASON_LABEL = FEATURES.keepers ? "keeper season" : "redraft season";
const SEASON_NOTE = FEATURES.keepers
  ? `${SHEET_TENURE_TERM}-year keeper clock`
  : `${DRAFT.rounds} rounds · ${TOTAL_PICKS} picks`;
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/command-palette";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  ready?: boolean;
  /** Small accent pill on the right of the row, e.g. a pending count. */
  badge?: string;
};

type NavGroup = { heading: string; items: NavItem[] };

/*
 * Grouped the way the design groups them — Draft Hub / League / Admin. The
 * design's "Draft Room" and "Standings" items have no route in this app yet, so
 * they are simply absent rather than stubbed.
 */
const NAV: NavGroup[] = [
  {
    heading: "Draft Hub",
    items: [
      { href: "/draft", label: "Draft Board", icon: ListOrdered, ready: true },
      { href: "/draft/final", label: "Final Board", icon: Trophy, ready: true },
      { href: "/draft/recap", label: "Recap", icon: Flame, ready: true },
      /*
       * Draft Notes and Keepers are HIDDEN, NOT REMOVED, and the switches are in
       * `league-config`. This league has no scribe taking notes all night, and
       * 2026 is a pure redraft with the keeper framework deferred to a 2027
       * vote — so both routes stay on disk, importable and working, and the
       * league turns them on by flipping a flag rather than by rebuilding them.
       *
       * Next to Recap because they are the two retrospective pages and people
       * arrive wanting "the thing about the draft night" without much care which.
       */
      ...(FEATURES.draftNotes
        ? [{ href: "/draft/notes", label: "Draft Notes", icon: NotebookPen, ready: true }]
        : []),
      { href: "/mock", label: "Mock Draft", icon: Bot, ready: true },
      ...(FEATURES.keepers
        ? [{ href: "/keepers", label: "Keepers", icon: Lock, ready: true }]
        : []),
    ],
  },
  {
    heading: "League",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutGrid, ready: true },
      { href: "/teams", label: "Teams", icon: Users, ready: true },
      /*
       * The reason this page exists: a manager's friend went looking for rosters
       * and could not find them, because the only way in was Teams and then a
       * click through to a franchise. Sits next to Teams because that is where
       * he looked.
       */
      { href: "/rosters", label: "Rosters", icon: LayoutList, ready: true },
      { href: "/players", label: "Players", icon: UserSearch, ready: true },
      { href: "/trades", label: "Trades", icon: Repeat, ready: true },
    ],
  },
  {
    heading: "Admin",
    items: [
      { href: "/governance", label: "Governance", icon: Landmark, ready: true },
      { href: "/scoring", label: "Scoring Rules", icon: Gauge, ready: true },
      { href: "/calendar", label: "Calendar", icon: CalendarDays, ready: true },
      {
        href: "/checklist",
        label: "Preseason",
        icon: ClipboardCheck,
        ready: true,
      },
    ],
  },
];

/*
 * The rail is icon-only until pointed at, then overlays the page at the design's
 * full 232px. Two rules keep the expansion from feeling like a jolt:
 *
 * 1. Every row puts its icon in a slot exactly as wide as the collapsed rail, so
 *    no glyph moves horizontally between states — only trailing text arrives.
 * 2. The rail expands on keyboard focus as well as hover, so tabbing into it
 *    reveals the labels instead of moving focus through invisible text.
 *
 * The rail's own `hover:` / `has-[:focus-visible]:` width and the children's
 * `group-hover/rail:` / `group-has-[:focus-visible]/rail:` fades must stay the
 * SAME condition. They cannot be factored into one constant — Tailwind only
 * generates classes it can find as literal text, so an interpolated variant
 * silently produces no CSS — which is exactly how they drifted apart once: the
 * width opened on `has-[:focus-visible]` while the text faded in on
 * `focus-within`, so a mouse click on a nav link left that link focused and the
 * rail snapped back to 64px with the labels still lit. Full-size headings, in a
 * rail too narrow to hold them, until you clicked the page to drop focus.
 */

/** Centred icon slot, the width of the collapsed rail (`w-16`). */
const ICON_SLOT = "flex w-16 shrink-0 items-center justify-center";

/**
 * Trailing content, faded rather than unmounted so the width and the text arrive
 * together. Interactive trailing controls stay reachable by keyboard because
 * focusing one expands the rail. Matches the rail's own width condition exactly —
 * see above.
 */
const REVEAL =
  "opacity-0 transition-opacity duration-200 motion-reduce:transition-none group-hover/rail:opacity-100 group-has-[:focus-visible]/rail:opacity-100";

/*
 * 32px tall, 13px icon, 12px label. The active item is marked by a 2px accent
 * bar flush to the rail's left edge, which stays visible when collapsed — so the
 * current page is still identifiable without any labels.
 */
function NavLink({
  item,
  active,
  onNavigate,
  collapsible,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      title={collapsible ? item.label : undefined}
      className={cn(
        "group/nav relative flex h-8 items-center pr-5 text-[12px] transition-colors duration-150 touch:h-11 touch:text-[14px]",
        active
          ? "text-sidebar-accent-foreground font-semibold"
          : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-accent-foreground font-medium",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0 left-0 h-full w-[2px]",
          active ? "bg-primary" : "bg-transparent",
        )}
      />
      <span className={ICON_SLOT}>
        <Icon
          className={cn(
            "h-[13px] w-[13px] shrink-0 transition-colors",
            active ? "text-primary" : "text-current",
          )}
        />
      </span>
      <span className={cn("min-w-0 flex-1 truncate", collapsible && REVEAL)}>
        {item.label}
      </span>
      {item.badge ? (
        <span
          className={cn(
            "bg-primary text-primary-foreground rounded-[2px] px-[5px] py-[2px] text-[7px] font-extrabold uppercase",
            collapsible && REVEAL,
          )}
        >
          {item.badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Brand lockup: the crest at 36px next to the wordmark. The design sets the
 * wordmark in the display face at 11px with wide tracking, and puts the season
 * and league size beneath it as a single dim line.
 */
function BrandHeader({ collapsible }: { collapsible?: boolean }) {
  return (
    <Link
      href="/"
      title={collapsible ? LEAGUE.name : undefined}
      className="flex items-center pt-4 pb-4 transition-opacity hover:opacity-90"
    >
      <span className={ICON_SLOT}>
        <Image
          src="/brand/crest-v2-256.png"
          alt=""
          width={33}
          height={36}
          className="shrink-0 rounded-[3px] object-contain"
          priority
        />
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-col gap-0.5 uppercase",
          collapsible && REVEAL,
        )}
      >
        <span className="font-display text-foreground text-[11px] leading-none font-bold tracking-[0.14em] whitespace-nowrap">
          {LEAGUE.shortName}
        </span>
        <span className="text-sidebar-section text-[9px] leading-none font-semibold tracking-[0.11em] whitespace-nowrap">
          {CURRENT_SEASON} · {LEAGUE.teams}-Team
        </span>
      </span>
    </Link>
  );
}

/**
 * A group heading. Collapsed there is no room for the words, so a short centred
 * rule stands in for them: the three groups still read as three groups, which is
 * the only job the heading does at icon size.
 */
function NavHeading({
  heading,
  collapsible,
}: {
  heading: string;
  collapsible?: boolean;
}) {
  if (!collapsible) {
    return (
      <div className="text-sidebar-section px-5 pb-1.5 text-[9px] font-bold tracking-[0.22em] whitespace-nowrap uppercase">
        {heading}
      </div>
    );
  }
  return (
    <div className="relative mb-1 h-[13px]">
      <span
        aria-hidden
        className="bg-sidebar-border absolute top-1/2 left-8 h-px w-4 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200 group-hover/rail:opacity-0 group-has-[:focus-visible]/rail:opacity-0 motion-reduce:transition-none"
      />
      <div
        className={cn(
          "text-sidebar-section absolute inset-y-0 left-5 flex items-center text-[9px] font-bold tracking-[0.22em] whitespace-nowrap uppercase",
          REVEAL,
        )}
      >
        {heading}
      </div>
    </div>
  );
}

function SidebarNav({
  onNavigate,
  collapsible,
}: {
  onNavigate?: () => void;
  collapsible?: boolean;
}) {
  const pathname = usePathname();
  /*
   * `gap-5`, not `gap-8`. Four sections meant three 32px gaps — 96px of pure
   * air — and with thirteen destinations the list wanted 582px, which put a
   * scrollbar in the rail on any window shorter than about 745px. Nothing here
   * is worth scrolling for: it is the whole app's navigation and it should be
   * one glance. Each section is already fenced off by its own heading and
   * divider, so 20px is ample separation.
   */
  return (
    <nav className="flex flex-col gap-4 pt-1 pb-2">
      {NAV.map((group) => (
        <div key={group.heading} className="flex flex-col gap-px">
          <NavHeading heading={group.heading} collapsible={collapsible} />
          {group.items.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <NavLink
                key={item.href}
                item={item}
                active={active}
                onNavigate={onNavigate}
                collapsible={collapsible}
              />
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/*
 * The design's footer is the signed-in manager's franchise. This app has no
 * accounts, so the same slot carries the thing that is actually true and worth
 * having always on screen: which season is open and how long the keeper clock is.
 */
function SidebarFooter({ collapsible }: { collapsible?: boolean }) {
  return (
    <div className="border-sidebar-border flex items-center border-t pt-3 pb-3">
      <span
        className={ICON_SLOT}
        title={collapsible ? `${CURRENT_SEASON} ${SEASON_LABEL} · ${SEASON_NOTE}` : undefined}
      >
        <span className="bg-primary text-primary-foreground flex size-[30px] shrink-0 items-center justify-center rounded-[3px] text-[11px] font-extrabold">
          {CURRENT_SEASON.toString().slice(-2)}
        </span>
      </span>
      <span
        className={cn(
          "flex min-w-0 flex-1 flex-col gap-0.5",
          collapsible && REVEAL,
        )}
      >
        <span className="text-foreground truncate text-[12px] leading-none font-semibold">
          {CURRENT_SEASON} {SEASON_LABEL}
        </span>
        <span className="text-sidebar-section truncate text-[9px] leading-none">
          {SEASON_NOTE}
        </span>
      </span>
      <Link
        href="/scoring"
        aria-label="Scoring and league settings"
        className={cn(
          "text-sidebar-foreground/70 hover:text-foreground mr-4 transition-colors",
          collapsible && REVEAL,
        )}
      >
        <Settings className="h-[13px] w-[13px]" />
      </Link>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      {/*
       * Desktop: the page is laid out against the collapsed rail, and the rail
       * itself expands over the top of it. Expanding in flow would reflow every
       * page — including the draft board, whose columns are sized to the viewport
       * — on a mouse-over, so it floats instead and casts a shadow when open.
       */}
      {/*
       * The rail is gated on a FINE pointer, not just on width, and that is the
       * one change here that is not cosmetic. It reveals its labels on hover and
       * on nothing else, so on a touch device it is thirteen unlabelled icons
       * with no way to find out what they are. A phone turned sideways is 915px
       * across — comfortably past `md` — so width alone was handing exactly that
       * to every league member who rotated their handset. Coarse pointers get
       * the bar and its sheet instead, which has never needed a hover.
       */}
      <aside className="hidden w-16 shrink-0 md:[@media(pointer:fine)]:block">
        <div
          className={cn(
            "group/rail bg-sidebar border-sidebar-border fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r",
            "transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none",
            /*
             * `has-[:focus-visible]` rather than `focus-within`. A mouse click
             * on a nav link leaves that link focused, and `focus-within` kept
             * the rail expanded after the route changed — you had to click the
             * page to dismiss it. `:focus-visible` does not match a
             * mouse-clicked link, so the rail collapses on navigation while
             * still opening for a keyboard Tab.
             *
             * If you change this condition, change `REVEAL` and `NavHeading`'s
             * rule with it. See the note above `ICON_SLOT`.
             */
            "w-16 hover:w-[232px] has-[:focus-visible]:w-[232px]",
            "hover:shadow-2xl hover:shadow-black/50 has-[:focus-visible]:shadow-2xl has-[:focus-visible]:shadow-black/50",
          )}
        >
          <BrandHeader collapsible />
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("open-command"))}
            title="Search (⌘K)"
            className="text-muted-foreground hover:text-foreground flex h-8 items-center pr-5 text-[12px] transition-colors"
          >
            <span className={ICON_SLOT}>
              <Search className="h-3.5 w-3.5 shrink-0" />
            </span>
            <span className={cn("flex-1 text-left", REVEAL)}>Search…</span>
            <kbd
              className={cn(
                "border-border text-muted-foreground/70 rounded-sm border px-1 py-px text-[9px]",
                REVEAL,
              )}
            >
              ⌘K
            </kbd>
          </button>
          {/*
           * Overflow with no visible scrollbar. After the spacing in
           * `SidebarNav` the list fits every realistic window, so this is only
           * a safety net for a very short one — and in a 64px rail a scrollbar
           * track is worse than a wheel that quietly still works. The mobile
           * sheet below keeps its real `ScrollArea`, where scrolling a long
           * list is expected.
           */}
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <SidebarNav collapsible />
          </div>
          <SidebarFooter collapsible />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 border-border sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-xl md:[@media(pointer:fine)]:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                variant="outline"
                size="icon"
                className="h-9 w-9 touch:h-11 touch:w-11"
              />
              }
            >
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="bg-sidebar flex max-h-[100dvh] w-[232px] flex-col p-0"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <BrandHeader />
              <ScrollArea className="min-h-0 flex-1">
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </ScrollArea>
              <SidebarFooter />
            </SheetContent>
          </Sheet>
          <Image
            src="/brand/crest-v2-256.png"
            alt=""
            width={26}
            height={28}
            className="shrink-0 rounded-[3px] object-contain"
          />
          <span className="font-display text-foreground text-[11px] font-bold uppercase tracking-[0.14em]">
            {LEAGUE.shortName}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="ml-auto h-9 w-9 touch:h-11 touch:w-11"
            onClick={() => window.dispatchEvent(new Event("open-command"))}
          >
            <Search className="h-4 w-4" />
            <span className="sr-only">Search</span>
          </Button>
        </header>
        <main className="flex-1">{children}</main>
      </div>
      <CommandPalette />
    </div>
  );
}

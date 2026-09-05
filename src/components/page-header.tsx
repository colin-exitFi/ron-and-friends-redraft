import { LEAGUE } from "@/lib/league-config";

export function PageHeader({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  children?: React.ReactNode;
}) {
  return (
    /*
     * THE BAND SHRINKS ON A PHONE HELD UPRIGHT, AND NOWHERE ELSE.
     *
     * At 412x915 this was costing about 130px before a word of the page under
     * it — a 28px title over a three-line description, with 48px of padding
     * around them — and on the pages that carry buttons up here it was more,
     * because the row stacks below `sm`. Seven per cent of the screen is a
     * reasonable price for a masthead on a 27" monitor and a poor one on a
     * phone, where the thing you came for is the table.
     *
     * `portrait:` and not just a width breakpoint: a phone turned sideways is
     * 915px across, sits above `md`, and gets the desktop band unchanged —
     * which is right, because sideways the shortage is height and this band is
     * only tall in proportion to a narrow column of text.
     */
    <div className="relative overflow-hidden px-6 pt-7 pb-5 max-md:portrait:px-4 max-md:portrait:pt-4 max-md:portrait:pb-3 md:px-8">
      {/* The grid is on the page canvas. The header keeps a second warm wash on
       * top of the canvas one, so the band still lifts away from the body
       * without competing with the title. */}
      <div className="bg-wash-primary pointer-events-none absolute inset-0" />
      {/*
       * THE ACTIONS SIT ON THE TITLE LINE, NOT ON THE LAST LINE OF THE BLURB.
       *
     * They used to be the second half of a `sm:items-end` row whose first half
       * was title AND description, which meant their vertical position was
       * decided by however many lines the description happened to wrap to. On
       * the recap tab that is two, so "Write a new recap" floated halfway down
       * the band level with a sentence fragment, with the title's whole
       * right-hand side empty above it. It read as a button that had slipped
       * rather than one that had been placed.
       *
       * Title and actions are now their own row, bottom-aligned to each other,
       * and the description runs underneath both at its own measure. The
       * actions are then level with the largest thing in the band at every
       * width, and the description's length cannot move them.
       */}
      <div className="relative flex flex-col gap-3 max-md:portrait:gap-2">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1.5 max-md:portrait:gap-1">
            <div className="text-primary text-eyebrow text-[10px] max-md:portrait:text-[9px]">
              {eyebrow ?? LEAGUE.shortName}
            </div>
            {/*
              `leading-[1.25]`, not `leading-none`. Inter's ascender-to-
              descender box is about 1.21em, so a line box the height of the
              font size leaves the glyphs overflowing it — harmless here only
              because the band has padding, and a layout audit that measures
              clipping flags every heading on the page for it.
            */}
            <h1 className="text-[28px] leading-[1.25] font-bold max-md:portrait:text-[19px]">
              {title}
            </h1>
          </div>
          {children && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {children}
            </div>
          )}
        </div>
        {description && (
          <p className="text-muted-foreground max-w-2xl text-[13px] leading-relaxed max-md:portrait:text-[12px] max-md:portrait:leading-snug">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6 px-6 pb-10 max-md:portrait:gap-4 max-md:portrait:px-3 md:px-8">
      {children}
    </div>
  );
}

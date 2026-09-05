import { cn } from "@/lib/utils";

/**
 * A single headline number. The label is set in the small letterspaced mono
 * style used for every minor label in the app, so a row of these reads as one
 * band of labels above one band of numbers.
 *
 * Values are tabular so a row of stats does not jitter when they refresh.
 *
 * **How a row stays aligned.** Tiles in a grid all take the height of the
 * tallest, and the parts are pinned to opposite ends of that height: the label
 * to the top, the value and hint to the bottom. So a label that wraps to two
 * lines in one tile eats slack in the middle of that tile instead of pushing its
 * own value below its neighbours'. Getting this wrong is what made the dashboard
 * numbers sit at four different heights.
 *
 * Two things this relies on: the hint is held to one line, and every tile in a
 * row either has a hint or none do — a row of mixed tiles has two different
 * bottom-block heights and the values part company again.
 */
function Stat({
  label,
  value,
  hint,
  tone = "default",
  variant = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "warn" | "accent";
  /**
   * `display` sets the value in the display face, as the dashboard's four
   * headline numbers do. Reserved for hero surfaces — a page full of it stops
   * reading as data and starts reading as branding.
   */
  variant?: "default" | "display";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card flex flex-col justify-between gap-2.5 rounded-lg border px-5 py-4",
        /* The accent tile is lit from its corner and warms its border, so the one
         * number that matters most on a page stands out of the row without
         * changing size. Ternary rather than an override because two competing
         * border-colour utilities resolve by stylesheet order, not class order. */
        tone === "accent"
          ? "border-primary/25 bg-wash-accent"
          : "border-border",
        className,
      )}
    >
      <span
        className={cn(
          "text-muted-foreground uppercase",
          variant === "display"
            ? "text-[9px] leading-[1.4] font-bold tracking-[0.2em]"
            : "font-mono text-[10px] leading-[1.4] font-medium tracking-[0.12em]",
        )}
      >
        {label}
      </span>
      <span className="flex flex-col gap-1">
        <span
          className={cn(
            "leading-none font-bold tabular-nums",
            variant === "display" ? "font-display text-[26px]" : "text-[28px]",
            tone === "warn" && "text-destructive",
            tone === "accent" && "text-primary",
          )}
        >
          {value}
        </span>
        {hint && (
          /* One line, always. A hint that wrapped would lift this tile's value
           * off the baseline its neighbours sit on. Hints are authored short, so
           * the clamp is a guard rail rather than something readers hit. */
          <span className="text-muted-foreground truncate text-[11px] leading-snug">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

export { Stat };

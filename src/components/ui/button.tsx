import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // 4px radius and Inter Semi Bold, per the design's Button component.
  "group/button inline-flex shrink-0 items-center justify-center rounded-sm border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /*
         * Hover is a real second swatch from the palette (#0ea5e9), not the fill
         * at 85%. Fading a light accent toward a near-black canvas dulls it,
         * which is the wrong direction for a hover; shifting hue toward blue
         * keeps the same energy and still reads as a state change.
         */
        default: "bg-primary text-primary-foreground hover:bg-primary-hover",
        outline:
          "border-border bg-transparent hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        /* The design's ghost is accent-coloured text, not neutral. */
        ghost:
          "text-primary hover:bg-muted aria-expanded:bg-muted dark:hover:bg-muted/50",
        /* Solid in the design rather than the tinted shadcn default. */
        destructive:
          "bg-destructive text-white hover:bg-destructive/85 focus-visible:ring-destructive/30",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-10",
      },
    },
    /*
     * A soft halo on the solid accent button, growing on hover rather than
     * appearing from nothing.
     *
     * Restricted to the full-size button on purpose: the accent fill is also how
     * an active filter chip is drawn, and a row of glowing chips reads as four
     * competing calls to action. At `default` and `lg` the button really is the
     * next thing to press.
     */
    compoundVariants: [
      {
        variant: "default",
        size: ["default", "lg"],
        className: "glow-cta hover:shadow-[0_0_26px_-4px_var(--primary-a60)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

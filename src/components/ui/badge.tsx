import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * The design's badge is a 4px-radius rectangle, not a pill: Inter Bold at 10px
 * with 0.5px tracking, 8x3 padding.
 *
 * Casing is deliberately left to the call site. The design uppercases its badge
 * text, but it only ever showed a fixed status vocabulary; this app also puts
 * counts and sentence-case labels in badges, and forcing uppercase by severity
 * split matched pairs — "YEAR 2 OF 2" shouting next to a quiet "Year 1 of 2".
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-[3px] text-[10px] leading-none font-bold tracking-[0.05em] whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        /* Dark on the cyan fill: white would be 2.3:1 here. */
        default:
          "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary:
          "bg-secondary text-muted-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-destructive text-white",
        success: "bg-success text-white",
        info: "bg-info text-white",
        /* Amber is light, so these two take black rather than white. */
        warning: "bg-warning text-black",
        keeper: "bg-keeper text-black",
        /* `--trade` is a near-white, so this knocks out dark — at 19.1:1, the
         * highest-contrast pair in the set. */
        trade: "bg-trade text-background",
        outline:
          "border-border text-muted-foreground [a]:hover:bg-muted [a]:hover:text-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };

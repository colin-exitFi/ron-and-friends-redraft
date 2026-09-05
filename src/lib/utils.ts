import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The project's own `bg-*` utilities all paint a `background-image` — the page
 * canvas, the micro-grid, the ambient washes.
 *
 * tailwind-merge has to be told, because it matches `bg-<anything>` as a
 * background *colour* and so treats `bg-card bg-wash-accent` as one class
 * fighting another and silently drops the first. That is not theoretical: it
 * stripped the fill off the accent stat tile, which rendered with a transparent
 * background until this was registered.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "bg-image": [
        "bg-canvas",
        "bg-grid",
        "bg-field",
        "bg-wash-primary",
        "bg-wash-hero",
        "bg-wash-accent",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

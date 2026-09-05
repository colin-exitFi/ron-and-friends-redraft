import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Lets a verification build or a throwaway server use its own build
   * directory. The commissioner keeps a dev server running on `.next`, and a
   * concurrent `next build` writing into the same place corrupts the Turbopack
   * cache underneath him. Defaults to `.next`, so nothing changes unless the
   * variable is set:
   *
   *   NEXT_DIST_DIR=.next-verify npm run build
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Smart Draft snapshots are read with `fs` at request time, so tracing
  // cannot infer them from imports. Without this they are absent in production.
  outputFileTracingIncludes: {
    "/**": ["./data/*.json"],
  },
};

export default nextConfig;

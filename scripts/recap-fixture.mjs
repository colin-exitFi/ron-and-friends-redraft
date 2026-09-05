/**
 * A finished board and a recap of it, for the browser check.
 *
 * Split out of `verify-recap-browser.mjs` because building the board needs the
 * TypeScript modules under `src/lib`, which need the `@/*` alias and the
 * `server-only` stub that `scripts/draft-loader.mjs` installs — and Playwright
 * does not. Loading it through a child process keeps the two requirements from
 * fighting.
 *
 * The recap is a FIXTURE. Its blurbs are written here rather than generated,
 * so the check costs nothing and takes no network: what it proves is that a
 * stored recap reaches the screen with its receipts, not that Claude is funny.
 * Real generations belong in `npm run experiment:recap`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

/** Runs the board build in a child process that has the loader installed. */
export async function fixture() {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--no-warnings",
      "--import",
      path.join(process.cwd(), "scripts", "draft-loader.mjs"),
      path.join(process.cwd(), "scripts", "recap-fixture-board.mts"),
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  if (result.status !== 0) {
    throw new Error(`Could not build the fixture board:\n${result.stderr}`);
  }

  return JSON.parse(result.stdout);
}

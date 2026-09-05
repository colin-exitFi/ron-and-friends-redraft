/**
 * Module hooks that let plain `node` run the app's server modules.
 *
 * Two things stand in the way of importing `src/lib/*` outside Next:
 *
 *   1. the `@/*` -> `./src/*` path alias from `tsconfig.json`, which Node knows
 *      nothing about.
 *   2. `import "server-only"`, which is not an installed package — Next resolves
 *      it internally as a build-time guard against a server module reaching a
 *      client bundle. Outside Next there is no client bundle, so it is stubbed
 *      to an empty module.
 *
 * A separate file from `scripts/ts-alias.mjs` on purpose: that one is used by
 * another verification script, and widening it would be a shared-file change for
 * a need only this script has.
 *
 *   node --experimental-strip-types --import ./scripts/seed-verify-loader.mjs <script.mts>
 */
import { register } from "node:module";

if (!process.env.__UKL_VERIFY_LOADER) {
  process.env.__UKL_VERIFY_LOADER = "1";
  register(import.meta.url);
}

const SRC = new URL("../src/", import.meta.url).href;

const STUBBED = new Set(["server-only", "client-only"]);

export function resolve(specifier, context, next) {
  if (STUBBED.has(specifier)) {
    return { url: `ukl-stub:${specifier}`, shortCircuit: true, format: "module" };
  }
  if (specifier.startsWith("@/")) {
    return next(`${SRC}${specifier.slice(2)}.ts`, context);
  }
  return next(specifier, context);
}

export function load(url, context, next) {
  if (url.startsWith("ukl-stub:")) {
    return { format: "module", source: "export {};", shortCircuit: true };
  }
  return next(url, context);
}

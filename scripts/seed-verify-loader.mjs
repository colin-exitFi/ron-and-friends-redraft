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
    return next(`${SRC}${aliased(specifier)}`, context);
  }
  return next(specifier, context);
}

/**
 * Turns `@/lib/foo` into `lib/foo.ts`, and leaves `@/lib/foo.mjs` alone.
 *
 * The `.ts` suits the alias' usual case — app modules, all TypeScript, imported
 * without an extension — but must not be appended to a specifier that already
 * has one. `@/lib/db-schema.mjs` is a real `.mjs` file, shared with the
 * plain-`node` scripts that cannot import TypeScript.
 */
function aliased(specifier) {
  const path = specifier.slice(2);
  return /\.(m?[jt]sx?|cjs|cts|json)$/.test(path) ? path : `${path}.ts`;
}

export function load(url, context, next) {
  if (url.startsWith("ukl-stub:")) {
    return { format: "module", source: "export {};", shortCircuit: true };
  }
  return next(url, context);
}

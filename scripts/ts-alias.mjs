/**
 * Lets plain `node` run the app's TypeScript modules, so verification scripts can
 * exercise the real `src/lib` code instead of a copy of its logic.
 *
 * Node can strip types on its own (`--experimental-strip-types`) but knows
 * nothing about the `@/*` -> `./src/*` alias in `tsconfig.json`, so this adds a
 * resolve hook for it.
 *
 * The file is both the bootstrap and the hook module. `register()` runs hooks on
 * a separate thread and loads this same file there; the env flag is inherited by
 * that thread and stops it registering itself again.
 *
 *   node --experimental-strip-types --import ./scripts/ts-alias.mjs <script.mts>
 */
import { register } from "node:module";

if (!process.env.__UKL_TS_ALIAS) {
  process.env.__UKL_TS_ALIAS = "1";
  register(import.meta.url);
}

const SRC = new URL("../src/", import.meta.url).href;

export function resolve(specifier, context, next) {
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

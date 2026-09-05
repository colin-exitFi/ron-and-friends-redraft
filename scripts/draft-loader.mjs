/**
 * Module loader for the draft verification scripts.
 *
 * Does what `scripts/ts-alias.mjs` does — teach plain `node` the `@/*` alias so
 * a script can exercise the real `src/lib` modules rather than a copy of their
 * logic — and additionally stubs `server-only`.
 *
 * `server-only` is a Next.js build-time guard: importing it from a client
 * bundle is meant to fail. Outside Next there is no bundle to guard, and the
 * package's main entry throws on purpose, so `@/lib/draft-store` and
 * `@/lib/smartdraft` would be unloadable without this. Stubbing it is what lets
 * the simulation drive the ACTUAL persistence layer the draft will run on
 * instead of a stand-in.
 *
 *   node --experimental-strip-types --import ./scripts/draft-loader.mjs <script.mts>
 */
import { register } from "node:module";

if (!process.env.__UKL_DRAFT_LOADER) {
  process.env.__UKL_DRAFT_LOADER = "1";
  register(import.meta.url);
}

const SRC = new URL("../src/", import.meta.url).href;

export function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: "data:text/javascript,export{}", shortCircuit: true, format: "module" };
  }
  if (specifier.startsWith("@/")) {
    return next(`${SRC}${aliased(specifier)}`, context);
  }
  return next(specifier, context);
}

/**
 * Turns `@/lib/foo` into `lib/foo.ts`, and leaves `@/lib/foo.mjs` alone.
 *
 * The `.ts` is a convenience for the alias' usual case — app modules, which are
 * all TypeScript and are imported without an extension. It must not be appended
 * to a specifier that already carries one: `@/lib/db-schema.mjs` is a real
 * `.mjs` file (it is shared with the plain-`node` scripts, which cannot import
 * TypeScript), and blindly appending asked for `schema.mjs.ts` and brought down
 * every script that loads the app's Supabase client.
 */
export function aliased(specifier) {
  const path = specifier.slice(2);
  return /\.(m?[jt]sx?|cjs|cts|json)$/.test(path) ? path : `${path}.ts`;
}

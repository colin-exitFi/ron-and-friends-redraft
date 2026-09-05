import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      /*
       * An underscore prefix is how this repo says "this name exists so that
       * the one beside it can be taken away". `const { boardFingerprint:
       * _dropped, ...rest } = doc` is the only way to write "a document from
       * before that field existed", and there is nothing to do with the
       * binding afterwards. Reported as a defect it teaches the reader that
       * the warnings are noise, which is how the real ones get skimmed past.
       */
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The verification builds' own dist dirs. `next.config.ts` lets a check
    // build into `.next-<name>` via NEXT_DIST_DIR so it cannot corrupt the
    // running dev server's cache, and .gitignore already treats `/.next-*/` as
    // build output. Without this, `npm run lint` walks whatever build dirs
    // happen to be lying around and buries the real errors — it reported
    // 49,164 problems against six actual ones — which makes the check nobody
    // can read the check nobody runs before a push.
    ".next-*/**",
    // Throwaway probes. `scripts/.tmp/` is never walked at all — ESLint skips
    // dot directories — and a `tmp-` prefix one level up means the same thing:
    // a file written to answer a single question and deleted afterwards. They
    // are untracked and they never ship, so a half-finished probe's spare
    // variable must not be able to fail the check that guards a push.
    "scripts/tmp-*",
  ]),
]);

export default eslintConfig;

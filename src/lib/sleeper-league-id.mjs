/**
 * The Sleeper league this app is pointed at.
 *
 * A `.mjs` file with no imports so that plain Node scripts and the Next.js app
 * can both read it without a TypeScript loader or a build step. It is a public
 * identifier — the number in the league's own URL — not a secret, which is why
 * it is committed rather than held in an env var: pointing the board at a
 * different league should be a reviewable one-line change, not an
 * undocumented value in a dashboard somewhere.
 */
export const SLEEPER_LEAGUE_ID = "1394372619427381248";

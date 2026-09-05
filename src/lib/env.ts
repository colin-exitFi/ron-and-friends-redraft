/**
 * Centralized, validated access to environment variables.
 * Throws early with a clear message if a required value is missing.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to .env.local (see .env.example).`,
    );
  }
  return value;
}

/**
 * Browser-safe values (prefixed NEXT_PUBLIC_).
 *
 * Read lazily, not at module scope: the draft board and player pool are backed
 * by local snapshots and need no database, so importing a Supabase module must
 * not blow up a build that has no Supabase credentials yet.
 */
export function getPublicEnv() {
  return {
    supabaseUrl: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    supabaseAnonKey: required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  };
}

/**
 * Whether the league database is wired up yet.
 *
 * The draft board and player pool are backed by the Smart Draft snapshots and
 * need no database, so the surfaces that DO need one check this and explain
 * themselves rather than throwing a stack trace at the commissioner.
 */
export function hasDatabase(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Server-only secrets. Accessing this from client code will fail because the
 * variables are undefined in the browser bundle.
 */
export function getServerEnv() {
  return {
    supabaseUrl: required(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    ),
    supabaseServiceRoleKey: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
  };
}

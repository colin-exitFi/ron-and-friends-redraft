import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";
import { DB_SCHEMA } from "@/lib/db-schema.mjs";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-side Supabase client using the service-role key. This BYPASSES RLS and
 * must NEVER be imported into client components. Use it in Server Components,
 * Route Handlers, and Server Actions for all writes and privileged reads.
 *
 * In v1 there is no Supabase Auth, so there is no per-request user session to
 * forward; access control happens in the server route (e.g. per-team passcode).
 *
 * `db.schema` IS LOAD-BEARING AND NOT A TIDINESS OPTION. This key bypasses RLS,
 * and `public` on this project is the live backend for
 * ron-and-friends-fantasy.vercel.app. Fourteen of that schema's table names are
 * also ours — teams, trades, keepers, draft_state and the rest — so a client
 * that lost this option would not error on a write. It would overwrite the
 * other league's rows with this one's.
 */
export function createServiceClient() {
  const env = getServerEnv();
  return createSupabaseClient<Database>(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    {
      db: { schema: DB_SCHEMA },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

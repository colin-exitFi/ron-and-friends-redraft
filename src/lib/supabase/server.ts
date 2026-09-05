import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Server-side Supabase client using the service-role key. This BYPASSES RLS and
 * must NEVER be imported into client components. Use it in Server Components,
 * Route Handlers, and Server Actions for all writes and privileged reads.
 *
 * In v1 there is no Supabase Auth, so there is no per-request user session to
 * forward; access control happens in the server route (e.g. per-team passcode).
 */
export function createServiceClient() {
  const env = getServerEnv();
  return createSupabaseClient<Database>(
    env.supabaseUrl,
    env.supabaseServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

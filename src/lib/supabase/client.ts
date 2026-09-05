import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";
import { DB_SCHEMA } from "@/lib/db-schema.mjs";
import type { Database } from "@/lib/supabase/types";

/**
 * Browser Supabase client (anon/publishable key). Read-only in v1: RLS grants
 * SELECT to anon, all writes go through server routes using the service role.
 * Use this for client components and Realtime subscriptions (e.g. the draft
 * board).
 *
 * `db.schema` governs `.from(...)` only. IT DOES NOT REACH REALTIME — a
 * `postgres_changes` subscription carries its own `schema` and defaults to
 * `public` regardless of what is set here. Callers that subscribe must pass
 * `DB_SCHEMA` themselves; see the note in `@/lib/db-schema.mjs`.
 */
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    db: { schema: DB_SCHEMA },
  });
}

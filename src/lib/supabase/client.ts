import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";

/**
 * Browser Supabase client (anon/publishable key). Read-only in v1: RLS grants
 * SELECT to anon, all writes go through server routes using the service role.
 * Use this for client components and Realtime subscriptions (e.g. the draft
 * board).
 */
export function createClient() {
  const env = getPublicEnv();
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
}

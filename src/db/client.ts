import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../env";

/**
 * Untyped Supabase client. supabase-js's generated `Database` generic is finicky
 * (it collapses to `never` on a hand-written schema), and the payoff — column-name
 * checking — isn't worth the friction for a single-owner tool. Instead the service
 * layer annotates results with the row types in ./types when it shapes them.
 */
export type Db = SupabaseClient;

/**
 * Server-side client using the service-role key. It bypasses RLS, so every query
 * in the service layer MUST filter by `SETOS_USER_ID` — the row-level safety net
 * is not in play here.
 *
 * A fresh client per request: Workers isolate requests, and there's no benefit to
 * a module-level singleton (module state isn't reliably reused between requests).
 */
export function createDb(env: Env): Db {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

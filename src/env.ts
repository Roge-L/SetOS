/**
 * Worker bindings + secrets. Secrets are set with `wrangler secret put` and are
 * therefore NOT in wrangler.jsonc; this interface is the single source of truth
 * for what the worker expects at runtime.
 */
export interface Env {
  /** The `Authorization: Bearer <value>` your Claude client must send. */
  MCP_BEARER_TOKEN: string;

  /** Supabase project URL, e.g. https://<ref>.supabase.co */
  SUPABASE_URL: string;
  /** Service-role key — server-side only, bypasses RLS. Never ships to a client. */
  SUPABASE_SERVICE_ROLE_KEY: string;

  /** The public.users uuid every row is scoped to (SetOS is single-user). */
  SETOS_USER_ID: string;

  /**
   * IANA timezone for "today" and day boundaries. MUST match the timezone baked
   * into the recalculate_daily_totals() SQL function (America/New_York) or daily
   * totals and per-day reads will disagree on which day a late-night meal belongs to.
   */
  SETOS_TIMEZONE: string;

  /** FatSecret OAuth credentials — optional; only `lookup_food` needs them. */
  FATSECRET_ID?: string;
  FATSECRET_SECRET?: string;
}

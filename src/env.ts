/**
 * Worker bindings + secrets. Secrets are set with `wrangler secret put` and are
 * therefore NOT in wrangler.jsonc; this interface is the single source of truth
 * for what the worker expects at runtime.
 *
 * Note what is gone since v2: SETOS_USER_ID, SETOS_TIMEZONE, and
 * SETOS_CONSENT_PASSPHRASE. The first two were server-wide answers to per-person
 * questions; the third was a shared secret that couldn't tell one holder from
 * another. Identity now comes from the caller's OAuth grant, and timezone from
 * their row in `public.users`.
 */
export interface Env {
  /** OAuth client/grant/token storage for @cloudflare/workers-oauth-provider. */
  OAUTH_KV: KVNamespace;

  /**
   * HMAC key for the signed blob that carries the in-flight MCP authorization
   * request between the sign-in form and its submission. Any long random string.
   */
  SETOS_STATE_SECRET: string;

  /** Supabase project URL, e.g. https://<ref>.supabase.co (non-secret, a var). */
  SUPABASE_URL: string;

  /**
   * Anon key. Carries no authority on its own — on the request path it is paired
   * with a per-request user JWT and RLS decides what that caller can see; at
   * sign-in it is what `signInWithPassword` authenticates against.
   */
  SUPABASE_ANON_KEY: string;

  /**
   * Legacy Supabase JWT secret (Dashboard → Project Settings → API → JWT keys).
   * Signs the short-lived per-user Postgres JWT that makes `auth.uid()` resolve,
   * which is what finally arms the RLS policies from migration 001.
   */
  SUPABASE_JWT_SECRET: string;

  /**
   * Service-role key — bypasses RLS. Used ONLY to read the invite list by email
   * during sign-in, before there is any user identity to scope the query to.
   * Never reaches a tool handler.
   */
  SUPABASE_SERVICE_ROLE_KEY: string;

  /** FatSecret OAuth credentials — optional; only `setos_lookup_food` needs them. */
  FATSECRET_ID?: string;
  FATSECRET_SECRET?: string;
}

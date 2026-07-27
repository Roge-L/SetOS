import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { signJwtES256, type SigningKeyJwk } from "../lib/crypto";
import type { Env } from "../env";

/**
 * Untyped Supabase client. supabase-js's generated `Database` generic is finicky
 * (it collapses to `never` on a hand-written schema), and the payoff — column-name
 * checking — isn't worth the friction here. Instead the service layer annotates
 * results with the row types in ./types when it shapes them.
 */
export type Db = SupabaseClient;

/** A user JWT only has to outlive the single request it was minted for. */
const JWT_TTL_SECONDS = 120;

/** Parsed once per isolate; the JWK is a static secret. */
let parsedKey: SigningKeyJwk | null = null;

function signingKeyFrom(env: Env): SigningKeyJwk {
  if (!parsedKey) {
    if (!env.SUPABASE_SIGNING_KEY) {
      throw new Error("SUPABASE_SIGNING_KEY is not set — the worker cannot authenticate to Postgres.");
    }
    parsedKey = JSON.parse(env.SUPABASE_SIGNING_KEY) as SigningKeyJwk;
  }
  return parsedKey;
}

/**
 * The client used for ALL user data.
 *
 * Every query in the service layer already filters on `user_id`, and that stays
 * the primary defense. This is the second one: requests carry a JWT whose `sub`
 * is the authenticated user, so PostgREST populates `auth.uid()` and the RLS
 * policies from db/migrations/001 actually run — until now they never have,
 * because the worker always spoke as the service role.
 *
 * The point is the failure mode. If someone later adds a query that forgets its
 * `.eq("user_id", …)`, the database returns that user's own rows instead of
 * everyone's: the bug shows up as missing data, not as a cross-tenant leak.
 *
 * This is why the service-role key must NOT be used on the request path — it
 * bypasses RLS entirely and would silently disarm all of the above.
 *
 * The token is signed ES256 with our own key, imported into Supabase's
 * signing-key system as a STANDBY key. Standby keys are published in the JWKS,
 * so Postgres verifies our tokens, while Supabase Auth keeps signing real user
 * sessions with its own current key. Deliberately NOT rotated to ours: rotating
 * would make this worker's secret the signing key for every session token in the
 * project — far more authority than minting our own service tokens needs.
 *
 * A fresh client per request: Workers isolate requests, and there's no benefit to
 * a module-level singleton (module state isn't reliably reused between requests).
 */
export function createUserDb(env: Env, userId: string): Db {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase-js calls this per request; mint a fresh short-lived Postgres JWT.
    accessToken: async () => {
      const now = Math.floor(Date.now() / 1000);
      return signJwtES256(signingKeyFrom(env), {
        sub: userId,
        role: "authenticated",
        aud: "authenticated",
        iss: "supabase",
        iat: now,
        exp: now + JWT_TTL_SECONDS,
      });
    },
  });
}

/**
 * Service-role client — bypasses RLS.
 *
 * Exactly one caller is legitimate: the sign-in path, which has to read the
 * allowlist in `public.users` by email *before* there is any user identity to
 * scope the query to. Never hand this to a tool handler.
 */
export function createAdminDb(env: Env): Db {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

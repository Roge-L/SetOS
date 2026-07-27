/**
 * Email + password sign-in, delegated to Supabase Auth.
 *
 * The worker deliberately does NOT hash passwords itself. A password hash has to
 * be slow on purpose — OWASP's floor for PBKDF2-HMAC-SHA256 is 600k iterations,
 * which is hundreds of milliseconds of CPU — and Workers Free allows 10ms of CPU
 * per request. Verifying a password in-process would either blow that limit or
 * force a weak iteration count, which is worse than not rolling our own at all.
 *
 * Supabase Auth already stores a bcrypt hash for these accounts and verifies it
 * server-side, so this costs the worker a network round-trip and ~0ms of CPU. It
 * also brings rate limiting, password-strength rules, and reset emails that we
 * would otherwise have to build.
 *
 * Note this is `signInWithPassword`, never `signUp`: accounts are created by the
 * owner in the Supabase dashboard. There is no self-signup path in this server.
 */

import { createClient } from "@supabase/supabase-js";
import type { Env } from "../env";

export interface VerifiedIdentity {
  /** auth.users.id, which is also public.users.id. */
  userId: string;
  email: string;
}

/**
 * Returns null when the credentials don't check out. The caller must not
 * distinguish "no such account" from "wrong password" in what it shows the
 * browser — that difference tells a stranger which addresses have accounts.
 */
export async function verifyPassword(
  env: Env,
  email: string,
  password: string
): Promise<VerifiedIdentity | null> {
  // Anon key + no session persistence: this client exists purely to make one
  // authenticated call and is thrown away with the request.
  const auth = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await auth.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  // Covers bad credentials, an unconfirmed address, and a banned account —
  // Supabase reports all of them as an error here, and all of them mean "no".
  if (error || !data.user) return null;

  return { userId: data.user.id, email: data.user.email ?? email };
}

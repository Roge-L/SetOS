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

/**
 * Change a password, having first proved the current one.
 *
 * `updateUser` needs an authenticated session, so signing in with the current
 * password is both the proof of possession OWASP asks for and the thing that
 * produces the session to update. Verified against Supabase: an `updateUser`
 * call with no session is refused outright ("Auth session missing!"), so there
 * is no path here that skips the check.
 *
 * Returns null on success, or a message safe to show the browser. Note this
 * does NOT invalidate anything — Supabase access tokens are self-contained JWTs
 * that stay valid until they expire, confirmed by experiment. Revoking the
 * user's SetOS grants is the caller's job, and is not optional.
 */
export async function changePassword(
  env: Env,
  email: string,
  currentPassword: string,
  newPassword: string
): Promise<{ userId: string } | { error: string }> {
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: currentPassword,
  });
  if (error || !data.user) return { error: "Incorrect email or current password." };

  const { error: updateError } = await client.auth.updateUser({ password: newPassword });
  if (updateError) {
    // Supabase enforces its own floor (6 chars) and rejects reuse of the current
    // password; surface its wording rather than inventing our own.
    return { error: updateError.message };
  }

  // Drop the session we just created. It is not needed again, and leaving it
  // alive would outlive the request for no reason.
  await client.auth.signOut();

  return { userId: data.user.id };
}

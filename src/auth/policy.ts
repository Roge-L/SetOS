/**
 * Password policy for SetOS.
 *
 * Deliberately short, because the research says the short version is the correct
 * one. NIST SP 800-63B recommends AGAINST composition rules (mixed case, digits,
 * symbols): analyses of breach corpora show users satisfy them in predictable
 * ways — `Password1!` — for a large usability cost and little real gain. What
 * actually helps is length and a breach check, so that is all this enforces.
 *
 * The 15-character minimum comes from the OWASP Authentication Cheat Sheet,
 * which asks for 8 with MFA or 15 without. SetOS has no MFA, so 15 it is. That
 * is long for a typed password and short for a passphrase — which is the point,
 * and why the form suggests a passphrase and spaces are allowed.
 *
 * Supabase's own server-side floor is 6 characters (verified against the live
 * project), so this is the binding constraint, not a duplicate of it.
 *
 * @see https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
 * @see https://pages.nist.gov/800-63-4/sp800-63b/passwords/
 */

import { pwnedCount } from "../lib/pwned";

export const MIN_LENGTH = 15;

/**
 * OWASP asks that at least 64 characters be accepted so passphrases aren't
 * penalised. The cap exists only to bound bcrypt work, and is far above any
 * real password — nothing is ever silently truncated.
 */
export const MAX_LENGTH = 128;

export interface PolicyFailure {
  message: string;
}

/**
 * Validate a proposed password. Returns null when it's acceptable.
 *
 * Order matters: the cheap local checks run first so an obviously bad password
 * never costs a network round-trip.
 */
export async function checkPassword(
  next: string,
  current: string
): Promise<PolicyFailure | null> {
  if (next.length < MIN_LENGTH) {
    return { message: `New password must be at least ${MIN_LENGTH} characters. A short phrase works well.` };
  }
  if (next.length > MAX_LENGTH) {
    return { message: `New password must be ${MAX_LENGTH} characters or fewer.` };
  }
  if (next === current) {
    return { message: "New password must be different from your current one." };
  }

  const breaches = await pwnedCount(next);
  if (breaches > 0) {
    return {
      message:
        `That password appears in known data breaches (${breaches.toLocaleString()} times), so it's a ` +
        `standard guess in credential-stuffing attacks. Please choose another.`,
    };
  }

  return null;
}

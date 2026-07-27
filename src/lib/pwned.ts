/**
 * Breached-password check against Have I Been Pwned's Pwned Passwords corpus.
 *
 * NIST SP 800-63B calls for comparing new passwords against a blocklist of
 * known-breached secrets — it is the single highest-value password check, far
 * more useful than composition rules (which the same document recommends
 * against). Supabase Auth can do this natively, but only on the Pro plan, so we
 * do it ourselves; the API is free and unauthenticated.
 *
 * The password never leaves the worker. HIBP's range API uses k-anonymity: we
 * send the FIRST FIVE hex characters of the password's SHA-1 and get back every
 * suffix sharing that prefix (~800 of them), then match locally. HIBP learns a
 * 5-character prefix, which is shared by hundreds of thousands of passwords.
 *
 * SHA-1 here is not protecting anything — it is the corpus's index, chosen by
 * HIBP. The actual password storage is bcrypt, inside Supabase.
 *
 * @see https://haveibeenpwned.com/API/v3#PwnedPasswords
 * @see https://pages.nist.gov/800-63-4/sp800-63b/passwords/
 */

const RANGE_API = "https://api.pwnedpasswords.com/range/";

async function sha1Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * How many times this password appears in known breaches, or 0.
 *
 * Returns 0 — i.e. fails OPEN — if HIBP is unreachable. That is deliberate: a
 * user changing their password is often doing so *because* something went wrong,
 * and blocking them because a third-party API is down would be worse than
 * missing one breach check. The rest of the policy still applies.
 */
export async function pwnedCount(password: string): Promise<number> {
  let body: string;
  try {
    const hash = await sha1Hex(password);
    const res = await fetch(`${RANGE_API}${hash.slice(0, 5)}`, {
      // Pads the response with random entries so its size can't be used to
      // infer whether the prefix matched anything.
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) return 0;
    body = await res.text();

    const suffix = hash.slice(5);
    // Scan for "SUFFIX:COUNT" rather than splitting 70KB into ~800 strings —
    // this runs inside a 10ms CPU budget on the Workers free plan.
    const at = body.indexOf(suffix);
    if (at === -1) return 0;

    const end = body.indexOf("\n", at);
    const line = end === -1 ? body.slice(at) : body.slice(at, end);
    const count = Number.parseInt(line.slice(suffix.length + 1), 10);
    // Padding entries are returned with a count of 0; treat them as absent.
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

/**
 * Base64url + HMAC-SHA256 helpers, on the Web Crypto API that Workers provide.
 *
 * Two callers with different needs share this: the OAuth handler seals the
 * in-flight authorization request with a detached HMAC, and the DB layer mints a
 * full HS256 JWT for Postgres. Both are the same primitive, so they live together.
 */

const encoder = new TextEncoder();

export function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

/** Base64url HMAC-SHA256 of `data` under `secret`. */
export async function hmacSha256(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(data));
  return b64urlEncode(new Uint8Array(sig));
}

/**
 * Constant-time compare. Used on secrets and signatures, where an early return
 * on the first differing byte leaks how much of a guess was correct.
 */
export function safeEqual(a: string, b: string): boolean {
  const ba = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

/** Sign a compact JWS (HS256) — what Postgres/PostgREST expects from us. */
export async function signJwtHS256(secret: string, claims: Record<string, unknown>): Promise<string> {
  const part = (o: unknown) => b64urlEncode(encoder.encode(JSON.stringify(o)));
  const signingInput = `${part({ alg: "HS256", typ: "JWT" })}.${part(claims)}`;
  return `${signingInput}.${await hmacSha256(secret, signingInput)}`;
}

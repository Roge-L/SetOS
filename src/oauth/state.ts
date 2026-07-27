/**
 * The `state` blob carried through the sign-in form.
 *
 * The worker is stateless, so the in-flight MCP authorization request has to
 * survive the gap between rendering the form (GET) and the credentials coming
 * back (POST). Putting it in a hidden field keeps it out of KV, but that field
 * is user-visible and user-editable — so it is HMAC-signed, and the redirect URI
 * inside it is re-validated after unsealing regardless. Signing is what stops
 * someone from swapping in their own redirect_uri after we approved the original.
 *
 * Confidentiality is not required (the contents are the client's own request),
 * so this is signed, not encrypted.
 */

import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { b64urlDecode, b64urlEncode, hmacSha256, safeEqual } from "../lib/crypto";

const encoder = new TextEncoder();

/** A sign-in must be completed reasonably promptly; stale blobs are replay bait. */
const MAX_AGE_MS = 10 * 60 * 1000;

export interface SealedState {
  /** The MCP client's original authorization request. */
  req: AuthRequest;
  /** Issued-at, epoch ms. */
  iat: number;
}

export async function sealState(secret: string, state: SealedState): Promise<string> {
  const payload = b64urlEncode(encoder.encode(JSON.stringify(state)));
  return `${payload}.${await hmacSha256(secret, payload)}`;
}

/** Returns null on a bad signature, malformed payload, or an expired blob. */
export async function unsealState(secret: string, sealed: string): Promise<SealedState | null> {
  const [payload, sig] = sealed.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(sig, await hmacSha256(secret, payload))) return null;

  let state: SealedState;
  try {
    state = JSON.parse(new TextDecoder().decode(b64urlDecode(payload))) as SealedState;
  } catch {
    return null;
  }

  if (typeof state.iat !== "number" || Date.now() - state.iat > MAX_AGE_MS) return null;
  if (!state.req) return null;
  return state;
}

/**
 * Static bearer-token auth for the MCP endpoint.
 *
 * This is deliberately isolated: it's the ONLY place that reads MCP_BEARER_TOKEN,
 * so swapping in OAuth later (e.g. @cloudflare/workers-oauth-provider, needed for
 * claude.ai web/mobile unless you have Anthropic's `static_headers` beta) means
 * replacing this one file — the tools and services never see auth.
 */

import type { Env } from "./env";

/** Constant-time comparison so a wrong token can't be recovered byte-by-byte. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": 'Bearer realm="setos"',
    },
  });
}

/**
 * Returns a 401 Response when the request is not authorized, or `null` when it is
 * (so the caller proceeds). Fails closed if the server has no token configured.
 */
export function requireBearer(request: Request, env: Env): Response | null {
  if (!env.MCP_BEARER_TOKEN) {
    return unauthorized("Server misconfigured: MCP_BEARER_TOKEN is not set.");
  }
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return unauthorized("Missing or malformed Authorization header. Use: Authorization: Bearer <token>.");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!timingSafeEqual(token, env.MCP_BEARER_TOKEN)) {
    return unauthorized("Invalid bearer token.");
  }
  return null;
}

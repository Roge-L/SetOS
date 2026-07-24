/**
 * Redirect-URI allowlist.
 *
 * Dynamic Client Registration is open by spec: anyone can register a client
 * against this server. Without an allowlist, an attacker could register a client
 * whose redirect_uri points at their own server and phish an authorization code
 * out of the real user (the "confused deputy" / consent-phishing attack).
 *
 * Enforced at BOTH registration and authorize time, so a client that slipped
 * through earlier still can't complete a flow to a foreign callback.
 */

/** Anthropic's hosted callback — used by claude.ai web, macOS desktop, and iOS. */
const EXACT_CALLBACKS = new Set([
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
]);

export function isAllowedRedirectUri(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (EXACT_CALLBACKS.has(`${u.origin}${u.pathname}`)) return true;

  // Native clients (Claude Code) bind an ephemeral loopback port at runtime, so
  // per RFC 8252 §7.3 the port is ignored when matching loopback redirects.
  const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  if (u.protocol === "http:" && loopback) return true;

  return false;
}

/** True only if every URI a client registered is allowed. */
export function allRedirectUrisAllowed(uris: string[] | undefined): boolean {
  return Array.isArray(uris) && uris.length > 0 && uris.every(isAllowedRedirectUri);
}

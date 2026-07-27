/**
 * SetOS worker entrypoint.
 *
 * `OAuthProvider` wraps the whole worker and makes it a spec-compliant OAuth 2.1
 * authorization server — which is what claude.ai web / macOS / iOS connectors
 * require (they do not accept a static bearer token outside Anthropic's
 * request-header beta). It serves:
 *
 *   /mcp        → the MCP server (Streamable HTTP), gated on a valid access token
 *   /authorize  → email/password sign-in + invite check (src/oauth/handler.ts)
 *   /token      → token + refresh exchange (library)
 *   /register   → Dynamic Client Registration, restricted to Claude callbacks
 *   /           → landing page, /health → liveness
 *
 * The library also serves RFC 9728 protected-resource metadata and OAuth AS
 * metadata (incl. PKCE S256, required by Claude), hashes tokens at rest, and
 * encrypts grant props.
 *
 * @see https://github.com/cloudflare/workers-oauth-provider
 * @see https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
 */

import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { buildServer } from "./server";
import consentHandler from "./oauth/handler";
import { allRedirectUrisAllowed } from "./oauth/redirects";
import { createUserDb } from "./db/client";
import { isGrantProps, loadPrincipal } from "./auth/principal";
import type { Env } from "./env";

/**
 * Tell the client to re-authenticate. RFC 9728 §5.1 — pointing at the resource
 * metadata is what makes Claude restart the flow rather than just erroring, and
 * the user then sees the real reason on the sign-in page.
 */
function unauthorized(request: Request, detail: string): Response {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({ error: "unauthorized", error_description: detail }), {
    status: 401,
    headers: {
      "content-type": "application/json",
      "www-authenticate": `Bearer error="invalid_token", error_description="${detail}", resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  });
}

/**
 * The MCP endpoint. Reached only after the provider validates an access token
 * and decrypts that grant's props onto `ctx.props`.
 *
 * Everything downstream is scoped to the principal resolved here. Note what is
 * NOT consulted: there is no server-wide user id any more. The identity comes
 * from the caller's own grant, so two people on the same worker cannot see each
 * other's rows even though they share every binding.
 */
const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const props = (ctx as ExecutionContext & { props?: unknown }).props;
    if (!isGrantProps(props)) {
      return unauthorized(request, "This token carries no SetOS identity. Reconnect the server.");
    }

    // Scoped to the caller from the first query onwards — including the profile
    // read below, which goes through RLS and so doubles as the revocation check.
    const db = createUserDb(env, props.userId);
    const principal = await loadPrincipal(db, props.userId);
    if (!principal) {
      return unauthorized(request, "This SetOS account is no longer active.");
    }

    return createMcpHandler(buildServer(env, db, principal), { route: "/mcp" })(request, env, ctx);
  },
};

export default new OAuthProvider({
  apiHandlers: {
    // Streamable HTTP only; SSE is deprecated and deliberately not served.
    "/mcp": mcpApiHandler as never,
  },
  defaultHandler: consentHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  // One coarse scope: a grant is all-or-nothing access to that one person's data.
  scopesSupported: ["setos"],

  /**
   * Consent-phishing defense: DCR is open by spec, so reject any client whose
   * redirect URIs aren't Claude's. See src/oauth/redirects.ts for the threat model.
   */
  clientRegistrationCallback: ({ clientMetadata }) => {
    const redirectUris = clientMetadata.redirect_uris as string[] | undefined;
    if (!allRedirectUrisAllowed(redirectUris)) {
      return {
        code: "invalid_client_metadata",
        description: "This server only accepts Claude clients (claude.ai / claude.com / Claude Code).",
        status: 403,
      };
    }
  },
});

/**
 * SetOS worker entrypoint.
 *
 * `OAuthProvider` wraps the whole worker and makes it a spec-compliant OAuth 2.1
 * authorization server — which is what claude.ai web / macOS / iOS connectors
 * require (they do not accept a static bearer token outside Anthropic's
 * request-header beta). It serves:
 *
 *   /mcp        → the MCP server (Streamable HTTP), gated on a valid access token
 *   /authorize  → single-user passphrase consent (src/oauth/handler.ts)
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
import type { Env } from "./env";

/** The MCP endpoint. Reached only after the provider validates an access token. */
const mcpApiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return createMcpHandler(buildServer(env), { route: "/mcp" })(request, env, ctx);
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
  // One coarse scope — this is a single-user server; the passphrase is the gate.
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

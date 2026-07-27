/**
 * Sign-in flow + public pages (the OAuthProvider's `defaultHandler`).
 *
 * SetOS used to have one user, so "consent" was one shared passphrase. With
 * several people on the server that no longer works: a shared secret cannot say
 * *which* holder is connecting, and revoking one person means rotating for
 * everyone. So /authorize now asks for an email and password, checked against
 * Supabase Auth, and requires a matching invitation row in `public.users`.
 *
 *   GET  /authorize   → render the sign-in form (auth request sealed in a field)
 *   POST /authorize   → verify credentials, check the invite, issue the grant
 *
 * The MCP client's original request rides between the two steps inside a signed
 * blob (see ./state.ts) rather than server-side storage, and its redirect URI is
 * re-validated before the grant is issued, not just when the form was drawn.
 */

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../env";
import { isAllowedRedirectUri } from "./redirects";
import { sealState, unsealState } from "./state";
import { verifyPassword } from "../auth/password";
import { createAdminDb } from "../db/client";
import { findInvitedUser, type GrantProps } from "../auth/principal";

/** Escape untrusted text (client names, error strings) before it enters the page. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

function html(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SetOS</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; max-width: 26rem;
         margin: 12vh auto; padding: 0 1.25rem; }
  h1 { font-size: 1.25rem; margin: 0 0 .25rem; }
  p { color: #666; margin: .25rem 0 1.25rem; }
  input { width: 100%; padding: .7rem .8rem; font-size: 1rem; border: 1px solid #8884;
          border-radius: .5rem; background: transparent; color: inherit; box-sizing: border-box;
          margin-top: .5rem; }
  button { width: 100%; padding: .7rem; font-size: 1rem; margin-top: .75rem; border: 0;
           border-radius: .5rem; background: #2f6fed; color: #fff; cursor: pointer; }
  .err { color: #c0392b; }
  code { background: #8882; padding: .1rem .3rem; border-radius: .25rem; }
</style>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function signInPage(sealed: string, clientName: string, email = "", error?: string): Response {
  return html(
    `<h1>Connect SetOS</h1>
<p><strong>${clientName}</strong> wants to read and write your food, workout and body-weight logs.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="POST" action="/authorize">
  <input type="hidden" name="req" value="${esc(sealed)}">
  <input type="email" name="email" placeholder="Email" value="${esc(email)}" autocomplete="username"
         autocapitalize="none" autofocus required>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
</form>`,
    error ? 401 : 200
  );
}

type OAuthEnv = Env & { OAUTH_PROVIDER: OAuthHelpers };

export default {
  async fetch(request: Request, env: OAuthEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ name: "setos", status: "ok" });
    }

    if (url.pathname === "/") {
      return html(
        `<h1>SetOS</h1>
<p>Personal calorie/macro and workout tracker, exposed to Claude over MCP.</p>
<p>Add <code>${esc(url.origin)}/mcp</code> as a custom connector in Claude, then sign in with your
SetOS account.</p>`
      );
    }

    if (url.pathname === "/authorize") {
      if (!env.SETOS_STATE_SECRET) {
        return html("<h1>Not configured</h1><p>SETOS_STATE_SECRET is not set on the worker.</p>", 500);
      }

      if (request.method === "GET") {
        const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
        if (!isAllowedRedirectUri(authReq.redirectUri)) {
          return html("<h1>Blocked</h1><p>That redirect URI is not allowed for this server.</p>", 403);
        }
        const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
        const sealed = await sealState(env.SETOS_STATE_SECRET, { req: authReq, iat: Date.now() });
        return signInPage(sealed, esc(client?.clientName || "An MCP client"));
      }

      if (request.method === "POST") {
        const form = await request.formData();
        const sealed = String(form.get("req") ?? "");
        const email = String(form.get("email") ?? "");
        const password = String(form.get("password") ?? "");

        // Signature + age check on the blob the form carried back.
        const state = await unsealState(env.SETOS_STATE_SECRET, sealed);
        if (!state) {
          return html(
            "<h1>Expired</h1><p>That sign-in could not be verified or took too long. Start the connection again.</p>",
            400
          );
        }
        // Re-check at grant time, not just when the form was drawn.
        if (!isAllowedRedirectUri(state.req.redirectUri)) {
          return html("<h1>Blocked</h1><p>That redirect URI is not allowed for this server.</p>", 403);
        }

        const client = await env.OAUTH_PROVIDER.lookupClient(state.req.clientId);
        const clientName = esc(client?.clientName || "An MCP client");

        const identity = await verifyPassword(env, email, password);
        // One message for bad password, unknown address, unconfirmed, and
        // suspended alike — anything more specific tells a stranger which
        // addresses have accounts here.
        const invited = identity ? await findInvitedUser(createAdminDb(env), identity.userId) : null;
        if (!identity || !invited) {
          return signInPage(sealed, clientName, email, "Incorrect email or password.");
        }

        const props: GrantProps = { userId: invited.userId, email: invited.email };

        const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
          request: state.req,
          userId: invited.userId,
          metadata: { connectedAt: new Date().toISOString(), email: invited.email },
          scope: state.req.scope,
          // Identity only. Timezone and is_active are re-read per request so they
          // stay live; no Supabase credentials go in here — the worker holds those.
          props,
        });
        return Response.redirect(redirectTo, 302);
      }

      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
};

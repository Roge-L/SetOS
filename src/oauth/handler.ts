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
import { changePassword, verifyPassword } from "../auth/password";
import { checkPassword, MIN_LENGTH } from "../auth/policy";
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

function passwordPage(email = "", error?: string, notice?: string): Response {
  return html(
    `<h1>Change your SetOS password</h1>
<p>Signing in to SetOS uses this password. Changing it signs out every Claude
connector on your account, so you'll reconnect once afterwards.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
${notice ? `<p>${esc(notice)}</p>` : ""}
<form method="POST" action="/password">
  <input type="email" name="email" placeholder="Email" value="${esc(email)}" autocomplete="username"
         autocapitalize="none" autofocus required>
  <input type="password" name="current" placeholder="Current password"
         autocomplete="current-password" required>
  <input type="password" name="next" placeholder="New password (${MIN_LENGTH}+ characters)"
         autocomplete="new-password" required>
  <input type="password" name="confirm" placeholder="Confirm new password"
         autocomplete="new-password" required>
  <button type="submit">Change password</button>
</form>
<p><small>A short phrase is easier to remember and stronger than a mangled word —
spaces are allowed. New passwords are checked against known data breaches.</small></p>`,
    error ? 400 : 200
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
</form>
<p><small><a href="/password">Change your password</a></small></p>`,
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
SetOS account.</p>
<p><a href="/password">Change your password</a></p>`
      );
    }

    /**
     * Password change.
     *
     * A web form, never an MCP tool — a password typed to Claude would pass
     * through model context, conversation history and logs. Credentials must not
     * travel that path, so this is the one part of SetOS a person uses directly.
     *
     * No CSRF token, deliberately: CSRF needs ambient credentials for the
     * browser to attach, and this form has none — no cookies, no session. The
     * current password IS the authentication, and an attacker who can supply
     * that does not need CSRF. Brute force is bounded by Supabase Auth's own
     * per-IP rate limiting on sign-in.
     */
    if (url.pathname === "/password") {
      if (request.method === "GET") return passwordPage();

      if (request.method === "POST") {
        const form = await request.formData();
        const email = String(form.get("email") ?? "");
        const current = String(form.get("current") ?? "");
        const next = String(form.get("next") ?? "");
        const confirm = String(form.get("confirm") ?? "");

        if (next !== confirm) {
          return passwordPage(email, "The two new passwords don't match.");
        }

        // Policy first: no point spending a sign-in on a password we'd reject.
        const failure = await checkPassword(next, current);
        if (failure) return passwordPage(email, failure.message);

        const result = await changePassword(env, email, current, next);
        if ("error" in result) return passwordPage(email, result.error);

        // Being able to sign in to Supabase is not the same as having a SetOS
        // invitation; don't confirm to a stranger that an address is a SetOS user.
        const invited = await findInvitedUser(createAdminDb(env), result.userId);

        /**
         * Invalidate every existing connector for this account.
         *
         * OWASP asks that a password change invalidate other sessions. Supabase
         * does NOT do this — its access tokens are self-contained JWTs that stay
         * valid until expiry (verified experimentally), and SetOS's own OAuth
         * grants are separate from Supabase sessions entirely. So if someone
         * changes their password because it was compromised, this is the step
         * that actually cuts off an attacker's connector.
         */
        let revoked = 0;
        try {
          const grants = await env.OAUTH_PROVIDER.listUserGrants(result.userId);
          for (const grant of grants.items) {
            await env.OAUTH_PROVIDER.revokeGrant(grant.id, result.userId);
            revoked++;
          }
        } catch {
          // The password IS changed by this point; failing the whole request
          // would tell the user it didn't work when it did. Say so instead.
          return html(
            `<h1>Password changed</h1>
<p>Your password was updated, but existing Claude connections could not be signed
out automatically. Remove and re-add the SetOS connector in Claude to be sure.</p>`
          );
        }

        return html(
          `<h1>Password changed</h1>
<p>${invited ? "" : "Note: this account has no active SetOS access. "}${
            revoked > 0
              ? `Signed out ${revoked} existing Claude connection${revoked === 1 ? "" : "s"} — reconnect with your new password.`
              : "There were no active Claude connections to sign out."
          }</p>`
        );
      }

      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/authorize") {
      if (!env.SETOS_STATE_SECRET) {
        return html("<h1>Not configured</h1><p>SETOS_STATE_SECRET is not set on the worker.</p>", 500);
      }

      if (request.method === "GET") {
        // parseAuthRequest throws on an unknown client_id or a malformed request
        // — which happens for real (a client re-registers, or grant storage was
        // cleared), and an uncaught throw here is an opaque 500 for the user.
        let authReq: Awaited<ReturnType<typeof env.OAUTH_PROVIDER.parseAuthRequest>>;
        try {
          authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
        } catch {
          return html(
            `<h1>Invalid request</h1><p>This connection request isn't valid — usually the client is
unknown to this server. Remove the SetOS connector in Claude and add it again.</p>`,
            400
          );
        }
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

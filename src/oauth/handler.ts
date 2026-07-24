/**
 * Consent flow + public pages (the OAuthProvider's `defaultHandler`).
 *
 * SetOS has exactly one user, so "consent" is a single passphrase rather than a
 * login system: GET /authorize renders a form, POST /authorize checks the
 * passphrase and completes the grant. The AuthRequest is carried through the
 * form in an HMAC-signed blob so it can't be tampered with between the two
 * steps, and the redirect URI is re-validated before the grant is issued.
 */

import type { AuthRequest, OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../env";
import { isAllowedRedirectUri } from "./redirects";

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(pad + "=".repeat((4 - (pad.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(data))));
}

/** Constant-time string compare (passphrase check). */
function safeEqual(a: string, b: string): boolean {
  const ba = encoder.encode(a);
  const bb = encoder.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!;
  return diff === 0;
}

/** Serialize the AuthRequest with a signature so the form can't be edited. */
async function seal(secret: string, req: AuthRequest): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify(req)));
  return `${payload}.${await hmac(secret, payload)}`;
}

async function unseal(secret: string, sealed: string): Promise<AuthRequest | null> {
  const [payload, sig] = sealed.split(".");
  if (!payload || !sig) return null;
  if (!safeEqual(sig, await hmac(secret, payload))) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromB64url(payload))) as AuthRequest;
  } catch {
    return null;
  }
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
          border-radius: .5rem; background: transparent; color: inherit; box-sizing: border-box; }
  button { width: 100%; padding: .7rem; font-size: 1rem; margin-top: .75rem; border: 0;
           border-radius: .5rem; background: #2f6fed; color: #fff; cursor: pointer; }
  .err { color: #c0392b; }
  code { background: #8882; padding: .1rem .3rem; border-radius: .25rem; }
</style>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function consentPage(sealed: string, clientName: string, error?: string): Response {
  return html(
    `<h1>Connect SetOS</h1>
<p><strong>${clientName}</strong> wants to read and write your food, workout and body-weight logs.</p>
${error ? `<p class="err">${error}</p>` : ""}
<form method="POST" action="/authorize">
  <input type="hidden" name="req" value="${sealed}">
  <input type="password" name="passphrase" placeholder="Consent passphrase" autofocus
         autocomplete="current-password" required>
  <button type="submit">Approve</button>
</form>`,
    error ? 401 : 200
  );
}

/** Escape untrusted client-supplied text before putting it in the page. */
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
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
<p>Add <code>${esc(url.origin)}/mcp</code> as a custom connector in Claude.</p>`
      );
    }

    if (url.pathname === "/authorize") {
      if (!env.SETOS_CONSENT_PASSPHRASE) {
        return html("<h1>Not configured</h1><p>SETOS_CONSENT_PASSPHRASE is not set on the worker.</p>", 500);
      }

      if (request.method === "GET") {
        const authReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
        if (!isAllowedRedirectUri(authReq.redirectUri)) {
          return html("<h1>Blocked</h1><p>That redirect URI is not allowed for this server.</p>", 403);
        }
        const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
        const name = esc(client?.clientName || "An MCP client");
        return consentPage(await seal(env.SETOS_CONSENT_PASSPHRASE, authReq), name);
      }

      if (request.method === "POST") {
        const form = await request.formData();
        const sealed = String(form.get("req") ?? "");
        const passphrase = String(form.get("passphrase") ?? "");

        const authReq = await unseal(env.SETOS_CONSENT_PASSPHRASE, sealed);
        if (!authReq) {
          return html("<h1>Expired</h1><p>That request could not be verified. Start the connection again.</p>", 400);
        }
        // Re-check at grant time, not just at registration.
        if (!isAllowedRedirectUri(authReq.redirectUri)) {
          return html("<h1>Blocked</h1><p>That redirect URI is not allowed for this server.</p>", 403);
        }
        if (!safeEqual(passphrase, env.SETOS_CONSENT_PASSPHRASE)) {
          const client = await env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
          return consentPage(sealed, esc(client?.clientName || "An MCP client"), "Incorrect passphrase.");
        }

        const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
          request: authReq,
          userId: env.SETOS_USER_ID,
          metadata: { connectedAt: new Date().toISOString() },
          scope: authReq.scope,
          // No per-user secrets in the grant: the worker reads Supabase
          // credentials from its own env, so grant props stay empty.
          props: {},
        });
        return Response.redirect(redirectTo, 302);
      }

      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },
};

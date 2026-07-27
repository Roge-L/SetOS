/**
 * The signed blob is the only thing holding the in-flight authorization request
 * between rendering the sign-in form and receiving it back. It lives in a hidden
 * field, so it is user-visible and user-writable — these tests pin the three ways
 * it must fail closed: tampering, a wrong key, and age.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import { sealState, unsealState } from "../src/oauth/state";

const SECRET = "state-secret-for-tests";

const REQ = {
  clientId: "client-abc",
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
  scope: ["setos"],
  state: "client-state",
  codeChallenge: "abc",
  codeChallengeMethod: "S256",
  responseType: "code",
} as unknown as AuthRequest;

afterEach(() => {
  vi.useRealTimers();
});

describe("sealed OAuth state", () => {
  it("round-trips the authorization request", async () => {
    const sealed = await sealState(SECRET, { req: REQ, iat: Date.now() });
    const out = await unsealState(SECRET, sealed);

    expect(out?.req.redirectUri).toBe("https://claude.ai/api/mcp/auth_callback");
    expect(out?.req.clientId).toBe("client-abc");
  });

  it("rejects a payload edited in flight", async () => {
    const sealed = await sealState(SECRET, { req: REQ, iat: Date.now() });
    const [, sig] = sealed.split(".");

    // Swap in a redirect_uri pointing at an attacker — the whole point of signing.
    const evil = { req: { ...REQ, redirectUri: "https://evil.example.com/cb" }, iat: Date.now() };
    const forgedPayload = btoa(JSON.stringify(evil)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    expect(await unsealState(SECRET, `${forgedPayload}.${sig}`)).toBeNull();
  });

  it("rejects a blob signed with a different key", async () => {
    const sealed = await sealState("some-other-secret", { req: REQ, iat: Date.now() });
    expect(await unsealState(SECRET, sealed)).toBeNull();
  });

  it("rejects a blob older than the sign-in window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
    const sealed = await sealState(SECRET, { req: REQ, iat: Date.now() });

    // Still good a minute later...
    vi.setSystemTime(new Date("2026-07-20T12:01:00Z"));
    expect(await unsealState(SECRET, sealed)).not.toBeNull();

    // ...and dead after the window closes.
    vi.setSystemTime(new Date("2026-07-20T12:11:00Z"));
    expect(await unsealState(SECRET, sealed)).toBeNull();
  });

  it("rejects structurally broken input", async () => {
    expect(await unsealState(SECRET, "")).toBeNull();
    expect(await unsealState(SECRET, "no-dot")).toBeNull();
    expect(await unsealState(SECRET, "not-base64.sig")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { isAllowedRedirectUri, allRedirectUrisAllowed } from "../src/oauth/redirects";

describe("redirect-URI allowlist", () => {
  it("accepts Anthropic's hosted callbacks (claude.ai web, macOS, iOS)", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("https://claude.com/api/mcp/auth_callback")).toBe(true);
  });

  it("accepts loopback redirects on any port (RFC 8252 native clients)", () => {
    expect(isAllowedRedirectUri("http://127.0.0.1:54321/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:8976/callback")).toBe(true);
  });

  it("rejects foreign callbacks — the consent-phishing case", () => {
    expect(isAllowedRedirectUri("https://evil.example.com/steal")).toBe(false);
    // Lookalike host must not pass.
    expect(isAllowedRedirectUri("https://claude.ai.evil.com/api/mcp/auth_callback")).toBe(false);
    // Right host, wrong path.
    expect(isAllowedRedirectUri("https://claude.ai/anything-else")).toBe(false);
    // Non-loopback over http.
    expect(isAllowedRedirectUri("http://192.168.1.10/callback")).toBe(false);
  });

  it("rejects malformed URIs", () => {
    expect(isAllowedRedirectUri("not-a-url")).toBe(false);
    expect(isAllowedRedirectUri("")).toBe(false);
  });

  it("requires EVERY registered URI to be allowed", () => {
    expect(allRedirectUrisAllowed(["https://claude.ai/api/mcp/auth_callback"])).toBe(true);
    // One bad URI poisons the registration.
    expect(
      allRedirectUrisAllowed(["https://claude.ai/api/mcp/auth_callback", "https://evil.example.com/cb"])
    ).toBe(false);
    expect(allRedirectUrisAllowed([])).toBe(false);
    expect(allRedirectUrisAllowed(undefined)).toBe(false);
  });
});

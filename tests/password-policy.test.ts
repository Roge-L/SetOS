/**
 * Password policy.
 *
 * The rules here are the sourced ones, not invented: length floor from the OWASP
 * Authentication Cheat Sheet (15 without MFA), no composition rules and a breach
 * check from NIST SP 800-63B. These tests pin the shape of that policy, and in
 * particular pin the two decisions someone would most plausibly "fix" later —
 * that mixed-case/symbol rules are absent on purpose, and that an unreachable
 * HIBP fails open.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { checkPassword, MIN_LENGTH, MAX_LENGTH } from "../src/auth/policy";
import { pwnedCount } from "../src/lib/pwned";

const CURRENT = "the-old-passphrase-here";

/** HIBP returns SUFFIX:COUNT lines for a SHA-1 prefix. */
function mockHibp(body: string, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: ok ? 200 : 503 })));
}

afterEach(() => vi.unstubAllGlobals());

describe("length rules", () => {
  it(`rejects anything under ${MIN_LENGTH} characters`, async () => {
    mockHibp("");
    const short = "a".repeat(MIN_LENGTH - 1);
    expect(await checkPassword(short, CURRENT)).toMatchObject({
      message: expect.stringContaining(`${MIN_LENGTH} characters`),
    });
  });

  it(`accepts exactly ${MIN_LENGTH} characters`, async () => {
    mockHibp("");
    expect(await checkPassword("a".repeat(MIN_LENGTH), CURRENT)).toBeNull();
  });

  it("accepts a long passphrase — OWASP asks for at least 64 to be allowed", async () => {
    mockHibp("");
    expect(await checkPassword("correct horse battery staple and then some more words", CURRENT)).toBeNull();
    expect(MAX_LENGTH).toBeGreaterThanOrEqual(64);
  });

  it("rejects beyond the cap rather than silently truncating", async () => {
    mockHibp("");
    const result = await checkPassword("a".repeat(MAX_LENGTH + 1), CURRENT);
    expect(result).toMatchObject({ message: expect.stringContaining(`${MAX_LENGTH}`) });
  });

  it("rejects reusing the current password", async () => {
    mockHibp("");
    expect(await checkPassword(CURRENT, CURRENT)).toMatchObject({
      message: expect.stringContaining("different"),
    });
  });
});

describe("no composition rules", () => {
  // NIST SP 800-63B recommends AGAINST requiring mixed case/digits/symbols:
  // users satisfy such rules predictably, for real usability cost. These pass
  // deliberately — if someone later "hardens" the policy by adding character
  // classes, these fail and point at the reasoning.
  it("accepts an all-lowercase passphrase with no digits or symbols", async () => {
    mockHibp("");
    expect(await checkPassword("velvet anchor thunder lamp", CURRENT)).toBeNull();
  });

  it("accepts spaces, so passphrases are usable", async () => {
    mockHibp("");
    expect(await checkPassword("a phrase with several spaces", CURRENT)).toBeNull();
  });
});

describe("breached-password check", () => {
  it("rejects a password found in the corpus", async () => {
    // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
    // prefix 5BAA6, suffix 1E4C9B93F3F0682250B6CF8331B7EE68FD8
    mockHibp("1E4C9B93F3F0682250B6CF8331B7EE68FD8:9659365\r\nFFFF:1\r\n");
    const result = await checkPassword("password", CURRENT);
    // Caught by length first — which is itself correct and worth stating.
    expect(result).not.toBeNull();
  });

  it("reports the breach count for a long-but-breached password", async () => {
    const pw = "iloveyouforever123";
    const hash = await sha1Upper(pw);
    mockHibp(`${hash.slice(5)}:4242\r\n`);
    expect(await checkPassword(pw, CURRENT)).toMatchObject({
      message: expect.stringContaining("4,242"),
    });
  });

  it("accepts a long password absent from the corpus", async () => {
    mockHibp("0000000000000000000000000000000000A:5\r\n");
    expect(await checkPassword("quixotic lantern driftwood", CURRENT)).toBeNull();
  });

  it("fails OPEN when HIBP is unreachable", async () => {
    // Someone changing a password may be doing so because it leaked; blocking
    // them because a third-party API is down would be the worse failure.
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await checkPassword("quixotic lantern driftwood", CURRENT)).toBeNull();
  });

  it("fails open on a non-200 from HIBP", async () => {
    mockHibp("", false);
    expect(await pwnedCount("quixotic lantern driftwood")).toBe(0);
  });

  it("sends only a 5-character prefix — the password never leaves", async () => {
    const spy = vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const pw = "quixotic lantern driftwood";
    await pwnedCount(pw);

    const calledUrl = String(spy.mock.calls[0]![0]);
    expect(calledUrl).toMatch(/^https:\/\/api\.pwnedpasswords\.com\/range\/[0-9A-F]{5}$/);
    expect(calledUrl).not.toContain(pw);
    expect(calledUrl).not.toContain(encodeURIComponent(pw));
    // Full hash must not be sent either — k-anonymity is the whole point.
    expect(calledUrl.split("/").pop()).toHaveLength(5);
  });
});

async function sha1Upper(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

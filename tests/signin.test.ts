/**
 * Sign-in gating.
 *
 * Two independent checks stand between a stranger and someone's food log, and
 * both must hold: Supabase Auth has to accept the password, AND `public.users`
 * has to contain an active invitation. The second is what makes this server
 * invite-only rather than "anyone with an account on my Supabase project".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { findInvitedUser, isGrantProps } from "../src/auth/principal";
import type { Env } from "../src/env";

const signInWithPassword = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ auth: { signInWithPassword } }),
}));

// Imported after the mock so the module under test picks it up.
const { verifyPassword } = await import("../src/auth/password");

const ALICE = "11111111-1111-4111-8111-111111111111";
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon" } as unknown as Env;

beforeEach(() => signInWithPassword.mockReset());

describe("password verification", () => {
  it("returns the identity when Supabase accepts the credentials", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: ALICE, email: "alice@example.com" } },
      error: null,
    });

    await expect(verifyPassword(env, "alice@example.com", "correct")).resolves.toEqual({
      userId: ALICE,
      email: "alice@example.com",
    });
  });

  it("normalizes the email before checking it", async () => {
    signInWithPassword.mockResolvedValue({
      data: { user: { id: ALICE, email: "alice@example.com" } },
      error: null,
    });

    await verifyPassword(env, "  Alice@Example.COM ", "correct");
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "alice@example.com",
      password: "correct",
    });
  });

  it("returns null on a bad password", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Invalid login" } });
    await expect(verifyPassword(env, "alice@example.com", "wrong")).resolves.toBeNull();
  });

  it("returns null for unconfirmed or banned accounts", async () => {
    // Supabase reports these as errors too; all of them mean "no".
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Email not confirmed" } });
    await expect(verifyPassword(env, "alice@example.com", "correct")).resolves.toBeNull();
  });

  it("never calls signUp — there is no self-signup path", async () => {
    signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: "Invalid login" } });
    await verifyPassword(env, "stranger@example.com", "hunter2");
    expect(signInWithPassword).toHaveBeenCalledOnce();
  });
});

describe("invitation check", () => {
  it("finds an active invited user", async () => {
    const { db, calls } = fakeDb([
      { data: { id: ALICE, email: "alice@example.com", timezone: "America/Denver", display_name: "Alice" } },
    ]);

    await expect(findInvitedUser(db, ALICE)).resolves.toEqual({
      userId: ALICE,
      email: "alice@example.com",
      timezone: "America/Denver",
      displayName: "Alice",
    });
    // Suspension is enforced in the query, not after it.
    expect(calls[0]!.filters).toContainEqual(["is_active", true]);
    expect(calls[0]!.filters).toContainEqual(["id", ALICE]);
  });

  it("denies a valid Supabase account with no invitation row", async () => {
    // The security property: authenticating against the project is not the same
    // as being invited to SetOS.
    const { db } = fakeDb([{ data: null }]);
    await expect(findInvitedUser(db, ALICE)).resolves.toBeNull();
  });
});

describe("grant props", () => {
  it("accepts a well-formed principal", () => {
    expect(isGrantProps({ userId: ALICE, email: "alice@example.com" })).toBe(true);
  });

  it("rejects anything that would leave the request unscoped", () => {
    // A token whose props don't carry an id must 401 rather than fall back to
    // some default user — that fallback was the original cross-user bug.
    expect(isGrantProps({})).toBe(false);
    expect(isGrantProps({ userId: "", email: "a@b.c" })).toBe(false);
    expect(isGrantProps({ email: "a@b.c" })).toBe(false);
    expect(isGrantProps(null)).toBe(false);
    expect(isGrantProps("alice")).toBe(false);
  });
});

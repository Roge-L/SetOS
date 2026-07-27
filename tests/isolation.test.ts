/**
 * Cross-tenant isolation.
 *
 * SetOS went from one user to several, which turns "every query filters by
 * user_id" from a tidiness rule into a security boundary. These tests pin that
 * boundary at the service layer — the RLS policies are the second net behind it,
 * but a service that forgets to scope should fail here first, without needing a
 * database to prove it.
 */

import { describe, it, expect } from "vitest";
import { fakeDb, isScopedTo } from "./helpers/fake-db";
import { deleteWeight, getWeightForDate, getWeightRange, logWeight } from "../src/services/body";
import { updateExercise, updateSet } from "../src/services/workout";
import { getDayTotals } from "../src/services/totals";
import { signJwtHS256 } from "../src/lib/crypto";

/** Read a JWT payload without verifying it — fine here, we just signed it. */
function claimsOf(token: string): Record<string, unknown> {
  const payload = token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(payload + "=".repeat((4 - (payload.length % 4)) % 4)));
}

const ALICE = "11111111-1111-4111-8111-111111111111";
const BOB = "22222222-2222-4222-8222-222222222222";
const TZ = "America/New_York";

describe("body-metric queries scope to the caller", () => {
  it("reads a single day only within the caller's rows", async () => {
    const { db, calls } = fakeDb([{ data: null }]);
    await getWeightForDate(db, ALICE, "2026-07-20");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("body_metrics");
    expect(isScopedTo(calls[0]!, ALICE)).toBe(true);
  });

  it("reads a range only within the caller's rows", async () => {
    const { db, calls } = fakeDb([{ data: [] }]);
    await getWeightRange(db, ALICE, "2026-07-01", "2026-07-20");

    expect(isScopedTo(calls[0]!, ALICE)).toBe(true);
  });

  it("deletes only within the caller's rows", async () => {
    const { db, calls } = fakeDb([{ data: [{ date: "2026-07-20" }] }]);
    await deleteWeight(db, ALICE, TZ, "2026-07-20");

    expect(calls[0]!.op).toBe("delete");
    expect(isScopedTo(calls[0]!, ALICE)).toBe(true);
  });

  it("stamps the caller's id on a new entry rather than trusting input", async () => {
    const { db, calls } = fakeDb([{ data: { notes: null } }]);
    await logWeight(db, ALICE, TZ, { weight: 180 });

    expect(calls[0]!.op).toBe("upsert");
    expect((calls[0]!.payload as { user_id: string }).user_id).toBe(ALICE);
  });

  it("scopes the daily-totals read", async () => {
    const { db, calls } = fakeDb([{ data: null }]);
    await getDayTotals(db, ALICE, "2026-07-20");

    expect(isScopedTo(calls[0]!, ALICE)).toBe(true);
  });
});

describe("workout edits reject rows owned by someone else", () => {
  // Workout rows carry no user_id of their own — ownership is only reachable by
  // walking set -> exercise -> session. That indirection is exactly where a
  // cross-tenant edit would slip through, so both walks are pinned here.

  it("refuses to rename an exercise inside another user's session", async () => {
    const { db, calls } = fakeDb([
      { data: { id: "ex-1", workout_session_id: "sess-1", workout_sessions: { user_id: BOB } } },
    ]);

    await expect(updateExercise(db, ALICE, { exercise_id: "ex-1", name: "Bench" })).rejects.toThrow(
      /No exercise with id/
    );
    // Nothing was written — the ownership check ran before the update.
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("allows renaming an exercise the caller owns", async () => {
    const { db, calls } = fakeDb([
      { data: { id: "ex-1", workout_session_id: "sess-1", workout_sessions: { user_id: ALICE } } },
      { error: null },
      // autoTitle's follow-up reads; contents don't matter here.
      { data: [] },
      { error: null },
    ]);

    const result = await updateExercise(db, ALICE, { exercise_id: "ex-1", position: 2 });
    expect(result).toMatchObject({ updated: true });
    expect(calls.some((c) => c.op === "update")).toBe(true);
  });

  it("refuses to patch a set belonging to another user", async () => {
    const { db, calls } = fakeDb([
      { data: { id: "set-1", workout_exercise_id: "ex-1", workout_exercises: { workout_sessions: { user_id: BOB } } } },
    ]);

    await expect(updateSet(db, ALICE, { set_id: "set-1", reps: 12 })).rejects.toThrow(/No set with id/);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("treats a missing ownership node as not-owned rather than owned", async () => {
    // A malformed/absent embed must fail closed. `undefined !== ALICE` is what
    // makes that true today; this test stops a refactor from inverting it.
    const { db } = fakeDb([{ data: { id: "ex-1", workout_session_id: "sess-1" } }]);

    await expect(updateExercise(db, ALICE, { exercise_id: "ex-1", name: "Bench" })).rejects.toThrow(
      /No exercise with id/
    );
  });
});

describe("per-user Postgres JWT", () => {
  // This is what arms RLS: PostgREST reads `sub` into auth.uid(). A wrong claim
  // here would scope every policy to the wrong person, so it is worth pinning.
  const SECRET = "test-jwt-secret-not-a-real-one";

  it("carries the caller's id as sub with the authenticated role", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signJwtHS256(SECRET, {
      sub: ALICE,
      role: "authenticated",
      aud: "authenticated",
      iss: "supabase",
      iat: now,
      exp: now + 120,
    });

    const claims = claimsOf(token);
    expect(claims).toMatchObject({ sub: ALICE, role: "authenticated", aud: "authenticated" });
    expect(claims.sub).not.toBe(BOB);
  });

  it("produces a signature that changes with the subject", async () => {
    const claims = { role: "authenticated", iat: 0, exp: 120 };
    const forAlice = await signJwtHS256(SECRET, { ...claims, sub: ALICE });
    const forBob = await signJwtHS256(SECRET, { ...claims, sub: BOB });
    expect(forAlice).not.toBe(forBob);
  });

  it("cannot be forged without the secret", async () => {
    const claims = { sub: ALICE, role: "authenticated", iat: 0, exp: 120 };
    const real = await signJwtHS256(SECRET, claims);
    const forged = await signJwtHS256("wrong-secret", claims);
    expect(real.split(".")[2]).not.toBe(forged.split(".")[2]);
  });
});

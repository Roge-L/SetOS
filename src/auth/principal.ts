/**
 * Who is making this request.
 *
 * Two lookups, deliberately kept apart because they run with different authority:
 *
 *   - `findInvitedUser` runs once at sign-in, as the service role, because RLS
 *     needs a JWT and at that moment we have only just verified the password.
 *   - `loadPrincipal` runs on every MCP request, as the user, through RLS.
 *
 * Only `userId` and `email` are persisted into the OAuth grant. Everything
 * mutable — timezone, display name, and whether the account is still active —
 * is re-read per request, so changing a person's timezone or suspending them
 * takes effect immediately instead of at the next token refresh.
 */

import type { Db } from "../db/client";

export interface Principal {
  userId: string;
  email: string;
  /** IANA timezone; day boundaries and "today" resolve against it. */
  timezone: string;
  displayName: string | null;
}

/** The only thing we persist in the OAuth grant. Small and non-secret by design. */
export interface GrantProps {
  userId: string;
  email: string;
}

export function isGrantProps(value: unknown): value is GrantProps {
  const p = value as GrantProps | null;
  return !!p && typeof p.userId === "string" && !!p.userId && typeof p.email === "string";
}

interface UserRow {
  id: string;
  email: string;
  timezone: string;
  display_name: string | null;
}

/**
 * Look up the invitation for an account whose password just checked out.
 * Returns null when that person has no `public.users` row or has been suspended.
 *
 * Having valid Supabase Auth credentials is NOT sufficient to use SetOS — this
 * row is the actual invitation, so an account that exists in `auth.users`
 * without one (or with is_active false) still gets nothing.
 *
 * Requires the admin client: RLS needs a JWT, and at this point in the flow we
 * have only just verified the password.
 */
export async function findInvitedUser(adminDb: Db, userId: string): Promise<Principal | null> {
  const { data, error } = await adminDb
    .from("users")
    .select("id, email, timezone, display_name")
    .eq("id", userId)
    .eq("is_active", true)
    .maybeSingle<UserRow>();

  if (error) throw new Error(`Invite lookup failed: ${error.message}`);
  return data ? toPrincipal(data) : null;
}

/**
 * Re-read the signed-in user's own profile, through RLS.
 *
 * Returns null if the row is gone or `is_active` went false — the
 * `users_select_own` policy folds both into one filter, so deleting or
 * suspending someone kills their already-issued access tokens on the next
 * request rather than leaving them working until expiry.
 */
export async function loadPrincipal(userDb: Db, userId: string): Promise<Principal | null> {
  const { data, error } = await userDb
    .from("users")
    .select("id, email, timezone, display_name")
    .eq("id", userId)
    .maybeSingle<UserRow>();

  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  return data ? toPrincipal(data) : null;
}

function toPrincipal(row: UserRow): Principal {
  return {
    userId: row.id,
    email: row.email,
    timezone: row.timezone,
    displayName: row.display_name,
  };
}

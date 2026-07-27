-- Multi-user SetOS.
--
-- v2 was single-tenant: one hardcoded SETOS_USER_ID, one shared consent
-- passphrase, one timezone. This migration turns `public.users` into the
-- invitation list (a row exists <=> that person may connect), makes day
-- boundaries per-user, and closes the one hole that RLS alone would not cover.
--
-- Identity stays with Supabase Auth: people sign in with the email + password
-- already on their `auth.users` row, so `public.users.id` still points there and
-- the auth.uid() policies from 001 keep working. What changes is that the worker
-- now actually speaks as the signed-in user (a short-lived JWT with sub = their
-- id) instead of as the service role — so those policies finally run.
--
-- Run this in the Supabase SQL editor. It is safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. Guard: every existing user must have an email before we can key the
--    invitation list on it. Fail loudly rather than leave an unusable row.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.users where email is null or btrim(email) = '') then
    raise exception
      'public.users has row(s) with no email. Set each one to the address that person signs in with, then re-run. e.g. update public.users set email = ''you@example.com'' where id = ''<uuid>'';';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. users: profile + invitation list
-- ---------------------------------------------------------------------------

alter table public.users add column if not exists display_name text;
alter table public.users add column if not exists is_active boolean not null default true;

-- Per-user day boundaries. Existing rows keep the old global default so their
-- historical totals do not silently shift.
alter table public.users add column if not exists timezone text not null default 'America/New_York';

alter table public.users alter column email set not null;

-- Email is how sign-in finds the row, and addresses are case-insensitive. Rather
-- than match with ilike at lookup time — which would treat the perfectly legal
-- `_` in an address as a wildcard, letting one person match another's row — the
-- column is stored canonically lowercase and compared with plain equality.
update public.users set email = lower(btrim(email)) where email <> lower(btrim(email));

alter table public.users drop constraint if exists users_email_lowercase;
alter table public.users add constraint users_email_lowercase check (email = lower(btrim(email)));

create unique index if not exists users_email_key on public.users (email);

-- Keep the auth.users mirror trigger, but normalize the email so it satisfies
-- the constraint above when a new person is created in the Auth dashboard.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email)
  values (new.id, lower(btrim(new.email)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Reject a timezone Postgres cannot resolve. This has to be a trigger, not a
-- CHECK: the only real validation is a lookup against pg_timezone_names, and
-- CHECK constraints may not contain subqueries. Catching it at invite time beats
-- having recalculate_daily_totals blow up on the person's first meal.
create or replace function public.assert_valid_timezone()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'unknown IANA timezone %', new.timezone;
  end if;
  return new;
end;
$$;

drop trigger if exists users_timezone_valid on public.users;
create trigger users_timezone_valid
  before insert or update of timezone on public.users
  for each row execute function public.assert_valid_timezone();

comment on table public.users is
  'Profile + invitation list. A row here is the invitation: no row, no access. Suspend with is_active = false; revoke by deleting the auth.users row (cascades to all of that person''s data).';

-- ---------------------------------------------------------------------------
-- 2. Per-user timezone in the totals rollup
--
--    002 hardcoded 'America/New_York'. With users in other zones that files a
--    late-night meal on the wrong day, so read the zone from the owner's row.
--
--    This function is SECURITY DEFINER, which means it bypasses RLS — exactly
--    the kind of thing that becomes a cross-tenant hole once there is more than
--    one tenant. It takes p_user_id from the caller, so without the guard below
--    any signed-in user could aim it at someone else's rows. auth.uid() is null
--    for the service role, which keeps admin backfills working.
-- ---------------------------------------------------------------------------
create or replace function public.recalculate_daily_totals(p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'not permitted: cannot recalculate totals for another user';
  end if;

  select u.timezone into v_tz from public.users u where u.id = p_user_id;
  if v_tz is null then
    raise exception 'unknown user %', p_user_id;
  end if;

  insert into public.daily_nutrition_totals
    (user_id, date, calories, protein_g, carbs_g, fat_g, fiber_g, updated_at)
  select
    p_user_id,
    p_date,
    coalesce(sum(estimated_calories), 0),
    coalesce(sum(estimated_protein_g), 0),
    coalesce(sum(estimated_carbs_g), 0),
    coalesce(sum(estimated_fat_g), 0),
    coalesce(sum(estimated_fiber_g), 0),
    now()
  from public.meal_logs
  where user_id = p_user_id
    and date(logged_at at time zone v_tz) = p_date
  on conflict (user_id, date)
  do update set
    calories = excluded.calories,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    fiber_g = excluded.fiber_g,
    updated_at = now();
end;
$$;

-- Only the worker's two roles should be able to reach it.
revoke all on function public.recalculate_daily_totals(uuid, date) from public;
grant execute on function public.recalculate_daily_totals(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS gaps
--
--    001 enabled RLS everywhere and wrote auth.uid() policies, but the worker
--    used the service-role key, which bypasses them — so those policies have
--    never actually run. They are the second net now, behind the app-layer
--    user_id filtering. Two things needed fixing.
--
--    (a) Rows are created by the auth.users trigger (SECURITY DEFINER), never by
--        the user, so users_insert_own is dead weight.
--    (b) A suspended person keeps their data but loses access. The worker also
--        checks is_active at sign-in; folding it into the policy means an
--        already-issued access token stops working too, rather than staying
--        valid until it expires.
-- ---------------------------------------------------------------------------
drop policy if exists "users_insert_own" on public.users;

drop policy if exists "users_select_own" on public.users;
create policy "users_select_own" on public.users for select
  using ((select auth.uid()) = id and is_active);

drop policy if exists "users_update_own" on public.users;
create policy "users_update_own" on public.users for update
  using ((select auth.uid()) = id and is_active);

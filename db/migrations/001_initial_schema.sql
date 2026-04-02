-- SetOS initial schema
-- Run this in the Supabase SQL editor

-- Users table (extends Supabase auth.users)
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz default now()
);

-- Meal logs
create table if not exists public.meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  logged_at timestamptz not null default now(),
  source_type text not null check (source_type in ('text', 'voice', 'photo', 'multimodal')),
  raw_text text,
  transcript_text text,
  image_url text,
  parsed_meal_name text not null,
  estimated_calories integer not null default 0,
  estimated_protein_g real not null default 0,
  estimated_carbs_g real not null default 0,
  estimated_fat_g real not null default 0,
  estimated_fiber_g real not null default 0,
  confidence text not null default 'medium',
  assumptions_json jsonb default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Daily nutrition totals (materialized per day)
create table if not exists public.daily_nutrition_totals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  calories integer not null default 0,
  protein_g real not null default 0,
  carbs_g real not null default 0,
  fat_g real not null default 0,
  fiber_g real not null default 0,
  updated_at timestamptz default now(),
  unique(user_id, date)
);

-- Workout sessions
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  title text,
  notes text,
  created_at timestamptz default now()
);

-- Workout exercises
create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  workout_session_id uuid not null references public.workout_sessions(id) on delete cascade,
  exercise_name text not null,
  normalized_exercise_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz default now()
);

-- Workout sets
create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_number integer not null default 1,
  reps integer,
  weight real,
  unit text default 'lb',
  duration_seconds integer,
  distance text,
  rir integer,
  notes text,
  created_at timestamptz default now()
);

-- Body metrics
create table if not exists public.body_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  date date not null,
  body_weight real,
  notes text,
  created_at timestamptz default now(),
  unique(user_id, date)
);

-- User aliases (exercise shortcuts, food templates, weight aliases)
create table if not exists public.user_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  alias_type text not null,
  alias_key text not null,
  alias_value_json jsonb not null,
  created_at timestamptz default now()
);

-- Indexes
create index if not exists idx_meal_logs_user_date on public.meal_logs(user_id, logged_at);
create index if not exists idx_daily_totals_user_date on public.daily_nutrition_totals(user_id, date);
create index if not exists idx_workout_sessions_user on public.workout_sessions(user_id, started_at);
create index if not exists idx_workout_exercises_session on public.workout_exercises(workout_session_id);
create index if not exists idx_workout_sets_exercise on public.workout_sets(workout_exercise_id);
create index if not exists idx_body_metrics_user_date on public.body_metrics(user_id, date);
create index if not exists idx_user_aliases_user on public.user_aliases(user_id, alias_type);

-- Enable RLS on all tables
alter table public.users enable row level security;
alter table public.meal_logs enable row level security;
alter table public.daily_nutrition_totals enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.workout_exercises enable row level security;
alter table public.workout_sets enable row level security;
alter table public.body_metrics enable row level security;
alter table public.user_aliases enable row level security;

-- RLS Policies

-- users: own row only
create policy "users_select_own" on public.users for select using ((select auth.uid()) = id);
create policy "users_insert_own" on public.users for insert with check ((select auth.uid()) = id);
create policy "users_update_own" on public.users for update using ((select auth.uid()) = id);

-- meal_logs
create policy "meal_logs_select_own" on public.meal_logs for select using ((select auth.uid()) = user_id);
create policy "meal_logs_insert_own" on public.meal_logs for insert with check ((select auth.uid()) = user_id);
create policy "meal_logs_update_own" on public.meal_logs for update using ((select auth.uid()) = user_id);
create policy "meal_logs_delete_own" on public.meal_logs for delete using ((select auth.uid()) = user_id);

-- daily_nutrition_totals
create policy "daily_totals_select_own" on public.daily_nutrition_totals for select using ((select auth.uid()) = user_id);
create policy "daily_totals_insert_own" on public.daily_nutrition_totals for insert with check ((select auth.uid()) = user_id);
create policy "daily_totals_update_own" on public.daily_nutrition_totals for update using ((select auth.uid()) = user_id);
create policy "daily_totals_delete_own" on public.daily_nutrition_totals for delete using ((select auth.uid()) = user_id);

-- workout_sessions
create policy "workout_sessions_select_own" on public.workout_sessions for select using ((select auth.uid()) = user_id);
create policy "workout_sessions_insert_own" on public.workout_sessions for insert with check ((select auth.uid()) = user_id);
create policy "workout_sessions_update_own" on public.workout_sessions for update using ((select auth.uid()) = user_id);
create policy "workout_sessions_delete_own" on public.workout_sessions for delete using ((select auth.uid()) = user_id);

-- workout_exercises: access through session ownership
create policy "workout_exercises_select_own" on public.workout_exercises for select
  using (exists (
    select 1 from public.workout_sessions ws
    where ws.id = workout_session_id and ws.user_id = (select auth.uid())
  ));
create policy "workout_exercises_insert_own" on public.workout_exercises for insert
  with check (exists (
    select 1 from public.workout_sessions ws
    where ws.id = workout_session_id and ws.user_id = (select auth.uid())
  ));
create policy "workout_exercises_update_own" on public.workout_exercises for update
  using (exists (
    select 1 from public.workout_sessions ws
    where ws.id = workout_session_id and ws.user_id = (select auth.uid())
  ));
create policy "workout_exercises_delete_own" on public.workout_exercises for delete
  using (exists (
    select 1 from public.workout_sessions ws
    where ws.id = workout_session_id and ws.user_id = (select auth.uid())
  ));

-- workout_sets: access through exercise -> session ownership
create policy "workout_sets_select_own" on public.workout_sets for select
  using (exists (
    select 1 from public.workout_exercises we
    join public.workout_sessions ws on ws.id = we.workout_session_id
    where we.id = workout_exercise_id and ws.user_id = (select auth.uid())
  ));
create policy "workout_sets_insert_own" on public.workout_sets for insert
  with check (exists (
    select 1 from public.workout_exercises we
    join public.workout_sessions ws on ws.id = we.workout_session_id
    where we.id = workout_exercise_id and ws.user_id = (select auth.uid())
  ));
create policy "workout_sets_update_own" on public.workout_sets for update
  using (exists (
    select 1 from public.workout_exercises we
    join public.workout_sessions ws on ws.id = we.workout_session_id
    where we.id = workout_exercise_id and ws.user_id = (select auth.uid())
  ));
create policy "workout_sets_delete_own" on public.workout_sets for delete
  using (exists (
    select 1 from public.workout_exercises we
    join public.workout_sessions ws on ws.id = we.workout_session_id
    where we.id = workout_exercise_id and ws.user_id = (select auth.uid())
  ));

-- body_metrics
create policy "body_metrics_select_own" on public.body_metrics for select using ((select auth.uid()) = user_id);
create policy "body_metrics_insert_own" on public.body_metrics for insert with check ((select auth.uid()) = user_id);
create policy "body_metrics_update_own" on public.body_metrics for update using ((select auth.uid()) = user_id);
create policy "body_metrics_delete_own" on public.body_metrics for delete using ((select auth.uid()) = user_id);

-- user_aliases
create policy "user_aliases_select_own" on public.user_aliases for select using ((select auth.uid()) = user_id);
create policy "user_aliases_insert_own" on public.user_aliases for insert with check ((select auth.uid()) = user_id);
create policy "user_aliases_update_own" on public.user_aliases for update using ((select auth.uid()) = user_id);
create policy "user_aliases_delete_own" on public.user_aliases for delete using ((select auth.uid()) = user_id);

-- Auto-create user profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Function to recalculate daily totals
create or replace function public.recalculate_daily_totals(p_user_id uuid, p_date date)
returns void as $$
begin
  insert into public.daily_nutrition_totals (user_id, date, calories, protein_g, carbs_g, fat_g, fiber_g, updated_at)
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
    and date(logged_at) = p_date
  on conflict (user_id, date)
  do update set
    calories = excluded.calories,
    protein_g = excluded.protein_g,
    carbs_g = excluded.carbs_g,
    fat_g = excluded.fat_g,
    fiber_g = excluded.fiber_g,
    updated_at = now();
end;
$$ language plpgsql security definer;

-- Simplify workout_sessions: replace started_at/ended_at timestamps
-- with a plain date field and active boolean.
--
-- Motivation: workouts just need a date and an "open/closed" flag.
-- Duration tracking adds complexity with no value for this use case.

-- Add new columns
alter table public.workout_sessions
  add column if not exists date text,
  add column if not exists active boolean not null default true;

-- Backfill from existing data
update public.workout_sessions
set
  date = to_char(started_at at time zone 'America/New_York', 'YYYY-MM-DD'),
  active = (ended_at is null);

-- Make date not null after backfill
alter table public.workout_sessions
  alter column date set not null;

-- Drop old columns
alter table public.workout_sessions
  drop column started_at,
  drop column ended_at;

-- Replace index (old one on started_at will be dropped with the column)
create index if not exists idx_workout_sessions_user_date
  on public.workout_sessions(user_id, date);

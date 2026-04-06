-- Prevent duplicate workout sessions for the same user+date.
-- The getSessionForDate function now uses upsert to handle concurrency.

create unique index if not exists idx_workout_sessions_user_date_unique
  on public.workout_sessions(user_id, date);

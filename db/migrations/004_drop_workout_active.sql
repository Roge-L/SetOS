-- Remove the active column from workout_sessions.
-- Sessions are now implicitly grouped by date — no start/finish concept.

alter table public.workout_sessions drop column if exists active;

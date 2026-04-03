-- Fix daily totals recalculation to use America/New_York timezone
-- instead of UTC for date boundaries.
--
-- The issue: `date(logged_at)` uses UTC, so a meal logged at 10pm ET
-- on April 2 (which is 2am UTC April 3) would be counted as April 3.
--
-- The fix: convert logged_at to the user's timezone before extracting the date.
-- Postgres supports `AT TIME ZONE` for this conversion.
-- Ref: https://www.postgresql.org/docs/current/functions-datetime.html#FUNCTIONS-DATETIME-ZONECONVERT

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
    and date(logged_at at time zone 'America/New_York') = p_date
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

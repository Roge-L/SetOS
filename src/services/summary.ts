/**
 * Read-side composition: the "how am I tracking?" tools. `getDay` assembles one
 * day (meals + totals + workout + weight); `getWeek` rolls up a 7-day window with
 * averages and a weight trend.
 */

import type { Db } from "../db/client";
import type { DailyTotalsRow } from "../db/types";
import { assertDate, dateRange, shiftDate, todayDate } from "../lib/dates";
import { listMeals } from "./food";
import { listWorkouts } from "./workout";
import { getWeightForDate, getWeightRange } from "./body";
import { shapeTotals } from "./totals";

export async function getDay(db: Db, userId: string, tz: string, date?: string) {
  const day = date ? assertDate(date) : todayDate(tz);
  const [meals, workout, weight] = await Promise.all([
    listMeals(db, userId, tz, day),
    listWorkouts(db, userId, tz, { date: day }),
    getWeightForDate(db, userId, day),
  ]);
  return {
    date: day,
    day_totals: meals.day_totals,
    meals: meals.meals,
    workout: workout.workout,
    body_weight_lb: weight?.body_weight ?? null,
  };
}

export async function getWeek(db: Db, userId: string, tz: string, endDate?: string) {
  const end = endDate ? assertDate(endDate, "end_date") : todayDate(tz);
  const start = shiftDate(end, -6);
  const days = dateRange(start, end);

  const [totalsRes, workoutsRes, weights] = await Promise.all([
    db
      .from("daily_nutrition_totals")
      .select("*")
      .eq("user_id", userId)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true }),
    db
      .from("workout_sessions")
      .select("date, title")
      .eq("user_id", userId)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true }),
    getWeightRange(db, userId, start, end),
  ]);
  if (totalsRes.error) throw new Error(`Failed to read weekly totals: ${totalsRes.error.message}`);

  const totalsByDate = new Map<string, DailyTotalsRow>();
  for (const row of totalsRes.data ?? []) totalsByDate.set(row.date, row);

  const perDay = days.map((d) => ({ date: d, ...shapeTotals(totalsByDate.get(d) ?? null) }));
  const loggedDays = perDay.filter((d) => d.calories > 0);
  const avg = (key: "calories" | "protein_g" | "carbs_g" | "fat_g") =>
    loggedDays.length === 0 ? 0 : Math.round(loggedDays.reduce((s, d) => s + d[key], 0) / loggedDays.length);

  const workoutDays = (workoutsRes.data ?? []).map((w) => ({ date: w.date, title: w.title }));

  const weightSeries = weights.map((w) => ({ date: w.date, weight_lb: w.body_weight }));
  const firstW = weightSeries[0]?.weight_lb ?? null;
  const lastW = weightSeries[weightSeries.length - 1]?.weight_lb ?? null;
  const weightChange = firstW != null && lastW != null ? Math.round((lastW - firstW) * 10) / 10 : null;

  return {
    range: { start, end },
    logged_days: loggedDays.length,
    averages_on_logged_days: {
      calories: avg("calories"),
      protein_g: avg("protein_g"),
      carbs_g: avg("carbs_g"),
      fat_g: avg("fat_g"),
    },
    per_day: perDay,
    workout_days: workoutDays,
    workouts_count: workoutDays.length,
    weight: { series: weightSeries, change_lb: weightChange },
  };
}

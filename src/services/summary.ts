/**
 * Read-side composition — the "how am I tracking?" tools.
 *
 * These are deliberately action-shaped: `getDay` assembles everything about one
 * day, and `getSummary` rolls up an arbitrary range with averages, workout
 * frequency and a weight trend. Each replaces a chain of 3-4 lower-level calls
 * the model would otherwise have to sequence and aggregate itself.
 */

import type { Db } from "../db/client";
import type { DailyTotalsRow } from "../db/types";
import { assertDate, dateRange, shiftDate, todayDate } from "../lib/dates";
import { searchMeals } from "./food";
import { getWorkouts } from "./workout";
import { getWeightForDate, getWeightRange } from "./body";
import { shapeTotals } from "./totals";

export async function getDay(db: Db, userId: string, tz: string, date?: string) {
  const day = date ? assertDate(date) : todayDate(tz);
  const [meals, workouts, weight] = await Promise.all([
    searchMeals(db, userId, tz, { date: day, limit: 100 }),
    getWorkouts(db, userId, tz, { date: day }),
    getWeightForDate(db, userId, day),
  ]);
  return {
    date: day,
    day_totals: meals.day_totals,
    meals: meals.meals,
    workout: workouts.workouts[0] ?? null,
    body_weight_lb: weight?.body_weight ?? null,
  };
}

/**
 * Roll up an arbitrary date range (defaults to the last 7 days ending today).
 * Capped at 92 days so a single call can't flood context.
 */
export async function getSummary(
  db: Db,
  userId: string,
  tz: string,
  q: { start?: string; end?: string; days?: number; include_per_day?: boolean }
) {
  const end = q.end ? assertDate(q.end, "end") : todayDate(tz);
  const start = q.start
    ? assertDate(q.start, "start")
    : shiftDate(end, -(Math.min(Math.max(q.days ?? 7, 1), 92) - 1));
  if (end < start) throw new Error(`end (${end}) is before start (${start}).`);

  const days = dateRange(start, end);
  if (days.length > 92) throw new Error(`Range too long (${days.length} days). Max 92 — narrow it down.`);

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
  if (totalsRes.error) throw new Error(`Failed to read totals: ${totalsRes.error.message}`);

  const byDate = new Map<string, DailyTotalsRow>();
  for (const row of totalsRes.data ?? []) byDate.set(row.date, row);

  const perDay = days.map((d) => ({ date: d, ...shapeTotals(byDate.get(d) ?? null) }));
  const loggedDays = perDay.filter((d) => d.calories > 0);
  const avg = (k: "calories" | "protein_g" | "carbs_g" | "fat_g") =>
    loggedDays.length === 0 ? 0 : Math.round(loggedDays.reduce((s, d) => s + d[k], 0) / loggedDays.length);

  const workoutDays = (workoutsRes.data ?? []).map((w: { date: string; title: string | null }) => ({
    date: w.date,
    title: w.title,
  }));

  const series = weights.map((w) => ({ date: w.date, weight_lb: w.body_weight }));
  const first = series[0]?.weight_lb ?? null;
  const last = series[series.length - 1]?.weight_lb ?? null;

  return {
    range: { start, end, days: days.length },
    nutrition: {
      logged_days: loggedDays.length,
      averages_on_logged_days: {
        calories: avg("calories"),
        protein_g: avg("protein_g"),
        carbs_g: avg("carbs_g"),
        fat_g: avg("fat_g"),
      },
      ...(q.include_per_day === false ? {} : { per_day: perDay }),
    },
    workouts: { count: workoutDays.length, days: workoutDays },
    weight: {
      series,
      change_lb: first != null && last != null ? Math.round((last - first) * 10) / 10 : null,
    },
    _note:
      "Averages cover only days with food logged, so a missed day doesn't drag the average down. per_day includes zero-days — treat those as unlogged, not fasted.",
  };
}

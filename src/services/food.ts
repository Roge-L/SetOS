/**
 * Food logging. Claude supplies the estimated macros (it's the brain now); this
 * layer validates, stores, and keeps the daily totals in sync. There is no
 * server-side model here — `lookup_food` (services/nutrition.ts) is the optional
 * real-data source Claude can consult before calling `log_food`.
 */

import type { Db } from "../db/client";
import type { MealLogRow } from "../db/types";
import { recalcDailyTotals, getDayTotals, shapeTotals } from "./totals";
import {
  assertDate,
  currentTimeOfDay,
  dateInTimezone,
  localWallToUTC,
  shiftDate,
  todayDate,
  utcRangeForLocalDate,
} from "../lib/dates";
import { roundCal, roundG } from "../lib/format";

export interface LogFoodInput {
  name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  confidence?: "low" | "medium" | "high";
  assumptions?: string[];
  /** YYYY-MM-DD; defaults to today (local). */
  date?: string;
  /** HH:MM 24h local time; defaults to now. */
  time?: string;
}

/** Escape LIKE wildcards so a hint like "50%" doesn't become a wildcard match. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/** Wall-clock time-of-day from a "HH:MM" string, or null if malformed. */
function parseTime(t?: string): { hours: number; minutes: number; seconds: number } | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes, seconds: 0 };
}

function shapeMeal(row: MealLogRow, tz: string) {
  return {
    id: row.id,
    name: row.parsed_meal_name,
    calories: row.estimated_calories,
    protein_g: Math.round(row.estimated_protein_g),
    carbs_g: Math.round(row.estimated_carbs_g),
    fat_g: Math.round(row.estimated_fat_g),
    fiber_g: Math.round(row.estimated_fiber_g),
    confidence: row.confidence,
    logged_at: row.logged_at,
    local_date: dateInTimezone(new Date(row.logged_at), tz),
  };
}

export async function logFood(db: Db, userId: string, tz: string, input: LogFoodInput) {
  if (!input.name?.trim()) throw new Error("`name` is required.");
  const date = input.date ? assertDate(input.date) : todayDate(tz);

  let tod = currentTimeOfDay(tz);
  if (input.time !== undefined) {
    const parsed = parseTime(input.time);
    if (!parsed) throw new Error(`Invalid time "${input.time}". Use 24h HH:MM (e.g. 19:30).`);
    tod = parsed;
  }
  const loggedAt = localWallToUTC(date, tod.hours, tod.minutes, tod.seconds, tz).toISOString();

  const { data, error } = await db
    .from("meal_logs")
    .insert({
      user_id: userId,
      logged_at: loggedAt,
      source_type: "text",
      raw_text: input.name,
      parsed_meal_name: input.name.trim(),
      estimated_calories: roundCal(input.calories),
      estimated_protein_g: roundG(input.protein_g),
      estimated_carbs_g: roundG(input.carbs_g),
      estimated_fat_g: roundG(input.fat_g),
      estimated_fiber_g: roundG(input.fiber_g ?? 0),
      confidence: input.confidence ?? "medium",
      assumptions_json: input.assumptions ?? [],
    })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to save meal: ${error?.message ?? "no row returned"}`);

  await recalcDailyTotals(db, userId, date);
  const totals = await getDayTotals(db, userId, date);

  return { meal: shapeMeal(data, tz), date, day_totals: shapeTotals(totals) };
}

/** All meals for one local day (default today) plus that day's totals. */
export async function listMeals(db: Db, userId: string, tz: string, date?: string) {
  const day = date ? assertDate(date) : todayDate(tz);
  const { start, end } = utcRangeForLocalDate(day, tz);
  const { data, error } = await db
    .from("meal_logs")
    .select("*")
    .eq("user_id", userId)
    .gte("logged_at", start)
    .lt("logged_at", end)
    .order("logged_at", { ascending: true });
  if (error) throw new Error(`Failed to list meals: ${error.message}`);
  const totals = await getDayTotals(db, userId, day);
  return { date: day, meals: (data ?? []).map((m) => shapeMeal(m, tz)), day_totals: shapeTotals(totals) };
}

/** Find a meal by id (exact) or by name hint within the last 14 days. */
async function findMeals(
  db: Db,
  userId: string,
  opts: { meal_id?: string; name_hint?: string }
): Promise<MealLogRow[]> {
  if (opts.meal_id) {
    const { data } = await db
      .from("meal_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("id", opts.meal_id)
      .limit(1);
    return data ?? [];
  }
  if (!opts.name_hint) return [];
  const since = shiftDate(new Date().toISOString().slice(0, 10), -14);
  const { data } = await db
    .from("meal_logs")
    .select("*")
    .eq("user_id", userId)
    .ilike("parsed_meal_name", `%${escapeLike(opts.name_hint)}%`)
    .gte("logged_at", `${since}T00:00:00Z`)
    .order("logged_at", { ascending: false })
    .limit(10);
  return data ?? [];
}

export async function editMeal(
  db: Db,
  userId: string,
  tz: string,
  input: {
    meal_id: string;
    name?: string;
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    fiber_g?: number;
    confidence?: "low" | "medium" | "high";
  }
) {
  const matches = await findMeals(db, userId, { meal_id: input.meal_id });
  const existing = matches[0];
  if (!existing) throw new Error(`No meal found with id ${input.meal_id}.`);

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.parsed_meal_name = input.name.trim();
  if (input.calories !== undefined) patch.estimated_calories = roundCal(input.calories);
  if (input.protein_g !== undefined) patch.estimated_protein_g = roundG(input.protein_g);
  if (input.carbs_g !== undefined) patch.estimated_carbs_g = roundG(input.carbs_g);
  if (input.fat_g !== undefined) patch.estimated_fat_g = roundG(input.fat_g);
  if (input.fiber_g !== undefined) patch.estimated_fiber_g = roundG(input.fiber_g);
  if (input.confidence !== undefined) patch.confidence = input.confidence;

  const { data, error } = await db
    .from("meal_logs")
    .update(patch)
    .eq("id", existing.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to update meal: ${error?.message ?? "no row"}`);

  const date = dateInTimezone(new Date(data.logged_at), tz);
  await recalcDailyTotals(db, userId, date);
  const totals = await getDayTotals(db, userId, date);
  return { meal: shapeMeal(data, tz), date, day_totals: shapeTotals(totals) };
}

export async function moveMeal(
  db: Db,
  userId: string,
  tz: string,
  input: { meal_id?: string; name_hint?: string; target_date: string }
) {
  const target = assertDate(input.target_date, "target_date");
  const matches = await findMeals(db, userId, input);
  if (matches.length === 0) {
    throw new Error(`No meal found matching ${input.meal_id ?? `"${input.name_hint}"`} in the last 14 days.`);
  }
  if (matches.length > 1 && !input.meal_id) {
    return {
      moved: false,
      ambiguous: true,
      matches: matches.map((m) => shapeMeal(m, tz)),
      _note: "Multiple meals matched. Call again with the exact meal_id to move one.",
    };
  }
  const meal = matches[0]!;
  const oldDate = dateInTimezone(new Date(meal.logged_at), tz);
  // Preserve the local time-of-day; only the calendar date changes.
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(meal.logged_at));
  const num = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const newLoggedAt = localWallToUTC(target, num("hour"), num("minute"), num("second"), tz).toISOString();

  const { error } = await db
    .from("meal_logs")
    .update({ logged_at: newLoggedAt, updated_at: new Date().toISOString() })
    .eq("id", meal.id)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to move meal: ${error.message}`);

  await recalcDailyTotals(db, userId, oldDate);
  if (target !== oldDate) await recalcDailyTotals(db, userId, target);

  return { moved: true, meal: meal.parsed_meal_name, from: oldDate, to: target };
}

export async function deleteMeal(
  db: Db,
  userId: string,
  tz: string,
  input: { meal_id?: string; name_hint?: string }
) {
  const matches = await findMeals(db, userId, input);
  if (matches.length === 0) {
    throw new Error(`No meal found matching ${input.meal_id ?? `"${input.name_hint}"`} in the last 14 days.`);
  }
  if (matches.length > 1 && !input.meal_id) {
    return {
      deleted: false,
      ambiguous: true,
      matches: matches.map((m) => shapeMeal(m, tz)),
      _note: "Multiple meals matched. Call again with the exact meal_id to delete one.",
    };
  }
  const meal = matches[0]!;
  const date = dateInTimezone(new Date(meal.logged_at), tz);
  const { error } = await db.from("meal_logs").delete().eq("id", meal.id).eq("user_id", userId);
  if (error) throw new Error(`Failed to delete meal: ${error.message}`);
  await recalcDailyTotals(db, userId, date);
  const totals = await getDayTotals(db, userId, date);
  return { deleted: true, meal: meal.parsed_meal_name, date, day_totals: shapeTotals(totals) };
}

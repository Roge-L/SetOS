/**
 * Meal logging + retrieval.
 *
 * Claude supplies the estimated macros (it's the intelligence); this layer
 * validates, stores, and keeps daily totals in sync. No server-side model —
 * `lookup_food` (services/nutrition.ts) is the optional ground-truth source.
 *
 * Design notes (per MCP tool-design guidance): operations that are commonly
 * chained are bundled here — logging accepts a BATCH, and `updateMeal` patches
 * any field including the date/time, so "fix it and move it" is one call.
 */

import type { Db } from "../db/client";
import type { MealLogRow } from "../db/types";
import { recalcDailyTotals, getDayTotals, shapeTotals } from "./totals";
import {
  assertDate,
  currentTimeOfDay,
  dateInTimezone,
  localWallToUTC,
  timeOfDayInTimezone,
  todayDate,
  utcRangeForLocalDate,
} from "../lib/dates";
import { escapeLike, roundCal, roundG } from "../lib/format";

export interface MealInput {
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

/** Wall-clock time-of-day from "HH:MM", or null if malformed. */
function parseTime(t: string): { hours: number; minutes: number; seconds: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return { hours, minutes, seconds: 0 };
}

function shapeMeal(row: MealLogRow, tz: string, detailed = false) {
  const base = {
    id: row.id,
    name: row.parsed_meal_name,
    calories: row.estimated_calories,
    protein_g: Math.round(row.estimated_protein_g),
    carbs_g: Math.round(row.estimated_carbs_g),
    fat_g: Math.round(row.estimated_fat_g),
    fiber_g: Math.round(row.estimated_fiber_g),
    date: dateInTimezone(new Date(row.logged_at), tz),
    time: timeOfDayInTimezone(new Date(row.logged_at), tz),
  };
  if (!detailed) return base;
  return {
    ...base,
    confidence: row.confidence,
    assumptions: Array.isArray(row.assumptions_json) ? row.assumptions_json : [],
    logged_at: row.logged_at,
  };
}

/** Resolve a meal's stored timestamp from a local date + optional time. */
function resolveLoggedAt(date: string, time: string | undefined, tz: string): string {
  let tod = currentTimeOfDay(tz);
  if (time !== undefined) {
    const parsed = parseTime(time);
    if (!parsed) throw new Error(`Invalid time "${time}". Use 24h HH:MM, e.g. 19:30.`);
    tod = parsed;
  }
  return localWallToUTC(date, tod.hours, tod.minutes, tod.seconds, tz).toISOString();
}

/**
 * Log one or more meals in a single call. Batching matters: "I had eggs, toast
 * and coffee" is one user intent and should not cost three round-trips.
 * Daily totals are recalculated once per affected date.
 */
export async function logMeals(db: Db, userId: string, tz: string, meals: MealInput[]) {
  if (meals.length === 0) throw new Error("Provide at least one meal.");
  if (meals.length > 25) throw new Error(`Too many meals in one call (${meals.length}). Max 25.`);

  const rows = meals.map((m) => {
    if (!m.name?.trim()) throw new Error("Every meal needs a `name`.");
    const date = m.date ? assertDate(m.date) : todayDate(tz);
    return {
      user_id: userId,
      logged_at: resolveLoggedAt(date, m.time, tz),
      source_type: "text",
      raw_text: m.name,
      parsed_meal_name: m.name.trim(),
      estimated_calories: roundCal(m.calories),
      estimated_protein_g: roundG(m.protein_g),
      estimated_carbs_g: roundG(m.carbs_g),
      estimated_fat_g: roundG(m.fat_g),
      estimated_fiber_g: roundG(m.fiber_g ?? 0),
      confidence: m.confidence ?? "medium",
      assumptions_json: m.assumptions ?? [],
      _date: date,
    };
  });

  const affectedDates = [...new Set(rows.map((r) => r._date))];
  const insertRows = rows.map(({ _date, ...rest }) => rest);

  const { data, error } = await db.from("meal_logs").insert(insertRows).select("*");
  if (error) throw new Error(`Failed to save meals: ${error.message}`);

  for (const date of affectedDates) await recalcDailyTotals(db, userId, date);

  const totals: Record<string, ReturnType<typeof shapeTotals>> = {};
  for (const date of affectedDates) totals[date] = shapeTotals(await getDayTotals(db, userId, date));

  return {
    logged: (data ?? []).length,
    meals: (data ?? []).map((m: MealLogRow) => shapeMeal(m, tz)),
    day_totals: totals,
  };
}

export interface MealSearch {
  /** Single local day (shorthand for start=end=date). */
  date?: string;
  start?: string;
  end?: string;
  /** Case-insensitive substring of the meal name. */
  name_contains?: string;
  min_calories?: number;
  max_calories?: number;
  limit?: number;
  offset?: number;
  response_format?: "concise" | "detailed";
}

/**
 * Search meals with filters + pagination. Defaults to today when no date range
 * is given, which is the overwhelmingly common case.
 */
export async function searchMeals(db: Db, userId: string, tz: string, q: MealSearch) {
  const start = q.date ? assertDate(q.date) : q.start ? assertDate(q.start, "start") : todayDate(tz);
  const end = q.date ? assertDate(q.date) : q.end ? assertDate(q.end, "end") : start;
  if (end < start) throw new Error(`end (${end}) is before start (${start}).`);

  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const offset = Math.max(q.offset ?? 0, 0);
  const detailed = q.response_format === "detailed";

  const from = utcRangeForLocalDate(start, tz).start;
  const to = utcRangeForLocalDate(end, tz).end;

  let query = db
    .from("meal_logs")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .gte("logged_at", from)
    .lt("logged_at", to);

  if (q.name_contains) query = query.ilike("parsed_meal_name", `%${escapeLike(q.name_contains)}%`);
  if (q.min_calories !== undefined) query = query.gte("estimated_calories", q.min_calories);
  if (q.max_calories !== undefined) query = query.lte("estimated_calories", q.max_calories);

  const { data, error, count } = await query
    .order("logged_at", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to search meals: ${error.message}`);

  const meals = (data ?? []).map((m: MealLogRow) => shapeMeal(m, tz, detailed));
  const total = count ?? meals.length;

  // A single-day search is nearly always "how am I tracking today" — include totals.
  const dayTotals = start === end ? shapeTotals(await getDayTotals(db, userId, start)) : undefined;

  return {
    range: { start, end },
    meals,
    ...(dayTotals ? { day_totals: dayTotals } : {}),
    total_count: total,
    has_more: offset + meals.length < total,
    next_offset: offset + meals.length < total ? offset + meals.length : null,
  };
}

/**
 * Patch any field of a meal — name, macros, confidence, assumptions, and the
 * date/time it belongs to. Moving a meal between days is just `date`, so there
 * is no separate move tool. Totals recalculate on both the old and new day.
 */
export async function updateMeal(
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
    assumptions?: string[];
    date?: string;
    time?: string;
  }
) {
  const { data: existing, error: readErr } = await db
    .from("meal_logs")
    .select("*")
    .eq("user_id", userId)
    .eq("id", input.meal_id)
    .maybeSingle();
  if (readErr) throw new Error(`Failed to read meal: ${readErr.message}`);
  if (!existing) {
    throw new Error(`No meal with id ${input.meal_id}. Use setos_search_meals to find the right id.`);
  }

  const oldDate = dateInTimezone(new Date(existing.logged_at), tz);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (input.name !== undefined) patch.parsed_meal_name = input.name.trim();
  if (input.calories !== undefined) patch.estimated_calories = roundCal(input.calories);
  if (input.protein_g !== undefined) patch.estimated_protein_g = roundG(input.protein_g);
  if (input.carbs_g !== undefined) patch.estimated_carbs_g = roundG(input.carbs_g);
  if (input.fat_g !== undefined) patch.estimated_fat_g = roundG(input.fat_g);
  if (input.fiber_g !== undefined) patch.estimated_fiber_g = roundG(input.fiber_g);
  if (input.confidence !== undefined) patch.confidence = input.confidence;
  if (input.assumptions !== undefined) patch.assumptions_json = input.assumptions;

  // Re-stamp the timestamp when either the date or the time changes.
  if (input.date !== undefined || input.time !== undefined) {
    const newDate = input.date ? assertDate(input.date) : oldDate;
    const keepTime = timeOfDayInTimezone(new Date(existing.logged_at), tz);
    patch.logged_at = resolveLoggedAt(newDate, input.time ?? keepTime, tz);
  }

  const { data, error } = await db
    .from("meal_logs")
    .update(patch)
    .eq("id", input.meal_id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to update meal: ${error?.message ?? "no row"}`);

  const newDate = dateInTimezone(new Date(data.logged_at), tz);
  await recalcDailyTotals(db, userId, oldDate);
  if (newDate !== oldDate) await recalcDailyTotals(db, userId, newDate);

  return {
    updated: true,
    meal: shapeMeal(data, tz, true),
    moved: newDate !== oldDate ? { from: oldDate, to: newDate } : undefined,
    day_totals: shapeTotals(await getDayTotals(db, userId, newDate)),
  };
}

/**
 * Delete meals by id (batch). Ids come from setos_search_meals — deleting by a
 * fuzzy name is deliberately not supported, so a single call can never remove
 * the wrong meal.
 */
export async function deleteMeals(db: Db, userId: string, tz: string, mealIds: string[]) {
  if (mealIds.length === 0) throw new Error("Provide at least one meal_id.");

  const { data: found, error: readErr } = await db
    .from("meal_logs")
    .select("id, parsed_meal_name, logged_at")
    .eq("user_id", userId)
    .in("id", mealIds);
  if (readErr) throw new Error(`Failed to read meals: ${readErr.message}`);
  if (!found || found.length === 0) {
    throw new Error("None of those meal_ids exist. Use setos_search_meals to get current ids.");
  }

  const dates = [...new Set(found.map((m) => dateInTimezone(new Date(m.logged_at), tz)))];
  const { error } = await db
    .from("meal_logs")
    .delete()
    .eq("user_id", userId)
    .in(
      "id",
      found.map((m) => m.id)
    );
  if (error) throw new Error(`Failed to delete meals: ${error.message}`);

  for (const d of dates) await recalcDailyTotals(db, userId, d);
  const totals: Record<string, ReturnType<typeof shapeTotals>> = {};
  for (const d of dates) totals[d] = shapeTotals(await getDayTotals(db, userId, d));

  return {
    deleted: found.length,
    names: found.map((m) => m.parsed_meal_name),
    not_found: mealIds.filter((id) => !found.some((f) => f.id === id)),
    day_totals: totals,
  };
}

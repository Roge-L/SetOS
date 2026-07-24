/**
 * Body-weight logging. One entry per local day (unique user+date), upserted so
 * re-logging the same day overwrites rather than duplicates.
 *
 * The schema stores a single `body_weight` number with no unit column, so SetOS
 * treats stored weights as pounds by convention. A `kg` entry is converted to lb
 * on the way in so trends stay comparable.
 */

import type { Db } from "../db/client";
import type { BodyMetricRow } from "../db/types";
import { assertDate, todayDate } from "../lib/dates";

const KG_TO_LB = 2.2046226218;

export async function logWeight(
  db: Db,
  userId: string,
  tz: string,
  input: { weight: number; unit?: "lb" | "kg"; date?: string; notes?: string | null }
) {
  if (!Number.isFinite(input.weight) || input.weight <= 0) throw new Error("`weight` must be a positive number.");
  const date = input.date ? assertDate(input.date) : todayDate(tz);
  const lb = input.unit === "kg" ? input.weight * KG_TO_LB : input.weight;
  const bodyWeight = Math.round(lb * 10) / 10;

  const { data, error } = await db
    .from("body_metrics")
    .upsert({ user_id: userId, date, body_weight: bodyWeight, notes: input.notes ?? null }, { onConflict: "user_id,date" })
    .select("*")
    .single();
  if (error || !data) throw new Error(`Failed to log weight: ${error?.message ?? "no row"}`);
  return { date, weight_lb: bodyWeight, notes: data.notes };
}

/** The weight entry for a specific day, if any. */
export async function getWeightForDate(db: Db, userId: string, date: string): Promise<BodyMetricRow | null> {
  const { data, error } = await db
    .from("body_metrics")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(`Failed to read weight: ${error.message}`);
  return data ?? null;
}

/** Weight entries in [start, end] (inclusive), oldest first. */
export async function getWeightRange(db: Db, userId: string, start: string, end: string): Promise<BodyMetricRow[]> {
  const { data, error } = await db
    .from("body_metrics")
    .select("*")
    .eq("user_id", userId)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });
  if (error) throw new Error(`Failed to read weight range: ${error.message}`);
  return data ?? [];
}

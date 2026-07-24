import type { Db } from "../db/client";
import type { DailyTotalsRow } from "../db/types";

/**
 * Rebuild the materialized daily totals for one local day by calling the
 * `recalculate_daily_totals` SQL function (which sums meal_logs grouped by
 * `date(logged_at at time zone 'America/New_York')`). Call this after any write
 * that changes a day's meals (log / edit / move / delete).
 */
export async function recalcDailyTotals(db: Db, userId: string, date: string): Promise<void> {
  const { error } = await db.rpc("recalculate_daily_totals", { p_user_id: userId, p_date: date });
  if (error) throw new Error(`Failed to recalculate daily totals for ${date}: ${error.message}`);
}

/** The stored totals row for a day, or null if nothing has been logged yet. */
export async function getDayTotals(db: Db, userId: string, date: string): Promise<DailyTotalsRow | null> {
  const { data, error } = await db
    .from("daily_nutrition_totals")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(`Failed to read daily totals for ${date}: ${error.message}`);
  return data ?? null;
}

/** Compact macro shape for tool output. */
export function shapeTotals(row: DailyTotalsRow | null) {
  return {
    calories: row?.calories ?? 0,
    protein_g: Math.round(row?.protein_g ?? 0),
    carbs_g: Math.round(row?.carbs_g ?? 0),
    fat_g: Math.round(row?.fat_g ?? 0),
    fiber_g: Math.round(row?.fiber_g ?? 0),
  };
}

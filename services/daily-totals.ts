import { createAdminClient } from "@/lib/supabase/admin";

export async function recalculateDailyTotals(
  userId: string,
  date: string
): Promise<void> {
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("recalculate_daily_totals", {
    p_user_id: userId,
    p_date: date,
  });
  if (error) {
    throw new Error(`Failed to recalculate daily totals for ${date}: ${error.message}`);
  }
}

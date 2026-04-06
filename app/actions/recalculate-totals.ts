"use server";

import { recalculateDailyTotals } from "@/services/daily-totals";
import { createClient } from "@/lib/supabase/server";

export async function recalculateTotalsAction(dates: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  for (const date of dates) {
    await recalculateDailyTotals(user.id, date);
  }
}

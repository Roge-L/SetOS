import { sendMessage } from "@/bot/handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { recalculateDailyTotals } from "@/services/daily-totals";
import { todayDate, dateInTimezone } from "@/lib/utils";

// Returns true if the message was handled as a quick action
export async function handleQuickAction(
  chatId: number,
  userId: string,
  text: string
): Promise<boolean> {
  const lower = text.toLowerCase().trim();

  // "delete last" / "undo"
  if (lower === "delete last" || lower === "undo") {
    return await deleteLastMeal(chatId, userId);
  }

  // "move last to yesterday"
  const moveYesterday = lower.match(
    /^move\s+last\s+to\s+yesterday$/
  );
  if (moveYesterday) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = dateInTimezone(yesterday);
    return await moveLastMeal(chatId, userId, targetDate);
  }

  // "move last to april 2" / "move last to 04-02" / "move last to 2026-04-02"
  const moveDate = lower.match(
    /^move\s+last\s+to\s+(.+)$/
  );
  if (moveDate) {
    const targetDate = parseFlexibleDate(moveDate[1].trim());
    if (!targetDate) {
      await sendMessage(chatId, "Couldn't parse that date. Try: `move last to yesterday` or `move last to 2026-04-02`");
      return true;
    }
    return await moveLastMeal(chatId, userId, targetDate);
  }

  return false;
}

async function deleteLastMeal(
  chatId: number,
  userId: string
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: meal } = await supabase
    .from("meal_logs")
    .select("id, parsed_meal_name, logged_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!meal) {
    await sendMessage(chatId, "No meals to delete.");
    return true;
  }

  await supabase.from("meal_logs").delete().eq("id", meal.id);

  // Recalculate totals for the day the meal was on
  const mealDate = dateInTimezone(new Date(meal.logged_at));
  await recalculateDailyTotals(userId, mealDate);

  await sendMessage(chatId, `Deleted: ${meal.parsed_meal_name}`);
  return true;
}

async function moveLastMeal(
  chatId: number,
  userId: string,
  targetDate: string
): Promise<boolean> {
  const supabase = createAdminClient();

  const { data: meal } = await supabase
    .from("meal_logs")
    .select("id, parsed_meal_name, logged_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!meal) {
    await sendMessage(chatId, "No meals to move.");
    return true;
  }

  // Keep the same time-of-day, just change the date
  const oldDate = new Date(meal.logged_at);
  const timePart = oldDate.toISOString().slice(11); // HH:MM:SS.mmmZ
  const newLoggedAt = `${targetDate}T${timePart}`;

  const originalDate = dateInTimezone(oldDate);

  await supabase
    .from("meal_logs")
    .update({ logged_at: newLoggedAt, updated_at: new Date().toISOString() })
    .eq("id", meal.id);

  // Recalculate totals for both the old and new dates
  await recalculateDailyTotals(userId, originalDate);
  await recalculateDailyTotals(userId, targetDate);

  await sendMessage(
    chatId,
    `Moved *${meal.parsed_meal_name}* to ${targetDate}`
  );
  return true;
}

// Parse flexible date formats: "yesterday", "april 2", "04-02", "2026-04-02"
function parseFlexibleDate(input: string): string | null {
  const lower = input.toLowerCase().trim();

  if (lower === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dateInTimezone(d);
  }

  if (lower === "today") {
    return todayDate();
  }

  // "april 2", "apr 2", "april 2 2026"
  const monthNames: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };

  const monthDay = lower.match(
    /^(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|september|oct|october|nov|november|dec|december)\s+(\d{1,2})(?:\s+(\d{4}))?$/
  );
  if (monthDay) {
    const month = monthNames[monthDay[1]];
    const day = parseInt(monthDay[2]);
    const year = monthDay[3]
      ? parseInt(monthDay[3])
      : new Date().getFullYear();
    const d = new Date(year, month, day);
    return dateInTimezone(d);
  }

  // ISO format: "2026-04-02"
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) {
    return lower;
  }

  // "04-02" or "4-2"
  const shortDate = lower.match(/^(\d{1,2})-(\d{1,2})$/);
  if (shortDate) {
    const month = parseInt(shortDate[1]) - 1;
    const day = parseInt(shortDate[2]);
    const d = new Date(new Date().getFullYear(), month, day);
    return dateInTimezone(d);
  }

  return null;
}

import { sendMessage } from "@/bot/handler";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayDate, getUTCRangeForLocalDate } from "@/lib/utils";
import {
  getActiveSession,
  startWorkoutSession,
  finishWorkoutSession,
} from "@/services/workout-logger";

async function getUserId(telegramChatId: number): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("user_aliases")
    .select("user_id")
    .eq("alias_type", "telegram")
    .eq("alias_key", String(telegramChatId))
    .limit(1)
    .single();
  return data?.user_id || null;
}

export async function handleCommand(
  chatId: number,
  text: string,
  telegramUserId?: number
) {
  const cmd = text.split(" ")[0].toLowerCase();

  switch (cmd) {
    case "/start": {
      await sendMessage(
        chatId,
        `*SetOS Bot*\n\nTo link your account, add a Telegram alias in the app with your chat ID: \`${chatId}\`\n\nCommands:\n/help — Show help\n/today — Today's summary\n/startworkout — Start logging a workout\n/finishworkout — Finish current workout`
      );
      break;
    }

    case "/help": {
      await sendMessage(
        chatId,
        `*How to use SetOS:*\n\n🍽 *Food:* Send a text message, photo, or voice note\n🏋️ *Workout:* Use /startworkout, then send sets\n\nExamples:\n• "2 eggs, toast, protein shake"\n• "bench 185x8"\n• "ran 25 min easy"\n• Send a meal photo with caption\n\n*Quick actions:*\n• "delete last" — delete last meal\n• "undo" — same as delete last\n• "move last to yesterday"\n• "move last to april 2"\n\nCommands:\n/today — Today's summary\n/startworkout — Begin workout\n/finishworkout — End workout`
      );
      break;
    }

    case "/today": {
      const userId = await getUserId(chatId);
      if (!userId) {
        await sendMessage(chatId, "Not linked. Use /start for setup.");
        return;
      }

      const supabase = createAdminClient();
      const today = todayDate();
      const { start, end } = getUTCRangeForLocalDate(today);

      const { data: totals } = await supabase
        .from("daily_nutrition_totals")
        .select("*")
        .eq("user_id", userId)
        .eq("date", today)
        .single();

      const { data: meals } = await supabase
        .from("meal_logs")
        .select("parsed_meal_name, estimated_calories")
        .eq("user_id", userId)
        .gte("logged_at", start)
        .lte("logged_at", end)
        .order("logged_at");

      const { data: workouts } = await supabase
        .from("workout_sessions")
        .select("title, started_at, ended_at")
        .eq("user_id", userId)
        .gte("started_at", start)
        .lte("started_at", end);

      let msg = `*Today — ${today}*\n\n`;

      if (totals) {
        msg += `Cal: ${totals.calories} | P: ${Math.round(totals.protein_g)}g | C: ${Math.round(totals.carbs_g)}g | F: ${Math.round(totals.fat_g)}g | Fiber: ${Math.round(totals.fiber_g)}g\n\n`;
      } else {
        msg += `No food logged yet.\n\n`;
      }

      if (meals && meals.length > 0) {
        msg += `*Meals:*\n`;
        for (const m of meals) {
          msg += `• ${m.parsed_meal_name} (${m.estimated_calories} cal)\n`;
        }
        msg += "\n";
      }

      if (workouts && workouts.length > 0) {
        msg += `*Workouts:*\n`;
        for (const w of workouts) {
          msg += `• ${w.title || "Workout"} ${w.ended_at ? "✓" : "(in progress)"}\n`;
        }
      }

      await sendMessage(chatId, msg);
      break;
    }

    case "/startworkout": {
      const userId = await getUserId(chatId);
      if (!userId) {
        await sendMessage(chatId, "Not linked. Use /start for setup.");
        return;
      }

      const existing = await getActiveSession(userId);
      if (existing) {
        await sendMessage(
          chatId,
          "You already have an active workout. Use /finishworkout first."
        );
        return;
      }

      const title = text.replace("/startworkout", "").trim() || undefined;
      const session = await startWorkoutSession(userId, title);
      await sendMessage(
        chatId,
        `Workout started${session.title ? `: ${session.title}` : ""}. Send your sets!`
      );
      break;
    }

    case "/finishworkout": {
      const userId = await getUserId(chatId);
      if (!userId) {
        await sendMessage(chatId, "Not linked. Use /start for setup.");
        return;
      }

      const session = await getActiveSession(userId);
      if (!session) {
        await sendMessage(chatId, "No active workout to finish.");
        return;
      }

      await finishWorkoutSession(session.id);
      await sendMessage(chatId, "Workout finished. Nice work!");
      break;
    }

    default: {
      await sendMessage(chatId, "Unknown command. Try /help.");
    }
  }
}

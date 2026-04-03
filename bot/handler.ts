import { handleCommand } from "@/bot/commands";
import { handleQuickAction } from "@/bot/quick-actions";
import { handleFoodMessage } from "@/bot/food";
import { handleWorkoutMessage } from "@/bot/workout";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveSession } from "@/services/workout-logger";

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name?: string };
  chat: { id: number };
  text?: string;
  voice?: { file_id: string; duration: number };
  photo?: Array<{ file_id: string; width: number; height: number }>;
  caption?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

// Look up the SetOS user_id from a Telegram chat ID
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

async function sendMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const msg = update.message;
  if (!msg) return;

  const chatId = msg.chat.id;

  // Handle commands
  if (msg.text?.startsWith("/")) {
    await handleCommand(chatId, msg.text, msg.from?.id);
    return;
  }

  // Look up user
  const userId = await getUserId(chatId);
  if (!userId) {
    await sendMessage(
      chatId,
      "Not linked. Use /start to set up your account."
    );
    return;
  }

  // Check if user has an active workout session
  const activeSession = await getActiveSession(userId);

  // Route: photo => food
  if (msg.photo && msg.photo.length > 0) {
    await handleFoodMessage(chatId, userId, {
      text: msg.caption || null,
      photoFileId: msg.photo[msg.photo.length - 1].file_id, // highest res
    });
    return;
  }

  // Route: voice
  if (msg.voice) {
    if (activeSession) {
      // During workout, voice = workout logging not supported, treat as food
      await handleFoodMessage(chatId, userId, {
        voiceFileId: msg.voice.file_id,
      });
    } else {
      await handleFoodMessage(chatId, userId, {
        voiceFileId: msg.voice.file_id,
      });
    }
    return;
  }

  // Route: quick actions (delete last, move last, undo)
  if (msg.text) {
    const handled = await handleQuickAction(chatId, userId, msg.text);
    if (handled) return;
  }

  // Route: text
  if (msg.text) {
    if (activeSession) {
      await handleWorkoutMessage(chatId, userId, activeSession.id, msg.text);
    } else {
      await handleFoodMessage(chatId, userId, { text: msg.text });
    }
    return;
  }

  await sendMessage(chatId, "Send text, a photo, or a voice note to log.");
}

export { sendMessage };

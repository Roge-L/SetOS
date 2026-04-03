import { runAgent } from "@/bot/agent";
import { createAdminClient } from "@/lib/supabase/admin";
import { transcribeAudio } from "@/services/openai/transcribe";
import { downloadTelegramFile, uploadMealImage } from "@/bot/telegram-api";
import { estimateMeal } from "@/services/openai/estimate-meal";
import { logFood } from "@/services/food-logger";

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

  // /start is handled before auth since it's used for setup
  if (msg.text === "/start") {
    await sendMessage(
      chatId,
      `*SetOS Bot*\n\nTo link your account, add a Telegram alias in the app with your chat ID: \`${chatId}\`\n\nOnce linked, just send messages naturally — food, workouts, corrections. The bot figures out what you mean.`
    );
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

  try {
    // Photos go straight to OpenAI vision (databases can't process images)
    if (msg.photo && msg.photo.length > 0) {
      const photoBuffer = await downloadTelegramFile(
        msg.photo[msg.photo.length - 1].file_id
      );
      const imageUrl = await uploadMealImage(userId, photoBuffer);

      const result = await logFood({
        userId,
        text: msg.caption || null,
        imageUrl,
      });

      const est = result.estimation;
      let reply = `*${est.parsed_meal_name}*\n`;
      reply += `${est.estimated_calories} cal | P: ${Math.round(est.estimated_protein_g)}g | C: ${Math.round(est.estimated_carbs_g)}g | F: ${Math.round(est.estimated_fat_g)}g`;
      if (est.estimated_fiber_g > 0) {
        reply += ` | Fiber: ${Math.round(est.estimated_fiber_g)}g`;
      }
      reply += `\n_${est.confidence} confidence_`;
      await sendMessage(chatId, reply);
      return;
    }

    // Voice: transcribe first, then run through the agent
    let userText = msg.text || "";
    let extraContext: string | undefined;

    if (msg.voice) {
      const audioBuffer = await downloadTelegramFile(msg.voice.file_id);
      const transcript = await transcribeAudio(audioBuffer);
      userText = transcript;
      extraContext = "This was transcribed from a voice message.";
    }

    if (!userText.trim()) {
      await sendMessage(chatId, "Send text, a photo, or a voice note.");
      return;
    }

    // Everything else goes through the smart agent
    const response = await runAgent(userId, userText, extraContext);
    await sendMessage(chatId, response);
  } catch (error) {
    console.error("Bot error:", error);
    await sendMessage(chatId, "Something went wrong. Try again.");
  }
}

export { sendMessage };

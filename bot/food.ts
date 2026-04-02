import { sendMessage } from "@/bot/handler";
import { logFood } from "@/services/food-logger";
import { downloadTelegramFile } from "@/bot/telegram-api";
import { uploadMealImage } from "@/bot/telegram-api";

interface FoodInput {
  text?: string | null;
  voiceFileId?: string | null;
  photoFileId?: string | null;
}

export async function handleFoodMessage(
  chatId: number,
  userId: string,
  input: FoodInput
) {
  try {
    let audioBuffer: ArrayBuffer | null = null;
    let imageUrl: string | null = null;

    // Download voice file if present
    if (input.voiceFileId) {
      audioBuffer = await downloadTelegramFile(input.voiceFileId);
    }

    // Download and upload photo if present
    if (input.photoFileId) {
      const photoBuffer = await downloadTelegramFile(input.photoFileId);
      imageUrl = await uploadMealImage(userId, photoBuffer);
    }

    const result = await logFood({
      userId,
      text: input.text,
      audioBuffer,
      imageUrl,
    });

    const est = result.estimation;
    let msg = `*${est.parsed_meal_name}*\n`;
    msg += `${est.estimated_calories} cal | P: ${Math.round(est.estimated_protein_g)}g | C: ${Math.round(est.estimated_carbs_g)}g | F: ${Math.round(est.estimated_fat_g)}g`;
    if (est.estimated_fiber_g > 0) {
      msg += ` | Fiber: ${Math.round(est.estimated_fiber_g)}g`;
    }
    msg += `\n_${est.confidence} confidence_`;

    if (est.assumptions.length > 0) {
      msg += `\n\n_Assumptions:_\n`;
      for (const a of est.assumptions.slice(0, 3)) {
        msg += `• _${a}_\n`;
      }
    }

    await sendMessage(chatId, msg);
  } catch (error) {
    console.error("Food logging error:", error);
    await sendMessage(chatId, "Failed to log food. Please try again.");
  }
}

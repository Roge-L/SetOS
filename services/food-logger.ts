import { estimateMeal } from "@/services/openai/estimate-meal";
import { transcribeAudio } from "@/services/openai/transcribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { recalculateDailyTotals } from "@/services/daily-totals";
import type { MealEstimation } from "@/validators/meal";

type SourceType = "text" | "voice" | "photo" | "multimodal";

interface LogFoodInput {
  userId: string;
  text?: string | null;
  audioBuffer?: ArrayBuffer | null;
  imageUrl?: string | null;
}

interface LogFoodResult {
  estimation: MealEstimation;
  mealLogId: string;
}

function determineSourceType(input: LogFoodInput): SourceType {
  const hasText = !!input.text;
  const hasAudio = !!input.audioBuffer;
  const hasImage = !!input.imageUrl;

  if (hasImage && (hasText || hasAudio)) return "multimodal";
  if (hasImage) return "photo";
  if (hasAudio) return "voice";
  return "text";
}

export async function logFood(input: LogFoodInput): Promise<LogFoodResult> {
  let transcript: string | null = null;

  // Transcribe audio if present
  if (input.audioBuffer) {
    transcript = await transcribeAudio(input.audioBuffer);
  }

  // Estimate macros
  const estimation = await estimateMeal({
    text: input.text,
    transcript,
    imageUrl: input.imageUrl,
  });

  const sourceType = determineSourceType(input);

  // Save to database
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("meal_logs")
    .insert({
      user_id: input.userId,
      logged_at: new Date().toISOString(),
      source_type: sourceType,
      raw_text: input.text || null,
      transcript_text: transcript,
      image_url: input.imageUrl || null,
      parsed_meal_name: estimation.parsed_meal_name,
      estimated_calories: estimation.estimated_calories,
      estimated_protein_g: estimation.estimated_protein_g,
      estimated_carbs_g: estimation.estimated_carbs_g,
      estimated_fat_g: estimation.estimated_fat_g,
      estimated_fiber_g: estimation.estimated_fiber_g,
      confidence: estimation.confidence,
      assumptions_json: estimation.assumptions,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save meal log: ${error.message}`);

  // Recalculate daily totals
  const today = new Date().toISOString().slice(0, 10);
  await recalculateDailyTotals(input.userId, today);

  return { estimation, mealLogId: data.id };
}

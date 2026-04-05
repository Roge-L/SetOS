import {
  estimateMeal,
  estimateMealWithWebSearch,
} from "@/services/openai/estimate-meal";
import { transcribeAudio } from "@/services/openai/transcribe";
import { lookupFatSecret } from "@/services/fatsecret";
import { searchOpenFoodFacts } from "@/services/openfoodfacts";
import { createAdminClient } from "@/lib/supabase/admin";
import { recalculateDailyTotals } from "@/services/daily-totals";
import { todayDate } from "@/lib/utils";
import type { MealEstimation } from "@/validators/meal";

type SourceType = "text" | "voice" | "photo" | "multimodal";

interface LogFoodInput {
  userId: string;
  text?: string | null;
  audioBuffer?: ArrayBuffer | null;
  imageUrl?: string | null;
  date?: string; // YYYY-MM-DD, defaults to today
}

interface DailyTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface LogFoodResult {
  estimation: MealEstimation;
  mealLogId: string;
  source: "fatsecret" | "openfoodfacts" | "openai-web" | "openai";
  date: string;
  dailyTotals: DailyTotals | null;
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

// Try nutrition databases before falling back to OpenAI.
// Database lookups only work for text-based queries (not photos/voice-only).
async function estimateWithDatabases(
  query: string
): Promise<{ estimation: MealEstimation; source: "fatsecret" | "openfoodfacts" } | null> {
  // Try FatSecret first (better for restaurant + branded foods)
  const fsResult = await lookupFatSecret(query);
  if (fsResult && fsResult.calories > 0) {
    const brandNote = fsResult.brand_name
      ? ` (${fsResult.brand_name})`
      : "";
    return {
      source: "fatsecret",
      estimation: {
        parsed_meal_name: `${fsResult.food_name}${brandNote}`,
        estimated_calories: Math.round(fsResult.calories),
        estimated_protein_g: Math.round(fsResult.protein_g),
        estimated_carbs_g: Math.round(fsResult.carbs_g),
        estimated_fat_g: Math.round(fsResult.fat_g),
        estimated_fiber_g: Math.round(fsResult.fiber_g),
        confidence: "high",
        assumptions: [
          `Nutrition from FatSecret (${fsResult.food_type.toLowerCase()})`,
          `Serving: ${fsResult.serving_description}`,
        ],
      },
    };
  }

  // Try Open Food Facts (better for packaged products)
  const offResult = await searchOpenFoodFacts(query);
  if (offResult && offResult.calories > 0) {
    const brandNote = offResult.brand ? ` (${offResult.brand})` : "";
    return {
      source: "openfoodfacts",
      estimation: {
        parsed_meal_name: `${offResult.food_name}${brandNote}`,
        estimated_calories: offResult.calories,
        estimated_protein_g: offResult.protein_g,
        estimated_carbs_g: offResult.carbs_g,
        estimated_fat_g: offResult.fat_g,
        estimated_fiber_g: offResult.fiber_g,
        confidence: "high",
        assumptions: [
          "Nutrition from Open Food Facts (per 100g)",
          ...(offResult.serving_size
            ? [`Package serving: ${offResult.serving_size}`]
            : []),
          "Adjust if your portion differs from 100g",
        ],
      },
    };
  }

  return null;
}

export async function logFood(input: LogFoodInput): Promise<LogFoodResult> {
  let transcript: string | null = null;

  // Transcribe audio if present
  if (input.audioBuffer) {
    transcript = await transcribeAudio(input.audioBuffer);
  }

  const query = input.text || transcript;
  const hasImage = !!input.imageUrl;
  let estimation: MealEstimation;
  let source: "fatsecret" | "openfoodfacts" | "openai-web" | "openai" =
    "openai";

  // For text-only queries (no photo), try database lookups first
  if (query && !hasImage) {
    const dbResult = await estimateWithDatabases(query);
    if (dbResult) {
      estimation = dbResult.estimation;
      source = dbResult.source;
    } else {
      // Databases missed — try OpenAI with web search for real nutrition data
      try {
        estimation = await estimateMealWithWebSearch(query);
        source = "openai-web";
      } catch (e) {
        // Web search failed — fall back to plain OpenAI estimation
        console.error("Web search estimation failed, using plain OpenAI:", e);
        estimation = await estimateMeal({
          text: input.text,
          transcript,
          imageUrl: null,
        });
      }
    }
  } else {
    // Photos — go straight to OpenAI vision
    estimation = await estimateMeal({
      text: input.text,
      transcript,
      imageUrl: input.imageUrl,
    });
  }

  const sourceType = determineSourceType(input);
  const targetDate = input.date || todayDate();

  // Build logged_at: use target date with current time
  const now = new Date();
  const loggedAt = input.date
    ? `${input.date}T${now.toISOString().slice(11)}`
    : now.toISOString();

  // Save to database
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("meal_logs")
    .insert({
      user_id: input.userId,
      logged_at: loggedAt,
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

  // Recalculate daily totals for the target date
  await recalculateDailyTotals(input.userId, targetDate);

  // Fetch updated daily totals
  const { data: totals } = await supabase
    .from("daily_nutrition_totals")
    .select("calories, protein_g, carbs_g, fat_g")
    .eq("user_id", input.userId)
    .eq("date", targetDate)
    .single();

  return {
    estimation,
    mealLogId: data.id,
    source,
    date: targetDate,
    dailyTotals: totals,
  };
}

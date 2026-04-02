import { z } from "zod";

export const MealEstimationSchema = z.object({
  parsed_meal_name: z.string(),
  estimated_calories: z.number().int().nonnegative(),
  estimated_protein_g: z.number().nonnegative(),
  estimated_carbs_g: z.number().nonnegative(),
  estimated_fat_g: z.number().nonnegative(),
  estimated_fiber_g: z.number().nonnegative(),
  confidence: z.enum(["low", "medium", "high"]),
  assumptions: z.array(z.string()),
});

export type MealEstimation = z.infer<typeof MealEstimationSchema>;

export const MealLogInsertSchema = z.object({
  user_id: z.string().uuid(),
  logged_at: z.string(),
  source_type: z.enum(["text", "voice", "photo", "multimodal"]),
  raw_text: z.string().nullable(),
  transcript_text: z.string().nullable(),
  image_url: z.string().nullable(),
  parsed_meal_name: z.string(),
  estimated_calories: z.number().int().nonnegative(),
  estimated_protein_g: z.number().nonnegative(),
  estimated_carbs_g: z.number().nonnegative(),
  estimated_fat_g: z.number().nonnegative(),
  estimated_fiber_g: z.number().nonnegative(),
  confidence: z.string(),
  assumptions_json: z.any(),
});

export type MealLogInsert = z.infer<typeof MealLogInsertSchema>;

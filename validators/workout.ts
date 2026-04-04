import { z } from "zod";

export const ParsedSetSchema = z.object({
  reps: z.number().int().positive().nullable(),
  weight: z.number().nonnegative().nullable(),
  unit: z.enum(["lb", "kg"]).default("lb"),
  duration_seconds: z.number().positive().nullable().optional(),
  distance: z.string().nullable().optional(),
  rir: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export type ParsedSet = z.infer<typeof ParsedSetSchema>;

export const ParsedExerciseSchema = z.object({
  exercise_name: z.string(),
  normalized_exercise_name: z.string(),
  sets: z.array(ParsedSetSchema),
  is_cardio: z.boolean().default(false),
});

export type ParsedExercise = z.infer<typeof ParsedExerciseSchema>;

// LLM fallback response schema
export const LLMWorkoutResponseSchema = z.object({
  exercises: z.array(
    z.object({
      exercise_name: z.string(),
      sets: z.array(
        z.object({
          reps: z.number().nullable(),
          weight: z.number().nullable(),
          unit: z.string().default("lb"),
          duration_seconds: z.number().nullable().optional(),
          distance: z.string().nullable().optional(),
          notes: z.string().nullable().optional(),
        })
      ),
      is_cardio: z.boolean().default(false),
    })
  ),
});

export type LLMWorkoutResponse = z.infer<typeof LLMWorkoutResponseSchema>;

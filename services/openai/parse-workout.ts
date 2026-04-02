import { getOpenAI, models } from "@/lib/openai";
import {
  WORKOUT_PARSING_SYSTEM,
  buildWorkoutParsingPrompt,
} from "@/prompts/workout-parsing";
import {
  LLMWorkoutResponseSchema,
  type ParsedExercise,
} from "@/validators/workout";
import { normalizeExerciseName } from "@/services/workout-parser";

export async function parseWorkoutWithLLM(
  text: string,
  currentExercise?: string | null
): Promise<ParsedExercise[]> {
  const openai = getOpenAI();
  const userPrompt = buildWorkoutParsingPrompt(text, currentExercise);

  const response = await openai.chat.completions.create({
    model: models.text,
    messages: [
      { role: "system", content: WORKOUT_PARSING_SYSTEM },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
    max_tokens: 500,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty response from OpenAI workout parsing");

  const parsed = LLMWorkoutResponseSchema.parse(JSON.parse(raw));

  return parsed.exercises.map((ex) => ({
    exercise_name: ex.exercise_name,
    normalized_exercise_name: normalizeExerciseName(ex.exercise_name),
    sets: ex.sets.map((s) => ({
      reps: s.reps ?? null,
      weight: s.weight ?? null,
      unit: (s.unit as "lb" | "kg") || "lb",
      duration_seconds: s.duration_seconds ?? null,
      distance: s.distance ?? null,
      rir: null,
      notes: s.notes ?? null,
    })),
    is_cardio: ex.is_cardio,
  }));
}

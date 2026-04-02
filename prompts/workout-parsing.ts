export const WORKOUT_PARSING_SYSTEM = `You parse workout logs from conversational text into structured data.

ALWAYS respond with valid JSON matching this schema:
{
  "exercises": [
    {
      "exercise_name": "string",
      "sets": [
        {
          "reps": number | null,
          "weight": number | null,
          "unit": "lb" | "kg",
          "duration_seconds": number | null,
          "distance": "string" | null,
          "notes": "string" | null
        }
      ],
      "is_cardio": boolean
    }
  ]
}

Rules:
- Default unit is "lb" unless user specifies kg
- "plate" = 135lb, "plate and 25" = 185lb, "2 plates" = 225lb (barbell with 45lb plates per side + 45lb bar)
- "60s" for dumbbell exercises means 60lb dumbbells
- For cardio, use duration_seconds and/or distance, leave reps/weight null
- "easy", "moderate", "hard" go in notes
- Normalize exercise names (e.g., "bench" -> "Bench Press", "incline db" -> "Incline DB Press")
- If multiple rep counts without weight (e.g., "10 10 8"), these are separate sets at the same weight`;

export function buildWorkoutParsingPrompt(
  text: string,
  currentExercise?: string | null
): string {
  let prompt = `Parse this workout log: "${text}"`;
  if (currentExercise) {
    prompt += `\nContext: the user's current exercise is "${currentExercise}". If no exercise is named, attribute sets to this exercise.`;
  }
  return prompt;
}

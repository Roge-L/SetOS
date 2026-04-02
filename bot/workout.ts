import { sendMessage } from "@/bot/handler";
import {
  logWorkoutExercises,
  getLastExerciseName,
} from "@/services/workout-logger";
import type { ParsedExercise } from "@/validators/workout";

function formatExerciseLog(ex: ParsedExercise): string {
  if (ex.is_cardio) {
    const set = ex.sets[0];
    const mins = set?.duration_seconds
      ? Math.round(set.duration_seconds / 60)
      : "?";
    const notes = set?.notes ? ` ${set.notes}` : "";
    return `${ex.normalized_exercise_name} — ${mins} min${notes}`;
  }

  const setsStr = ex.sets
    .map((s) => {
      if (s.weight && s.reps) return `${s.weight} x ${s.reps}`;
      if (s.reps) return `${s.reps} reps`;
      return "?";
    })
    .join(", ");

  return `${ex.normalized_exercise_name} — ${setsStr}`;
}

export async function handleWorkoutMessage(
  chatId: number,
  userId: string,
  sessionId: string,
  text: string
) {
  try {
    // Get last exercise for context
    const currentExercise = await getLastExerciseName(sessionId);

    const result = await logWorkoutExercises({
      userId,
      sessionId,
      text,
      currentExercise,
    });

    if (result.exercises.length === 0) {
      await sendMessage(
        chatId,
        "Couldn't parse that. Try: \"bench 185x8\" or \"10 10 8\""
      );
      return;
    }

    const lines = result.exercises.map(
      (ex) => `Logged: ${formatExerciseLog(ex)}`
    );
    await sendMessage(chatId, lines.join("\n"));
  } catch (error) {
    console.error("Workout logging error:", error);
    await sendMessage(chatId, "Failed to log workout. Please try again.");
  }
}

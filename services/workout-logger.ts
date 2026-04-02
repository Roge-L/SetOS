import { createAdminClient } from "@/lib/supabase/admin";
import { parseWorkoutMessage } from "@/services/workout-parser";
import { parseWorkoutWithLLM } from "@/services/openai/parse-workout";
import type { ParsedExercise } from "@/validators/workout";

interface LogWorkoutInput {
  userId: string;
  sessionId: string;
  text: string;
  currentExercise?: string | null;
}

interface LogWorkoutResult {
  exercises: ParsedExercise[];
  usedLLM: boolean;
}

export async function getActiveSession(userId: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .is("ended_at", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .single();
  return data;
}

export async function startWorkoutSession(userId: string, title?: string) {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("workout_sessions")
    .insert({
      user_id: userId,
      title: title || null,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to start workout: ${error.message}`);
  return data;
}

export async function finishWorkoutSession(sessionId: string) {
  const supabase = createAdminClient();
  const { error } = await supabase
    .from("workout_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw new Error(`Failed to finish workout: ${error.message}`);
}

export async function getLastExerciseName(
  sessionId: string
): Promise<string | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("workout_exercises")
    .select("normalized_exercise_name")
    .eq("workout_session_id", sessionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  return data?.normalized_exercise_name || null;
}

export async function logWorkoutExercises(
  input: LogWorkoutInput
): Promise<LogWorkoutResult> {
  // Try deterministic parsing first
  let exercises = parseWorkoutMessage(input.text, input.currentExercise);
  let usedLLM = false;

  // Fall back to LLM if deterministic parsing fails
  if (!exercises || exercises.length === 0) {
    try {
      exercises = await parseWorkoutWithLLM(input.text, input.currentExercise);
      usedLLM = true;
    } catch (e) {
      console.error("LLM workout parsing failed:", e);
      return { exercises: [], usedLLM: true };
    }
  }

  if (!exercises || exercises.length === 0) {
    return { exercises: [], usedLLM };
  }

  const supabase = createAdminClient();

  // Get current max sort_order
  const { data: lastEx } = await supabase
    .from("workout_exercises")
    .select("sort_order")
    .eq("workout_session_id", input.sessionId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .single();
  let sortOrder = (lastEx?.sort_order ?? -1) + 1;

  for (const ex of exercises) {
    // Check if this exercise already exists in the session
    const { data: existingEx } = await supabase
      .from("workout_exercises")
      .select("id")
      .eq("workout_session_id", input.sessionId)
      .eq("normalized_exercise_name", ex.normalized_exercise_name)
      .limit(1)
      .single();

    let exerciseId: string;

    if (existingEx) {
      exerciseId = existingEx.id;
    } else {
      const { data: newEx, error } = await supabase
        .from("workout_exercises")
        .insert({
          workout_session_id: input.sessionId,
          exercise_name: ex.exercise_name,
          normalized_exercise_name: ex.normalized_exercise_name,
          sort_order: sortOrder++,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Failed to insert exercise: ${error.message}`);
      exerciseId = newEx.id;
    }

    // Get current max set_number for this exercise
    const { data: lastSet } = await supabase
      .from("workout_sets")
      .select("set_number")
      .eq("workout_exercise_id", exerciseId)
      .order("set_number", { ascending: false })
      .limit(1)
      .single();
    let setNumber = (lastSet?.set_number ?? 0) + 1;

    // Insert sets
    const setsToInsert = ex.sets.map((s) => ({
      workout_exercise_id: exerciseId,
      set_number: setNumber++,
      reps: s.reps,
      weight: s.weight,
      unit: s.unit || "lb",
      duration_seconds: s.duration_seconds || null,
      distance: s.distance || null,
      rir: s.rir || null,
      notes: s.notes || null,
    }));

    const { error: setsError } = await supabase
      .from("workout_sets")
      .insert(setsToInsert);
    if (setsError)
      throw new Error(`Failed to insert sets: ${setsError.message}`);
  }

  return { exercises, usedLLM };
}

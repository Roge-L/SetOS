import { createAdminClient } from "@/lib/supabase/admin";
import { todayDate } from "@/lib/utils";

interface StructuredSet {
  reps: number | null;
  weight: number | null;
}

interface LogStructuredInput {
  sessionId: string;
  exercise: string;
  sets: StructuredSet[];
  unit: "lb" | "kg";
  is_cardio: boolean;
  duration_minutes: number | null;
  notes: string | null;
}

// Get or create a workout session for a given date (defaults to today)
export async function getSessionForDate(userId: string, date?: string) {
  const supabase = createAdminClient();
  const targetDate = date || todayDate();

  const { data: existing } = await supabase
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("date", targetDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from("workout_sessions")
    .insert({ user_id: userId, date: targetDate })
    .select()
    .single();
  if (error) throw new Error(`Failed to create workout session: ${error.message}`);
  return data;
}

export async function logStructuredExercise(input: LogStructuredInput) {
  const supabase = createAdminClient();

  // Get or create the exercise entry for this session
  const { data: existingEx } = await supabase
    .from("workout_exercises")
    .select("id")
    .eq("workout_session_id", input.sessionId)
    .eq("normalized_exercise_name", input.exercise)
    .limit(1)
    .single();

  let exerciseId: string;

  if (existingEx) {
    exerciseId = existingEx.id;
  } else {
    // Get next sort_order
    const { data: lastEx } = await supabase
      .from("workout_exercises")
      .select("sort_order")
      .eq("workout_session_id", input.sessionId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .single();
    const sortOrder = (lastEx?.sort_order ?? -1) + 1;

    const { data: newEx, error } = await supabase
      .from("workout_exercises")
      .insert({
        workout_session_id: input.sessionId,
        exercise_name: input.exercise,
        normalized_exercise_name: input.exercise,
        sort_order: sortOrder,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Failed to insert exercise: ${error.message}`);
    exerciseId = newEx.id;
  }

  // Get next set_number
  const { data: lastSet } = await supabase
    .from("workout_sets")
    .select("set_number")
    .eq("workout_exercise_id", exerciseId)
    .order("set_number", { ascending: false })
    .limit(1)
    .single();
  let setNumber = (lastSet?.set_number ?? 0) + 1;

  if (input.is_cardio) {
    const { error } = await supabase
      .from("workout_sets")
      .insert({
        workout_exercise_id: exerciseId,
        set_number: setNumber,
        reps: null,
        weight: null,
        unit: input.unit,
        duration_seconds: input.duration_minutes ? input.duration_minutes * 60 : null,
        notes: input.notes,
      });
    if (error) throw new Error(`Failed to insert cardio set: ${error.message}`);
  } else {
    const setsToInsert = input.sets.map((s) => ({
      workout_exercise_id: exerciseId,
      set_number: setNumber++,
      reps: s.reps,
      weight: s.weight,
      unit: input.unit,
      duration_seconds: null,
      notes: input.notes,
    }));

    const { error } = await supabase
      .from("workout_sets")
      .insert(setsToInsert);
    if (error) throw new Error(`Failed to insert sets: ${error.message}`);
  }

  // Auto-title session from exercises
  const { data: allExercises } = await supabase
    .from("workout_exercises")
    .select("normalized_exercise_name")
    .eq("workout_session_id", input.sessionId)
    .order("sort_order");

  if (allExercises?.length) {
    const title = allExercises
      .map((e) => e.normalized_exercise_name)
      .slice(0, 3)
      .join(", ");
    await supabase
      .from("workout_sessions")
      .update({ title })
      .eq("id", input.sessionId);
  }
}

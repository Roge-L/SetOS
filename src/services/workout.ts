/**
 * Workout logging. A workout "session" is one local day (unique per user+date);
 * exercises and sets hang off it. Claude passes normalized exercise names and
 * structured sets; this layer stores them and can read them back with previous
 * performance for PR context.
 */

import type { Db } from "../db/client";
import type { WorkoutSessionRow } from "../db/types";
import { assertDate, todayDate } from "../lib/dates";
import { formatSets } from "../lib/format";

export interface WorkoutSet {
  reps: number | null;
  weight: number | null;
}

export interface LogWorkoutInput {
  exercise: string;
  sets: WorkoutSet[];
  unit?: "lb" | "kg";
  is_cardio?: boolean;
  duration_minutes?: number | null;
  notes?: string | null;
  date?: string;
}

/** Escape LIKE wildcards in a hint. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

/**
 * Get or create the session for a local day. Uses an upsert against the
 * unique (user_id, date) index so two near-simultaneous logs can't create
 * duplicate sessions.
 */
export async function getSessionForDate(db: Db, userId: string, date: string): Promise<WorkoutSessionRow> {
  const { data, error } = await db
    .from("workout_sessions")
    .upsert({ user_id: userId, date }, { onConflict: "user_id,date", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  if (data) return data;
  // ignoreDuplicates returns nothing when the row already exists — read it back.
  const { data: existing, error: readErr } = await db
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (existing) return existing;
  throw new Error(`Failed to get/create workout session: ${(error ?? readErr)?.message ?? "unknown"}`);
}

export async function logWorkout(db: Db, userId: string, tz: string, input: LogWorkoutInput) {
  if (!input.exercise?.trim()) throw new Error("`exercise` is required.");
  const date = input.date ? assertDate(input.date) : todayDate(tz);
  const unit = input.unit ?? "lb";
  const isCardio = input.is_cardio ?? false;
  const session = await getSessionForDate(db, userId, date);
  const exercise = input.exercise.trim();

  // Reuse the exercise row within the session if it already exists.
  const { data: existingEx } = await db
    .from("workout_exercises")
    .select("id")
    .eq("workout_session_id", session.id)
    .eq("normalized_exercise_name", exercise)
    .maybeSingle();

  let exerciseId: string;
  if (existingEx) {
    exerciseId = existingEx.id;
  } else {
    const { data: lastEx } = await db
      .from("workout_exercises")
      .select("sort_order")
      .eq("workout_session_id", session.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = (lastEx?.sort_order ?? -1) + 1;
    const { data: newEx, error } = await db
      .from("workout_exercises")
      .insert({
        workout_session_id: session.id,
        exercise_name: exercise,
        normalized_exercise_name: exercise,
        sort_order: sortOrder,
      })
      .select("id")
      .single();
    if (error || !newEx) throw new Error(`Failed to add exercise: ${error?.message ?? "no row"}`);
    exerciseId = newEx.id;
  }

  const { data: lastSet } = await db
    .from("workout_sets")
    .select("set_number")
    .eq("workout_exercise_id", exerciseId)
    .order("set_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  let setNumber = (lastSet?.set_number ?? 0) + 1;

  if (isCardio) {
    const { error } = await db.from("workout_sets").insert({
      workout_exercise_id: exerciseId,
      set_number: setNumber,
      reps: null,
      weight: null,
      unit,
      duration_seconds: input.duration_minutes ? Math.round(input.duration_minutes * 60) : null,
      notes: input.notes ?? null,
    });
    if (error) throw new Error(`Failed to log cardio: ${error.message}`);
  } else {
    if (input.sets.length === 0) throw new Error("Provide at least one set, or set is_cardio with duration_minutes.");
    const rows = input.sets.map((s) => ({
      workout_exercise_id: exerciseId,
      set_number: setNumber++,
      reps: s.reps,
      weight: s.weight,
      unit,
      duration_seconds: null,
      notes: input.notes ?? null,
    }));
    const { error } = await db.from("workout_sets").insert(rows);
    if (error) throw new Error(`Failed to log sets: ${error.message}`);
  }

  await autoTitle(db, session.id);

  return {
    logged: true,
    date,
    exercise,
    summary: isCardio
      ? `${exercise} — ${input.duration_minutes ?? "?"} min${input.notes ? ` (${input.notes})` : ""}`
      : `${exercise} — ${formatSets(input.sets, unit)}`,
  };
}

/** Name a session after its first few exercises. */
async function autoTitle(db: Db, sessionId: string): Promise<void> {
  const { data } = await db
    .from("workout_exercises")
    .select("normalized_exercise_name")
    .eq("workout_session_id", sessionId)
    .order("sort_order", { ascending: true });
  if (!data?.length) return;
  const title = data.map((e) => e.normalized_exercise_name).slice(0, 3).join(", ");
  await db.from("workout_sessions").update({ title }).eq("id", sessionId);
}

type SessionWithExercises = WorkoutSessionRow & {
  workout_exercises: Array<{
    normalized_exercise_name: string;
    sort_order: number;
    workout_sets: Array<{ reps: number | null; weight: number | null; unit: string | null; duration_seconds: number | null }>;
  }>;
};

function shapeSession(s: SessionWithExercises) {
  const exercises = [...(s.workout_exercises ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((ex) => ({
      name: ex.normalized_exercise_name,
      sets: (ex.workout_sets ?? []).map((set) => {
        if (set.duration_seconds) return { minutes: Math.round(set.duration_seconds / 60) };
        return { reps: set.reps, weight: set.weight, unit: set.unit };
      }),
    }));
  return { id: s.id, date: s.date, title: s.title, notes: s.notes, exercises };
}

/**
 * Workouts for one local day (when `date` is given) or the most recent
 * `limit` sessions otherwise.
 */
export async function listWorkouts(
  db: Db,
  userId: string,
  tz: string,
  input: { date?: string; limit?: number }
) {
  const select = `id, user_id, date, title, notes, created_at,
    workout_exercises ( normalized_exercise_name, sort_order,
      workout_sets ( reps, weight, unit, duration_seconds ) )`;

  if (input.date) {
    const date = assertDate(input.date);
    const { data, error } = await db
      .from("workout_sessions")
      .select(select)
      .eq("user_id", userId)
      .eq("date", date)
      .maybeSingle();
    if (error) throw new Error(`Failed to read workout: ${error.message}`);
    return { date, workout: data ? shapeSession(data as unknown as SessionWithExercises) : null };
  }

  const limit = Math.min(Math.max(input.limit ?? 7, 1), 30);
  const { data, error } = await db
    .from("workout_sessions")
    .select(select)
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list workouts: ${error.message}`);
  return { workouts: (data ?? []).map((s) => shapeSession(s as unknown as SessionWithExercises)) };
}

/** Find a session by id (exact) or by title/date hint among recent sessions. */
async function findSession(
  db: Db,
  userId: string,
  opts: { session_id?: string; hint?: string }
): Promise<WorkoutSessionRow | { ambiguous: WorkoutSessionRow[] } | null> {
  if (opts.session_id) {
    const { data } = await db
      .from("workout_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("id", opts.session_id)
      .maybeSingle();
    return data ?? null;
  }
  if (!opts.hint) return null;
  const hint = opts.hint.trim();
  // A YYYY-MM-DD hint matches a date exactly.
  if (/^\d{4}-\d{2}-\d{2}$/.test(hint)) {
    const { data } = await db
      .from("workout_sessions")
      .select("*")
      .eq("user_id", userId)
      .eq("date", hint)
      .maybeSingle();
    return data ?? null;
  }
  const { data } = await db
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .ilike("title", `%${escapeLike(hint)}%`)
    .order("date", { ascending: false })
    .limit(10);
  if (!data || data.length === 0) return null;
  if (data.length === 1) return data[0]!;
  return { ambiguous: data };
}

export async function moveWorkout(
  db: Db,
  userId: string,
  input: { session_id?: string; hint?: string; target_date: string }
) {
  const target = assertDate(input.target_date, "target_date");
  const found = await findSession(db, userId, input);
  if (!found) throw new Error(`No workout found matching ${input.session_id ?? `"${input.hint}"`}.`);
  if ("ambiguous" in found) {
    return {
      moved: false,
      ambiguous: true,
      matches: found.ambiguous.map((s) => ({ id: s.id, date: s.date, title: s.title })),
      _note: "Multiple workouts matched. Call again with the exact session_id.",
    };
  }
  if (found.date === target) return { moved: false, _note: `Workout is already on ${target}.` };
  // (user_id, date) is unique — a session already on the target day would collide.
  const { data: clash } = await db
    .from("workout_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("date", target)
    .maybeSingle();
  if (clash) {
    throw new Error(`A workout already exists on ${target}. Move it elsewhere or merge manually.`);
  }
  const { error } = await db
    .from("workout_sessions")
    .update({ date: target })
    .eq("id", found.id)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to move workout: ${error.message}`);
  return { moved: true, title: found.title ?? "Untitled", from: found.date, to: target };
}

export async function deleteWorkout(
  db: Db,
  userId: string,
  input: { session_id?: string; hint?: string }
) {
  const found = await findSession(db, userId, input);
  if (!found) throw new Error(`No workout found matching ${input.session_id ?? `"${input.hint}"`}.`);
  if ("ambiguous" in found) {
    return {
      deleted: false,
      ambiguous: true,
      matches: found.ambiguous.map((s) => ({ id: s.id, date: s.date, title: s.title })),
      _note: "Multiple workouts matched. Call again with the exact session_id.",
    };
  }
  const { error } = await db.from("workout_sessions").delete().eq("id", found.id).eq("user_id", userId);
  if (error) throw new Error(`Failed to delete workout: ${error.message}`);
  return { deleted: true, title: found.title ?? "Untitled", date: found.date };
}

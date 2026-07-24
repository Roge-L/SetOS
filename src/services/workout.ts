/**
 * Workout logging + retrieval, with CRUD at every level of the hierarchy:
 * session → exercise → set.
 *
 * A session is one local day (unique per user+date). `logWorkout` accepts the
 * WHOLE workout in one call (several exercises, each with its sets) because
 * "here's my session" is one user intent — per MCP guidance, operations that
 * commonly chain should be bundled rather than forcing N round-trips.
 *
 * Reads return ids at every level so the model can then edit a single set.
 */

import type { Db } from "../db/client";
import type { WorkoutSessionRow } from "../db/types";
import { assertDate, todayDate } from "../lib/dates";
import { escapeLike } from "../lib/format";

export interface SetInput {
  reps?: number | null;
  weight?: number | null;
  rir?: number | null;
  notes?: string | null;
  /** Cardio only. */
  duration_minutes?: number | null;
  distance?: string | null;
}

export interface ExerciseInput {
  exercise: string;
  sets: SetInput[];
  unit?: "lb" | "kg";
}

const SELECT_TREE = `id, user_id, date, title, notes, created_at,
  workout_exercises ( id, normalized_exercise_name, sort_order,
    workout_sets ( id, set_number, reps, weight, unit, rir, notes, duration_seconds, distance ) )`;

type SessionTree = WorkoutSessionRow & {
  workout_exercises: Array<{
    id: string;
    normalized_exercise_name: string;
    sort_order: number;
    workout_sets: Array<{
      id: string;
      set_number: number;
      reps: number | null;
      weight: number | null;
      unit: string | null;
      rir: number | null;
      notes: string | null;
      duration_seconds: number | null;
      distance: string | null;
    }>;
  }>;
};

function shapeSession(s: SessionTree) {
  const exercises = [...(s.workout_exercises ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((ex) => ({
      exercise_id: ex.id,
      name: ex.normalized_exercise_name,
      position: ex.sort_order,
      sets: [...(ex.workout_sets ?? [])]
        .sort((a, b) => a.set_number - b.set_number)
        .map((st) => ({
          set_id: st.id,
          n: st.set_number,
          ...(st.duration_seconds != null
            ? { minutes: Math.round(st.duration_seconds / 60) }
            : { reps: st.reps, weight: st.weight, unit: st.unit }),
          ...(st.rir != null ? { rir: st.rir } : {}),
          ...(st.distance ? { distance: st.distance } : {}),
          ...(st.notes ? { notes: st.notes } : {}),
        })),
    }));
  return { session_id: s.id, date: s.date, title: s.title, notes: s.notes, exercises };
}

/**
 * Get or create the session for a local day. Upsert against the unique
 * (user_id, date) index so concurrent logs can't duplicate a session.
 */
export async function getSessionForDate(db: Db, userId: string, date: string): Promise<WorkoutSessionRow> {
  const { data, error } = await db
    .from("workout_sessions")
    .upsert({ user_id: userId, date }, { onConflict: "user_id,date", ignoreDuplicates: true })
    .select("*")
    .maybeSingle();
  if (data) return data;
  const { data: existing, error: readErr } = await db
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();
  if (existing) return existing;
  throw new Error(`Failed to get/create workout session: ${(error ?? readErr)?.message ?? "unknown"}`);
}

/** Name a session after its first few exercises (only if not manually titled). */
async function autoTitle(db: Db, sessionId: string, force = false): Promise<void> {
  const { data: session } = await db
    .from("workout_sessions")
    .select("title")
    .eq("id", sessionId)
    .maybeSingle();
  if (!force && session?.title) return;
  const { data } = await db
    .from("workout_exercises")
    .select("normalized_exercise_name")
    .eq("workout_session_id", sessionId)
    .order("sort_order", { ascending: true });
  if (!data?.length) return;
  const title = data.map((e: { normalized_exercise_name: string }) => e.normalized_exercise_name)
    .slice(0, 3)
    .join(", ");
  await db.from("workout_sessions").update({ title }).eq("id", sessionId);
}

/**
 * Log a whole workout: one or more exercises, each with its sets, onto a day's
 * session (created if absent). Re-logging an exercise on the same day appends
 * sets to the existing exercise rather than duplicating it.
 */
export async function logWorkout(
  db: Db,
  userId: string,
  tz: string,
  input: { exercises: ExerciseInput[]; date?: string; notes?: string | null }
) {
  if (!input.exercises?.length) throw new Error("Provide at least one exercise.");
  if (input.exercises.length > 20) throw new Error("Too many exercises in one call. Max 20.");

  const date = input.date ? assertDate(input.date) : todayDate(tz);
  const session = await getSessionForDate(db, userId, date);
  if (input.notes) await db.from("workout_sessions").update({ notes: input.notes }).eq("id", session.id);

  const logged: Array<{ exercise: string; sets: number }> = [];

  for (const ex of input.exercises) {
    const name = ex.exercise?.trim();
    if (!name) throw new Error("Every exercise needs a name.");
    if (!ex.sets?.length) throw new Error(`Exercise "${name}" has no sets.`);
    const unit = ex.unit ?? "lb";

    const { data: existingEx } = await db
      .from("workout_exercises")
      .select("id")
      .eq("workout_session_id", session.id)
      .eq("normalized_exercise_name", name)
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
      const { data: newEx, error } = await db
        .from("workout_exercises")
        .insert({
          workout_session_id: session.id,
          exercise_name: name,
          normalized_exercise_name: name,
          sort_order: (lastEx?.sort_order ?? -1) + 1,
        })
        .select("id")
        .single();
      if (error || !newEx) throw new Error(`Failed to add exercise "${name}": ${error?.message}`);
      exerciseId = newEx.id;
    }

    const { data: lastSet } = await db
      .from("workout_sets")
      .select("set_number")
      .eq("workout_exercise_id", exerciseId)
      .order("set_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    let n = (lastSet?.set_number ?? 0) + 1;

    const rows = ex.sets.map((s) => ({
      workout_exercise_id: exerciseId,
      set_number: n++,
      reps: s.reps ?? null,
      weight: s.weight ?? null,
      unit,
      rir: s.rir ?? null,
      notes: s.notes ?? null,
      duration_seconds: s.duration_minutes != null ? Math.round(s.duration_minutes * 60) : null,
      distance: s.distance ?? null,
    }));
    const { error: setErr } = await db.from("workout_sets").insert(rows);
    if (setErr) throw new Error(`Failed to log sets for "${name}": ${setErr.message}`);
    logged.push({ exercise: name, sets: rows.length });
  }

  await autoTitle(db, session.id);
  return { logged: true, date, session_id: session.id, exercises: logged };
}

/**
 * Read workouts: one day (`date`), a range (`start`/`end`), or the most recent
 * `limit` sessions. Always returns exercise_id / set_id so edits are possible.
 */
export async function getWorkouts(
  db: Db,
  userId: string,
  tz: string,
  q: { date?: string; start?: string; end?: string; limit?: number }
) {
  let query = db.from("workout_sessions").select(SELECT_TREE).eq("user_id", userId);

  if (q.date) {
    const d = assertDate(q.date);
    query = query.eq("date", d);
  } else if (q.start || q.end) {
    const start = assertDate(q.start ?? q.end!, "start");
    const end = assertDate(q.end ?? q.start!, "end");
    if (end < start) throw new Error(`end (${end}) is before start (${start}).`);
    query = query.gte("date", start).lte("date", end);
  }

  const limit = Math.min(Math.max(q.limit ?? (q.date ? 1 : 7), 1), 60);
  const { data, error } = await query.order("date", { ascending: false }).limit(limit);
  if (error) throw new Error(`Failed to read workouts: ${error.message}`);

  const workouts = (data ?? []).map((s) => shapeSession(s as unknown as SessionTree));
  return { workouts, count: workouts.length };
}

/** Patch a session: its date, title, or notes. */
export async function updateWorkout(
  db: Db,
  userId: string,
  input: { session_id: string; date?: string; title?: string; notes?: string | null }
) {
  const { data: existing } = await db
    .from("workout_sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("id", input.session_id)
    .maybeSingle();
  if (!existing) throw new Error(`No workout session with id ${input.session_id}.`);

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.date !== undefined) {
    const target = assertDate(input.date);
    if (target !== existing.date) {
      const { data: clash } = await db
        .from("workout_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("date", target)
        .maybeSingle();
      if (clash) {
        throw new Error(
          `A workout already exists on ${target}. Move or delete that one first, or log these exercises onto it instead.`
        );
      }
      patch.date = target;
    }
  }
  if (Object.keys(patch).length === 0) return { updated: false, _note: "Nothing to change." };

  const { error } = await db
    .from("workout_sessions")
    .update(patch)
    .eq("id", input.session_id)
    .eq("user_id", userId);
  if (error) throw new Error(`Failed to update workout: ${error.message}`);
  return { updated: true, session_id: input.session_id, changed: Object.keys(patch) };
}

/**
 * Read a nested embedded relation regardless of whether supabase-js hands it
 * back as an object (one-to-one) or a single-element array. Ownership checks
 * traverse these joins, so being shape-tolerant here avoids brittle casts.
 */
function embedded(node: unknown, key: string): unknown {
  const value = (node as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(value) ? value[0] : value;
}

/** user_id at the end of exercise -> session, or set -> exercise -> session. */
function ownerOfExerciseNode(node: unknown): string | undefined {
  return (embedded(node, "workout_sessions") as { user_id?: string } | undefined)?.user_id;
}

function ownerOfSetNode(node: unknown): string | undefined {
  return ownerOfExerciseNode(embedded(node, "workout_exercises"));
}

/** Confirm an exercise belongs to this user (service-role bypasses RLS). */
async function assertExerciseOwned(db: Db, userId: string, exerciseId: string) {
  const { data } = await db
    .from("workout_exercises")
    .select("id, workout_session_id, workout_sessions!inner ( user_id )")
    .eq("id", exerciseId)
    .maybeSingle();
  if (!data || ownerOfExerciseNode(data) !== userId) {
    throw new Error(`No exercise with id ${exerciseId}. Use setos_get_workouts to get current ids.`);
  }
  return data as unknown as { id: string; workout_session_id: string };
}

/** Rename an exercise and/or change its position in the session. */
export async function updateExercise(
  db: Db,
  userId: string,
  input: { exercise_id: string; name?: string; position?: number }
) {
  const ex = await assertExerciseOwned(db, userId, input.exercise_id);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    patch.exercise_name = input.name.trim();
    patch.normalized_exercise_name = input.name.trim();
  }
  if (input.position !== undefined) patch.sort_order = input.position;
  if (Object.keys(patch).length === 0) return { updated: false, _note: "Nothing to change." };

  const { error } = await db.from("workout_exercises").update(patch).eq("id", input.exercise_id);
  if (error) throw new Error(`Failed to update exercise: ${error.message}`);
  if (patch.normalized_exercise_name) await autoTitle(db, ex.workout_session_id, true);
  return { updated: true, exercise_id: input.exercise_id, changed: Object.keys(patch) };
}

/** Patch a single set — the finest-grained edit (fix a typo'd weight or rep). */
export async function updateSet(
  db: Db,
  userId: string,
  input: {
    set_id: string;
    reps?: number | null;
    weight?: number | null;
    unit?: "lb" | "kg";
    rir?: number | null;
    notes?: string | null;
    duration_minutes?: number | null;
  }
) {
  const { data: existing } = await db
    .from("workout_sets")
    .select("id, workout_exercise_id, workout_exercises!inner ( workout_sessions!inner ( user_id ) )")
    .eq("id", input.set_id)
    .maybeSingle();
  if (!existing || ownerOfSetNode(existing) !== userId) {
    throw new Error(`No set with id ${input.set_id}. Use setos_get_workouts to get current set ids.`);
  }

  const patch: Record<string, unknown> = {};
  if (input.reps !== undefined) patch.reps = input.reps;
  if (input.weight !== undefined) patch.weight = input.weight;
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.rir !== undefined) patch.rir = input.rir;
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.duration_minutes !== undefined) {
    patch.duration_seconds = input.duration_minutes == null ? null : Math.round(input.duration_minutes * 60);
  }
  if (Object.keys(patch).length === 0) return { updated: false, _note: "Nothing to change." };

  const { error } = await db.from("workout_sets").update(patch).eq("id", input.set_id);
  if (error) throw new Error(`Failed to update set: ${error.message}`);
  return { updated: true, set_id: input.set_id, changed: Object.keys(patch) };
}

/**
 * Delete workout data at any level. `target` makes the blast radius explicit:
 * a session deletes its exercises+sets, an exercise deletes its sets.
 */
export async function deleteWorkoutItems(
  db: Db,
  userId: string,
  input: { target: "session" | "exercise" | "sets"; ids: string[] }
) {
  if (!input.ids?.length) throw new Error("Provide at least one id.");

  if (input.target === "session") {
    const { data: found } = await db
      .from("workout_sessions")
      .select("id, date, title")
      .eq("user_id", userId)
      .in("id", input.ids);
    if (!found?.length) throw new Error("No matching workout sessions for those ids.");
    const { error } = await db
      .from("workout_sessions")
      .delete()
      .eq("user_id", userId)
      .in(
        "id",
        found.map((s) => s.id)
      );
    if (error) throw new Error(`Failed to delete session(s): ${error.message}`);
    return { deleted: found.length, target: "session", items: found };
  }

  if (input.target === "exercise") {
    const sessions = new Set<string>();
    for (const id of input.ids) sessions.add((await assertExerciseOwned(db, userId, id)).workout_session_id);
    const { error } = await db.from("workout_exercises").delete().in("id", input.ids);
    if (error) throw new Error(`Failed to delete exercise(s): ${error.message}`);
    for (const s of sessions) await autoTitle(db, s, true);
    return { deleted: input.ids.length, target: "exercise" };
  }

  // sets — verify ownership through the exercise → session chain
  const { data: owned } = await db
    .from("workout_sets")
    .select("id, workout_exercises!inner ( workout_sessions!inner ( user_id ) )")
    .in("id", input.ids);
  const mine = (owned ?? []).filter((s) => ownerOfSetNode(s) === userId);
  if (mine.length === 0) {
    throw new Error("No matching sets for those ids. Use setos_get_workouts to get current set ids.");
  }
  const { error } = await db
    .from("workout_sets")
    .delete()
    .in(
      "id",
      mine.map((s) => s.id)
    );
  if (error) throw new Error(`Failed to delete set(s): ${error.message}`);
  return { deleted: mine.length, target: "sets" };
}

/**
 * Progression + personal records for one exercise over time. This is the
 * action-shaped read — "how is my bench going?" — that would otherwise cost
 * the model several list calls plus its own aggregation.
 */
export async function exerciseHistory(
  db: Db,
  userId: string,
  input: { exercise: string; limit?: number }
) {
  const name = input.exercise?.trim();
  if (!name) throw new Error("`exercise` is required.");
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 60);

  const { data, error } = await db
    .from("workout_sessions")
    .select(
      `date, workout_exercises!inner ( normalized_exercise_name,
         workout_sets ( reps, weight, unit, rir ) )`
    )
    .eq("user_id", userId)
    .ilike("workout_exercises.normalized_exercise_name", `%${escapeLike(name)}%`)
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to read exercise history: ${error.message}`);

  type Row = {
    date: string;
    workout_exercises: Array<{
      normalized_exercise_name: string;
      workout_sets: Array<{ reps: number | null; weight: number | null; unit: string | null; rir: number | null }>;
    }>;
  };

  const sessions = ((data ?? []) as unknown as Row[])
    .map((s) => {
      const sets = s.workout_exercises.flatMap((e) => e.workout_sets ?? []);
      if (!sets.length) return null;
      const weights = sets.map((x) => x.weight ?? 0);
      const topWeight = Math.max(...weights);
      const topSet = sets.find((x) => (x.weight ?? 0) === topWeight);
      // Epley 1RM estimate — a standard, transparent formula.
      const e1rm =
        topWeight > 0 && topSet?.reps ? Math.round(topWeight * (1 + topSet.reps / 30)) : null;
      return {
        date: s.date,
        matched_as: s.workout_exercises[0]?.normalized_exercise_name ?? name,
        sets: sets.length,
        total_reps: sets.reduce((t, x) => t + (x.reps ?? 0), 0),
        volume: Math.round(sets.reduce((t, x) => t + (x.weight ?? 0) * (x.reps ?? 0), 0)),
        top_set: topWeight > 0 ? { weight: topWeight, reps: topSet?.reps ?? null, unit: topSet?.unit ?? "lb" } : null,
        estimated_1rm: e1rm,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (sessions.length === 0) {
    return {
      exercise: name,
      sessions: [],
      _note: `No logged sessions matching "${name}". Try a different spelling, or setos_get_workouts to see what names exist.`,
    };
  }

  const best = sessions.reduce((a, b) => ((b.top_set?.weight ?? 0) > (a.top_set?.weight ?? 0) ? b : a));
  const bestVolume = sessions.reduce((a, b) => (b.volume > a.volume ? b : a));

  return {
    exercise: name,
    sessions, // newest first
    personal_records: {
      heaviest_set: best.top_set ? { ...best.top_set, date: best.date } : null,
      best_estimated_1rm: sessions.reduce<{ value: number; date: string } | null>(
        (acc, s) => (s.estimated_1rm && (!acc || s.estimated_1rm > acc.value) ? { value: s.estimated_1rm, date: s.date } : acc),
        null
      ),
      highest_volume: { volume: bestVolume.volume, date: bestVolume.date },
    },
    _note:
      "Sessions are newest-first. volume = sum(weight x reps). estimated_1rm uses the Epley formula (w x (1 + reps/30)) — an estimate, not a tested max.",
  };
}

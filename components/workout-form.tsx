"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface WorkoutSet {
  id: string;
  set_number: number;
  reps: number | null;
  weight: number | null;
  unit: string;
  duration_seconds: number | null;
  notes: string | null;
}

interface WorkoutExercise {
  id: string;
  exercise_name: string;
  normalized_exercise_name: string;
  sort_order: number;
  workout_sets: WorkoutSet[];
}

interface Workout {
  id: string;
  title: string | null;
  date: string;
  notes: string | null;
  workout_exercises: WorkoutExercise[];
}

export function WorkoutForm({ workout }: { workout: Workout }) {
  const router = useRouter();
  const [title, setTitle] = useState(workout.title || "");
  const [workoutDate, setWorkoutDate] = useState(workout.date);
  const [exercises, setExercises] = useState(workout.workout_exercises);
  const [saving, setSaving] = useState(false);

  function updateSet(exIdx: number, setIdx: number, field: string, value: string) {
    setExercises((prev) => {
      const next = [...prev];
      const ex = { ...next[exIdx] };
      const sets = [...ex.workout_sets];
      sets[setIdx] = {
        ...sets[setIdx],
        [field]:
          field === "notes" || field === "unit"
            ? value
            : value === ""
              ? null
              : parseFloat(value),
      };
      ex.workout_sets = sets;
      next[exIdx] = ex;
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();

    await supabase
      .from("workout_sessions")
      .update({ title: title || null, date: workoutDate })
      .eq("id", workout.id);

    for (const ex of exercises) {
      for (const set of ex.workout_sets) {
        await supabase
          .from("workout_sets")
          .update({
            reps: set.reps,
            weight: set.weight,
            unit: set.unit,
            duration_seconds: set.duration_seconds,
            notes: set.notes,
          })
          .eq("id", set.id);
      }
    }

    setSaving(false);
    router.push("/dashboard");
    router.refresh();
  }

  async function handleDeleteSet(setId: string, exIdx: number) {
    const supabase = createClient();
    await supabase.from("workout_sets").delete().eq("id", setId);

    setExercises((prev) => {
      const next = [...prev];
      const ex = { ...next[exIdx] };
      ex.workout_sets = ex.workout_sets.filter((s) => s.id !== setId);

      // Clean up orphaned exercise if no sets remain
      if (ex.workout_sets.length === 0) {
        supabase.from("workout_exercises").delete().eq("id", ex.id);
        return next.filter((_, i) => i !== exIdx);
      }

      next[exIdx] = ex;
      return next;
    });
  }

  async function handleDeleteWorkout() {
    if (!confirm("Delete this entire workout?")) return;
    const supabase = createClient();
    await supabase.from("workout_sessions").delete().eq("id", workout.id);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="text-xs text-muted block mb-1">Date</label>
        <input
          type="date"
          value={workoutDate}
          onChange={(e) => setWorkoutDate(e.target.value)}
          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label className="text-xs text-muted block mb-1">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Workout title"
          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
        />
      </div>

      {exercises.map((ex, exIdx) => (
        <div key={ex.id} className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">
            {ex.normalized_exercise_name}
          </h3>
          <div className="space-y-2">
            {ex.workout_sets.map((set, setIdx) => (
              <div key={set.id} className="flex items-center gap-2 text-xs">
                <span className="text-muted w-6">#{set.set_number}</span>
                {set.duration_seconds !== null ? (
                  <input
                    type="number"
                    value={set.duration_seconds ? Math.round(set.duration_seconds / 60) : ""}
                    onChange={(e) =>
                      updateSet(
                        exIdx,
                        setIdx,
                        "duration_seconds",
                        String((parseFloat(e.target.value) || 0) * 60)
                      )
                    }
                    placeholder="min"
                    className="w-16 bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-accent"
                  />
                ) : (
                  <>
                    <input
                      type="number"
                      value={set.weight ?? ""}
                      onChange={(e) =>
                        updateSet(exIdx, setIdx, "weight", e.target.value)
                      }
                      placeholder="wt"
                      className="w-16 bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-accent"
                    />
                    <span className="text-muted">x</span>
                    <input
                      type="number"
                      value={set.reps ?? ""}
                      onChange={(e) =>
                        updateSet(exIdx, setIdx, "reps", e.target.value)
                      }
                      placeholder="reps"
                      className="w-16 bg-background border border-border rounded px-2 py-1 focus:outline-none focus:border-accent"
                    />
                  </>
                )}
                <button
                  onClick={() => handleDeleteSet(set.id, exIdx)}
                  className="text-danger hover:underline ml-auto"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleDeleteWorkout}
          className="px-4 py-2 text-sm text-danger hover:underline"
        >
          Delete
        </button>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

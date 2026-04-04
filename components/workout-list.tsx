import Link from "next/link";

interface WorkoutSet {
  reps: number | null;
  weight: number | null;
  unit: string;
  duration_seconds: number | null;
}

interface WorkoutSession {
  id: string;
  title: string | null;
  workout_exercises: {
    exercise_name: string;
    normalized_exercise_name: string;
    workout_sets: WorkoutSet[];
  }[];
}

// Format sets in standard gym notation:
// - All same weight & reps: "4x10 @ 35 lbs"
// - Same weight, diff reps: "35 lbs x 10, 10, 8, 6"
// - No weight: "4x10" or "10, 10, 8"
// - Mixed weights: "135x5, 185x5, 225x3"
function formatSets(sets: WorkoutSet[]): string {
  if (sets.length === 0) return "—";

  const weights = sets.map((s) => s.weight);
  const reps = sets.map((s) => s.reps);
  const unit = sets[0]?.unit || "lb";
  const allSameWeight = weights.every((w) => w === weights[0]);
  const allSameReps = reps.every((r) => r === reps[0]);

  if (allSameWeight && allSameReps && reps[0]) {
    const base = `${sets.length}x${reps[0]}`;
    return weights[0] ? `${base} @ ${weights[0]} ${unit}` : base;
  }

  if (allSameWeight && weights[0]) {
    return `${weights[0]} ${unit} x ${reps.map((r) => r ?? "—").join(", ")}`;
  }

  return sets
    .map((s) =>
      s.weight && s.reps
        ? `${s.weight}x${s.reps}`
        : s.reps
          ? `${s.reps} reps`
          : "—"
    )
    .join(", ");
}

export function WorkoutList({ workouts }: { workouts: WorkoutSession[] }) {
  if (workouts.length === 0) {
    return (
      <p className="text-sm text-muted py-4">No workouts today.</p>
    );
  }

  return (
    <div className="space-y-3">
      {workouts.map((w) => (
        <div
          key={w.id}
          className="bg-card border border-border rounded-lg p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">
              {w.title || "Workout"}
            </div>
            <Link
              href={`/workouts/${w.id}/edit`}
              className="text-xs text-accent hover:underline"
            >
              Edit
            </Link>
          </div>
          {w.workout_exercises.map((ex, i) => (
            <div key={i} className="text-xs text-muted">
              {ex.normalized_exercise_name}:{" "}
              {ex.workout_sets[0]?.duration_seconds
                ? `${Math.round(ex.workout_sets[0].duration_seconds / 60)} min`
                : formatSets(ex.workout_sets)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

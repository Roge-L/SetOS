import Link from "next/link";

interface WorkoutSession {
  id: string;
  title: string | null;
  active: boolean;
  workout_exercises: {
    exercise_name: string;
    normalized_exercise_name: string;
    workout_sets: {
      reps: number | null;
      weight: number | null;
      unit: string;
      duration_seconds: number | null;
    }[];
  }[];
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
              {w.title || "Workout"}{" "}
              {w.active && (
                <span className="text-xs text-warning">(active)</span>
              )}
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
              {ex.workout_sets
                .map((s) => {
                  if (s.duration_seconds) {
                    return `${Math.round(s.duration_seconds / 60)} min`;
                  }
                  if (s.weight && s.reps) return `${s.weight}x${s.reps}`;
                  if (s.reps) return `${s.reps} reps`;
                  return "—";
                })
                .join(", ")}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

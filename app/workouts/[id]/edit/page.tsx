import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WorkoutForm } from "@/components/workout-form";

export default async function EditWorkoutPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workout } = await supabase
    .from("workout_sessions")
    .select(`
      *,
      workout_exercises (
        id, exercise_name, normalized_exercise_name, sort_order,
        workout_sets ( id, set_number, reps, weight, unit, duration_seconds, notes )
      )
    `)
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!workout) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-lg font-semibold mb-6">Edit Workout</h1>
        <WorkoutForm workout={workout} />
      </div>
    </div>
  );
}

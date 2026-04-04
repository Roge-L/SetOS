import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DailySummary } from "@/components/daily-summary";
import { MealList } from "@/components/meal-list";
import { WorkoutList } from "@/components/workout-list";
import { getUTCRangeForLocalDate, formatDateLong } from "@/lib/utils";
import Link from "next/link";

export default async function DayDetailPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { start, end } = getUTCRangeForLocalDate(date);

  const [totalsRes, mealsRes, workoutsRes] = await Promise.all([
    supabase
      .from("daily_nutrition_totals")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", date)
      .single(),
    supabase
      .from("meal_logs")
      .select("id, parsed_meal_name, estimated_calories, estimated_protein_g, logged_at, confidence")
      .eq("user_id", user.id)
      .gte("logged_at", start)
      .lte("logged_at", end)
      .order("logged_at", { ascending: true }),
    supabase
      .from("workout_sessions")
      .select(`
        id, title, active,
        workout_exercises (
          exercise_name, normalized_exercise_name,
          workout_sets ( reps, weight, unit, duration_seconds )
        )
      `)
      .eq("user_id", user.id)
      .eq("date", date)
      .order("created_at", { ascending: true }),
  ]);

  const totals = totalsRes.data;
  const meals = mealsRes.data || [];
  const workouts = workoutsRes.data || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard" className="text-muted hover:text-foreground text-sm">
          &larr; Today
        </Link>
        <h1 className="text-lg font-semibold">{formatDateLong(date)}</h1>
      </div>

      <DailySummary
        calories={totals?.calories || 0}
        protein={totals?.protein_g || 0}
        carbs={totals?.carbs_g || 0}
        fat={totals?.fat_g || 0}
        fiber={totals?.fiber_g || 0}
      />

      <section>
        <h2 className="text-sm font-medium mb-2">Meals</h2>
        <MealList meals={meals} />
      </section>

      <section>
        <h2 className="text-sm font-medium mb-2">Workouts</h2>
        <WorkoutList workouts={workouts as any} />
      </section>
    </div>
  );
}

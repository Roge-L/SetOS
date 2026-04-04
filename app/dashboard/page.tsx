import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { DailySummary } from "@/components/daily-summary";
import { MealList } from "@/components/meal-list";
import { WorkoutList } from "@/components/workout-list";
import { BodyWeightEntry } from "@/components/body-weight-entry";
import { todayDate, getUTCRangeForLocalDate, formatDateLong, formatDate, TIMEZONE } from "@/lib/utils";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const today = todayDate();
  const { start, end } = getUTCRangeForLocalDate(today);

  // Fetch all data in parallel
  const [totalsRes, mealsRes, workoutsRes, weightRes] = await Promise.all([
    supabase
      .from("daily_nutrition_totals")
      .select("*")
      .eq("user_id", user.id)
      .eq("date", today)
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
      .eq("date", today)
      .order("created_at", { ascending: true }),
    supabase
      .from("body_metrics")
      .select("body_weight")
      .eq("user_id", user.id)
      .eq("date", today)
      .single(),
  ]);

  const totals = totalsRes.data;
  const meals = mealsRes.data || [];
  const workouts = workoutsRes.data || [];
  const bodyWeight = weightRes.data?.body_weight || null;

  // Recent days for quick navigation
  const recentDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    // Use en-CA for consistent YYYY-MM-DD in the user's timezone
    return d.toLocaleDateString("en-CA", { timeZone: TIMEZONE });
  });

  return (
    <div className="space-y-6">
      {/* Date header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">{formatDateLong(today)}</h1>
      </div>

      {/* Macro summary */}
      <DailySummary
        calories={totals?.calories || 0}
        protein={totals?.protein_g || 0}
        carbs={totals?.carbs_g || 0}
        fat={totals?.fat_g || 0}
        fiber={totals?.fiber_g || 0}
      />

      {/* Body weight */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">Body weight</span>
        <BodyWeightEntry currentWeight={bodyWeight} date={today} />
      </div>

      {/* Meals */}
      <section>
        <h2 className="text-sm font-medium mb-2">Meals</h2>
        <MealList meals={meals} />
      </section>

      {/* Workouts */}
      <section>
        <h2 className="text-sm font-medium mb-2">Workouts</h2>
        <WorkoutList workouts={workouts as any} />
      </section>

      {/* Recent days */}
      <section>
        <h2 className="text-sm font-medium mb-2">Recent days</h2>
        <div className="flex gap-2 flex-wrap">
          {recentDays.slice(1).map((d) => (
            <Link
              key={d}
              href={`/dashboard/day/${d}`}
              className="text-xs bg-card border border-border rounded px-2 py-1 hover:border-accent"
            >
              {formatDate(d)}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

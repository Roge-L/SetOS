import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WeeklySummary } from "@/components/weekly-summary";

export default async function WeeklyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get the last 7 days
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);

  const startDate = weekAgo.toISOString().slice(0, 10);
  const endDate = today.toISOString().slice(0, 10);

  const [totalsRes, workoutsRes, weightRes] = await Promise.all([
    supabase
      .from("daily_nutrition_totals")
      .select("date, calories, protein_g, carbs_g, fat_g, fiber_g")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date"),
    supabase
      .from("workout_sessions")
      .select("id, title, started_at")
      .eq("user_id", user.id)
      .gte("started_at", `${startDate}T00:00:00`)
      .lte("started_at", `${endDate}T23:59:59`),
    supabase
      .from("body_metrics")
      .select("date, body_weight")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate)
      .order("date"),
  ]);

  const totals = totalsRes.data || [];
  const workouts = workoutsRes.data || [];
  const weights = weightRes.data || [];

  const daysWithData = totals.length || 1;
  const avgCalories = Math.round(
    totals.reduce((sum, d) => sum + d.calories, 0) / daysWithData
  );
  const avgProtein = Math.round(
    totals.reduce((sum, d) => sum + d.protein_g, 0) / daysWithData
  );
  const avgCarbs = Math.round(
    totals.reduce((sum, d) => sum + d.carbs_g, 0) / daysWithData
  );
  const avgFat = Math.round(
    totals.reduce((sum, d) => sum + d.fat_g, 0) / daysWithData
  );

  const weightTrend =
    weights.length >= 2
      ? {
          start: weights[0].body_weight,
          end: weights[weights.length - 1].body_weight,
          change:
            Math.round(
              (weights[weights.length - 1].body_weight! - weights[0].body_weight!) * 10
            ) / 10,
        }
      : null;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Weekly Summary</h1>
      <p className="text-sm text-muted">
        {startDate} — {endDate}
      </p>

      <WeeklySummary
        avgCalories={avgCalories}
        avgProtein={avgProtein}
        avgCarbs={avgCarbs}
        avgFat={avgFat}
        workoutCount={workouts.length}
        daysTracked={daysWithData}
        weightTrend={weightTrend}
      />

      {/* Day-by-day breakdown */}
      <section>
        <h2 className="text-sm font-medium mb-2">Daily breakdown</h2>
        <div className="space-y-1">
          {totals.map((d) => (
            <div
              key={d.date}
              className="flex items-center justify-between text-xs bg-card border border-border rounded px-3 py-2"
            >
              <span className="text-muted">
                {new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
              <span>
                {d.calories} cal · P:{Math.round(d.protein_g)}g · C:{Math.round(d.carbs_g)}g · F:{Math.round(d.fat_g)}g
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

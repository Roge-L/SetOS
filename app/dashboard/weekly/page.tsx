import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { WeeklySummary } from "@/components/weekly-summary";
import { todayDate, dateInTimezone } from "@/lib/utils";

export default async function WeeklyPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Get the last 7 days in local timezone
  const endDate = todayDate();
  const weekAgoDate = new Date();
  weekAgoDate.setDate(weekAgoDate.getDate() - 6);
  const startDate = dateInTimezone(weekAgoDate);

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
      .select("id, title, date")
      .eq("user_id", user.id)
      .gte("date", startDate)
      .lte("date", endDate),
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

  const validWeights = weights.filter((w) => w.body_weight != null);
  const weightTrend =
    validWeights.length >= 2
      ? {
          start: validWeights[0].body_weight,
          end: validWeights[validWeights.length - 1].body_weight,
          change:
            Math.round(
              (validWeights[validWeights.length - 1].body_weight - validWeights[0].body_weight) * 10
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

interface WeeklySummaryProps {
  avgCalories: number;
  avgProtein: number;
  avgCarbs: number;
  avgFat: number;
  workoutCount: number;
  daysTracked: number;
  weightTrend: {
    start: number | null;
    end: number | null;
    change: number;
  } | null;
}

export function WeeklySummary({
  avgCalories,
  avgProtein,
  avgCarbs,
  avgFat,
  workoutCount,
  daysTracked,
  weightTrend,
}: WeeklySummaryProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard label="Avg calories" value={`${avgCalories}`} />
      <StatCard label="Avg protein" value={`${avgProtein}g`} />
      <StatCard label="Avg carbs" value={`${avgCarbs}g`} />
      <StatCard label="Avg fat" value={`${avgFat}g`} />
      <StatCard label="Workouts" value={`${workoutCount}`} />
      <StatCard label="Days tracked" value={`${daysTracked}`} />
      {weightTrend && (
        <StatCard
          label="Weight trend"
          value={`${weightTrend.change > 0 ? "+" : ""}${weightTrend.change} lbs`}
        />
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}

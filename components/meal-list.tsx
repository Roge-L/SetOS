import Link from "next/link";
import { TIMEZONE } from "@/lib/utils";

interface MealLog {
  id: string;
  parsed_meal_name: string;
  estimated_calories: number;
  estimated_protein_g: number;
  logged_at: string;
  confidence: string;
}

export function MealList({ meals }: { meals: MealLog[] }) {
  if (meals.length === 0) {
    return (
      <p className="text-sm text-muted py-4">No meals logged today.</p>
    );
  }

  return (
    <div className="space-y-2">
      {meals.map((meal) => (
        <div
          key={meal.id}
          className="bg-card border border-border rounded-lg p-3 flex items-center justify-between"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">
              {meal.parsed_meal_name}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {meal.estimated_calories} cal · {Math.round(meal.estimated_protein_g)}g protein ·{" "}
              {new Date(meal.logged_at).toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: TIMEZONE,
              })}
            </div>
          </div>
          <Link
            href={`/meals/${meal.id}/edit`}
            className="text-xs text-accent hover:underline ml-3 shrink-0"
          >
            Edit
          </Link>
        </div>
      ))}
    </div>
  );
}

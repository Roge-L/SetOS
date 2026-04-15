import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  dateInTimezone,
  getUTCRangeForLocalDate,
  formatDateLong,
  escapeLike,
} from "@/lib/utils";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let results: {
    date: string;
    meals: { name: string; matched: boolean }[];
    exercises: { name: string; matched: boolean }[];
  }[] = [];

  if (query) {
    const pattern = `%${escapeLike(query)}%`;
    const lowerQuery = query.toLowerCase();

    // Find dates with matching meals or exercises
    const [matchedMeals, matchedExercises] = await Promise.all([
      supabase
        .from("meal_logs")
        .select("logged_at")
        .eq("user_id", user.id)
        .ilike("parsed_meal_name", pattern)
        .order("logged_at", { ascending: false })
        .limit(500),
      supabase
        .from("workout_exercises")
        .select("workout_sessions!inner(date, user_id)")
        .eq("workout_sessions.user_id", user.id)
        .ilike("normalized_exercise_name", pattern)
        .limit(500),
    ]);

    const dateSet = new Set<string>();
    for (const m of matchedMeals.data || []) {
      dateSet.add(dateInTimezone(new Date(m.logged_at)));
    }
    for (const e of matchedExercises.data || []) {
      const d = (e.workout_sessions as any)?.date;
      if (d) dateSet.add(d);
    }

    const dates = Array.from(dateSet).sort().reverse().slice(0, 30);

    if (dates.length > 0) {
      // Bulk-fetch all meals and workouts for the matched date range
      const ranges = dates.map(getUTCRangeForLocalDate);
      const minStart = ranges.reduce(
        (min, r) => (r.start < min ? r.start : min),
        ranges[0].start
      );
      const maxEnd = ranges.reduce(
        (max, r) => (r.end > max ? r.end : max),
        ranges[0].end
      );

      const [allMeals, allSessions] = await Promise.all([
        supabase
          .from("meal_logs")
          .select("parsed_meal_name, logged_at")
          .eq("user_id", user.id)
          .gte("logged_at", minStart)
          .lte("logged_at", maxEnd)
          .order("logged_at", { ascending: true }),
        supabase
          .from("workout_sessions")
          .select("date, workout_exercises(normalized_exercise_name)")
          .eq("user_id", user.id)
          .in("date", dates),
      ]);

      const mealsByDate = new Map<string, string[]>();
      for (const m of allMeals.data || []) {
        const d = dateInTimezone(new Date(m.logged_at));
        if (!dateSet.has(d)) continue;
        if (!mealsByDate.has(d)) mealsByDate.set(d, []);
        mealsByDate.get(d)!.push(m.parsed_meal_name);
      }

      const exercisesByDate = new Map<string, string[]>();
      for (const s of allSessions.data || []) {
        const names = (s as any).workout_exercises.map(
          (e: any) => e.normalized_exercise_name
        );
        if (!exercisesByDate.has(s.date)) exercisesByDate.set(s.date, []);
        exercisesByDate.get(s.date)!.push(...names);
      }

      results = dates.map((date) => ({
        date,
        meals: (mealsByDate.get(date) || []).map((name) => ({
          name,
          matched: name.toLowerCase().includes(lowerQuery),
        })),
        exercises: (exercisesByDate.get(date) || []).map((name) => ({
          name,
          matched: name.toLowerCase().includes(lowerQuery),
        })),
      }));
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Search</h1>
        <Link href="/dashboard" className="text-xs text-muted hover:text-foreground">
          ← Dashboard
        </Link>
      </div>

      <form>
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search foods or exercises..."
          autoFocus
          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
        />
      </form>

      {query && results.length === 0 && (
        <p className="text-sm text-muted">No results for &ldquo;{query}&rdquo;.</p>
      )}

      {results.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {results.length} day{results.length === 1 ? "" : "s"} matched
          </p>
          {results.map((r) => (
            <Link
              key={r.date}
              href={`/dashboard/day/${r.date}`}
              className="block bg-card border border-border rounded-lg p-3 hover:border-accent"
            >
              <div className="text-sm font-medium mb-1">
                {formatDateLong(r.date)}
              </div>
              {r.meals.length > 0 && (
                <div className="text-xs text-muted">
                  <span className="text-foreground/60">Meals: </span>
                  {r.meals.map((m, i) => (
                    <span key={i}>
                      <span className={m.matched ? "text-accent font-medium" : ""}>
                        {m.name}
                      </span>
                      {i < r.meals.length - 1 && ", "}
                    </span>
                  ))}
                </div>
              )}
              {r.exercises.length > 0 && (
                <div className="text-xs text-muted mt-0.5">
                  <span className="text-foreground/60">Exercises: </span>
                  {r.exercises.map((e, i) => (
                    <span key={i}>
                      <span className={e.matched ? "text-accent font-medium" : ""}>
                        {e.name}
                      </span>
                      {i < r.exercises.length - 1 && ", "}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

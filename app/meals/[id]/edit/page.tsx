import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MealForm } from "@/components/meal-form";

export default async function EditMealPage({
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

  const { data: meal } = await supabase
    .from("meal_logs")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!meal) redirect("/dashboard");

  return (
    <div className="min-h-screen">
      <div className="max-w-2xl mx-auto px-4 py-6">
        <h1 className="text-lg font-semibold mb-6">Edit Meal</h1>
        <MealForm meal={meal} />
      </div>
    </div>
  );
}

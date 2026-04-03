"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

interface MealLog {
  id: string;
  parsed_meal_name: string;
  estimated_calories: number;
  estimated_protein_g: number;
  estimated_carbs_g: number;
  estimated_fat_g: number;
  estimated_fiber_g: number;
  logged_at: string;
}

// Extract YYYY-MM-DD from an ISO timestamp in ET
// Uses the same timezone as the server for consistency
function getDateFromISO(isoString: string): string {
  return new Date(isoString).toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

export function MealForm({ meal }: { meal: MealLog }) {
  const router = useRouter();
  const originalDate = getDateFromISO(meal.logged_at);
  const [form, setForm] = useState({
    parsed_meal_name: meal.parsed_meal_name,
    estimated_calories: meal.estimated_calories,
    estimated_protein_g: meal.estimated_protein_g,
    estimated_carbs_g: meal.estimated_carbs_g,
    estimated_fat_g: meal.estimated_fat_g,
    estimated_fiber_g: meal.estimated_fiber_g,
  });
  const [mealDate, setMealDate] = useState(originalDate);
  const [saving, setSaving] = useState(false);

  function update(key: string, value: string) {
    const numKeys = [
      "estimated_calories",
      "estimated_protein_g",
      "estimated_carbs_g",
      "estimated_fat_g",
      "estimated_fiber_g",
    ];
    setForm((prev) => ({
      ...prev,
      [key]: numKeys.includes(key) ? parseFloat(value) || 0 : value,
    }));
  }

  async function handleSave() {
    setSaving(true);
    const supabase = createClient();

    // If date changed, update logged_at keeping the same time-of-day
    const updateData: Record<string, any> = {
      ...form,
      updated_at: new Date().toISOString(),
    };

    if (mealDate !== originalDate) {
      const timePart = meal.logged_at.slice(11); // preserve HH:MM:SS.mmmZ
      updateData.logged_at = `${mealDate}T${timePart}`;
    }

    const { error } = await supabase
      .from("meal_logs")
      .update(updateData)
      .eq("id", meal.id);

    if (error) {
      alert("Failed to save: " + error.message);
      setSaving(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("Delete this meal?")) return;
    const supabase = createClient();
    await supabase.from("meal_logs").delete().eq("id", meal.id);
    router.push("/dashboard");
    router.refresh();
  }

  const fields = [
    { key: "parsed_meal_name", label: "Meal name", type: "text" },
    { key: "estimated_calories", label: "Calories", type: "number" },
    { key: "estimated_protein_g", label: "Protein (g)", type: "number" },
    { key: "estimated_carbs_g", label: "Carbs (g)", type: "number" },
    { key: "estimated_fat_g", label: "Fat (g)", type: "number" },
    { key: "estimated_fiber_g", label: "Fiber (g)", type: "number" },
  ];

  return (
    <div className="space-y-4">
      {/* Date picker — native <input type="date"> returns YYYY-MM-DD */}
      {/* Ref: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/date */}
      <div>
        <label className="text-xs text-muted block mb-1">Date</label>
        <input
          type="date"
          value={mealDate}
          onChange={(e) => setMealDate(e.target.value)}
          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
        />
      </div>

      {fields.map((f) => (
        <div key={f.key}>
          <label className="text-xs text-muted block mb-1">{f.label}</label>
          <input
            type={f.type}
            value={(form as any)[f.key]}
            onChange={(e) => update(f.key, e.target.value)}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-accent"
          />
        </div>
      ))}

      <div className="flex gap-3 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 bg-accent text-white rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={handleDelete}
          className="px-4 py-2 text-sm text-danger hover:underline"
        >
          Delete
        </button>
        <button
          onClick={() => router.back()}
          className="px-4 py-2 text-sm text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

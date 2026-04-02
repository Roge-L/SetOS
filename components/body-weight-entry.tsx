"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface BodyWeightEntryProps {
  currentWeight: number | null;
  date: string;
}

export function BodyWeightEntry({ currentWeight, date }: BodyWeightEntryProps) {
  const [weight, setWeight] = useState(currentWeight?.toString() || "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const val = parseFloat(weight);
    if (isNaN(val) || val <= 0) return;

    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    await supabase.from("body_metrics").upsert(
      { user_id: user.id, date, body_weight: val },
      { onConflict: "user_id,date" }
    );
    setSaving(false);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="0.1"
        value={weight}
        onChange={(e) => setWeight(e.target.value)}
        placeholder="lbs"
        className="w-20 bg-card border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-accent"
      />
      <span className="text-xs text-muted">lbs</span>
      <button
        onClick={handleSave}
        disabled={saving}
        className="text-xs text-accent hover:underline disabled:opacity-50"
      >
        {saving ? "..." : "Save"}
      </button>
    </div>
  );
}

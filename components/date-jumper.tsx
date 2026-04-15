"use client";

import { useRouter } from "next/navigation";

export function DateJumper({ today }: { today: string }) {
  const router = useRouter();
  return (
    <input
      type="date"
      max={today}
      onChange={(e) => {
        if (e.target.value) router.push(`/dashboard/day/${e.target.value}`);
      }}
      className="text-xs bg-card border border-border rounded px-2 py-1 hover:border-accent"
      aria-label="Jump to date"
    />
  );
}

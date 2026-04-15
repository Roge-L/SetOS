"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const links = [
    { href: "/dashboard", label: "Today" },
    { href: "/dashboard/weekly", label: "Week" },
    { href: "/dashboard/search", label: "Search" },
  ];

  return (
    <nav className="border-b border-border px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="font-bold text-sm">
          SetOS
        </Link>
        <div className="flex gap-4">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`text-sm ${pathname === l.href ? "text-foreground" : "text-muted hover:text-foreground"}`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <button
        onClick={handleSignOut}
        className="text-xs text-muted hover:text-foreground"
      >
        Sign out
      </button>
    </nav>
  );
}

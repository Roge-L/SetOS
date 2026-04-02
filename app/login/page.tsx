"use client";

import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);
    if (error) {
      alert(error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-1">SetOS</h1>
        <p className="text-muted text-sm mb-8">
          Calorie, macro, and workout tracker
        </p>

        {sent ? (
          <div className="bg-card border border-border rounded-lg p-6">
            <p className="text-sm">
              Check your email for a login link.
            </p>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              required
              className="w-full bg-card border border-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent text-white rounded-lg px-4 py-3 text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Sign in with email"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

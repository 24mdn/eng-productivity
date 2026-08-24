"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);

    const supabase = getSupabaseBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(signInError.message);
      setPending(false);
      return;
    }

    // Server Components need a fresh render to pick up the session cookie the browser
    // client just set — refresh before navigating.
    router.refresh();
    router.push("/dashboard/exec");
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 rounded-full border border-white/80 bg-white/75 px-4 text-sm outline-none shadow-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 rounded-full border border-white/80 bg-white/75 px-4 text-sm outline-none shadow-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20"
        />
      </div>
      {error && <p className="text-sm text-status-bad">{error}</p>}
      <Button type="submit" disabled={pending} size="lg" className="mt-2 w-full">
        {pending ? "Signing in..." : "Sign in"}
      </Button>
    </form>
  );
}

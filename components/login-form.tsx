"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

const DEMO_PASSWORD = "change-me-now-123!";

// Fixed demo accounts created by api/app/seed_users.py — one per squad plus exec. Hardcoded
// here (not fetched) because the login page renders before any session exists, and the
// squads table's RLS requires an authenticated user to read it.
const DEMO_ACCOUNTS = [
  { email: "exec@mal-demo.local", label: "Exec — all squads" },
  { email: "engineer-backend@mal-demo.local", label: "Engineer — Backend" },
  { email: "engineer-web@mal-demo.local", label: "Engineer — Web" },
  { email: "engineer-mobile@mal-demo.local", label: "Engineer — Mobile" },
  { email: "engineer-omnirealestate-api@mal-demo.local", label: "Engineer — OmniRealEstate API" },
  {
    email: "engineer-omnirealestate-frontend@mal-demo.local",
    label: "Engineer — OmniRealEstate Frontend",
  },
];

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

      <div className="mt-2 flex flex-col gap-2 border-t border-white/70 pt-4">
        <p className="text-xs font-medium text-muted-foreground">
          Demo accounts (password: <code>{DEMO_PASSWORD}</code>) — click to fill:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              onClick={() => {
                setEmail(account.email);
                setPassword(DEMO_PASSWORD);
              }}
              className="rounded-full border border-white/80 bg-white/60 px-3 py-1 text-xs font-medium hover:bg-white/90"
            >
              {account.label}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

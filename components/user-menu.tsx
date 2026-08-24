"use client";

import { useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function UserMenu({
  email,
  role,
}: {
  email: string;
  role: "exec" | "engineer";
}) {
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();

    // Hard navigation, not router.push: the App Router's client-side Router Cache can still
    // serve a stale, already-rendered /dashboard/* tree on a soft nav even after the cookie
    // is cleared — a full reload guarantees the next request for a dashboard route actually
    // hits the server and gets redirected.
    window.location.href = "/login";
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
      <span className="max-w-56 truncate text-muted-foreground">{email}</span>
      <Badge variant="secondary" className="rounded-full bg-white/70 px-2.5">{role}</Badge>
      <Button variant="ghost" size="sm" disabled={pending} onClick={handleLogout} className="bg-white/45 hover:bg-white/75">
        {pending ? "Signing out…" : "Log out"}
      </Button>
    </div>
  );
}

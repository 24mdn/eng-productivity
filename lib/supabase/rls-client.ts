import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/supabase/server";

/** Anon key + the caller's own JWT attached to every PostgREST request, so RLS evaluates as
 * that specific user — the same pattern the removed FastAPI read path used server-side
 * (see TRANSITION.md), just built directly here instead of over HTTP. cache()-wrapped so
 * multiple calls within one render collapse into a single client construction, same reason
 * getAccessToken() is. `persistSession`/`autoRefreshToken` are off: this is a short-lived
 * per-request server client, not a browser session client — it must not try to manage its own
 * session state. */
export const getRlsSupabaseClient = cache(async (): Promise<SupabaseClient | null> => {
  const token = await getAccessToken();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
});

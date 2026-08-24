import { createBrowserClient } from "@supabase/ssr";

/** Used by the login form and the header logout control — every read in this app still goes
 * through Server Components; this client only ever calls Supabase Auth (sign in/out), never
 * reads data directly. */
export function getSupabaseBrowserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

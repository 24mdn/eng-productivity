import { cache } from "react";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * `setAll` is a deliberate no-op — Server Components can't write cookies, so a refreshed
 * access token never gets persisted back. Acceptable for 4 fixed demo users in one sitting
 * (worst case on a stale session: re-login); revisit with middleware.ts if that becomes
 * annoying. See the plan's §3 for the full tradeoff.
 */
export const getSupabaseServerClient = cache(async () => {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  );
});

export interface Profile {
  role: "exec" | "engineer";
  squadId: string | null;
}

/** Uses auth.getUser(), not getSession() — the former validates against the Auth server,
 * required for any trust decision. getSession() just decodes the local cookie. */
export const getCurrentUser = cache(async () => {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

/** RLS's "users read own row" policy is what actually scopes this to the caller — the query
 * itself asks for the whole table, but Postgres only ever returns one row. */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.from("users").select("role, squad_id").single();
  if (!data) return null;
  return { role: data.role as "exec" | "engineer", squadId: data.squad_id as string | null };
});

export const getAccessToken = cache(async (): Promise<string | null> => {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});

import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard/exec");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-8">
      <section className="glass-panel rounded-3xl border border-white/70 p-6 sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Engineering Productivity
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}

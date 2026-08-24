import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { LoginForm } from "@/components/login-form";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard/exec");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-5 py-8">
      <section className="mal-glass rounded-3xl border border-white/70 p-6 sm:p-8">
        <div className="mb-8 flex items-center gap-3">
          <Image
            src="/mal-digital-bank-original.jpg"
            alt="Mal"
            width={42}
            height={42}
            className="size-10 object-contain"
            priority
          />
          <p className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Mal · Engineering Productivity
          </p>
        </div>
        <LoginForm />
      </section>
    </main>
  );
}

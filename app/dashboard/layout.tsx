import Image from "next/image";
import { redirect } from "next/navigation";
import { DashboardNav } from "@/components/dashboard-nav";
import { UserMenu } from "@/components/user-menu";
import { getCurrentUser, getCurrentProfile } from "@/lib/supabase/server";
import { getScopeMeta } from "@/lib/metrics-repository";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const scopeMeta = await getScopeMeta();
  const title =
    scopeMeta.scope === "exec"
      ? `All squads (${scopeMeta.squads.length})`
      : (scopeMeta.squads[0]?.name ?? "No squad assigned");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-6 sm:px-8">
      <header className="mal-glass flex flex-col gap-4 rounded-2xl border border-white/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image
            src="/mal-digital-bank-original.jpg"
            alt="Mal"
            width={40}
            height={40}
            className="size-10 shrink-0 object-contain"
            priority
          />
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Mal · Engineering Productivity
            </p>
            <h1 className="font-heading text-2xl font-semibold tracking-normal">
              {title}
            </h1>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <DashboardNav role={profile.role} />
          <UserMenu email={user.email ?? ""} role={profile.role} />
        </div>
      </header>
      {children}
    </div>
  );
}

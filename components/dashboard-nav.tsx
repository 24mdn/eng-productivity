"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/dashboard/exec", label: "Exec summary", match: "/dashboard/exec", roles: ["exec"] },
  {
    href: "/dashboard/engineer",
    label: "Engineer view",
    match: "/dashboard/engineer",
    roles: ["engineer"],
  },
];

export function DashboardNav({ role }: { role: "exec" | "engineer" }) {
  const pathname = usePathname();
  const tabs = TABS.filter((tab) => tab.roles.includes(role));

  return (
    <nav className="flex w-fit gap-1 rounded-full border border-white/70 bg-white/55 p-1 shadow-sm backdrop-blur">
      {tabs.map((tab) => {
        const active = pathname?.startsWith(tab.match);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-secondary-foreground hover:bg-white/70"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

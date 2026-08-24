import { redirect } from "next/navigation";
import { ProxyCaveatBanner } from "@/components/proxy-caveat-banner";
import { MetricCard } from "@/components/metric-card";
import {
  METRIC_KEYS,
  getMetricSnapshots,
  getScopeMeta,
} from "@/lib/metrics-repository";
import { getCurrentProfile } from "@/lib/supabase/server";

export default async function EngineerDashboardPage() {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "engineer") redirect("/dashboard/exec");

  const [scopeMeta, seriesList] = await Promise.all([
    getScopeMeta(),
    Promise.all(METRIC_KEYS.map((key) => getMetricSnapshots(key))),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Last 12 weeks
        </p>
        <h2 className="font-heading text-2xl font-semibold tracking-normal">Engineer view</h2>
      </section>

      <ProxyCaveatBanner squads={scopeMeta.squads} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRIC_KEYS.map((key) => (
          <MetricCard key={key} metricKey={key} series={seriesList[METRIC_KEYS.indexOf(key)]} />
        ))}
      </div>
    </div>
  );
}

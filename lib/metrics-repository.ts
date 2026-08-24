/**
 * Data-access boundary between the UI and Supabase Postgres. Every read here goes through a
 * client scoped to the caller's own Supabase access token (lib/supabase/rls-client.ts) —
 * Postgres RLS is the real enforcement, this file just shapes queries/responses and does a
 * fast-fail role/squad guard on top (mirrors the two-layer design api/'s FastAPI used to have,
 * before the read path moved here — see TRANSITION.md). No UI component queries Supabase or
 * calls GitHub directly.
 */
import { getCurrentProfile } from "@/lib/supabase/server";
import { getRlsSupabaseClient } from "@/lib/supabase/rls-client";
import { getSquads, getSquad } from "@/lib/squads";
import type { SupabaseClient } from "@supabase/supabase-js";

export type MetricKey =
  | "deployment_frequency"
  | "lead_time_for_changes"
  | "change_failure_rate"
  | "mttr"
  | "pr_review_turnaround";

export const METRIC_KEYS: MetricKey[] = [
  "deployment_frequency",
  "lead_time_for_changes",
  "change_failure_rate",
  "mttr",
  "pr_review_turnaround",
];

export interface MetricSnapshotRow {
  weekStart: Date;
  weekEnd: Date;
  metricKey: MetricKey;
  value: number | null;
  unit: "count" | "hours" | "percent";
  sampleSize: number;
}

export interface DrillDownRecord {
  id: string;
  occurredAt: Date;
  title: string;
  url: string;
  actorLogin?: string;
  detail: string;
  // Only set for the aggregate (exec) drill-down, where records span multiple squads — omitted
  // for the squad-scoped (engineer) drill-down, where every record is already the caller's own
  // squad and repeating it on every row would just be noise.
  squadName?: string;
}

export type { SquadMeta } from "@/lib/squads";
import type { SquadMeta } from "@/lib/squads";

export interface ScopeMeta {
  scope: "exec" | "engineer";
  squads: SquadMeta[];
}

// --- Postgres read path (replaces api/app/metrics_service.py) ------------------------------

const WEEKS_TO_RETURN = 12;

interface MetricsSnapshotRow {
  week_start: string;
  week_end: string;
  deployment_frequency: number | null;
  lead_time_for_changes_hours: number | null;
  change_failure_rate_pct: number | null;
  mttr_hours: number | null;
  pr_review_turnaround_hours: number | null;
  sample_size: number;
}

// metric_key -> (metrics_snapshots column, unit). Keep in sync with api/app/metrics_service.py's
// METRIC_COLUMNS if either side ever changes.
const METRIC_COLUMNS: Record<
  MetricKey,
  { column: keyof MetricsSnapshotRow; unit: MetricSnapshotRow["unit"] }
> = {
  deployment_frequency: { column: "deployment_frequency", unit: "count" },
  lead_time_for_changes: { column: "lead_time_for_changes_hours", unit: "hours" },
  change_failure_rate: { column: "change_failure_rate_pct", unit: "percent" },
  mttr: { column: "mttr_hours", unit: "hours" },
  pr_review_turnaround: { column: "pr_review_turnaround_hours", unit: "hours" },
};

function emptySeries(): Record<MetricKey, MetricSnapshotRow[]> {
  const entries = METRIC_KEYS.map((k) => [k, [] as MetricSnapshotRow[]] as const);
  return Object.fromEntries(entries) as Record<MetricKey, MetricSnapshotRow[]>;
}

// direct port of metrics_service.py's _rows_to_metric_series
function rowsToMetricSeries(rows: MetricsSnapshotRow[]): Record<MetricKey, MetricSnapshotRow[]> {
  const series = emptySeries();
  const sorted = [...rows].sort((a, b) => a.week_start.localeCompare(b.week_start));
  for (const row of sorted) {
    for (const metricKey of METRIC_KEYS) {
      const { column, unit } = METRIC_COLUMNS[metricKey];
      series[metricKey].push({
        weekStart: new Date(row.week_start),
        weekEnd: new Date(row.week_end),
        metricKey,
        value: row[column] as number | null,
        unit,
        sampleSize: row.sample_size,
      });
    }
  }
  return series;
}

// port of get_squad_snapshots
async function getSquadSnapshotsInternal(squadId: string): Promise<Record<MetricKey, MetricSnapshotRow[]>> {
  const supabase = await getRlsSupabaseClient();
  if (!supabase) return emptySeries();
  // Descending + limit selects the WEEKS_TO_RETURN most recent weeks, not the oldest —
  // rowsToMetricSeries re-sorts ascending for display, but the row *selection* has to be
  // newest-first or a squad with more history than WEEKS_TO_RETURN would silently show its
  // oldest weeks instead of its most recent ones.
  const { data, error } = await supabase
    .from("metrics_snapshots")
    .select("*")
    .eq("squad_id", squadId)
    .order("week_start", { ascending: false })
    .limit(WEEKS_TO_RETURN);
  if (error) throw error;
  return rowsToMetricSeries((data ?? []) as MetricsSnapshotRow[]);
}

// port of get_aggregate_snapshots. Cross-squad rollup: sum for deployment_frequency,
// sample-size-weighted mean for rates/times (NOT a naive mean-of-percentages/mean-of-medians,
// which would misweight squads with different sample sizes) — pandas groupby in the Python
// version, plain Map/reduce here. sample_size in the output row is the sum across ALL squads
// that week, not just the ones with a non-null value for a given metric.
async function getAggregateSnapshotsInternal(): Promise<Record<MetricKey, MetricSnapshotRow[]>> {
  const supabase = await getRlsSupabaseClient();
  if (!supabase) return emptySeries();
  // Same reasoning as getSquadSnapshotsInternal — descending + limit selects the most recent
  // weeks across all squads; the byWeek grouping below sorts weekStart keys ascending for the
  // final series regardless of fetch order.
  const { data, error } = await supabase
    .from("metrics_snapshots")
    .select("*")
    .order("week_start", { ascending: false })
    .limit(WEEKS_TO_RETURN * (await getSquads()).length);
  if (error) throw error;
  const rows = (data ?? []) as MetricsSnapshotRow[];
  if (rows.length === 0) return emptySeries();

  const byWeek = new Map<string, MetricsSnapshotRow[]>();
  for (const row of rows) {
    const list = byWeek.get(row.week_start) ?? [];
    list.push(row);
    byWeek.set(row.week_start, list);
  }

  const series = emptySeries();
  for (const weekStart of [...byWeek.keys()].sort()) {
    const group = byWeek.get(weekStart)!;
    const weekEnd = group[0].week_end;
    const totalSampleSize = group.reduce((sum, r) => sum + r.sample_size, 0);

    for (const metricKey of METRIC_KEYS) {
      const { column, unit } = METRIC_COLUMNS[metricKey];
      const withValue = group.filter((r) => r[column] != null);
      let value: number | null;
      if (metricKey === "deployment_frequency") {
        value = withValue.length > 0
          ? withValue.reduce((s, r) => s + (r[column] as number), 0)
          : null;
      } else {
        const weightSum = withValue.reduce((s, r) => s + r.sample_size, 0);
        value = withValue.length > 0 && weightSum > 0
          ? withValue.reduce((s, r) => s + (r[column] as number) * r.sample_size, 0) / weightSum
          : null;
      }
      series[metricKey].push({
        weekStart: new Date(weekStart),
        weekEnd: new Date(weekEnd),
        metricKey,
        value,
        unit,
        sampleSize: totalSampleSize,
      });
    }
  }
  return series;
}

// --- drill-down "records" (replaces api/app/metrics_service.py's get_squad_records — reads
// persisted receipts instead of live-fetching GitHub on every click; ingestion now builds and
// upserts these into metric_records alongside the metrics_snapshots aggregates) -------------

interface MetricRecordRow {
  squad_id: string;
  record_id: string;
  occurred_at: string;
  title: string;
  url: string;
  actor_login: string | null;
  detail: string;
}

function mapMetricRecordRow(
  row: MetricRecordRow,
  squadNameById?: Map<string, string>
): DrillDownRecord {
  return {
    id: row.record_id,
    occurredAt: new Date(row.occurred_at),
    title: row.title,
    url: row.url,
    actorLogin: row.actor_login ?? undefined,
    detail: row.detail,
    squadName: squadNameById?.get(row.squad_id),
  };
}

/** "Latest ingested week," not "today's calendar week" — metric_records only has data for
 * weeks ingestion actually ran for, and ingestion is manual. Resolving via metrics_snapshots'
 * most recent week_start keeps the drill-down section in sync with the aggregate table above
 * it on the same page, instead of silently going empty the moment a calendar week rolls over
 * without a fresh ingestion run. squadId=null resolves the latest week across ALL squads
 * (the exec/aggregate case) rather than one squad's own latest week. */
async function resolveWeekStart(
  supabase: SupabaseClient,
  squadId: string | null,
  weekStart?: Date
): Promise<string | null> {
  if (weekStart) {
    return new Date(
      Date.UTC(weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate())
    )
      .toISOString()
      .slice(0, 10);
  }
  let query = supabase
    .from("metrics_snapshots")
    .select("week_start")
    .order("week_start", { ascending: false })
    .limit(1);
  if (squadId) query = query.eq("squad_id", squadId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.week_start ?? null;
}

export interface DrillDownResult {
  // The week these records actually belong to (the "latest ingested" week when no explicit
  // weekStart is requested) — surfaced so the UI can say what it's showing instead of implying
  // the records cover every week in the snapshot table above them.
  weekStart: Date | null;
  records: DrillDownRecord[];
}

/** squadId=null reads records across every squad (the exec/aggregate case) — RLS already
 * permits exec to read all of metric_records, this just doesn't add the extra .eq filter. */
async function getRecordsInternal(
  squadId: string | null,
  metricKey: MetricKey,
  weekStart?: Date
): Promise<DrillDownResult> {
  const supabase = await getRlsSupabaseClient();
  if (!supabase) return { weekStart: null, records: [] };
  const resolved = await resolveWeekStart(supabase, squadId, weekStart);
  if (!resolved) return { weekStart: null, records: [] };
  let query = supabase
    .from("metric_records")
    .select("*")
    .eq("metric_key", metricKey)
    .eq("week_start", resolved);
  if (squadId) query = query.eq("squad_id", squadId);
  const { data, error } = await query;
  if (error) throw error;

  const squadNameById = squadId
    ? undefined
    : new Map((await getSquads()).map((s) => [s.id, s.name]));

  return {
    weekStart: new Date(`${resolved}T00:00:00Z`),
    records: (data ?? []).map((row) => mapMetricRecordRow(row as MetricRecordRow, squadNameById)),
  };
}

// --- RBAC guard (mirrors api/app/auth.py's require_exec/require_squad_access — a fast-fail
// layer on top of RLS, not the real enforcement; RLS blocks a mismatched squad_id regardless
// of whether this guard has a bug) ------------------------------------------------------------

async function requireExec(): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "exec") {
    throw new Error("exec role required"); // mirrors FastAPI's 403 — caught by app/dashboard/error.tsx
  }
}

async function requireSquadAccess(squadId: string | null): Promise<boolean> {
  const profile = await getCurrentProfile();
  if (!profile) return false;
  if (profile.role === "exec") return true;
  return profile.role === "engineer" && profile.squadId === squadId;
}

// --- scope meta (header title + caveat banner source) ---------------------------------------

export async function getScopeMeta(): Promise<ScopeMeta> {
  const profile = await getCurrentProfile();
  if (!profile) return { scope: "engineer", squads: [] };

  if (profile.role === "exec") {
    return { scope: "exec", squads: await getSquads() };
  }

  if (!profile.squadId) return { scope: "engineer", squads: [] };
  const squad = await getSquad(profile.squadId);
  return { scope: "engineer", squads: squad ? [squad] : [] };
}

// --- exec-only reads (always the aggregate) ---------------------------------------------------

export async function getAllLatestSnapshots(): Promise<Record<MetricKey, MetricSnapshotRow>> {
  await requireExec();
  const series = await getAggregateSnapshotsInternal();
  const entries = METRIC_KEYS.map((key) => {
    const rows = series[key];
    return [key, rows[rows.length - 1]] as const;
  });
  return Object.fromEntries(entries) as Record<MetricKey, MetricSnapshotRow>;
}

export async function getPreviousSnapshot(metricKey: MetricKey): Promise<MetricSnapshotRow | null> {
  await requireExec();
  const series = await getAggregateSnapshotsInternal();
  const rows = series[metricKey];
  return rows.length >= 2 ? rows[rows.length - 2] : null;
}

/** Exec's counterpart to getMetricSnapshots — full WEEKS_TO_RETURN history, aggregated across
 * every squad, for exec's own drill-down page (mirrors engineer's, but cross-squad). */
export async function getAggregateSnapshots(metricKey: MetricKey): Promise<MetricSnapshotRow[]> {
  await requireExec();
  const series = await getAggregateSnapshotsInternal();
  return series[metricKey];
}

/** Exec's counterpart to getDrillDownRecords — records across every squad for the latest
 * ingested week (globally, not one squad's own latest), each tagged with its squad's name. */
export async function getAggregateDrillDownRecords(
  metricKey: MetricKey,
  weekStart?: Date
): Promise<DrillDownResult> {
  await requireExec();
  return getRecordsInternal(null, metricKey, weekStart);
}

// --- engineer-only reads (always the caller's own squad) -------------------------------------

export async function getMetricSnapshots(metricKey: MetricKey): Promise<MetricSnapshotRow[]> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.squadId || !(await requireSquadAccess(profile.squadId))) return [];
  const series = await getSquadSnapshotsInternal(profile.squadId);
  return series[metricKey];
}

export async function getDrillDownRecords(
  metricKey: MetricKey,
  weekStart?: Date
): Promise<DrillDownResult> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.squadId || !(await requireSquadAccess(profile.squadId))) {
    return { weekStart: null, records: [] };
  }
  return getRecordsInternal(profile.squadId, metricKey, weekStart);
}

// --- static metric metadata (unchanged from the mock-data era) -------------------------------

export const METRIC_META: Record<
  MetricKey,
  { label: string; shortLabel: string; chartVar: string; badgeLabel: string }
> = {
  deployment_frequency: {
    label: "Deployment frequency",
    shortLabel: "Deploy freq",
    chartVar: "--chart-1",
    badgeLabel: "Deployment frequency",
  },
  lead_time_for_changes: {
    label: "Lead time for changes",
    shortLabel: "Lead time",
    chartVar: "--chart-2",
    badgeLabel: "Lead time",
  },
  change_failure_rate: {
    label: "Change failure rate",
    shortLabel: "Change failures",
    chartVar: "--chart-3",
    badgeLabel: "Change failures",
  },
  mttr: {
    label: "Mean time to recovery",
    shortLabel: "MTTR",
    chartVar: "--chart-4",
    badgeLabel: "MTTR",
  },
  pr_review_turnaround: {
    label: "PR review turnaround",
    shortLabel: "Review turnaround",
    chartVar: "--chart-5",
    badgeLabel: "Review turnaround",
  },
};

import type { MetricSnapshotRow } from "./metrics-repository";

export function formatMetricValue(
  row: Pick<MetricSnapshotRow, "value" | "unit"> | null | undefined
): string {
  if (!row || row.value === null) return "—";
  switch (row.unit) {
    case "count":
      return `${row.value}`;
    case "hours":
      return row.value < 24
        ? `${row.value.toFixed(1)}h`
        : `${(row.value / 24).toFixed(1)}d`;
    case "percent":
      return `${row.value.toFixed(0)}%`;
    default:
      return `${row.value}`;
  }
}

export interface Trend {
  direction: "up" | "down" | "flat" | "none";
  label: string;
}

export function formatTrend(
  current: number | null,
  previous: number | null
): Trend {
  if (current === null || previous === null) {
    return { direction: "none", label: "no prior week to compare" };
  }
  if (previous === 0 && current === 0) {
    return { direction: "flat", label: "unchanged vs. last week" };
  }
  const delta = previous === 0 ? 100 : ((current - previous) / previous) * 100;
  if (Math.abs(delta) < 1) {
    return { direction: "flat", label: "flat vs. last week" };
  }
  return {
    direction: delta > 0 ? "up" : "down",
    label: `${delta > 0 ? "+" : ""}${delta.toFixed(0)}% vs. last week`,
  };
}

export function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

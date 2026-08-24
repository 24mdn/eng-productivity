"use client";

import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import type { MetricSnapshotRow } from "@/lib/metrics-repository";

/** Compact, axis-free trend line for summary cards — the at-a-glance signal that doesn't
 * require clicking into a metric's drill-down chart to see whether it's moving. Renders
 * nothing when every week is null (nothing to trace), same as the drill-down chart would
 * show an empty plot in that case — a blank sparkline reads as broken, not "no data yet." */
export function MetricSparkline({
  series,
  color,
}: {
  series: MetricSnapshotRow[];
  color: string;
}) {
  if (!series.some((row) => row.value !== null)) return null;

  const data = series.map((row) => ({ value: row.value }));

  return (
    <div className="h-10 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

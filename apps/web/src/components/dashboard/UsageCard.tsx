import { ChartNoAxesCombined } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { MetricCard } from "./MetricCard";

export function UsageCard({ data }: { data: DashboardData["usage"] }) {
  return (
    <MetricCard title="استفاده" subtitle="PROCESS USAGE" icon={ChartNoAxesCombined}>
      <dl className="usage-values">
        <div><dt>پردازش</dt><dd dir="ltr">{data.processes}</dd></div>
        <div><dt>Thread</dt><dd dir="ltr">{data.threads}</dd></div>
        <div><dt>Memory</dt><dd dir="ltr">{data.memory}</dd></div>
      </dl>
    </MetricCard>
  );
}

import { Clock3 } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { MetricCard } from "./MetricCard";

export function UptimeCard({ data }: { data: DashboardData["uptime"] }) {
  return (
    <MetricCard title="مدت کارکرد" subtitle="UPTIME" icon={Clock3}>
      <dl className="metric-list">
        <div><dt>سیستم عامل</dt><dd>{data.os}</dd></div>
        <div><dt>Xray Core</dt><dd>{data.xray}</dd></div>
      </dl>
    </MetricCard>
  );
}

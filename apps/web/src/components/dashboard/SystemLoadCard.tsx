import { Gauge } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { MetricCard } from "./MetricCard";

export function SystemLoadCard({ data }: { data: DashboardData["systemLoad"] }) {
  const items = [["1m", data.oneMinute], ["5m", data.fiveMinutes], ["15m", data.fifteenMinutes]];
  return (
    <MetricCard title="بار سیستم" subtitle="SYSTEM LOAD" icon={Gauge}>
      <div className="load-values">
        {items.map(([label, value]) => <div key={label}><span dir="ltr">{label}</span><strong dir="ltr">{value}</strong></div>)}
      </div>
    </MetricCard>
  );
}

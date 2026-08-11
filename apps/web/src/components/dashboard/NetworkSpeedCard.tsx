import { ArrowDownLeft, ArrowUpRight, RadioTower } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { MetricCard } from "./MetricCard";

export function NetworkSpeedCard({ data }: { data: DashboardData["networkSpeed"] }) {
  return (
    <MetricCard title="سرعت کل" subtitle="REAL-TIME SPEED" icon={RadioTower}>
      <div className="network-speed-values">
        <div className="network-rx"><ArrowDownLeft size={18} /><span>RX<strong dir="ltr">{data.rx}</strong></span></div>
        <div className="network-tx"><ArrowUpRight size={18} /><span>TX<strong dir="ltr">{data.tx}</strong></span></div>
      </div>
    </MetricCard>
  );
}

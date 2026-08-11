import { Cable } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { MetricCard } from "./MetricCard";

export function ConnectionsCard({ data }: { data: DashboardData["connections"] }) {
  return (
    <MetricCard title="تعداد کانکشن‌ها" subtitle="CONNECTIONS" icon={Cable} className="bottom-metric-card">
      <div className="connection-values">
        <div><span>TCP</span><strong dir="ltr">{data.tcp}</strong><small>اتصال فعال</small></div>
        <div><span>UDP</span><strong dir="ltr">{data.udp}</strong><small>جریان فعال</small></div>
      </div>
    </MetricCard>
  );
}

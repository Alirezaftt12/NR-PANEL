import { ArrowDownToLine, ArrowUpFromLine, Database } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { MetricCard } from "./MetricCard";

export function TotalTrafficCard({ data }: { data: DashboardData["totalTraffic"] }) {
  return (
    <MetricCard title="داده‌های کل" subtitle="TOTAL TRAFFIC" icon={Database} className="bottom-metric-card">
      <div className="traffic-total-values">
        <div><span className="traffic-icon traffic-rx"><ArrowDownToLine size={17} /></span><span>دریافت‌شده<small>RX</small></span><strong dir="ltr">{data.received}</strong></div>
        <div><span className="traffic-icon traffic-tx"><ArrowUpFromLine size={17} /></span><span>ارسال‌شده<small>TX</small></span><strong dir="ltr">{data.sent}</strong></div>
      </div>
    </MetricCard>
  );
}

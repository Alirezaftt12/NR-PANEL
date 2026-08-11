import { Server } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { StatusBadge } from "../ui/StatusBadge";
import { MetricCard } from "./MetricCard";

export function ServerInfoCard({ data }: { data: DashboardData["server"] }) {
  const tone = data.agentStatus === "CONNECTED" ? "healthy" : data.agentStatus === "ERROR" ? "danger" : "disconnected";
  return (
    <MetricCard title="اطلاعات سرور" subtitle="SERVER INFORMATION" icon={Server} className="bottom-metric-card server-info-card">
      <dl className="server-information-list">
        <div><dt>نام سرور</dt><dd>{data.displayName}</dd></div>
        <div><dt>Hostname</dt><dd dir="ltr">{data.hostname}</dd></div>
        <div><dt>OS / Arch</dt><dd dir="ltr">{data.os} · {data.architecture}</dd></div>
        <div><dt>وضعیت Agent</dt><dd><StatusBadge tone={tone}>{data.agentStatus}</StatusBadge></dd></div>
      </dl>
    </MetricCard>
  );
}

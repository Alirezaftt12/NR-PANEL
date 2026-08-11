import { CircleDashed, RefreshCcw } from "lucide-react";
import type { DashboardData } from "../../lib/dashboard-data";
import { StatusBadge } from "../ui/StatusBadge";
import { ConnectionsCard } from "./ConnectionsCard";
import { IpAddressesCard } from "./IpAddressesCard";
import { NetworkSpeedCard } from "./NetworkSpeedCard";
import { QuickActions } from "./QuickActions";
import { ResourceCard } from "./ResourceCard";
import { ServerInfoCard } from "./ServerInfoCard";
import { SystemLoadCard } from "./SystemLoadCard";
import { TotalTrafficCard } from "./TotalTrafficCard";
import { UptimeCard } from "./UptimeCard";
import { UsageCard } from "./UsageCard";
import { XrayCard } from "./XrayCard";

export function DashboardOverview({ data }: { data: DashboardData }) {
  return (
    <div className="dashboard-layout">
      <section className="dashboard-context" aria-label="وضعیت داده داشبورد">
        <div>
          <StatusBadge tone={data.state === "LIVE" ? "healthy" : data.state === "ERROR" ? "danger" : "disconnected"}>{data.state}</StatusBadge>
          <p>{data.state === "LIVE" ? "داده‌های واقعی از Agent احراز هویت‌شده دریافت شده‌اند." : "Agent متصل نیست؛ مقدار ساختگی نمایش داده نمی‌شود."}</p>
        </div>
        <span><CircleDashed size={15} /> Agent: <strong>{data.server.agentStatus}</strong></span>
        <span><RefreshCcw size={14} /> آخرین دریافت زنده: {data.updatedAt ? new Date(data.updatedAt).toLocaleString("fa-IR") : "هرگز"}</span>
      </section>

      <section className="resource-grid" aria-label="منابع سیستم">
        {data.resources.map((metric) => <ResourceCard metric={metric} key={metric.id} />)}
      </section>

      <section className="dashboard-primary-grid" aria-label="کنترل سرویس و میانبرها">
        <XrayCard data={data.xray} />
        <QuickActions />
      </section>

      <section className="dashboard-secondary-grid" aria-label="وضعیت جاری سیستم">
        <UptimeCard data={data.uptime} />
        <SystemLoadCard data={data.systemLoad} />
        <UsageCard data={data.usage} />
        <NetworkSpeedCard data={data.networkSpeed} />
      </section>

      <section className="dashboard-bottom-grid" aria-label="اطلاعات شبکه و سرور">
        <TotalTrafficCard data={data.totalTraffic} />
        <IpAddressesCard data={data.addresses} />
        <ConnectionsCard data={data.connections} />
        <ServerInfoCard data={data.server} />
      </section>
    </div>
  );
}

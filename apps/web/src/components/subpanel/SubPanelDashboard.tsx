import { Activity, Cpu, Database, MemoryStick, Network, Server, TimerReset } from "lucide-react";
import type { SubpanelDashboardData } from "@nr/shared";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";
import { formatBytes } from "./format";
import { QuotaOverview } from "./QuotaOverview";

const metric = (value: string | number | null, suffix = "") => value === null ? "بدون داده" : `${value}${suffix}`;

export function SubPanelDashboard({ data, error }: { data: SubpanelDashboardData; error?: string | null }) {
  return (
    <div className="subpanel-page-stack">
      <section className="subpanel-welcome"><div><p>SUB PANEL OVERVIEW</p><h2>{data.panelName}</h2><span>مدیریت کاربران روی ورودی‌های تخصیص‌یافته</span></div>{error ? <StatusBadge tone="danger">API ERROR</StatusBadge> : <StatusBadge tone={data.quota.status === "ACTIVE" ? "healthy" : "danger"}>{data.quota.status}</StatusBadge>}</section>
      {error ? <Card className="subpanel-notice danger"><Activity size={18} /><p>{error}</p></Card> : null}
      <QuotaOverview quota={data.quota} />
      <section className="subpanel-section-heading"><div><p>READ ONLY</p><h3>وضعیت سیستم‌های مجاز</h3></div><span>بدون دسترسی عملیاتی</span></section>
      {data.servers.length ? <div className="subpanel-server-grid">{data.servers.map((server) => (
        <Card className="subpanel-server-card" key={server.id}>
          <header><div><span><Server size={18} /></span><p><strong>{server.name}</strong><small dir="ltr">{server.hostname}</small></p></div><StatusBadge tone={server.dataState === "LIVE" ? "healthy" : "disconnected"}>{server.dataState}</StatusBadge></header>
          <dl>
            <div><dt><Cpu size={15} /> CPU</dt><dd>{metric(server.cpuPercent, "%")}</dd></div>
            <div><dt><MemoryStick size={15} /> RAM</dt><dd>{server.ramBytes ? formatBytes(server.ramBytes) : "بدون داده"}</dd></div>
            <div><dt><Database size={15} /> Storage</dt><dd>{server.storageBytes ? formatBytes(server.storageBytes) : "بدون داده"}</dd></div>
            <div><dt><TimerReset size={15} /> Uptime</dt><dd>{server.uptimeSeconds ? `${Math.floor(Number(server.uptimeSeconds) / 3600).toLocaleString("fa-IR")} ساعت` : "بدون داده"}</dd></div>
            <div><dt><Activity size={15} /> Xray</dt><dd>{server.xrayStatus ?? "بدون داده"}</dd></div>
            <div><dt><Network size={15} /> RX / TX</dt><dd dir="ltr">{server.rxBytes ? formatBytes(server.rxBytes) : "—"} / {server.txBytes ? formatBytes(server.txBytes) : "—"}</dd></div>
          </dl>
          <footer><span>Server: {server.status}</span><span dir="ltr">Xray {server.xrayVersion ?? "—"}</span></footer>
        </Card>
      ))}</div> : <Card className="subpanel-empty"><Server size={24} /><h3>سروری تخصیص نیافته است</h3><p>OWNER باید سرورهای مجاز را از پنل مادر تعیین کند.</p></Card>}
    </div>
  );
}

import type { MasterSettingsSnapshot } from "@nr/shared";
import { Activity, Database, HardDrive, RadioTower, Server, ShieldCheck, WifiOff } from "lucide-react";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

function tone(value: string) { return value === "HEALTHY" || value === "ACTIVE" ? "healthy" as const : value === "UNAVAILABLE" ? "warning" as const : "danger" as const; }

export function AdvancedSettings({ snapshot }: { snapshot: MasterSettingsSnapshot }) {
  const items = [
    { label: "Database", value: snapshot.diagnostics.database, icon: Database }, { label: "API", value: snapshot.diagnostics.api, icon: Activity },
    { label: "Redis", value: snapshot.diagnostics.redis, icon: HardDrive }, { label: "WebSocket", value: snapshot.diagnostics.websocket, icon: RadioTower },
    { label: "Storage", value: snapshot.diagnostics.storage, icon: Server }, { label: "Queue", value: snapshot.diagnostics.queue, icon: WifiOff },
  ];
  return <div className="settings-section-stack"><header className="settings-section-header"><p>SAFE DIAGNOSTICS</p><h2>پیشرفته</h2><span>فقط وضعیت‌های خواندنی و feature flagهای تعریف‌شده؛ هیچ Shell، SQL، فایل‌ادیتور یا فرمان Agent دلخواه وجود ندارد.</span></header>
    <section className="advanced-status-grid">{items.map((item) => <Card key={item.label}><item.icon size={18} /><div><small>{item.label}</small><strong>{item.value}</strong></div><StatusBadge tone={tone(item.value)}>{item.value}</StatusBadge></Card>)}</section>
    <Card as="section" className="advanced-summary-card"><header><ShieldCheck size={19} /><div><h3>خلاصه زیرساخت</h3><p>داده مستقیم پایگاه داده و health endpoint؛ مقادیر ناموجود شبیه‌سازی نشده‌اند.</p></div></header><div><article><span>Agentها</span><strong>{snapshot.diagnostics.agents.online.toLocaleString("fa-IR")} / {snapshot.diagnostics.agents.total.toLocaleString("fa-IR")}</strong></article><article><span>Xray Running</span><strong>{snapshot.diagnostics.xray.running.toLocaleString("fa-IR")} / {snapshot.diagnostics.xray.total.toLocaleString("fa-IR")}</strong></article><article><span>Config Valid</span><strong>{snapshot.diagnostics.xray.configValid.toLocaleString("fa-IR")}</strong></article><article><span>Maintenance</span><strong>{snapshot.sections.general.value.maintenanceMode ? "فعال" : "غیرفعال"}</strong></article></div></Card>
    <Card as="section" className="connection-readonly"><h3>اتصال فعلی</h3><dl><div><dt>Host</dt><dd dir="ltr">{snapshot.connection.host}</dd></div><div><dt>Protocol</dt><dd>{snapshot.connection.protocol.toUpperCase()}</dd></div><div><dt>Port</dt><dd>{snapshot.connection.port ?? "—"}</dd></div><div><dt>HTTPS</dt><dd>{snapshot.connection.https ? "فعال" : "غیرفعال"}</dd></div><div><dt>Environment</dt><dd>{snapshot.connection.environment}</dd></div><div><dt>Version</dt><dd>{snapshot.connection.panelVersion}</dd></div></dl></Card>
  </div>;
}

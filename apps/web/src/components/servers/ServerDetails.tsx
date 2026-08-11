import { Activity, Cpu, HardDrive, MemoryStick, Network, Server, TimerReset } from "lucide-react";
import Link from "next/link";
import type { ServerSummary } from "@nr/shared";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

function bytes(value: string | null) { if (value === null) return "بدون داده"; const number = Number(value); return Number.isFinite(number) ? `${(number / 1024 ** 3).toFixed(2)} GB` : "بدون داده"; }
export function ServerDetails({ server }: { server: ServerSummary }) {
  const metric = server.metrics;
  return <div className="server-details-page"><header className="server-details-header"><div><p>REAL AGENT TELEMETRY</p><h2>{server.displayName}</h2><span>{server.hostname || "Agent هنوز hostname را گزارش نکرده است"}</span></div><StatusBadge tone={server.status === "ONLINE" ? "healthy" : server.status === "ERROR" ? "danger" : "disconnected"}>{server.status}</StatusBadge></header>
    <div className="server-details-grid"><Card><Server /><dl><div><dt>Public IP</dt><dd dir="ltr">{server.publicAddress || "—"}</dd></div><div><dt>OS</dt><dd>{server.os || "—"}</dd></div><div><dt>Kernel</dt><dd dir="ltr">{server.kernel || "—"}</dd></div><div><dt>Architecture</dt><dd dir="ltr">{server.architecture || "—"}</dd></div></dl></Card><Card><Activity /><dl><div><dt>Agent</dt><dd>{server.agentStatus}</dd></div><div><dt>Agent Version</dt><dd>{server.agentVersion || "—"}</dd></div><div><dt>Xray</dt><dd>{server.xrayStatus}</dd></div><div><dt>Xray Version</dt><dd>{server.xrayVersion || "—"}</dd></div></dl></Card></div>
    <section className="server-live-metrics"><Card><Cpu /><span>CPU</span><strong>{metric?.cpu.usage === null || metric?.cpu.usage === undefined ? "بدون داده" : `${metric.cpu.usage.toFixed(1)}%`}</strong></Card><Card><MemoryStick /><span>RAM</span><strong>{bytes(metric?.ram.used ?? null)} / {bytes(metric?.ram.total ?? null)}</strong></Card><Card><HardDrive /><span>Storage</span><strong>{bytes(metric?.storage.used ?? null)} / {bytes(metric?.storage.total ?? null)}</strong></Card><Card><TimerReset /><span>Uptime</span><strong>{metric?.uptimeSeconds ? `${Math.floor(Number(metric.uptimeSeconds) / 3600).toLocaleString("fa-IR")} ساعت` : "بدون داده"}</strong></Card><Card><Network /><span>RX / TX</span><strong>{bytes(metric?.network.rxTotal ?? null)} / {bytes(metric?.network.txTotal ?? null)}</strong></Card></section>
    <p className="server-sample-note">آخرین Heartbeat: {server.lastHeartbeatAt ? new Date(server.lastHeartbeatAt).toLocaleString("fa-IR") : "هرگز"} · آخرین Metrics: {server.lastMetricsAt ? new Date(server.lastMetricsAt).toLocaleString("fa-IR") : "هرگز"}</p><Link className="button" href="/servers">بازگشت به سرورها</Link>
  </div>;
}

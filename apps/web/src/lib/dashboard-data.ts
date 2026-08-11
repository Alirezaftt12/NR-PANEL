import type { MasterDashboardData } from "@nr/shared";

export type DashboardDataState = "LIVE" | "DISCONNECTED" | "ERROR";
export type HealthTone = "healthy" | "warning" | "disconnected" | "danger" | "info";
export type ResourceMetric = { id: "cpu" | "ram" | "swap" | "storage"; label: string; percent: number; available: boolean; used: string; total: string; detail: string; tone: HealthTone; history: number[] };
export type DashboardData = {
  state: DashboardDataState; updatedAt: string | null; resources: ResourceMetric[];
  xray: { status: "RUNNING" | "STOPPED" | "ERROR" | "DISCONNECTED"; version: string; uptime: string; lastRestart: string; configState: "VALID" | "INVALID" | "UNCHECKED"; agentConnected: boolean };
  uptime: { os: string; xray: string }; systemLoad: { oneMinute: string; fiveMinutes: string; fifteenMinutes: string };
  usage: { processes: string; threads: string; memory: string }; networkSpeed: { rx: string; tx: string }; totalTraffic: { received: string; sent: string };
  addresses: { ipv4: string; ipv6: string }; connections: { tcp: string; udp: string };
  server: { displayName: string; hostname: string; os: string; architecture: string; agentStatus: "CONNECTED" | "DISCONNECTED" | "ERROR" };
};

const missing = "بدون داده";
function bytes(value: string | null) {
  if (value === null) return missing;
  const number = Number(value); if (!Number.isFinite(number)) return missing;
  const units = ["B", "KB", "MB", "GB", "TB"]; let current = number; let unit = 0;
  while (current >= 1024 && unit < units.length - 1) { current /= 1024; unit += 1; }
  return `${current.toFixed(unit ? 2 : 0)} ${units[unit]}`;
}
function duration(value: string | null) { if (value === null) return missing; const seconds = Number(value); return Number.isFinite(seconds) ? `${Math.floor(seconds / 86400).toLocaleString("fa-IR")} روز، ${Math.floor((seconds % 86400) / 3600).toLocaleString("fa-IR")} ساعت` : missing; }
function resource(id: ResourceMetric["id"], label: string, used: string | null, total: string | null, percent: number | null, detail: string): ResourceMetric {
  const available = percent !== null && Number.isFinite(percent);
  return { id, label, available, percent: available ? Math.max(0, Math.min(100, percent)) : 0, used: used ?? missing, total: total ?? missing, detail, tone: !available ? "disconnected" : percent! >= 90 ? "danger" : percent! >= 75 ? "warning" : "healthy", history: available ? [percent!] : [] };
}

export function mapDashboardData(input: MasterDashboardData): DashboardData {
  const server = input.server; const metrics = server?.metrics ?? null;
  const ramPercent = metrics?.ram.used && metrics.ram.total && Number(metrics.ram.total) > 0 ? Number(metrics.ram.used) / Number(metrics.ram.total) * 100 : null;
  const swapPercent = metrics?.swap.used && metrics.swap.total && Number(metrics.swap.total) > 0 ? Number(metrics.swap.used) / Number(metrics.swap.total) * 100 : null;
  const storagePercent = metrics?.storage.used && metrics.storage.total && Number(metrics.storage.total) > 0 ? Number(metrics.storage.used) / Number(metrics.storage.total) * 100 : null;
  const agentConnected = input.state === "LIVE";
  const xrayStatus = server?.xrayStatus === "ONLINE" ? "RUNNING" : server?.xrayStatus === "ERROR" ? "ERROR" : server?.xrayStatus === "STOPPED" ? "STOPPED" : "DISCONNECTED";
  return {
    state: input.state, updatedAt: input.updatedAt,
    resources: [resource("cpu", "CPU", metrics?.cpu.cores === null || metrics?.cpu.cores === undefined ? null : `${metrics.cpu.cores} Core`, metrics?.cpu.cores === null || metrics?.cpu.cores === undefined ? null : `${metrics.cpu.cores} Core`, metrics?.cpu.usage ?? null, "پردازنده"), resource("ram", "RAM", bytes(metrics?.ram.used ?? null), bytes(metrics?.ram.total ?? null), ramPercent, "حافظه اصلی"), resource("swap", "SWAP", bytes(metrics?.swap.used ?? null), bytes(metrics?.swap.total ?? null), swapPercent, "حافظه مبادله"), resource("storage", "STORAGE", bytes(metrics?.storage.used ?? null), bytes(metrics?.storage.total ?? null), storagePercent, "فضای دیسک")],
    xray: { status: xrayStatus, version: server?.xrayVersion ?? missing, uptime: missing, lastRestart: missing, configState: "UNCHECKED", agentConnected },
    uptime: { os: duration(metrics?.uptimeSeconds ?? null), xray: missing }, systemLoad: { oneMinute: metrics?.load[0]?.toFixed(2) ?? missing, fiveMinutes: metrics?.load[1]?.toFixed(2) ?? missing, fifteenMinutes: metrics?.load[2]?.toFixed(2) ?? missing },
    usage: { processes: metrics?.processCount?.toLocaleString("fa-IR") ?? missing, threads: missing, memory: bytes(metrics?.ram.used ?? null) }, networkSpeed: { rx: bytes(metrics?.network.rxRate ?? null) + (metrics?.network.rxRate ? "/s" : ""), tx: bytes(metrics?.network.txRate ?? null) + (metrics?.network.txRate ? "/s" : "") }, totalTraffic: { received: bytes(metrics?.network.rxTotal ?? null), sent: bytes(metrics?.network.txTotal ?? null) },
    addresses: { ipv4: server?.ipv4 ?? missing, ipv6: server?.ipv6 ?? missing }, connections: { tcp: metrics?.connections.tcp?.toLocaleString("fa-IR") ?? missing, udp: metrics?.connections.udp?.toLocaleString("fa-IR") ?? missing },
    server: { displayName: server?.displayName ?? "سروری ثبت نشده", hostname: server?.hostname ?? missing, os: server?.os ?? missing, architecture: server?.architecture ?? missing, agentStatus: input.state === "LIVE" ? "CONNECTED" : input.state === "ERROR" ? "ERROR" : "DISCONNECTED" },
  };
}

export const disconnectedDashboardData = mapDashboardData({ state: "DISCONNECTED", updatedAt: null, server: null });

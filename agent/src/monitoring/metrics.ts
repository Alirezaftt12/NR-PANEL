import { execFile } from "node:child_process";
import { access, readFile, readdir, statfs } from "node:fs/promises";
import os from "node:os";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const hostRoot = (process.env.HOST_ROOT || "").replace(/\/$/, "");
const hostPath = (path: string) => `${hostRoot}${path}`;
let previousNetwork: { rx: number; tx: number; at: number } | null = null;

async function safeRead(path: string) { try { return await readFile(path, "utf8"); } catch { return null; } }
function cpuTotals() {
  return os.cpus().reduce((result, cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: result.idle + cpu.times.idle, total: result.total + total };
  }, { idle: 0, total: 0 });
}
async function cpuUsage() {
  const before = cpuTotals();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = cpuTotals();
  const total = after.total - before.total;
  return total > 0 ? Math.max(0, Math.min(100, ((total - (after.idle - before.idle)) / total) * 100)) : null;
}
function meminfo(source: string | null) {
  const values = new Map<string, number>();
  for (const line of source?.split("\n") ?? []) {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  return values;
}
function networkTotals(source: string | null) {
  let rx = 0; let tx = 0;
  for (const line of source?.split("\n").slice(2) ?? []) {
    const [name, values] = line.trim().split(":");
    if (!name || !values || name.trim() === "lo") continue;
    const fields = values.trim().split(/\s+/).map(Number);
    if (Number.isFinite(fields[0])) rx += fields[0];
    if (Number.isFinite(fields[8])) tx += fields[8];
  }
  return { rx, tx };
}
function socketCounts(source: string | null) {
  const tcp = Number(source?.match(/^TCP:\s+inuse\s+(\d+)/m)?.[1] ?? NaN);
  const udp = Number(source?.match(/^UDP:\s+inuse\s+(\d+)/m)?.[1] ?? NaN);
  return { tcp: Number.isFinite(tcp) ? tcp : null, udp: Number.isFinite(udp) ? udp : null };
}
function addresses() {
  const entries = Object.values(os.networkInterfaces()).flat().filter((entry) => entry && !entry.internal);
  return { ipv4: entries.find((entry) => entry?.family === "IPv4")?.address ?? null, ipv6: entries.find((entry) => entry?.family === "IPv6")?.address ?? null };
}
async function xrayStatus() {
  const binaryCandidates = [hostPath("/usr/local/bin/xray"), hostPath("/usr/bin/xray")];
  const binary = (await Promise.all(binaryCandidates.map(async (candidate) => { try { await access(candidate); return candidate; } catch { return null; } }))).find(Boolean);
  if (!binary) return { status: "NOT_INSTALLED" as const, version: null, uptimeSeconds: null, configValid: null };
  try {
    const [{ stdout }, active] = await Promise.all([
      executeFile(binary, ["version"], { timeout: 5000 }),
      readdir(hostPath("/proc")).then(async (entries) => (await Promise.all(entries.filter((entry) => /^\d+$/.test(entry)).map((entry) => safeRead(hostPath(`/proc/${entry}/comm`))))).some((name) => name?.trim() === "xray") ? "active" : "inactive").catch(() => "unknown"),
    ]);
    const version = stdout.match(/Xray\s+([\w.-]+)/i)?.[1] ?? null;
    return { status: active === "active" ? "ONLINE" as const : "STOPPED" as const, version, uptimeSeconds: null, configValid: null };
  } catch { return { status: "ERROR" as const, version: null, uptimeSeconds: null, configValid: null }; }
}

export async function collectMetrics(agentVersion: string) {
  const [usage, memSource, networkSource, socketSource, rootFs, procEntries, osRelease, xray] = await Promise.all([
    cpuUsage(), safeRead(hostPath("/proc/meminfo")), safeRead(hostPath("/proc/net/dev")), safeRead(hostPath("/proc/net/sockstat")), statfs(hostRoot || "/").catch(() => null), readdir(hostPath("/proc")).catch(() => []), safeRead(hostPath("/etc/os-release")), xrayStatus(),
  ]);
  const memory = meminfo(memSource);
  const totalRam = memory.get("MemTotal") ?? os.totalmem();
  const availableRam = memory.get("MemAvailable") ?? os.freemem();
  const swapTotal = memory.get("SwapTotal") ?? null;
  const swapFree = memory.get("SwapFree") ?? null;
  const totals = networkTotals(networkSource);
  const now = Date.now();
  const elapsed = previousNetwork ? Math.max(0.001, (now - previousNetwork.at) / 1000) : null;
  const rxRate = previousNetwork && elapsed ? Math.max(0, Math.round((totals.rx - previousNetwork.rx) / elapsed)) : null;
  const txRate = previousNetwork && elapsed ? Math.max(0, Math.round((totals.tx - previousNetwork.tx) / elapsed)) : null;
  previousNetwork = { ...totals, at: now };
  const sockets = socketCounts(socketSource);
  const load = os.loadavg();
  const osName = osRelease?.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1] ?? os.type();
  const ip = addresses();
  return {
    requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), agentVersion, health: "ONLINE" as const,
    system: { hostname: os.hostname(), os: osName, kernel: os.release(), architecture: os.arch(), ...ip },
    cpu: { usage, cores: os.cpus().length }, ram: { used: totalRam - availableRam, total: totalRam },
    swap: { used: swapTotal === null || swapFree === null ? null : swapTotal - swapFree, total: swapTotal },
    storage: { used: rootFs ? Number((rootFs.blocks - rootFs.bfree) * rootFs.bsize) : null, total: rootFs ? Number(rootFs.blocks * rootFs.bsize) : null },
    load: [load[0] ?? null, load[1] ?? null, load[2] ?? null] as [number | null, number | null, number | null], uptimeSeconds: Math.floor(os.uptime()),
    network: { rxRate, txRate, rxTotal: totals.rx, txTotal: totals.tx }, connections: sockets,
    processCount: procEntries.filter((entry) => /^\d+$/.test(entry)).length, xray,
  };
}

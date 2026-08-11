import { collectMetrics } from "./monitoring/metrics.js";
import { sendHeartbeat } from "./transport/client.js";

const masterUrl = process.env.MASTER_PUBLIC_URL;
const credential = process.env.AGENT_CREDENTIAL;
const agentVersion = process.env.AGENT_VERSION || "0.1.0";
const intervalSeconds = Number(process.env.AGENT_HEARTBEAT_SECONDS || 30);
if (!masterUrl || !credential) throw new Error("MASTER_PUBLIC_URL and AGENT_CREDENTIAL are required");
if (!Number.isInteger(intervalSeconds) || intervalSeconds < 10 || intervalSeconds > 300) throw new Error("AGENT_HEARTBEAT_SECONDS must be between 10 and 300");
const configuredMasterUrl = masterUrl;
const configuredCredential = credential;

let running = false;
async function run() {
  if (running) return;
  running = true;
  try { await sendHeartbeat(configuredMasterUrl, configuredCredential, await collectMetrics(agentVersion) as unknown as Record<string, unknown>); }
  catch (error) { console.error("heartbeat failed", error instanceof Error ? error.message : "unknown error"); process.exitCode = 1; }
  finally { running = false; }
}
await run();
setInterval(() => { void run(); }, intervalSeconds * 1000);

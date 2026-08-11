import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ROLES, type ServerLifecycleStatus, type ServerSummary } from "@nr/shared";
import { ApiError } from "../../lib/errors.js";
import type { Database } from "../../database/client.js";
import type { AuthContext, RequestMetadata } from "../identity.js";
import type { AgentHeartbeatInput, ServerCreateInput } from "./schemas.js";

export const hashServerSecret = (value: string) => createHash("sha256").update(value).digest("hex");
export const joinTokenUsable = (value: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date }, now = new Date()) => !value.usedAt && !value.revokedAt && value.expiresAt > now;
export const nextHeartbeatStatus = (current: ServerLifecycleStatus, health: "ONLINE" | "ERROR"): ServerLifecycleStatus => current === "REGISTERED" ? "CONNECTING" : health === "ONLINE" ? "ONLINE" : "ERROR";
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const numberOrNull = (value: string | number | null | undefined) => value === null || value === undefined ? null : Number(value);

export class ServerRepository {
  constructor(private readonly database: Database) {}

  async create(input: ServerCreateInput, auth: AuthContext, metadata: RequestMetadata) {
    return this.database.transaction().execute(async (transaction) => {
      const server = await transaction.insertInto("servers").values({
        tenant_id: auth.primaryTenantId, display_name: input.displayName, hostname: null, ipv4: null, ipv6: null,
        role: input.role, country: input.country ?? null, region: input.region ?? null, provider: input.provider ?? null,
        description: input.description ?? null, public_address: null, last_metrics_at: null, status: "PENDING_INSTALL",
      }).returning(["id", "display_name as displayName", "status", "created_at as createdAt"]).executeTakeFirstOrThrow();
      await transaction.insertInto("audit_logs").values({ severity: "info", category: "SERVER", actor_id: auth.userId, actor_role: auth.role, tenant_id: auth.primaryTenantId, server_id: server.id, ip: metadata.ip, action: "SERVER_CREATED", message: "Pending server created", target_type: "server", target_id: server.id, request_id: metadata.requestId, metadata: { role: input.role } }).execute();
      return server;
    });
  }

  async assertAccess(serverId: string, auth: AuthContext) {
    let query = this.database.selectFrom("servers").select(["id", "tenant_id as tenantId", "display_name as displayName", "status"]).where("id", "=", serverId);
    if (auth.role !== ROLES.OWNER) query = auth.tenantIds.length ? query.where("tenant_id", "in", auth.tenantIds) : query.where("tenant_id", "=", auth.primaryTenantId);
    const server = await query.executeTakeFirst();
    if (!server) throw new ApiError(404, "SERVER_NOT_FOUND", "Server not found");
    return server;
  }

  async issueJoinToken(serverId: string, auth: AuthContext, metadata: RequestMetadata, ttlSeconds: number) {
    const token = `nrj_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await this.database.transaction().execute(async (transaction) => {
      let serverQuery = transaction.selectFrom("servers").select(["id", "tenant_id as tenantId", "status"]).where("id", "=", serverId).forUpdate();
      if (auth.role !== ROLES.OWNER) serverQuery = auth.tenantIds.length ? serverQuery.where("tenant_id", "in", auth.tenantIds) : serverQuery.where("tenant_id", "=", auth.primaryTenantId);
      const server = await serverQuery.executeTakeFirst();
      if (!server) throw new ApiError(404, "SERVER_NOT_FOUND", "Server not found");
      if (!["PENDING_INSTALL", "REGISTERED", "CONNECTING", "ERROR", "OFFLINE"].includes(server.status)) throw new ApiError(409, "SERVER_JOIN_NOT_ALLOWED", "A join token cannot be created for this server state");
      const instance = await transaction.selectFrom("panel_instances").select("id").where("singleton", "=", true).executeTakeFirstOrThrow();
      await transaction.updateTable("server_join_tokens").set({ revoked_at: new Date() }).where("server_id", "=", serverId).where("used_at", "is", null).where("revoked_at", "is", null).execute();
      await transaction.insertInto("server_join_tokens").values({ server_id: serverId, master_instance_id: instance.id, token_hash: hashServerSecret(token), purpose: "SERVER_JOIN", expires_at: expiresAt, used_at: null, revoked_at: null, created_by: auth.userId }).execute();
      await transaction.insertInto("audit_logs").values({ severity: "warning", category: "SERVER", actor_id: auth.userId, actor_role: auth.role, tenant_id: server.tenantId, server_id: serverId, ip: metadata.ip, action: "SERVER_JOIN_TOKEN_CREATED", message: "One-time server join token created", target_type: "server", target_id: serverId, request_id: metadata.requestId, metadata: { expiresAt: expiresAt.toISOString() } }).execute();
    });
    return { token, expiresAt };
  }

  async enroll(joinToken: string, input: { hostname: string; publicAddress: string | null; agentVersion: string }, requestIp: string | null) {
    const credential = `nra_${randomBytes(48).toString("base64url")}`;
    return this.database.transaction().execute(async (transaction) => {
      const token = await transaction.selectFrom("server_join_tokens").innerJoin("servers", "servers.id", "server_join_tokens.server_id")
        .select(["server_join_tokens.id", "server_join_tokens.server_id as serverId", "server_join_tokens.expires_at as expiresAt", "server_join_tokens.used_at as usedAt", "server_join_tokens.revoked_at as revokedAt", "servers.display_name as displayName", "servers.tenant_id as tenantId"])
        .where("server_join_tokens.token_hash", "=", hashServerSecret(joinToken)).where("server_join_tokens.purpose", "=", "SERVER_JOIN").forUpdate().executeTakeFirst();
      if (!token || !joinTokenUsable(token)) throw new ApiError(401, "JOIN_TOKEN_INVALID", "Join token is invalid, expired, revoked, or already used");
      await transaction.updateTable("server_join_tokens").set({ used_at: new Date() }).where("id", "=", token.id).execute();
      await transaction.deleteFrom("server_agents").where("server_id", "=", token.serverId).execute();
      const keyId = randomUUID();
      await transaction.insertInto("server_agents").values({ server_id: token.serverId, key_id: keyId, public_key_fingerprint: hashServerSecret(credential).slice(0, 32), credential_hash: hashServerSecret(credential), status: "REGISTERED", version: input.agentVersion, registered_at: new Date(), rotated_at: null, last_heartbeat_at: null, last_metrics_at: null }).execute();
      await transaction.updateTable("servers").set({ hostname: input.hostname, public_address: input.publicAddress || requestIp, status: "REGISTERED", updated_at: new Date() }).where("id", "=", token.serverId).execute();
      const existingXray = await transaction.selectFrom("xray_instances").select("id").where("server_id", "=", token.serverId).executeTakeFirst();
      if (!existingXray) await transaction.insertInto("xray_instances").values({ server_id: token.serverId, version: null, status: "unknown", config_valid: null, last_restart_at: null, uptime_seconds: null, updated_at: new Date() }).execute();
      await transaction.insertInto("audit_logs").values({ severity: "info", category: "SERVER", actor_id: null, actor_role: null, tenant_id: token.tenantId, server_id: token.serverId, ip: requestIp, action: "SERVER_AGENT_REGISTERED", message: "Server agent exchanged a one-time join token", target_type: "server", target_id: token.serverId, request_id: null, metadata: { keyId, agentVersion: input.agentVersion } }).execute();
      return { serverId: token.serverId, serverName: token.displayName, credential, keyId };
    });
  }

  async heartbeat(credential: string, input: AgentHeartbeatInput, requestIp: string | null) {
    if (!credential.startsWith("nra_") || credential.length < 60) throw new ApiError(401, "AGENT_AUTH_REQUIRED", "Valid Agent authentication is required");
    if (Math.abs(Date.now() - Date.parse(input.timestamp)) > 300_000) throw new ApiError(401, "AGENT_REQUEST_EXPIRED", "Agent request expired");
    return this.database.transaction().execute(async (transaction) => {
      const agent = await transaction.selectFrom("server_agents").innerJoin("servers", "servers.id", "server_agents.server_id")
        .select(["server_agents.id", "server_agents.server_id as serverId", "server_agents.status as agentStatus", "servers.status as serverStatus", "servers.tenant_id as tenantId"])
        .where("server_agents.credential_hash", "=", hashServerSecret(credential)).where("server_agents.status", "!=", "REVOKED").forUpdate().executeTakeFirst();
      if (!agent) throw new ApiError(401, "AGENT_CREDENTIAL_INVALID", "Agent credential is invalid or revoked");
      const replay = await transaction.selectFrom("agent_request_nonces").select("request_id").where("request_id", "=", input.requestId).executeTakeFirst();
      if (replay) throw new ApiError(409, "AGENT_REPLAY_DETECTED", "Agent request replay detected");
      await transaction.insertInto("agent_request_nonces").values({ request_id: input.requestId, server_id: agent.serverId }).execute();
      await transaction.deleteFrom("agent_request_nonces").where("received_at", "<", new Date(Date.now() - 86_400_000)).execute();
      const now = new Date();
      const nextStatus = nextHeartbeatStatus(agent.serverStatus, input.health);
      const metricValues = {
        server_id: agent.serverId, sampled_at: new Date(input.timestamp), cpu_usage: input.cpu.usage === null ? null : String(input.cpu.usage), cpu_cores: input.cpu.cores,
        ram_used: input.ram.used === null ? null : String(input.ram.used), ram_total: input.ram.total === null ? null : String(input.ram.total), swap_used: input.swap.used === null ? null : String(input.swap.used), swap_total: input.swap.total === null ? null : String(input.swap.total),
        storage_used: input.storage.used === null ? null : String(input.storage.used), storage_total: input.storage.total === null ? null : String(input.storage.total), load_1: input.load[0] === null ? null : String(input.load[0]), load_5: input.load[1] === null ? null : String(input.load[1]), load_15: input.load[2] === null ? null : String(input.load[2]),
        uptime_seconds: input.uptimeSeconds === null ? null : String(input.uptimeSeconds), network_rx_rate: input.network.rxRate === null ? null : String(input.network.rxRate), network_tx_rate: input.network.txRate === null ? null : String(input.network.txRate), network_rx_total: input.network.rxTotal === null ? null : String(input.network.rxTotal), network_tx_total: input.network.txTotal === null ? null : String(input.network.txTotal),
        tcp_connections: input.connections.tcp, udp_connections: input.connections.udp, process_count: input.processCount, hostname: input.system.hostname, os_name: input.system.os, kernel: input.system.kernel, architecture: input.system.architecture, ipv4: input.system.ipv4, ipv6: input.system.ipv6,
        agent_version: input.agentVersion, agent_health: input.health, xray_status: input.xray.status, xray_version: input.xray.version, xray_uptime_seconds: input.xray.uptimeSeconds === null ? null : String(input.xray.uptimeSeconds), xray_config_valid: input.xray.configValid, payload: {},
      };
      await transaction.insertInto("server_metrics_latest").values(metricValues).onConflict((conflict) => conflict.column("server_id").doUpdateSet(metricValues)).execute();
      await transaction.updateTable("server_agents").set({ status: input.health === "ONLINE" ? "ONLINE" : "ERROR", version: input.agentVersion, last_heartbeat_at: now, last_metrics_at: new Date(input.timestamp) }).where("id", "=", agent.id).execute();
      await transaction.updateTable("servers").set({ hostname: input.system.hostname, ipv4: input.system.ipv4, ipv6: input.system.ipv6, public_address: requestIp, last_metrics_at: new Date(input.timestamp), status: nextStatus, updated_at: now }).where("id", "=", agent.serverId).execute();
      await transaction.updateTable("xray_instances").set({ version: input.xray.version, status: input.xray.status, config_valid: input.xray.configValid, uptime_seconds: input.xray.uptimeSeconds === null ? null : String(input.xray.uptimeSeconds), updated_at: now }).where("server_id", "=", agent.serverId).execute();
      await transaction.insertInto("traffic_samples").values({ server_id: agent.serverId, rx_bytes: String(input.network.rxTotal ?? 0), tx_bytes: String(input.network.txTotal ?? 0), cpu_percent: input.cpu.usage === null ? null : String(input.cpu.usage), ram_bytes: input.ram.used === null ? null : String(input.ram.used) }).execute();
      return { serverId: agent.serverId, status: nextStatus, acceptedAt: now.toISOString() };
    });
  }

  async agentStatus(credential: string) {
    if (!credential.startsWith("nra_")) throw new ApiError(401, "AGENT_AUTH_REQUIRED", "Valid Agent authentication is required");
    const row = await this.database.selectFrom("server_agents").innerJoin("servers", "servers.id", "server_agents.server_id").leftJoin("xray_instances", "xray_instances.server_id", "servers.id").select(["servers.id as serverId", "servers.display_name as serverName", "servers.status", "server_agents.version as agentVersion", "server_agents.last_heartbeat_at as lastHeartbeatAt", "xray_instances.status as xrayStatus"]).where("server_agents.credential_hash", "=", hashServerSecret(credential)).where("server_agents.status", "!=", "REVOKED").executeTakeFirst();
    if (!row) throw new ApiError(401, "AGENT_CREDENTIAL_INVALID", "Agent credential is invalid or revoked");
    return { ...row, lastHeartbeatAt: iso(row.lastHeartbeatAt) };
  }

  async list(auth: AuthContext): Promise<ServerSummary[]> {
    let query = this.database.selectFrom("servers").leftJoin("server_agents", "server_agents.server_id", "servers.id").leftJoin("server_metrics_latest", "server_metrics_latest.server_id", "servers.id").leftJoin("xray_instances", "xray_instances.server_id", "servers.id")
      .select(["servers.id", "servers.display_name as displayName", "servers.role", "servers.country", "servers.region", "servers.provider", "servers.description", "servers.status", "servers.hostname", "servers.public_address as publicAddress", "servers.ipv4", "servers.ipv6", "servers.created_at as createdAt", "servers.last_metrics_at as lastMetricsAt", "server_agents.status as agentStatus", "server_agents.version as agentVersion", "server_agents.last_heartbeat_at as lastHeartbeatAt", "server_metrics_latest.sampled_at as sampledAt", "server_metrics_latest.cpu_usage as cpuUsage", "server_metrics_latest.cpu_cores as cpuCores", "server_metrics_latest.ram_used as ramUsed", "server_metrics_latest.ram_total as ramTotal", "server_metrics_latest.swap_used as swapUsed", "server_metrics_latest.swap_total as swapTotal", "server_metrics_latest.storage_used as storageUsed", "server_metrics_latest.storage_total as storageTotal", "server_metrics_latest.load_1 as load1", "server_metrics_latest.load_5 as load5", "server_metrics_latest.load_15 as load15", "server_metrics_latest.uptime_seconds as uptimeSeconds", "server_metrics_latest.network_rx_rate as rxRate", "server_metrics_latest.network_tx_rate as txRate", "server_metrics_latest.network_rx_total as rxTotal", "server_metrics_latest.network_tx_total as txTotal", "server_metrics_latest.tcp_connections as tcp", "server_metrics_latest.udp_connections as udp", "server_metrics_latest.process_count as processCount", "server_metrics_latest.os_name as os", "server_metrics_latest.kernel", "server_metrics_latest.architecture", "xray_instances.status as xrayStatus", "xray_instances.version as xrayVersion"]);
    if (auth.role !== ROLES.OWNER) query = auth.tenantIds.length ? query.where("servers.tenant_id", "in", auth.tenantIds) : query.where("servers.tenant_id", "=", auth.primaryTenantId);
    const rows = await query.orderBy("servers.created_at", "desc").execute();
    return rows.map((row) => {
      const stale = !row.lastHeartbeatAt || Date.now() - row.lastHeartbeatAt.getTime() > 90_000;
      const pending = ["PENDING_INSTALL", "REGISTERED", "CONNECTING"].includes(row.status);
      const status: ServerLifecycleStatus = !pending && stale && row.status !== "REVOKED" ? "OFFLINE" : row.status;
      const metrics = row.sampledAt ? { sampledAt: row.sampledAt.toISOString(), cpu: { usage: numberOrNull(row.cpuUsage), cores: row.cpuCores }, ram: { used: row.ramUsed, total: row.ramTotal }, swap: { used: row.swapUsed, total: row.swapTotal }, storage: { used: row.storageUsed, total: row.storageTotal }, load: [numberOrNull(row.load1), numberOrNull(row.load5), numberOrNull(row.load15)] as [number | null, number | null, number | null], uptimeSeconds: row.uptimeSeconds, network: { rxRate: row.rxRate, txRate: row.txRate, rxTotal: row.rxTotal, txTotal: row.txTotal }, connections: { tcp: row.tcp, udp: row.udp }, processCount: row.processCount } : null;
      return { id: row.id, displayName: row.displayName, role: row.role, country: row.country, region: row.region, provider: row.provider, description: row.description, status, dataState: status === "ONLINE" && !stale ? "LIVE" : status === "ERROR" ? "ERROR" : "DISCONNECTED", hostname: row.hostname, publicAddress: row.publicAddress, ipv4: row.ipv4, ipv6: row.ipv6, os: row.os, kernel: row.kernel, architecture: row.architecture, agentVersion: row.agentVersion, agentStatus: row.agentStatus ?? "PENDING", xrayStatus: (row.xrayStatus?.toUpperCase() as ServerSummary["xrayStatus"]) || "UNKNOWN", xrayVersion: row.xrayVersion, lastHeartbeatAt: iso(row.lastHeartbeatAt), lastMetricsAt: iso(row.lastMetricsAt), metrics, createdAt: row.createdAt.toISOString() };
    });
  }
}

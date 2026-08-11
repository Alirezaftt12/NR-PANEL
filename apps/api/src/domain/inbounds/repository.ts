import { randomBytes, randomUUID } from "node:crypto";
import { ROLES, type InboundClientSummary, type InboundSecurityConfig, type InboundServerOption, type InboundSummary } from "@nr/shared";
import { sql } from "kysely";
import type { AuthContext } from "../identity.js";
import type { Database } from "../../database/client.js";
import { ApiError } from "../../lib/errors.js";
import { credentialPreview, decryptCredential, encryptCredential } from "./credential-vault.js";
import type { DesiredInbound } from "./model.js";
import type { InboundClientWriteInput, InboundWriteInput } from "./schemas.js";

export type ApplyRevisionInput = {
  inboundId: string; tenantId: string; desiredRevision: number; strategy: "NOOP" | "HOT_CLIENTS" | "HOT_INBOUND" | "RESTART_REQUIRED";
  desiredHash: string; previousHash: string | null; actorId: string;
};

export interface InboundRepository {
  list(auth: AuthContext): Promise<InboundSummary[]>;
  serverOptions(auth: AuthContext): Promise<InboundServerOption[]>;
  getDesired(id: string, auth: AuthContext): Promise<DesiredInbound>;
  getInstanceDesired(instanceId: string): Promise<DesiredInbound[]>;
  create(input: InboundWriteInput, auth: AuthContext): Promise<DesiredInbound>;
  update(id: string, input: InboundWriteInput, auth: AuthContext): Promise<DesiredInbound>;
  duplicate(id: string, auth: AuthContext): Promise<DesiredInbound>;
  createClient(inboundId: string, input: InboundClientWriteInput, auth: AuthContext): Promise<DesiredInbound>;
  rotateClient(inboundId: string, clientId: string, credential: string, auth: AuthContext): Promise<DesiredInbound>;
  deleteClient(inboundId: string, clientId: string, auth: AuthContext): Promise<DesiredInbound>;
  setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<DesiredInbound>;
  markPending(id: string, auth: AuthContext): Promise<void>;
  remove(id: string, auth: AuthContext): Promise<void>;
  deleteExpired(inboundId: string | null, auth: AuthContext): Promise<string[]>;
  resetTraffic(inboundId: string | null, clientId: string | null, target: "INBOUND" | "CLIENT", auth: AuthContext): Promise<number>;
  saveBackup(inbound: DesiredInbound, config: unknown, hash: string, actorId: string): Promise<string>;
  beginApply(input: ApplyRevisionInput): Promise<string>;
  attachBackup(revisionId: string, backupId: string): Promise<void>;
  markApplySuccess(inboundId: string, revisionId: string, desiredRevision: number): Promise<void>;
  markApplyFailure(inboundId: string, revisionId: string, code: string, message: string, rolledBack: boolean, validationErrors?: string[]): Promise<void>;
}

function tenantScope(auth: AuthContext) { return auth.role === ROLES.OWNER ? null : auth.tenantIds; }
function iso(value: Date | string | null) { return value ? new Date(value).toISOString() : null; }
function asObject<T>(value: unknown) { return value as T; }
function storedSecurityConfig(config: InboundSecurityConfig) {
  if (config.kind !== "REALITY") return config;
  const { privateKey, ...safe } = config;
  return { ...safe, privateKeyCiphertext: encryptCredential(privateKey) };
}
function loadedSecurityConfig(value: unknown): InboundSecurityConfig {
  const record = value as Record<string, unknown>;
  if (record.kind !== "REALITY" || typeof record.privateKeyCiphertext !== "string") return value as InboundSecurityConfig;
  const { privateKeyCiphertext, ...safe } = record;
  return { ...safe, kind: "REALITY", privateKey: decryptCredential(privateKeyCiphertext) } as InboundSecurityConfig;
}

export class KyselyInboundRepository implements InboundRepository {
  constructor(private readonly database: Database) {}

  private async baseRows(auth: AuthContext, id?: string) {
    const scope = tenantScope(auth);
    if (scope && scope.length === 0) return [];
    let query = this.database.selectFrom("inbounds")
      .innerJoin("xray_instances", "xray_instances.id", "inbounds.xray_instance_id")
      .innerJoin("servers", "servers.id", "xray_instances.server_id")
      .select([
        "inbounds.id", "inbounds.xray_instance_id as xrayInstanceId", "inbounds.tenant_id as tenantId", "servers.id as serverId", "servers.display_name as serverName",
        "inbounds.name", "inbounds.tag", "inbounds.listen_ip as listenIp", "inbounds.port", "inbounds.protocol", "inbounds.transport", "inbounds.security", "inbounds.enabled",
        "inbounds.protocol_config as protocolConfig", "inbounds.transport_config as transportConfig", "inbounds.security_config as securityConfig", "inbounds.sniffing_config as sniffing",
        "inbounds.sockopt_config as sockopt", "inbounds.fallbacks_config as fallbacks", "inbounds.routing_config as routing", "inbounds.advanced_config as advancedConfig",
        "inbounds.traffic_limit as trafficLimit", "inbounds.traffic_used as trafficUsed", "inbounds.expires_at as expiresAt", "inbounds.desired_revision as desiredRevision",
        "inbounds.applied_revision as appliedRevision", "inbounds.apply_status as applyStatus", "inbounds.last_apply_error as lastApplyError",
      ]);
    if (id) query = query.where("inbounds.id", "=", id);
    if (scope) query = query.where("inbounds.tenant_id", "in", scope);
    return query.orderBy("inbounds.created_at", "desc").execute();
  }

  private async clientRows(inboundIds: string[]) {
    if (inboundIds.length === 0) return [];
    return this.database.selectFrom("inbound_clients")
      .innerJoin("vpn_users", "vpn_users.id", "inbound_clients.vpn_user_id")
      .select([
        "inbound_clients.id", "inbound_clients.inbound_id as inboundId", "inbound_clients.vpn_user_id as userId", "vpn_users.display_name as name", "vpn_users.email",
        "vpn_users.uuid as publicId", "inbound_clients.credential_ciphertext as credentialCiphertext", "inbound_clients.flow", "inbound_clients.enabled",
        "inbound_clients.traffic_limit as trafficLimit", "inbound_clients.traffic_used as trafficUsed", "inbound_clients.expires_at as expiresAt", "vpn_users.subscription_enabled as subscriptionEnabled",
      ])
      .where("inbound_clients.inbound_id", "in", inboundIds).orderBy("inbound_clients.created_at", "asc").execute();
  }

  private clientSummary(row: Awaited<ReturnType<KyselyInboundRepository["clientRows"]>>[number]): InboundClientSummary {
    const credential = decryptCredential(row.credentialCiphertext);
    const expiresAt = iso(row.expiresAt);
    return {
      id: row.id, userId: row.userId, name: row.name, email: row.email, publicId: row.publicId, credentialPreview: credentialPreview(credential),
      enabled: row.enabled, trafficLimit: row.trafficLimit, trafficUsed: row.trafficUsed, expiresAt, subscriptionEnabled: row.subscriptionEnabled,
      expired: Boolean(expiresAt && Date.parse(expiresAt) <= Date.now()),
    };
  }

  async list(auth: AuthContext): Promise<InboundSummary[]> {
    const rows = await this.baseRows(auth);
    const clients = await this.clientRows(rows.map((row) => row.id));
    const byInbound = new Map<string, InboundClientSummary[]>();
    for (const row of clients) byInbound.set(row.inboundId, [...(byInbound.get(row.inboundId) || []), this.clientSummary(row)]);
    return rows.map((row) => {
      const inboundClients = byInbound.get(row.id) || [];
      return {
        id: row.id, tenantId: row.tenantId, serverId: row.serverId, serverName: row.serverName, name: row.name, tag: row.tag, listenIp: row.listenIp, port: row.port,
        protocol: row.protocol, transport: row.transport, security: row.security, enabled: row.enabled, trafficLimit: row.trafficLimit, trafficUsed: row.trafficUsed,
        expiresAt: iso(row.expiresAt), desiredRevision: row.desiredRevision, appliedRevision: row.appliedRevision, applyStatus: row.applyStatus, lastApplyError: row.lastApplyError,
        clientCount: inboundClients.length, activeClientCount: inboundClients.filter((client) => client.enabled && !client.expired).length, clients: inboundClients,
      };
    });
  }

  async serverOptions(auth: AuthContext): Promise<InboundServerOption[]> {
    const scope = tenantScope(auth);
    if (scope && scope.length === 0) return [];
    let query = this.database.selectFrom("servers").leftJoin("xray_instances", "xray_instances.server_id", "servers.id")
      .select(["servers.id", "servers.display_name as name", "servers.status", "xray_instances.version as xrayVersion"]);
    if (scope) query = query.where("servers.tenant_id", "in", scope);
    return query.orderBy("servers.display_name", "asc").execute();
  }

  async getDesired(id: string, auth: AuthContext): Promise<DesiredInbound> {
    const row = (await this.baseRows(auth, id))[0];
    if (!row) throw new ApiError(404, "INBOUND_NOT_FOUND", "Inbound not found");
    const clientRows = await this.clientRows([id]);
    const clients = clientRows.map((client) => ({
      id: client.id, userId: client.userId, name: client.name, email: client.email, publicId: client.publicId, credential: decryptCredential(client.credentialCiphertext), flow: client.flow,
      enabled: client.enabled, trafficLimit: client.trafficLimit, trafficUsed: client.trafficUsed, expiresAt: iso(client.expiresAt), subscriptionEnabled: client.subscriptionEnabled,
    }));
    const detail: DesiredInbound = {
      id: row.id, xrayInstanceId: row.xrayInstanceId, tenantId: row.tenantId, serverId: row.serverId, serverName: row.serverName, name: row.name, tag: row.tag, listenIp: row.listenIp,
      port: row.port, protocol: row.protocol, transport: row.transport, security: row.security, enabled: row.enabled, trafficLimit: row.trafficLimit, trafficUsed: row.trafficUsed,
      expiresAt: iso(row.expiresAt), desiredRevision: row.desiredRevision, appliedRevision: row.appliedRevision, applyStatus: row.applyStatus, lastApplyError: row.lastApplyError,
      protocolConfig: asObject(row.protocolConfig), transportConfig: asObject(row.transportConfig), securityConfig: loadedSecurityConfig(row.securityConfig), sniffing: asObject(row.sniffing),
      sockopt: asObject(row.sockopt), fallbacks: asObject(row.fallbacks), routing: asObject(row.routing), advancedConfig: asObject(row.advancedConfig), clients,
    };
    return detail;
  }

  async getInstanceDesired(instanceId: string) {
    const ids = await this.database.selectFrom("inbounds").select("id").where("xray_instance_id", "=", instanceId).orderBy("created_at", "asc").execute();
    const systemAuth: AuthContext = { userId: "system", username: "system", email: null, role: ROLES.OWNER, permissions: [], primaryTenantId: "system", tenantIds: [], sessionId: "system", sessionExpiresAt: new Date(0).toISOString() };
    return Promise.all(ids.map((row) => this.getDesired(row.id, systemAuth)));
  }

  async create(input: InboundWriteInput, auth: AuthContext) {
    const scope = tenantScope(auth);
    const created = await this.database.transaction().execute(async (transaction) => {
      let serverQuery = transaction.selectFrom("servers").select(["id", "tenant_id as tenantId", "display_name as serverName"]).where("id", "=", input.serverId);
      if (scope) {
        if (scope.length === 0) throw new ApiError(404, "SERVER_NOT_FOUND", "Server not found");
        serverQuery = serverQuery.where("tenant_id", "in", scope);
      }
      const server = await serverQuery.executeTakeFirst();
      if (!server) throw new ApiError(404, "SERVER_NOT_FOUND", "Server not found");
      let instance = await transaction.selectFrom("xray_instances").select("id").where("server_id", "=", server.id).executeTakeFirst();
      instance ??= await transaction.insertInto("xray_instances").values({ server_id: server.id, version: null, status: "unknown", config_valid: null, last_restart_at: null, uptime_seconds: null, updated_at: new Date() }).returning("id").executeTakeFirstOrThrow();
      const row = await transaction.insertInto("inbounds").values({
        xray_instance_id: instance.id, tenant_id: server.tenantId, name: input.name, tag: input.tag, listen_ip: input.listenIp, protocol: input.protocol, port: input.port, enabled: input.enabled,
        transport: input.transport, security: input.security, settings: {}, protocol_config: input.protocolConfig, transport_config: input.transportConfig, security_config: storedSecurityConfig(input.securityConfig),
        sniffing_config: input.sniffing, sockopt_config: input.sockopt, fallbacks_config: input.fallbacks, routing_config: input.routing, advanced_config: input.advancedConfig,
        traffic_limit: input.trafficLimit, expires_at: input.expiresAt, desired_revision: 1, applied_revision: null, apply_status: "PENDING", last_apply_error: null,
        traffic_used: "0", created_by: auth.userId, updated_at: new Date(),
      }).returning("id").executeTakeFirstOrThrow();
      return row.id;
    });
    return this.getDesired(created, auth);
  }

  async update(id: string, input: InboundWriteInput, auth: AuthContext) {
    await this.getDesired(id, auth);
    await this.database.updateTable("inbounds").set({
      name: input.name, tag: input.tag, listen_ip: input.listenIp, protocol: input.protocol, port: input.port, enabled: input.enabled, transport: input.transport, security: input.security,
      protocol_config: input.protocolConfig, transport_config: input.transportConfig, security_config: storedSecurityConfig(input.securityConfig), sniffing_config: input.sniffing, sockopt_config: input.sockopt,
      fallbacks_config: input.fallbacks, routing_config: input.routing, advanced_config: input.advancedConfig, traffic_limit: input.trafficLimit, expires_at: input.expiresAt,
      desired_revision: sql<number>`desired_revision + 1`, apply_status: "PENDING", last_apply_error: null, updated_at: new Date(),
    }).where("id", "=", id).executeTakeFirstOrThrow();
    return this.getDesired(id, auth);
  }

  async duplicate(id: string, auth: AuthContext) {
    const source = await this.getDesired(id, auth);
    const usedPorts = new Set((await this.database.selectFrom("inbounds").select("port").where("xray_instance_id", "=", source.xrayInstanceId).execute()).map((row) => row.port));
    let port = source.port === 65_535 ? 1 : source.port + 1;
    while (usedPorts.has(port) && port !== source.port) port = port === 65_535 ? 1 : port + 1;
    if (usedPorts.has(port)) throw new ApiError(409, "NO_AVAILABLE_PORT", "No available port exists for the duplicated inbound");
    const input: InboundWriteInput = {
      serverId: source.serverId, name: `${source.name} (کپی)`, tag: `${source.tag}-copy-${randomBytes(3).toString("hex")}`, listenIp: source.listenIp, port,
      protocol: source.protocol, transport: source.transport, security: source.security, enabled: false, protocolConfig: source.protocolConfig, transportConfig: source.transportConfig,
      securityConfig: source.securityConfig, sniffing: source.sniffing, sockopt: source.sockopt, fallbacks: source.fallbacks, routing: source.routing,
      trafficLimit: source.trafficLimit, expiresAt: source.expiresAt, advancedConfig: source.advancedConfig,
    };
    return this.create(input, auth);
  }

  private generatedCredential(protocol: DesiredInbound["protocol"]) {
    return protocol === "VLESS" || protocol === "VMess" ? randomUUID() : randomBytes(32).toString("base64");
  }

  async createClient(inboundId: string, input: InboundClientWriteInput, auth: AuthContext) {
    const inbound = await this.getDesired(inboundId, auth);
    const credential = input.credential || this.generatedCredential(inbound.protocol);
    await this.database.transaction().execute(async (transaction) => {
      const user = await transaction.insertInto("vpn_users").values({
        tenant_id: inbound.tenantId, server_id: inbound.serverId, created_by: auth.userId, username: `${input.name}-${randomBytes(4).toString("hex")}`,
        display_name: input.name, email: input.email, uuid: randomUUID(), protocol: inbound.protocol, traffic_limit: input.trafficLimit, traffic_used: "0", expires_at: input.expiresAt,
        enabled: input.enabled, subscription_enabled: input.subscriptionEnabled, updated_at: new Date(),
      }).returning("id").executeTakeFirstOrThrow();
      await transaction.insertInto("inbound_clients").values({
        inbound_id: inbound.id, vpn_user_id: user.id, tenant_id: inbound.tenantId, credential_ciphertext: encryptCredential(credential), flow: input.flow, enabled: input.enabled,
        traffic_limit: input.trafficLimit, traffic_used: "0", expires_at: input.expiresAt, created_by: auth.userId, updated_at: new Date(),
      }).execute();
      await transaction.updateTable("inbounds").set({ desired_revision: sql<number>`desired_revision + 1`, apply_status: "PENDING", last_apply_error: null, updated_at: new Date() }).where("id", "=", inbound.id).execute();
    });
    return this.getDesired(inboundId, auth);
  }

  async rotateClient(inboundId: string, clientId: string, credential: string, auth: AuthContext) {
    await this.getDesired(inboundId, auth);
    const result = await this.database.updateTable("inbound_clients").set({ credential_ciphertext: encryptCredential(credential), updated_at: new Date() }).where("id", "=", clientId).where("inbound_id", "=", inboundId).executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw new ApiError(404, "CLIENT_NOT_FOUND", "Client not found");
    await this.markPending(inboundId, auth);
    return this.getDesired(inboundId, auth);
  }

  async deleteClient(inboundId: string, clientId: string, auth: AuthContext) {
    await this.getDesired(inboundId, auth);
    const client = await this.database.selectFrom("inbound_clients").select("vpn_user_id as userId").where("id", "=", clientId).where("inbound_id", "=", inboundId).executeTakeFirst();
    if (!client) throw new ApiError(404, "CLIENT_NOT_FOUND", "Client not found");
    await this.database.deleteFrom("vpn_users").where("id", "=", client.userId).execute();
    await this.markPending(inboundId, auth);
    return this.getDesired(inboundId, auth);
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext) {
    await this.getDesired(id, auth);
    await this.database.updateTable("inbounds").set({ enabled, desired_revision: sql<number>`desired_revision + 1`, apply_status: "PENDING", last_apply_error: null, updated_at: new Date() }).where("id", "=", id).execute();
    return this.getDesired(id, auth);
  }

  async markPending(id: string, auth: AuthContext) {
    await this.getDesired(id, auth);
    await this.database.updateTable("inbounds").set({ desired_revision: sql<number>`desired_revision + 1`, apply_status: "PENDING", last_apply_error: null, updated_at: new Date() }).where("id", "=", id).execute();
  }

  async remove(id: string, auth: AuthContext) { await this.getDesired(id, auth); await this.database.deleteFrom("inbounds").where("id", "=", id).execute(); }

  async deleteExpired(inboundId: string | null, auth: AuthContext) {
    const inbounds = inboundId ? [await this.getDesired(inboundId, auth)] : await Promise.all((await this.list(auth)).map((entry) => this.getDesired(entry.id, auth)));
    const affected: string[] = [];
    for (const inbound of inbounds) {
      const expired = inbound.clients.filter((client) => client.expiresAt && Date.parse(client.expiresAt) <= Date.now());
      if (!expired.length) continue;
      await this.database.deleteFrom("vpn_users").where("id", "in", expired.map((client) => client.userId)).execute();
      await this.markPending(inbound.id, auth); affected.push(inbound.id);
    }
    return affected;
  }

  async resetTraffic(inboundId: string | null, clientId: string | null, target: "INBOUND" | "CLIENT", auth: AuthContext) {
    if (inboundId) await this.getDesired(inboundId, auth);
    if (clientId && inboundId) {
      const result = await this.database.updateTable("inbound_clients").set({ traffic_used: "0", updated_at: new Date() }).where("id", "=", clientId).where("inbound_id", "=", inboundId).executeTakeFirst();
      return Number(result.numUpdatedRows);
    }
    if (inboundId) {
      const result = target === "INBOUND"
        ? await this.database.updateTable("inbounds").set({ traffic_used: "0", updated_at: new Date() }).where("id", "=", inboundId).executeTakeFirst()
        : await this.database.updateTable("inbound_clients").set({ traffic_used: "0", updated_at: new Date() }).where("inbound_id", "=", inboundId).executeTakeFirst();
      return Number(result.numUpdatedRows);
    }
    const scope = tenantScope(auth);
    if (scope && scope.length === 0) return 0;
    if (target === "INBOUND") {
      let query = this.database.updateTable("inbounds").set({ traffic_used: "0", updated_at: new Date() });
      if (scope) query = query.where("tenant_id", "in", scope);
      return Number((await query.executeTakeFirst()).numUpdatedRows);
    }
    let query = this.database.updateTable("inbound_clients").set({ traffic_used: "0", updated_at: new Date() });
    if (scope) query = query.where("tenant_id", "in", scope);
    return Number((await query.executeTakeFirst()).numUpdatedRows);
  }

  async saveBackup(inbound: DesiredInbound, config: unknown, hash: string, actorId: string) {
    const result = await this.database.insertInto("xray_config_backups").values({ tenant_id: inbound.tenantId, xray_instance_id: inbound.xrayInstanceId, config_ciphertext: encryptCredential(JSON.stringify(config)), config_hash: hash, created_by: actorId }).returning("id").executeTakeFirstOrThrow();
    return result.id;
  }

  async beginApply(input: ApplyRevisionInput) {
    const result = await this.database.insertInto("inbound_apply_revisions").values({
      inbound_id: input.inboundId, tenant_id: input.tenantId, desired_revision: input.desiredRevision, strategy: input.strategy, status: "VALIDATING", desired_hash: input.desiredHash,
      previous_hash: input.previousHash, backup_id: null, validation_errors: [], error_code: null, error_message: null, completed_at: null, created_by: input.actorId,
    }).returning("id").executeTakeFirstOrThrow();
    await this.database.updateTable("inbounds").set({ apply_status: "APPLYING", last_apply_error: null, updated_at: new Date() }).where("id", "=", input.inboundId).execute();
    return result.id;
  }

  async attachBackup(revisionId: string, backupId: string) {
    await this.database.updateTable("inbound_apply_revisions").set({ backup_id: backupId, status: "APPLYING" }).where("id", "=", revisionId).execute();
  }

  async markApplySuccess(inboundId: string, revisionId: string, desiredRevision: number) {
    await this.database.transaction().execute(async (transaction) => {
      await transaction.updateTable("inbound_apply_revisions").set({ status: "APPLIED", completed_at: new Date() }).where("id", "=", revisionId).execute();
      await transaction.updateTable("inbounds").set({ apply_status: "APPLIED", applied_revision: desiredRevision, last_apply_error: null, updated_at: new Date() }).where("id", "=", inboundId).execute();
    });
  }

  async markApplyFailure(inboundId: string, revisionId: string, code: string, message: string, rolledBack: boolean, validationErrors: string[] = []) {
    await this.database.transaction().execute(async (transaction) => {
      await transaction.updateTable("inbound_apply_revisions").set({ status: rolledBack ? "ROLLED_BACK" : "FAILED", completed_at: new Date(), error_code: code, error_message: message, validation_errors: validationErrors }).where("id", "=", revisionId).execute();
      await transaction.updateTable("inbounds").set({ apply_status: rolledBack ? "ROLLED_BACK" : "FAILED", last_apply_error: message, updated_at: new Date() }).where("id", "=", inboundId).execute();
    });
  }
}

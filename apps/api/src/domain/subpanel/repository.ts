import { randomBytes, randomUUID } from "node:crypto";
import {
  ROLES,
  type InboundProtocol,
  type InboundSecurityConfig,
  type InboundTransportConfig,
  type MasterSubpanelOptions,
  type MasterSubpanelSummary,
  type SubpanelAssignedInbound,
  type SubpanelCapabilities,
  type SubpanelDashboardData,
  type SubpanelQuotaSnapshot,
  type SubpanelSettingsData,
  type SubpanelSubscriptionSummary,
  type SubpanelTrafficData,
  type SubpanelUserSummary,
  type SubpanelUsersPageData,
} from "@nr/shared";
import { sql, type Transaction } from "kysely";
import type { Database } from "../../database/client.js";
import type { SecurityDatabase } from "../../database/types.js";
import type { AuthContext } from "../identity.js";
import { ApiError } from "../../lib/errors.js";
import { environment } from "../../lib/environment.js";
import { createSubscriptionToken, hashSubscriptionToken } from "../../lib/security.js";
import { decryptCredential, encryptCredential } from "../inbounds/credential-vault.js";
import { generateClientUri, type AssignedInboundConfig } from "./config-generator.js";
import {
  assertCapability,
  assertCreateQuota,
  assertInboundAssigned,
  assertTenantActive,
  assertTrafficQuota,
  portalTenantId,
  resolveExpiration,
  type TenantQuotaState,
} from "./policy.js";
import type {
  MasterSubpanelCreateInput,
  MasterSubpanelPatchInput,
  PortalBulkActionInput,
  PortalSettingsPatchInput,
  PortalUserActionInput,
  PortalUserCreateInput,
  PortalUserPatchInput,
} from "./schemas.js";

type Executor = Database | Transaction<SecurityDatabase>;
export type PortalMutationResult = { affected: number; inboundIds: string[]; user?: SubpanelUserSummary; trafficTargets?: Array<{ inboundId: string; clientId: string }> };

type PortalSettingsRow = {
  panel_name: string;
  display_name: string;
  allowed_protocols: InboundProtocol[];
  allow_subscription: boolean;
  allow_traffic_reset: boolean;
  allow_extend: boolean;
  allow_credential_rotation: boolean;
  theme: "light" | "dark";
  language: "fa" | "en";
};

const iso = (value: Date | string | null) => value ? new Date(value).toISOString() : null;
const bigint = (value: string | number | bigint | null | undefined) => BigInt(value ?? 0);
const unique = <T>(values: T[]) => [...new Set(values)];

function capabilities(row: PortalSettingsRow): SubpanelCapabilities {
  return {
    subscription: row.allow_subscription,
    trafficReset: row.allow_traffic_reset,
    extend: row.allow_extend,
    credentialRotation: row.allow_credential_rotation,
  };
}

function generatedCredential(protocol: InboundProtocol) {
  return protocol === "VLESS" || protocol === "VMess" ? randomUUID() : randomBytes(32).toString("base64url");
}

function remaining(limit: string | null, used: string) {
  if (limit === null) return null;
  const result = bigint(limit) - bigint(used);
  return (result > 0n ? result : 0n).toString();
}

function quotaSnapshot(state: TenantQuotaState & { actualTrafficUsed: bigint; expiresAt: Date | null }): SubpanelQuotaSnapshot {
  const remainingUsers = state.userLimit === null ? null : Math.max(0, state.userLimit - state.createdUsers);
  const remainingTraffic = state.trafficCredit === null ? null : state.trafficCredit - state.allocatedTraffic;
  return {
    userLimit: state.userLimit,
    createdUsers: state.createdUsers,
    remainingUsers,
    trafficCredit: state.trafficCredit?.toString() ?? null,
    allocatedTraffic: state.allocatedTraffic.toString(),
    remainingAllocatableTraffic: remainingTraffic === null ? null : (remainingTraffic > 0n ? remainingTraffic : 0n).toString(),
    actualTrafficUsed: state.actualTrafficUsed.toString(),
    expiresAt: iso(state.expiresAt),
    status: state.expiresAt && state.expiresAt <= new Date() ? "EXPIRED" : state.status,
  };
}

function auditValues(input: {
  auth: AuthContext;
  tenantId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  requestId: string;
  ip: string | null;
  message: string;
  metadata?: Record<string, unknown>;
  severity?: "info" | "warning";
}) {
  return {
    severity: input.severity ?? "info" as const,
    category: "SUB_PANEL" as const,
    actor_id: input.auth.userId,
    actor_role: input.auth.role,
    tenant_id: input.tenantId,
    server_id: null,
    ip: input.ip,
    action: input.action,
    message: input.message,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    request_id: input.requestId,
    metadata: input.metadata ?? {},
  };
}

export class KyselySubpanelRepository {
  constructor(private readonly database: Database) {}

  private async settings(executor: Executor, tenantId: string) {
    const row = await executor.selectFrom("subpanel_settings").selectAll().where("tenant_id", "=", tenantId).executeTakeFirst();
    if (!row) throw new ApiError(403, "SUBPANEL_NOT_CONFIGURED", "The sub-panel has not been configured by the OWNER");
    return row;
  }

  private async quota(executor: Executor, tenantId: string, lock = false) {
    let tenantQuery = executor.selectFrom("tenants").select(["id", "status", "expires_at", "user_limit", "traffic_quota"]).where("id", "=", tenantId);
    if (lock) tenantQuery = tenantQuery.forUpdate();
    const tenant = await tenantQuery.executeTakeFirst();
    if (!tenant) throw new ApiError(403, "SUBPANEL_TENANT_REQUIRED", "Sub-panel tenant not found");
    const totals = await executor.selectFrom("vpn_users")
      .select(({ fn }) => [
        fn.countAll<number>().as("createdUsers"),
        fn.coalesce(fn.sum<string>("traffic_limit"), sql<string>`0`).as("allocatedTraffic"),
        fn.coalesce(fn.sum<string>("traffic_used"), sql<string>`0`).as("actualTrafficUsed"),
      ])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirstOrThrow();
    return {
      status: tenant.status,
      expiresAt: tenant.expires_at,
      userLimit: tenant.user_limit,
      trafficCredit: tenant.traffic_quota === null ? null : bigint(tenant.traffic_quota),
      createdUsers: Number(totals.createdUsers),
      allocatedTraffic: bigint(totals.allocatedTraffic),
      actualTrafficUsed: bigint(totals.actualTrafficUsed),
    };
  }

  private async assignedInbounds(executor: Executor, tenantId: string): Promise<SubpanelAssignedInbound[]> {
    const rows = await executor.selectFrom("subpanel_inbound_assignments")
      .innerJoin("inbounds", "inbounds.id", "subpanel_inbound_assignments.inbound_id")
      .innerJoin("xray_instances", "xray_instances.id", "inbounds.xray_instance_id")
      .innerJoin("servers", "servers.id", "xray_instances.server_id")
      .select(["inbounds.id", "inbounds.name", "inbounds.tag", "inbounds.protocol", "inbounds.enabled", "servers.id as serverId", "servers.display_name as serverName"])
      .where("subpanel_inbound_assignments.tenant_id", "=", tenantId)
      .orderBy("servers.display_name").orderBy("inbounds.name").execute();
    return Promise.all(rows.map(async (row) => {
      const aggregate = await executor.selectFrom("inbound_clients")
        .select(({ fn }) => [fn.countAll<number>().as("count"), fn.coalesce(fn.sum<string>("traffic_used"), sql<string>`0`).as("trafficUsed")])
        .where("tenant_id", "=", tenantId).where("inbound_id", "=", row.id).executeTakeFirstOrThrow();
      return { ...row, userCount: Number(aggregate.count), trafficUsed: String(aggregate.trafficUsed) };
    }));
  }

  private async users(executor: Executor, tenantId: string, userIds?: string[]): Promise<SubpanelUserSummary[]> {
    if (userIds?.length === 0) return [];
    let query = executor.selectFrom("inbound_clients")
      .innerJoin("vpn_users", "vpn_users.id", "inbound_clients.vpn_user_id")
      .innerJoin("subpanel_inbound_assignments", (join) => join.onRef("subpanel_inbound_assignments.inbound_id", "=", "inbound_clients.inbound_id").on("subpanel_inbound_assignments.tenant_id", "=", tenantId))
      .innerJoin("inbounds", "inbounds.id", "inbound_clients.inbound_id")
      .innerJoin("xray_instances", "xray_instances.id", "inbounds.xray_instance_id")
      .innerJoin("servers", "servers.id", "xray_instances.server_id")
      .leftJoin("configs", (join) => join.onRef("configs.vpn_user_id", "=", "vpn_users.id").on("configs.revoked_at", "is", null))
      .leftJoin("subscriptions", (join) => join.onRef("subscriptions.vpn_user_id", "=", "vpn_users.id").on("subscriptions.revoked_at", "is", null))
      .select([
        "vpn_users.id", "inbound_clients.id as clientId", "inbounds.id as inboundId", "inbounds.name as inboundName", "servers.id as serverId", "servers.display_name as serverName",
        "vpn_users.username", "vpn_users.display_name as displayName", "vpn_users.protocol", "vpn_users.enabled", "vpn_users.traffic_limit as trafficLimit",
        "vpn_users.traffic_used as trafficUsed", "vpn_users.expires_at as expiresAt", "vpn_users.subscription_enabled as subscriptionEnabled", "vpn_users.created_at as createdAt",
        "configs.id as configId", "subscriptions.id as subscriptionId", "subscriptions.enabled as storedSubscriptionEnabled",
      ])
      .where("vpn_users.tenant_id", "=", tenantId)
      .where("inbound_clients.tenant_id", "=", tenantId);
    if (userIds) query = query.where("vpn_users.id", "in", userIds);
    const rows = await query.orderBy("vpn_users.created_at", "desc").execute();
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id, clientId: row.clientId, inboundId: row.inboundId, inboundName: row.inboundName, serverId: row.serverId, serverName: row.serverName,
      username: row.username, displayName: row.displayName, protocol: row.protocol, enabled: row.enabled, trafficLimit: row.trafficLimit,
      trafficUsed: row.trafficUsed, remainingTraffic: remaining(row.trafficLimit, row.trafficUsed), expiresAt: iso(row.expiresAt),
      expired: Boolean(row.expiresAt && new Date(row.expiresAt).getTime() <= now), subscriptionEnabled: row.subscriptionEnabled && Boolean(row.storedSubscriptionEnabled),
      configAvailable: Boolean(row.configId), subscriptionAvailable: Boolean(row.subscriptionId), createdAt: new Date(row.createdAt).toISOString(),
    }));
  }

  async dashboard(auth: AuthContext): Promise<SubpanelDashboardData> {
    const tenantId = portalTenantId(auth);
    const [settings, state, serverRows] = await Promise.all([
      this.settings(this.database, tenantId), this.quota(this.database, tenantId),
      this.database.selectFrom("subpanel_server_assignments")
        .innerJoin("servers", "servers.id", "subpanel_server_assignments.server_id")
        .leftJoin("xray_instances", "xray_instances.server_id", "servers.id")
        .select(["servers.id", "servers.display_name as name", "servers.hostname", "servers.status", "xray_instances.status as xrayStatus", "xray_instances.version as xrayVersion", "xray_instances.uptime_seconds as uptimeSeconds"])
        .where("subpanel_server_assignments.tenant_id", "=", tenantId).orderBy("servers.display_name").execute(),
    ]);
    const servers = await Promise.all(serverRows.map(async (server) => {
      const sample = await this.database.selectFrom("traffic_samples").select(["sampled_at", "rx_bytes", "tx_bytes", "cpu_percent", "ram_bytes"])
        .where("server_id", "=", server.id).orderBy("sampled_at", "desc").executeTakeFirst();
      const live = Boolean(sample && Date.now() - new Date(sample.sampled_at).getTime() < 120_000);
      return {
        ...server, dataState: live ? "LIVE" as const : "DISCONNECTED" as const, sampledAt: iso(sample?.sampled_at ?? null),
        cpuPercent: sample?.cpu_percent === null || sample?.cpu_percent === undefined ? null : Number(sample.cpu_percent), ramBytes: sample?.ram_bytes ?? null,
        storageBytes: null, rxBytes: sample?.rx_bytes ?? null, txBytes: sample?.tx_bytes ?? null,
      };
    }));
    return { panelName: settings.panel_name, quota: quotaSnapshot(state), capabilities: capabilities(settings), servers };
  }

  async usersPage(auth: AuthContext): Promise<SubpanelUsersPageData> {
    const tenantId = portalTenantId(auth);
    const [settings, state, assignedInbounds, users] = await Promise.all([
      this.settings(this.database, tenantId), this.quota(this.database, tenantId), this.assignedInbounds(this.database, tenantId), this.users(this.database, tenantId),
    ]);
    return { quota: quotaSnapshot(state), capabilities: capabilities(settings), assignedInbounds, users };
  }

  private async assignedInbound(executor: Executor, tenantId: string, inboundId: string) {
    const row = await executor.selectFrom("subpanel_inbound_assignments")
      .innerJoin("inbounds", "inbounds.id", "subpanel_inbound_assignments.inbound_id")
      .innerJoin("xray_instances", "xray_instances.id", "inbounds.xray_instance_id")
      .innerJoin("servers", "servers.id", "xray_instances.server_id")
      .select([
        "inbounds.id", "inbounds.name", "inbounds.protocol", "inbounds.port", "inbounds.enabled", "inbounds.protocol_config as protocolConfig",
        "inbounds.transport_config as transportConfig", "inbounds.security_config as securityConfig", "servers.id as serverId", "servers.hostname", "servers.ipv4",
      ])
      .where("subpanel_inbound_assignments.tenant_id", "=", tenantId).where("inbounds.id", "=", inboundId).executeTakeFirst();
    assertInboundAssigned(Boolean(row));
    if (!row) throw new ApiError(404, "INBOUND_NOT_ASSIGNED", "The selected inbound is not assigned to this sub-panel");
    if (!row.enabled) throw new ApiError(409, "INBOUND_DISABLED", "The assigned inbound is disabled");
    return row;
  }

  private async target(executor: Executor, tenantId: string, userId: string) {
    const row = await executor.selectFrom("vpn_users")
      .innerJoin("inbound_clients", (join) => join.onRef("inbound_clients.vpn_user_id", "=", "vpn_users.id").on("inbound_clients.tenant_id", "=", tenantId))
      .innerJoin("subpanel_inbound_assignments", (join) => join.onRef("subpanel_inbound_assignments.inbound_id", "=", "inbound_clients.inbound_id").on("subpanel_inbound_assignments.tenant_id", "=", tenantId))
      .select(["vpn_users.id", "vpn_users.traffic_limit as trafficLimit", "vpn_users.expires_at as expiresAt", "vpn_users.protocol", "vpn_users.display_name as displayName", "inbound_clients.id as clientId", "inbound_clients.inbound_id as inboundId"])
      .where("vpn_users.id", "=", userId).where("vpn_users.tenant_id", "=", tenantId).executeTakeFirst();
    if (!row) throw new ApiError(404, "SUBPANEL_USER_NOT_FOUND", "User not found");
    return row;
  }

  private configInput(inbound: Awaited<ReturnType<KyselySubpanelRepository["assignedInbound"]>>): AssignedInboundConfig {
    const storedSecurity = inbound.securityConfig as Record<string, unknown>;
    const security = storedSecurity.kind === "REALITY" && typeof storedSecurity.privateKeyCiphertext === "string"
      ? { ...storedSecurity, kind: "REALITY", privateKey: decryptCredential(storedSecurity.privateKeyCiphertext) } as unknown as InboundSecurityConfig
      : inbound.securityConfig as InboundSecurityConfig;
    return {
      name: inbound.name,
      protocol: inbound.protocol,
      host: inbound.hostname || inbound.ipv4 || "",
      port: inbound.port,
      transport: inbound.transportConfig as InboundTransportConfig,
      security,
      protocolConfig: inbound.protocolConfig as Record<string, unknown>,
    };
  }

  private async createSubscription(executor: Executor, tenantId: string, userId: string, expiresAt: Date | null) {
    const token = createSubscriptionToken();
    await executor.insertInto("subscriptions").values({
      tenant_id: tenantId, vpn_user_id: userId, token_hash: hashSubscriptionToken(token), token_ciphertext: encryptCredential(token),
      expires_at: expiresAt, revoked_at: null, last_access_at: null, enabled: true, rotated_at: new Date(),
    }).execute();
  }

  private async replaceConfig(executor: Executor, input: { tenantId: string; userId: string; clientId: string; serverId: string; protocol: InboundProtocol; expiresAt: Date | null; uri: string }) {
    await executor.updateTable("configs").set({ revoked_at: new Date() }).where("tenant_id", "=", input.tenantId).where("vpn_user_id", "=", input.userId).where("revoked_at", "is", null).execute();
    await executor.insertInto("configs").values({
      tenant_id: input.tenantId, vpn_user_id: input.userId, server_id: input.serverId, protocol: input.protocol, template_version: "nr-panel-v1",
      expires_at: input.expiresAt, revoked_at: null, inbound_client_id: input.clientId, config_ciphertext: encryptCredential(JSON.stringify({ version: 1, uri: input.uri })),
      share_uri_ciphertext: encryptCredential(input.uri), format: "URI",
    }).execute();
  }

  async createUser(auth: AuthContext, input: PortalUserCreateInput, request: { requestId: string; ip: string | null }): Promise<PortalMutationResult> {
    const tenantId = portalTenantId(auth);
    const userId = await this.database.transaction().execute(async (transaction) => {
      const [settings, state, inbound] = await Promise.all([
        this.settings(transaction, tenantId), this.quota(transaction, tenantId, true), this.assignedInbound(transaction, tenantId, input.inboundId),
      ]);
      if (!settings.allowed_protocols.includes(inbound.protocol)) throw new ApiError(403, "PROTOCOL_NOT_ALLOWED", "The OWNER has not enabled this protocol for the sub-panel");
      if (input.subscriptionEnabled) assertCapability(capabilities(settings), "subscription");
      assertCreateQuota(state, input.trafficLimit === null ? null : bigint(input.trafficLimit));
      const expiresAt = resolveExpiration(input, state.expiresAt);
      const credential = generatedCredential(inbound.protocol);
      const user = await transaction.insertInto("vpn_users").values({
        tenant_id: tenantId, server_id: inbound.serverId, created_by: auth.userId, username: input.username, display_name: input.displayName, email: null,
        uuid: inbound.protocol === "VLESS" || inbound.protocol === "VMess" ? credential : randomUUID(), protocol: inbound.protocol,
        traffic_limit: input.trafficLimit, traffic_used: "0", expires_at: expiresAt, enabled: input.enabled, subscription_enabled: input.subscriptionEnabled,
      }).returning("id").executeTakeFirstOrThrow();
      const client = await transaction.insertInto("inbound_clients").values({
        inbound_id: inbound.id, vpn_user_id: user.id, tenant_id: tenantId, credential_ciphertext: encryptCredential(credential), flow: null,
        enabled: input.enabled, traffic_limit: input.trafficLimit, traffic_used: "0", expires_at: expiresAt, created_by: auth.userId,
      }).returning("id").executeTakeFirstOrThrow();
      const uri = generateClientUri(this.configInput(inbound), credential, input.displayName);
      await this.replaceConfig(transaction, { tenantId, userId: user.id, clientId: client.id, serverId: inbound.serverId, protocol: inbound.protocol, expiresAt, uri });
      if (input.subscriptionEnabled) await this.createSubscription(transaction, tenantId, user.id, expiresAt);
      await transaction.updateTable("inbounds").set({ desired_revision: sql`desired_revision + 1`, apply_status: "PENDING", updated_at: new Date() }).where("id", "=", inbound.id).execute();
      await transaction.insertInto("audit_logs").values(auditValues({
        auth, tenantId, action: "SUBPANEL_USER_CREATED", targetType: "vpn_user", targetId: user.id, requestId: request.requestId, ip: request.ip,
        message: "Sub-panel user created", metadata: { inboundId: inbound.id, protocol: inbound.protocol, trafficLimit: input.trafficLimit, expiresAt: iso(expiresAt) },
      })).execute();
      return user.id;
    });
    return { affected: 1, inboundIds: [input.inboundId], user: (await this.users(this.database, tenantId, [userId]))[0] };
  }

  async updateUser(auth: AuthContext, userId: string, input: PortalUserPatchInput, request: { requestId: string; ip: string | null }): Promise<PortalMutationResult> {
    const tenantId = portalTenantId(auth);
    const inboundId = await this.database.transaction().execute(async (transaction) => {
      const [settings, state, target] = await Promise.all([this.settings(transaction, tenantId), this.quota(transaction, tenantId, true), this.target(transaction, tenantId, userId)]);
      assertTenantActive(state);
      if (input.subscriptionEnabled === true) assertCapability(capabilities(settings), "subscription");
      const nextTraffic = input.trafficLimit === undefined ? bigint(target.trafficLimit) : input.trafficLimit === null ? null : bigint(input.trafficLimit);
      assertTrafficQuota(state, nextTraffic === null ? null : state.allocatedTraffic - bigint(target.trafficLimit) + nextTraffic);
      const expiresAt = input.expiresAt === undefined ? target.expiresAt : resolveExpiration({ expiresAt: input.expiresAt }, state.expiresAt);
      await transaction.updateTable("vpn_users").set({
        ...(input.displayName !== undefined ? { display_name: input.displayName } : {}), ...(input.trafficLimit !== undefined ? { traffic_limit: input.trafficLimit } : {}),
        ...(input.expiresAt !== undefined ? { expires_at: expiresAt } : {}), ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.subscriptionEnabled !== undefined ? { subscription_enabled: input.subscriptionEnabled } : {}), updated_at: new Date(),
      }).where("id", "=", userId).where("tenant_id", "=", tenantId).execute();
      await transaction.updateTable("inbound_clients").set({
        ...(input.trafficLimit !== undefined ? { traffic_limit: input.trafficLimit } : {}), ...(input.expiresAt !== undefined ? { expires_at: expiresAt } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), updated_at: new Date(),
      }).where("id", "=", target.clientId).where("tenant_id", "=", tenantId).execute();
      if (input.subscriptionEnabled !== undefined) {
        const existing = await transaction.selectFrom("subscriptions").select("id").where("tenant_id", "=", tenantId).where("vpn_user_id", "=", userId).where("revoked_at", "is", null).executeTakeFirst();
        if (input.subscriptionEnabled && !existing) await this.createSubscription(transaction, tenantId, userId, expiresAt);
        else if (existing) await transaction.updateTable("subscriptions").set({ enabled: input.subscriptionEnabled, expires_at: expiresAt }).where("id", "=", existing.id).execute();
      }
      if (input.expiresAt !== undefined) await transaction.updateTable("configs").set({ expires_at: expiresAt }).where("tenant_id", "=", tenantId).where("vpn_user_id", "=", userId).where("revoked_at", "is", null).execute();
      await transaction.updateTable("inbounds").set({ desired_revision: sql`desired_revision + 1`, apply_status: "PENDING", updated_at: new Date() }).where("id", "=", target.inboundId).execute();
      const events = [auditValues({ auth, tenantId, action: "SUBPANEL_USER_UPDATED", targetType: "vpn_user", targetId: userId, requestId: request.requestId, ip: request.ip, message: "Sub-panel user updated", metadata: { fields: Object.keys(input), inboundId: target.inboundId } })];
      if (input.trafficLimit !== undefined) events.push(auditValues({ auth, tenantId, action: "SUBPANEL_TRAFFIC_ALLOCATION_UPDATED", targetType: "vpn_user", targetId: userId, requestId: request.requestId, ip: request.ip, message: "User traffic allocation updated", metadata: { trafficLimit: input.trafficLimit } }));
      if (input.expiresAt !== undefined) events.push(auditValues({ auth, tenantId, action: "SUBPANEL_EXPIRATION_UPDATED", targetType: "vpn_user", targetId: userId, requestId: request.requestId, ip: request.ip, message: "User expiration updated", metadata: { expiresAt: iso(expiresAt) } }));
      await transaction.insertInto("audit_logs").values(events).execute();
      return target.inboundId;
    });
    return { affected: 1, inboundIds: [inboundId], user: (await this.users(this.database, tenantId, [userId]))[0] };
  }

  async userAction(auth: AuthContext, userId: string, input: PortalUserActionInput, request: { requestId: string; ip: string | null }): Promise<PortalMutationResult> {
    const tenantId = portalTenantId(auth);
    const targetInfo = await this.database.transaction().execute(async (transaction) => {
      const [settings, state, target] = await Promise.all([this.settings(transaction, tenantId), this.quota(transaction, tenantId, true), this.target(transaction, tenantId, userId)]);
      assertTenantActive(state);
      const caps = capabilities(settings);
      if (input.action === "EXTEND") {
        assertCapability(caps, "extend");
        const base = target.expiresAt && target.expiresAt > new Date() ? target.expiresAt : new Date();
        const next = new Date(base.getTime() + input.days * 86_400_000);
        const expiresAt = resolveExpiration({ expiresAt: next.toISOString() }, state.expiresAt);
        await transaction.updateTable("vpn_users").set({ expires_at: expiresAt, updated_at: new Date() }).where("id", "=", userId).where("tenant_id", "=", tenantId).execute();
        await transaction.updateTable("inbound_clients").set({ expires_at: expiresAt, updated_at: new Date() }).where("id", "=", target.clientId).where("tenant_id", "=", tenantId).execute();
        await transaction.updateTable("configs").set({ expires_at: expiresAt }).where("vpn_user_id", "=", userId).where("tenant_id", "=", tenantId).where("revoked_at", "is", null).execute();
        await transaction.updateTable("subscriptions").set({ expires_at: expiresAt }).where("vpn_user_id", "=", userId).where("tenant_id", "=", tenantId).where("revoked_at", "is", null).execute();
      } else if (input.action === "INCREASE_TRAFFIC") {
        const next = bigint(target.trafficLimit) + bigint(input.bytes);
        assertTrafficQuota(state, state.allocatedTraffic + bigint(input.bytes));
        await transaction.updateTable("vpn_users").set({ traffic_limit: next.toString(), updated_at: new Date() }).where("id", "=", userId).where("tenant_id", "=", tenantId).execute();
        await transaction.updateTable("inbound_clients").set({ traffic_limit: next.toString(), updated_at: new Date() }).where("id", "=", target.clientId).where("tenant_id", "=", tenantId).execute();
      } else if (input.action === "RESET_TRAFFIC") {
        assertCapability(caps, "trafficReset");
      } else if (input.action === "ROTATE_CREDENTIAL") {
        assertCapability(caps, "credentialRotation");
        const inbound = await this.assignedInbound(transaction, tenantId, target.inboundId);
        const credential = generatedCredential(target.protocol);
        await transaction.updateTable("inbound_clients").set({ credential_ciphertext: encryptCredential(credential), updated_at: new Date() }).where("id", "=", target.clientId).where("tenant_id", "=", tenantId).execute();
        if (target.protocol === "VLESS" || target.protocol === "VMess") await transaction.updateTable("vpn_users").set({ uuid: credential, updated_at: new Date() }).where("id", "=", userId).where("tenant_id", "=", tenantId).execute();
        const uri = generateClientUri(this.configInput(inbound), credential, target.displayName);
        await this.replaceConfig(transaction, { tenantId, userId, clientId: target.clientId, serverId: inbound.serverId, protocol: target.protocol, expiresAt: target.expiresAt, uri });
      } else if (input.action === "ENABLE" || input.action === "DISABLE") {
        const enabled = input.action === "ENABLE";
        await transaction.updateTable("vpn_users").set({ enabled, updated_at: new Date() }).where("id", "=", userId).where("tenant_id", "=", tenantId).execute();
        await transaction.updateTable("inbound_clients").set({ enabled, updated_at: new Date() }).where("id", "=", target.clientId).where("tenant_id", "=", tenantId).execute();
      } else if (input.action === "DELETE") {
        await transaction.deleteFrom("vpn_users").where("id", "=", userId).where("tenant_id", "=", tenantId).execute();
      }
      if (input.action !== "RESET_TRAFFIC" && input.action !== "INCREASE_TRAFFIC") {
        await transaction.updateTable("inbounds").set({ desired_revision: sql`desired_revision + 1`, apply_status: "PENDING", updated_at: new Date() }).where("id", "=", target.inboundId).execute();
      }
      const actionName = input.action === "DELETE" ? "SUBPANEL_USER_DELETED"
        : input.action === "RESET_TRAFFIC" ? "SUBPANEL_TRAFFIC_RESET"
          : input.action === "INCREASE_TRAFFIC" ? "SUBPANEL_TRAFFIC_ALLOCATION_UPDATED"
            : input.action === "EXTEND" ? "SUBPANEL_EXPIRATION_UPDATED"
              : `SUBPANEL_USER_${input.action}`;
      await transaction.insertInto("audit_logs").values(auditValues({
        auth, tenantId, action: actionName, targetType: "vpn_user", targetId: userId, requestId: request.requestId, ip: request.ip,
        severity: input.action === "DELETE" || input.action === "ROTATE_CREDENTIAL" ? "warning" : "info", message: `Sub-panel user action: ${input.action}`,
        metadata: { inboundId: target.inboundId, ...(input.action === "EXTEND" ? { days: input.days } : {}), ...(input.action === "INCREASE_TRAFFIC" ? { bytes: input.bytes } : {}) },
      })).execute();
      return { inboundId: target.inboundId, clientId: target.clientId };
    });
    const users = input.action === "DELETE" ? [] : await this.users(this.database, tenantId, [userId]);
    return { affected: 1, inboundIds: [targetInfo.inboundId], user: users[0], ...(input.action === "RESET_TRAFFIC" ? { trafficTargets: [targetInfo] } : {}) };
  }

  async bulkAction(auth: AuthContext, input: PortalBulkActionInput, request: { requestId: string; ip: string | null }): Promise<PortalMutationResult> {
    const tenantId = portalTenantId(auth);
    return this.database.transaction().execute(async (transaction) => {
      const [settings, state] = await Promise.all([this.settings(transaction, tenantId), this.quota(transaction, tenantId, true)]);
      assertTenantActive(state);
      const all = await this.users(transaction, tenantId, input.userIds.length ? unique(input.userIds) : undefined);
      if (input.userIds.length && all.length !== unique(input.userIds).length) throw new ApiError(404, "SUBPANEL_USER_NOT_FOUND", "One or more users are outside this sub-panel");
      const selected = input.action === "DELETE_EXPIRED" ? all.filter((user) => user.expired) : all;
      const ids = selected.map((user) => user.id);
      const clientIds = selected.map((user) => user.clientId);
      const inboundIds = unique(selected.map((user) => user.inboundId));
      if (input.action === "EXTEND") {
        assertCapability(capabilities(settings), "extend");
        for (const user of selected) {
          const base = user.expiresAt && new Date(user.expiresAt) > new Date() ? new Date(user.expiresAt) : new Date();
          const expiresAt = resolveExpiration({ expiresAt: new Date(base.getTime() + input.days * 86_400_000).toISOString() }, state.expiresAt);
          await transaction.updateTable("vpn_users").set({ expires_at: expiresAt, updated_at: new Date() }).where("id", "=", user.id).where("tenant_id", "=", tenantId).execute();
          await transaction.updateTable("inbound_clients").set({ expires_at: expiresAt, updated_at: new Date() }).where("id", "=", user.clientId).where("tenant_id", "=", tenantId).execute();
          await transaction.updateTable("configs").set({ expires_at: expiresAt }).where("vpn_user_id", "=", user.id).where("tenant_id", "=", tenantId).where("revoked_at", "is", null).execute();
          await transaction.updateTable("subscriptions").set({ expires_at: expiresAt }).where("vpn_user_id", "=", user.id).where("tenant_id", "=", tenantId).where("revoked_at", "is", null).execute();
        }
      } else if (input.action === "INCREASE_TRAFFIC") {
        const increase = bigint(input.bytes) * BigInt(selected.length);
        assertTrafficQuota(state, state.allocatedTraffic + increase);
        if (ids.length) {
          await transaction.updateTable("vpn_users").set({ traffic_limit: sql`coalesce(traffic_limit, 0) + ${input.bytes}::bigint`, updated_at: new Date() }).where("id", "in", ids).where("tenant_id", "=", tenantId).execute();
          await transaction.updateTable("inbound_clients").set({ traffic_limit: sql`coalesce(traffic_limit, 0) + ${input.bytes}::bigint`, updated_at: new Date() }).where("id", "in", clientIds).where("tenant_id", "=", tenantId).execute();
        }
      } else if (input.action === "RESET_TRAFFIC") {
        assertCapability(capabilities(settings), "trafficReset");
      } else if (input.action === "ENABLE" || input.action === "DISABLE") {
        const enabled = input.action === "ENABLE";
        if (ids.length) {
          await transaction.updateTable("vpn_users").set({ enabled, updated_at: new Date() }).where("id", "in", ids).where("tenant_id", "=", tenantId).execute();
          await transaction.updateTable("inbound_clients").set({ enabled, updated_at: new Date() }).where("id", "in", clientIds).where("tenant_id", "=", tenantId).execute();
        }
      } else if (input.action === "DELETE_EXPIRED" && ids.length) {
        await transaction.deleteFrom("vpn_users").where("id", "in", ids).where("tenant_id", "=", tenantId).execute();
      }
      if (!new Set(["RESET_TRAFFIC", "INCREASE_TRAFFIC"]).has(input.action) && inboundIds.length) {
        await transaction.updateTable("inbounds").set({ desired_revision: sql`desired_revision + 1`, apply_status: "PENDING", updated_at: new Date() }).where("id", "in", inboundIds).execute();
      }
      const bulkActionName = input.action === "DELETE_EXPIRED" ? "SUBPANEL_USER_DELETED"
        : input.action === "RESET_TRAFFIC" ? "SUBPANEL_TRAFFIC_RESET"
          : input.action === "INCREASE_TRAFFIC" ? "SUBPANEL_TRAFFIC_ALLOCATION_UPDATED"
            : input.action === "EXTEND" ? "SUBPANEL_EXPIRATION_UPDATED"
              : `SUBPANEL_BULK_${input.action}`;
      await transaction.insertInto("audit_logs").values(auditValues({
        auth, tenantId, action: bulkActionName, targetType: "vpn_user_bulk", requestId: request.requestId, ip: request.ip,
        severity: input.action === "DELETE_EXPIRED" ? "warning" : "info", message: `Sub-panel bulk action: ${input.action}`, metadata: { affected: ids.length, inboundIds },
      })).execute();
      return { affected: ids.length, inboundIds, ...(input.action === "RESET_TRAFFIC" ? { trafficTargets: selected.map((user) => ({ inboundId: user.inboundId, clientId: user.clientId })) } : {}) };
    });
  }

  async configUri(auth: AuthContext, userId: string) {
    const tenantId = portalTenantId(auth);
    await this.target(this.database, tenantId, userId);
    const config = await this.database.selectFrom("configs").select("share_uri_ciphertext").where("tenant_id", "=", tenantId).where("vpn_user_id", "=", userId).where("revoked_at", "is", null).orderBy("generated_at", "desc").executeTakeFirst();
    if (!config?.share_uri_ciphertext) throw new ApiError(404, "CONFIG_NOT_AVAILABLE", "Generated configuration is not available");
    return decryptCredential(config.share_uri_ciphertext);
  }

  async subscriptionUrl(auth: AuthContext, userId: string) {
    const tenantId = portalTenantId(auth);
    const settings = await this.settings(this.database, tenantId);
    assertCapability(capabilities(settings), "subscription");
    await this.target(this.database, tenantId, userId);
    const subscription = await this.database.selectFrom("subscriptions").select(["token_ciphertext", "enabled"]).where("tenant_id", "=", tenantId).where("vpn_user_id", "=", userId).where("revoked_at", "is", null).executeTakeFirst();
    if (!subscription?.token_ciphertext || !subscription.enabled) throw new ApiError(404, "SUBSCRIPTION_NOT_AVAILABLE", "Subscription is disabled or unavailable");
    return `${environment.subscriptionPublicBaseUrl}/${decryptCredential(subscription.token_ciphertext)}`;
  }

  async rotateSubscription(auth: AuthContext, userId: string, request: { requestId: string; ip: string | null }) {
    const tenantId = portalTenantId(auth);
    return this.database.transaction().execute(async (transaction) => {
      const [settings, target] = await Promise.all([this.settings(transaction, tenantId), this.target(transaction, tenantId, userId)]);
      assertCapability(capabilities(settings), "subscription");
      const token = createSubscriptionToken();
      const result = await transaction.updateTable("subscriptions").set({ token_hash: hashSubscriptionToken(token), token_ciphertext: encryptCredential(token), rotated_at: new Date(), enabled: true })
        .where("tenant_id", "=", tenantId).where("vpn_user_id", "=", userId).where("revoked_at", "is", null).executeTakeFirst();
      if (!Number(result.numUpdatedRows)) throw new ApiError(404, "SUBSCRIPTION_NOT_AVAILABLE", "Subscription is unavailable");
      await transaction.insertInto("audit_logs").values(auditValues({ auth, tenantId, action: "SUBPANEL_SUBSCRIPTION_TOKEN_ROTATED", targetType: "subscription", targetId: userId, requestId: request.requestId, ip: request.ip, severity: "warning", message: "Subscription token rotated", metadata: { inboundId: target.inboundId } })).execute();
      return `${environment.subscriptionPublicBaseUrl}/${token}`;
    });
  }

  async setSubscriptionEnabled(auth: AuthContext, userId: string, enabled: boolean, request: { requestId: string; ip: string | null }) {
    const tenantId = portalTenantId(auth);
    return this.database.transaction().execute(async (transaction) => {
      const [settings, target] = await Promise.all([this.settings(transaction, tenantId), this.target(transaction, tenantId, userId)]);
      if (enabled) assertCapability(capabilities(settings), "subscription");
      const result = await transaction.updateTable("subscriptions").set({ enabled }).where("tenant_id", "=", tenantId).where("vpn_user_id", "=", userId).where("revoked_at", "is", null).executeTakeFirst();
      if (!Number(result.numUpdatedRows)) throw new ApiError(404, "SUBSCRIPTION_NOT_AVAILABLE", "Subscription is unavailable");
      await transaction.updateTable("vpn_users").set({ subscription_enabled: enabled, updated_at: new Date() }).where("id", "=", userId).where("tenant_id", "=", tenantId).execute();
      await transaction.insertInto("audit_logs").values(auditValues({ auth, tenantId, action: enabled ? "SUBPANEL_SUBSCRIPTION_ENABLED" : "SUBPANEL_SUBSCRIPTION_DISABLED", targetType: "subscription", targetId: userId, requestId: request.requestId, ip: request.ip, message: `Subscription ${enabled ? "enabled" : "disabled"}`, metadata: { inboundId: target.inboundId } })).execute();
      return { updated: true };
    });
  }

  async subscriptions(auth: AuthContext): Promise<SubpanelSubscriptionSummary[]> {
    const tenantId = portalTenantId(auth);
    const settings = await this.settings(this.database, tenantId);
    assertCapability(capabilities(settings), "subscription");
    const rows = await this.database.selectFrom("subscriptions")
      .innerJoin("vpn_users", "vpn_users.id", "subscriptions.vpn_user_id")
      .innerJoin("inbound_clients", (join) => join.onRef("inbound_clients.vpn_user_id", "=", "vpn_users.id").on("inbound_clients.tenant_id", "=", tenantId))
      .innerJoin("subpanel_inbound_assignments", (join) => join.onRef("subpanel_inbound_assignments.inbound_id", "=", "inbound_clients.inbound_id").on("subpanel_inbound_assignments.tenant_id", "=", tenantId))
      .innerJoin("inbounds", "inbounds.id", "inbound_clients.inbound_id")
      .select(["subscriptions.id", "vpn_users.id as userId", "vpn_users.username", "inbounds.name as inboundName", "subscriptions.enabled", "subscriptions.expires_at as expiresAt", "subscriptions.last_access_at as lastAccessAt", "subscriptions.rotated_at as rotatedAt"])
      .where("subscriptions.tenant_id", "=", tenantId).where("vpn_users.tenant_id", "=", tenantId).where("subscriptions.revoked_at", "is", null)
      .orderBy("subscriptions.created_at", "desc").execute();
    return rows.map((row) => ({ ...row, expiresAt: iso(row.expiresAt), lastAccessAt: iso(row.lastAccessAt), rotatedAt: iso(row.rotatedAt) }));
  }

  async traffic(auth: AuthContext, range: "24h" | "7d" | "30d" | "all"): Promise<SubpanelTrafficData> {
    const tenantId = portalTenantId(auth);
    const state = await this.quota(this.database, tenantId);
    const starts: Record<typeof range, Date | null> = {
      "24h": new Date(Date.now() - 24 * 3_600_000), "7d": new Date(Date.now() - 7 * 86_400_000), "30d": new Date(Date.now() - 30 * 86_400_000), all: null,
    };
    const bucketExpression = range === "24h" ? sql<Date>`date_trunc('hour', bucket_start)` : sql<Date>`date_trunc('day', bucket_start)`;
    let seriesQuery = this.database.selectFrom("traffic_aggregates")
      .select([bucketExpression.as("bucket"), sql<string>`coalesce(sum(rx_bytes), 0)::text`.as("rxBytes"), sql<string>`coalesce(sum(tx_bytes), 0)::text`.as("txBytes")])
      .where("tenant_id", "=", tenantId);
    if (starts[range]) seriesQuery = seriesQuery.where("bucket_start", ">=", starts[range]!);
    const [seriesRows, topRows, inboundRows] = await Promise.all([
      seriesQuery.groupBy(bucketExpression).orderBy("bucket").execute(),
      this.database.selectFrom("vpn_users").select(["id", "display_name as label", sql<string>`traffic_used::text`.as("trafficUsed")]).where("tenant_id", "=", tenantId).orderBy("traffic_used", "desc").limit(10).execute(),
      this.database.selectFrom("inbound_clients")
        .innerJoin("inbounds", "inbounds.id", "inbound_clients.inbound_id")
        .innerJoin("subpanel_inbound_assignments", (join) => join.onRef("subpanel_inbound_assignments.inbound_id", "=", "inbound_clients.inbound_id").on("subpanel_inbound_assignments.tenant_id", "=", tenantId))
        .select(["inbounds.id", "inbounds.name as label", sql<string>`coalesce(sum(inbound_clients.traffic_used), 0)::text`.as("trafficUsed")])
        .where("inbound_clients.tenant_id", "=", tenantId).groupBy(["inbounds.id", "inbounds.name"]).orderBy(sql`sum(inbound_clients.traffic_used)`, "desc").execute(),
    ]);
    return {
      range, quota: quotaSnapshot(state), series: seriesRows.map((row) => ({ bucket: new Date(row.bucket).toISOString(), rxBytes: row.rxBytes, txBytes: row.txBytes })),
      topUsers: topRows, byInbound: inboundRows, dataState: seriesRows.length ? "LIVE" : "DISCONNECTED",
    };
  }

  async portalSettings(auth: AuthContext): Promise<SubpanelSettingsData> {
    const tenantId = portalTenantId(auth);
    const [settings, admin] = await Promise.all([
      this.settings(this.database, tenantId), this.database.selectFrom("admins").select(["username", "email"]).where("id", "=", auth.userId).where("tenant_id", "=", tenantId).executeTakeFirstOrThrow(),
    ]);
    return { panelName: settings.panel_name, displayName: settings.display_name, username: admin.username, email: admin.email, theme: settings.theme, language: settings.language, capabilities: capabilities(settings) };
  }

  async updatePortalSettings(auth: AuthContext, input: PortalSettingsPatchInput, request: { requestId: string; ip: string | null }) {
    const tenantId = portalTenantId(auth);
    await this.database.transaction().execute(async (transaction) => {
      await this.settings(transaction, tenantId);
      if (input.displayName !== undefined || input.theme !== undefined || input.language !== undefined) {
        await transaction.updateTable("subpanel_settings").set({
          ...(input.displayName !== undefined ? { display_name: input.displayName } : {}), ...(input.theme !== undefined ? { theme: input.theme } : {}),
          ...(input.language !== undefined ? { language: input.language } : {}), updated_at: new Date(),
        }).where("tenant_id", "=", tenantId).execute();
      }
      if (input.email !== undefined) await transaction.updateTable("admins").set({ email: input.email, updated_at: new Date() }).where("id", "=", auth.userId).where("tenant_id", "=", tenantId).execute();
      await transaction.insertInto("audit_logs").values(auditValues({ auth, tenantId, action: "SUBPANEL_SETTINGS_UPDATED", targetType: "subpanel_settings", targetId: tenantId, requestId: request.requestId, ip: request.ip, message: "Sub-panel account preferences updated", metadata: { fields: Object.keys(input) } })).execute();
    });
    return this.portalSettings(auth);
  }

  async consumeSubscription(token: string) {
    const tokenHash = hashSubscriptionToken(token);
    return this.database.transaction().execute(async (transaction) => {
      const row = await transaction.selectFrom("subscriptions")
        .innerJoin("vpn_users", "vpn_users.id", "subscriptions.vpn_user_id")
        .innerJoin("tenants", "tenants.id", "subscriptions.tenant_id")
        .innerJoin("configs", (join) => join.onRef("configs.vpn_user_id", "=", "vpn_users.id").on("configs.revoked_at", "is", null))
        .select(["subscriptions.id", "subscriptions.enabled as subscriptionEnabled", "subscriptions.expires_at as subscriptionExpiresAt", "vpn_users.enabled as userEnabled", "vpn_users.expires_at as userExpiresAt", "tenants.status as tenantStatus", "tenants.expires_at as tenantExpiresAt", "configs.share_uri_ciphertext as uriCiphertext"])
        .where("subscriptions.token_hash", "=", tokenHash).where("subscriptions.revoked_at", "is", null).executeTakeFirst();
      const now = new Date();
      if (!row || !row.subscriptionEnabled || !row.userEnabled || !row.uriCiphertext) throw new ApiError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found");
      if (row.tenantStatus !== "ACTIVE" || (row.tenantExpiresAt && row.tenantExpiresAt <= now) || (row.subscriptionExpiresAt && row.subscriptionExpiresAt <= now) || (row.userExpiresAt && row.userExpiresAt <= now)) {
        throw new ApiError(410, "SUBSCRIPTION_EXPIRED", "Subscription expired");
      }
      await transaction.updateTable("subscriptions").set({ last_access_at: now }).where("id", "=", row.id).execute();
      return decryptCredential(row.uriCiphertext);
    });
  }

  private assertOwner(auth: AuthContext) {
    if (auth.role !== ROLES.OWNER) throw new ApiError(403, "AUTH_FORBIDDEN", "OWNER access is required");
  }

  private async validateAssignments(executor: Executor, serverIds: string[], inboundIds: string[]) {
    const uniqueServers = unique(serverIds);
    const uniqueInbounds = unique(inboundIds);
    const servers = uniqueServers.length ? await executor.selectFrom("servers").select("id").where("id", "in", uniqueServers).execute() : [];
    if (servers.length !== uniqueServers.length) throw new ApiError(400, "SERVER_ASSIGNMENT_INVALID", "One or more selected servers do not exist");
    const inbounds = uniqueInbounds.length ? await executor.selectFrom("inbounds")
      .innerJoin("xray_instances", "xray_instances.id", "inbounds.xray_instance_id")
      .select(["inbounds.id", "xray_instances.server_id as serverId"]).where("inbounds.id", "in", uniqueInbounds).execute() : [];
    if (inbounds.length !== uniqueInbounds.length) throw new ApiError(400, "INBOUND_ASSIGNMENT_INVALID", "One or more selected inbounds do not exist");
    if (inbounds.some((inbound) => !uniqueServers.includes(inbound.serverId))) throw new ApiError(400, "INBOUND_SERVER_NOT_ALLOWED", "Every assigned inbound must belong to an allowed server");
  }

  async masterOptions(auth: AuthContext): Promise<MasterSubpanelOptions> {
    this.assertOwner(auth);
    const [servers, inbounds] = await Promise.all([
      this.database.selectFrom("servers").select(["id", "display_name as name"]).orderBy("display_name").execute(),
      this.database.selectFrom("inbounds").innerJoin("xray_instances", "xray_instances.id", "inbounds.xray_instance_id").innerJoin("servers", "servers.id", "xray_instances.server_id")
        .select(["inbounds.id", "inbounds.name", "servers.id as serverId", "servers.display_name as serverName", "inbounds.protocol", "inbounds.enabled"]).orderBy("servers.display_name").orderBy("inbounds.name").execute(),
    ]);
    return { servers, inbounds };
  }

  async listMaster(auth: AuthContext): Promise<MasterSubpanelSummary[]> {
    this.assertOwner(auth);
    const rows = await this.database.selectFrom("subpanel_settings")
      .innerJoin("tenants", "tenants.id", "subpanel_settings.tenant_id")
      .innerJoin("admins", "admins.tenant_id", "tenants.id")
      .innerJoin("roles", "roles.id", "admins.role_id")
      .select(["tenants.id as tenantId", "subpanel_settings.panel_name as panelName", "admins.username", "tenants.status", "tenants.user_limit as userLimit", "tenants.traffic_quota as trafficCredit", "tenants.expires_at as expiresAt", "subpanel_settings.allowed_protocols as allowedProtocols", "subpanel_settings.allow_subscription", "subpanel_settings.allow_traffic_reset", "subpanel_settings.allow_extend", "subpanel_settings.allow_credential_rotation"])
      .where("roles.name", "in", [ROLES.RESELLER, ROLES.SUB_RESELLER]).orderBy("tenants.created_at", "desc").execute();
    return Promise.all(rows.map(async (row) => {
      const [servers, inbounds, totals] = await Promise.all([
        this.database.selectFrom("subpanel_server_assignments").select("server_id").where("tenant_id", "=", row.tenantId).execute(),
        this.database.selectFrom("subpanel_inbound_assignments").select("inbound_id").where("tenant_id", "=", row.tenantId).execute(),
        this.database.selectFrom("vpn_users").select(({ fn }) => [fn.countAll<number>().as("createdUsers"), fn.coalesce(fn.sum<string>("traffic_limit"), sql<string>`0`).as("allocatedTraffic")]).where("tenant_id", "=", row.tenantId).executeTakeFirstOrThrow(),
      ]);
      return {
        tenantId: row.tenantId, panelName: row.panelName, username: row.username, status: row.status, userLimit: row.userLimit,
        trafficCredit: row.trafficCredit, expiresAt: iso(row.expiresAt), allowedServerIds: servers.map((item) => item.server_id), assignedInboundIds: inbounds.map((item) => item.inbound_id),
        allowedProtocols: row.allowedProtocols, capabilities: { subscription: row.allow_subscription, trafficReset: row.allow_traffic_reset, extend: row.allow_extend, credentialRotation: row.allow_credential_rotation },
        createdUsers: Number(totals.createdUsers), allocatedTraffic: String(totals.allocatedTraffic),
      };
    }));
  }

  async createMaster(auth: AuthContext, input: MasterSubpanelCreateInput, passwordHash: string, request: { requestId: string; ip: string | null }) {
    this.assertOwner(auth);
    return this.database.transaction().execute(async (transaction) => {
      await this.validateAssignments(transaction, input.allowedServerIds, input.assignedInboundIds);
      const tenant = await transaction.insertInto("tenants").values({
        parent_id: auth.primaryTenantId, name: input.panelName, slug: input.slug, status: "ACTIVE", created_by: auth.userId, traffic_quota: input.trafficCredit,
        user_limit: input.userLimit, config_limit: null, expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
      }).returning("id").executeTakeFirstOrThrow();
      await transaction.insertInto("subpanel_settings").values({
        tenant_id: tenant.id, panel_name: input.panelName, display_name: input.displayName, allowed_protocols: unique(input.allowedProtocols),
        allow_subscription: input.capabilities.subscription, allow_traffic_reset: input.capabilities.trafficReset, allow_extend: input.capabilities.extend,
        allow_credential_rotation: input.capabilities.credentialRotation, theme: "light", language: "fa",
      }).execute();
      const role = await transaction.selectFrom("roles").select("id").where("name", "=", ROLES.RESELLER).executeTakeFirstOrThrow();
      const admin = await transaction.insertInto("admins").values({
        username: input.username, email: input.email, password_hash: passwordHash, role_id: role.id, tenant_id: tenant.id, enabled: true, status: "ACTIVE",
        last_activity_at: null, last_login_at: null, password_changed_at: new Date(), created_by: auth.userId,
      }).returning("id").executeTakeFirstOrThrow();
      await transaction.insertInto("tenant_memberships").values({ tenant_id: tenant.id, admin_id: admin.id, permissions: [] }).execute();
      if (input.allowedServerIds.length) await transaction.insertInto("subpanel_server_assignments").values(unique(input.allowedServerIds).map((serverId) => ({ tenant_id: tenant.id, server_id: serverId, assigned_by: auth.userId }))).execute();
      if (input.assignedInboundIds.length) await transaction.insertInto("subpanel_inbound_assignments").values(unique(input.assignedInboundIds).map((inboundId) => ({ tenant_id: tenant.id, inbound_id: inboundId, assigned_by: auth.userId }))).execute();
      await transaction.insertInto("audit_logs").values(auditValues({
        auth, tenantId: tenant.id, action: "SUBPANEL_CREATED", targetType: "tenant", targetId: tenant.id, requestId: request.requestId, ip: request.ip,
        message: "Sub-panel created by OWNER", metadata: { allowedServerIds: unique(input.allowedServerIds), assignedInboundIds: unique(input.assignedInboundIds), allowedProtocols: unique(input.allowedProtocols), userLimit: input.userLimit, trafficCredit: input.trafficCredit, expiresAt: input.expiresAt },
      })).execute();
      return { tenantId: tenant.id };
    });
  }

  async updateMaster(auth: AuthContext, tenantId: string, input: MasterSubpanelPatchInput, passwordHash: string | null, request: { requestId: string; ip: string | null }) {
    this.assertOwner(auth);
    return this.database.transaction().execute(async (transaction) => {
      const tenant = await transaction.selectFrom("tenants").select(["id", "status"]).where("id", "=", tenantId).forUpdate().executeTakeFirst();
      if (!tenant) throw new ApiError(404, "SUBPANEL_NOT_FOUND", "Sub-panel not found");
      await this.settings(transaction, tenantId);
      const state = await this.quota(transaction, tenantId, true);
      if (input.userLimit !== undefined && input.userLimit !== null && input.userLimit < state.createdUsers) throw new ApiError(409, "USER_LIMIT_EXCEEDED", "User limit cannot be lower than the number of existing users");
      if (input.trafficCredit !== undefined && input.trafficCredit !== null && bigint(input.trafficCredit) < state.allocatedTraffic) throw new ApiError(409, "TRAFFIC_QUOTA_EXCEEDED", "Traffic credit cannot be lower than the currently allocated traffic");
      if (input.allowedServerIds !== undefined || input.assignedInboundIds !== undefined) {
        const currentServers = input.allowedServerIds ?? (await transaction.selectFrom("subpanel_server_assignments").select("server_id").where("tenant_id", "=", tenantId).execute()).map((item) => item.server_id);
        const currentInbounds = input.assignedInboundIds ?? (await transaction.selectFrom("subpanel_inbound_assignments").select("inbound_id").where("tenant_id", "=", tenantId).execute()).map((item) => item.inbound_id);
        await this.validateAssignments(transaction, currentServers, currentInbounds);
        if (input.allowedServerIds !== undefined) {
          await transaction.deleteFrom("subpanel_server_assignments").where("tenant_id", "=", tenantId).execute();
          if (currentServers.length) await transaction.insertInto("subpanel_server_assignments").values(unique(currentServers).map((serverId) => ({ tenant_id: tenantId, server_id: serverId, assigned_by: auth.userId }))).execute();
        }
        if (input.assignedInboundIds !== undefined) {
          await transaction.deleteFrom("subpanel_inbound_assignments").where("tenant_id", "=", tenantId).execute();
          if (currentInbounds.length) await transaction.insertInto("subpanel_inbound_assignments").values(unique(currentInbounds).map((inboundId) => ({ tenant_id: tenantId, inbound_id: inboundId, assigned_by: auth.userId }))).execute();
        }
      }
      await transaction.updateTable("tenants").set({
        ...(input.panelName !== undefined ? { name: input.panelName } : {}), ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.trafficCredit !== undefined ? { traffic_quota: input.trafficCredit } : {}), ...(input.userLimit !== undefined ? { user_limit: input.userLimit } : {}),
        ...(input.expiresAt !== undefined ? { expires_at: input.expiresAt ? new Date(input.expiresAt) : null } : {}), updated_at: new Date(),
      }).where("id", "=", tenantId).execute();
      await transaction.updateTable("subpanel_settings").set({
        ...(input.panelName !== undefined ? { panel_name: input.panelName } : {}), ...(input.displayName !== undefined ? { display_name: input.displayName } : {}),
        ...(input.allowedProtocols !== undefined ? { allowed_protocols: unique(input.allowedProtocols) } : {}),
        ...(input.capabilities ? { allow_subscription: input.capabilities.subscription, allow_traffic_reset: input.capabilities.trafficReset, allow_extend: input.capabilities.extend, allow_credential_rotation: input.capabilities.credentialRotation } : {}),
        updated_at: new Date(),
      }).where("tenant_id", "=", tenantId).execute();
      if (passwordHash) {
        const admin = await transaction.selectFrom("admins").innerJoin("roles", "roles.id", "admins.role_id").select("admins.id").where("admins.tenant_id", "=", tenantId).where("roles.name", "in", [ROLES.RESELLER, ROLES.SUB_RESELLER]).executeTakeFirstOrThrow();
        await transaction.updateTable("admins").set({ password_hash: passwordHash, password_changed_at: new Date(), updated_at: new Date() }).where("id", "=", admin.id).execute();
        await transaction.updateTable("sessions").set({ revoked_at: new Date() }).where("admin_id", "=", admin.id).where("revoked_at", "is", null).execute();
      }
      if (input.status === "DISABLED" || input.status === "EXPIRED") {
        const adminIds = (await transaction.selectFrom("admins").select("id").where("tenant_id", "=", tenantId).execute()).map((item) => item.id);
        if (adminIds.length) await transaction.updateTable("sessions").set({ revoked_at: new Date() }).where("admin_id", "in", adminIds).where("revoked_at", "is", null).execute();
      }
      await transaction.insertInto("audit_logs").values(auditValues({
        auth, tenantId, action: "SUBPANEL_UPDATED", targetType: "tenant", targetId: tenantId, requestId: request.requestId, ip: request.ip,
        severity: input.status === "DISABLED" || input.status === "EXPIRED" || Boolean(passwordHash) ? "warning" : "info", message: "Sub-panel configuration updated by OWNER",
        metadata: { fields: Object.keys(input).filter((field) => field !== "password"), passwordChanged: Boolean(passwordHash), previousStatus: tenant.status, nextStatus: input.status },
      })).execute();
      return { tenantId, updated: true };
    });
  }

  async exportUsers(auth: AuthContext, kind: "configs" | "subscriptions", request: { requestId: string; ip: string | null }) {
    const tenantId = portalTenantId(auth);
    const settings = await this.settings(this.database, tenantId);
    if (kind === "subscriptions") assertCapability(capabilities(settings), "subscription");
    const users = await this.users(this.database, tenantId);
    const lines: string[] = [];
    for (const user of users) {
      try { lines.push(kind === "configs" ? await this.configUri(auth, user.id) : await this.subscriptionUrl(auth, user.id)); }
      catch (error) { if (!(error instanceof ApiError && error.statusCode === 404)) throw error; }
    }
    await this.database.insertInto("audit_logs").values(auditValues({ auth, tenantId, action: kind === "configs" ? "SUBPANEL_CONFIGS_EXPORTED" : "SUBPANEL_SUBSCRIPTIONS_EXPORTED", targetType: "subpanel_export", requestId: request.requestId, ip: request.ip, message: `Sub-panel ${kind} exported`, metadata: { count: lines.length } })).execute();
    return lines.join("\n");
  }

  async recordPortalRejection(auth: AuthContext, code: "USER_LIMIT_EXCEEDED" | "TRAFFIC_QUOTA_EXCEEDED", request: { requestId: string; ip: string | null }) {
    const tenantId = portalTenantId(auth);
    await this.database.insertInto("audit_logs").values(auditValues({
      auth, tenantId, action: code === "USER_LIMIT_EXCEEDED" ? "SUBPANEL_USER_LIMIT_REACHED" : "SUBPANEL_TRAFFIC_LIMIT_REACHED",
      targetType: "quota", targetId: tenantId, requestId: request.requestId, ip: request.ip, severity: "warning", message: "Sub-panel quota enforcement rejected a mutation", metadata: { code },
    })).execute();
  }
}

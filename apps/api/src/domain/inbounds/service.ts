import { randomBytes, randomUUID } from "node:crypto";
import { hasPermission, PERMISSIONS, PRESERVE_SECRET_VALUE, ROLES, type InboundDetail, type InboundsPageData } from "@nr/shared";
import type { AuthContext } from "../identity.js";
import { ApiError } from "../../lib/errors.js";
import { computeApplyPlan } from "./apply-planner.js";
import { buildXrayInstanceDocument, configHash, InboundConfigValidationError } from "./config-builder.js";
import type { ApplyPlan, DesiredInbound, XrayConfigDocument, XrayRuntime } from "./model.js";
import type { InboundRepository } from "./repository.js";
import { inboundClientWriteSchema, inboundWriteSchema, type InboundClientRequestInput, type InboundPatchInput, type InboundWriteInput } from "./schemas.js";

export type ApplyOutcome = { state: "APPLIED" | "FAILED" | "ROLLED_BACK"; strategy: ApplyPlan["strategy"]; reason: string; errorCode?: string; errorMessage?: string };
export type MutationResult = { inbound: DesiredInbound; apply: ApplyOutcome };

function errorDetails(error: unknown) {
  if (error instanceof ApiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "XRAY_APPLY_FAILED", message: error.message };
  return { code: "XRAY_APPLY_FAILED", message: "Unknown Xray apply failure" };
}

function generatedCredential(protocol: DesiredInbound["protocol"]) {
  return protocol === "VLESS" || protocol === "VMess" ? randomUUID() : randomBytes(32).toString("base64");
}

export class InboundService {
  constructor(private readonly repository: InboundRepository, private readonly runtime: XrayRuntime, private readonly defaults?: {
    userDefaults(): Promise<{ trafficLimitBytes: string | null; durationDays: number | null; enabled: boolean; subscriptionEnabled: boolean; protocol: DesiredInbound["protocol"] }>;
    xrayPolicy?(): Promise<{ hotApply: boolean; logLevel: "debug" | "info" | "warning" | "error" | "none"; statsEnabled: boolean }>;
  }) {}

  async applyAssignedClientChange(inboundId: string, actorId: string) {
    const internalAuth: AuthContext = {
      userId: actorId, username: "internal-subpanel-apply", email: null, role: ROLES.OWNER, permissions: [], primaryTenantId: "internal", tenantIds: [],
      sessionId: "internal", sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const inbound = await this.repository.getDesired(inboundId, internalAuth);
    return this.apply(inbound, inbound.tag, actorId);
  }

  async resetAssignedClientTraffic(inboundId: string, clientId: string, actorId: string) {
    const internalAuth: AuthContext = {
      userId: actorId, username: "internal-subpanel-reset", email: null, role: ROLES.OWNER, permissions: [], primaryTenantId: "internal", tenantIds: [],
      sessionId: "internal", sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    return this.resetTraffic(inboundId, clientId, "CLIENT", internalAuth);
  }

  async pageData(auth: AuthContext): Promise<InboundsPageData> {
    const [inbounds, servers, userDefaults] = await Promise.all([this.repository.list(auth), this.repository.serverOptions(auth), this.defaults?.userDefaults()]);
    const hasOnlineServer = servers.some((server) => server.status === "ONLINE");
    return {
      inbounds, servers,
      runtime: {
        state: hasOnlineServer ? "CONNECTED" : "DISCONNECTED",
        message: hasOnlineServer ? "عامل سرور آماده دریافت برنامه تغییرات Xray است." : "عامل Xray متصل نیست؛ وضعیت مطلوب ذخیره می‌شود اما اعمال پیکربندی صریحاً ناموفق خواهد بود.",
        supportsXhttp: servers.some((server) => server.xrayVersion !== null), supportsHotApply: hasOnlineServer,
      }, ...(userDefaults ? { userDefaults: { ...userDefaults, trafficResetPolicy: "NEVER" as const, expirationBehavior: "DISABLE" as const } } : {}),
    };
  }

  async validateDesiredState(auth: AuthContext) {
    const summaries = await this.repository.list(auth);
    const desired = await Promise.all(summaries.map((item) => this.repository.getDesired(item.id, auth)));
    const instances = new Map<string, DesiredInbound[]>();
    for (const inbound of desired) instances.set(inbound.xrayInstanceId, [...(instances.get(inbound.xrayInstanceId) ?? []), inbound]);
    const validated: Array<{ instanceId: string; inboundCount: number; configTest: boolean }> = [];
    const policy = await this.defaults?.xrayPolicy?.();
    for (const [instanceId, inbounds] of instances) {
      const capabilities = await this.runtime.capabilities(instanceId);
      const document = buildXrayInstanceDocument(inbounds, capabilities.xhttp, policy);
      await this.runtime.validateConfig(instanceId, document);
      validated.push({ instanceId, inboundCount: inbounds.length, configTest: capabilities.configTest });
    }
    return { valid: true, instances: validated, inboundCount: desired.length };
  }

  async applyGlobalSettings(auth: AuthContext) {
    const desired = await Promise.all((await this.repository.list(auth)).map((item) => this.repository.getDesired(item.id, auth)));
    const firstByInstance = new Map<string, DesiredInbound>();
    for (const inbound of desired) if (!firstByInstance.has(inbound.xrayInstanceId)) firstByInstance.set(inbound.xrayInstanceId, inbound);
    return Promise.all([...firstByInstance.values()].map((inbound) => this.apply(inbound, inbound.tag, auth.userId)));
  }

  async detail(id: string, auth: AuthContext): Promise<InboundDetail> {
    const inbound = await this.repository.getDesired(id, auth);
    return {
      id: inbound.id, tenantId: inbound.tenantId, serverId: inbound.serverId, serverName: inbound.serverName, name: inbound.name, tag: inbound.tag, listenIp: inbound.listenIp,
      port: inbound.port, protocol: inbound.protocol, transport: inbound.transport, security: inbound.security, enabled: inbound.enabled, trafficLimit: inbound.trafficLimit,
      trafficUsed: inbound.trafficUsed, expiresAt: inbound.expiresAt, desiredRevision: inbound.desiredRevision, appliedRevision: inbound.appliedRevision,
      applyStatus: inbound.applyStatus, lastApplyError: inbound.lastApplyError, protocolConfig: inbound.protocolConfig, transportConfig: inbound.transportConfig,
      securityConfig: inbound.securityConfig.kind === "REALITY" ? { ...inbound.securityConfig, privateKey: PRESERVE_SECRET_VALUE } : inbound.securityConfig,
      sniffing: inbound.sniffing, sockopt: inbound.sockopt, fallbacks: inbound.fallbacks, routing: inbound.routing,
      advancedConfig: inbound.advancedConfig, clientCount: inbound.clients.length, activeClientCount: inbound.clients.filter((client) => client.enabled && (!client.expiresAt || Date.parse(client.expiresAt) > Date.now())).length,
      clients: inbound.clients.map((client) => ({
        id: client.id, userId: client.userId, name: client.name, email: client.email, publicId: client.publicId,
        credentialPreview: client.credential.length <= 8 ? "••••••••" : `${client.credential.slice(0, 4)}••••${client.credential.slice(-4)}`,
        enabled: client.enabled, trafficLimit: client.trafficLimit, trafficUsed: client.trafficUsed, expiresAt: client.expiresAt,
        subscriptionEnabled: client.subscriptionEnabled, expired: Boolean(client.expiresAt && Date.parse(client.expiresAt) <= Date.now()),
      })),
    };
  }

  private assertAdvancedJson(auth: AuthContext, advancedConfig: Record<string, unknown> | null | undefined) {
    if (advancedConfig === undefined || advancedConfig === null) return;
    const authorized = auth.role === ROLES.OWNER || (auth.role === ROLES.ADMIN && hasPermission(auth.role, auth.permissions, PERMISSIONS.XRAY_CONTROL));
    if (!authorized) throw new ApiError(403, "AUTH_FORBIDDEN", "Advanced Xray JSON requires OWNER or authorized ADMIN access");
  }

  async create(input: InboundWriteInput, auth: AuthContext): Promise<MutationResult> {
    this.assertAdvancedJson(auth, input.advancedConfig);
    const parsed = inboundWriteSchema.parse(input);
    if (parsed.securityConfig.kind === "REALITY" && parsed.securityConfig.privateKey === PRESERVE_SECRET_VALUE) throw new ApiError(400, "REALITY_PRIVATE_KEY_REQUIRED", "A REALITY private key is required for a new inbound");
    const inbound = await this.repository.create(parsed, auth);
    return { inbound, apply: await this.apply(inbound, null, auth.userId) };
  }

  async update(id: string, patch: InboundPatchInput, auth: AuthContext): Promise<MutationResult> {
    if (Object.prototype.hasOwnProperty.call(patch, "advancedConfig")) this.assertAdvancedJson(auth, patch.advancedConfig);
    const previous = await this.repository.getDesired(id, auth);
    const merged = {
      serverId: previous.serverId, name: previous.name, tag: previous.tag, listenIp: previous.listenIp, port: previous.port, protocol: previous.protocol,
      transport: previous.transport, security: previous.security, enabled: previous.enabled, protocolConfig: previous.protocolConfig, transportConfig: previous.transportConfig,
      securityConfig: previous.securityConfig, sniffing: previous.sniffing, sockopt: previous.sockopt, fallbacks: previous.fallbacks, routing: previous.routing,
      trafficLimit: previous.trafficLimit, expiresAt: previous.expiresAt, advancedConfig: previous.advancedConfig, ...patch,
    };
    if (merged.securityConfig.kind === "REALITY" && merged.securityConfig.privateKey === PRESERVE_SECRET_VALUE) {
      if (previous.securityConfig.kind !== "REALITY") throw new ApiError(400, "REALITY_PRIVATE_KEY_REQUIRED", "A REALITY private key is required");
      merged.securityConfig = { ...merged.securityConfig, privateKey: previous.securityConfig.privateKey };
    }
    const input = inboundWriteSchema.parse(merged);
    const inbound = await this.repository.update(id, input, auth);
    return { inbound, apply: await this.apply(inbound, previous.tag, auth.userId) };
  }

  async duplicate(id: string, auth: AuthContext): Promise<MutationResult> {
    const inbound = await this.repository.duplicate(id, auth);
    return { inbound, apply: await this.apply(inbound, null, auth.userId) };
  }

  async createClient(inboundId: string, input: InboundClientRequestInput, auth: AuthContext): Promise<MutationResult> {
    const current = await this.repository.getDesired(inboundId, auth);
    const defaults = await this.defaults?.userDefaults();
    const defaultExpiration = defaults?.durationDays ? new Date(Date.now() + defaults.durationDays * 86_400_000).toISOString() : null;
    const parsed = inboundClientWriteSchema.parse({
      ...input, credential: input.credential || generatedCredential(current.protocol),
      enabled: input.enabled ?? defaults?.enabled ?? true,
      trafficLimit: input.trafficLimit !== undefined ? input.trafficLimit : defaults?.trafficLimitBytes ?? null,
      expiresAt: input.expiresAt !== undefined ? input.expiresAt : defaultExpiration,
      subscriptionEnabled: input.subscriptionEnabled ?? defaults?.subscriptionEnabled ?? false,
    });
    const inbound = await this.repository.createClient(inboundId, parsed, auth);
    return { inbound, apply: await this.apply(inbound, inbound.tag, auth.userId) };
  }

  async rotateClient(inboundId: string, clientId: string, credential: string | undefined, auth: AuthContext): Promise<MutationResult> {
    const current = await this.repository.getDesired(inboundId, auth);
    const inbound = await this.repository.rotateClient(inboundId, clientId, credential || generatedCredential(current.protocol), auth);
    return { inbound, apply: await this.apply(inbound, inbound.tag, auth.userId) };
  }

  async deleteClient(inboundId: string, clientId: string, auth: AuthContext): Promise<MutationResult> {
    const current = await this.repository.getDesired(inboundId, auth);
    const inbound = await this.repository.deleteClient(inboundId, clientId, auth);
    return { inbound, apply: await this.apply(inbound, current.tag, auth.userId) };
  }

  async setEnabled(id: string, enabled: boolean, auth: AuthContext): Promise<MutationResult> {
    const current = await this.repository.getDesired(id, auth);
    const inbound = await this.repository.setEnabled(id, enabled, auth);
    return { inbound, apply: await this.apply(inbound, current.tag, auth.userId) };
  }

  async delete(id: string, auth: AuthContext) {
    const current = await this.repository.getDesired(id, auth);
    const disabled = current.enabled ? await this.repository.setEnabled(id, false, auth) : current;
    const apply = await this.apply(disabled, current.tag, auth.userId);
    if (apply.state === "APPLIED") await this.repository.remove(id, auth);
    return { inbound: disabled, apply, deleted: apply.state === "APPLIED" };
  }

  async deleteExpired(inboundId: string | null, auth: AuthContext) {
    const affectedIds = await this.repository.deleteExpired(inboundId, auth);
    const outcomes: ApplyOutcome[] = [];
    for (const id of affectedIds) { const inbound = await this.repository.getDesired(id, auth); outcomes.push(await this.apply(inbound, inbound.tag, auth.userId)); }
    return { deletedFromInboundCount: affectedIds.length, outcomes };
  }

  async resetTraffic(inboundId: string | null, clientId: string | null, target: "INBOUND" | "CLIENT", auth: AuthContext) {
    const targets = inboundId ? [await this.repository.getDesired(inboundId, auth)] : await Promise.all((await this.repository.list(auth)).map((item) => this.repository.getDesired(item.id, auth)));
    for (const inbound of targets) {
      const clients = clientId ? inbound.clients.filter((entry) => entry.id === clientId) : inbound.clients;
      if (target === "CLIENT") {
        for (const client of clients) await this.runtime.resetTraffic(inbound.xrayInstanceId, inbound.tag, client.email || `${client.publicId}@nr-panel.local`);
      } else await this.runtime.resetTraffic(inbound.xrayInstanceId, inbound.tag);
    }
    return this.repository.resetTraffic(inboundId, clientId, target, auth);
  }

  async apply(inbound: DesiredInbound, previousTag: string | null, actorId: string): Promise<ApplyOutcome> {
    const capabilities = await this.runtime.capabilities(inbound.xrayInstanceId);
    const policy = await this.defaults?.xrayPolicy?.();
    let desired: XrayConfigDocument;
    try {
      const instanceInbounds = await this.repository.getInstanceDesired(inbound.xrayInstanceId);
      desired = buildXrayInstanceDocument(instanceInbounds, capabilities.available ? capabilities.xhttp : true, policy);
    } catch (error) {
      const details = errorDetails(error);
      const revisionId = await this.repository.beginApply({ inboundId: inbound.id, tenantId: inbound.tenantId, desiredRevision: inbound.desiredRevision, strategy: "RESTART_REQUIRED", desiredHash: configHash(inbound), previousHash: null, actorId });
      await this.repository.markApplyFailure(inbound.id, revisionId, details.code, details.message, false, error instanceof InboundConfigValidationError ? error.validationErrors : []);
      return { state: "FAILED", strategy: "RESTART_REQUIRED", reason: "Typed desired-state validation failed", errorCode: details.code, errorMessage: details.message };
    }

    let previous: XrayConfigDocument;
    try { previous = await this.runtime.currentConfig(inbound.xrayInstanceId); }
    catch (error) {
      const details = errorDetails(error);
      const revisionId = await this.repository.beginApply({ inboundId: inbound.id, tenantId: inbound.tenantId, desiredRevision: inbound.desiredRevision, strategy: "RESTART_REQUIRED", desiredHash: configHash(desired), previousHash: null, actorId });
      await this.repository.markApplyFailure(inbound.id, revisionId, details.code, details.message, false);
      return { state: "FAILED", strategy: "RESTART_REQUIRED", reason: "Applied Xray state could not be read", errorCode: details.code, errorMessage: details.message };
    }

    let plan = computeApplyPlan(previous, desired, previousTag, inbound.tag);
    if (policy && !policy.hotApply && (plan.strategy === "HOT_CLIENTS" || plan.strategy === "HOT_INBOUND")) plan = { ...plan, strategy: "RESTART_REQUIRED", reason: "Hot apply is disabled by the persisted Xray policy" };
    if (plan.strategy === "HOT_CLIENTS" && !capabilities.userMutation) plan = { ...plan, strategy: "RESTART_REQUIRED", reason: "Runtime lacks hot user mutation support" };
    if (plan.strategy === "HOT_INBOUND" && !capabilities.handlerService) plan = { ...plan, strategy: "RESTART_REQUIRED", reason: "Runtime lacks HandlerService support" };
    const revisionId = await this.repository.beginApply({ inboundId: inbound.id, tenantId: inbound.tenantId, desiredRevision: inbound.desiredRevision, strategy: plan.strategy, desiredHash: configHash(desired), previousHash: configHash(previous), actorId });
    let applyStarted = false;
    try {
      await this.runtime.validateConfig(inbound.xrayInstanceId, desired);
      const backupId = await this.repository.saveBackup(inbound, previous, configHash(previous), actorId);
      await this.repository.attachBackup(revisionId, backupId);
      applyStarted = plan.strategy !== "NOOP";
      const nextInbound = desired.inbounds.find((entry) => entry.tag === inbound.tag) || null;
      if (plan.strategy === "HOT_CLIENTS") {
        if (plan.removedUserEmails.length) await this.runtime.hotRemoveUsers(inbound.xrayInstanceId, previousTag || inbound.tag, plan.removedUserEmails);
        if (plan.addedUsers.length) await this.runtime.hotAddUsers(inbound.xrayInstanceId, inbound.tag, plan.addedUsers);
      } else if (plan.strategy === "HOT_INBOUND") await this.runtime.hotReplaceInbound(inbound.xrayInstanceId, previousTag, nextInbound);
      else if (plan.strategy === "RESTART_REQUIRED") await this.runtime.restartWithConfig(inbound.xrayInstanceId, desired);
      await this.runtime.healthCheck(inbound.xrayInstanceId);
      await this.repository.markApplySuccess(inbound.id, revisionId, inbound.desiredRevision);
      return { state: "APPLIED", strategy: plan.strategy, reason: plan.reason };
    } catch (error) {
      const details = errorDetails(error);
      let rolledBack = false;
      if (applyStarted) {
        try { await this.runtime.restoreConfig(inbound.xrayInstanceId, previous); await this.runtime.healthCheck(inbound.xrayInstanceId); rolledBack = true; }
        catch { rolledBack = false; }
      }
      await this.repository.markApplyFailure(inbound.id, revisionId, details.code, details.message, rolledBack, error instanceof InboundConfigValidationError ? error.validationErrors : []);
      return { state: rolledBack ? "ROLLED_BACK" : "FAILED", strategy: plan.strategy, reason: plan.reason, errorCode: details.code, errorMessage: details.message };
    }
  }
}

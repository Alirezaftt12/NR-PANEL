import { randomUUID } from "node:crypto";
import { canAccessTenant, ROLES, type InboundServerOption, type InboundSummary } from "../packages/shared/src/index.js";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../apps/api/src/domain/identity.js";
import { InboundService } from "../apps/api/src/domain/inbounds/service.js";
import { computeApplyPlan } from "../apps/api/src/domain/inbounds/apply-planner.js";
import { buildXrayInstanceDocument } from "../apps/api/src/domain/inbounds/config-builder.js";
import type { ApplyRevisionInput, InboundRepository } from "../apps/api/src/domain/inbounds/repository.js";
import type { DesiredInbound, RuntimeCapabilities, XrayConfigDocument, XrayInboundConfig, XrayRuntime, XrayUser } from "../apps/api/src/domain/inbounds/model.js";
import type { InboundClientWriteInput, InboundWriteInput } from "../apps/api/src/domain/inbounds/schemas.js";
import { ApiError } from "../apps/api/src/lib/errors.js";

const owner: AuthContext = { userId: "owner", username: "owner", email: null, role: ROLES.OWNER, permissions: [], primaryTenantId: "system", tenantIds: [], sessionId: "session", sessionExpiresAt: "2099-01-01T00:00:00.000Z" };
const tenantAAdmin: AuthContext = { ...owner, userId: "admin-a", role: ROLES.ADMIN, primaryTenantId: "tenant-a", tenantIds: ["tenant-a"] };
const tenantBAdmin: AuthContext = { ...owner, userId: "admin-b", role: ROLES.ADMIN, primaryTenantId: "tenant-b", tenantIds: ["tenant-b"] };

function writeInput(overrides: Partial<InboundWriteInput> = {}): InboundWriteInput {
  return {
    serverId: "11111111-1111-4111-8111-111111111111", name: "Main VLESS", tag: `main-${randomUUID().slice(0, 8)}`, listenIp: "0.0.0.0", port: 443,
    protocol: "VLESS", transport: "TCP", security: "TLS", enabled: true,
    protocolConfig: { kind: "VLESS", decryption: "none" }, transportConfig: { kind: "TCP", headerType: "none", requestPath: "/" },
    securityConfig: { kind: "TLS", alpn: ["h2", "http/1.1"], minVersion: "1.2", certificateFile: "/etc/xray/cert.pem", keyFile: "/etc/xray/key.pem", rejectUnknownSni: false },
    sniffing: { enabled: true, destinationOverrides: ["http", "tls"], metadataOnly: false, routeOnly: false, domainsExcluded: [], domainsOnly: [] },
    sockopt: { acceptProxyProtocol: false, tcpFastOpen: false, domainStrategy: "AsIs", trustedXForwardedFor: [] }, fallbacks: [], routing: {}, trafficLimit: null, expiresAt: null, advancedConfig: null,
    ...overrides,
  };
}

class MemoryInboundRepository implements InboundRepository {
  inbounds = new Map<string, DesiredInbound>();
  server: InboundServerOption = { id: "11111111-1111-4111-8111-111111111111", name: "Node A", status: "ONLINE", xrayVersion: "26.7.11" };
  applyFailures: string[] = [];

  private authorized(inbound: DesiredInbound, auth: AuthContext) {
    if (!canAccessTenant(auth.role, auth.tenantIds, inbound.tenantId)) throw new ApiError(404, "INBOUND_NOT_FOUND", "Inbound not found");
  }
  async list(auth: AuthContext): Promise<InboundSummary[]> {
    return [...this.inbounds.values()].filter((inbound) => canAccessTenant(auth.role, auth.tenantIds, inbound.tenantId)).map((inbound) => ({
      ...inbound, clientCount: inbound.clients.length, activeClientCount: inbound.clients.filter((client) => client.enabled).length,
      clients: inbound.clients.map((client) => ({ ...client, credentialPreview: "••••••••", expired: Boolean(client.expiresAt && Date.parse(client.expiresAt) <= Date.now()) })),
    }));
  }
  async serverOptions(auth: AuthContext) { return auth.role === ROLES.OWNER || auth.tenantIds.includes("tenant-a") ? [this.server] : []; }
  async getDesired(id: string, auth: AuthContext) { const inbound = this.inbounds.get(id); if (!inbound) throw new ApiError(404, "INBOUND_NOT_FOUND", "Inbound not found"); this.authorized(inbound, auth); return inbound; }
  async getInstanceDesired(instanceId: string) { return [...this.inbounds.values()].filter((inbound) => inbound.xrayInstanceId === instanceId); }
  async create(input: InboundWriteInput, auth: AuthContext) {
    if (auth.role !== ROLES.OWNER && !auth.tenantIds.includes("tenant-a")) throw new ApiError(404, "SERVER_NOT_FOUND", "Server not found");
    const id = randomUUID();
    const inbound: DesiredInbound = {
      id, xrayInstanceId: "xray-a", tenantId: "tenant-a", serverId: input.serverId, serverName: this.server.name, name: input.name, tag: input.tag, listenIp: input.listenIp,
      port: input.port, protocol: input.protocol, transport: input.transport, security: input.security, enabled: input.enabled, protocolConfig: input.protocolConfig,
      transportConfig: input.transportConfig, securityConfig: input.securityConfig, sniffing: input.sniffing, sockopt: input.sockopt, fallbacks: input.fallbacks,
      routing: input.routing, advancedConfig: input.advancedConfig, trafficLimit: input.trafficLimit, trafficUsed: "0", expiresAt: input.expiresAt,
      desiredRevision: 1, appliedRevision: null, applyStatus: "PENDING", lastApplyError: null, clients: [],
    };
    this.inbounds.set(id, inbound); return inbound;
  }
  async update(id: string, input: InboundWriteInput, auth: AuthContext) { const inbound = await this.getDesired(id, auth); Object.assign(inbound, input, { desiredRevision: inbound.desiredRevision + 1, applyStatus: "PENDING" as const }); return inbound; }
  async duplicate(id: string, auth: AuthContext) { const source = await this.getDesired(id, auth); return this.create(writeInput({ ...source, serverId: source.serverId, tag: `${source.tag}-copy`, name: `${source.name} copy`, port: source.port + 1, enabled: false }), auth); }
  async createClient(inboundId: string, input: InboundClientWriteInput, auth: AuthContext) {
    const inbound = await this.getDesired(inboundId, auth); const clientId = randomUUID();
    inbound.clients.push({ id: clientId, userId: randomUUID(), name: input.name, email: input.email, publicId: randomUUID(), credential: input.credential || randomUUID(), flow: input.flow, enabled: input.enabled, trafficLimit: input.trafficLimit, trafficUsed: "128", expiresAt: input.expiresAt, subscriptionEnabled: input.subscriptionEnabled });
    inbound.desiredRevision += 1; inbound.applyStatus = "PENDING"; return inbound;
  }
  async rotateClient(inboundId: string, clientId: string, credential: string, auth: AuthContext) { const inbound = await this.getDesired(inboundId, auth); const client = inbound.clients.find((entry) => entry.id === clientId)!; client.credential = credential; inbound.desiredRevision += 1; return inbound; }
  async deleteClient(inboundId: string, clientId: string, auth: AuthContext) { const inbound = await this.getDesired(inboundId, auth); inbound.clients = inbound.clients.filter((client) => client.id !== clientId); inbound.desiredRevision += 1; return inbound; }
  async setEnabled(id: string, enabled: boolean, auth: AuthContext) { const inbound = await this.getDesired(id, auth); inbound.enabled = enabled; inbound.desiredRevision += 1; return inbound; }
  async markPending(id: string, auth: AuthContext) { const inbound = await this.getDesired(id, auth); inbound.desiredRevision += 1; inbound.applyStatus = "PENDING"; }
  async remove(id: string, auth: AuthContext) { await this.getDesired(id, auth); this.inbounds.delete(id); }
  async deleteExpired(inboundId: string | null, auth: AuthContext) { const items = inboundId ? [await this.getDesired(inboundId, auth)] : [...this.inbounds.values()].filter((inbound) => canAccessTenant(auth.role, auth.tenantIds, inbound.tenantId)); const affected: string[] = []; for (const inbound of items) { const count = inbound.clients.length; inbound.clients = inbound.clients.filter((client) => !client.expiresAt || Date.parse(client.expiresAt) > Date.now()); if (count !== inbound.clients.length) { inbound.desiredRevision += 1; affected.push(inbound.id); } } return affected; }
  async resetTraffic(inboundId: string | null, clientId: string | null, target: "INBOUND" | "CLIENT", auth: AuthContext) { const items = inboundId ? [await this.getDesired(inboundId, auth)] : [...this.inbounds.values()].filter((inbound) => canAccessTenant(auth.role, auth.tenantIds, inbound.tenantId)); let count = 0; for (const inbound of items) { if (target === "INBOUND") { inbound.trafficUsed = "0"; count += 1; } else for (const client of inbound.clients.filter((entry) => !clientId || entry.id === clientId)) { client.trafficUsed = "0"; count += 1; } } return count; }
  async saveBackup() { return randomUUID(); }
  async beginApply(_input: ApplyRevisionInput) { return randomUUID(); }
  async attachBackup() {}
  async markApplySuccess(inboundId: string, _revisionId: string, revision: number) { const inbound = this.inbounds.get(inboundId)!; inbound.applyStatus = "APPLIED"; inbound.appliedRevision = revision; }
  async markApplyFailure(inboundId: string, _revisionId: string, _code: string, message: string, rolledBack: boolean) { const inbound = this.inbounds.get(inboundId)!; inbound.applyStatus = rolledBack ? "ROLLED_BACK" : "FAILED"; inbound.lastApplyError = message; this.applyFailures.push(message); }
}

class FakeRuntime implements XrayRuntime {
  current: XrayConfigDocument = { inbounds: [] };
  calls: string[] = [];
  failHealthOnce = false;
  capabilitiesValue: RuntimeCapabilities = { available: true, handlerService: true, userMutation: true, xhttp: true, configTest: true, statsReset: true };
  async capabilities() { return this.capabilitiesValue; }
  async currentConfig() { return structuredClone(this.current); }
  async validateConfig() { this.calls.push("validate"); }
  async hotAddUsers(_instanceId: string, inboundTag: string, users: XrayUser[]) { this.calls.push("hot-add-users"); const inbound = this.current.inbounds.find((entry) => entry.tag === inboundTag)!; const key = "clients" in inbound.settings ? "clients" : "users"; const existing = (inbound.settings[key] || []) as XrayUser[]; inbound.settings[key] = [...existing, ...users]; }
  async hotRemoveUsers(_instanceId: string, inboundTag: string, emails: string[]) { this.calls.push("hot-remove-users"); const inbound = this.current.inbounds.find((entry) => entry.tag === inboundTag)!; const key = "clients" in inbound.settings ? "clients" : "users"; inbound.settings[key] = ((inbound.settings[key] || []) as XrayUser[]).filter((user) => !emails.includes(user.email)); }
  async hotReplaceInbound(_instanceId: string, previousTag: string | null, inbound: XrayInboundConfig | null) { this.calls.push("hot-replace-inbound"); this.current.inbounds = this.current.inbounds.filter((entry) => entry.tag !== previousTag); if (inbound) this.current.inbounds.push(structuredClone(inbound)); }
  async restartWithConfig(_instanceId: string, config: XrayConfigDocument) { this.calls.push("restart"); this.current = structuredClone(config); }
  async healthCheck() { this.calls.push("health"); if (this.failHealthOnce) { this.failHealthOnce = false; throw new Error("health check failed"); } }
  async restoreConfig(_instanceId: string, config: XrayConfigDocument) { this.calls.push("restore"); this.current = structuredClone(config); }
  async resetTraffic() { this.calls.push("reset-traffic"); }
}

function setup() { const repository = new MemoryInboundRepository(); const runtime = new FakeRuntime(); return { repository, runtime, service: new InboundService(repository, runtime) }; }

describe("inbound desired-state lifecycle", () => {
  it("creates an inbound and hot-applies it through HandlerService", async () => { const { repository, runtime, service } = setup(); const result = await service.create(writeInput(), tenantAAdmin); expect(repository.inbounds.size).toBe(1); expect(result.apply).toMatchObject({ state: "APPLIED", strategy: "HOT_INBOUND" }); expect(runtime.calls).toContain("hot-replace-inbound"); });
  it("creates a child client under its inbound and uses hot user mutation", async () => { const { service, runtime } = setup(); const created = await service.create(writeInput(), tenantAAdmin); runtime.calls = []; const result = await service.createClient(created.inbound.id, { name: "Ali", email: "ali@example.test", credential: randomUUID(), enabled: true, trafficLimit: "1024", expiresAt: null, subscriptionEnabled: false, flow: "xtls-rprx-vision" }, tenantAAdmin); expect(result.inbound.clients).toHaveLength(1); expect(result.apply.strategy).toBe("HOT_CLIENTS"); expect(runtime.calls).toContain("hot-add-users"); });
  it("rejects an invalid typed combination before any runtime apply", async () => { const { service, runtime } = setup(); const result = await service.create(writeInput({ fallbacks: [{ destination: "127.0.0.1:80", proxyProtocolVersion: 0 }], securityConfig: { kind: "TLS", alpn: ["h2"], minVersion: "1.2", certificateFile: "/cert", keyFile: "/key", rejectUnknownSni: false } }), tenantAAdmin); expect(result.apply).toMatchObject({ state: "FAILED", errorCode: "XRAY_CONFIG_INVALID" }); expect(runtime.calls).toHaveLength(0); });
  it("restores the backup when post-apply health checking fails", async () => { const { service, runtime } = setup(); runtime.failHealthOnce = true; const result = await service.create(writeInput(), tenantAAdmin); expect(result.apply.state).toBe("ROLLED_BACK"); expect(runtime.calls).toContain("restore"); expect(runtime.current.inbounds).toHaveLength(0); });
  it("deletes expired clients and reapplies the desired state", async () => { const { service } = setup(); const created = await service.create(writeInput(), tenantAAdmin); await service.createClient(created.inbound.id, { name: "Expired", email: null, credential: randomUUID(), enabled: true, trafficLimit: null, expiresAt: "2020-01-01T00:00:00.000Z", subscriptionEnabled: false, flow: null }, tenantAAdmin); const result = await service.deleteExpired(created.inbound.id, tenantAAdmin); expect(result.deletedFromInboundCount).toBe(1); expect((await service.detail(created.inbound.id, tenantAAdmin)).clients).toHaveLength(0); });
  it("resets runtime and persisted traffic counters together", async () => { const { service, runtime } = setup(); const created = await service.create(writeInput(), tenantAAdmin); const withClient = await service.createClient(created.inbound.id, { name: "Traffic", email: null, credential: randomUUID(), enabled: true, trafficLimit: null, expiresAt: null, subscriptionEnabled: false, flow: null }, tenantAAdmin); const count = await service.resetTraffic(created.inbound.id, withClient.inbound.clients[0].id, "CLIENT", tenantAAdmin); expect(count).toBe(1); expect(withClient.inbound.clients[0].trafficUsed).toBe("0"); expect(runtime.calls).toContain("reset-traffic"); });
  it("duplicates an inbound disabled on a different port", async () => { const { service } = setup(); const source = await service.create(writeInput({ port: 8443 }), tenantAAdmin); const duplicate = await service.duplicate(source.inbound.id, tenantAAdmin); expect(duplicate.inbound.enabled).toBe(false); expect(duplicate.inbound.port).toBe(8444); expect(duplicate.inbound.tag).not.toBe(source.inbound.tag); });
  it("builds official Xray log/statistics policy and requires a safe restart for global changes", async () => {
    const { repository } = setup();
    const inbound = await repository.create(writeInput(), tenantAAdmin);
    const baseline = buildXrayInstanceDocument([inbound], true, { hotApply: true, logLevel: "warning", statsEnabled: false });
    const withStats = buildXrayInstanceDocument([inbound], true, { hotApply: true, logLevel: "error", statsEnabled: true });
    expect(withStats.log).toEqual({ loglevel: "error" });
    expect(withStats.stats).toEqual({});
    expect(withStats.policy?.levels?.[0]).toMatchObject({ statsUserUplink: true, statsUserDownlink: true });
    expect(computeApplyPlan(baseline, withStats, inbound.tag, inbound.tag)).toMatchObject({ strategy: "RESTART_REQUIRED" });
  });
});

describe("inbound authorization", () => {
  it("limits Advanced JSON to OWNER or authorized ADMIN", async () => { const { service } = setup(); await expect(service.create(writeInput({ advancedConfig: { allocate: { strategy: "always" } } }), { ...tenantAAdmin, role: ROLES.RESELLER })).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" }); });
  it("prevents cross-tenant reads even when the inbound ID is known", async () => { const { service } = setup(); const created = await service.create(writeInput(), tenantAAdmin); await expect(service.detail(created.inbound.id, tenantBAdmin)).rejects.toMatchObject({ code: "INBOUND_NOT_FOUND" }); });
});

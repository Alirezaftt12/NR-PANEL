import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS, PRESERVE_SECRET_VALUE, ROLES, hasPermission, type MasterSettingsSection, type Permission } from "../packages/shared/src/index.js";
import type { AuthContext, RequestMetadata } from "../apps/api/src/domain/identity.js";
import type { StoredSettingsRow } from "../apps/api/src/domain/settings/repository.js";
import { SettingsService, ipMatchesCidr } from "../apps/api/src/domain/settings/service.js";
import { apiTokenCreateSchema, defaultSettings, settingsSchemas } from "../apps/api/src/domain/settings/schemas.js";
import { createAuthorization } from "../apps/api/src/lib/auth.js";

const metadata: RequestMetadata = { ip: "127.0.0.1", userAgent: "vitest", requestId: randomUUID() };
const owner: AuthContext = { userId: randomUUID(), username: "owner-secure", email: null, role: ROLES.OWNER, permissions: [], primaryTenantId: randomUUID(), tenantIds: [], sessionId: randomUUID(), sessionExpiresAt: "2099-01-01T00:00:00.000Z" };

class MemorySettingsRepository {
  rowsBySection = new Map<MasterSettingsSection, StoredSettingsRow>();
  secrets = new Map<string, string>();
  lastSave: Record<string, unknown> | null = null;
  async rows() { return [...this.rowsBySection.values()]; }
  async row(section: MasterSettingsSection) { return this.rowsBySection.get(section) ?? null; }
  async configuredSecrets() { return new Set(this.secrets.keys()); }
  async secret(name: string) { return this.secrets.get(name) ?? null; }
  async save(input: { section: MasterSettingsSection; value: unknown; restartScopes: StoredSettingsRow["restartScopes"]; secrets: Record<string, string | null>; actor: { userId: string }; changedFields: string[] }) {
    this.lastSave = input as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(input.secrets)) value === null ? this.secrets.delete(name) : this.secrets.set(name, value);
    const current = this.rowsBySection.get(input.section);
    const row: StoredSettingsRow = { namespace: input.section, value: input.value, version: (current?.version ?? 0) + 1, restartScopes: [...new Set([...(current?.restartScopes ?? []), ...input.restartScopes])], updatedBy: input.actor.userId, updatedAt: new Date() };
    this.rowsBySection.set(input.section, row); return row;
  }
  async history() { return []; }
  async diagnostics() { return { servers: { total: 2, online: 1 }, xray: { total: 2, running: 1, configValid: 1, versions: ["26.7.11"], nodes: ["node-a"] } }; }
  async listApiTokens() { return []; }
  async createApiToken() { return { token: { id: randomUUID(), name: "CI", prefix: "nrp_12345678", permissions: [PERMISSIONS.SETTINGS_VIEW], cidrAllowlist: [], expiresAt: null, lastUsedAt: null, enabled: true, createdAt: new Date().toISOString(), revokedAt: null }, secret: "nrp_once_only_secret_value_that_is_long_enough" }; }
  async setApiTokenState() { return true; }
  async revokeApiToken() { return true; }
  async resolveApiToken() { return null; }
  async tokenTenantIds() { return []; }
  async revokeOtherSessions() { return 2; }
}

function setup() { const repository = new MemorySettingsRepository(); return { repository, service: new SettingsService(repository as never) }; }
const connection = { host: "panel.example.test", protocol: "https", port: 443, https: true, environment: "test", panelVersion: "0.1.0" };

describe("typed settings validation", () => {
  it("rejects invalid ports, CIDRs, URLs and subscription paths", () => {
    expect(settingsSchemas.network.safeParse({ ...defaultSettings.network, port: 70_000 }).success).toBe(false);
    expect(settingsSchemas.network.safeParse({ ...defaultSettings.network, trustedProxyCidrs: ["10.0.0.1/99"] }).success).toBe(false);
    expect(settingsSchemas.general.safeParse({ ...defaultSettings.general, publicPanelUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(settingsSchemas.subscription.safeParse({ ...defaultSettings.subscription, basePath: "/../escape/" }).success).toBe(false);
  });
  it("validates quota defaults, agent timeouts, traffic retention and backups", () => {
    expect(settingsSchemas.users.safeParse({ ...defaultSettings.users, trafficLimitBytes: "-1" }).success).toBe(false);
    expect(settingsSchemas.agents.safeParse({ ...defaultSettings.agents, heartbeatIntervalSeconds: 60, offlineTimeoutSeconds: 30 }).success).toBe(false);
    expect(settingsSchemas.traffic.safeParse({ ...defaultSettings.traffic, rawRetentionDays: 100, hourlyRetentionDays: 20 }).success).toBe(false);
    expect(settingsSchemas.backup.safeParse({ ...defaultSettings.backup, database: false, applicationSettings: false, xrayConfigurations: false, subpanelData: false, subscriptionMetadata: false }).success).toBe(false);
  });
  it("validates API token CIDR restrictions and future expiration", () => {
    expect(apiTokenCreateSchema.safeParse({ name: "CI", permissions: [PERMISSIONS.SETTINGS_VIEW], expiresAt: null, cidrAllowlist: ["203.0.113.0/24"] }).success).toBe(true);
    expect(apiTokenCreateSchema.safeParse({ name: "CI", permissions: [PERMISSIONS.SETTINGS_VIEW], expiresAt: null, cidrAllowlist: ["203.0.113.0/64"] }).success).toBe(false);
    expect(ipMatchesCidr("203.0.113.7", "203.0.113.0/24")).toBe(true);
    expect(ipMatchesCidr("203.0.114.7", "203.0.113.0/24")).toBe(false);
  });
});

describe("settings persistence and redaction", () => {
  it("returns safe defaults when no row exists and records restart-required network state", async () => {
    const { service } = setup();
    expect((await service.section("general")).value.panelName).toBe("NR PANEL");
    const updated = await service.update("network", { ...defaultSettings.network, port: 2053 }, owner, metadata);
    expect(updated.value.port).toBe(2053); expect(updated.restartRequired).toContain("PANEL");
  });
  it("masks Telegram and SMTP secrets and never stores plaintext in section history metadata", async () => {
    const { service, repository } = setup();
    await service.update("telegram", { ...defaultSettings.telegram, botToken: "123456:secret-token", enabled: true }, owner, metadata);
    const telegram = await service.section("telegram");
    expect(telegram.value.botToken).toBe(PRESERVE_SECRET_VALUE); expect(telegram.configuredSecrets).toEqual(["botToken"]);
    expect((repository.lastSave?.value as Record<string, unknown>).botToken).toBe("");
    expect(JSON.stringify(repository.lastSave?.value)).not.toContain("secret-token");
    await service.update("email", { ...defaultSettings.email, smtpHost: "smtp.example.test", fromAddress: "panel@example.test", recipients: ["ops@example.test"], password: "smtp-secret", enabled: true }, owner, metadata);
    expect((await service.section("email")).value.password).toBe(PRESERVE_SECRET_VALUE);
    expect(JSON.stringify(repository.lastSave?.value)).not.toContain("smtp-secret");
  });
  it("persists maintenance mode and keeps backup/update operations explicitly unavailable", async () => {
    const { service } = setup();
    await service.update("general", { ...defaultSettings.general, maintenanceMode: true }, owner, metadata);
    expect(await service.isMaintenanceMode()).toBe(true);
    expect(() => service.runBackup()).toThrow(expect.objectContaining({ code: "BACKUP_RUNTIME_UNAVAILABLE" }));
    expect(() => service.checkUpdates()).toThrow(expect.objectContaining({ code: "UPDATE_PROVIDER_UNAVAILABLE" }));
  });
  it("shows an API token secret only in the create result while list responses remain summaries", async () => {
    const { service } = setup();
    const created = await service.createApiToken({ name: "CI", permissions: [PERMISSIONS.SETTINGS_VIEW], expiresAt: null, cidrAllowlist: [] }, owner, metadata);
    expect(created.secret).toMatch(/^nrp_/); expect(await service.listApiTokens(owner)).toEqual([]);
  });
  it("prevents an ADMIN from escalating permissions through an API token", async () => {
    const { service } = setup(); const admin = { ...owner, role: ROLES.ADMIN, permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_SECURITY_UPDATE] };
    await expect(service.createApiToken({ name: "Escalation", permissions: [PERMISSIONS.XRAY_CONTROL], expiresAt: null, cidrAllowlist: [] }, admin, metadata)).rejects.toMatchObject({ code: "API_TOKEN_PERMISSION_ESCALATION" });
  });
  it("delegates Xray validation only to the configured safe desired-state validator", async () => {
    const { service } = setup(); const validator = vi.fn().mockResolvedValue({ valid: true, inboundCount: 2 }); service.setXrayValidator(validator);
    await expect(service.validateXray(owner)).resolves.toMatchObject({ valid: true }); expect(validator).toHaveBeenCalledWith(owner);
  });
  it("persists Xray desired state before invoking the safe runtime applier", async () => {
    const { service, repository } = setup();
    const applier = vi.fn().mockImplementation(async () => {
      expect(repository.rowsBySection.get("xray")?.value).toMatchObject({ logLevel: "error", statsEnabled: false });
      return [{ state: "FAILED", strategy: "RESTART_REQUIRED", reason: "runtime unavailable", errorCode: "XRAY_RUNTIME_UNAVAILABLE" }];
    });
    service.setXrayApplier(applier);
    const result = await service.update("xray", { ...defaultSettings.xray, logLevel: "error", statsEnabled: false }, owner, metadata);
    expect(result.runtimeApply).toEqual([expect.objectContaining({ state: "FAILED", errorCode: "XRAY_RUNTIME_UNAVAILABLE" })]);
    expect(applier).toHaveBeenCalledWith(owner);
  });
  it("keeps non-negotiable Xray safety controls enforced by the schema", () => {
    expect(settingsSchemas.xray.safeParse({ ...defaultSettings.xray, automaticUpdates: true }).success).toBe(false);
    expect(settingsSchemas.xray.safeParse({ ...defaultSettings.xray, restartOnlyWhenRequired: false }).success).toBe(false);
  });
});

describe("master settings authorization", () => {
  it("requires granular ADMIN grants and never grants master access to a reseller by role", () => {
    expect(hasPermission(ROLES.ADMIN, [], PERMISSIONS.SETTINGS_SECURITY_UPDATE)).toBe(false);
    expect(hasPermission(ROLES.ADMIN, [PERMISSIONS.SETTINGS_SECURITY_UPDATE], PERMISSIONS.SETTINGS_SECURITY_UPDATE)).toBe(true);
    expect([ROLES.OWNER, ROLES.ADMIN]).not.toContain(ROLES.RESELLER);
  });
  it("the master role guard rejects a reseller even if a settings permission was forged", async () => {
    const reseller = { ...owner, role: ROLES.RESELLER, permissions: [PERMISSIONS.SETTINGS_VIEW] as Permission[] };
    const audit = vi.fn();
    const authorization = createAuthorization({ authenticate: vi.fn().mockResolvedValue(reseller) } as never, { recordAudit: audit } as never);
    const guard = authorization.requireRole(ROLES.OWNER, ROLES.ADMIN);
    await expect(guard({ cookies: { nr_session: "x".repeat(64) }, headers: {}, ip: "127.0.0.1", id: randomUUID(), url: "/api/v1/settings", method: "GET" } as never)).rejects.toMatchObject({ code: "AUTH_FORBIDDEN" });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: "PERMISSION_DENIED" }));
  });
});

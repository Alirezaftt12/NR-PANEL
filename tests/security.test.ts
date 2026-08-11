import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { canAccessTenant, hasPermission, PERMISSIONS, ROLES, type Permission, type Role } from "../packages/shared/src/index.js";
import { assertAdminMutationAllowed } from "../apps/api/src/domain/admin-policy.js";
import type { AuditEventInput, LoginAdmin, SessionRecord } from "../apps/api/src/domain/identity.js";
import { ApiError } from "../apps/api/src/lib/errors.js";
import { hashPassword, hashSessionToken, isWhitelistedAction, passwordSchema } from "../apps/api/src/lib/security.js";
import { loginSchema } from "../apps/api/src/routes/auth.js";
import type { AuthRepository, NewSession, SessionSummary } from "../apps/api/src/services/auth-repository.js";
import { AuthService } from "../apps/api/src/services/auth-service.js";
import { actionNeedsConfirmation, assertPermittedAction } from "../agent/src/security/actions.js";

const metadata = { ip: "127.0.0.1", userAgent: "vitest", requestId: randomUUID() };
let validHash: string;

beforeAll(async () => { validHash = await hashPassword("Valid-Password!2026"); });

class MemoryAuthRepository implements AuthRepository {
  admins = new Map<string, LoginAdmin>();
  sessions = new Map<string, { value: NewSession; revokedAt: Date | null; lastActivityAt: Date }>();
  permissions = new Map<string, Permission[]>();
  tenantIds = new Map<string, string[]>();
  failures: Array<{ identifierHash: string; ip: string | null; at: Date }> = [];
  audits: AuditEventInput[] = [];

  addAdmin(overrides: Partial<LoginAdmin> = {}) {
    const admin: LoginAdmin = { id: randomUUID(), username: "owner", email: "owner@example.test", passwordHash: validHash, role: ROLES.OWNER, status: "ACTIVE", enabled: true, ...overrides };
    this.admins.set(admin.id, admin);
    this.permissions.set(admin.id, []);
    this.tenantIds.set(admin.id, ["tenant-a"]);
    return admin;
  }

  async findAdminByIdentifier(identifier: string) { return [...this.admins.values()].find((admin) => admin.username === identifier || admin.email === identifier) ?? null; }
  async countRecentFailures(identifierHash: string, ip: string | null, since: Date) { return this.failures.filter((failure) => failure.at >= since && (failure.identifierHash === identifierHash || failure.ip === ip)).length; }
  async recordLoginFailure(identifierHash: string, meta: NewSession["metadata"]) { this.failures.push({ identifierHash, ip: meta.ip, at: new Date() }); }
  async createLoginSession(admin: LoginAdmin, session: NewSession) { this.sessions.set(session.tokenHash, { value: session, revokedAt: null, lastActivityAt: new Date() }); this.admins.set(admin.id, admin); }
  async resolveSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.sessions.get(tokenHash);
    if (!session) return null;
    const admin = this.admins.get(session.value.adminId)!;
    return { id: session.value.id, adminId: admin.id, username: admin.username, email: admin.email, role: admin.role, adminStatus: admin.status, enabled: admin.enabled, tenantId: this.tenantIds.get(admin.id)?.[0] ?? "tenant-a", expiresAt: session.value.expiresAt, revokedAt: session.revokedAt, lastActivityAt: session.lastActivityAt };
  }
  async getPermissions(adminId: string) { return this.permissions.get(adminId) ?? []; }
  async getTenantIds(adminId: string) { return this.tenantIds.get(adminId) ?? []; }
  async touchSession(sessionId: string, at: Date) { for (const session of this.sessions.values()) if (session.value.id === sessionId) session.lastActivityAt = at; }
  async revokeSession(sessionId: string, adminId: string, audit: AuditEventInput) { for (const session of this.sessions.values()) { if (session.value.id === sessionId && session.value.adminId === adminId && !session.revokedAt) { session.revokedAt = new Date(); this.audits.push(audit); return true; } } return false; }
  async revokeAllSessions(adminId: string, audit: AuditEventInput, exceptSessionId?: string) { let count = 0; for (const session of this.sessions.values()) { if (session.value.adminId === adminId && session.value.id !== exceptSessionId && !session.revokedAt) { session.revokedAt = new Date(); count += 1; } } this.audits.push(audit); return count; }
  async listSessions(adminId: string, currentSessionId: string): Promise<SessionSummary[]> { return [...this.sessions.values()].filter((session) => session.value.adminId === adminId && !session.revokedAt).map((session) => ({ id: session.value.id, ip: session.value.metadata.ip, userAgent: session.value.metadata.userAgent, createdAt: session.lastActivityAt, lastActivityAt: session.lastActivityAt, expiresAt: session.value.expiresAt, current: session.value.id === currentSessionId })); }
  async changePassword(adminId: string, passwordHash: string, currentSessionId: string, audit: AuditEventInput) { const admin = this.admins.get(adminId)!; this.admins.set(adminId, { ...admin, passwordHash }); await this.revokeAllSessions(adminId, audit, currentSessionId); }
  async recordAudit(event: AuditEventInput) { this.audits.push(event); }
}

function setup(overrides: Partial<LoginAdmin> = {}) {
  const repository = new MemoryAuthRepository();
  const admin = repository.addAdmin(overrides);
  return { repository, admin, service: new AuthService(repository) };
}

describe("login", () => {
  it("accepts valid credentials and creates a usable opaque session", async () => { const { service } = setup(); const result = await service.login("OWNER", "Valid-Password!2026", metadata); expect(result.token.length).toBeGreaterThan(32); expect(result.identity.role).toBe(ROLES.OWNER); });
  it("uses the same generic failure for invalid password and unknown account", async () => { const { service } = setup(); for (const [identifier, password] of [["owner", "Wrong-Password!1"], ["unknown", "Wrong-Password!1"]]) { await expect(service.login(identifier, password, metadata)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS", message: "Invalid credentials" }); } });
  it("rejects a disabled admin", async () => { const { service } = setup({ status: "DISABLED", enabled: false }); await expect(service.login("owner", "Valid-Password!2026", metadata)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" }); });
  it("rejects invalid login and password-change payloads", () => { expect(loginSchema.safeParse({ identifier: "x", password: "" }).success).toBe(false); expect(passwordSchema.safeParse("weak").success).toBe(false); });
});

describe("sessions", () => {
  it("accepts a valid session and rejects expired or revoked sessions", async () => { const { service, repository } = setup(); const valid = await service.login("owner", "Valid-Password!2026", metadata); expect((await service.authenticate(valid.token)).username).toBe("owner"); const stored = repository.sessions.get(hashSessionToken(valid.token))!; stored.value.expiresAt = new Date(Date.now() - 1000); await expect(service.authenticate(valid.token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); stored.value.expiresAt = new Date(Date.now() + 60_000); stored.revokedAt = new Date(); await expect(service.authenticate(valid.token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); });
  it("logout invalidates the current session", async () => { const { service } = setup(); const result = await service.login("owner", "Valid-Password!2026", metadata); await service.logout(result.identity, metadata); await expect(service.authenticate(result.token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); });
  it("logout-all invalidates every session", async () => { const { service } = setup(); const first = await service.login("owner", "Valid-Password!2026", metadata); const second = await service.login("owner", "Valid-Password!2026", { ...metadata, requestId: randomUUID() }); expect(await service.logoutAll(first.identity, metadata)).toBe(2); await expect(service.authenticate(first.token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); await expect(service.authenticate(second.token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); });
  it("disabled admin sessions stop working immediately", async () => { const { service, repository, admin } = setup(); const result = await service.login("owner", "Valid-Password!2026", metadata); repository.admins.set(admin.id, { ...admin, status: "DISABLED", enabled: false }); await expect(service.authenticate(result.token)).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); });
  it("applies the persisted session TTL and IP allowlist policy", async () => {
    const repository = new MemoryAuthRepository(); repository.addAdmin();
    const policy = { sessionTtlMinutes: 30, autoLogoutMinutes: 10, maximumConcurrentSessions: 0, loginRateLimit: 5, failedLoginThreshold: 5, lockoutMinutes: 15, minimumPasswordLength: 12, requireUppercase: true, requireLowercase: true, requireNumber: true, requireSpecial: true, ipAllowlist: ["127.0.0.1/32"] };
    const service = new AuthService(repository, { securityPolicy: async () => policy });
    const login = await service.login("owner", "Valid-Password!2026", metadata);
    expect(login.sessionTtlSeconds).toBe(1800);
    policy.ipAllowlist = ["10.0.0.0/8"];
    await expect(service.login("owner", "Valid-Password!2026", { ...metadata, requestId: randomUUID() })).rejects.toMatchObject({ code: "AUTH_IP_NOT_ALLOWED" });
  });
});

describe("permissions and admin protection", () => {
  it("OWNER has centralized bypass while ADMIN needs an explicit grant", () => { expect(hasPermission(ROLES.OWNER, [], PERMISSIONS.ADMIN_DISABLE)).toBe(true); expect(hasPermission(ROLES.ADMIN, [], PERMISSIONS.SERVER_CONTROL)).toBe(false); expect(hasPermission(ROLES.ADMIN, [PERMISSIONS.SERVER_CONTROL], PERMISSIONS.SERVER_CONTROL)).toBe(true); });
  it("non-owner cannot modify OWNER and OWNER is protected from this mutation path", () => { expect(() => assertAdminMutationAllowed(ROLES.ADMIN, ROLES.OWNER)).toThrow(ApiError); expect(() => assertAdminMutationAllowed(ROLES.OWNER, ROLES.OWNER)).toThrow(ApiError); expect(() => assertAdminMutationAllowed(ROLES.OWNER, ROLES.ADMIN)).not.toThrow(); });
});

describe("tenant isolation and IDOR", () => {
  it("reseller A cannot access tenant B and reseller B cannot access tenant A", () => { expect(canAccessTenant(ROLES.RESELLER, ["tenant-a"], "tenant-b")).toBe(false); expect(canAccessTenant(ROLES.RESELLER, ["tenant-b"], "tenant-a")).toBe(false); });
  it("rejects forged tenant IDs even when the resource ID is known", () => { const knownTenantAResource = { id: "known-resource-id", tenantId: "tenant-a" }; const resellerBTenants = ["tenant-b"]; expect(canAccessTenant(ROLES.RESELLER, resellerBTenants, knownTenantAResource.tenantId)).toBe(false); });
  it("OWNER may access tenant resources through the centralized bypass", () => { expect(canAccessTenant(ROLES.OWNER, [], "tenant-b")).toBe(true); });
});

describe("agent security", () => {
  it("permits only declared actions and requires confirmation for destructive operations", () => { expect(isWhitelistedAction("xray.restart")).toBe(true); expect(isWhitelistedAction("shell.exec")).toBe(false); expect(() => assertPermittedAction("rm -rf /")).toThrow(); expect(actionNeedsConfirmation("system.shutdown")).toBe(true); });
});

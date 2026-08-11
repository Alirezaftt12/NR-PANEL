import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS, ROLES, hasPermission, type SubpanelCapabilities } from "../packages/shared/src/index.js";
import type { AuthContext } from "../apps/api/src/domain/identity.js";
import { AUDIT_ACTIONS } from "../apps/api/src/domain/audit-actions.js";
import { generateClientUri } from "../apps/api/src/domain/subpanel/config-generator.js";
import {
  assertCapability, assertCreateQuota, assertInboundAssigned, assertTenantActive, assertTrafficQuota, portalTenantId, resolveExpiration,
} from "../apps/api/src/domain/subpanel/policy.js";
import { masterSubpanelCreateSchema, portalBulkActionSchema, portalUserCreateSchema } from "../apps/api/src/domain/subpanel/schemas.js";
import { SubpanelService } from "../apps/api/src/domain/subpanel/service.js";
import { ApiError } from "../apps/api/src/lib/errors.js";
import { createSubscriptionToken, hashSubscriptionToken } from "../apps/api/src/lib/security.js";

const reseller = (tenant = "tenant-a", memberships = [tenant]): AuthContext => ({
  userId: `reseller-${tenant}`, username: `reseller-${tenant}`, email: null, role: ROLES.RESELLER, permissions: [], primaryTenantId: tenant,
  tenantIds: memberships, sessionId: randomUUID(), sessionExpiresAt: "2099-01-01T00:00:00.000Z",
});

const quota = (overrides = {}) => ({ status: "ACTIVE" as const, expiresAt: new Date("2099-01-01T00:00:00.000Z"), userLimit: 10, trafficCredit: 1000n, createdUsers: 2, allocatedTraffic: 200n, ...overrides });

describe("sub-panel server-derived scope", () => {
  it("always selects the primary session tenant even when another membership exists", () => {
    expect(portalTenantId(reseller("tenant-a", ["tenant-a", "tenant-b"]))).toBe("tenant-a");
  });
  it("rejects OWNER and ADMIN from reseller-only endpoints", () => {
    expect(() => portalTenantId({ ...reseller(), role: ROLES.OWNER })).toThrowError(ApiError);
    expect(() => portalTenantId({ ...reseller(), role: ROLES.ADMIN })).toThrowError(ApiError);
  });
  it("rejects a missing or forged primary tenant", () => {
    expect(() => portalTenantId(reseller("tenant-b", ["tenant-a"]))).toThrowError(expect.objectContaining({ code: "SUBPANEL_TENANT_REQUIRED" }));
  });
  it("returns INBOUND_NOT_ASSIGNED for a known but unassigned inbound", () => {
    expect(() => assertInboundAssigned(false)).toThrowError(expect.objectContaining({ code: "INBOUND_NOT_ASSIGNED" }));
  });
  it("does not grant infrastructure permissions to a reseller role", () => {
    expect(hasPermission(ROLES.RESELLER, [], PERMISSIONS.XRAY_CONTROL)).toBe(false);
    expect(hasPermission(ROLES.RESELLER, [], PERMISSIONS.SERVER_CONTROL)).toBe(false);
    expect(hasPermission(ROLES.RESELLER, [], PERMISSIONS.SYSTEM_REBOOT)).toBe(false);
  });
});

describe("transactional quota and expiration policy", () => {
  it("rejects creation after the user limit", () => {
    expect(() => assertCreateQuota(quota({ createdUsers: 10 }), 1n)).toThrowError(expect.objectContaining({ code: "USER_LIMIT_EXCEEDED" }));
  });
  it("rejects allocation beyond the traffic credit while keeping actual usage separate", () => {
    expect(() => assertCreateQuota(quota({ allocatedTraffic: 900n }), 101n)).toThrowError(expect.objectContaining({ code: "TRAFFIC_QUOTA_EXCEEDED" }));
    expect(() => assertTrafficQuota(quota(), 1001n)).toThrowError(expect.objectContaining({ code: "TRAFFIC_QUOTA_EXCEEDED" }));
    expect(() => assertCreateQuota(quota(), null)).toThrowError(expect.objectContaining({ code: "TRAFFIC_QUOTA_EXCEEDED" }));
  });
  it("rejects disabled, expired, and date-expired sub-panels", () => {
    expect(() => assertTenantActive(quota({ status: "DISABLED" }))).toThrowError(expect.objectContaining({ code: "SUBPANEL_EXPIRED" }));
    expect(() => assertTenantActive(quota({ expiresAt: new Date("2020-01-01T00:00:00.000Z") }))).toThrowError(expect.objectContaining({ code: "SUBPANEL_EXPIRED" }));
  });
  it("caps a user expiration at the sub-panel expiration", () => {
    expect(() => resolveExpiration({ expiresAt: "2031-01-01T00:00:00.000Z" }, new Date("2030-01-01T00:00:00.000Z"), new Date("2029-01-01T00:00:00.000Z"))).toThrowError(expect.objectContaining({ code: "USER_EXPIRATION_EXCEEDS_SUBPANEL" }));
  });
});

describe("OWNER capabilities and validated inputs", () => {
  const disabled: SubpanelCapabilities = { subscription: false, trafficReset: false, extend: false, credentialRotation: false };
  it.each(Object.keys(disabled) as Array<keyof SubpanelCapabilities>)("enforces disabled %s capability", (capability) => {
    expect(() => assertCapability(disabled, capability)).toThrowError(expect.objectContaining({ code: "SUBPANEL_CAPABILITY_DISABLED" }));
  });
  it("requires destructive confirmation for expired-user cleanup", () => {
    expect(portalBulkActionSchema.safeParse({ action: "DELETE_EXPIRED", userIds: [] }).success).toBe(false);
    expect(portalBulkActionSchema.safeParse({ action: "DELETE_EXPIRED", userIds: [], confirmation: "CONFIRM" }).success).toBe(true);
  });
  it("validates create-user duration and master password policy", () => {
    expect(portalUserCreateSchema.safeParse({ inboundId: randomUUID(), username: "ali", displayName: "Ali", trafficLimit: "100", durationDays: 30, expiresAt: "2030-01-01T00:00:00.000Z", enabled: true, subscriptionEnabled: true }).success).toBe(false);
    expect(masterSubpanelCreateSchema.safeParse({ panelName: "Dealer", displayName: "Dealer", slug: "dealer", username: "dealer", email: null, password: "weak", expiresAt: null, trafficCredit: null, userLimit: null, allowedServerIds: [], assignedInboundIds: [], allowedProtocols: ["VLESS"], capabilities: { subscription: true, trafficReset: true, extend: true, credentialRotation: true } }).success).toBe(false);
  });
});

describe("generated delivery artifacts", () => {
  it("generates typed VLESS and VMess client links without raw Xray JSON execution", () => {
    const base = { name: "Main", host: "vpn.example.test", port: 443, transport: { kind: "WEBSOCKET" as const, path: "/vpn", host: "cdn.example.test" }, security: { kind: "TLS" as const, serverName: "vpn.example.test", alpn: ["h2"], minVersion: "1.2" as const, certificateFile: "/cert", keyFile: "/key", rejectUnknownSni: false }, protocolConfig: {} };
    expect(generateClientUri({ ...base, protocol: "VLESS" }, randomUUID(), "Ali")).toMatch(/^vless:\/\//);
    expect(generateClientUri({ ...base, protocol: "VMess" }, randomUUID(), "Ali")).toMatch(/^vmess:\/\//);
  });
  it("subscription rotation produces a distinct hash so the prior token no longer resolves", () => {
    const previous = createSubscriptionToken(); const next = createSubscriptionToken();
    expect(hashSubscriptionToken(previous)).not.toBe(hashSubscriptionToken(next));
    expect(hashSubscriptionToken(previous)).toBe(hashSubscriptionToken(previous));
  });
});

describe("service orchestration and audit hooks", () => {
  it("audits quota rejection and never attempts Xray apply", async () => {
    const repository = { createUser: vi.fn().mockRejectedValue(new ApiError(409, "USER_LIMIT_EXCEEDED", "limit")), recordPortalRejection: vi.fn() };
    const inbounds = { applyAssignedClientChange: vi.fn() };
    const service = new SubpanelService(repository as never, inbounds as never);
    await expect(service.createUser(reseller(), {} as never, { requestId: randomUUID(), ip: "127.0.0.1" })).rejects.toMatchObject({ code: "USER_LIMIT_EXCEEDED" });
    expect(repository.recordPortalRejection).toHaveBeenCalledWith(expect.anything(), "USER_LIMIT_EXCEEDED", expect.anything());
    expect(inbounds.applyAssignedClientChange).not.toHaveBeenCalled();
  });
  it("applies only the mutated assigned inbound after persisted user creation", async () => {
    const inboundId = randomUUID();
    const repository = { createUser: vi.fn().mockResolvedValue({ affected: 1, inboundIds: [inboundId] }), recordPortalRejection: vi.fn() };
    const inbounds = { applyAssignedClientChange: vi.fn().mockResolvedValue({ state: "APPLIED", strategy: "HOT_CLIENTS" }) };
    const service = new SubpanelService(repository as never, inbounds as never);
    const result = await service.createUser(reseller(), {} as never, { requestId: randomUUID(), ip: null });
    expect(inbounds.applyAssignedClientChange).toHaveBeenCalledWith(inboundId, "reseller-tenant-a");
    expect(result.apply[0].outcome).toMatchObject({ state: "APPLIED", strategy: "HOT_CLIENTS" });
  });
  it("resets both persisted counters and the assigned Xray client statistic", async () => {
    const inboundId = randomUUID(); const clientId = randomUUID(); const userId = randomUUID();
    const repository = { userAction: vi.fn().mockResolvedValue({ affected: 1, inboundIds: [inboundId], trafficTargets: [{ inboundId, clientId }] }), recordPortalRejection: vi.fn() };
    const inbounds = { resetAssignedClientTraffic: vi.fn().mockResolvedValue(1), applyAssignedClientChange: vi.fn() };
    const service = new SubpanelService(repository as never, inbounds as never);
    await service.userAction(reseller(), userId, { action: "RESET_TRAFFIC" }, { requestId: randomUUID(), ip: null });
    expect(inbounds.resetAssignedClientTraffic).toHaveBeenCalledWith(inboundId, clientId, "reseller-tenant-a");
    expect(inbounds.applyAssignedClientChange).not.toHaveBeenCalled();
  });
  it("declares the required security audit action names", () => {
    expect(AUDIT_ACTIONS).toMatchObject({ SUBPANEL_USER_CREATED: "SUBPANEL_USER_CREATED", SUBPANEL_TRAFFIC_ALLOCATION_UPDATED: "SUBPANEL_TRAFFIC_ALLOCATION_UPDATED", SUBPANEL_EXPIRATION_UPDATED: "SUBPANEL_EXPIRATION_UPDATED", SUBPANEL_USER_DELETED: "SUBPANEL_USER_DELETED", SUBPANEL_SUBSCRIPTION_TOKEN_ROTATED: "SUBPANEL_SUBSCRIPTION_TOKEN_ROTATED", SUBPANEL_TRAFFIC_RESET: "SUBPANEL_TRAFFIC_RESET", SUBPANEL_LOGIN: "SUBPANEL_LOGIN", SUBPANEL_LOGOUT: "SUBPANEL_LOGOUT", SUBPANEL_USER_LIMIT_REACHED: "SUBPANEL_USER_LIMIT_REACHED", SUBPANEL_TRAFFIC_LIMIT_REACHED: "SUBPANEL_TRAFFIC_LIMIT_REACHED" });
  });
});

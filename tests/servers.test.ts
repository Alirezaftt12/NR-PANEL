import { describe, expect, it } from "vitest";
import { hashServerSecret, joinTokenUsable, nextHeartbeatStatus } from "../apps/api/src/domain/servers/repository.js";
import { agentHeartbeatSchema, serverCreateSchema, serverEnrollSchema } from "../apps/api/src/domain/servers/schemas.js";

describe("secure server enrollment", () => {
  it("accepts typed server metadata but rejects unknown fields and roles", () => {
    expect(serverCreateSchema.safeParse({ displayName: "Germany-01", role: "ENTRY", country: "DE", region: "Frankfurt", provider: "Example", description: "Edge" }).success).toBe(true);
    expect(serverCreateSchema.safeParse({ displayName: "Node", role: "SUPERUSER" }).success).toBe(false);
    expect(serverCreateSchema.safeParse({ displayName: "Node", role: "ENTRY", status: "ONLINE" }).success).toBe(false);
  });
  it("requires a high-entropy one-time join token", () => {
    expect(serverEnrollSchema.safeParse({ joinToken: `nrj_${"a".repeat(43)}`, hostname: "node-1", agentVersion: "v1.0.0" }).success).toBe(true);
    expect(serverEnrollSchema.safeParse({ joinToken: "admin", hostname: "node-1", agentVersion: "v1.0.0" }).success).toBe(false);
  });
  it("stores deterministic hashes rather than raw join or Agent credentials", () => {
    const token = `nrj_${"x".repeat(43)}`; expect(hashServerSecret(token)).toMatch(/^[a-f0-9]{64}$/); expect(hashServerSecret(token)).not.toContain(token);
  });
  it("invalidates used, revoked, and expired join tokens", () => {
    const future = new Date(Date.now() + 60_000); const past = new Date(Date.now() - 1);
    expect(joinTokenUsable({ usedAt: null, revokedAt: null, expiresAt: future })).toBe(true);
    expect(joinTokenUsable({ usedAt: new Date(), revokedAt: null, expiresAt: future })).toBe(false);
    expect(joinTokenUsable({ usedAt: null, revokedAt: new Date(), expiresAt: future })).toBe(false);
    expect(joinTokenUsable({ usedAt: null, revokedAt: null, expiresAt: past })).toBe(false);
  });
  it("requires two authenticated health observations before ONLINE", () => {
    expect(nextHeartbeatStatus("REGISTERED", "ONLINE")).toBe("CONNECTING");
    expect(nextHeartbeatStatus("CONNECTING", "ONLINE")).toBe("ONLINE");
    expect(nextHeartbeatStatus("CONNECTING", "ERROR")).toBe("ERROR");
  });
  it("rejects fabricated or incomplete telemetry", () => {
    expect(agentHeartbeatSchema.safeParse({ requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), agentVersion: "v1", health: "ONLINE", cpu: { usage: 42, cores: 4 } }).success).toBe(false);
    expect(agentHeartbeatSchema.safeParse({ requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), agentVersion: "v1", health: "ONLINE", system: { hostname: "node", os: null, kernel: null, architecture: null, ipv4: null, ipv6: null }, cpu: { usage: 142, cores: 4 }, ram: { used: 1, total: 2 }, swap: { used: 0, total: 0 }, storage: { used: 1, total: 2 }, load: [0, 0, 0], uptimeSeconds: 1, network: { rxRate: 0, txRate: 0, rxTotal: 0, txTotal: 0 }, connections: { tcp: 0, udp: 0 }, processCount: 1, xray: { status: "NOT_INSTALLED", version: null, uptimeSeconds: null, configValid: null } }).success).toBe(false);
  });
});

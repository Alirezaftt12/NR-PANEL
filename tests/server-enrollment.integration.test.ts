import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PERMISSIONS, ROLES } from "../packages/shared/src/index.js";
import type { AuthContext } from "../apps/api/src/domain/identity.js";
import { ServerRepository } from "../apps/api/src/domain/servers/repository.js";
import { agentHeartbeatSchema } from "../apps/api/src/domain/servers/schemas.js";
import { hashPassword } from "../apps/api/src/lib/security.js";
import { createDatabase, type Database } from "../apps/api/src/database/client.js";
import { KyselySecurityRepository } from "../apps/api/src/database/security-repository.js";

const enabled = process.env.NR_PANEL_INTEGRATION_DB === "true";
const requestMetadata = () => ({ ip: "127.0.0.1", userAgent: "vitest-integration", requestId: randomUUID() });
let database: Database;
let servers: ServerRepository;
let tenantA: AuthContext;
let tenantB: AuthContext;

describe.skipIf(!enabled)("server enrollment database integration", () => {
  beforeAll(async () => {
    database = createDatabase();
    const security = new KyselySecurityRepository(database);
    const passwordHash = await hashPassword("Integration-Owner!2026");
    const owner = await security.bootstrapOwner("integration-owner", null, passwordHash);
    const ownerContext: AuthContext = { userId: owner.id, username: owner.username, email: null, role: ROLES.OWNER, permissions: [], primaryTenantId: "", tenantIds: [], sessionId: "integration", sessionExpiresAt: "2099-01-01T00:00:00.000Z" };
    const firstTenant = await security.createTenant("Integration A", "integration-a", { id: owner.id, role: ROLES.OWNER, requestId: randomUUID(), ip: "127.0.0.1" });
    const secondTenant = await security.createTenant("Integration B", "integration-b", { id: owner.id, role: ROLES.OWNER, requestId: randomUUID(), ip: "127.0.0.1" });
    const adminA = await security.createAdmin({ username: "integration-admin-a", email: null, passwordHash, role: ROLES.ADMIN, tenantId: firstTenant.id, permissions: [PERMISSIONS.SERVER_CREATE, PERMISSIONS.SERVER_JOIN_TOKEN_CREATE, PERMISSIONS.SERVER_VIEW], actorId: owner.id, actorRole: ROLES.OWNER, requestId: randomUUID(), ip: "127.0.0.1" });
    const adminB = await security.createAdmin({ username: "integration-admin-b", email: null, passwordHash, role: ROLES.ADMIN, tenantId: secondTenant.id, permissions: [PERMISSIONS.SERVER_VIEW], actorId: owner.id, actorRole: ROLES.OWNER, requestId: randomUUID(), ip: "127.0.0.1" });
    tenantA = { userId: adminA.id, username: adminA.username, email: null, role: ROLES.ADMIN, permissions: adminA.permissions, primaryTenantId: firstTenant.id, tenantIds: [firstTenant.id], sessionId: "integration-a", sessionExpiresAt: "2099-01-01T00:00:00.000Z" };
    tenantB = { userId: adminB.id, username: adminB.username, email: null, role: ROLES.ADMIN, permissions: adminB.permissions, primaryTenantId: secondTenant.id, tenantIds: [secondTenant.id], sessionId: "integration-b", sessionExpiresAt: "2099-01-01T00:00:00.000Z" };
    servers = new ServerRepository(database);
  });

  afterAll(async () => { await database.destroy(); });

  it("isolates tenants and promotes only authenticated real heartbeats", async () => {
    const server = await servers.create({ displayName: "Integration Node", role: "ENTRY", country: "DE", region: "Frankfurt", provider: null, description: null }, tenantA, requestMetadata());
    await expect(servers.assertAccess(server.id, tenantB)).rejects.toMatchObject({ code: "SERVER_NOT_FOUND" });

    const join = await servers.issueJoinToken(server.id, tenantA, requestMetadata(), 900);
    const enrolled = await servers.enroll(join.token, { hostname: "integration-node", publicAddress: "203.0.113.10", agentVersion: "v0.1.0" }, "203.0.113.10");
    await expect(servers.enroll(join.token, { hostname: "replay", publicAddress: null, agentVersion: "v0.1.0" }, "203.0.113.10")).rejects.toMatchObject({ code: "JOIN_TOKEN_INVALID" });

    const heartbeat = () => agentHeartbeatSchema.parse({
      requestId: randomUUID(), timestamp: new Date().toISOString(), agentVersion: "v0.1.0", health: "ONLINE",
      system: { hostname: "integration-node", os: "Debian 12", kernel: "6.1", architecture: "x64", ipv4: "203.0.113.10", ipv6: null },
      cpu: { usage: 12.5, cores: 4 }, ram: { used: 1024, total: 4096 }, swap: { used: 0, total: 1024 }, storage: { used: 2048, total: 8192 }, load: [0.1, 0.2, 0.3], uptimeSeconds: 3600,
      network: { rxRate: 10, txRate: 20, rxTotal: 1000, txTotal: 2000 }, connections: { tcp: 4, udp: 2 }, processCount: 42,
      xray: { status: "NOT_INSTALLED", version: null, uptimeSeconds: null, configValid: null },
    });
    expect((await servers.heartbeat(enrolled.credential, heartbeat(), "203.0.113.10")).status).toBe("CONNECTING");
    expect((await servers.heartbeat(enrolled.credential, heartbeat(), "203.0.113.10")).status).toBe("ONLINE");

    const summary = (await servers.list(tenantA)).find((item) => item.id === server.id);
    expect(summary).toMatchObject({ status: "ONLINE", dataState: "LIVE", hostname: "integration-node", agentStatus: "ONLINE" });
    expect(summary?.metrics).toMatchObject({ cpu: { usage: 12.5, cores: 4 }, network: { rxTotal: "1000", txTotal: "2000" } });
    const audit = await database.selectFrom("audit_logs").select(["action", "metadata"]).where("server_id", "=", server.id).orderBy("id", "asc").execute();
    expect(audit.map((entry) => entry.action)).toContain("SERVER_JOIN_TOKEN_CREATED");
    expect(audit.map((entry) => entry.action)).toContain("SERVER_AGENT_REGISTERED");
  });
});

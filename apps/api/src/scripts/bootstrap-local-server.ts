import { randomUUID } from "node:crypto";
import { ROLES } from "@nr/shared";
import { createDatabase } from "../database/client.js";
import { ServerRepository } from "../domain/servers/repository.js";
import type { AuthContext } from "../domain/identity.js";

const database = createDatabase();
try {
  const owner = await database.selectFrom("admins").innerJoin("roles", "roles.id", "admins.role_id").select(["admins.id", "admins.username", "admins.email", "admins.tenant_id as tenantId", "roles.name as role"]).where("roles.name", "=", ROLES.OWNER).executeTakeFirst();
  if (!owner) throw new Error("Primary OWNER must be bootstrapped first");
  const existing = await database.selectFrom("servers").select(["id", "status"]).where("display_name", "=", process.env.LOCAL_SERVER_NAME || "Local Server").executeTakeFirst();
  const repository = new ServerRepository(database);
  const auth: AuthContext = { userId: owner.id, username: owner.username, email: owner.email, role: ROLES.OWNER, permissions: [], primaryTenantId: owner.tenantId, tenantIds: [owner.tenantId], sessionId: "installer", sessionExpiresAt: new Date(Date.now() + 300_000).toISOString() };
  const server = existing ?? await repository.create({ displayName: process.env.LOCAL_SERVER_NAME || "Local Server", role: "HYBRID", country: null, region: null, provider: null, description: "Automatically registered local Master VPS" }, auth, { ip: "127.0.0.1", userAgent: "nr-panel-installer", requestId: randomUUID() });
  const issued = await repository.issueJoinToken(server.id, auth, { ip: "127.0.0.1", userAgent: "nr-panel-installer", requestId: randomUUID() }, 900);
  process.stdout.write(JSON.stringify({ serverId: server.id, joinToken: issued.token, expiresAt: issued.expiresAt.toISOString() }));
} finally { await database.destroy(); }

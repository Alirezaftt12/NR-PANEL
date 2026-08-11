import { randomUUID } from "node:crypto";
import { ROLES } from "@nr/shared";
import { createDatabase } from "../database/client.js";
import { hashPassword, normalizeIdentifier, passwordSchema } from "../lib/security.js";
import { z } from "zod";

const input = z.object({ NEW_OWNER_USERNAME: z.string().trim().min(10).max(64).regex(/^[A-Za-z0-9._-]+$/).optional(), NEW_OWNER_PASSWORD: passwordSchema.optional() }).refine((value) => Boolean(value.NEW_OWNER_USERNAME || value.NEW_OWNER_PASSWORD), "A new username or password is required").parse(process.env);
const database = createDatabase();
try {
  await database.transaction().execute(async (transaction) => {
    const owner = await transaction.selectFrom("admins").innerJoin("roles", "roles.id", "admins.role_id").select(["admins.id", "admins.tenant_id as tenantId", "roles.name as role"]).where("roles.name", "=", ROLES.OWNER).forUpdate().executeTakeFirst();
    if (!owner) throw new Error("Primary OWNER not found");
    await transaction.updateTable("admins").set({ ...(input.NEW_OWNER_USERNAME ? { username: normalizeIdentifier(input.NEW_OWNER_USERNAME) } : {}), ...(input.NEW_OWNER_PASSWORD ? { password_hash: await hashPassword(input.NEW_OWNER_PASSWORD), password_changed_at: new Date() } : {}), updated_at: new Date() }).where("id", "=", owner.id).execute();
    await transaction.updateTable("sessions").set({ revoked_at: new Date() }).where("admin_id", "=", owner.id).where("revoked_at", "is", null).execute();
    await transaction.insertInto("audit_logs").values({ severity: "warning", category: "SECURITY", actor_id: owner.id, actor_role: ROLES.OWNER, tenant_id: owner.tenantId, server_id: null, ip: null, action: input.NEW_OWNER_PASSWORD ? "OWNER_PASSWORD_RECOVERED" : "OWNER_USERNAME_RECOVERED", message: "OWNER credential recovered through local nr-panel CLI", target_type: "admin", target_id: owner.id, request_id: randomUUID(), metadata: { usernameChanged: Boolean(input.NEW_OWNER_USERNAME), passwordChanged: Boolean(input.NEW_OWNER_PASSWORD) } }).execute();
  });
  process.stdout.write("OWNER credential updated and active sessions revoked\n");
} finally { await database.destroy(); }

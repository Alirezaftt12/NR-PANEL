import { permissionValues, roleValues, ROLES, type Permission } from "@nr/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KyselySecurityRepository } from "../database/security-repository.js";
import type { Authorization } from "../lib/auth.js";
import { ApiError } from "../lib/errors.js";
import { hashPassword, normalizeIdentifier, passwordSchema } from "../lib/security.js";

type AdminRoutesOptions = { repository: KyselySecurityRepository; authorization: Authorization };

const assignableRoles = roleValues.filter((role) => role !== ROLES.OWNER);
const createAdminSchema = z.object({
  username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/).transform(normalizeIdentifier),
  email: z.string().email().max(254).transform(normalizeIdentifier).nullable().optional().default(null),
  password: passwordSchema,
  role: z.enum(assignableRoles as ["ADMIN", "RESELLER", "SUB_RESELLER"]),
  tenantId: z.string().uuid(),
  permissions: z.array(z.enum(permissionValues as [Permission, ...Permission[]])).max(permissionValues.length).default([]),
});
const updateAdminSchema = z.object({
  role: z.enum(assignableRoles as ["ADMIN", "RESELLER", "SUB_RESELLER"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  permissions: z.array(z.enum(permissionValues as [Permission, ...Permission[]])).max(permissionValues.length).optional(),
}).refine((value) => Object.keys(value).length > 0, "At least one change is required");
const paramsSchema = z.object({ id: z.string().uuid() });

export async function adminRoutes(app: FastifyInstance, { repository, authorization }: AdminRoutesOptions) {
  app.get("/admins", { preHandler: authorization.requirePermission("ADMIN_VIEW") }, async () => ({ ok: true, data: await repository.listAdmins() }));

  app.post("/admins", { preHandler: authorization.requireOwner }, async (request, reply) => {
    const body = createAdminSchema.parse(request.body);
    if (body.role === ROLES.SUB_RESELLER) throw new ApiError(403, "NESTED_RESELLER_DISABLED", "Nested reseller creation is disabled");
    const admin = await repository.createAdmin({ ...body, passwordHash: await hashPassword(body.password), actorId: request.auth!.userId, actorRole: request.auth!.role, requestId: request.id, ip: request.ip });
    return reply.code(201).send({ ok: true, data: admin });
  });

  app.patch("/admins/:id", { preHandler: authorization.requireOwner }, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = updateAdminSchema.parse(request.body);
    if (body.role === ROLES.SUB_RESELLER) throw new ApiError(403, "NESTED_RESELLER_DISABLED", "Nested reseller creation is disabled");
    return { ok: true, data: await repository.updateAdmin(id, { ...body, actorId: request.auth!.userId, actorRole: request.auth!.role, requestId: request.id, ip: request.ip }) };
  });

  app.get("/roles", { preHandler: authorization.requirePermission("ADMIN_VIEW") }, async () => ({ ok: true, data: await repository.listRoles() }));
  app.get("/permissions", { preHandler: authorization.requirePermission("ADMIN_VIEW") }, async () => ({ ok: true, data: await repository.listPermissions() }));
}

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KyselySecurityRepository } from "../database/security-repository.js";
import type { Authorization } from "../lib/auth.js";
import { notFound } from "../lib/errors.js";

type TenantRoutesOptions = { repository: KyselySecurityRepository; authorization: Authorization };
const paramsSchema = z.object({ id: z.string().uuid() });
const createTenantSchema = z.object({ name: z.string().trim().min(2).max(120), slug: z.string().trim().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) });
const updateTenantSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), status: z.enum(["ACTIVE", "DISABLED", "EXPIRED"]).optional() }).refine((value) => Object.keys(value).length > 0, "At least one change is required");

export async function tenantRoutes(app: FastifyInstance, { repository, authorization }: TenantRoutesOptions) {
  app.get("/tenants", { preHandler: authorization.requirePermission("SUBPANEL_VIEW") }, async (request) => {
    const tenants = await repository.listTenants();
    const visible = request.auth!.role === "OWNER" ? tenants : tenants.filter((tenant) => request.auth!.tenantIds.includes(tenant.id));
    return { ok: true, data: visible };
  });

  app.get("/tenants/:id", {
    preHandler: [authorization.requirePermission("SUBPANEL_VIEW"), authorization.requireTenantAccess((request) => paramsSchema.parse(request.params).id)],
  }, async (request) => {
    const tenant = await repository.getTenant(paramsSchema.parse(request.params).id);
    if (!tenant) throw notFound("Tenant");
    return { ok: true, data: tenant };
  });

  app.post("/tenants", { preHandler: authorization.requirePermission("SUBPANEL_CREATE") }, async (request, reply) => {
    const body = createTenantSchema.parse(request.body);
    const tenant = await repository.createTenant(body.name, body.slug, { id: request.auth!.userId, role: request.auth!.role, requestId: request.id, ip: request.ip });
    return reply.code(201).send({ ok: true, data: tenant });
  });

  app.patch("/tenants/:id", {
    preHandler: [authorization.requirePermission("SUBPANEL_UPDATE"), authorization.requireTenantAccess((request) => paramsSchema.parse(request.params).id)],
  }, async (request) => {
    const { id } = paramsSchema.parse(request.params);
    const body = updateTenantSchema.parse(request.body);
    if (body.status === "DISABLED") await authorization.ensurePermission(request, "SUBPANEL_DISABLE");
    return { ok: true, data: await repository.updateTenant(id, { ...body, actorId: request.auth!.userId, actorRole: request.auth!.role, requestId: request.id, ip: request.ip }) };
  });
}

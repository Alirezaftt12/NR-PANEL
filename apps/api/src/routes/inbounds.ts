import { PERMISSIONS } from "@nr/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { AUDIT_ACTIONS } from "../domain/audit-actions.js";
import type { KyselySecurityRepository } from "../database/security-repository.js";
import type { InboundService, MutationResult } from "../domain/inbounds/service.js";
import { confirmationSchema, globalInboundActionSchema, inboundClientRequestSchema, inboundPatchSchema, inboundWriteSchema } from "../domain/inbounds/schemas.js";
import type { Authorization } from "../lib/auth.js";
import { ApiError } from "../lib/errors.js";

type Options = { repository: KyselySecurityRepository; authorization: Authorization; service: InboundService };
const idParams = z.object({ id: z.string().uuid() });
const clientParams = z.object({ id: z.string().uuid(), clientId: z.string().uuid() });

function sanitizedClient<T extends { credentialPreview: string }>(client: T) {
  const copy: Partial<T> = { ...client };
  delete copy.credentialPreview;
  return copy;
}

function mutationPayload(result: MutationResult) {
  return {
    inboundId: result.inbound.id, desiredRevision: result.inbound.desiredRevision,
    apply: result.apply,
  };
}

async function audit(repository: KyselySecurityRepository, request: FastifyRequest, input: { action: string; targetType: string; targetId?: string; tenantId?: string | null; message: string; metadata?: Record<string, unknown>; warning?: boolean }) {
  await repository.recordAudit({
    actorId: request.auth!.userId, actorRole: request.auth!.role, tenantId: input.tenantId ?? request.auth!.tenantIds[0] ?? null,
    action: input.action, targetType: input.targetType, targetId: input.targetId, ip: request.ip, requestId: request.id,
    severity: input.warning ? "warning" : "info", category: "XRAY", message: input.message, metadata: input.metadata,
  });
}

export async function inboundRoutes(app: FastifyInstance, { repository, authorization, service }: Options) {
  app.get("/inbounds", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_VIEW) }, async (request) => ({ ok: true, data: await service.pageData(request.auth!) }));

  app.get("/inbounds/export-backup", { preHandler: authorization.requirePermission(PERMISSIONS.BACKUP_CREATE) }, async (request, reply) => {
    const data = await service.pageData(request.auth!);
    const backup = { format: "nr-panel-inbounds-v1", generatedAt: new Date().toISOString(), inbounds: data.inbounds.map((inbound) => ({ ...inbound, clients: inbound.clients.map(sanitizedClient) })) };
    await audit(repository, request, { action: "INBOUND_BACKUP_EXPORTED", targetType: "inbound-backup", message: "Sanitized inbound desired-state backup exported" });
    reply.header("content-disposition", `attachment; filename="nr-panel-inbounds-${new Date().toISOString().slice(0, 10)}.json"`);
    return reply.send(backup);
  });

  app.get("/inbounds/exports/:kind", { preHandler: authorization.requirePermission(PERMISSIONS.CONFIG_VIEW) }, async (request) => {
    const { kind } = z.object({ kind: z.enum(["links", "subscriptions"]) }).parse(request.params);
    throw new ApiError(503, "SUBSCRIPTION_DELIVERY_UNAVAILABLE", `${kind === "links" ? "Share-link" : "Subscription"} export requires a configured public delivery host; no placeholder links were generated`);
  });

  app.post("/inbounds/actions", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_CONTROL) }, async (request) => {
    const body = globalInboundActionSchema.parse(request.body);
    const page = await service.pageData(request.auth!);
    let data: unknown;
    if (body.action === "RESET_ALL_INBOUND_TRAFFIC") { await authorization.ensurePermission(request, PERMISSIONS.USER_RESET_TRAFFIC); data = { resetCount: await service.resetTraffic(null, null, "INBOUND", request.auth!) }; }
    else if (body.action === "RESET_ALL_USER_TRAFFIC") { await authorization.ensurePermission(request, PERMISSIONS.USER_RESET_TRAFFIC); data = { resetCount: await service.resetTraffic(null, null, "CLIENT", request.auth!) }; }
    else if (body.action === "DELETE_EXPIRED_USERS") { await authorization.ensurePermission(request, PERMISSIONS.USER_DELETE); data = await service.deleteExpired(null, request.auth!); }
    else {
      const enabled = body.action === "ENABLE_ALL";
      const results = [];
      for (const inbound of page.inbounds.filter((entry) => entry.enabled !== enabled)) results.push(await service.setEnabled(inbound.id, enabled, request.auth!));
      data = { changedCount: results.length, results: results.map(mutationPayload) };
    }
    await audit(repository, request, { action: body.action, targetType: "inbound-collection", message: "Confirmed global inbound action completed", metadata: { resourceCount: page.inbounds.length }, warning: true });
    return { ok: true, data };
  });

  app.post("/inbounds", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_CONTROL) }, async (request, reply) => {
    const result = await service.create(inboundWriteSchema.parse(request.body), request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_CREATED, targetType: "inbound", targetId: result.inbound.id, tenantId: result.inbound.tenantId, message: "Inbound desired state created", metadata: mutationPayload(result) });
    return reply.code(201).send({ ok: true, data: mutationPayload(result) });
  });

  app.get("/inbounds/:id", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_VIEW) }, async (request) => ({ ok: true, data: await service.detail(idParams.parse(request.params).id, request.auth!) }));

  app.patch("/inbounds/:id", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_CONTROL) }, async (request) => {
    const { id } = idParams.parse(request.params); const result = await service.update(id, inboundPatchSchema.parse(request.body), request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_UPDATED, targetType: "inbound", targetId: id, tenantId: result.inbound.tenantId, message: "Inbound desired state updated", metadata: mutationPayload(result) });
    return { ok: true, data: mutationPayload(result) };
  });

  app.post("/inbounds/:id/duplicate", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_CONTROL) }, async (request, reply) => {
    const { id } = idParams.parse(request.params); const result = await service.duplicate(id, request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_DUPLICATED, targetType: "inbound", targetId: result.inbound.id, tenantId: result.inbound.tenantId, message: "Inbound duplicated in disabled state", metadata: { sourceInboundId: id, ...mutationPayload(result) } });
    return reply.code(201).send({ ok: true, data: mutationPayload(result) });
  });

  app.post("/inbounds/:id/enabled", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_CONTROL) }, async (request) => {
    const { id } = idParams.parse(request.params); const body = z.object({ enabled: z.boolean(), confirmation: z.literal("CONFIRM") }).parse(request.body);
    const result = await service.setEnabled(id, body.enabled, request.auth!);
    await audit(repository, request, { action: body.enabled ? AUDIT_ACTIONS.INBOUND_ENABLED : AUDIT_ACTIONS.INBOUND_DISABLED, targetType: "inbound", targetId: id, tenantId: result.inbound.tenantId, message: `Inbound ${body.enabled ? "enabled" : "disabled"}`, metadata: mutationPayload(result), warning: !body.enabled });
    return { ok: true, data: mutationPayload(result) };
  });

  app.delete("/inbounds/:id", { preHandler: authorization.requirePermission(PERMISSIONS.XRAY_CONTROL) }, async (request, reply) => {
    const { id } = idParams.parse(request.params); confirmationSchema.parse(request.body); const result = await service.delete(id, request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_DELETED, targetType: "inbound", targetId: id, tenantId: result.inbound.tenantId, message: result.deleted ? "Inbound deleted after safe Xray removal" : "Inbound deletion deferred because Xray apply failed", metadata: { deleted: result.deleted, apply: result.apply }, warning: true });
    return reply.code(result.deleted ? 200 : 202).send({ ok: true, data: { deleted: result.deleted, apply: result.apply } });
  });

  app.get("/inbounds/:id/export", { preHandler: authorization.requirePermission(PERMISSIONS.CONFIG_VIEW) }, async (request, reply) => {
    const { id } = idParams.parse(request.params); const inbound = await service.detail(id, request.auth!);
    const sanitized = { ...inbound, clients: inbound.clients.map(sanitizedClient), advancedConfig: null };
    await audit(repository, request, { action: "INBOUND_EXPORTED", targetType: "inbound", targetId: id, tenantId: inbound.tenantId, message: "Sanitized inbound desired state exported" });
    reply.header("content-disposition", `attachment; filename="${inbound.tag}.json"`); return reply.send(sanitized);
  });

  app.get("/inbounds/:id/exports/:kind", { preHandler: authorization.requirePermission(PERMISSIONS.CONFIG_VIEW) }, async (request) => {
    idParams.parse(request.params); z.object({ kind: z.enum(["links", "subscriptions"]) }).parse(request.params);
    throw new ApiError(503, "SUBSCRIPTION_DELIVERY_UNAVAILABLE", "A public subscription delivery host is not configured; no placeholder links were generated");
  });

  app.post("/inbounds/:id/clients", { preHandler: authorization.requirePermission(PERMISSIONS.USER_CREATE) }, async (request, reply) => {
    await authorization.ensurePermission(request, PERMISSIONS.XRAY_CONTROL);
    const { id } = idParams.parse(request.params); const result = await service.createClient(id, inboundClientRequestSchema.parse(request.body), request.auth!);
    const client = result.inbound.clients.at(-1);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_CLIENT_CREATED, targetType: "inbound-client", targetId: client?.id, tenantId: result.inbound.tenantId, message: "Inbound child client created", metadata: { inboundId: id, apply: result.apply } });
    return reply.code(201).send({ ok: true, data: mutationPayload(result) });
  });

  app.post("/inbounds/:id/clients/:clientId/rotate", { preHandler: authorization.requirePermission(PERMISSIONS.USER_UPDATE) }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.XRAY_CONTROL);
    const { id, clientId } = clientParams.parse(request.params); const body = z.object({ credential: z.string().min(8).max(512).optional(), confirmation: z.literal("CONFIRM") }).parse(request.body);
    const result = await service.rotateClient(id, clientId, body.credential, request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_CLIENT_ROTATED, targetType: "inbound-client", targetId: clientId, tenantId: result.inbound.tenantId, message: "Inbound child credential rotated", metadata: { inboundId: id, apply: result.apply }, warning: true });
    return { ok: true, data: mutationPayload(result) };
  });

  app.delete("/inbounds/:id/clients/:clientId", { preHandler: authorization.requirePermission(PERMISSIONS.USER_DELETE) }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.XRAY_CONTROL);
    const { id, clientId } = clientParams.parse(request.params); confirmationSchema.parse(request.body); const result = await service.deleteClient(id, clientId, request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_CLIENT_DELETED, targetType: "inbound-client", targetId: clientId, tenantId: result.inbound.tenantId, message: "Inbound child client deleted", metadata: { inboundId: id, apply: result.apply }, warning: true });
    return { ok: true, data: mutationPayload(result) };
  });

  app.post("/inbounds/:id/traffic/reset", { preHandler: authorization.requirePermission(PERMISSIONS.USER_RESET_TRAFFIC) }, async (request) => {
    const { id } = idParams.parse(request.params); confirmationSchema.parse(request.body); const resetCount = await service.resetTraffic(id, null, "INBOUND", request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_TRAFFIC_RESET, targetType: "inbound", targetId: id, message: "Inbound traffic counters reset", metadata: { resetCount }, warning: true });
    return { ok: true, data: { resetCount } };
  });

  app.post("/inbounds/:id/clients/:clientId/traffic/reset", { preHandler: authorization.requirePermission(PERMISSIONS.USER_RESET_TRAFFIC) }, async (request) => {
    const { id, clientId } = clientParams.parse(request.params); confirmationSchema.parse(request.body); const resetCount = await service.resetTraffic(id, clientId, "CLIENT", request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_TRAFFIC_RESET, targetType: "inbound-client", targetId: clientId, message: "Inbound client traffic counter reset", metadata: { inboundId: id, resetCount }, warning: true });
    return { ok: true, data: { resetCount } };
  });

  app.post("/inbounds/:id/clients/traffic/reset", { preHandler: authorization.requirePermission(PERMISSIONS.USER_RESET_TRAFFIC) }, async (request) => {
    const { id } = idParams.parse(request.params); confirmationSchema.parse(request.body); const resetCount = await service.resetTraffic(id, null, "CLIENT", request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_TRAFFIC_RESET, targetType: "inbound", targetId: id, message: "All child client traffic counters reset for inbound", metadata: { resetCount }, warning: true });
    return { ok: true, data: { resetCount } };
  });

  app.post("/inbounds/:id/clients/delete-expired", { preHandler: authorization.requirePermission(PERMISSIONS.USER_DELETE) }, async (request) => {
    const { id } = idParams.parse(request.params); confirmationSchema.parse(request.body); const result = await service.deleteExpired(id, request.auth!);
    await audit(repository, request, { action: AUDIT_ACTIONS.INBOUND_EXPIRED_CLIENTS_DELETED, targetType: "inbound", targetId: id, message: "Expired inbound clients deleted", metadata: result, warning: true });
    return { ok: true, data: result };
  });
}

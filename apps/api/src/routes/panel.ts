import { hasPermission, PERMISSIONS } from "@nr/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { KyselySecurityRepository } from "../database/security-repository.js";
import type { ServerService } from "../domain/servers/service.js";
import { agentHeartbeatSchema, serverCreateSchema, serverEnrollSchema } from "../domain/servers/schemas.js";
import type { Authorization } from "../lib/auth.js";
import { ApiError, forbidden } from "../lib/errors.js";
import { isWhitelistedAction } from "../lib/security.js";

type PanelRoutesOptions = { repository: KyselySecurityRepository; authorization: Authorization; servers: ServerService };
const sensitiveAction = new Set(["system.reboot", "system.shutdown", "xray.stop"]);

export async function panelRoutes(app: FastifyInstance, { repository, authorization, servers }: PanelRoutesOptions) {
  app.get("/dashboard", { preHandler: authorization.requirePermission(PERMISSIONS.DASHBOARD_VIEW) }, async (request) => ({ ok: true, data: await servers.dashboard(request.auth!) }));

  app.get("/servers", { preHandler: authorization.requirePermission(PERMISSIONS.SERVER_VIEW) }, async (request) => ({ ok: true, data: await servers.list(request.auth!) }));
  app.get("/servers/:id", { preHandler: authorization.requirePermission(PERMISSIONS.SERVER_VIEW) }, async (request) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    const server = (await servers.list(request.auth!)).find((item) => item.id === id);
    if (!server) throw new ApiError(404, "SERVER_NOT_FOUND", "Server not found");
    return { ok: true, data: server };
  });
  app.post("/servers", { preHandler: authorization.requirePermission(PERMISSIONS.SERVER_CREATE) }, async (request, reply) => {
    const server = await servers.create(serverCreateSchema.parse(request.body), request.auth!, { ip: request.ip, userAgent: request.headers["user-agent"] ?? null, requestId: request.id });
    return reply.code(201).send({ ok: true, data: server });
  });
  app.post("/servers/:id/join-token", { preHandler: authorization.requirePermission(PERMISSIONS.SERVER_JOIN_TOKEN_CREATE) }, async (request) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    return { ok: true, data: await servers.joinCommand(id, request.auth!, { ip: request.ip, userAgent: request.headers["user-agent"] ?? null, requestId: request.id }) };
  });

  app.post("/servers/:id/actions", { preHandler: authorization.requirePermission(PERMISSIONS.SERVER_CONTROL) }, async (request, reply) => {
    const id = z.string().uuid().parse((request.params as { id: string }).id);
    await servers.list(request.auth!).then((items) => { if (!items.some((server) => server.id === id)) throw new ApiError(404, "SERVER_NOT_FOUND", "Server not found"); });
    const body = z.object({ action: z.string(), confirmation: z.string().optional() }).parse(request.body);
    if (!isWhitelistedAction(body.action)) throw new ApiError(400, "ACTION_NOT_ALLOWED", "Action is not allowed");
    const requiredPermission = body.action === "system.reboot" ? PERMISSIONS.SYSTEM_REBOOT : body.action === "system.shutdown" ? PERMISSIONS.SYSTEM_SHUTDOWN : PERMISSIONS.XRAY_CONTROL;
    if (!hasPermission(request.auth!.role, request.auth!.permissions, requiredPermission)) throw forbidden();
    if (sensitiveAction.has(body.action) && body.confirmation !== "CONFIRM") throw new ApiError(409, "CONFIRMATION_REQUIRED", "Strong confirmation is required");
    await repository.recordAudit({ actorId: request.auth!.userId, actorRole: request.auth!.role, tenantId: request.auth!.primaryTenantId, action: body.action, targetType: "server", targetId: id, ip: request.ip, requestId: request.id, severity: "warning", category: "SYSTEM", message: "Server action rejected because no authenticated command transport is connected" });
    return reply.code(503).send({ ok: false, error: { code: "AGENT_COMMAND_TRANSPORT_UNAVAILABLE", message: "No command was executed; the authenticated Agent command transport is not connected", requestId: request.id } });
  });

  app.post("/agents/enroll", async (request, reply) => {
    const body = serverEnrollSchema.parse(request.body);
    const enrolled = await servers.enroll(body.joinToken, { hostname: body.hostname, publicAddress: body.publicAddress ?? null, agentVersion: body.agentVersion }, request.ip);
    return reply.code(201).send({ ok: true, data: { ...enrolled, heartbeatPath: "/api/v1/agents/heartbeat", intervalSeconds: 30 } });
  });

  app.post("/agents/heartbeat", async (request) => {
    const authorizationHeader = request.headers.authorization;
    if (!authorizationHeader?.startsWith("Bearer ")) throw new ApiError(401, "AGENT_AUTH_REQUIRED", "Agent authentication is required");
    return { ok: true, data: await servers.heartbeat(authorizationHeader.slice(7), agentHeartbeatSchema.parse(request.body), request.ip) };
  });
  app.get("/agents/status", async (request) => {
    const authorizationHeader = request.headers.authorization;
    if (!authorizationHeader?.startsWith("Bearer ")) throw new ApiError(401, "AGENT_AUTH_REQUIRED", "Agent authentication is required");
    return { ok: true, data: await servers.agentStatus(authorizationHeader.slice(7)) };
  });

  app.get("/logs", { preHandler: authorization.requirePermission(PERMISSIONS.LOG_VIEW) }, async (request) => {
    const summary = await repository.securitySummary(request.auth!);
    return { ok: true, data: summary.events, meta: { total: summary.events.length } };
  });

  app.get("/events", { preHandler: authorization.requireAuth }, async (request, reply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    const emit = async () => reply.raw.write(`event: state\ndata: ${JSON.stringify(await servers.dashboard(request.auth!))}\n\n`);
    await emit();
    const timer = setInterval(() => { void emit().catch(() => reply.raw.write(`event: state\ndata: ${JSON.stringify({ state: "ERROR" })}\n\n`)); }, 30_000);
    request.raw.on("close", () => clearInterval(timer));
  });
}

import { randomUUID } from "node:crypto";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { sql } from "kysely";
import { ZodError } from "zod";
import { createDatabase } from "./database/client.js";
import { KyselySecurityRepository } from "./database/security-repository.js";
import { KyselyInboundRepository } from "./domain/inbounds/repository.js";
import { UnavailableXrayRuntime } from "./domain/inbounds/runtime.js";
import { InboundService } from "./domain/inbounds/service.js";
import { KyselySettingsRepository } from "./domain/settings/repository.js";
import { SettingsService } from "./domain/settings/service.js";
import { KyselySubpanelRepository } from "./domain/subpanel/repository.js";
import { SubpanelService } from "./domain/subpanel/service.js";
import { ServerRepository } from "./domain/servers/repository.js";
import { ServerService } from "./domain/servers/service.js";
import { createAuthorization } from "./lib/auth.js";
import { ApiError } from "./lib/errors.js";
import { environment } from "./lib/environment.js";
import { adminRoutes } from "./routes/admins.js";
import { authRoutes } from "./routes/auth.js";
import { panelRoutes } from "./routes/panel.js";
import { inboundRoutes } from "./routes/inbounds.js";
import { securityRoutes } from "./routes/security.js";
import { tenantRoutes } from "./routes/tenants.js";
import { subpanelRoutes } from "./routes/subpanel.js";
import { settingsRoutes } from "./routes/settings.js";
import { AuthService } from "./services/auth-service.js";

export async function buildApp() {
  const app = Fastify({
    logger: { redact: ["req.headers.cookie", "req.headers.authorization", "req.body.password", "req.body.currentPassword", "req.body.newPassword", "req.body.botToken", "req.body.privateKeyPath", "req.body.secret", "req.body.joinToken", "req.body.agentCredential", "res.body.credential"] },
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
  });
  const database = createDatabase();
  const repository = new KyselySecurityRepository(database);
  const settingsService = new SettingsService(new KyselySettingsRepository(database));
  const authService = new AuthService(repository, settingsService);
  const authorization = createAuthorization(authService, repository, settingsService);
  const inboundRepository = new KyselyInboundRepository(database);
  const inboundService = new InboundService(inboundRepository, new UnavailableXrayRuntime(), settingsService);
  settingsService.setXrayValidator((auth) => inboundService.validateDesiredState(auth));
  settingsService.setXrayApplier((auth) => inboundService.applyGlobalSettings(auth));
  const subpanelService = new SubpanelService(new KyselySubpanelRepository(database), inboundService, settingsService);
  const serverService = new ServerService(new ServerRepository(database), settingsService);

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === environment.webOrigin) return callback(null, true);
      void settingsService.value("network").then((settings) => callback(null, settings.allowedOrigins.includes(origin))).catch(() => callback(null, false));
    },
    credentials: true,
    allowedHeaders: ["content-type", "x-nr-csrf", "x-request-id"],
    exposedHeaders: ["x-request-id"],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 180, timeWindow: "1 minute" });

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    if (request.url.startsWith("/api/v1/agents/")) return;
    if (request.headers.authorization?.startsWith("Bearer ")) return;
    const origin = request.headers.origin;
    if (origin && origin !== environment.webOrigin && !(await settingsService.value("network")).allowedOrigins.includes(origin)) throw new ApiError(403, "CSRF_ORIGIN_REJECTED", "Request origin is not allowed");
    if (request.headers["x-nr-csrf"] !== "1") throw new ApiError(403, "CSRF_TOKEN_REQUIRED", "CSRF protection header is required");
  });

  app.addHook("preHandler", async (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return;
    if (request.url.startsWith("/api/v1/auth/") || request.url.startsWith("/api/v1/settings/general") || request.url.startsWith("/api/v1/settings/security/revoke-sessions")) return;
    if (!(await settingsService.isMaintenanceMode())) return;
    await authorization.requireAuth(request);
    if (request.auth!.role !== "OWNER") throw new ApiError(503, "MAINTENANCE_MODE", "The panel is in maintenance mode; administrative mutations are temporarily disabled");
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ ok: false, error: { code: "VALIDATION_ERROR", message: "Invalid request payload", requestId: request.id, details: error.flatten() } });
    if (error instanceof ApiError) return reply.code(error.statusCode).send({ ok: false, error: { code: error.code, message: error.message, requestId: request.id, ...(error.details ? { details: error.details } : {}) } });
    const databaseError = error as { code?: string };
    if (databaseError.code === "23505") return reply.code(409).send({ ok: false, error: { code: "RESOURCE_CONFLICT", message: "A resource with this identifier already exists", requestId: request.id } });
    request.log.error({ err: error, requestId: request.id }, "request failed");
    return reply.code(500).send({ ok: false, error: { code: "INTERNAL_ERROR", message: "An internal error occurred", requestId: request.id } });
  });

  await app.register(async (api) => {
    await authRoutes(api, { authService, authorization });
    await adminRoutes(api, { repository, authorization });
    await tenantRoutes(api, { repository, authorization });
    await securityRoutes(api, { repository, authorization });
    await panelRoutes(api, { repository, authorization, servers: serverService });
    await inboundRoutes(api, { repository, authorization, service: inboundService });
    await subpanelRoutes(api, { authorization, service: subpanelService });
    await settingsRoutes(api, { authorization, service: settingsService });
  }, { prefix: "/api/v1" });

  app.get("/health", async () => {
    await sql`select 1`.execute(database);
    return { ok: true, status: "healthy" };
  });
  app.addHook("onClose", () => database.destroy());
  return app;
}

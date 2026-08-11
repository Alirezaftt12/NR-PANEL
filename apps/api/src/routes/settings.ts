import { hasPermission, PERMISSIONS, ROLES } from "@nr/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { SettingsService } from "../domain/settings/service.js";
import {
  apiTokenCreateSchema,
  apiTokenStateSchema,
  confirmationSchema,
  sectionPermission,
  settingsSectionSchema,
} from "../domain/settings/schemas.js";
import type { Authorization } from "../lib/auth.js";
import { environment } from "../lib/environment.js";

type Options = { authorization: Authorization; service: SettingsService };
const tokenParams = z.object({ id: z.string().uuid() });
const emailTestSchema = z.object({ recipient: z.string().email().max(320).optional() }).strict();

function metadata(request: FastifyRequest) {
  return { ip: request.ip || null, userAgent: request.headers["user-agent"] ?? null, requestId: request.id };
}

function connection(request: FastifyRequest) {
  const host = request.headers.host || "unknown";
  const portPart = host.startsWith("[") ? host.match(/\]:(\d+)$/)?.[1] : host.match(/:(\d+)$/)?.[1];
  const protocol = request.protocol || "http";
  return { host, protocol, port: portPart ? Number(portPart) : protocol === "https" ? 443 : 80, https: protocol === "https", environment: environment.nodeEnv, panelVersion: environment.panelVersion };
}

export async function settingsRoutes(app: FastifyInstance, { authorization, service }: Options) {
  const masterView = [authorization.requireRole(ROLES.OWNER, ROLES.ADMIN), authorization.requirePermission(PERMISSIONS.SETTINGS_VIEW)];

  app.get("/settings", { preHandler: masterView }, async (request) => {
    const snapshot = await service.snapshot(connection(request));
    if (!hasPermission(request.auth!.role, request.auth!.permissions, PERMISSIONS.SETTINGS_ADVANCED_VIEW)) {
      snapshot.diagnostics = { database: "HEALTHY", api: "HEALTHY", redis: "UNAVAILABLE", websocket: "UNAVAILABLE", agents: { total: 0, online: 0 }, xray: { total: 0, running: 0, configValid: 0, versions: [], nodes: [] }, storage: "UNAVAILABLE", queue: "UNAVAILABLE" };
    }
    return { ok: true, data: snapshot };
  });

  app.get("/settings/api-tokens", { preHandler: masterView }, async (request) => ({ ok: true, data: await service.listApiTokens(request.auth!) }));
  app.post("/settings/api-tokens", { preHandler: masterView }, async (request, reply) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_SECURITY_UPDATE);
    return reply.code(201).send({ ok: true, data: await service.createApiToken(apiTokenCreateSchema.parse(request.body), request.auth!, metadata(request)) });
  });
  app.post("/settings/api-tokens/:id/state", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_SECURITY_UPDATE);
    const { id } = tokenParams.parse(request.params); const body = apiTokenStateSchema.parse(request.body);
    await service.setApiTokenState(id, body.enabled, request.auth!, metadata(request));
    return { ok: true, data: null };
  });
  app.delete("/settings/api-tokens/:id", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_SECURITY_UPDATE);
    const { id } = tokenParams.parse(request.params); confirmationSchema.parse(request.body);
    await service.revokeApiToken(id, request.auth!, metadata(request));
    return { ok: true, data: null };
  });

  app.post("/settings/security/revoke-sessions", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_SECURITY_UPDATE); confirmationSchema.parse(request.body);
    return { ok: true, data: { revoked: await service.revokeOtherSessions(request.auth!, metadata(request)) } };
  });
  app.post("/settings/telegram/test", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE);
    return { ok: true, data: await service.testTelegram() };
  });
  app.post("/settings/email/test", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE);
    return { ok: true, data: await service.testEmail(emailTestSchema.parse(request.body ?? {}).recipient) };
  });
  app.post("/settings/xray/validate", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_XRAY_UPDATE);
    return { ok: true, data: await service.validateXray(request.auth!) };
  });
  app.post("/settings/backups/run", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_BACKUP_UPDATE); confirmationSchema.parse(request.body);
    return { ok: true, data: service.runBackup() };
  });
  app.post("/settings/updates/check", { preHandler: masterView }, async (request) => {
    await authorization.ensurePermission(request, PERMISSIONS.SETTINGS_UPDATE_MANAGE);
    return { ok: true, data: service.checkUpdates() };
  });

  app.get("/settings/:section/history", { preHandler: masterView }, async (request) => {
    const { section } = z.object({ section: settingsSectionSchema }).parse(request.params);
    return { ok: true, data: await service.history(section) };
  });
  app.get("/settings/:section", { preHandler: masterView }, async (request) => {
    const { section } = z.object({ section: settingsSectionSchema }).parse(request.params);
    return { ok: true, data: await service.section(section) };
  });
  app.patch("/settings/:section", { preHandler: masterView }, async (request) => {
    const { section } = z.object({ section: settingsSectionSchema }).parse(request.params);
    await authorization.ensurePermission(request, sectionPermission[section]);
    return { ok: true, data: await service.update(section, request.body, request.auth!, metadata(request)) };
  });
  app.post("/settings/:section/reset", { preHandler: masterView }, async (request) => {
    const { section } = z.object({ section: settingsSectionSchema }).parse(request.params);
    await authorization.ensurePermission(request, sectionPermission[section]); confirmationSchema.parse(request.body);
    return { ok: true, data: await service.reset(section, request.auth!, metadata(request)) };
  });
}

import { ROLES } from "@nr/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authorization } from "../lib/auth.js";
import type { SubpanelService } from "../domain/subpanel/service.js";
import {
  masterSubpanelCreateSchema,
  masterSubpanelPatchSchema,
  portalBulkActionSchema,
  portalRangeSchema,
  portalSettingsPatchSchema,
  portalUserActionSchema,
  portalUserCreateSchema,
  portalUserPatchSchema,
} from "../domain/subpanel/schemas.js";

type Options = { authorization: Authorization; service: SubpanelService };
const idParams = z.object({ id: z.string().uuid() });
const tokenParams = z.object({ token: z.string().min(32).max(256) });
const context = (request: { id: string; ip: string }) => ({ requestId: request.id, ip: request.ip });

export async function subpanelRoutes(app: FastifyInstance, { authorization, service }: Options) {
  const portalRole = authorization.requireRole(ROLES.RESELLER, ROLES.SUB_RESELLER);

  app.get("/subpanel/dashboard", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.dashboard(request.auth!) }));
  app.get("/subpanel/users", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.usersPage(request.auth!) }));
  app.post("/subpanel/users", { preHandler: portalRole }, async (request, reply) => reply.code(201).send({ ok: true, data: await service.createUser(request.auth!, portalUserCreateSchema.parse(request.body), context(request)) }));
  app.patch("/subpanel/users/:id", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.updateUser(request.auth!, idParams.parse(request.params).id, portalUserPatchSchema.parse(request.body), context(request)) }));
  app.post("/subpanel/users/:id/actions", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.userAction(request.auth!, idParams.parse(request.params).id, portalUserActionSchema.parse(request.body), context(request)) }));
  app.post("/subpanel/users/bulk", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.bulkAction(request.auth!, portalBulkActionSchema.parse(request.body), context(request)) }));

  app.get("/subpanel/users/:id/config", { preHandler: portalRole }, async (request) => ({ ok: true, data: { value: await service.configUri(request.auth!, idParams.parse(request.params).id) } }));
  app.get("/subpanel/users/:id/config/qr", { preHandler: portalRole }, async (request) => ({ ok: true, data: { value: await service.qrDataUrl(await service.configUri(request.auth!, idParams.parse(request.params).id)) } }));
  app.get("/subpanel/users/:id/subscription", { preHandler: portalRole }, async (request) => ({ ok: true, data: { value: await service.subscriptionUrl(request.auth!, idParams.parse(request.params).id) } }));
  app.get("/subpanel/users/:id/subscription/qr", { preHandler: portalRole }, async (request) => ({ ok: true, data: { value: await service.qrDataUrl(await service.subscriptionUrl(request.auth!, idParams.parse(request.params).id)) } }));
  app.post("/subpanel/users/:id/subscription/rotate", { preHandler: portalRole }, async (request) => ({ ok: true, data: { value: await service.rotateSubscription(request.auth!, idParams.parse(request.params).id, context(request)) } }));
  app.patch("/subpanel/users/:id/subscription", { preHandler: portalRole }, async (request) => {
    const body = z.object({ enabled: z.boolean() }).parse(request.body);
    return { ok: true, data: await service.setSubscriptionEnabled(request.auth!, idParams.parse(request.params).id, body.enabled, context(request)) };
  });

  app.get("/subpanel/users/export", { preHandler: portalRole }, async (request, reply) => {
    const { kind } = z.object({ kind: z.enum(["configs", "subscriptions"]) }).parse(request.query);
    const content = await service.exportUsers(request.auth!, kind, context(request));
    reply.header("content-type", "text/plain; charset=utf-8").header("content-disposition", `attachment; filename=nr-panel-${kind}.txt`);
    return reply.send(content);
  });

  app.get("/subpanel/traffic", { preHandler: portalRole }, async (request) => {
    const range = portalRangeSchema.catch("7d").parse((request.query as { range?: string }).range);
    return { ok: true, data: await service.traffic(request.auth!, range) };
  });
  app.get("/subpanel/subscriptions", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.subscriptions(request.auth!) }));
  app.get("/subpanel/settings", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.settings(request.auth!) }));
  app.patch("/subpanel/settings", { preHandler: portalRole }, async (request) => ({ ok: true, data: await service.updateSettings(request.auth!, portalSettingsPatchSchema.parse(request.body), context(request)) }));

  app.get("/sub/:token", { logLevel: "silent" }, async (request, reply) => {
    const content = await service.consumeSubscription(tokenParams.parse(request.params).token);
    reply.header("content-type", "text/plain; charset=utf-8").header("cache-control", "no-store");
    return reply.send(content);
  });

  app.get("/subpanels", { preHandler: authorization.requireOwner }, async (request) => ({ ok: true, data: await service.listMaster(request.auth!) }));
  app.get("/subpanels/options", { preHandler: authorization.requireOwner }, async (request) => ({ ok: true, data: await service.masterOptions(request.auth!) }));
  app.post("/subpanels", { preHandler: authorization.requireOwner }, async (request, reply) => reply.code(201).send({ ok: true, data: await service.createMaster(request.auth!, masterSubpanelCreateSchema.parse(request.body), context(request)) }));
  app.patch("/subpanels/:id", { preHandler: authorization.requireOwner }, async (request) => ({ ok: true, data: await service.updateMaster(request.auth!, idParams.parse(request.params).id, masterSubpanelPatchSchema.parse(request.body), context(request)) }));
}

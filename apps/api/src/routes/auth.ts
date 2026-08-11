import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Authorization } from "../lib/auth.js";
import { environment } from "../lib/environment.js";
import type { AuthService } from "../services/auth-service.js";

type AuthRoutesOptions = {
  authService: AuthService;
  authorization: Authorization;
};

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(1).max(256),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(1).max(256),
});
const changeUsernameSchema = z.object({ currentPassword: z.string().min(1).max(256), username: z.string().trim().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/) }).strict();

const sessionParamsSchema = z.object({ id: z.string().uuid() });

function metadata(request: Parameters<Authorization["requireAuth"]>[0]) {
  return {
    ip: request.ip || null,
    userAgent: request.headers["user-agent"] ?? null,
    requestId: request.id,
  };
}

export async function authRoutes(app: FastifyInstance, options: AuthRoutesOptions) {
  const { authService, authorization } = options;

  app.post("/auth/login", {
    config: { rateLimit: { max: environment.loginRateLimitMax * 3, timeWindow: environment.loginRateLimitWindowSeconds * 1000 } },
  }, async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.login(body.identifier, body.password, metadata(request));
    reply.setCookie("nr_session", result.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: environment.production,
      path: "/",
      maxAge: result.sessionTtlSeconds,
    });
    return { ok: true, data: result.identity };
  });

  app.post("/auth/logout", { preHandler: authorization.requireAuth }, async (request, reply) => {
    await authService.logout(request.auth!, metadata(request));
    reply.clearCookie("nr_session", { path: "/" });
    return { ok: true, data: null };
  });

  app.post("/auth/logout-all", { preHandler: authorization.requireAuth }, async (request, reply) => {
    const revoked = await authService.logoutAll(request.auth!, metadata(request));
    reply.clearCookie("nr_session", { path: "/" });
    return { ok: true, data: { revoked } };
  });

  app.get("/auth/me", { preHandler: authorization.requireAuth }, async (request) => ({ ok: true, data: request.auth }));

  app.get("/auth/sessions", { preHandler: authorization.requireAuth }, async (request) => ({
    ok: true,
    data: await authService.listSessions(request.auth!),
  }));

  app.delete("/auth/sessions/:id", { preHandler: authorization.requireAuth }, async (request) => {
    const { id } = sessionParamsSchema.parse(request.params);
    await authService.revokeOwnSession(request.auth!, id, metadata(request));
    return { ok: true, data: null };
  });

  app.post("/auth/change-password", { preHandler: authorization.requireAuth }, async (request) => {
    const body = changePasswordSchema.parse(request.body);
    await authService.changePassword(request.auth!, body.currentPassword, body.newPassword, metadata(request));
    return { ok: true, data: { otherSessionsRevoked: true } };
  });

  app.post("/auth/change-username", { preHandler: authorization.requireAuth }, async (request) => {
    const body = changeUsernameSchema.parse(request.body);
    await authService.changeUsername(request.auth!, body.currentPassword, body.username, metadata(request));
    return { ok: true, data: null };
  });
}

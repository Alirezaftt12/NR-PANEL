import { canAccessTenant, hasPermission, ROLES, type Permission, type Role } from "@nr/shared";
import type { FastifyRequest } from "fastify";
import { AUDIT_ACTIONS } from "../domain/audit-actions.js";
import type { AuthContext } from "../domain/identity.js";
import type { KyselySecurityRepository } from "../database/security-repository.js";
import type { AuthService } from "../services/auth-service.js";
import { forbidden } from "./errors.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function createAuthorization(
  authService: AuthService,
  repository: KyselySecurityRepository,
  apiTokens?: { authenticateApiToken(secret: string, ip: string): Promise<AuthContext> },
) {
  async function requireAuth(request: FastifyRequest) {
    const authorization = request.headers.authorization;
    if (authorization?.startsWith("Bearer ") && apiTokens) {
      request.auth = await apiTokens.authenticateApiToken(authorization.slice(7).trim(), request.ip);
      return;
    }
    const token = request.cookies.nr_session;
    request.auth = await authService.authenticate(token ?? "");
  }

  function requireRole(...roles: Role[]) {
    return async (request: FastifyRequest) => {
      await requireAuth(request);
      if (!roles.includes(request.auth!.role)) await deny(request, `role:${roles.join("|")}`);
    };
  }

  function requirePermission(permission: Permission) {
    return async (request: FastifyRequest) => {
      await requireAuth(request);
      if (!hasPermission(request.auth!.role, request.auth!.permissions, permission)) await deny(request, permission);
    };
  }

  async function ensurePermission(request: FastifyRequest, permission: Permission) {
    if (!request.auth) await requireAuth(request);
    if (!hasPermission(request.auth!.role, request.auth!.permissions, permission)) await deny(request, permission);
  }

  function requireTenantAccess(resolveTenantId: (request: FastifyRequest) => string) {
    return async (request: FastifyRequest) => {
      await requireAuth(request);
      const tenantId = resolveTenantId(request);
      if (!canAccessTenant(request.auth!.role, request.auth!.tenantIds, tenantId)) await deny(request, `tenant:${tenantId}`, tenantId);
    };
  }

  async function deny(request: FastifyRequest, requirement: string, tenantId?: string) {
    const identity = request.auth!;
    await repository.recordAudit({
      actorId: identity.userId,
      actorRole: identity.role,
      tenantId: tenantId ?? identity.tenantIds[0] ?? null,
      action: AUDIT_ACTIONS.PERMISSION_DENIED,
      targetType: "authorization",
      ip: request.ip,
      requestId: request.id,
      severity: "warning",
      message: "Authorization denied",
      metadata: { requirement, path: request.url, method: request.method },
    });
    throw forbidden();
  }

  const requireOwner = requireRole(ROLES.OWNER);
  return { requireAuth, requireRole, requirePermission, ensurePermission, requireTenantAccess, requireOwner };
}

export type Authorization = ReturnType<typeof createAuthorization>;

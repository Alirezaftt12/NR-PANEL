import { randomUUID } from "node:crypto";
import { AUDIT_ACTIONS } from "../domain/audit-actions.js";
import type { AuthContext, RequestMetadata } from "../domain/identity.js";
import { ApiError, unauthorized } from "../lib/errors.js";
import { environment } from "../lib/environment.js";
import { ipMatchesCidr } from "../domain/settings/service.js";
import {
  createSessionToken,
  getDummyPasswordHash,
  hashIdentifier,
  hashPassword,
  hashSessionToken,
  normalizeIdentifier,
  verifyPassword,
} from "../lib/security.js";
import type { AuthRepository } from "./auth-repository.js";

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly policies?: { securityPolicy(): Promise<{
      sessionTtlMinutes: number; autoLogoutMinutes: number; maximumConcurrentSessions: number; loginRateLimit: number;
      failedLoginThreshold: number; lockoutMinutes: number; minimumPasswordLength: number; requireUppercase: boolean;
      requireLowercase: boolean; requireNumber: boolean; requireSpecial: boolean; ipAllowlist: string[];
    }> },
  ) {}

  private async policy() {
    return this.policies?.securityPolicy() ?? {
      sessionTtlMinutes: environment.sessionTtlSeconds / 60, autoLogoutMinutes: environment.sessionIdleTimeoutSeconds / 60,
      maximumConcurrentSessions: 0, loginRateLimit: environment.loginRateLimitMax, failedLoginThreshold: environment.loginRateLimitMax,
      lockoutMinutes: environment.loginRateLimitWindowSeconds / 60, minimumPasswordLength: 12, requireUppercase: true,
      requireLowercase: true, requireNumber: true, requireSpecial: true, ipAllowlist: [],
    };
  }

  async login(identifierInput: string, password: string, metadata: RequestMetadata) {
    const policy = await this.policy();
    const identifier = normalizeIdentifier(identifierInput);
    const identifierHash = hashIdentifier(identifier);
    if (policy.ipAllowlist.length && (!metadata.ip || !policy.ipAllowlist.some((cidr) => ipMatchesCidr(metadata.ip!, cidr)))) {
      await this.repository.recordLoginFailure(identifierHash, metadata, "IP_NOT_ALLOWED");
      throw new ApiError(403, "AUTH_IP_NOT_ALLOWED", "Login is not allowed from this address");
    }
    const since = new Date(Date.now() - policy.lockoutMinutes * 60_000);
    const failureCount = await this.repository.countRecentFailures(identifierHash, metadata.ip, since);
    if (failureCount >= Math.min(policy.loginRateLimit, policy.failedLoginThreshold)) {
      await this.repository.recordLoginFailure(identifierHash, metadata, "RATE_LIMITED");
      throw new ApiError(429, "AUTH_RATE_LIMITED", "Too many login attempts. Try again later.");
    }

    const admin = await this.repository.findAdminByIdentifier(identifier);
    const passwordHash = admin?.passwordHash ?? await getDummyPasswordHash();
    const validPassword = await verifyPassword(password, passwordHash);
    if (!admin || !validPassword || admin.status !== "ACTIVE" || !admin.enabled) {
      await this.repository.recordLoginFailure(identifierHash, metadata, "INVALID_CREDENTIALS");
      throw new ApiError(401, "AUTH_INVALID_CREDENTIALS", "Invalid credentials");
    }

    const token = createSessionToken();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + policy.sessionTtlMinutes * 60_000);
    await this.repository.createLoginSession(admin, {
      id: sessionId,
      adminId: admin.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
      metadata,
    });
    if (policy.maximumConcurrentSessions > 0) await this.repository.enforceConcurrentSessionLimit?.(admin.id, sessionId, policy.maximumConcurrentSessions);
    return { token, identity: await this.authenticate(token), sessionTtlSeconds: policy.sessionTtlMinutes * 60 };
  }

  async authenticate(token: string): Promise<AuthContext> {
    if (!token || token.length < 32) throw unauthorized();
    const session = await this.repository.resolveSession(hashSessionToken(token));
    if (!session || session.revokedAt || session.adminStatus !== "ACTIVE" || !session.enabled) throw unauthorized();
    const now = new Date();
    const policy = await this.policy();
    const idleDeadline = session.lastActivityAt.getTime() + policy.autoLogoutMinutes * 60_000;
    if (session.expiresAt <= now || idleDeadline <= now.getTime()) throw unauthorized();

    if (now.getTime() - session.lastActivityAt.getTime() > 60_000) {
      await this.repository.touchSession(session.id, now);
    }
    const [permissions, tenantIds] = await Promise.all([
      this.repository.getPermissions(session.adminId),
      this.repository.getTenantIds(session.adminId),
    ]);
    return {
      userId: session.adminId,
      username: session.username,
      email: session.email,
      role: session.role,
      permissions,
      primaryTenantId: session.tenantId,
      tenantIds,
      sessionId: session.id,
      sessionExpiresAt: session.expiresAt.toISOString(),
    };
  }

  async logout(identity: AuthContext, metadata: RequestMetadata) {
    await this.repository.revokeSession(identity.sessionId, identity.userId, {
      actorId: identity.userId,
      actorRole: identity.role,
      action: identity.role === "RESELLER" || identity.role === "SUB_RESELLER" ? AUDIT_ACTIONS.SUBPANEL_LOGOUT : AUDIT_ACTIONS.AUTH_LOGOUT,
      targetType: "session",
      targetId: identity.sessionId,
      ip: metadata.ip,
      requestId: metadata.requestId,
      message: "Current session logged out",
    });
  }

  async logoutAll(identity: AuthContext, metadata: RequestMetadata) {
    return this.repository.revokeAllSessions(identity.userId, {
      actorId: identity.userId,
      actorRole: identity.role,
      action: AUDIT_ACTIONS.AUTH_LOGOUT_ALL,
      targetType: "admin",
      targetId: identity.userId,
      ip: metadata.ip,
      requestId: metadata.requestId,
      message: "All sessions revoked",
    });
  }

  listSessions(identity: AuthContext) {
    return this.repository.listSessions(identity.userId, identity.sessionId);
  }

  async revokeOwnSession(identity: AuthContext, sessionId: string, metadata: RequestMetadata) {
    const revoked = await this.repository.revokeSession(sessionId, identity.userId, {
      actorId: identity.userId,
      actorRole: identity.role,
      action: AUDIT_ACTIONS.SESSION_REVOKED,
      targetType: "session",
      targetId: sessionId,
      ip: metadata.ip,
      requestId: metadata.requestId,
      message: "Session revoked by account owner",
    });
    if (!revoked) throw new ApiError(404, "SESSION_NOT_FOUND", "Session not found");
  }

  async changePassword(identity: AuthContext, currentPassword: string, newPassword: string, metadata: RequestMetadata) {
    const admin = await this.repository.findAdminByIdentifier(identity.username);
    if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) {
      throw new ApiError(400, "AUTH_CURRENT_PASSWORD_INVALID", "Current password is invalid");
    }
    const policy = await this.policy();
    const violations = [
      newPassword.length < policy.minimumPasswordLength ? `Password must contain at least ${policy.minimumPasswordLength} characters` : null,
      policy.requireUppercase && !/[A-Z]/.test(newPassword) ? "Password must contain an uppercase letter" : null,
      policy.requireLowercase && !/[a-z]/.test(newPassword) ? "Password must contain a lowercase letter" : null,
      policy.requireNumber && !/[0-9]/.test(newPassword) ? "Password must contain a number" : null,
      policy.requireSpecial && !/[^A-Za-z0-9]/.test(newPassword) ? "Password must contain a symbol" : null,
    ].filter(Boolean);
    if (violations.length) throw new ApiError(400, "PASSWORD_POLICY_VIOLATION", violations.join("; "));
    const newHash = await hashPassword(newPassword);
    await this.repository.changePassword(identity.userId, newHash, identity.sessionId, {
      actorId: identity.userId,
      actorRole: identity.role,
      action: AUDIT_ACTIONS.AUTH_PASSWORD_CHANGED,
      targetType: "admin",
      targetId: identity.userId,
      ip: metadata.ip,
      requestId: metadata.requestId,
      message: "Password changed and other sessions revoked",
    });
  }

  async changeUsername(identity: AuthContext, currentPassword: string, usernameInput: string, metadata: RequestMetadata) {
    const admin = await this.repository.findAdminByIdentifier(identity.username);
    if (!admin || !(await verifyPassword(currentPassword, admin.passwordHash))) throw new ApiError(400, "AUTH_CURRENT_PASSWORD_INVALID", "Current password is invalid");
    const username = normalizeIdentifier(usernameInput);
    if (["admin", "administrator", "root"].includes(username)) throw new ApiError(400, "USERNAME_PREDICTABLE", "Predictable administrator usernames are not allowed");
    if (!this.repository.changeUsername) throw new ApiError(503, "USERNAME_CHANGE_UNAVAILABLE", "Username change repository is unavailable");
    await this.repository.changeUsername(identity.userId, username, {
      actorId: identity.userId, actorRole: identity.role, action: "AUTH_USERNAME_CHANGED", targetType: "admin", targetId: identity.userId,
      ip: metadata.ip, requestId: metadata.requestId, message: "Administrator username changed", metadata: { previousUsername: identity.username, username },
    });
  }
}

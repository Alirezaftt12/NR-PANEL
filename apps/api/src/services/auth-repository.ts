import type { Permission } from "@nr/shared";
import type { AuditEventInput, LoginAdmin, RequestMetadata, SessionRecord } from "../domain/identity.js";

export type NewSession = {
  id: string;
  adminId: string;
  tokenHash: string;
  expiresAt: Date;
  metadata: RequestMetadata;
};

export type SessionSummary = {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastActivityAt: Date;
  expiresAt: Date;
  current: boolean;
};

export interface AuthRepository {
  findAdminByIdentifier(identifier: string): Promise<LoginAdmin | null>;
  countRecentFailures(identifierHash: string, ip: string | null, since: Date): Promise<number>;
  recordLoginFailure(identifierHash: string, metadata: RequestMetadata, reason: string): Promise<void>;
  createLoginSession(admin: LoginAdmin, session: NewSession): Promise<void>;
  resolveSession(tokenHash: string): Promise<SessionRecord | null>;
  getPermissions(adminId: string, roleId?: string): Promise<Permission[]>;
  getTenantIds(adminId: string): Promise<string[]>;
  touchSession(sessionId: string, at: Date): Promise<void>;
  revokeSession(sessionId: string, adminId: string, audit: AuditEventInput): Promise<boolean>;
  revokeAllSessions(adminId: string, audit: AuditEventInput, exceptSessionId?: string): Promise<number>;
  listSessions(adminId: string, currentSessionId: string): Promise<SessionSummary[]>;
  changePassword(adminId: string, passwordHash: string, currentSessionId: string, audit: AuditEventInput): Promise<void>;
  changeUsername?(adminId: string, username: string, audit: AuditEventInput): Promise<void>;
  recordAudit(event: AuditEventInput): Promise<void>;
  enforceConcurrentSessionLimit?(adminId: string, keepSessionId: string, maximumSessions: number): Promise<number>;
}

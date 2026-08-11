import type { Permission, Role } from "@nr/shared";

export type AdminStatus = "ACTIVE" | "DISABLED";
export type TenantStatus = "ACTIVE" | "DISABLED" | "EXPIRED";

export type AuthContext = {
  userId: string;
  username: string;
  email: string | null;
  role: Role;
  permissions: Permission[];
  primaryTenantId: string;
  tenantIds: string[];
  sessionId: string;
  sessionExpiresAt: string;
};

export type LoginAdmin = {
  id: string;
  username: string;
  email: string | null;
  passwordHash: string;
  role: Role;
  status: AdminStatus;
  enabled: boolean;
};

export type RequestMetadata = {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
};

export type AuditEventInput = {
  actorId: string | null;
  actorRole: Role | null;
  tenantId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
  severity?: "debug" | "info" | "warning" | "error" | "critical";
  category?: "SERVER" | "XRAY" | "SUB_PANEL" | "ADMIN" | "SECURITY" | "CONFIG" | "DATABASE" | "BACKUP" | "SYSTEM" | "ERROR";
  message: string;
};

export type SessionRecord = {
  id: string;
  adminId: string;
  username: string;
  email: string | null;
  role: Role;
  adminStatus: AdminStatus;
  enabled: boolean;
  tenantId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastActivityAt: Date;
};

import "server-only";
import type { Permission, Role } from "@nr/shared";
import { serverApiRequest } from "./server-api";

export type ServerAuthUser = {
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

export async function currentPanelUser() {
  try { return await serverApiRequest<ServerAuthUser>("/auth/me"); }
  catch { return null; }
}

export const isSubpanelUser = (user: ServerAuthUser | null) => user?.role === "RESELLER" || user?.role === "SUB_RESELLER";

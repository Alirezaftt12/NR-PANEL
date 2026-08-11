import { ROLES, type SubpanelCapabilities } from "@nr/shared";
import type { AuthContext } from "../identity.js";
import { ApiError } from "../../lib/errors.js";

export type TenantQuotaState = {
  status: "ACTIVE" | "DISABLED" | "EXPIRED";
  expiresAt: Date | null;
  userLimit: number | null;
  trafficCredit: bigint | null;
  createdUsers: number;
  allocatedTraffic: bigint;
};

export function portalTenantId(auth: AuthContext) {
  if (auth.role !== ROLES.RESELLER && auth.role !== ROLES.SUB_RESELLER) {
    throw new ApiError(403, "SUBPANEL_ROLE_REQUIRED", "This endpoint is only available to sub-panel accounts");
  }
  if (!auth.primaryTenantId || !auth.tenantIds.includes(auth.primaryTenantId)) {
    throw new ApiError(403, "SUBPANEL_TENANT_REQUIRED", "The authenticated account has no valid primary tenant");
  }
  return auth.primaryTenantId;
}

export function assertTenantActive(state: Pick<TenantQuotaState, "status" | "expiresAt">, now = new Date()) {
  if (state.status !== "ACTIVE" || (state.expiresAt && state.expiresAt <= now)) {
    throw new ApiError(403, "SUBPANEL_EXPIRED", "The sub-panel is disabled or expired");
  }
}

export function assertCreateQuota(state: TenantQuotaState, requestedTraffic: bigint | null) {
  assertTenantActive(state);
  if (state.userLimit !== null && state.createdUsers >= state.userLimit) {
    throw new ApiError(409, "USER_LIMIT_EXCEEDED", "The sub-panel user limit has been reached");
  }
  if (state.trafficCredit !== null && (requestedTraffic === null || state.allocatedTraffic + requestedTraffic > state.trafficCredit)) {
    throw new ApiError(409, "TRAFFIC_QUOTA_EXCEEDED", "The sub-panel traffic allocation credit would be exceeded");
  }
}

export function assertTrafficQuota(state: TenantQuotaState, nextAllocatedTraffic: bigint | null) {
  assertTenantActive(state);
  if (state.trafficCredit !== null && (nextAllocatedTraffic === null || nextAllocatedTraffic > state.trafficCredit)) {
    throw new ApiError(409, "TRAFFIC_QUOTA_EXCEEDED", "The sub-panel traffic allocation credit would be exceeded");
  }
}

export function assertCapability(capabilities: SubpanelCapabilities, capability: keyof SubpanelCapabilities) {
  if (!capabilities[capability]) {
    throw new ApiError(403, "SUBPANEL_CAPABILITY_DISABLED", `The ${capability} capability is disabled by the OWNER`);
  }
}

export function assertInboundAssigned(assigned: boolean) {
  if (!assigned) throw new ApiError(404, "INBOUND_NOT_ASSIGNED", "The selected inbound is not assigned to this sub-panel");
}

export function resolveExpiration(input: { durationDays?: number | null; expiresAt?: string | null }, panelExpiresAt: Date | null, now = new Date()) {
  const requested = input.durationDays
    ? new Date(now.getTime() + input.durationDays * 86_400_000)
    : input.expiresAt ? new Date(input.expiresAt) : null;
  if (requested && requested <= now) throw new ApiError(400, "USER_EXPIRATION_INVALID", "User expiration must be in the future");
  if (requested && panelExpiresAt && requested > panelExpiresAt) {
    throw new ApiError(409, "USER_EXPIRATION_EXCEEDS_SUBPANEL", "User expiration cannot exceed the sub-panel expiration");
  }
  return requested;
}

"use client";

import type { Permission, Role } from "@nr/shared";
import { apiRequest, ClientApiError } from "./api-client";

export type AuthUser = {
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

export type AuthState =
  | { status: "loading"; user: null; error: null }
  | { status: "authenticated"; user: AuthUser; error: null }
  | { status: "unauthenticated"; user: null; error: null }
  | { status: "error"; user: null; error: string };

let state: AuthState = { status: "loading", user: null, error: null };
let activeRequest: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit(next: AuthState) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getAuthSnapshot() {
  return state;
}

export function getServerAuthSnapshot(): AuthState {
  return { status: "loading", user: null, error: null };
}

export function subscribeAuth(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function refreshAuth() {
  if (activeRequest) return activeRequest;
  emit({ status: "loading", user: null, error: null });
  activeRequest = apiRequest<AuthUser>("/auth/me")
    .then((user) => emit({ status: "authenticated", user, error: null }))
    .catch((error: unknown) => {
      if (error instanceof ClientApiError && error.status === 401) emit({ status: "unauthenticated", user: null, error: null });
      else emit({ status: "error", user: null, error: "ارتباط با سرویس احراز هویت برقرار نشد." });
    })
    .finally(() => { activeRequest = null; });
  return activeRequest;
}

export function clearAuth() {
  emit({ status: "unauthenticated", user: null, error: null });
}

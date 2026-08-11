"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { getAuthSnapshot, getServerAuthSnapshot, refreshAuth, subscribeAuth, type AuthState } from "../../lib/auth-store";

type AuthContextValue = AuthState & { retry: () => Promise<void> };
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getServerAuthSnapshot);
  useEffect(() => { void refreshAuth(); }, []);
  const value = useMemo<AuthContextValue>(() => ({ ...state, retry: refreshAuth }), [state]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

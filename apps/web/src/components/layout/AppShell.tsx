"use client";

import { hasPermission } from "@nr/shared";
import { ShieldX } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useAuth } from "../auth/AuthProvider";
import { apiRequest } from "../../lib/api-client";
import { clearAuth } from "../../lib/auth-store";
import {
  getServerThemeSnapshot,
  getThemeSnapshot,
  setTheme,
  subscribeTheme,
} from "../../lib/theme-store";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { pagePermissions } from "./navigation";
import { SubPanelShell } from "../subpanel/SubPanelShell";

export function AppShell({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  if (auth.status !== "authenticated") return null;
  const requiredPermission = pagePermissions[pathname];
  const canViewPage = !requiredPermission || hasPermission(auth.user.role, auth.user.permissions, requiredPermission);

  function toggleTheme() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  async function logout() {
    try { await apiRequest("/auth/logout", { method: "POST" }); } finally {
      clearAuth();
      router.replace("/login");
    }
  }

  if (auth.user.role === "RESELLER" || auth.user.role === "SUB_RESELLER") {
    return <SubPanelShell user={auth.user} theme={theme} onToggleTheme={toggleTheme} onLogout={logout}>{children}</SubPanelShell>;
  }

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : ""} ${mobileOpen ? "mobile-navigation-open" : ""}`}>
      <Sidebar
        collapsed={collapsed}
        theme={theme}
        onToggleCollapse={() => setCollapsed((current) => !current)}
        onToggleTheme={toggleTheme}
        onNavigate={() => setMobileOpen(false)}
        onLogout={logout}
        user={auth.user}
      />
      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="app-workspace">
        <Topbar theme={theme} onToggleTheme={toggleTheme} onOpenMobile={() => setMobileOpen(true)} />
        <main className="app-content">
          {canViewPage ? children : (
            <section className="permission-denied">
              <ShieldX size={30} />
              <h2>دسترسی مجاز نیست</h2>
              <p>حساب شما مجوز لازم برای مشاهده این بخش را ندارد.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

"use client";

import { Gauge, LayoutDashboard, LogOut, Menu, Moon, RefreshCw, Settings, Sun, Users, Wifi, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AuthUser } from "../../lib/auth-store";
import type { Theme } from "../../lib/theme-store";
import { IconButton } from "../ui/IconButton";

const items = [
  { href: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
  { href: "/users", label: "کاربران", icon: Users },
  { href: "/traffic", label: "ترافیک", icon: Gauge },
  { href: "/subscriptions", label: "اشتراک‌ها", icon: Wifi },
  { href: "/settings", label: "تنظیمات", icon: Settings },
] as const;

const titles: Record<string, string> = Object.fromEntries(items.map((item) => [item.href, item.label]));

type Props = {
  children: React.ReactNode;
  user: AuthUser;
  theme: Theme;
  onToggleTheme: () => void;
  onLogout: () => void;
};

export function SubPanelShell({ children, user, theme, onToggleTheme, onLogout }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  return (
    <div className={`subpanel-shell ${mobileOpen ? "mobile-navigation-open" : ""}`}>
      <aside className="subpanel-sidebar" aria-label="ناوبری زیرپنل">
        <div className="subpanel-brand">
          <Link href="/dashboard" onClick={() => setMobileOpen(false)}><span>NR</span><strong>SUB PANEL<small>USER MANAGEMENT</small></strong></Link>
          <IconButton className="mobile-close-button" label="بستن منو" onClick={() => setMobileOpen(false)}><X size={18} /></IconButton>
        </div>
        <nav>
          {items.map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={pathname === item.href ? "is-active" : ""} onClick={() => setMobileOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="subpanel-account">
          <div><span>{user.username.slice(0, 1).toUpperCase()}</span><p><strong>{user.username}</strong><small>SUB PANEL</small></p></div>
          <button type="button" onClick={onLogout}><LogOut size={18} /><span>خروج</span></button>
        </div>
      </aside>
      <button type="button" className={`mobile-nav-backdrop ${mobileOpen ? "is-visible" : ""}`} aria-label="بستن منو" onClick={() => setMobileOpen(false)} />
      <div className="subpanel-workspace">
        <header className="subpanel-header">
          <div><IconButton className="mobile-menu-button" label="باز کردن منو" onClick={() => setMobileOpen(true)}><Menu size={20} /></IconButton><h1>{titles[pathname] ?? "زیرپنل"}</h1></div>
          <div>
            <IconButton label="تغییر پوسته" onClick={onToggleTheme}>{theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}</IconButton>
            <IconButton label="تازه‌سازی" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}><RefreshCw className={refreshing ? "is-spinning" : ""} size={18} /></IconButton>
          </div>
        </header>
        <main className="subpanel-content">{children}</main>
      </div>
    </div>
  );
}

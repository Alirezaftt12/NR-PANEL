"use client";

import { ChevronLeft, LogOut, Moon, PanelRightClose, Sun, X } from "lucide-react";
import { hasPermission } from "@nr/shared";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AuthUser } from "../../lib/auth-store";
import type { Theme } from "../../lib/theme-store";
import { IconButton } from "../ui/IconButton";
import { navigationGroups } from "./navigation";

type SidebarProps = {
  collapsed: boolean;
  theme: Theme;
  onToggleCollapse: () => void;
  onToggleTheme: () => void;
  onNavigate: () => void;
  onLogout: () => void;
  user: AuthUser;
};

export function Sidebar({ collapsed, theme, onToggleCollapse, onToggleTheme, onNavigate, onLogout, user }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="app-sidebar" aria-label="ناوبری اصلی">
      <div className="sidebar-brand-row">
        <Link className="brand-lockup" href="/dashboard" onClick={onNavigate} aria-label="NR PANEL - داشبورد">
          <span className="brand-symbol">NR</span>
          <span className="brand-copy">
            <strong>NR PANEL</strong>
            <small>VPN MANAGEMENT</small>
          </span>
        </Link>
        <IconButton
          className="desktop-collapse-button"
          label={collapsed ? "باز کردن نوار کناری" : "جمع کردن نوار کناری"}
          onClick={onToggleCollapse}
        >
          {collapsed ? <PanelRightClose size={18} /> : <ChevronLeft size={18} />}
        </IconButton>
        <IconButton className="mobile-close-button" label="بستن منو" onClick={onNavigate}>
          <X size={19} />
        </IconButton>
      </div>

      <nav className="sidebar-navigation">
        {navigationGroups.map((group, groupIndex) => {
          const visibleItems = group.items.filter((item) => hasPermission(user.role, user.permissions, item.permission));
          if (visibleItems.length === 0) return null;
          return (
          <div className="navigation-group" key={group.label ?? `primary-${groupIndex}`}>
            {group.label ? <p className="navigation-label">{group.label}</p> : null}
            {visibleItems.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  className={`navigation-link ${active ? "is-active" : ""}`}
                  href={item.href}
                  key={item.href}
                  onClick={onNavigate}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span className="sidebar-label-text">{item.label}</span>
                </Link>
              );
            })}
          </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="current-admin">
          <span className="admin-avatar" aria-hidden="true">{user.username.slice(0, 1).toUpperCase()}</span>
          <span className="admin-copy">
            <strong>{user.username}</strong>
            <small>{user.role}</small>
          </span>
        </div>
        <button className="sidebar-action" type="button" onClick={onToggleTheme} title={collapsed ? "تغییر پوسته" : undefined}>
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          <span className="sidebar-label-text">پوسته {theme === "dark" ? "روشن" : "تیره"}</span>
        </button>
        <button className="sidebar-action sidebar-logout" type="button" onClick={onLogout} title={collapsed ? "خروج" : undefined}>
          <LogOut size={17} />
          <span className="sidebar-label-text">خروج امن</span>
        </button>
      </div>
    </aside>
  );
}

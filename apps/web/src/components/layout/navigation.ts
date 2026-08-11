import {
  Activity,
  Archive,
  Bell,
  Boxes,
  Cable,
  FileCode2,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Network,
  RadioTower,
  Server,
  Settings,
  Shield,
  Users,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { PERMISSIONS, type Permission } from "@nr/shared";

export type NavigationItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: Permission;
};

export type NavigationGroup = {
  label?: string;
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  { items: [{ label: "داشبورد", href: "/dashboard", icon: LayoutDashboard, permission: PERMISSIONS.DASHBOARD_VIEW }] },
  {
    label: "مدیریت",
    items: [
      { label: "کاربران", href: "/users", icon: Users, permission: PERMISSIONS.USER_VIEW },
      { label: "زیرپنل‌ها", href: "/subpanels", icon: Network, permission: PERMISSIONS.SUBPANEL_VIEW },
      { label: "کانفیگ‌ها", href: "/configs", icon: FileCode2, permission: PERMISSIONS.CONFIG_VIEW },
      { label: "اشتراک‌ها", href: "/subscriptions", icon: Wifi, permission: PERMISSIONS.CONFIG_VIEW },
    ],
  },
  {
    label: "سرورها",
    items: [
      { label: "سرورها", href: "/servers", icon: Server, permission: PERMISSIONS.SERVER_VIEW },
      { label: "Xray", href: "/xray", icon: Activity, permission: PERMISSIONS.XRAY_VIEW },
      { label: "Inbounds", href: "/inbounds", icon: Cable, permission: PERMISSIONS.XRAY_VIEW },
      { label: "پروتکل‌ها", href: "/protocols", icon: Boxes, permission: PERMISSIONS.XRAY_VIEW },
    ],
  },
  {
    label: "مانیتورینگ",
    items: [
      { label: "ترافیک", href: "/traffic", icon: Gauge, permission: PERMISSIONS.TRAFFIC_VIEW },
      { label: "مانیتور سیستم", href: "/monitor", icon: RadioTower, permission: PERMISSIONS.SERVER_VIEW },
      { label: "لاگ‌ها", href: "/logs", icon: FileText, permission: PERMISSIONS.LOG_VIEW },
    ],
  },
  {
    label: "سیستم",
    items: [
      { label: "پشتیبان‌گیری", href: "/backups", icon: Archive, permission: PERMISSIONS.BACKUP_VIEW },
      { label: "مدیران", href: "/admins", icon: KeyRound, permission: PERMISSIONS.ADMIN_VIEW },
      { label: "امنیت", href: "/security", icon: Shield, permission: PERMISSIONS.SECURITY_VIEW },
      { label: "تنظیمات", href: "/settings", icon: Settings, permission: PERMISSIONS.SETTINGS_VIEW },
    ],
  },
];

export const pageTitles: Record<string, string> = {
  "/dashboard": "داشبورد",
  "/users": "کاربران",
  "/subpanels": "زیرپنل‌ها",
  "/configs": "کانفیگ‌ها",
  "/subscriptions": "اشتراک‌ها",
  "/servers": "سرورها",
  "/xray": "Xray Core",
  "/inbounds": "ورودی‌های Xray",
  "/protocols": "پروتکل‌ها",
  "/traffic": "ترافیک",
  "/monitor": "مانیتور سیستم",
  "/logs": "مرکز لاگ‌ها",
  "/backups": "پشتیبان‌گیری",
  "/admins": "مدیران",
  "/security": "مرکز امنیت",
  "/settings": "تنظیمات",
  "/notifications": "اعلان‌ها",
};

export const notificationItem: NavigationItem = {
  label: "اعلان‌ها",
  href: "/notifications",
  icon: Bell,
  permission: PERMISSIONS.DASHBOARD_VIEW,
};

export const pagePermissions = Object.fromEntries(
  navigationGroups.flatMap((group) => group.items.map((item) => [item.href, item.permission])),
) as Record<string, Permission>;
pagePermissions[notificationItem.href] = notificationItem.permission;

"use client";

import type { SettingsNavigationSection } from "@nr/shared";
import {
  Activity, Bell, Bot, Boxes, CalendarClock, DatabaseBackup, Gauge, KeyRound, Mail, Network, RefreshCw, ServerCog,
  Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Users, Waypoints, Wifi, type LucideIcon,
} from "lucide-react";

export const settingsNavigation: Array<{ id: SettingsNavigationSection; label: string; icon: LucideIcon }> = [
  { id: "general", label: "عمومی", icon: SlidersHorizontal }, { id: "security", label: "امنیت", icon: ShieldCheck },
  { id: "network", label: "شبکه و پنل", icon: Network }, { id: "tls", label: "SSL / TLS", icon: KeyRound },
  { id: "xray", label: "Xray", icon: Activity }, { id: "subscription", label: "Subscription", icon: Wifi },
  { id: "subscriptionFormats", label: "فرمت‌های Subscription", icon: Waypoints }, { id: "telegram", label: "Telegram", icon: Bot },
  { id: "email", label: "Email", icon: Mail }, { id: "notifications", label: "اعلان‌ها", icon: Bell },
  { id: "users", label: "کاربران", icon: Users }, { id: "subpanels", label: "زیرپنل‌ها", icon: Boxes },
  { id: "agents", label: "Agent و سرورها", icon: ServerCog }, { id: "traffic", label: "ترافیک", icon: Gauge },
  { id: "backup", label: "بکاپ", icon: DatabaseBackup }, { id: "api", label: "API", icon: Sparkles },
  { id: "datetime", label: "تاریخ و زمان", icon: CalendarClock }, { id: "updates", label: "بروزرسانی", icon: RefreshCw },
  { id: "advanced", label: "پیشرفته", icon: Settings2 },
];

export function SettingsNavigation({ active, advancedAllowed, onChange }: { active: SettingsNavigationSection; advancedAllowed: boolean; onChange: (section: SettingsNavigationSection) => void }) {
  const visible = settingsNavigation.filter((item) => item.id !== "advanced" || advancedAllowed);
  return (
    <>
      <nav className="settings-navigation" aria-label="بخش‌های تنظیمات">
        {visible.map((item) => <button key={item.id} type="button" className={active === item.id ? "is-active" : ""} onClick={() => onChange(item.id)}><item.icon size={16} /><span>{item.label}</span></button>)}
      </nav>
      <label className="settings-mobile-selector">بخش تنظیمات<select value={active} onChange={(event) => onChange(event.target.value as SettingsNavigationSection)}>{visible.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
    </>
  );
}

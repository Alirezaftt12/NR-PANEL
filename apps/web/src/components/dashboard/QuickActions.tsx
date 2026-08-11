import { Archive, Bell, FileText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { Card } from "../ui/Card";

const actions = [
  { label: "گزارش‌ها", detail: "رویدادهای سیستم", href: "/logs", icon: FileText },
  { label: "پشتیبان‌گیری", detail: "تاریخچه و ایجاد", href: "/backups", icon: Archive },
  { label: "اعلان‌ها", detail: "هشدارهای مدیریتی", href: "/notifications", icon: Bell },
  { label: "امنیت", detail: "نشست‌ها و رخدادها", href: "/security", icon: ShieldCheck },
];

export function QuickActions() {
  return (
    <Card className="quick-actions-card">
      <div className="compact-card-title">
        <div><p className="section-kicker">QUICK ACCESS</p><h2>مدیریت سریع</h2></div>
      </div>
      <div className="quick-actions-grid">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <Link className="quick-action" href={action.href} key={action.href}>
              <span><Icon size={18} /></span>
              <div><strong>{action.label}</strong><small>{action.detail}</small></div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

import { AlertCircle, Database } from "lucide-react";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

export function MasterModulePlaceholder({ title, description }: { title: string; description: string }) {
  return <div className="section-page"><header className="section-page-heading"><div><p className="section-kicker">MASTER PANEL MODULE</p><h2>{title}</h2><p>{description}</p></div></header><Card className="section-readiness"><span className="card-icon card-icon-red"><AlertCircle size={19} /></span><div><h3>فضای پنل مادر</h3><p>این مسیر برای حساب OWNER/ADMIN مستقل از پرتال زیرپنل باقی مانده است.</p></div><StatusBadge tone="disconnected">NO LIVE DATA</StatusBadge></Card><Card className="empty-state"><span className="empty-state-icon"><Database size={22} /></span><h3>داده‌ای برای نمایش وجود ندارد</h3><p>هیچ رکورد ساختگی به‌عنوان داده عملیاتی نمایش داده نمی‌شود.</p></Card></div>;
}

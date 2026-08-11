import { AlertTriangle, Fingerprint, LogIn, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

type SecurityData = {
  sessions: Array<{ id: string; username: string; ip: string | null; userAgent: string | null; lastActivityAt: string; expiresAt: string }>;
  failedAttempts: Array<{ id: string; ip: string | null; reason: string | null; attemptedAt: string }>;
  events: Array<{ id: string; timestamp: string; action: string; actorId: string | null; tenantId: string | null; ip: string | null; message: string }>;
};

export function SecurityCenter({ data }: { data: SecurityData }) {
  return (
    <div className="management-page">
      <header className="section-page-heading"><div><p className="section-kicker">SECURITY FOUNDATION</p><h2>مرکز امنیت</h2><p>نشست‌ها و رویدادهای واقعی احراز هویت؛ بدون داده نمایشی.</p></div><StatusBadge tone="healthy"><ShieldCheck size={13} /> DATABASE BACKED</StatusBadge></header>
      <section className="security-summary-grid">
        <Card><MonitorSmartphone size={18} /><span>نشست فعال</span><strong>{data.sessions.length}</strong></Card>
        <Card><AlertTriangle size={18} /><span>ورود ناموفق اخیر</span><strong>{data.failedAttempts.length}</strong></Card>
        <Card><Fingerprint size={18} /><span>رویداد امنیتی</span><strong>{data.events.length}</strong></Card>
      </section>
      <Card as="section" className="security-list"><h3><MonitorSmartphone size={17} />نشست‌های فعال</h3>{data.sessions.length ? data.sessions.map((session) => <div className="security-row" key={session.id}><span><strong>{session.username}</strong><small dir="ltr">{session.ip || "IP unavailable"}</small></span><span><strong>{new Date(session.lastActivityAt).toLocaleString("fa-IR")}</strong><small>{session.userAgent || "User agent unavailable"}</small></span></div>) : <EmptySecurityState />}</Card>
      <div className="security-columns">
        <Card as="section" className="security-list"><h3><AlertTriangle size={17} />تلاش‌های ناموفق</h3>{data.failedAttempts.length ? data.failedAttempts.map((attempt) => <div className="security-row" key={attempt.id}><span><strong dir="ltr">{attempt.ip || "IP unavailable"}</strong><small>{attempt.reason || "AUTH_FAILED"}</small></span><time>{new Date(attempt.attemptedAt).toLocaleString("fa-IR")}</time></div>) : <EmptySecurityState />}</Card>
        <Card as="section" className="security-list"><h3><LogIn size={17} />رویدادهای ورود و مجوز</h3>{data.events.length ? data.events.map((event) => <div className="security-row" key={event.id}><span><strong dir="ltr">{event.action}</strong><small>{event.message}</small></span><time>{new Date(event.timestamp).toLocaleString("fa-IR")}</time></div>) : <EmptySecurityState />}</Card>
      </div>
    </div>
  );
}

function EmptySecurityState() {
  return <div className="compact-empty">رویدادی برای نمایش وجود ندارد.</div>;
}

"use client";

import { KeyRound, Laptop, Languages, MonitorCog, ShieldCheck, Trash2, UserRound } from "lucide-react";
import type { SubpanelSettingsData } from "@nr/shared";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { setTheme } from "../../lib/theme-store";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";

export type AccountSession = { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastActivityAt: string; expiresAt: string; current: boolean };

export function SubPanelSettings({ settings, sessions, error }: { settings: SubpanelSettingsData; sessions: AccountSession[]; error?: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState(error ?? "");
  const [revoke, setRevoke] = useState<AccountSession | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveAccount(formData: FormData) {
    setBusy(true); setMessage("");
    try {
      const theme = String(formData.get("theme")) as "light" | "dark";
      await apiRequest("/subpanel/settings", { method: "PATCH", body: JSON.stringify({ displayName: formData.get("displayName"), email: formData.get("email") || null, theme, language: formData.get("language") }) });
      setTheme(theme); setMessage("تنظیمات حساب ذخیره شد."); router.refresh();
    } catch (caught) { setMessage(caught instanceof ClientApiError ? caught.message : "ذخیره تنظیمات انجام نشد."); }
    finally { setBusy(false); }
  }

  async function changePassword(formData: FormData) {
    setBusy(true); setMessage("");
    try {
      if (formData.get("newPassword") !== formData.get("confirmPassword")) { setMessage("تکرار گذرواژه مطابقت ندارد."); return; }
      await apiRequest("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: formData.get("currentPassword"), newPassword: formData.get("newPassword") }) });
      setMessage("گذرواژه تغییر کرد و نشست‌های دیگر باطل شدند."); router.refresh();
    } catch (caught) { setMessage(caught instanceof ClientApiError ? caught.message : "تغییر گذرواژه انجام نشد."); }
    finally { setBusy(false); }
  }

  async function revokeSession() {
    if (!revoke) return;
    try { await apiRequest(`/auth/sessions/${revoke.id}`, { method: "DELETE" }); setRevoke(null); router.refresh(); }
    catch (caught) { setMessage(caught instanceof ClientApiError ? caught.message : "ابطال نشست انجام نشد."); }
  }

  return <div className="subpanel-page-stack">
    <header className="subpanel-page-heading"><div><p>ACCOUNT ONLY</p><h2>تنظیمات زیرپنل</h2><span>حساب، امنیت، نشست‌ها و ظاهر؛ بدون تنظیمات زیرساخت.</span></div></header>
    {message ? <Card className={`subpanel-notice ${error ? "danger" : ""}`}><p>{message}</p><button type="button" onClick={() => setMessage("")}>×</button></Card> : null}
    <div className="subpanel-settings-grid">
      <Card className="subpanel-settings-card"><header><UserRound size={19} /><div><h3>حساب و ظاهر</h3><p>{settings.panelName}</p></div></header><form action={saveAccount}>
        <label>نام کاربری<input value={settings.username} disabled dir="ltr" /></label><label>نام نمایشی<input name="displayName" defaultValue={settings.displayName} required /></label><label>ایمیل<input name="email" type="email" defaultValue={settings.email ?? ""} dir="ltr" /></label>
        <div className="settings-inline"><label><MonitorCog size={15} /> پوسته<select name="theme" defaultValue={settings.theme}><option value="light">روشن</option><option value="dark">تیره</option></select></label><label><Languages size={15} /> زبان<select name="language" defaultValue={settings.language}><option value="fa">فارسی</option><option value="en">English</option></select></label></div>
        <Button variant="primary" type="submit" disabled={busy}>ذخیره تنظیمات</Button>
      </form></Card>
      <Card className="subpanel-settings-card"><header><KeyRound size={19} /><div><h3>تغییر گذرواژه</h3><p>نشست‌های دیگر پس از تغییر باطل می‌شوند.</p></div></header><form action={changePassword}>
        <label>گذرواژه فعلی<input name="currentPassword" type="password" autoComplete="current-password" required /></label><label>گذرواژه جدید<input name="newPassword" type="password" autoComplete="new-password" required minLength={12} /></label><label>تکرار گذرواژه<input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} /></label><Button variant="primary" type="submit" disabled={busy}>تغییر امن گذرواژه</Button>
      </form></Card>
    </div>
    <Card className="subpanel-sessions"><header><Laptop size={19} /><div><h3>نشست‌های فعال</h3><p>نشست‌های ناشناس را فوراً باطل کنید.</p></div></header>{sessions.length ? <div>{sessions.map((session) => <article key={session.id}><span><Laptop size={17} /></span><p><strong>{session.current ? "این دستگاه" : session.userAgent || "دستگاه ناشناس"}</strong><small dir="ltr">{session.ip || "IP unavailable"} · {new Date(session.lastActivityAt).toLocaleString("fa-IR")}</small></p>{session.current ? <em>جاری</em> : <Button compact variant="danger" onClick={() => setRevoke(session)}><Trash2 size={14} /> ابطال</Button>}</article>)}</div> : <p className="empty-line">نشست فعالی گزارش نشده است.</p>}</Card>
    <Card className="subpanel-security-note"><ShieldCheck size={20} /><div><strong>مرز دسترسی</strong><p>این صفحه هیچ تنظیم سرور، Xray، ورودی، مسیریابی یا عامل اجرایی را در اختیار زیرپنل قرار نمی‌دهد.</p></div></Card>
    <ConfirmDialog open={Boolean(revoke)} title="ابطال نشست" description="این دستگاه بلافاصله از حساب خارج می‌شود." confirmLabel="ابطال نشست" onClose={() => setRevoke(null)} onConfirm={() => void revokeSession()} />
  </div>;
}

"use client";

import type { InboundSummary, UserDefaultSettings } from "@nr/shared";
import { KeyRound, UserPlus, X } from "lucide-react";
import type { FormEvent } from "react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

export type InboundClientPayload = Record<string, unknown>;

function localExpiration(days: number | null | undefined) {
  if (!days) return "";
  const date = new Date(Date.now() + days * 86_400_000); const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function InboundClientDrawer({ inbound, defaults, busy, onClose, onSubmit }: { inbound: InboundSummary | null; defaults?: UserDefaultSettings; busy: boolean; onClose: () => void; onSubmit: (payload: InboundClientPayload) => Promise<void> }) {
  if (!inbound) return null;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); const expiresAt = String(data.get("expiresAt") || "");
    await onSubmit({ name: data.get("name"), email: String(data.get("email") || "") || null, credential: String(data.get("credential") || "") || undefined, enabled: data.get("enabled") === "on", trafficLimit: String(data.get("trafficLimit") || "") || null, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null, subscriptionEnabled: data.get("subscriptionEnabled") === "on", flow: data.get("flow") || null });
  }
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="inbound-drawer client-drawer" role="dialog" aria-modal="true" aria-labelledby="client-drawer-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header"><div><span className="drawer-icon positive"><UserPlus size={18} /></span><div><h2 id="client-drawer-title">کاربر جدید</h2><p>زیرمجموعه ورودی «{inbound.name}» · {inbound.protocol}</p></div></div><IconButton label="بستن فرم کاربر" onClick={onClose}><X size={18} /></IconButton></header>
        <form className="inbound-drawer-form" onSubmit={submit}><section className="drawer-section"><h3><KeyRound size={16} />هویت و اعتبارنامه</h3><div className="drawer-form-grid client-form-grid">
          <label>نام / عنوان<input name="name" required minLength={2} autoFocus /></label><label>ایمیل<input name="email" type="email" dir="ltr" /></label>
          <label>UUID / Password<input name="credential" dir="ltr" minLength={8} placeholder="برای تولید امن خالی بگذارید" /><small>در پاسخ API نمایش داده نمی‌شود و در پایگاه داده رمز می‌شود.</small></label>
          <label className="toggle-field"><span>فعال</span><input name="enabled" type="checkbox" defaultChecked={defaults?.enabled ?? true} /></label><label>سقف ترافیک (Byte)<input name="trafficLimit" type="number" min={0} dir="ltr" defaultValue={defaults?.trafficLimitBytes ?? ""} /></label><label>انقضا<input name="expiresAt" type="datetime-local" dir="ltr" defaultValue={localExpiration(defaults?.durationDays)} /></label>
          <label className="toggle-field"><span>سابسکریپشن</span><input name="subscriptionEnabled" type="checkbox" defaultChecked={defaults?.subscriptionEnabled ?? false} /></label>
          {inbound.protocol === "VLESS" ? <label>Flow<select name="flow"><option value="">بدون Flow</option><option value="xtls-rprx-vision">xtls-rprx-vision</option></select></label> : null}
        </div></section><div className="client-context-note"><strong>وابستگی قطعی</strong><p>این کاربر مستقیماً به Inbound ID <code>{inbound.id.slice(0, 8)}</code> متصل می‌شود و خارج از زمینه ورودی ساخته نخواهد شد.</p></div>
          <footer className="drawer-footer"><Button onClick={onClose}>انصراف</Button><Button variant="success" type="submit" disabled={busy}>{busy ? "در حال ساخت…" : "ایجاد کاربر زیر ورودی"}</Button></footer>
        </form>
      </aside>
    </div>
  );
}

"use client";

import { permissionValues, type ApiTokenCreated, type ApiTokenSummary, type Permission } from "@nr/shared";
import { Check, Copy, KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { StatusBadge } from "../ui/StatusBadge";

type Confirmation = { title: string; description: string; action: () => Promise<void> };
const permissionLabels: Partial<Record<Permission, string>> = {
  SETTINGS_VIEW: "مشاهده تنظیمات", SETTINGS_GENERAL_UPDATE: "تغییر عمومی", SETTINGS_SECURITY_UPDATE: "تغییر امنیت",
  SETTINGS_NETWORK_UPDATE: "تغییر شبکه", SETTINGS_XRAY_UPDATE: "تغییر Xray", SETTINGS_SUBSCRIPTION_UPDATE: "تغییر Subscription",
  SETTINGS_INTEGRATIONS_UPDATE: "تغییر Integration", SETTINGS_BACKUP_UPDATE: "مدیریت بکاپ", SETTINGS_UPDATE_MANAGE: "مدیریت بروزرسانی",
  SERVER_VIEW: "مشاهده سرور", XRAY_VIEW: "مشاهده Xray", USER_VIEW: "مشاهده کاربر", TRAFFIC_VIEW: "مشاهده ترافیک",
};

export function ApiTokenSettings({ initialTokens, canManage }: { initialTokens: ApiTokenSummary[]; canManage: boolean }) {
  const [tokens, setTokens] = useState(initialTokens); const [createdSecret, setCreatedSecret] = useState<string | null>(null); const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const availablePermissions = permissionValues.filter((permission) => permissionLabels[permission]);
  async function reload() { setTokens(await apiRequest<ApiTokenSummary[]>("/settings/api-tokens")); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const form = event.currentTarget; const data = new FormData(form);
    try {
      const expires = String(data.get("expiresAt") || "");
      const result = await apiRequest<ApiTokenCreated>("/settings/api-tokens", { method: "POST", body: JSON.stringify({
        name: data.get("name"), permissions: data.getAll("permissions"), expiresAt: expires ? new Date(expires).toISOString() : null,
        cidrAllowlist: String(data.get("cidrs") || "").split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
      }) });
      setCreatedSecret(result.secret); form.reset(); await reload();
    } catch (error) { setMessage(error instanceof ClientApiError ? error.message : "ساخت توکن انجام نشد."); }
    finally { setBusy(false); }
  }
  async function state(token: ApiTokenSummary) { setBusy(true); try { await apiRequest(`/settings/api-tokens/${token.id}/state`, { method: "POST", body: JSON.stringify({ enabled: !token.enabled, confirmation: "CONFIRM" }) }); await reload(); } catch (error) { setMessage(error instanceof ClientApiError ? error.message : "عملیات انجام نشد."); } finally { setBusy(false); } }
  function revoke(token: ApiTokenSummary) { setConfirmation({ title: `لغو توکن ${token.name}`, description: "این توکن بلافاصله و به‌صورت برگشت‌ناپذیر نامعتبر می‌شود.", action: async () => { setBusy(true); try { await apiRequest(`/settings/api-tokens/${token.id}`, { method: "DELETE", body: JSON.stringify({ confirmation: "CONFIRM" }) }); await reload(); } catch (error) { setMessage(error instanceof ClientApiError ? error.message : "لغو توکن انجام نشد."); } finally { setBusy(false); } } }); }
  async function runConfirmed() { const action = confirmation?.action; setConfirmation(null); if (action) await action(); }
  return <div className="settings-section-stack"><header className="settings-section-header"><p>SCOPED ACCESS</p><h2>API</h2><span>توکن‌های hash‌شده با مجوز، انقضا و محدودیت CIDR. Secret فقط یک‌بار نمایش داده می‌شود.</span></header>
    {createdSecret ? <div className="api-token-secret"><ShieldCheck size={20} /><div><strong>توکن را همین حالا ذخیره کنید</strong><code dir="ltr">{createdSecret}</code><p>پس از بستن این پیام، بازیابی متن توکن ممکن نیست.</p></div><Button onClick={() => { void navigator.clipboard.writeText(createdSecret); setCopied(true); }}><Copy size={14} />{copied ? "کپی شد" : "کپی"}</Button><button type="button" onClick={() => setCreatedSecret(null)}>بستن</button></div> : null}
    {message ? <div className="settings-warning is-critical"><p>{message}</p></div> : null}
    {canManage ? <Card as="section" className="api-token-create"><header><KeyRound size={18} /><div><h3>ایجاد توکن</h3><p>حداقل مجوز لازم را انتخاب کنید.</p></div></header><form onSubmit={submit}><label>نام<input name="name" required minLength={2} /></label><label>انقضا<input name="expiresAt" type="datetime-local" /></label><label className="is-wide">CIDRهای مجاز<textarea name="cidrs" placeholder="203.0.113.10/32" /></label><fieldset className="is-wide"><legend>مجوزها</legend><div className="api-permission-grid">{availablePermissions.map((permission) => <label key={permission}><input type="checkbox" name="permissions" value={permission} defaultChecked={permission === "SETTINGS_VIEW"} /><span>{permissionLabels[permission]}</span><code>{permission}</code></label>)}</div></fieldset><Button variant="primary" type="submit" disabled={busy}><Plus size={15} />ساخت توکن</Button></form></Card> : <div className="settings-notice"><p>حساب شما مجوز مدیریت توکن را ندارد.</p></div>}
    <Card as="section" className="api-token-list"><header><h3>توکن‌های API</h3><span>{tokens.length.toLocaleString("fa-IR")} مورد</span></header>{tokens.length ? <div className="settings-table-scroll"><table><thead><tr><th>نام</th><th>Prefix</th><th>مجوزها</th><th>انقضا</th><th>آخرین استفاده</th><th>وضعیت</th><th /></tr></thead><tbody>{tokens.map((token) => <tr key={token.id}><td><strong>{token.name}</strong><small>{new Date(token.createdAt).toLocaleString("fa-IR")}</small></td><td><code dir="ltr">{token.prefix}…</code></td><td>{token.permissions.length.toLocaleString("fa-IR")}</td><td>{token.expiresAt ? new Date(token.expiresAt).toLocaleString("fa-IR") : "بدون انقضا"}</td><td>{token.lastUsedAt ? new Date(token.lastUsedAt).toLocaleString("fa-IR") : "هرگز"}</td><td><StatusBadge tone={token.revokedAt ? "danger" : token.enabled ? "healthy" : "warning"}>{token.revokedAt ? "REVOKED" : token.enabled ? "ACTIVE" : "DISABLED"}</StatusBadge></td><td><div className="api-token-actions">{!token.revokedAt && canManage ? <><Button compact onClick={() => void state(token)} disabled={busy}>{token.enabled ? "غیرفعال" : "فعال"}</Button><Button compact variant="danger" onClick={() => revoke(token)} disabled={busy}><Trash2 size={13} />لغو</Button></> : <Check size={14} />}</div></td></tr>)}</tbody></table></div> : <p className="settings-empty">توکن API ساخته نشده است.</p>}</Card>
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.title || ""} description={confirmation?.description || ""} confirmLabel="لغو قطعی" onClose={() => setConfirmation(null)} onConfirm={() => void runConfirmed()} />
  </div>;
}

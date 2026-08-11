"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarClock, Edit3, Network, Plus, Server, ShieldCheck, Users, X } from "lucide-react";
import { INBOUND_PROTOCOLS, type MasterSubpanelOptions, type MasterSubpanelSummary } from "@nr/shared";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { IconButton } from "../ui/IconButton";
import { StatusBadge } from "../ui/StatusBadge";
import { formatBytes, formatDate } from "./format";

export function MasterSubpanels({ initialData, options, error }: { initialData: MasterSubpanelSummary[]; options: MasterSubpanelOptions; error?: string | null }) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<MasterSubpanelSummary | "new" | null>(null);
  const [message, setMessage] = useState(error ?? "");
  const [confirm, setConfirm] = useState<MasterSubpanelSummary | null>(null);

  async function disable() {
    if (!confirm) return;
    try { await apiRequest(`/subpanels/${confirm.tenantId}`, { method: "PATCH", body: JSON.stringify({ status: confirm.status === "ACTIVE" ? "DISABLED" : "ACTIVE" }) }); setConfirm(null); router.refresh(); }
    catch (caught) { setMessage(caught instanceof ClientApiError ? caught.message : "تغییر وضعیت زیرپنل انجام نشد."); }
  }

  return <div className="subpanel-page-stack master-subpanels">
    <header className="subpanel-page-heading"><div><p>OWNER ASSIGNMENT CONTROL</p><h2>زیرپنل‌ها</h2><span>سهمیه‌ها، سرورها و ورودی‌های مجاز را از پنل مادر تعیین کنید.</span></div><Button variant="primary" onClick={() => setDrawer("new")}><Plus size={16} /> زیرپنل جدید</Button></header>
    {message ? <Card className={`subpanel-notice ${error ? "danger" : ""}`}><p>{message}</p><button type="button" onClick={() => setMessage("")}>×</button></Card> : null}
    <section className="master-subpanel-summary"><Card><Network size={19} /><p><small>کل زیرپنل‌ها</small><strong>{initialData.length.toLocaleString("fa-IR")}</strong></p></Card><Card><ShieldCheck size={19} /><p><small>فعال</small><strong>{initialData.filter((item) => item.status === "ACTIVE").length.toLocaleString("fa-IR")}</strong></p></Card><Card><Users size={19} /><p><small>کاربران ساخته‌شده</small><strong>{initialData.reduce((sum, item) => sum + item.createdUsers, 0).toLocaleString("fa-IR")}</strong></p></Card></section>
    <Card className="master-subpanels-table"><div className="subpanel-table-scroll"><table><thead><tr><th>پنل</th><th>ورود</th><th>وضعیت</th><th>کاربران</th><th>اعتبار / تخصیص</th><th>انقضا</th><th>سرور / ورودی</th><th>عملیات</th></tr></thead><tbody>{initialData.map((item) => <tr key={item.tenantId}>
      <td><strong>{item.panelName}</strong><small dir="ltr">{item.tenantId.slice(0, 8)}</small></td><td dir="ltr">{item.username}</td><td><StatusBadge tone={item.status === "ACTIVE" ? "healthy" : "danger"}>{item.status}</StatusBadge></td><td>{item.createdUsers.toLocaleString("fa-IR")} / {item.userLimit === null ? "∞" : item.userLimit.toLocaleString("fa-IR")}</td><td><strong>{formatBytes(item.allocatedTraffic)}</strong><small>از {formatBytes(item.trafficCredit)}</small></td><td>{formatDate(item.expiresAt)}</td><td>{item.allowedServerIds.length.toLocaleString("fa-IR")} سرور · {item.assignedInboundIds.length.toLocaleString("fa-IR")} ورودی</td><td><div className="subscription-actions"><Button compact onClick={() => setDrawer(item)}><Edit3 size={14} /> ویرایش</Button><Button compact variant={item.status === "ACTIVE" ? "danger" : "success"} onClick={() => setConfirm(item)}>{item.status === "ACTIVE" ? "غیرفعال" : "فعال"}</Button></div></td>
    </tr>)}</tbody></table></div>{!initialData.length ? <div className="subpanel-empty"><Network size={24} /><h3>زیرپنلی ساخته نشده است</h3><p>اولین حساب نماینده را با سهمیه و ورودی‌های مشخص بسازید.</p></div> : null}</Card>
    <MasterSubpanelDrawer key={drawer === "new" ? "new" : drawer?.tenantId ?? "closed"} item={drawer === "new" ? null : drawer} open={drawer !== null} options={options} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); router.refresh(); }} onError={setMessage} />
    <ConfirmDialog open={Boolean(confirm)} title={confirm?.status === "ACTIVE" ? "غیرفعال‌سازی زیرپنل" : "فعال‌سازی زیرپنل"} description={confirm?.status === "ACTIVE" ? "همه نشست‌های این زیرپنل باطل می‌شوند و کاربر دیگر وارد نخواهد شد." : "دسترسی زیرپنل دوباره برقرار می‌شود."} confirmLabel={confirm?.status === "ACTIVE" ? "غیرفعال‌سازی" : "فعال‌سازی"} onClose={() => setConfirm(null)} onConfirm={() => void disable()} />
  </div>;
}

function MasterSubpanelDrawer({ item, open, options, onClose, onSaved, onError }: { item: MasterSubpanelSummary | null; open: boolean; options: MasterSubpanelOptions; onClose: () => void; onSaved: () => void; onError: (value: string) => void }) {
  const [servers, setServers] = useState<string[]>(item?.allowedServerIds ?? []);
  const [inbounds, setInbounds] = useState<string[]>(item?.assignedInboundIds ?? []);
  const [busy, setBusy] = useState(false);
  const [defaultExpiration] = useState(() => !item && options.defaults?.expirationDays ? new Date(Date.now() + options.defaults.expirationDays * 86_400_000).toISOString().slice(0, 10) : "");
  if (!open) return null;
  const editing = Boolean(item);
  const defaults = options.defaults;

  function toggleServer(id: string, enabled: boolean) {
    setServers((current) => enabled ? [...new Set([...current, id])] : current.filter((value) => value !== id));
    if (!enabled) setInbounds((current) => current.filter((inboundId) => options.inbounds.find((inbound) => inbound.id === inboundId)?.serverId !== id));
  }

  async function submit(formData: FormData) {
    setBusy(true); onError("");
    try {
      const trafficGb = Number(formData.get("trafficGb") || 0);
      const password = String(formData.get("password") || "");
      const payload = {
        panelName: formData.get("panelName"), displayName: formData.get("displayName"), expiresAt: formData.get("expiresAt") ? new Date(String(formData.get("expiresAt"))).toISOString() : null,
        trafficCredit: trafficGb > 0 ? String(BigInt(Math.round(trafficGb * 1024 ** 3))) : null, userLimit: formData.get("userLimit") === "" ? null : Number(formData.get("userLimit")),
        allowedServerIds: servers, assignedInboundIds: inbounds, allowedProtocols: INBOUND_PROTOCOLS.filter((protocol) => formData.get(`protocol-${protocol}`) === "on"),
        capabilities: { subscription: formData.get("cap-subscription") === "on", trafficReset: formData.get("cap-reset") === "on", extend: formData.get("cap-extend") === "on", credentialRotation: formData.get("cap-rotate") === "on" },
        ...(editing ? { ...(password ? { password } : {}) } : { slug: formData.get("slug"), username: formData.get("username"), email: formData.get("email") || null, password }),
      };
      await apiRequest(editing ? `/subpanels/${item!.tenantId}` : "/subpanels", { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) }); onSaved();
    } catch (caught) { onError(caught instanceof ClientApiError ? caught.message : "ذخیره زیرپنل انجام نشد."); }
    finally { setBusy(false); }
  }

  return <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}><aside className="master-subpanel-drawer" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}><header><div><span><Network size={19} /></span><p><strong>{editing ? `ویرایش ${item?.panelName}` : "ساخت زیرپنل"}</strong><small>تنظیم حساب، سهمیه و تخصیص</small></p></div><IconButton label="بستن" onClick={onClose}><X size={18} /></IconButton></header><form action={submit}>
    <section><h3>حساب و محدودیت‌ها</h3><div className="subpanel-form-grid"><label>نام پنل<input name="panelName" defaultValue={item?.panelName ?? ""} required /></label><label>نام نمایشی<input name="displayName" defaultValue={item?.panelName ?? ""} required /></label>{!editing ? <><label>Slug<input name="slug" dir="ltr" required /></label><label>نام کاربری<input name="username" dir="ltr" required /></label><label>ایمیل<input name="email" type="email" dir="ltr" /></label></> : null}<label>{editing ? "گذرواژه جدید (اختیاری)" : "گذرواژه"}<input name="password" type="password" dir="ltr" required={!editing} minLength={editing ? undefined : 12} /></label><label>سقف کاربران<input name="userLimit" type="number" min="0" defaultValue={item?.userLimit ?? defaults?.userLimit ?? ""} /></label><label>اعتبار ترافیک (GB)<input name="trafficGb" type="number" min="0" step="0.1" defaultValue={item?.trafficCredit ? (Number(item.trafficCredit) / 1024 ** 3).toFixed(1) : defaults?.trafficCreditBytes ? (Number(defaults.trafficCreditBytes) / 1024 ** 3).toFixed(1) : ""} /></label><label>انقضا<input name="expiresAt" type="date" defaultValue={item?.expiresAt?.slice(0, 10) ?? defaultExpiration} /></label></div></section>
    <section><h3><Server size={16} /> سرورهای مجاز</h3><div className="master-assignment-grid">{options.servers.map((server) => <label key={server.id}><input type="checkbox" checked={servers.includes(server.id)} onChange={(event) => toggleServer(server.id, event.target.checked)} /> {server.name}</label>)}</div></section>
    <section><h3><Network size={16} /> ورودی‌های تخصیص‌یافته</h3><div className="master-assignment-grid">{options.inbounds.map((inbound) => <label key={inbound.id} className={!servers.includes(inbound.serverId) ? "is-disabled" : ""}><input type="checkbox" checked={inbounds.includes(inbound.id)} disabled={!servers.includes(inbound.serverId)} onChange={(event) => setInbounds((current) => event.target.checked ? [...new Set([...current, inbound.id])] : current.filter((id) => id !== inbound.id))} /> {inbound.serverName} · {inbound.name} · {inbound.protocol}</label>)}</div></section>
    <section><h3>پروتکل‌ها و قابلیت‌ها</h3><div className="master-assignment-grid">{INBOUND_PROTOCOLS.map((protocol) => <label key={protocol}><input name={`protocol-${protocol}`} type="checkbox" defaultChecked={item?.allowedProtocols.includes(protocol) ?? true} /> {protocol}</label>)}</div><div className="master-assignment-grid capabilities"><label><input name="cap-subscription" type="checkbox" defaultChecked={item?.capabilities.subscription ?? defaults?.subscriptionPermission ?? true} /> اشتراک</label><label><input name="cap-reset" type="checkbox" defaultChecked={item?.capabilities.trafficReset ?? defaults?.trafficResetPermission ?? true} /> ریست ترافیک</label><label><input name="cap-extend" type="checkbox" defaultChecked={item?.capabilities.extend ?? defaults?.userExtendPermission ?? true} /> تمدید</label><label><input name="cap-rotate" type="checkbox" defaultChecked={item?.capabilities.credentialRotation ?? defaults?.credentialRotationPermission ?? true} /> چرخش اعتبار</label></div></section>
    <footer><Button onClick={onClose}>انصراف</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره زیرپنل"}</Button></footer>
  </form></aside></div>;
}

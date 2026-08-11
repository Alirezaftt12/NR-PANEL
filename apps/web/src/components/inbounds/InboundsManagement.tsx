"use client";

import { hasPermission, PERMISSIONS, ROLES, type InboundClientSummary, type InboundDetail, type InboundsPageData, type InboundSummary } from "@nr/shared";
import { AlertTriangle, RadioTower } from "lucide-react";
import { useState } from "react";
import { apiRequest, ClientApiError, downloadApiFile } from "../../lib/api-client";
import { useAuth } from "../auth/AuthProvider";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { StatusBadge } from "../ui/StatusBadge";
import { InboundClientDrawer, type InboundClientPayload } from "./InboundClientDrawer";
import { InboundFormDrawer, type InboundFormPayload } from "./InboundFormDrawer";
import { InboundSummaryCards } from "./InboundSummary";
import { InboundTable, type InboundRowAction } from "./InboundTable";
import { InboundToolbar, type GlobalInboundAction } from "./InboundToolbar";
import type { ClientRowAction } from "./InboundUsersList";

type ApplyResponse = { inboundId: string; desiredRevision: number; apply: { state: "APPLIED" | "FAILED" | "ROLLED_BACK"; strategy: string; reason: string; errorCode?: string; errorMessage?: string } };
type Confirmation = { title: string; description: string; confirmLabel: string; action: () => Promise<void> };

export function InboundsManagement({ initialData, initialError }: { initialData: InboundsPageData; initialError: string | null }) {
  const auth = useAuth();
  const [data, setData] = useState(initialData);
  const [message, setMessage] = useState(initialError || "");
  const [messageTone, setMessageTone] = useState<"info" | "danger">(initialError ? "danger" : "info");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InboundDetail | null>(null);
  const [clientInbound, setClientInbound] = useState<InboundSummary | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const advancedAllowed = auth.status === "authenticated" && (auth.user.role === ROLES.OWNER || (auth.user.role === ROLES.ADMIN && hasPermission(auth.user.role, auth.user.permissions, PERMISSIONS.XRAY_CONTROL)));

  async function reload() { setData(await apiRequest<InboundsPageData>("/inbounds")); }
  function showError(error: unknown) { setMessageTone("danger"); setMessage(error instanceof ClientApiError ? `${error.message}${error.requestId ? ` · Request ${error.requestId}` : ""}` : "عملیات انجام نشد."); }
  function showApply(result: ApplyResponse, successMessage: string) {
    if (result.apply.state === "APPLIED") { setMessageTone("info"); setMessage(`${successMessage} · ${result.apply.strategy}`); }
    else { setMessageTone("danger"); setMessage(`وضعیت مطلوب ذخیره شد، اما Xray اعمال نشد: ${result.apply.errorMessage || result.apply.reason}`); }
  }
  async function mutate(work: () => Promise<ApplyResponse>, successMessage: string, after?: () => void) {
    setBusy(true); setMessage("");
    try { const result = await work(); await reload(); showApply(result, successMessage); after?.(); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }
  function confirm(config: Confirmation) { setConfirmation(config); }
  async function runConfirmed() { const action = confirmation?.action; setConfirmation(null); if (action) await action(); }

  async function submitInbound(payload: InboundFormPayload) {
    if (editing) {
      const { serverId: _serverId, ...patch } = payload;
      await mutate(() => apiRequest<ApplyResponse>(`/inbounds/${editing.id}`, { method: "PATCH", body: JSON.stringify(patch) }), "ورودی به‌روزرسانی شد", () => { setFormOpen(false); setEditing(null); });
    } else await mutate(() => apiRequest<ApplyResponse>("/inbounds", { method: "POST", body: JSON.stringify(payload) }), "ورودی ساخته شد", () => setFormOpen(false));
  }

  async function submitClient(payload: InboundClientPayload) {
    if (!clientInbound) return;
    const id = clientInbound.id;
    await mutate(() => apiRequest<ApplyResponse>(`/inbounds/${id}/clients`, { method: "POST", body: JSON.stringify(payload) }), "کاربر زیر ورودی ساخته شد", () => setClientInbound(null));
  }

  async function openEditor(inbound: InboundSummary) {
    setBusy(true);
    try { setEditing(await apiRequest<InboundDetail>(`/inbounds/${inbound.id}`)); setFormOpen(true); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  async function unavailable(path: string) {
    setBusy(true);
    try { await apiRequest(path); setMessageTone("danger"); setMessage("سرویس پاسخ غیرمنتظره داد."); }
    catch (error) { showError(error); }
    finally { setBusy(false); }
  }

  function handleGlobal(action: GlobalInboundAction) {
    if (action === "ADD") { setEditing(null); setFormOpen(true); return; }
    if (action === "EXPORT_LINKS") { void unavailable("/inbounds/exports/links"); return; }
    if (action === "EXPORT_SUBSCRIPTIONS") { void unavailable("/inbounds/exports/subscriptions"); return; }
    if (action === "BACKUP") { setBusy(true); void downloadApiFile("/inbounds/export-backup", "nr-panel-inbounds.json").then(() => { setMessageTone("info"); setMessage("نسخه پشتیبان بدون اعتبارنامه‌های حساس دریافت شد."); }).catch(showError).finally(() => setBusy(false)); return; }
    const map = {
      RESET_INBOUNDS: { api: "RESET_ALL_INBOUND_TRAFFIC", title: "ریست ترافیک کل ورودی‌ها", description: "شمارنده ترافیک همه ورودی‌های قابل دسترس پس از هماهنگی با Xray صفر می‌شود." },
      RESET_USERS: { api: "RESET_ALL_USER_TRAFFIC", title: "ریست ترافیک کل کاربران", description: "شمارنده تمام کاربران زیر ورودی‌های قابل دسترس صفر می‌شود." },
      DELETE_EXPIRED: { api: "DELETE_EXPIRED_USERS", title: "حذف کاربران منقضی", description: "همه کاربران منقضی حذف و تغییر کاربران به‌صورت امن روی Xray اعمال می‌شود." },
      ENABLE_ALL: { api: "ENABLE_ALL", title: "فعال‌سازی همه ورودی‌ها", description: "تمام ورودی‌های قابل دسترس فعال می‌شوند." },
      DISABLE_ALL: { api: "DISABLE_ALL", title: "غیرفعال‌سازی همه ورودی‌ها", description: "تمام ورودی‌های قابل دسترس غیرفعال می‌شوند و اتصال‌های جدید پذیرفته نخواهد شد." },
    }[action];
    confirm({ title: map.title, description: map.description, confirmLabel: "تأیید عملیات کلی", action: async () => {
      setBusy(true); try { await apiRequest("/inbounds/actions", { method: "POST", body: JSON.stringify({ action: map.api, confirmation: "CONFIRM" }) }); await reload(); setMessageTone("info"); setMessage(`${map.title} انجام شد.`); } catch (error) { showError(error); } finally { setBusy(false); }
    } });
  }

  function handleInbound(action: InboundRowAction, inbound: InboundSummary) {
    if (action === "EDIT") { void openEditor(inbound); return; }
    if (action === "NEW_CLIENT") { setClientInbound(inbound); return; }
    if (action === "SUBSCRIPTION" || action === "EXPORT_SUBSCRIPTIONS") { void unavailable(`/inbounds/${inbound.id}/exports/subscriptions`); return; }
    if (action === "EXPORT_LINKS") { void unavailable(`/inbounds/${inbound.id}/exports/links`); return; }
    if (action === "EXPORT_INBOUND") { setBusy(true); void downloadApiFile(`/inbounds/${inbound.id}/export`, `${inbound.tag}.json`).then(() => { setMessageTone("info"); setMessage("ورودی بدون اعتبارنامه حساس استخراج شد."); }).catch(showError).finally(() => setBusy(false)); return; }
    if (action === "DUPLICATE") { void mutate(() => apiRequest<ApplyResponse>(`/inbounds/${inbound.id}/duplicate`, { method: "POST", body: "{}" }), "نسخه غیرفعال ورودی روی یک پورت آزاد ساخته شد"); return; }
    if (action === "TOGGLE") {
      const run = () => mutate(() => apiRequest<ApplyResponse>(`/inbounds/${inbound.id}/enabled`, { method: "POST", body: JSON.stringify({ enabled: !inbound.enabled, confirmation: "CONFIRM" }) }), inbound.enabled ? "ورودی غیرفعال شد" : "ورودی فعال شد");
      if (inbound.enabled) confirm({ title: `غیرفعال‌سازی ${inbound.name}`, description: "پذیرش اتصال جدید برای این ورودی متوقف می‌شود.", confirmLabel: "غیرفعال‌سازی", action: run }); else void run(); return;
    }
    const settings: Record<Exclude<InboundRowAction, "EDIT" | "NEW_CLIENT" | "SUBSCRIPTION" | "EXPORT_SUBSCRIPTIONS" | "EXPORT_LINKS" | "EXPORT_INBOUND" | "DUPLICATE" | "TOGGLE">, Confirmation> = {
      RESET_CLIENTS: { title: `ریست کاربران ${inbound.name}`, description: "ترافیک تمام کاربران زیر این ورودی صفر می‌شود.", confirmLabel: "ریست کاربران", action: async () => { setBusy(true); try { await apiRequest(`/inbounds/${inbound.id}/clients/traffic/reset`, { method: "POST", body: JSON.stringify({ confirmation: "CONFIRM" }) }); await reload(); setMessageTone("info"); setMessage("ترافیک کاربران ریست شد."); } catch (error) { showError(error); } finally { setBusy(false); } } },
      DELETE_EXPIRED: { title: `حذف منقضی‌های ${inbound.name}`, description: "کاربران منقضی این ورودی حذف و تغییر روی Xray اعمال می‌شود.", confirmLabel: "حذف منقضی‌ها", action: async () => { setBusy(true); try { await apiRequest(`/inbounds/${inbound.id}/clients/delete-expired`, { method: "POST", body: JSON.stringify({ confirmation: "CONFIRM" }) }); await reload(); setMessageTone("info"); setMessage("پاک‌سازی کاربران منقضی انجام شد."); } catch (error) { showError(error); } finally { setBusy(false); } } },
      RESET_INBOUND: { title: `ریست ترافیک ${inbound.name}`, description: "شمارنده ترافیک خود ورودی پس از ریست Xray صفر می‌شود.", confirmLabel: "ریست ترافیک", action: async () => { setBusy(true); try { await apiRequest(`/inbounds/${inbound.id}/traffic/reset`, { method: "POST", body: JSON.stringify({ confirmation: "CONFIRM" }) }); await reload(); setMessageTone("info"); setMessage("ترافیک ورودی ریست شد."); } catch (error) { showError(error); } finally { setBusy(false); } } },
      DELETE: { title: `حذف ${inbound.name}`, description: "ورودی ابتدا از Xray حذف و سلامت سرویس بررسی می‌شود؛ تنها پس از موفقیت رکورد پایگاه داده پاک خواهد شد.", confirmLabel: "حذف قطعی", action: async () => { setBusy(true); try { const result = await apiRequest<{ deleted: boolean; apply: ApplyResponse["apply"] }>(`/inbounds/${inbound.id}`, { method: "DELETE", body: JSON.stringify({ confirmation: "CONFIRM" }) }); await reload(); if (result.deleted) { setMessageTone("info"); setMessage("ورودی پس از حذف امن از Xray پاک شد."); } else { setMessageTone("danger"); setMessage(`حذف به تعویق افتاد: ${result.apply.errorMessage || result.apply.reason}`); } } catch (error) { showError(error); } finally { setBusy(false); } } },
    };
    confirm(settings[action]);
  }

  function handleClient(action: ClientRowAction, inbound: InboundSummary, client: InboundClientSummary) {
    if (action === "QR") { setMessageTone("danger"); setMessage("QR تا زمان پیکربندی میزبان عمومی سابسکریپشن قابل تولید نیست؛ QR ساختگی نمایش داده نشد."); return; }
    const endpoint = action === "ROTATE" ? `/inbounds/${inbound.id}/clients/${client.id}/rotate` : action === "RESET" ? `/inbounds/${inbound.id}/clients/${client.id}/traffic/reset` : `/inbounds/${inbound.id}/clients/${client.id}`;
    const method = action === "DELETE" ? "DELETE" : "POST";
    const titles = { ROTATE: "چرخش اعتبارنامه", RESET: "ریست ترافیک کاربر", DELETE: "حذف کاربر" } as const;
    confirm({ title: `${titles[action]} · ${client.name}`, description: action === "ROTATE" ? "اعتبارنامه قبلی بلافاصله نامعتبر و مقدار جدید به‌شکل امن تولید می‌شود." : action === "RESET" ? "شمارنده این کاربر در Xray و سپس پایگاه داده صفر می‌شود." : "کاربر از این ورودی حذف و تغییر با hot-apply اعمال می‌شود.", confirmLabel: titles[action], action: async () => {
      if (action === "ROTATE" || action === "DELETE") await mutate(() => apiRequest<ApplyResponse>(endpoint, { method, body: JSON.stringify({ confirmation: "CONFIRM" }) }), `${titles[action]} انجام شد`);
      else { setBusy(true); try { await apiRequest(endpoint, { method, body: JSON.stringify({ confirmation: "CONFIRM" }) }); await reload(); setMessageTone("info"); setMessage("ترافیک کاربر ریست شد."); } catch (error) { showError(error); } finally { setBusy(false); } }
    } });
  }

  return (
    <div className="management-page inbounds-management">
      <header className="section-page-heading inbound-page-heading"><div><p className="section-kicker">XRAY INBOUND MANAGEMENT</p><h2>مدیریت ورودی‌ها</h2><p>هر ورودی یک والد مستقل است و کاربران و اعتبارنامه‌ها فقط زیر همان ورودی مدیریت می‌شوند.</p></div><InboundToolbar onAction={handleGlobal} disabled={busy || data.inbounds.length === 0} /></header>
      <Card as="section" className={`inbound-runtime-banner ${data.runtime.state === "CONNECTED" ? "is-connected" : ""}`}><span><RadioTower size={18} /></span><div><strong>{data.runtime.state === "CONNECTED" ? "عامل Xray متصل" : "عامل Xray قطع است"}</strong><p>{data.runtime.message}</p></div><StatusBadge tone={data.runtime.state === "CONNECTED" ? "healthy" : "warning"}>{data.runtime.state}</StatusBadge></Card>
      {message ? <div className={`management-message inbound-message ${messageTone === "danger" ? "is-danger" : ""}`} role="status">{messageTone === "danger" ? <AlertTriangle size={15} /> : null}<span>{message}</span></div> : null}
      <InboundSummaryCards inbounds={data.inbounds} />
      <InboundTable inbounds={data.inbounds} busy={busy} onInboundAction={handleInbound} onClientAction={handleClient} />
      {formOpen ? <InboundFormDrawer key={editing?.id || "new"} open inbound={editing} servers={data.servers} supportsXhttp={data.runtime.supportsXhttp} advancedAllowed={advancedAllowed} busy={busy} onClose={() => { setFormOpen(false); setEditing(null); }} onSubmit={submitInbound} /> : null}
      <InboundClientDrawer inbound={clientInbound} defaults={data.userDefaults} busy={busy} onClose={() => setClientInbound(null)} onSubmit={submitClient} />
      <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.title || ""} description={confirmation?.description || ""} confirmLabel={confirmation?.confirmLabel || "تأیید"} onClose={() => setConfirmation(null)} onConfirm={() => void runConfirmed()} />
    </div>
  );
}

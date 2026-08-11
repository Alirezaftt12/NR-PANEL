"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  CalendarPlus, CheckCircle2, ChevronDown, Clipboard, Download, Edit3, KeyRound, MoreHorizontal, Plus, QrCode,
  RotateCcw, Trash2, UserCheck, UserMinus, Users, Wifi,
} from "lucide-react";
import type { SubpanelUserSummary, SubpanelUsersPageData } from "@nr/shared";
import { apiRequest, ClientApiError, downloadApiFile } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { StatusBadge } from "../ui/StatusBadge";
import { formatBytes, formatDate } from "./format";
import { QuotaOverview } from "./QuotaOverview";
import { SubPanelUserDrawer } from "./SubPanelUserDrawer";

type ConfirmState = { title: string; description: string; label: string; run: () => Promise<void> } | null;

function errorMessage(error: unknown) {
  if (!(error instanceof ClientApiError)) return "عملیات انجام نشد.";
  const map: Record<string, string> = { TRAFFIC_QUOTA_EXCEEDED: "اعتبار ترافیک کافی نیست.", SUBPANEL_CAPABILITY_DISABLED: "این قابلیت توسط OWNER غیرفعال شده است.", SUBPANEL_EXPIRED: "زیرپنل منقضی یا غیرفعال است." };
  return map[error.code] ?? error.message;
}

export function SubPanelUsers({ initialData, initialError }: { initialData: SubpanelUsersPageData; initialError?: string | null }) {
  const router = useRouter();
  const [drawer, setDrawer] = useState<{ user?: SubpanelUserSummary; inboundId?: string } | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState(initialError ?? "");
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [qr, setQr] = useState<{ title: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const usersByInbound = useMemo(() => Object.fromEntries(initialData.assignedInbounds.map((inbound) => [inbound.id, initialData.users.filter((user) => user.inboundId === inbound.id)])), [initialData]);

  function refresh() { setSelected([]); router.refresh(); }

  async function mutate(path: string, body: unknown) {
    setBusy(true); setMessage("");
    try { await apiRequest(path, { method: "POST", body: JSON.stringify(body) }); refresh(); }
    catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  async function copySecret(user: SubpanelUserSummary, kind: "config" | "subscription") {
    try {
      const result = await apiRequest<{ value: string }>(`/subpanel/users/${user.id}/${kind}`);
      await navigator.clipboard.writeText(result.value); setMessage(kind === "config" ? "کانفیگ کپی شد." : "لینک اشتراک کپی شد.");
    } catch (error) { setMessage(errorMessage(error)); }
  }

  async function showQr(user: SubpanelUserSummary, kind: "config" | "subscription") {
    try { const result = await apiRequest<{ value: string }>(`/subpanel/users/${user.id}/${kind}/qr`); setQr({ title: `${kind === "config" ? "کانفیگ" : "اشتراک"} · ${user.username}`, value: result.value }); }
    catch (error) { setMessage(errorMessage(error)); }
  }

  function confirmMutation(title: string, description: string, label: string, path: string, body: unknown) {
    setConfirm({ title, description, label, run: async () => { setConfirm(null); await mutate(path, body); } });
  }

  function extendUsers(userIds: string[]) {
    const value = window.prompt("تعداد روز تمدید را وارد کنید:", "30");
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1) return;
    if (userIds.length === 1) void mutate(`/subpanel/users/${userIds[0]}/actions`, { action: "EXTEND", days });
    else void mutate("/subpanel/users/bulk", { action: "EXTEND", userIds, days });
  }

  function increaseTraffic(userIds: string[]) {
    const value = window.prompt("حجم افزایش به گیگابایت:", "10");
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const bytes = String(BigInt(Math.round(amount * 1024 ** 3)));
    if (userIds.length === 1) void mutate(`/subpanel/users/${userIds[0]}/actions`, { action: "INCREASE_TRAFFIC", bytes });
    else void mutate("/subpanel/users/bulk", { action: "INCREASE_TRAFFIC", userIds, bytes });
  }

  async function exportSelected(kind: "config" | "subscription") {
    setBusy(true); setMessage("");
    try {
      const values = await Promise.all(selected.map(async (id) => (await apiRequest<{ value: string }>(`/subpanel/users/${id}/${kind}`)).value));
      const url = URL.createObjectURL(new Blob([values.join("\n")], { type: "text/plain;charset=utf-8" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `nr-panel-selected-${kind}.txt`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }

  const allSelected = initialData.users.length > 0 && selected.length === initialData.users.length;
  return (
    <div className="subpanel-page-stack">
      <header className="subpanel-page-heading"><div><p>ASSIGNED INBOUNDS → USERS</p><h2>مدیریت کاربران</h2><span>تنها کاربران همین زیرپنل در ورودی‌های تخصیص‌یافته نمایش داده می‌شوند.</span></div><div><Button onClick={() => void downloadApiFile("/subpanel/users/export?kind=configs", "nr-panel-configs.txt")}><Download size={15} /> همه کانفیگ‌ها</Button><Button variant="primary" onClick={() => setDrawer({})} disabled={!initialData.assignedInbounds.length}><Plus size={16} /> کاربر جدید</Button></div></header>
      {message ? <Card className={`subpanel-notice ${initialError ? "danger" : ""}`}><p>{message}</p><button type="button" onClick={() => setMessage("")}>×</button></Card> : null}
      <QuotaOverview quota={initialData.quota} />
      <Card className="subpanel-bulk-toolbar">
        <label><input type="checkbox" checked={allSelected} onChange={(event) => setSelected(event.target.checked ? initialData.users.map((user) => user.id) : [])} /> انتخاب همه</label>
        <span>{selected.length.toLocaleString("fa-IR")} انتخاب</span>
        <div>
          <Button compact disabled={!selected.length || busy} onClick={() => void mutate("/subpanel/users/bulk", { action: "ENABLE", userIds: selected })}><UserCheck size={14} /> فعال</Button>
          <Button compact disabled={!selected.length || busy} onClick={() => confirmMutation("غیرفعال‌سازی گروهی", "کاربران انتخاب‌شده امکان اتصال نخواهند داشت.", "غیرفعال‌سازی", "/subpanel/users/bulk", { action: "DISABLE", userIds: selected })}><UserMinus size={14} /> غیرفعال</Button>
          <Button compact disabled={!selected.length || !initialData.capabilities.extend} onClick={() => extendUsers(selected)}><CalendarPlus size={14} /> تمدید</Button>
          <Button compact disabled={!selected.length} onClick={() => increaseTraffic(selected)}><Plus size={14} /> افزایش ترافیک</Button>
          <Button compact disabled={!selected.length || !initialData.capabilities.trafficReset} onClick={() => confirmMutation("ریست ترافیک گروهی", "مصرف فعلی کاربران انتخاب‌شده صفر می‌شود؛ تاریخچه تجمیعی حذف نمی‌شود.", "ریست ترافیک", "/subpanel/users/bulk", { action: "RESET_TRAFFIC", userIds: selected })}><RotateCcw size={14} /> ریست ترافیک</Button>
          <Button compact disabled={!selected.length} onClick={() => void exportSelected("config")}><Download size={14} /> کانفیگ منتخب</Button>
          <Button compact disabled={!selected.length || !initialData.capabilities.subscription} onClick={() => void exportSelected("subscription")}><Wifi size={14} /> اشتراک منتخب</Button>
          <Button compact variant="danger" onClick={() => confirmMutation("حذف کاربران منقضی", selected.length ? "فقط کاربران منقضی انتخاب‌شده حذف می‌شوند." : "همه کاربران منقضی این زیرپنل حذف می‌شوند.", "حذف منقضی‌ها", "/subpanel/users/bulk", { action: "DELETE_EXPIRED", userIds: selected, confirmation: "CONFIRM" })}><Trash2 size={14} /> حذف منقضی</Button>
        </div>
      </Card>

      <Card className="assigned-inbounds-table">
        <div className="subpanel-table-scroll"><table><thead><tr><th /><th>وضعیت</th><th>نام ورودی</th><th>سرور</th><th>پروتکل</th><th>کاربران</th><th>مصرف</th><th /></tr></thead><tbody>
          {initialData.assignedInbounds.map((inbound) => {
            const inboundUsers = usersByInbound[inbound.id] ?? [];
            const open = expanded.includes(inbound.id);
            return <tr className="assigned-inbound-row" key={inbound.id}><td colSpan={8}>
              <div className="assigned-inbound-main">
                <button type="button" className={open ? "is-open" : ""} onClick={() => setExpanded((current) => current.includes(inbound.id) ? current.filter((id) => id !== inbound.id) : [...current, inbound.id])}><ChevronDown size={16} /></button>
                <StatusBadge tone={inbound.enabled ? "healthy" : "disconnected"}>{inbound.enabled ? "فعال" : "غیرفعال"}</StatusBadge>
                <p><strong>{inbound.name}</strong><small dir="ltr">{inbound.tag}</small></p><span>{inbound.serverName}</span><code>{inbound.protocol}</code><span>{inboundUsers.length.toLocaleString("fa-IR")}</span><span>{formatBytes(inbound.trafficUsed)}</span>
                <Button compact onClick={() => setDrawer({ inboundId: inbound.id })}><Plus size={14} /> کاربر</Button>
              </div>
              {open ? <div className="assigned-users-child">{inboundUsers.length ? <table><thead><tr><th /><th>کاربر</th><th>وضعیت</th><th>ترافیک</th><th>انقضا</th><th>اشتراک</th><th /></tr></thead><tbody>{inboundUsers.map((user) => (
                <tr key={user.id}><td><input type="checkbox" checked={selected.includes(user.id)} onChange={(event) => setSelected((current) => event.target.checked ? uniqueIds([...current, user.id]) : current.filter((id) => id !== user.id))} /></td>
                  <td><strong>{user.displayName}</strong><small dir="ltr">{user.username}</small></td><td><StatusBadge tone={!user.enabled || user.expired ? "danger" : "healthy"}>{user.expired ? "منقضی" : user.enabled ? "فعال" : "غیرفعال"}</StatusBadge></td>
                  <td><strong>{formatBytes(user.trafficUsed)}</strong><small>از {formatBytes(user.trafficLimit)}</small></td><td>{formatDate(user.expiresAt)}</td><td>{user.subscriptionEnabled ? <CheckCircle2 size={16} className="positive-icon" /> : "—"}</td>
                  <td><UserActions user={user} capabilities={initialData.capabilities} onEdit={() => setDrawer({ user })} onCopy={copySecret} onQr={showQr} onExtend={() => extendUsers([user.id])} onIncrease={() => increaseTraffic([user.id])} onAction={(action) => {
                    if (action === "RESET_TRAFFIC") confirmMutation("ریست ترافیک", `مصرف فعلی ${user.username} صفر می‌شود.`, "ریست", `/subpanel/users/${user.id}/actions`, { action });
                    else if (action === "ROTATE_CREDENTIAL") confirmMutation("چرخش اعتبار اتصال", "کانفیگ قبلی بلافاصله نامعتبر می‌شود.", "چرخش اعتبار", `/subpanel/users/${user.id}/actions`, { action });
                    else if (action === "DELETE") confirmMutation("حذف کاربر", `کاربر ${user.username} و اشتراک او حذف می‌شود.`, "حذف قطعی", `/subpanel/users/${user.id}/actions`, { action, confirmation: "CONFIRM" });
                    else if (action === "DISABLE") confirmMutation("غیرفعال‌سازی کاربر", `اتصال ${user.username} قطع خواهد شد.`, "غیرفعال‌سازی", `/subpanel/users/${user.id}/actions`, { action });
                    else void mutate(`/subpanel/users/${user.id}/actions`, { action });
                  }} /></td></tr>
              ))}</tbody></table> : <p className="subpanel-child-empty"><Users size={18} /> کاربری در این ورودی ساخته نشده است.</p>}</div> : null}
            </td></tr>;
          })}
        </tbody></table></div>
        {!initialData.assignedInbounds.length ? <div className="subpanel-empty"><Users size={24} /><h3>ورودی تخصیص‌یافته‌ای وجود ندارد</h3><p>ساخت کاربر تا زمان تخصیص ورودی توسط OWNER ممکن نیست.</p></div> : null}
      </Card>
      <SubPanelUserDrawer open={Boolean(drawer)} inbounds={initialData.assignedInbounds} capabilities={initialData.capabilities} user={drawer?.user} defaultInboundId={drawer?.inboundId} onClose={() => setDrawer(null)} onSaved={refresh} />
      <ConfirmDialog open={Boolean(confirm)} title={confirm?.title ?? ""} description={confirm?.description ?? ""} confirmLabel={confirm?.label ?? "تأیید"} onClose={() => setConfirm(null)} onConfirm={() => void confirm?.run()} />
      {qr ? <div className="dialog-backdrop" role="presentation" onMouseDown={() => setQr(null)}><section className="subpanel-qr-dialog" role="dialog" onMouseDown={(event) => event.stopPropagation()}><QrCode size={22} /><h3>{qr.title}</h3><Image src={qr.value} alt={qr.title} width={260} height={260} unoptimized /><Button onClick={() => setQr(null)}>بستن</Button></section></div> : null}
    </div>
  );
}

function uniqueIds(values: string[]) { return [...new Set(values)]; }

function UserActions({ user, capabilities, onEdit, onCopy, onQr, onExtend, onIncrease, onAction }: {
  user: SubpanelUserSummary; capabilities: SubpanelUsersPageData["capabilities"]; onEdit: () => void;
  onCopy: (user: SubpanelUserSummary, kind: "config" | "subscription") => void; onQr: (user: SubpanelUserSummary, kind: "config" | "subscription") => void;
  onExtend: () => void; onIncrease: () => void; onAction: (action: "RESET_TRAFFIC" | "ROTATE_CREDENTIAL" | "ENABLE" | "DISABLE" | "DELETE") => void;
}) {
  return <details className="subpanel-action-menu"><summary aria-label="عملیات کاربر"><MoreHorizontal size={17} /></summary><div>
    <button type="button" onClick={onEdit}><Edit3 size={14} /> ویرایش</button>
    <button type="button" onClick={onExtend} disabled={!capabilities.extend}><CalendarPlus size={14} /> تمدید</button>
    <button type="button" onClick={onIncrease}><Plus size={14} /> افزایش ترافیک</button>
    <button type="button" onClick={() => onAction("RESET_TRAFFIC")} disabled={!capabilities.trafficReset}><RotateCcw size={14} /> ریست ترافیک</button>
    <button type="button" onClick={() => onAction(user.enabled ? "DISABLE" : "ENABLE")}>{user.enabled ? <UserMinus size={14} /> : <UserCheck size={14} />} {user.enabled ? "غیرفعال" : "فعال"}</button>
    <button type="button" onClick={() => onCopy(user, "config")} disabled={!user.configAvailable}><Clipboard size={14} /> کپی کانفیگ</button>
    <button type="button" onClick={() => onQr(user, "config")} disabled={!user.configAvailable}><QrCode size={14} /> QR کانفیگ</button>
    <button type="button" onClick={() => onCopy(user, "subscription")} disabled={!capabilities.subscription || !user.subscriptionAvailable}><Wifi size={14} /> لینک اشتراک</button>
    <button type="button" onClick={() => onAction("ROTATE_CREDENTIAL")} disabled={!capabilities.credentialRotation}><KeyRound size={14} /> چرخش اعتبار</button>
    <button type="button" className="danger" onClick={() => onAction("DELETE")}><Trash2 size={14} /> حذف</button>
  </div></details>;
}

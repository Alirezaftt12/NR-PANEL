"use client";

import type { InboundClientSummary, InboundSummary } from "@nr/shared";
import { ChevronDown, Copy, Download, Edit3, Link2, Plus, Power, PowerOff, RotateCcw, Trash2, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";
import { InboundUsersList, type ClientRowAction } from "./InboundUsersList";

export type InboundRowAction = "EDIT" | "NEW_CLIENT" | "SUBSCRIPTION" | "RESET_CLIENTS" | "EXPORT_LINKS" | "EXPORT_SUBSCRIPTIONS" | "DELETE_EXPIRED" | "EXPORT_INBOUND" | "RESET_INBOUND" | "DUPLICATE" | "TOGGLE" | "DELETE";

function bytes(value: string | null) {
  if (!value) return "نامحدود";
  let current = Number(value); const units = ["B", "KB", "MB", "GB", "TB"]; let unit = 0;
  while (current >= 1024 && unit < units.length - 1) { current /= 1024; unit += 1; }
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(current)} ${units[unit]}`;
}

function duration(value: string | null) {
  if (!value) return "نامحدود";
  const days = Math.ceil((Date.parse(value) - Date.now()) / 86_400_000);
  return days < 0 ? "منقضی" : `${days.toLocaleString("fa-IR")} روز`;
}

function applyTone(status: InboundSummary["applyStatus"]) {
  if (status === "APPLIED") return "healthy" as const;
  if (status === "PENDING" || status === "APPLYING") return "warning" as const;
  return "disconnected" as const;
}

export function InboundTable({ inbounds, busy, onInboundAction, onClientAction }: {
  inbounds: InboundSummary[]; busy: boolean;
  onInboundAction: (action: InboundRowAction, inbound: InboundSummary) => void;
  onClientAction: (action: ClientRowAction, inbound: InboundSummary, client: InboundClientSummary) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggleRow(id: string) { setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  if (inbounds.length === 0) return <Card as="section" className="inbound-empty-state"><span><Users size={23} /></span><h3>هنوز ورودی Xray ساخته نشده است</h3><p>ابتدا یک ورودی بسازید؛ سپس کاربران و اعتبارنامه‌ها را دقیقاً زیر همان ورودی اضافه کنید.</p></Card>;
  return (
    <Card as="section" className="inbound-table-card">
      <div className="responsive-table inbound-main-table"><table><thead><tr><th aria-label="باز کردن ردیف" /><th>ID</th><th>فعال</th><th>نام</th><th>پورت</th><th>پروتکل</th><th>کاربران</th><th>کل ترافیک</th><th>مدت</th><th>اعمال</th><th>عملیات</th></tr></thead><tbody>
        {inbounds.map((inbound) => {
          const isExpanded = expanded.has(inbound.id);
          const items: ActionMenuItem[] = [
            { key: "edit", label: "ویرایش", icon: <Edit3 size={14} />, onSelect: () => onInboundAction("EDIT", inbound) },
            { key: "new-user", label: "کاربر جدید", icon: <Plus size={14} />, onSelect: () => onInboundAction("NEW_CLIENT", inbound) },
            { key: "subscription", label: "سابسکریپشن", icon: <Link2 size={14} />, onSelect: () => onInboundAction("SUBSCRIPTION", inbound) },
            { key: "reset-users", label: "ریست ترافیک کاربران", icon: <RotateCcw size={14} />, danger: true, onSelect: () => onInboundAction("RESET_CLIENTS", inbound) },
            { key: "links", label: "استخراج لینک‌ها", icon: <Download size={14} />, onSelect: () => onInboundAction("EXPORT_LINKS", inbound) },
            { key: "sub-links", label: "استخراج لینک‌های سابسکریپشن", icon: <Download size={14} />, onSelect: () => onInboundAction("EXPORT_SUBSCRIPTIONS", inbound) },
            { key: "expired", label: "حذف کاربران منقضی", icon: <UserMinus size={14} />, danger: true, onSelect: () => onInboundAction("DELETE_EXPIRED", inbound) },
            { key: "export", label: "استخراج ورودی", icon: <Download size={14} />, onSelect: () => onInboundAction("EXPORT_INBOUND", inbound) },
            { key: "reset", label: "ریست ترافیک ورودی", icon: <RotateCcw size={14} />, danger: true, onSelect: () => onInboundAction("RESET_INBOUND", inbound) },
            { key: "duplicate", label: "شبیه‌سازی", icon: <Copy size={14} />, onSelect: () => onInboundAction("DUPLICATE", inbound) },
            { key: "toggle", label: inbound.enabled ? "غیرفعال‌سازی" : "فعال‌سازی", icon: inbound.enabled ? <PowerOff size={14} /> : <Power size={14} />, danger: inbound.enabled, onSelect: () => onInboundAction("TOGGLE", inbound) },
            { key: "delete", label: "حذف", icon: <Trash2 size={14} />, danger: true, onSelect: () => onInboundAction("DELETE", inbound) },
          ];
          return <tr className="inbound-row-group" key={inbound.id}>
            <td colSpan={11} className="inbound-row-cell">
              <div className="inbound-row-grid">
                <button type="button" className={`inbound-expand ${isExpanded ? "is-open" : ""}`} aria-label={`${isExpanded ? "بستن" : "باز کردن"} کاربران ${inbound.name}`} aria-expanded={isExpanded} onClick={() => toggleRow(inbound.id)}><ChevronDown size={16} /></button>
                <code>{inbound.id.slice(0, 8)}</code>
                <button type="button" disabled={busy} role="switch" aria-checked={inbound.enabled} aria-label={`تغییر وضعیت ${inbound.name}`} className={`inbound-toggle ${inbound.enabled ? "is-on" : ""}`} onClick={() => onInboundAction("TOGGLE", inbound)}><span /></button>
                <div className="inbound-name-cell"><strong>{inbound.name}</strong><small>{inbound.serverName} · {inbound.transport}/{inbound.security}</small></div>
                <span dir="ltr">{inbound.port.toLocaleString("fa-IR")}</span><StatusBadge tone="info">{inbound.protocol}</StatusBadge>
                <span>{inbound.clientCount.toLocaleString("fa-IR")}</span><span dir="ltr">{bytes(inbound.trafficUsed)}</span><span>{duration(inbound.expiresAt)}</span>
                <StatusBadge tone={applyTone(inbound.applyStatus)}>{inbound.applyStatus}</StatusBadge><ActionMenu compact label={`عملیات ${inbound.name}`} items={items} />
              </div>
              {inbound.lastApplyError ? <div className="inbound-apply-error" role="status">اعمال آخر: {inbound.lastApplyError}</div> : null}
              {isExpanded ? <InboundUsersList inbound={inbound} onAction={(action, client) => onClientAction(action, inbound, client)} /> : null}
            </td>
          </tr>;
        })}
      </tbody></table></div>
    </Card>
  );
}


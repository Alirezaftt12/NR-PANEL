"use client";

import type { InboundClientSummary, InboundSummary } from "@nr/shared";
import { KeyRound, QrCode, RotateCcw, Trash2 } from "lucide-react";
import { StatusBadge } from "../ui/StatusBadge";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

export type ClientRowAction = "ROTATE" | "RESET" | "QR" | "DELETE";

function bytes(value: string | null) {
  if (!value) return "نامحدود";
  let current = Number(value); const units = ["B", "KB", "MB", "GB", "TB"]; let unit = 0;
  while (current >= 1024 && unit < units.length - 1) { current /= 1024; unit += 1; }
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(current)} ${units[unit]}`;
}

function expiration(value: string | null) {
  if (!value) return "بدون انقضا";
  const days = Math.ceil((Date.parse(value) - Date.now()) / 86_400_000);
  if (days < 0) return "منقضی";
  return `${days.toLocaleString("fa-IR")} روز`;
}

export function InboundUsersList({ inbound, onAction }: { inbound: InboundSummary; onAction: (action: ClientRowAction, client: InboundClientSummary) => void }) {
  if (inbound.clients.length === 0) return <div className="inbound-child-empty">هنوز کاربری زیر این ورودی ساخته نشده است.</div>;
  return (
    <div className="inbound-users-panel">
      <div className="inbound-users-heading"><strong>کاربران این ورودی</strong><span>{inbound.clients.length.toLocaleString("fa-IR")} رکورد</span></div>
      <div className="inbound-users-table"><table><thead><tr><th>کاربر</th><th>وضعیت زنده</th><th>فعال</th><th>مصرف</th><th>سقف ترافیک</th><th>مدت</th><th>عملیات</th></tr></thead><tbody>
        {inbound.clients.map((client) => {
          const menu: ActionMenuItem[] = [
            { key: "rotate", label: "چرخش اعتبارنامه", icon: <KeyRound size={14} />, onSelect: () => onAction("ROTATE", client) },
            { key: "reset", label: "ریست ترافیک", icon: <RotateCcw size={14} />, danger: true, onSelect: () => onAction("RESET", client) },
            { key: "qr", label: "نمایش QR", icon: <QrCode size={14} />, onSelect: () => onAction("QR", client) },
            { key: "delete", label: "حذف کاربر", icon: <Trash2 size={14} />, danger: true, onSelect: () => onAction("DELETE", client) },
          ];
          return <tr key={client.id}>
            <td><strong>{client.name}</strong><small>{client.email || client.publicId}</small></td>
            <td><StatusBadge tone="disconnected">ناموجود</StatusBadge><small>عامل آنلاین نیست</small></td>
            <td><StatusBadge tone={client.enabled && !client.expired ? "healthy" : "disconnected"}>{client.enabled && !client.expired ? "فعال" : "غیرفعال"}</StatusBadge></td>
            <td dir="ltr">{bytes(client.trafficUsed)}</td><td dir="ltr">{bytes(client.trafficLimit)}</td><td>{expiration(client.expiresAt)}</td>
            <td><ActionMenu compact label={`عملیات ${client.name}`} items={menu} /></td>
          </tr>;
        })}
      </tbody></table></div>
    </div>
  );
}


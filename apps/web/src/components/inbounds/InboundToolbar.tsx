"use client";

import { Archive, Cable, Download, Power, PowerOff, RotateCcw, Trash2, Users } from "lucide-react";
import { Button } from "../ui/Button";
import { ActionMenu, type ActionMenuItem } from "./ActionMenu";

export type GlobalInboundAction = "ADD" | "EXPORT_LINKS" | "EXPORT_SUBSCRIPTIONS" | "RESET_INBOUNDS" | "RESET_USERS" | "DELETE_EXPIRED" | "ENABLE_ALL" | "DISABLE_ALL" | "BACKUP";

export function InboundToolbar({ onAction, disabled }: { onAction: (action: GlobalInboundAction) => void; disabled: boolean }) {
  const items: ActionMenuItem[] = [
    { key: "add", label: "افزودن ورودی", icon: <Cable size={15} />, onSelect: () => onAction("ADD") },
    { key: "links", label: "استخراج همه لینک‌ها", icon: <Download size={15} />, disabled, onSelect: () => onAction("EXPORT_LINKS") },
    { key: "subscriptions", label: "استخراج همه سابسکریپشن‌ها", icon: <Download size={15} />, disabled, onSelect: () => onAction("EXPORT_SUBSCRIPTIONS") },
    { key: "enable", label: "فعال‌سازی همه", icon: <Power size={15} />, disabled, onSelect: () => onAction("ENABLE_ALL") },
    { key: "disable", label: "غیرفعال‌سازی همه", icon: <PowerOff size={15} />, danger: true, disabled, onSelect: () => onAction("DISABLE_ALL") },
    { key: "reset-inbounds", label: "ریست ترافیک کل ورودی‌ها", icon: <RotateCcw size={15} />, danger: true, disabled, onSelect: () => onAction("RESET_INBOUNDS") },
    { key: "reset-users", label: "ریست ترافیک کل کاربران", icon: <Users size={15} />, danger: true, disabled, onSelect: () => onAction("RESET_USERS") },
    { key: "delete-expired", label: "حذف کاربران منقضی", icon: <Trash2 size={15} />, danger: true, disabled, onSelect: () => onAction("DELETE_EXPIRED") },
    { key: "backup", label: "استخراج پشتیبان", icon: <Archive size={15} />, disabled, onSelect: () => onAction("BACKUP") },
  ];
  return <div className="inbound-toolbar"><ActionMenu label="عملیات کلی" items={items} /><Button variant="primary" onClick={() => onAction("ADD")}><Cable size={16} />افزودن ورودی</Button></div>;
}


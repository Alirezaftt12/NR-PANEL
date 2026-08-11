"use client";

import { CalendarClock, UserPlus, X } from "lucide-react";
import type { SubpanelAssignedInbound, SubpanelCapabilities, SubpanelUserSummary } from "@nr/shared";
import { useState } from "react";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";

type Props = {
  open: boolean;
  inbounds: SubpanelAssignedInbound[];
  capabilities: SubpanelCapabilities;
  user?: SubpanelUserSummary | null;
  defaultInboundId?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

const gbToBytes = (value: FormDataEntryValue | null) => value && Number(value) > 0 ? String(BigInt(Math.round(Number(value) * 1024 ** 3))) : null;
const toIso = (value: FormDataEntryValue | null) => value ? new Date(String(value)).toISOString() : null;

function friendlyError(error: unknown) {
  if (!(error instanceof ClientApiError)) return "ذخیره کاربر انجام نشد.";
  const messages: Record<string, string> = {
    USER_LIMIT_EXCEEDED: "سهمیه تعداد کاربر تکمیل شده است.", TRAFFIC_QUOTA_EXCEEDED: "اعتبار ترافیک قابل تخصیص کافی نیست.",
    SUBPANEL_EXPIRED: "زیرپنل منقضی یا غیرفعال است.", INBOUND_NOT_ASSIGNED: "این ورودی دیگر به زیرپنل تخصیص ندارد.",
    USER_EXPIRATION_EXCEEDS_SUBPANEL: "انقضای کاربر نمی‌تواند بعد از انقضای زیرپنل باشد.", RESOURCE_CONFLICT: "نام کاربری تکراری است.",
  };
  return messages[error.code] ?? error.message;
}

export function SubPanelUserDrawer({ open, inbounds, capabilities, user, defaultInboundId, onClose, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open) return null;
  const editing = Boolean(user);

  async function submit(formData: FormData) {
    setBusy(true); setError("");
    try {
      if (user) {
        await apiRequest(`/subpanel/users/${user.id}`, { method: "PATCH", body: JSON.stringify({
          displayName: formData.get("displayName"), trafficLimit: gbToBytes(formData.get("trafficGb")), expiresAt: toIso(formData.get("expiresAt")),
          enabled: formData.get("enabled") === "on", subscriptionEnabled: formData.get("subscriptionEnabled") === "on",
        }) });
      } else {
        const duration = Number(formData.get("durationDays") || 0);
        await apiRequest("/subpanel/users", { method: "POST", body: JSON.stringify({
          inboundId: formData.get("inboundId"), username: formData.get("username"), displayName: formData.get("displayName"),
          trafficLimit: gbToBytes(formData.get("trafficGb")), durationDays: duration > 0 ? duration : null,
          expiresAt: duration > 0 ? null : toIso(formData.get("expiresAt")), enabled: formData.get("enabled") === "on",
          subscriptionEnabled: capabilities.subscription && formData.get("subscriptionEnabled") === "on",
        }) });
      }
      onSaved(); onClose();
    } catch (caught) { setError(friendlyError(caught)); }
    finally { setBusy(false); }
  }

  const trafficGb = user?.trafficLimit ? (Number(user.trafficLimit) / 1024 ** 3).toFixed(1) : "";
  const expiresAt = user?.expiresAt ? new Date(user.expiresAt).toISOString().slice(0, 16) : "";
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="subpanel-user-drawer" aria-modal="true" role="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>{editing ? <CalendarClock size={19} /> : <UserPlus size={19} />}</span><p><strong>{editing ? "ویرایش کاربر" : "ساخت کاربر جدید"}</strong><small>{editing ? user?.username : "روی ورودی تخصیص‌یافته"}</small></p></div><IconButton label="بستن" onClick={onClose}><X size={18} /></IconButton></header>
        <form action={submit}>
          {error ? <p className="drawer-form-error">{error}</p> : null}
          <div className="subpanel-form-grid">
            <label className="full">ورودی تخصیص‌یافته<select name="inboundId" defaultValue={user?.inboundId ?? defaultInboundId ?? inbounds[0]?.id} disabled={editing} required>{inbounds.map((inbound) => <option key={inbound.id} value={inbound.id}>{inbound.serverName} · {inbound.name} · {inbound.protocol}</option>)}</select></label>
            <label>نام کاربری<input name="username" defaultValue={user?.username ?? ""} disabled={editing} required={!editing} minLength={2} /></label>
            <label>نام نمایشی<input name="displayName" defaultValue={user?.displayName ?? ""} required minLength={2} /></label>
            <label>سقف ترافیک (GB)<input name="trafficGb" type="number" min="0" step="0.1" defaultValue={trafficGb} placeholder="خالی = نامحدود" /></label>
            {!editing ? <label>مدت (روز)<input name="durationDays" type="number" min="1" max="3650" placeholder="مثلاً ۳۰" /></label> : null}
            <label className={editing ? "full" : ""}>تاریخ انقضا<input name="expiresAt" type="datetime-local" defaultValue={expiresAt} /><small>{editing ? "برای بدون انقضا خالی بگذارید." : "اگر مدت وارد شود، این فیلد نادیده گرفته می‌شود."}</small></label>
          </div>
          <div className="subpanel-toggle-grid">
            <label><input name="enabled" type="checkbox" defaultChecked={user?.enabled ?? true} /> فعال باشد</label>
            <label className={!capabilities.subscription ? "is-disabled" : ""}><input name="subscriptionEnabled" type="checkbox" defaultChecked={user?.subscriptionEnabled ?? capabilities.subscription} disabled={!capabilities.subscription} /> اشتراک فعال</label>
          </div>
          <footer><Button onClick={onClose}>انصراف</Button><Button variant="primary" type="submit" disabled={busy || (!editing && inbounds.length === 0)}>{busy ? "در حال ذخیره…" : editing ? "ذخیره تغییرات" : "ساخت کاربر"}</Button></footer>
        </form>
      </aside>
    </div>
  );
}

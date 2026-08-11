"use client";

import {
  MASTER_SETTINGS_SECTIONS, PERMISSIONS, ROLES, hasPermission, type ApiTokenSummary, type MasterSettingsSection,
  type MasterSettingsSnapshot, type MasterSettingsValues, type Permission, type SettingsNavigationSection, type SettingsSectionEnvelope,
} from "@nr/shared";
import { Activity, AlertTriangle, CloudCog, MailCheck, Radio, ServerCog, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { AdvancedSettings } from "./AdvancedSettings";
import { AdminCredentialsSettings } from "./AdminCredentialsSettings";
import { ApiTokenSettings } from "./ApiTokenSettings";
import { SettingsChangeHistory } from "./SettingsChangeHistory";
import { SettingsNavigation } from "./SettingsNavigation";
import { SettingsSaveBar, SettingsSectionForm } from "./SettingsPrimitives";
import { SettingsRuntimeStatus } from "./SettingsRuntimeStatus";

type SaveState = "saved" | "dirty" | "saving" | "error";
type Confirmation = { title: string; description: string; label: string; action: () => Promise<void> };
const updatePermission: Record<MasterSettingsSection, Permission> = {
  general: PERMISSIONS.SETTINGS_GENERAL_UPDATE, security: PERMISSIONS.SETTINGS_SECURITY_UPDATE, network: PERMISSIONS.SETTINGS_NETWORK_UPDATE,
  tls: PERMISSIONS.SETTINGS_NETWORK_UPDATE, xray: PERMISSIONS.SETTINGS_XRAY_UPDATE, subscription: PERMISSIONS.SETTINGS_SUBSCRIPTION_UPDATE,
  subscriptionFormats: PERMISSIONS.SETTINGS_SUBSCRIPTION_UPDATE, telegram: PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE, email: PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE,
  notifications: PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE, users: PERMISSIONS.SETTINGS_GENERAL_UPDATE, subpanels: PERMISSIONS.SETTINGS_GENERAL_UPDATE,
  agents: PERMISSIONS.SETTINGS_NETWORK_UPDATE, traffic: PERMISSIONS.SETTINGS_GENERAL_UPDATE, backup: PERMISSIONS.SETTINGS_BACKUP_UPDATE,
  datetime: PERMISSIONS.SETTINGS_GENERAL_UPDATE, updates: PERMISSIONS.SETTINGS_UPDATE_MANAGE,
};
const highImpact = new Set<MasterSettingsSection>(["general", "security", "network", "tls", "xray", "subscription", "agents", "backup", "updates"]);
function clone<T>(value: T): T { return structuredClone(value); }
function equal(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }

export function MasterSettingsCenter({ initialSnapshot, initialTokens, initialError }: { initialSnapshot: MasterSettingsSnapshot | null; initialTokens: ApiTokenSummary[]; initialError: string | null }) {
  const auth = useAuth(); const [snapshot, setSnapshot] = useState(initialSnapshot); const [active, setActive] = useState<SettingsNavigationSection>("general");
  const [drafts, setDrafts] = useState<MasterSettingsValues | null>(() => initialSnapshot ? Object.fromEntries(MASTER_SETTINGS_SECTIONS.map((section) => [section, clone(initialSnapshot.sections[section].value)])) as MasterSettingsValues : null);
  const [saveState, setSaveState] = useState<SaveState>("saved"); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(initialError || "");
  const [messageTone, setMessageTone] = useState<"info" | "danger">(initialError ? "danger" : "info"); const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const currentSection = MASTER_SETTINGS_SECTIONS.includes(active as MasterSettingsSection) ? active as MasterSettingsSection : null;
  const dirtySections = useMemo(() => !snapshot || !drafts ? [] : MASTER_SETTINGS_SECTIONS.filter((section) => !equal(drafts[section], snapshot.sections[section].value)), [drafts, snapshot]);
  const dirty = currentSection ? dirtySections.includes(currentSection) : false;
  const globalDirty = dirtySections.length > 0;
  const identity = auth.status === "authenticated" ? auth.user : null;
  const advancedAllowed = Boolean(identity && hasPermission(identity.role, identity.permissions, PERMISSIONS.SETTINGS_ADVANCED_VIEW));
  const canManageApi = Boolean(identity && hasPermission(identity.role, identity.permissions, PERMISSIONS.SETTINGS_SECURITY_UPDATE));
  const canUpdate = Boolean(currentSection && identity && hasPermission(identity.role, identity.permissions, updatePermission[currentSection]));

  useEffect(() => {
    function beforeUnload(event: BeforeUnloadEvent) { if (!globalDirty) return; event.preventDefault(); event.returnValue = ""; }
    function intercept(event: MouseEvent) { if (!globalDirty || event.defaultPrevented) return; const anchor = (event.target as Element | null)?.closest("a[href]") as HTMLAnchorElement | null; if (!anchor || anchor.href === window.location.href) return; if (!window.confirm("تغییرات ذخیره نشده‌اند. از این صفحه خارج می‌شوید؟")) event.preventDefault(); }
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", intercept, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", intercept, true); };
  }, [globalDirty]);

  if (!snapshot || !drafts) return <Card as="section" className="settings-service-error"><AlertTriangle size={24} /><h2>مرکز تنظیمات در دسترس نیست</h2><p>{message || "API یا پایگاه داده تنظیمات پاسخ نمی‌دهد؛ هیچ مقدار نمایشی ساختگی بارگذاری نشده است."}</p></Card>;

  function choose(section: SettingsNavigationSection) {
    if (dirty && section !== active && !window.confirm("تغییرات این بخش ذخیره نشده‌اند. بدون ذخیره به بخش دیگری می‌روید؟")) return;
    setActive(section); setMessage(""); setSaveState("saved");
  }
  function change(key: string, value: unknown) {
    if (!currentSection || !canUpdate) return;
    setDrafts((current) => current ? { ...current, [currentSection]: { ...(current[currentSection] as Record<string, unknown>), [key]: value } } as MasterSettingsValues : current);
    setSaveState("dirty");
  }
  function replaceSection(section: MasterSettingsSection, envelope: SettingsSectionEnvelope) {
    setSnapshot((current) => current ? { ...current, sections: { ...current.sections, [section]: envelope } } as MasterSettingsSnapshot : current);
    setDrafts((current) => current ? { ...current, [section]: clone(envelope.value) } as MasterSettingsValues : current);
  }
  function error(reason: unknown) { setSaveState("error"); setMessageTone("danger"); setMessage(reason instanceof ClientApiError ? `${reason.message}${reason.requestId ? ` · Request ${reason.requestId}` : ""}` : "عملیات انجام نشد."); }
  function savedMessage(envelope: SettingsSectionEnvelope) {
    const runtimeFailures = envelope.runtimeApply?.filter((result) => result.state !== "APPLIED") ?? [];
    if (runtimeFailures.length) {
      const first = runtimeFailures[0];
      setMessageTone("danger");
      return `Desired State ذخیره شد، اما روی ${runtimeFailures.length} نمونه Xray اعمال نشد${first.errorMessage ? `: ${first.errorMessage}` : "."} وضعیت قبلی runtime حفظ یا rollback شده است.`;
    }
    setMessageTone("info");
    if (envelope.runtimeApply?.length) return `تنظیمات ذخیره و با مسیر امن روی ${envelope.runtimeApply.length} نمونه Xray اعمال شد.`;
    return envelope.restartRequired.length ? `ذخیره شد. برای اعمال کامل، راه‌اندازی مجدد ${envelope.restartRequired.join(" / ")} لازم است.` : "تنظیمات با موفقیت ذخیره شد.";
  }
  async function persist() {
    if (!currentSection || !dirty || !canUpdate || !drafts) return;
    const section = currentSection; const value = drafts[section];
    setBusy(true); setSaveState("saving"); setMessage("");
    try { const envelope = await apiRequest<SettingsSectionEnvelope>(`/settings/${section}`, { method: "PATCH", body: JSON.stringify(value) }); replaceSection(section, envelope); setSaveState("saved"); setMessage(savedMessage(envelope)); }
    catch (reason) { error(reason); } finally { setBusy(false); }
  }
  function save() {
    if (!currentSection) return;
    if (highImpact.has(currentSection)) {
      const details = currentSection === "network" ? "نشانی یا پورت پنل می‌تواند تغییر کند، اتصال مرورگر قطع شود و Reverse Proxy نیاز به بروزرسانی داشته باشد. ترافیک فعال Xray متوقف نمی‌شود." : currentSection === "tls" ? "اعمال TLS پس از ذخیره نیازمند راه‌اندازی مجدد مدیریت‌شده پنل است." : "این بخش روی سیاست امنیتی یا زیرساخت اثر دارد و خودکار راه‌اندازی مجدد نمی‌شود.";
      setConfirmation({ title: "تأیید تغییر پراثر", description: details, label: "ذخیره تغییرات", action: persist });
    } else void persist();
  }
  function reset() {
    if (!currentSection || !canUpdate) return;
    setConfirmation({ title: "بازنشانی بخش", description: "مقادیر این بخش به پیش‌فرض امن برمی‌گردند. Secretهای همان بخش نیز حذف می‌شوند.", label: "بازنشانی", action: async () => {
      setBusy(true); try { const envelope = await apiRequest<SettingsSectionEnvelope>(`/settings/${currentSection}/reset`, { method: "POST", body: JSON.stringify({ confirmation: "CONFIRM" }) }); replaceSection(currentSection, envelope); setSaveState("saved"); setMessage(savedMessage(envelope)); } catch (reason) { error(reason); } finally { setBusy(false); }
    } });
  }
  async function action(path: string, body: unknown = {}) { setBusy(true); setMessage(""); try { const result = await apiRequest<Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(body) }); setMessageTone("info"); setMessage(`عملیات با پاسخ واقعی سرویس انجام شد${Object.keys(result || {}).length ? ": " + JSON.stringify(result) : "."}`); } catch (reason) { error(reason); } finally { setBusy(false); } }
  function sectionAction() {
    if (!currentSection) return null;
    if (currentSection === "security") return <Button onClick={() => setConfirmation({ title: "خروج سایر نشست‌ها", description: "همه نشست‌های فعال این حساب به‌جز نشست فعلی لغو می‌شوند.", label: "لغو نشست‌ها", action: () => action("/settings/security/revoke-sessions", { confirmation: "CONFIRM" }) })} disabled={busy}><ShieldCheck size={15} />خروج سایر نشست‌ها</Button>;
    if (currentSection === "telegram") return <Button onClick={() => void action("/settings/telegram/test")} disabled={busy || dirty}><Radio size={15} />تست اتصال واقعی</Button>;
    if (currentSection === "email") return <Button onClick={() => void action("/settings/email/test")} disabled={busy || dirty}><MailCheck size={15} />ارسال ایمیل آزمایشی</Button>;
    if (currentSection === "xray") return <Button onClick={() => void action("/settings/xray/validate")} disabled={busy || dirty}><Activity size={15} />اعتبارسنجی Desired Config</Button>;
    if (currentSection === "backup") return <Button onClick={() => setConfirmation({ title: "اجرای بکاپ مدیریت‌شده", description: "سرویس فقط در صورت اتصال runtime واقعی بکاپ ایجاد می‌کند؛ پاسخ موفق ساختگی صادر نمی‌شود.", label: "اجرای بکاپ", action: () => action("/settings/backups/run", { confirmation: "CONFIRM" }) })} disabled={busy || dirty}><CloudCog size={15} />اجرای بکاپ</Button>;
    if (currentSection === "updates") return <Button onClick={() => void action("/settings/updates/check")} disabled={busy || dirty}><ServerCog size={15} />بررسی بروزرسانی</Button>;
    return null;
  }
  async function runConfirmed() { const work = confirmation?.action; setConfirmation(null); if (work) await work(); }

  return <div className="master-settings-center">
    <header className="master-settings-header"><div><p>MASTER CONTROL CENTER</p><h1>تنظیمات</h1><span>مدیریت typed و audit‌شده پنل مادر</span></div><div className="settings-header-meta"><span><small>Environment</small><strong>{snapshot.connection.environment}</strong></span><span><small>Version</small><strong>{snapshot.connection.panelVersion}</strong></span><span className={`header-save-state is-${saveState}`}><small>وضعیت</small><strong>{saveState === "saved" ? "ذخیره شده" : saveState === "dirty" ? "ذخیره نشده" : saveState === "saving" ? "در حال ذخیره" : "خطا"}</strong></span></div></header>
    <div className="master-settings-layout"><aside><SettingsNavigation active={active} advancedAllowed={advancedAllowed} onChange={choose} /><div className="settings-identity-note"><ShieldCheck size={16} /><p><strong>{identity?.username || "—"}</strong><span>{identity?.role || "—"}</span></p></div></aside><main>
      {message ? <div className={`settings-operation-message is-${messageTone}`}>{messageTone === "danger" ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}<span>{message}</span></div> : null}
      {currentSection ? <><SettingsSectionForm section={currentSection} value={drafts[currentSection] as unknown as Record<string, unknown>} warnings={snapshot.warnings.filter((warning) => warning.section === currentSection)} onChange={change} />
        <SettingsRuntimeStatus section={currentSection} snapshot={snapshot} />{currentSection === "security" ? <AdminCredentialsSettings /> : null}<div className="settings-section-actions">{sectionAction()}{!canUpdate ? <span>این حساب فقط دسترسی مشاهده دارد.</span> : null}</div><SettingsChangeHistory key={currentSection} section={currentSection} /></> : active === "api" ? <ApiTokenSettings initialTokens={initialTokens} canManage={canManageApi} /> : <AdvancedSettings snapshot={snapshot} />}
    </main></div>
    {currentSection ? <SettingsSaveBar state={saveState} dirty={dirty} busy={busy || !canUpdate} restartRequired={snapshot.sections[currentSection].restartRequired} onReset={reset} onSave={save} /> : null}
    <ConfirmDialog open={Boolean(confirmation)} title={confirmation?.title || ""} description={confirmation?.description || ""} confirmLabel={confirmation?.label || "تأیید"} onClose={() => setConfirmation(null)} onConfirm={() => void runConfirmed()} />
  </div>;
}

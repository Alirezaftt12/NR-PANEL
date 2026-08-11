"use client";

import { PRESERVE_SECRET_VALUE, type MasterSettingsSection, type SettingsWarning } from "@nr/shared";
import { AlertTriangle, Check, Info, RotateCcw, Save, ShieldAlert } from "lucide-react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { settingsDefinitions, type SettingFieldDefinition } from "./section-definitions";

function stringValue(value: unknown) { return value === null || value === undefined ? "" : String(value); }
const nullableByteFields = new Set(["trafficLimitBytes", "trafficCreditBytes"]);

function SettingField({ field, value, onChange }: { field: SettingFieldDefinition; value: unknown; onChange: (value: unknown) => void }) {
  const configuredSecret = field.kind === "secret" && value === PRESERVE_SECRET_VALUE;
  const common = { id: `setting-${field.key}`, disabled: field.disabled, "aria-describedby": field.description ? `setting-${field.key}-help` : undefined };
  let control: React.ReactNode;
  if (field.kind === "toggle") control = <button {...common} type="button" role="switch" aria-checked={Boolean(value)} className={`setting-switch ${value ? "is-on" : ""}`} onClick={() => onChange(!value)}><span /></button>;
  else if (field.kind === "select") control = <select {...common} value={stringValue(value)} onChange={(event) => onChange(event.target.value)}>{field.options?.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>;
  else if (field.kind === "textarea") control = <textarea {...common} value={stringValue(value)} placeholder={field.placeholder} onChange={(event) => onChange(event.target.value)} />;
  else if (field.kind === "tags") control = <textarea {...common} className="settings-tags-input" value={Array.isArray(value) ? value.join("\n") : ""} placeholder={field.placeholder || "هر مقدار در یک خط"} onChange={(event) => onChange(event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))} />;
  else if (field.kind === "multiselect") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    control = <div className="settings-choice-grid">{field.options?.map((item) => <label key={item.value}><input type="checkbox" checked={selected.includes(item.value)} disabled={field.disabled} onChange={(event) => onChange(event.target.checked ? [...selected, item.value] : selected.filter((entry) => entry !== item.value))} /><span>{item.label}</span></label>)}</div>;
  } else if (field.kind === "secret") control = <div className="setting-secret-control"><input {...common} type="password" value={configuredSecret ? "" : stringValue(value)} placeholder={configuredSecret ? "••••••••  تنظیم شده" : field.placeholder} autoComplete="new-password" onChange={(event) => onChange(event.target.value)} />{configuredSecret ? <button type="button" onClick={() => onChange("")}>حذف مقدار ذخیره‌شده</button> : null}</div>;
  else control = <input {...common} type={field.kind === "number" ? "number" : field.kind === "url" ? "url" : "text"} dir="ltr" min={field.min} max={field.max} step={field.step} value={stringValue(value)} placeholder={field.placeholder} onChange={(event) => onChange(field.kind === "number" ? event.target.value === "" ? null : Number(event.target.value) : nullableByteFields.has(field.key) && event.target.value === "" ? null : event.target.value)} />;
  return (
    <div className={`setting-field ${field.kind === "toggle" ? "is-toggle" : ""} ${field.kind === "multiselect" ? "is-wide" : ""} ${field.disabled ? "is-disabled" : ""}`}>
      <div className="setting-field-label"><label htmlFor={`setting-${field.key}`}>{field.label}</label>{field.restart ? <span className="restart-chip">Restart {field.restart}</span> : null}</div>
      {control}
      {field.description ? <small id={`setting-${field.key}-help`}>{field.description}</small> : null}
      {field.unavailable ? <small className="setting-unavailable">{field.unavailable}</small> : null}
    </div>
  );
}

export function SettingsSectionForm({ section, value, warnings, onChange }: { section: MasterSettingsSection; value: Record<string, unknown>; warnings: SettingsWarning[]; onChange: (key: string, value: unknown) => void }) {
  const definition = settingsDefinitions[section];
  return (
    <div className="settings-section-stack">
      <header className="settings-section-header"><p>{definition.eyebrow}</p><h2>{definition.title}</h2><span>{definition.description}</span></header>
      {definition.notice ? <div className="settings-notice"><Info size={17} /><p>{definition.notice}</p></div> : null}
      {warnings.map((warning) => <div key={warning.code} className={`settings-warning is-${warning.level}`}>{warning.level === "critical" ? <ShieldAlert size={18} /> : <AlertTriangle size={17} />}<p>{warning.message}</p></div>)}
      <Card as="section" className="settings-fields-card"><div className="settings-fields-grid">{definition.fields.map((field) => <SettingField key={field.key} field={field} value={value[field.key]} onChange={(next) => onChange(field.key, next)} />)}</div></Card>
    </div>
  );
}

export function SettingsSaveBar({ state, dirty, busy, restartRequired, onReset, onSave }: { state: "saved" | "dirty" | "saving" | "error"; dirty: boolean; busy: boolean; restartRequired: string[]; onReset: () => void; onSave: () => void }) {
  const labels = { saved: "ذخیره شده", dirty: "تغییرات ذخیره نشده", saving: "در حال ذخیره", error: "خطا در ذخیره" };
  return <footer className="settings-save-bar"><div className={`settings-save-state is-${state}`}>{state === "saved" ? <Check size={15} /> : state === "error" ? <AlertTriangle size={15} /> : <span className="save-state-dot" />}<span>{labels[state]}</span>{restartRequired.length ? <em>راه‌اندازی مجدد: {restartRequired.join(" · ")}</em> : null}</div><div><Button onClick={onReset} disabled={busy}><RotateCcw size={15} />بازنشانی این بخش</Button><Button variant="primary" onClick={onSave} disabled={!dirty || busy}><Save size={15} />ذخیره تغییرات</Button></div></footer>;
}

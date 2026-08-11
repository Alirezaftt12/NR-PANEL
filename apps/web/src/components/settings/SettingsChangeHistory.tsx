"use client";

import type { MasterSettingsSection, SettingsHistoryEntry } from "@nr/shared";
import { Clock3, History } from "lucide-react";
import { useState } from "react";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

export function SettingsChangeHistory({ section }: { section: MasterSettingsSection }) {
  const [entries, setEntries] = useState<SettingsHistoryEntry[] | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function load() { setBusy(true); setError(""); try { setEntries(await apiRequest(`/settings/${section}/history`)); } catch (reason) { setError(reason instanceof ClientApiError ? reason.message : "تاریخچه دریافت نشد."); } finally { setBusy(false); } }
  return <Card as="section" className="settings-history"><header><div><History size={17} /><span><strong>تاریخچه تغییرات</strong><small>فیلدهای تغییرکرده بدون مقدار Secret</small></span></div><Button compact onClick={() => void load()} disabled={busy}>{busy ? "در حال دریافت…" : entries ? "بروزرسانی" : "نمایش تاریخچه"}</Button></header>{error ? <p className="settings-history-error">{error}</p> : null}{entries ? entries.length ? <div>{entries.map((entry) => <article key={entry.id}><Clock3 size={14} /><p><strong>{entry.actorUsername || "حساب حذف‌شده"}</strong><span>{entry.changedFields.join(" · ")}</span></p><time>{new Date(entry.createdAt).toLocaleString("fa-IR")}</time></article>)}</div> : <p className="settings-empty">تغییری ثبت نشده است.</p> : null}</Card>;
}

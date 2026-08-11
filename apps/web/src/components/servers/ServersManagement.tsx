"use client";

import { Check, Copy, Globe2, Plus, RefreshCw, Server, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { SERVER_ROLES, type ServerJoinCommand, type ServerRole, type ServerSummary } from "@nr/shared";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { IconButton } from "../ui/IconButton";
import { StatusBadge } from "../ui/StatusBadge";

let clockSecond = Math.floor(Date.now() / 1000); const clockListeners = new Set<() => void>(); let clockTimer: ReturnType<typeof setInterval> | null = null;
function subscribeClock(listener: () => void) { clockListeners.add(listener); if (!clockTimer) clockTimer = setInterval(() => { clockSecond = Math.floor(Date.now() / 1000); clockListeners.forEach((entry) => entry()); }, 1000); return () => { clockListeners.delete(listener); if (!clockListeners.size && clockTimer) { clearInterval(clockTimer); clockTimer = null; } }; }
const clockSnapshot = () => clockSecond; const serverClockSnapshot = () => 0;

type Draft = { displayName: string; role: ServerRole; country: string; region: string; provider: string; description: string };
const emptyDraft: Draft = { displayName: "", role: "HYBRID", country: "", region: "", provider: "", description: "" };

export function ServersManagement({ initialServers, initialError = "" }: { initialServers: ServerSummary[]; initialError?: string }) {
  const router = useRouter(); const [open, setOpen] = useState(false); const [step, setStep] = useState<1 | 2>(1); const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [command, setCommand] = useState<ServerJoinCommand | null>(null); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(initialError); const [copied, setCopied] = useState(false);
  const now = useSyncExternalStore(subscribeClock, clockSnapshot, serverClockSnapshot);
  const remaining = command ? Math.max(0, Math.floor(Date.parse(command.expiresAt) / 1000 - now)) : 0;
  const pending = initialServers.filter((server) => ["PENDING_INSTALL", "REGISTERED", "CONNECTING", "OFFLINE", "ERROR"].includes(server.status));

  async function createServer() {
    setBusy(true); setMessage("");
    try { const server = await apiRequest<{ id: string }>("/servers", { method: "POST", body: JSON.stringify(draft) }); const issued = await apiRequest<ServerJoinCommand>(`/servers/${server.id}/join-token`, { method: "POST", body: "{}" }); setCommand(issued); setStep(2); router.refresh(); }
    catch (error) { setMessage(error instanceof ClientApiError ? error.message : "ساخت سرور انجام نشد."); }
    finally { setBusy(false); }
  }
  async function regenerate(serverId: string) { setBusy(true); setMessage(""); try { const issued = await apiRequest<ServerJoinCommand>(`/servers/${serverId}/join-token`, { method: "POST", body: "{}" }); setCommand(issued); setOpen(true); setStep(2); } catch (error) { setMessage(error instanceof ClientApiError ? error.message : "ساخت فرمان نصب انجام نشد."); } finally { setBusy(false); } }
  async function copy(text: string) { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  function close() { setOpen(false); setStep(1); setDraft(emptyDraft); setCommand(null); }

  return <div className="servers-page"><header className="servers-page-header"><div><p>SECURE NODE ENROLLMENT</p><h2>سرورها</h2><span>هر وضعیت و متریک فقط از Agent واقعی و احراز هویت‌شده می‌آید.</span></div><Button variant="primary" onClick={() => setOpen(true)}><Plus size={16} /> افزودن سرور</Button></header>
    {message ? <div className="servers-message">{message}</div> : null}
    <section className="server-summary-strip"><Card><Server /><p><span>کل سرورها</span><strong>{initialServers.length.toLocaleString("fa-IR")}</strong></p></Card><Card><ShieldCheck /><p><span>ONLINE واقعی</span><strong>{initialServers.filter((item) => item.status === "ONLINE").length.toLocaleString("fa-IR")}</strong></p></Card><Card><Globe2 /><p><span>در انتظار اتصال</span><strong>{pending.length.toLocaleString("fa-IR")}</strong></p></Card></section>
    <section className="servers-grid">{initialServers.map((server) => <Card key={server.id} className="server-node-card"><header><div><span className="server-node-icon"><Server size={18} /></span><p><strong>{server.displayName}</strong><small>{server.role} · {server.provider || "Provider ثبت نشده"}</small></p></div><StatusBadge tone={server.status === "ONLINE" ? "healthy" : server.status === "ERROR" ? "danger" : "disconnected"}>{server.status}</StatusBadge></header><dl><div><dt>Hostname</dt><dd dir="ltr">{server.hostname || "—"}</dd></div><div><dt>Agent</dt><dd>{server.agentStatus}</dd></div><div><dt>Xray</dt><dd>{server.xrayStatus}</dd></div><div><dt>آخرین Heartbeat</dt><dd>{server.lastHeartbeatAt ? new Date(server.lastHeartbeatAt).toLocaleString("fa-IR") : "هرگز"}</dd></div></dl>{server.status === "PENDING_INSTALL" || server.status === "OFFLINE" || server.status === "ERROR" ? <div className="server-install-card"><strong>سرور هنوز متصل نشده</strong><ol><li>با SSH وارد سرور شوید.</li><li>فرمان نصب یک‌بارمصرف را اجرا کنید.</li></ol><Button onClick={() => void regenerate(server.id)} disabled={busy}><RefreshCw size={14} /> ساخت لینک نصب جدید</Button></div> : null}<footer><Link href={`/servers/${server.id}`}>مشاهده جزئیات واقعی</Link></footer></Card>)}</section>
    {!initialServers.length ? <Card className="servers-empty"><Server size={25} /><h3>سروری ثبت نشده است</h3><p>اولین سرور را بسازید؛ تا رسیدن Heartbeat واقعی ONLINE نخواهد شد.</p></Card> : null}
    {open ? <div className="drawer-backdrop" role="presentation" onMouseDown={close}><aside className="server-wizard" role="dialog" aria-modal="true" aria-label="افزودن سرور" onMouseDown={(event) => event.stopPropagation()}><header><div><p>ADD SERVER · STEP {step}/2</p><h3>{step === 1 ? "مشخصات سرور" : "نصب امن Agent"}</h3></div><IconButton label="بستن" onClick={close}><X size={18} /></IconButton></header>{step === 1 ? <form action={() => void createServer()}><label>نام سرور<input value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} required minLength={2} /></label><label>نقش سرور<select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value as ServerRole })}>{SERVER_ROLES.map((role) => <option key={role}>{role}</option>)}</select></label><div className="server-wizard-grid"><label>کشور<input value={draft.country} onChange={(event) => setDraft({ ...draft, country: event.target.value })} /></label><label>منطقه<input value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></label><label>Provider<input value={draft.provider} onChange={(event) => setDraft({ ...draft, provider: event.target.value })} /></label></div><label>توضیحات<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} maxLength={500} /></label><p className="server-role-note">کشور و Provider فقط metadata هستند و مجوز یا مسیر ترافیک را تعیین نمی‌کنند.</p><footer><Button onClick={close}>انصراف</Button><Button type="submit" variant="primary" disabled={busy || draft.displayName.length < 2}>{busy ? "در حال ساخت…" : "ساخت و تولید فرمان"}</Button></footer></form> : <div className="server-command-step"><div className="command-security-note"><ShieldCheck size={19} /><p><strong>Join Token یک‌بارمصرف</strong><span>پس از اولین exchange یا پایان زمان، فرمان دیگر کار نمی‌کند.</span></p></div><div className="server-command-box"><code dir="ltr">{command?.installCommand || "فرمان در دسترس نیست"}</code><Button onClick={() => command && void copy(command.installCommand)} disabled={!command || remaining === 0}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "کپی شد" : "کپی فرمان"}</Button></div><p className={remaining ? "token-countdown" : "token-countdown is-expired"}>Token expires: {remaining ? `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}` : "EXPIRED"}</p>{command ? <Button onClick={() => void regenerate(command.serverId)} disabled={busy}><RefreshCw size={14} /> ساخت لینک نصب جدید</Button> : null}<footer><Button variant="primary" onClick={close}>پایان</Button></footer></div>}</aside></div> : null}
  </div>;
}

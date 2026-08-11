"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Clipboard, KeyRound, QrCode, ShieldCheck, Wifi } from "lucide-react";
import type { SubpanelSubscriptionSummary } from "@nr/shared";
import { apiRequest, ClientApiError } from "../../lib/api-client";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { StatusBadge } from "../ui/StatusBadge";
import { formatDate } from "./format";

type Pending = { title: string; description: string; label: string; run: () => Promise<void> } | null;

export function SubPanelSubscriptions({ subscriptions, error }: { subscriptions: SubpanelSubscriptionSummary[]; error?: string | null }) {
  const router = useRouter();
  const [message, setMessage] = useState(error ?? "");
  const [pending, setPending] = useState<Pending>(null);
  const [qr, setQr] = useState<{ title: string; value: string } | null>(null);

  async function request<T>(path: string, init?: RequestInit) {
    try { return await apiRequest<T>(path, init); }
    catch (caught) { setMessage(caught instanceof ClientApiError ? caught.message : "عملیات اشتراک انجام نشد."); throw caught; }
  }
  async function copy(userId: string) { const result = await request<{ value: string }>(`/subpanel/users/${userId}/subscription`); await navigator.clipboard.writeText(result.value); setMessage("لینک اشتراک کپی شد."); }
  async function showQr(item: SubpanelSubscriptionSummary) { const result = await request<{ value: string }>(`/subpanel/users/${item.userId}/subscription/qr`); setQr({ title: `اشتراک ${item.username}`, value: result.value }); }

  return <div className="subpanel-page-stack">
    <header className="subpanel-page-heading"><div><p>SUBSCRIPTION DELIVERY</p><h2>اشتراک‌ها</h2><span>هر لینک به یک کاربر همین زیرپنل متصل است.</span></div><StatusBadge tone={error ? "danger" : "healthy"}>{error ? "UNAVAILABLE" : `${subscriptions.length.toLocaleString("fa-IR")} اشتراک`}</StatusBadge></header>
    {message ? <Card className={`subpanel-notice ${error ? "danger" : ""}`}><p>{message}</p><button type="button" onClick={() => setMessage("")}>×</button></Card> : null}
    <Card className="subpanel-subscriptions-card"><div className="subpanel-table-scroll"><table><thead><tr><th>کاربر</th><th>ورودی</th><th>وضعیت</th><th>انقضا</th><th>آخرین دسترسی</th><th>آخرین چرخش</th><th>عملیات</th></tr></thead><tbody>{subscriptions.map((item) => <tr key={item.id}>
      <td><strong>{item.username}</strong></td><td>{item.inboundName}</td><td><StatusBadge tone={item.enabled ? "healthy" : "disconnected"}>{item.enabled ? "فعال" : "غیرفعال"}</StatusBadge></td><td>{formatDate(item.expiresAt)}</td><td>{item.lastAccessAt ? formatDate(item.lastAccessAt) : "هرگز"}</td><td>{item.rotatedAt ? formatDate(item.rotatedAt) : "—"}</td>
      <td><div className="subscription-actions"><Button compact onClick={() => void copy(item.userId)} disabled={!item.enabled}><Clipboard size={14} /> کپی</Button><Button compact onClick={() => void showQr(item)} disabled={!item.enabled}><QrCode size={14} /> QR</Button><Button compact onClick={() => setPending({ title: "چرخش توکن اشتراک", description: "لینک قبلی بلافاصله نامعتبر می‌شود.", label: "چرخش توکن", run: async () => { setPending(null); const result = await request<{ value: string }>(`/subpanel/users/${item.userId}/subscription/rotate`, { method: "POST" }); await navigator.clipboard.writeText(result.value); setMessage("توکن جدید ساخته و لینک تازه کپی شد."); router.refresh(); } })}><KeyRound size={14} /> چرخش</Button><Button compact variant={item.enabled ? "danger" : "success"} onClick={() => setPending({ title: item.enabled ? "غیرفعال‌سازی اشتراک" : "فعال‌سازی اشتراک", description: item.enabled ? "لینک اشتراک تا فعال‌سازی دوباره پاسخ نخواهد داد." : "لینک اشتراک دوباره قابل استفاده می‌شود.", label: item.enabled ? "غیرفعال‌سازی" : "فعال‌سازی", run: async () => { setPending(null); await request(`/subpanel/users/${item.userId}/subscription`, { method: "PATCH", body: JSON.stringify({ enabled: !item.enabled }) }); router.refresh(); } })}>{item.enabled ? "غیرفعال" : "فعال"}</Button></div></td>
    </tr>)}</tbody></table></div>{!subscriptions.length ? <div className="subpanel-empty"><Wifi size={24} /><h3>اشتراک فعالی وجود ندارد</h3><p>هنگام ساخت یا ویرایش کاربر، قابلیت اشتراک را فعال کنید.</p></div> : null}</Card>
    <Card className="subpanel-security-note"><ShieldCheck size={20} /><div><strong>کنترل توکن</strong><p>چرخش توکن، مقدار قبلی را فوراً نامعتبر می‌کند. توکن خام در فهرست یا لاگ‌ها نمایش داده نمی‌شود.</p></div></Card>
    <ConfirmDialog open={Boolean(pending)} title={pending?.title ?? ""} description={pending?.description ?? ""} confirmLabel={pending?.label ?? "تأیید"} onClose={() => setPending(null)} onConfirm={() => void pending?.run()} />
    {qr ? <div className="dialog-backdrop" role="presentation" onMouseDown={() => setQr(null)}><section className="subpanel-qr-dialog" role="dialog" onMouseDown={(event) => event.stopPropagation()}><QrCode size={22} /><h3>{qr.title}</h3><Image src={qr.value} alt={qr.title} width={260} height={260} unoptimized /><Button onClick={() => setQr(null)}>بستن</Button></section></div> : null}
  </div>;
}

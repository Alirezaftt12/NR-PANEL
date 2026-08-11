"use client";

import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, BarChart3, Database, Users } from "lucide-react";
import type { SubpanelTrafficData } from "@nr/shared";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";
import { formatBytes, quotaPercent } from "./format";
import { QuotaOverview } from "./QuotaOverview";

const ranges = [{ id: "24h", label: "۲۴ ساعت" }, { id: "7d", label: "۷ روز" }, { id: "30d", label: "۳۰ روز" }, { id: "all", label: "همه" }] as const;

export function SubPanelTraffic({ data, error }: { data: SubpanelTrafficData; error?: string | null }) {
  const chart = data.series.map((point) => ({
    label: new Date(point.bucket).toLocaleDateString("fa-IR", { month: "short", day: "numeric", ...(data.range === "24h" ? { hour: "2-digit" } : {}) }),
    rx: Number(point.rxBytes), tx: Number(point.txBytes),
  }));
  return <div className="subpanel-page-stack">
    <header className="subpanel-page-heading"><div><p>REAL TENANT AGGREGATES</p><h2>گزارش ترافیک</h2><span>تخصیص سهمیه از مصرف واقعی جدا نگه داشته می‌شود.</span></div><div className="traffic-range-tabs">{ranges.map((range) => <Link key={range.id} className={data.range === range.id ? "is-active" : ""} href={`/traffic?range=${range.id}`}>{range.label}</Link>)}</div></header>
    {error ? <Card className="subpanel-notice danger"><Activity size={18} /><p>{error}</p></Card> : null}
    <QuotaOverview quota={data.quota} />
    <Card className="subpanel-chart-card">
      <header><div><BarChart3 size={19} /><p><strong>دریافت و ارسال</strong><small>{ranges.find((range) => range.id === data.range)?.label}</small></p></div><StatusBadge tone={data.dataState === "LIVE" ? "healthy" : "disconnected"}>{data.dataState}</StatusBadge></header>
      {chart.length ? <div className="traffic-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chart}><defs><linearGradient id="trafficRx" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ff294f" stopOpacity={0.26} /><stop offset="95%" stopColor="#ff294f" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 9 }} /><YAxis tick={{ fontSize: 9 }} tickFormatter={(value) => formatBytes(String(value))} /><Tooltip formatter={(value) => formatBytes(String(value ?? 0))} /><Area type="monotone" dataKey="rx" name="RX" stroke="#ff294f" fill="url(#trafficRx)" strokeWidth={2} /><Area type="monotone" dataKey="tx" name="TX" stroke="#7f8796" fill="transparent" strokeWidth={1.5} /></AreaChart></ResponsiveContainer></div> : <div className="subpanel-empty compact"><Database size={22} /><h3>داده تجمیعی موجود نیست</h3><p>نمودار ساختگی نمایش داده نمی‌شود.</p></div>}
    </Card>
    <div className="subpanel-two-columns">
      <Card className="subpanel-ranking"><header><Users size={18} /><h3>پرمصرف‌ترین کاربران</h3></header>{data.topUsers.length ? <ol>{data.topUsers.map((item) => <li key={item.id}><span>{item.label}</span><strong>{formatBytes(item.trafficUsed)}</strong><i><b style={{ width: `${quotaPercent(item.trafficUsed, data.quota.trafficCredit)}%` }} /></i></li>)}</ol> : <p className="empty-line">کاربری با مصرف ثبت‌شده وجود ندارد.</p>}</Card>
      <Card className="subpanel-ranking"><header><Activity size={18} /><h3>مصرف بر اساس ورودی</h3></header>{data.byInbound.length ? <ol>{data.byInbound.map((item) => <li key={item.id}><span>{item.label}</span><strong>{formatBytes(item.trafficUsed)}</strong><i><b style={{ width: `${quotaPercent(item.trafficUsed, data.quota.trafficCredit)}%` }} /></i></li>)}</ol> : <p className="empty-line">مصرف ورودی ثبت نشده است.</p>}</Card>
    </div>
  </div>;
}

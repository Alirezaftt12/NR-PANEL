import { CalendarClock, HardDriveDownload, UserRoundCheck, Users } from "lucide-react";
import type { SubpanelQuotaSnapshot } from "@nr/shared";
import { Card } from "../ui/Card";
import { formatBytes, formatDate, quotaPercent } from "./format";

export function QuotaOverview({ quota }: { quota: SubpanelQuotaSnapshot }) {
  const userPercent = quota.userLimit === null || quota.userLimit === 0 ? 0 : Math.min(100, Math.round(quota.createdUsers * 100 / quota.userLimit));
  const allocatedPercent = quotaPercent(quota.allocatedTraffic, quota.trafficCredit);
  return (
    <section className="subpanel-quota-grid" aria-label="سهمیه زیرپنل">
      <Card className="quota-card"><span><Users size={19} /></span><div><small>سهمیه کاربر</small><strong>{quota.userLimit === null ? "نامحدود" : quota.userLimit.toLocaleString("fa-IR")}</strong><p>ساخته‌شده {quota.createdUsers.toLocaleString("fa-IR")} · باقی‌مانده {quota.remainingUsers === null ? "نامحدود" : quota.remainingUsers.toLocaleString("fa-IR")}</p><i><b style={{ width: `${userPercent}%` }} /></i></div></Card>
      <Card className="quota-card"><span><HardDriveDownload size={19} /></span><div><small>اعتبار قابل تخصیص</small><strong>{formatBytes(quota.trafficCredit)}</strong><p>تخصیص‌یافته {formatBytes(quota.allocatedTraffic)} · قابل تخصیص {formatBytes(quota.remainingAllocatableTraffic)}</p><i><b style={{ width: `${allocatedPercent}%` }} /></i></div></Card>
      <Card className="quota-card"><span><UserRoundCheck size={19} /></span><div><small>مصرف واقعی کاربران</small><strong>{formatBytes(quota.actualTrafficUsed)}</strong><p>این مقدار با ترافیک تخصیص‌یافته یکسان نیست.</p></div></Card>
      <Card className="quota-card"><span><CalendarClock size={19} /></span><div><small>اعتبار زیرپنل</small><strong>{formatDate(quota.expiresAt)}</strong><p>وضعیت: {quota.status === "ACTIVE" ? "فعال" : quota.status === "DISABLED" ? "غیرفعال" : "منقضی"}</p></div></Card>
    </section>
  );
}

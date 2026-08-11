import type { InboundSummary } from "@nr/shared";
import { Activity, ArrowDownUp, Cable, Users } from "lucide-react";
import { Card } from "../ui/Card";

function formatBytes(value: bigint) {
  if (value <= 0n) return "۰ B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = Number(value); let unit = 0;
  while (current >= 1024 && unit < units.length - 1) { current /= 1024; unit += 1; }
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(current)} ${units[unit]}`;
}

export function InboundSummaryCards({ inbounds }: { inbounds: InboundSummary[] }) {
  const users = inbounds.reduce((sum, inbound) => sum + inbound.clientCount, 0);
  const active = inbounds.reduce((sum, inbound) => sum + inbound.activeClientCount, 0);
  const traffic = inbounds.reduce((sum, inbound) => sum + BigInt(inbound.trafficUsed || "0"), 0n);
  const userTraffic = inbounds.flatMap((inbound) => inbound.clients).reduce((sum, client) => sum + BigInt(client.trafficUsed || "0"), 0n);
  const cards = [
    { icon: Users, label: "کاربران", value: users.toLocaleString("fa-IR"), note: `${active.toLocaleString("fa-IR")} فعال` },
    { icon: Cable, label: "کل ورودی‌ها", value: inbounds.length.toLocaleString("fa-IR"), note: `${inbounds.filter((inbound) => inbound.enabled).length.toLocaleString("fa-IR")} روشن` },
    { icon: Activity, label: "مصرف ورودی‌ها", value: formatBytes(traffic), note: "از شمارنده‌های ثبت‌شده" },
    { icon: ArrowDownUp, label: "مصرف کل کاربران", value: formatBytes(userTraffic), note: "دریافت و ارسال تجمیعی" },
  ];
  return (
    <section className="inbound-summary-grid" aria-label="خلاصه ورودی‌ها">
      {cards.map(({ icon: Icon, label, value, note }) => <Card key={label} className="inbound-summary-card"><span><Icon size={18} /></span><div><small>{label}</small><strong>{value}</strong><em>{note}</em></div></Card>)}
    </section>
  );
}


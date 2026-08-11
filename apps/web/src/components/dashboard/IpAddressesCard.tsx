"use client";

import { Eye, EyeOff, Network } from "lucide-react";
import { useState } from "react";
import type { DashboardData } from "../../lib/dashboard-data";
import { IconButton } from "../ui/IconButton";
import { MetricCard } from "./MetricCard";

function maskAddress(address: string, version: "ipv4" | "ipv6") {
  if (address === "—") return address;
  if (version === "ipv4") return `${address.split(".").slice(0, 2).join(".")}.•••.•••`;
  return `${address.split(":").slice(0, 2).join(":")}:••••:••••`;
}

export function IpAddressesCard({ data }: { data: DashboardData["addresses"] }) {
  const [visible, setVisible] = useState(false);
  return (
    <MetricCard title="آدرس‌های IP" subtitle="NETWORK ADDRESS" icon={Network} className="bottom-metric-card ip-card">
      <IconButton className="metric-header-action" label={visible ? "مخفی کردن آدرس‌ها" : "نمایش آدرس‌ها"} onClick={() => setVisible((current) => !current)}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </IconButton>
      <dl className="address-list">
        <div><dt>IPv4</dt><dd dir="ltr">{visible ? data.ipv4 : maskAddress(data.ipv4, "ipv4")}</dd></div>
        <div><dt>IPv6</dt><dd dir="ltr">{visible ? data.ipv6 : maskAddress(data.ipv6, "ipv6")}</dd></div>
      </dl>
    </MetricCard>
  );
}

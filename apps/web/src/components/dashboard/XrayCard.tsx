"use client";

import { Activity, Play, RefreshCw, Square } from "lucide-react";
import { useState } from "react";
import type { DashboardData } from "../../lib/dashboard-data";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { StatusBadge } from "../ui/StatusBadge";

type XrayAction = "start" | "restart" | "stop";

type XrayCardProps = {
  data: DashboardData["xray"];
  onAction?: (action: XrayAction) => Promise<void>;
};

const statusTone = {
  RUNNING: "healthy",
  STOPPED: "disconnected",
  ERROR: "danger",
  DISCONNECTED: "disconnected",
} as const;

export function XrayCard({ data, onAction }: XrayCardProps) {
  const [pendingAction, setPendingAction] = useState<XrayAction | null>(null);
  const canControl = data.agentConnected && Boolean(onAction);
  const configLabel = data.configState === "VALID" ? "معتبر" : data.configState === "INVALID" ? "نامعتبر" : "بررسی نشده";

  async function execute(action: XrayAction) {
    setPendingAction(null);
    if (!canControl || !onAction) return;
    await onAction(action);
  }

  return (
    <Card className="xray-core-card">
      <div className="xray-card-header">
        <div className="xray-brand">
          <span className="xray-orbit"><Activity size={23} /></span>
          <div>
            <p className="section-kicker">SERVICE CONTROL</p>
            <h2>Xray Core</h2>
          </div>
        </div>
        <StatusBadge tone={statusTone[data.status]}>{data.status}</StatusBadge>
      </div>

      {!data.agentConnected ? (
        <div className="agent-disconnected-message">
          <span className="status-pulse" aria-hidden="true" />
          <div><strong>AGENT DISCONNECTED</strong><small>کنترل سرویس تا اتصال عامل امن غیرفعال است.</small></div>
        </div>
      ) : null}

      <dl className="xray-details">
        <div><dt>نسخه نصب‌شده</dt><dd dir="ltr">{data.version}</dd></div>
        <div><dt>مدت کارکرد</dt><dd>{data.uptime}</dd></div>
        <div><dt>آخرین راه‌اندازی</dt><dd>{data.lastRestart}</dd></div>
        <div><dt>اعتبار کانفیگ</dt><dd>{configLabel}</dd></div>
      </dl>

      <div className="xray-controls" aria-label="کنترل‌های Xray">
        <Button variant="success" compact disabled={!canControl} onClick={() => execute("start")}>
          <Play size={15} /> شروع
        </Button>
        <Button compact disabled={!canControl} onClick={() => execute("restart")}>
          <RefreshCw size={15} /> راه‌اندازی مجدد
        </Button>
        <Button variant="danger" compact disabled={!canControl} onClick={() => setPendingAction("stop")}>
          <Square size={14} /> توقف
        </Button>
      </div>

      <ConfirmDialog
        open={pendingAction === "stop"}
        title="توقف Xray Core"
        description="این اقدام اتصال‌های فعال را قطع می‌کند و در گزارش امنیتی ثبت خواهد شد. برای ادامه تأیید کنید."
        confirmLabel="توقف سرویس"
        onClose={() => setPendingAction(null)}
        onConfirm={() => execute("stop")}
      />
    </Card>
  );
}

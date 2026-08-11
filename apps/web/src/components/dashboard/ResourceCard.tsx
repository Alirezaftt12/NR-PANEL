import { Cpu, DatabaseZap, HardDrive, MemoryStick } from "lucide-react";
import type { ResourceMetric } from "../../lib/dashboard-data";
import { Card } from "../ui/Card";
import { Progress } from "../ui/Progress";

const resourceIcons = {
  cpu: Cpu,
  ram: MemoryStick,
  swap: DatabaseZap,
  storage: HardDrive,
};

export function ResourceCard({ metric }: { metric: ResourceMetric }) {
  const Icon = resourceIcons[metric.id];
  const max = Math.max(...metric.history, 1);
  const points = metric.history
    .map((value, index) => `${index * (100 / Math.max(metric.history.length - 1, 1))},${28 - (value / max) * 22}`)
    .join(" ");

  return (
    <Card className="resource-card">
      <div className="resource-card-heading">
        <span className="card-icon card-icon-red"><Icon size={18} /></span>
        <div>
          <h2 dir="ltr">{metric.label}</h2>
          <p>{metric.detail}</p>
        </div>
      </div>
      {metric.available ? <Progress value={metric.percent} label={`میزان مصرف ${metric.label}`} tone={metric.tone === "info" ? "healthy" : metric.tone} /> : <p className="metric-unavailable">بدون داده زنده</p>}
      <div className="resource-values" dir="ltr">
        <strong>{metric.used}</strong>
        <span>/ {metric.total}</span>
      </div>
      {metric.history.length ? <svg className="resource-sparkline" viewBox="0 0 100 30" role="img" aria-label={`آخرین نمونه واقعی ${metric.label}`}>
        <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
      </svg> : null}
    </Card>
  );
}

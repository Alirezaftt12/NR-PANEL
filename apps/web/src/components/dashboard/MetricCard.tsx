import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../ui/Card";

type MetricCardProps = {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  children: ReactNode;
  className?: string;
};

export function MetricCard({ title, subtitle, icon: Icon, children, className = "" }: MetricCardProps) {
  return (
    <Card className={`metric-card ${className}`.trim()}>
      <div className="metric-card-header">
        <span className="card-icon"><Icon size={17} /></span>
        <div><h2>{title}</h2><p dir="ltr">{subtitle}</p></div>
      </div>
      {children}
    </Card>
  );
}

import type { ReactNode } from "react";
import type { HealthTone } from "../../lib/dashboard-data";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: HealthTone;
  dot?: boolean;
};

export function StatusBadge({ children, tone = "disconnected", dot = true }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${tone}`}>
      {dot ? <span className="status-badge-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

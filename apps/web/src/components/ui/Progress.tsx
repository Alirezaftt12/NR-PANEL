import type { CSSProperties } from "react";

type ProgressProps = {
  value: number;
  label: string;
  tone?: "healthy" | "warning" | "danger" | "disconnected";
};

export function Progress({ value, label, tone = "healthy" }: ProgressProps) {
  const normalized = Math.min(100, Math.max(0, value));
  const style = { "--progress-value": `${normalized * 3.6}deg` } as CSSProperties;

  return (
    <div
      className={`radial-progress progress-${tone}`}
      style={style}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={normalized}
    >
      <span dir="ltr">{normalized}%</span>
    </div>
  );
}

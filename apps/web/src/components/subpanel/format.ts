export function formatBytes(value: string | null | undefined) {
  if (value === null || value === undefined) return "نامحدود";
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return value;
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let amount = bytes;
  let index = 0;
  while (Math.abs(amount) >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: index ? 1 : 0 }).format(amount)} ${units[index]}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "بدون انقضا";
  return new Date(value).toLocaleDateString("fa-IR", { year: "numeric", month: "short", day: "numeric" });
}

export function quotaPercent(used: string, limit: string | null) {
  if (limit === null || BigInt(limit) <= 0n) return 0;
  return Math.min(100, Number((BigInt(used) * 100n) / BigInt(limit)));
}

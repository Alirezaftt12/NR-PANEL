"use client";

import { ChevronDown, MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";

export type ActionMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function ActionMenu({ label, items, compact = false }: { label: string; items: ActionMenuItem[]; compact?: boolean }) {
  return (
    <details className={`inbound-action-menu ${compact ? "is-compact" : ""}`}>
      <summary aria-label={label}>
        {compact ? <MoreHorizontal size={17} /> : <><span>{label}</span><ChevronDown size={14} /></>}
      </summary>
      <div className="inbound-menu-popover" role="menu">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={item.danger ? "is-danger" : ""}
            disabled={item.disabled}
            onClick={(event) => {
              event.currentTarget.closest("details")?.removeAttribute("open");
              item.onSelect();
            }}
          >
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}


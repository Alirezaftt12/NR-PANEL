"use client";

import { ShieldAlert, X } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <IconButton className="dialog-close" label="بستن پنجره" onClick={onClose}>
          <X size={17} />
        </IconButton>
        <span className="dialog-icon" aria-hidden="true">
          <ShieldAlert size={22} />
        </span>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        <div className="dialog-actions">
          <Button onClick={onClose}>انصراف</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}

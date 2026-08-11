"use client";

type MobileNavProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileNav({ open, onClose }: MobileNavProps) {
  return (
    <button
      type="button"
      className={`mobile-nav-backdrop ${open ? "is-visible" : ""}`}
      aria-label="بستن منوی موبایل"
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      onClick={onClose}
    />
  );
}

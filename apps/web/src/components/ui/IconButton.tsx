import type { ButtonHTMLAttributes } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

export function IconButton({ label, className = "", type = "button", ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      title={label}
      {...props}
    />
  );
}

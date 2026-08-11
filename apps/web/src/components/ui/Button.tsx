import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  compact?: boolean;
};

export function Button({ variant = "secondary", compact = false, className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`ui-button button-${variant} ${compact ? "button-compact" : ""} ${className}`.trim()}
      {...props}
    />
  );
}

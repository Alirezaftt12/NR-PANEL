import type { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "article" | "section" | "div";
};

export function Card({ as: Element = "article", className = "", ...props }: CardProps) {
  return <Element className={`ui-card ${className}`.trim()} {...props} />;
}

import MdiIcon from "@mdi/react";
import type { ReactNode } from "react";

/**
 * Inline Material Design icon (@mdi/js path data, @mdi/react renderer).
 * `size` 1 = 24 px; default 0.75 ≈ 18 px to sit inside text-sm buttons.
 */
export function Icon({
  path,
  size = 0.75,
  className,
  title,
}: {
  path: string;
  size?: number;
  className?: string;
  title?: string;
}): ReactNode {
  return (
    <MdiIcon
      path={path}
      size={size}
      title={title ?? null}
      {...(className !== undefined ? { className } : {})}
      style={{ display: "inline-block", verticalAlign: "-0.2em" }}
    />
  );
}

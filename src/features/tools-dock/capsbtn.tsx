/**
 * CapsuleToolBtn — 胶囊工具栏按钮（节点内嵌 / 时间轴 toolbar / dock 共用）
 */
import { type ReactElement, type ReactNode, type CSSProperties, useState } from "react";
import { useTheme } from "@zeroexo/plugin-theme";

export type CapsuleToolBtnVariant = "transparent" | "accent";

export interface CapsuleToolBtnProps {
  icon?: ReactNode;
  children?: ReactNode;
  variant?: CapsuleToolBtnVariant;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  style?: CSSProperties;
  className?: string;
}

export function CapsuleToolBtn({
  icon,
  children,
  variant = "transparent",
  disabled = false,
  title,
  onClick,
  style,
  className,
}: CapsuleToolBtnProps): ReactElement {
  const { theme } = useTheme();
  const isDark = theme.mode === "dark";
  const [hovering, setHovering] = useState(false);

  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    padding: "0 10px",
    border: 0,
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background-color 120ms ease, color 120ms ease, opacity 120ms ease",
    whiteSpace: "nowrap",
    userSelect: "none",
    ...(variant === "transparent"
      ? {
          background: hovering
            ? (isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)")
            : "transparent",
          color: isDark ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.72)",
          opacity: disabled ? 0.4 : 1,
        }
      : {
          background: disabled
            ? (isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)")
            : (theme.toolbar?.accent ?? "#ff1a2c"),
          color: disabled
            ? (isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.35)")
            : "#ffffff",
          opacity: disabled ? 0.6 : 1,
        }),
    ...style,
  };

  return (
    <button
      type="button"
      className={className}
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseEnter={() => { if (!disabled) setHovering(true); }}
      onMouseLeave={() => setHovering(false)}
      style={base}
    >
      {icon}
      {children}
    </button>
  );
}

export function capsuleTransparentStyle(
  isDark: boolean,
  hovering: boolean,
  opts?: { disabled?: boolean; accent?: string; useAccent?: boolean; noHover?: boolean },
): CSSProperties {
  const disabled = opts?.disabled ?? false;
  return {
    height: 25,
    padding: "0 8px",
    border: 0,
    borderRadius: 5,
    background: hovering && !opts?.noHover
      ? (isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.06)")
      : "transparent",
    color: opts?.useAccent && opts.accent
      ? opts.accent
      : (isDark ? "rgba(255,255,255,0.82)" : "rgba(0,0,0,0.72)"),
    fontSize: 11,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.4 : 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 120ms ease, color 120ms ease, opacity 120ms ease",
  };
}
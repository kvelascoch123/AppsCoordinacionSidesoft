import { useId, useState, type CSSProperties, type ReactNode } from "react";

export type CollapsibleSectionProps = {
  title: string;
  subtitle?: string;
  defaultExpanded?: boolean;
  children: ReactNode;
  style?: CSSProperties;
  contentStyle?: CSSProperties;
};

export function CollapsibleSection({
  title,
  subtitle,
  defaultExpanded = false,
  children,
  style,
  contentStyle,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const contentId = useId();

  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "1.2rem",
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        aria-controls={contentId}
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "0.75rem",
          width: "100%",
          padding: 0,
          margin: 0,
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>{title}</span>
          {expanded && subtitle && (
            <span
              style={{
                display: "block",
                margin: "0.35rem 0 0",
                color: "var(--muted)",
                fontSize: "0.88rem",
                lineHeight: 1.45,
                fontWeight: 400,
              }}
            >
              {subtitle}
            </span>
          )}
        </span>
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            marginTop: "0.15rem",
            fontSize: "0.9rem",
            color: "var(--muted)",
            transition: "transform 0.2s ease",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          ▸
        </span>
      </button>

      {expanded && (
        <div id={contentId} style={{ marginTop: "0.9rem", ...contentStyle }}>
          {children}
        </div>
      )}
    </section>
  );
}

import { cn } from "@/lib/cn";

/**
 * Form-level status message.
 *
 * `role="alert"` for errors so a failed submission is announced without moving
 * focus; `role="status"` for success, which is polite and will not interrupt a
 * screen reader mid-sentence.
 *
 * Every tone pairs an icon with the text — state is never carried by colour
 * alone, which matters most here, where the message is the only feedback.
 */
export function AuthMessage({
  tone,
  body,
  title,
  children,
}: {
  tone: "error" | "success" | "notice";
  body: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const config = {
    error: {
      role: "alert" as const,
      glyph: "▲",
      border: "border-[var(--color-error)]",
      background: "bg-[var(--color-error-wash)]",
      text: "text-[color:var(--color-error)]",
    },
    success: {
      role: "status" as const,
      glyph: "✓",
      border: "border-[var(--color-success)]",
      background: "bg-transparent",
      text: "text-[color:var(--color-success)]",
    },
    notice: {
      role: "status" as const,
      glyph: "·",
      border: "border-[var(--color-border)]",
      background: "bg-[var(--color-surface-1)]",
      text: "text-[color:var(--color-text-secondary)]",
    },
  }[tone];

  return (
    <div
      role={config.role}
      className={cn(
        "flex gap-3 rounded-[var(--radius-sm)] border p-4",
        config.border,
        config.background,
      )}
    >
      <span aria-hidden="true" className={cn("font-utility leading-[var(--leading-body)]", config.text)}>
        {config.glyph}
      </span>
      <div className="flex flex-col gap-2">
        {title && (
          <p
            className={cn(
              "font-utility text-[length:var(--text-utility)] uppercase tracking-[var(--tracking-utility)]",
              config.text,
            )}
          >
            {title}
          </p>
        )}
        <p className="text-[length:var(--text-body-s)] text-[color:var(--color-text-secondary)]">
          {body}
        </p>
        {children}
      </div>
    </div>
  );
}

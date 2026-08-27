import { useState, type ReactNode } from "react";

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  anchorId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  anchorId?: string;
}) {
  return (
    <section
      data-tour={anchorId}
      className={`rounded-[10px] border border-[var(--border)] bg-[var(--card-bg)] ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--divider)] px-4 py-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>}
            {subtitle && (
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{subtitle}</p>
            )}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  children,
  onClick,
  variant = "secondary",
  disabled,
  busy,
  title,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  title?: string;
  className?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45";
  const styles: Record<ButtonVariant, string> = {
    primary: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
    secondary:
      "border border-[var(--border)] bg-[var(--card-solid)] text-[var(--text-primary)] hover:bg-[var(--table-hover-bg)]",
    ghost: "text-[var(--text-secondary)] hover:bg-[var(--table-hover-bg)] hover:text-[var(--text-primary)]",
    danger: "border border-[var(--red)]/40 bg-[var(--red)]/10 text-[var(--red)] hover:bg-[var(--red)]/18",
  };
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled || busy}
      className={`${base} ${styles[variant]} ${className}`}
    >
      {busy && (
        <span className="size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

const TONES: Record<string, string> = {
  critical: "bg-[var(--red)]/12 text-[var(--red)] border-[var(--red)]/30",
  high: "bg-[var(--orange)]/14 text-[#c2591c] border-[var(--orange)]/35",
  medium: "bg-[var(--yellow)]/14 text-[#9a6404] border-[var(--yellow)]/35",
  low: "bg-[var(--blue)]/12 text-[#35659b] border-[var(--blue)]/30",
  success: "bg-[var(--green)]/12 text-[#178055] border-[var(--green)]/30",
  info: "bg-[var(--accent-soft)] text-[var(--accent-deep)] border-[var(--accent)]/25",
  neutral: "bg-[var(--card-solid)] text-[var(--text-secondary)] border-[var(--border)]",
  teal: "bg-[var(--teal)]/12 text-[#03796f] border-[var(--teal)]/30",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: keyof typeof TONES | string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${
        TONES[tone] ?? TONES.neutral
      } ${className}`}
    >
      {children}
    </span>
  );
}

export function bandTone(band: string | undefined): string {
  return band && band in TONES ? band : "neutral";
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: string;
}) {
  const color =
    tone === "danger"
      ? "text-[var(--red)]"
      : tone === "good"
        ? "text-[var(--green)]"
        : "text-[var(--text-primary)]";
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--card-bg)] p-4">
      <div className="text-[12px] font-semibold text-[var(--text-secondary)]">{label}</div>
      <div className={`mt-2 text-[22px] font-bold leading-none ${color}`}>{value}</div>
      {hint && <div className="mt-1.5 text-[12px] text-[var(--text-secondary)]">{hint}</div>}
    </div>
  );
}

export function Table({
  head,
  children,
  className = "",
}: {
  head: ReactNode[];
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`scroll-thin overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="bg-[var(--table-header-bg)]">
            {head.map((cell, i) => (
              <th
                key={i}
                className="border-b border-[var(--divider)] px-3 py-2 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase whitespace-nowrap"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--border)] px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]">
      {children}
    </div>
  );
}

export function CodeBlock({
  code,
  language,
  label,
}: {
  code: string;
  language?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-md border border-[var(--border)] bg-[#f6f2ee]">
      <div className="flex items-center justify-between border-b border-[var(--divider)] px-3 py-1.5">
        <span className="text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
          {label ?? language ?? "shell"}
        </span>
        <button
          type="button"
          className="text-[11px] font-semibold text-[var(--accent-deep)] hover:underline"
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="scroll-thin overflow-x-auto px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap">
        {code}
      </pre>
    </div>
  );
}

export function Disclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-semibold text-[var(--text-primary)] hover:bg-[var(--table-hover-bg)]"
      >
        <span>{label}</span>
        <span className="text-[var(--text-muted)]">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="border-t border-[var(--divider)] p-3">{children}</div>}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="scroll-thin max-h-[420px] overflow-auto rounded-md border border-[var(--border)] bg-[#f6f2ee] p-3 text-[11.5px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function FactorBar({
  factors,
  total = 100,
}: {
  factors: { factor: string; input: string; points: number; max_points: number }[];
  total?: number;
}) {
  const colors = ["var(--accent)", "var(--teal)", "var(--red)", "var(--orange)", "var(--blue)"];
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--input-bg)]">
        {factors.map((f, i) => (
          <div
            key={f.factor}
            title={`${f.factor}: ${f.points} of ${f.max_points}`}
            style={{ width: `${(f.points / total) * 100}%`, background: colors[i % colors.length] }}
          />
        ))}
      </div>
      <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
        {factors.map((f, i) => (
          <div key={f.factor} className="flex items-center gap-2 text-[11.5px]">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: colors[i % colors.length] }}
            />
            <span className="text-[var(--text-secondary)]">{f.factor}</span>
            <span className="ml-auto font-semibold tabular-nums">
              {f.points}/{f.max_points}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toast({
  message,
  tone,
  onDismiss,
}: {
  message: string;
  tone: "info" | "error";
  onDismiss: () => void;
}) {
  return (
    <div className="fixed right-5 bottom-5 z-50 max-w-md">
      <div
        className={`flex items-start gap-3 rounded-[10px] border px-4 py-3 text-[13px] shadow-lg ${
          tone === "error"
            ? "border-[var(--red)]/35 bg-[#fdf1f0] text-[var(--red)]"
            : "border-[var(--border)] bg-[var(--card-solid)] text-[var(--text-primary)]"
        }`}
      >
        <span className="flex-1">{message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function relativeDays(iso: string | null | undefined, now: Date): string {
  if (!iso) return "—";
  const diff = (new Date(iso).getTime() - now.getTime()) / 86_400_000;
  const abs = Math.abs(diff);
  const unit = abs < 1 ? `${Math.round(abs * 24)}h` : `${Math.round(abs)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

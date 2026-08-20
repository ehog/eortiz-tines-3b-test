import type { ReactNode } from "react";

export const SEV_COLOR: Record<string, string> = {
  critical: "var(--color-magenta)",
  high: "var(--color-coral)",
  medium: "var(--color-amber)",
  low: "var(--color-fog)",
};

export const STATUS_COLOR: Record<string, string> = {
  healthy: "var(--color-mint)",
  warning: "var(--color-amber)",
  blocked: "var(--color-magenta)",
};

export const CLASS_COLOR: Record<string, string> = {
  PHI: "var(--color-magenta)",
  PII: "var(--color-violet)",
  internal: "#5b7cff",
  public: "var(--color-fog)",
};

export const TEAM_COLOR = (team: string) => {
  const palette = [
    "#ff1e6f",
    "#6b4bff",
    "#23e0a0",
    "#ffb020",
    "#ff5a45",
    "#41b8ff",
    "#c77dff",
    "#8ce563",
    "#ff8ab8",
    "#9a9aa6",
  ];
  let h = 0;
  for (const ch of team) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return palette[h % palette.length];
};

export const nf = new Intl.NumberFormat("en-US");
export const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${nf.format(Math.round(n))}`;

export function ago(iso: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Dot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ background: color, width: size, height: size }}
    />
  );
}

export function Chip({
  children,
  active,
  onClick,
  color,
  title,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  color?: string;
  title?: string;
}) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap border px-2 py-[3px] text-[11px] font-medium tracking-wide uppercase transition-colors duration-100 ${
        onClick ? "cursor-pointer" : ""
      } ${
        active
          ? "border-transparent bg-[var(--color-magenta)] text-white"
          : "border-[var(--color-line)] text-[var(--color-fog)] hover:border-[#3a3a46] hover:text-white"
      }`}
    >
      {color && !active ? <Dot color={color} size={6} /> : null}
      {children}
    </Tag>
  );
}

export function Section({
  id,
  eyebrow,
  title,
  lede,
  right,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lede?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-[var(--color-line)] pt-8 pb-14">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl">
          <div className="mb-2 font-mono text-[10px] tracking-[0.28em] text-[var(--color-magenta)] uppercase">
            {eyebrow}
          </div>
          <h2 className="display text-3xl text-white sm:text-4xl">{title}</h2>
          {lede ? <p className="mt-3 text-sm leading-relaxed text-[var(--color-fog)]">{lede}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Caveat({ children }: { children: ReactNode }) {
  return (
    <div className="mb-5 border-l-2 border-[var(--color-amber)] bg-[var(--color-ink-2)] px-4 py-3 text-xs leading-relaxed text-[#d6d6dd]">
      {children}
    </div>
  );
}

export function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full bg-[var(--color-ink-3)]">
      <div
        className="h-full transition-[width] duration-300 ease-out"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

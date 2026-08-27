import type { ReactNode } from "react";
import type { Decision, Severity } from "./api";

export function Card({ title, subtitle, right, children, className = "" }: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg shadow-black/20 ${className}`}>
      {(title || right) && (
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          {right}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Button({ children, onClick, variant = "default", disabled, className = "" }: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
}) {
  const styles: Record<string, string> = {
    default: "border-slate-700 bg-slate-800 text-slate-100 hover:bg-slate-700",
    primary: "border-sky-500/60 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25",
    danger: "border-rose-500/50 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
    ghost: "border-transparent bg-transparent text-slate-400 hover:text-slate-100",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  high: "border-orange-500/40 bg-orange-500/15 text-orange-200",
  medium: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  low: "border-sky-500/40 bg-sky-500/15 text-sky-200",
  info: "border-slate-600 bg-slate-700/40 text-slate-300",
};

export function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.info}`}>
      {severity}
    </span>
  );
}

const DECISION_STYLES: Record<Decision, string> = {
  page: "border-rose-500/50 bg-rose-500/15 text-rose-200",
  deferred: "border-amber-500/50 bg-amber-500/15 text-amber-200",
  suppressed: "border-slate-600 bg-slate-700/40 text-slate-400",
  bypass_business_hours: "border-teal-500/40 bg-teal-500/10 text-teal-200",
};

export const DECISION_LABELS: Record<Decision, string> = {
  page: "Paged",
  deferred: "Deferred",
  suppressed: "Suppressed",
  bypass_business_hours: "Business hours",
};

export function DecisionTag({ decision }: { decision: Decision }) {
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${DECISION_STYLES[decision]}`}>
      {DECISION_LABELS[decision]}
    </span>
  );
}

export function TierTag({ tier }: { tier: string }) {
  const styles: Record<string, string> = {
    tier0: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    tier1: "border-orange-500/40 bg-orange-500/10 text-orange-200",
    tier2: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    tier3: "border-slate-600 bg-slate-700/40 text-slate-300",
  };
  return <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${styles[tier] ?? styles.tier3}`}>{tier}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "mt-1 w-full rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500";

export function ScoreBar({ score, threshold }: { score: number; threshold: number }) {
  const pct = Math.min(100, Math.max(0, score));
  const over = score >= threshold;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${over ? "bg-rose-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
      <div className="absolute top-0 h-full w-0.5 bg-slate-100/70" style={{ left: `${Math.min(100, Math.max(0, threshold))}%` }} />
    </div>
  );
}

export function Stat({ label, value, tone = "slate" }: { label: string; value: ReactNode; tone?: "slate" | "rose" | "amber" | "teal" | "sky" }) {
  const tones: Record<string, string> = {
    slate: "text-slate-100",
    rose: "text-rose-300",
    amber: "text-amber-300",
    teal: "text-teal-300",
    sky: "text-sky-300",
  };
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-slate-800 px-4 py-6 text-center text-xs text-slate-500">{children}</p>;
}

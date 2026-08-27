import { useState, type ReactNode } from "react";

export const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  medium: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  low: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
  informational: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

export const SOURCE_STYLES: Record<string, string> = {
  defender: "bg-blue-500/15 text-blue-300 ring-blue-500/30",
  sentinel: "bg-violet-500/15 text-violet-300 ring-violet-500/30",
  zscaler: "bg-teal-500/15 text-teal-300 ring-teal-500/30",
  proofpoint: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  threatintel: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
};

export const DISPOSITION_STYLES: Record<string, { label: string; classes: string; accent: string }> = {
  benign: { label: "Benign", classes: "from-emerald-500/20 to-emerald-500/5 ring-emerald-500/40", accent: "text-emerald-300" },
  needs_review: { label: "Needs review", classes: "from-amber-500/20 to-amber-500/5 ring-amber-500/40", accent: "text-amber-300" },
  likely_true_positive: {
    label: "Likely true positive",
    classes: "from-rose-500/20 to-rose-500/5 ring-rose-500/40",
    accent: "text-rose-300",
  },
};

export function Chip({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

export function Card({
  children,
  className = "",
  dataTour,
}: {
  children: ReactNode;
  className?: string;
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      className={`rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-800 px-4 py-3">
      <h2 className="text-sm font-semibold tracking-wide text-slate-200 uppercase">{children}</h2>
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </div>
  );
}

export function Collapsible({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: ReactNode;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-slate-800 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-800/40"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
          <span className={`text-slate-500 transition ${open ? "rotate-90" : ""}`}>▶</span>
          {title}
        </span>
        {hint ? <span className="font-mono text-[11px] text-slate-500">{hint}</span> : null}
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </div>
  );
}

export function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300 ring-1 ring-slate-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block size-3.5 animate-spin rounded-full border-2 border-slate-600 border-t-teal-400 ${className}`}
    />
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  disabled = false,
  className = "",
  dataTour,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "danger";
  disabled?: boolean;
  className?: string;
  dataTour?: string;
}) {
  const styles = {
    primary: "bg-teal-500 text-slate-950 hover:bg-teal-400",
    ghost: "border border-slate-700 text-slate-300 hover:border-slate-500 hover:text-slate-100",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
  }[variant];
  return (
    <button
      type="button"
      data-tour={dataTour}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

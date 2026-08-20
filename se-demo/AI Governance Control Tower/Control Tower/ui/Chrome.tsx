import { Chip, Dot, ago, money, nf } from "./kit";
import type { Filters } from "./state";

const NAV = [
  ["fleet", "Fleet"],
  ["spillage", "Spillage"],
  ["shadow", "Shadow AI"],
  ["pipeline", "Governance"],
  ["roi", "ROI"],
] as const;

export function Header({
  data,
  filters,
  activeCount,
  clear,
  toggle,
  apply,
  busy,
  reload,
}: {
  data: any;
  filters: Filters;
  activeCount: number;
  clear: () => void;
  toggle: (k: any, v: string) => void;
  apply: (f: Partial<Filters>) => void;
  busy: boolean;
  reload: () => void;
}) {
  const chips: Array<[any, string]> = [
    ...filters.team.map((v) => ["team", v] as [any, string]),
    ...filters.severity.map((v) => ["severity", v] as [any, string]),
    ...filters.classification.map((v) => ["classification", v] as [any, string]),
    ...filters.status.map((v) => ["status", v] as [any, string]),
    ...filters.model.map((v) => ["model", v] as [any, string]),
    ...filters.source.map((v) => ["source", v] as [any, string]),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-line)] bg-[color-mix(in_srgb,var(--color-ink)_88%,transparent)] backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-5 py-3 lg:px-10">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="display text-lg text-white">AI GOVERNANCE</span>
            <span className="display text-lg text-[var(--color-magenta)]">CONTROL TOWER</span>
          </div>
          <nav className="hidden items-center gap-4 md:flex">
            {NAV.map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                className="text-[11px] tracking-[0.16em] text-[var(--color-fog)] uppercase transition-colors hover:text-white"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <input
              value={filters.q}
              onChange={(e) => apply({ q: e.target.value })}
              placeholder="Search builds, owners…"
              className="w-40 border border-[var(--color-line)] bg-[var(--color-ink-2)] px-2.5 py-1.5 text-xs text-white outline-none placeholder:text-[#6c6c78] focus:border-[var(--color-magenta)] sm:w-56"
            />
            <button
              onClick={reload}
              className="cursor-pointer border border-[var(--color-line)] px-2.5 py-1.5 text-[11px] tracking-wide text-[var(--color-fog)] uppercase transition-colors hover:border-[var(--color-magenta)] hover:text-white"
            >
              {busy ? "Syncing" : "Refresh"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-fog)]">
          <span className="font-mono tracking-[0.18em] uppercase">
            Collected {ago(data.freshness.inventory)}
          </span>
          <span className="text-[#3a3a46]">/</span>
          {Object.entries(data.models).map(([step, model]) => (
            <span key={step} className="font-mono">
              {step.replace(/_/g, " ")}: <span className="text-white">{String(model)}</span>
            </span>
          ))}
          {activeCount > 0 ? (
            <>
              <span className="text-[#3a3a46]">/</span>
              <span className="tracking-[0.18em] uppercase">Filtered</span>
              {chips.map(([k, v]) => (
                <Chip key={`${k}:${v}`} active onClick={() => toggle(k, v)}>
                  {v} ✕
                </Chip>
              ))}
              <button
                onClick={clear}
                className="cursor-pointer text-[11px] tracking-[0.18em] text-[var(--color-magenta)] uppercase hover:text-white"
              >
                Clear all (esc)
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function Kpi({
  label,
  value,
  sub,
  accent,
  onClick,
  active,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`group flex flex-col items-start gap-1 border-l-2 py-1 pl-4 text-left transition-colors ${
        onClick ? "cursor-pointer" : "cursor-default"
      }`}
      style={{ borderColor: active ? "var(--color-magenta)" : accent ?? "var(--color-line)" }}
    >
      <span className="text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">{label}</span>
      <span
        className="num display text-4xl text-white transition-colors group-hover:text-[var(--color-magenta)] xl:text-5xl"
        style={{ color: accent && !onClick ? accent : undefined }}
      >
        {value}
      </span>
      <span className="text-[11px] leading-tight text-[var(--color-fog)]">{sub}</span>
    </button>
  );
}

export function Hero({
  data,
  filters,
  toggle,
}: {
  data: any;
  filters: Filters;
  toggle: (k: any, v: string) => void;
}) {
  const k = data.kpis;
  const partialSources = data.sources.filter((s: any) => s.coverage_pct < 100);

  return (
    <div className="pt-10 pb-12">
      <div className="max-w-3xl">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.28em] text-[var(--color-magenta)] uppercase">
          <Dot color="var(--color-magenta)" /> Real Chemistry · live fleet
        </div>
        <h1 className="display text-5xl text-white sm:text-6xl lg:text-7xl">
          Every AI build,
          <br />
          in one pane.
        </h1>
        <p className="mt-5 max-w-xl text-sm leading-relaxed text-[#c9c9d2]">
          {nf.format(k.builds_in_flight)} AI-generated workflows, agents, apps and repos are running
          across the business right now. This is what they touch, who owns them, and where data is
          leaving the boundary.
        </p>
        {partialSources.length ? (
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-[var(--color-amber)]">
            Coverage is incomplete:{" "}
            {partialSources
              .map((s: any) => `${s.label} at ${s.coverage_pct}%`)
              .join(", ")}
            . Counts below are a floor, not a total.
          </p>
        ) : null}
      </div>

      <div className="mt-10 grid grid-cols-2 gap-y-8 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="AI builds in flight" value={nf.format(k.builds_in_flight)} sub="across 4 discovery sources" />
        <Kpi
          label="Unowned builds"
          value={nf.format(k.unowned_builds)}
          sub="no named owner · click to filter"
          accent="var(--color-amber)"
          active={filters.status.includes("__unowned")}
          onClick={() => toggle("status", "__unowned")}
        />
        <Kpi
          label="Open spillage alerts"
          value={nf.format(k.open_spillage_alerts)}
          sub={`${k.critical_spillage_alerts} critical · click for critical only`}
          accent="var(--color-magenta)"
          active={filters.severity.includes("critical")}
          onClick={() => toggle("severity", "critical")}
        />
        <Kpi
          label="Shadow AI this week"
          value={nf.format(k.shadow_tools_this_week)}
          sub={`${k.shadow_tools_pending_review} awaiting an allow/block call`}
          accent="var(--color-violet)"
        />
        <Kpi label="Hours saved MTD" value={nf.format(k.hours_saved_mtd ?? 0)} sub="personnel hours, today excluded" accent="var(--color-mint)" />
        <Kpi label="Est. $ saved MTD" value={money(k.dollars_saved_mtd ?? 0)} sub={`at $${data.roi.blended_rate_usd}/hr blended`} accent="var(--color-mint)" />
      </div>
    </div>
  );
}

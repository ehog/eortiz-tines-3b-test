import { useMemo, useState } from "react";
import { Bar, Caveat, Chip, Section, TEAM_COLOR, money, nf } from "./kit";
import type { Filters } from "./state";

const W = 900;
const H = 240;
const PAD = { l: 44, r: 8, t: 12, b: 22 };

export function Roi({
  data,
  view,
  filters,
  toggle,
  apply,
}: {
  data: any;
  view: any;
  filters: Filters;
  toggle: (k: any, v: string) => void;
  apply: (f: Partial<Filters>) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const rate = data.roi.blended_rate_usd;
  const days: any[] = data.roi.history.slice(-filters.days);
  const complete = days.filter((d) => !d.partial);
  const teams: string[] = view.roiTeams.map((t: any) => t.team);
  const selected = filters.team.length ? filters.team : teams;

  const series = useMemo(() => {
    return complete.map((d) => {
      const values = selected.map((t) => d.by_team[t] ?? 0);
      return { date: d.date, total: values.reduce((a, b) => a + b, 0), values };
    });
  }, [complete, selected]);

  const max = Math.max(1, ...series.map((s) => s.total));
  const yTicks = [0, 0.5, 1].map((f) => Math.round((max * f) / 10) * 10);
  const x = (i: number) => PAD.l + (i / Math.max(1, series.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);

  const stacks = useMemo(() => {
    return selected.map((team, ti) => {
      const points = series.map((s, i) => {
        const below = s.values.slice(0, ti).reduce((a, b) => a + b, 0);
        return { i, lower: below, upper: below + s.values[ti] };
      });
      const top = points.map((p) => `${x(p.i)},${y(p.upper)}`).join(" ");
      const bottom = [...points].reverse().map((p) => `${x(p.i)},${y(p.lower)}`).join(" ");
      return { team, path: `${top} ${bottom}` };
    });
  }, [selected, series, max]);

  const hovered = hover !== null ? series[hover] : null;
  const windowHours = Math.round(series.reduce((a, s) => a + s.total, 0));

  const maxTeamHours = Math.max(1, ...view.roiTeams.map((t: any) => t.hours_month));

  return (
    <Section
      id="roi"
      eyebrow="Return"
      title="Personnel hours saved"
      lede="Hours reclaimed by AI-generated builds, translated to dollars at a blended internal rate Finance controls. Duplicated effort is called out separately — two teams solving the same problem is spend, not savings."
      right={
        <div className="flex flex-wrap gap-1.5">
          {[30, 60, 90].map((d) => (
            <Chip key={d} active={filters.days === d} onClick={() => apply({ days: d })}>
              {d}d
            </Chip>
          ))}
        </div>
      }
    >
      <Caveat>
        {data.roi.history_note} Today is excluded from every total on this page. Dollar figures are{" "}
        {money(rate)}/hour × hours — {data.roi.rate_basis}
      </Caveat>

      <div className="grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <div>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <div>
              <span className="num display text-4xl text-white">{nf.format(windowHours)}</span>
              <span className="ml-2 text-xs text-[var(--color-fog)]">hours in window</span>
            </div>
            <div>
              <span className="num display text-4xl text-[var(--color-mint)]">{money(windowHours * rate)}</span>
              <span className="ml-2 text-xs text-[var(--color-fog)]">est. value</span>
            </div>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={`Stacked hours saved per day by team over the last ${filters.days} days`}
            onMouseLeave={() => setHover(null)}
          >
            {yTicks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="#26262e" strokeWidth="1" />
                <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" className="chart-label num" fill="#6c6c78" fontSize="10">
                  {nf.format(t)}
                </text>
              </g>
            ))}
            {stacks.map((s) => (
              <polygon
                key={s.team}
                points={s.path}
                fill={TEAM_COLOR(s.team)}
                fillOpacity={filters.team.length && !filters.team.includes(s.team) ? 0.12 : 0.72}
                stroke={TEAM_COLOR(s.team)}
                strokeOpacity="0.5"
                strokeWidth="0.75"
                className="cursor-pointer transition-[fill-opacity] duration-150"
                onClick={() => toggle("team", s.team)}
              />
            ))}
            {series.map((s, i) => (
              <rect
                key={s.date}
                x={x(i) - (W - PAD.l - PAD.r) / (2 * Math.max(1, series.length))}
                y={PAD.t}
                width={(W - PAD.l - PAD.r) / Math.max(1, series.length)}
                height={H - PAD.t - PAD.b}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
            {hovered ? (
              <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={H - PAD.b} stroke="#ff1e6f" strokeWidth="1" />
            ) : null}
            {series.length ? (
              <>
                <text x={PAD.l} y={H - 6} className="chart-label num" fill="#6c6c78" fontSize="10">
                  {series[0].date}
                </text>
                <text x={W - PAD.r} y={H - 6} textAnchor="end" className="chart-label num" fill="#6c6c78" fontSize="10">
                  {series[series.length - 1].date}
                </text>
              </>
            ) : null}
          </svg>

          <div className="mt-2 min-h-[38px] text-xs">
            {hovered ? (
              <span className="num text-[#e6e6ea]">
                {hovered.date}: <span className="text-white">{nf.format(Math.round(hovered.total))} hrs</span> ·{" "}
                {money(hovered.total * rate)}
              </span>
            ) : (
              <span className="text-[var(--color-fog)]">
                Whole window: {nf.format(windowHours)} hrs across {selected.length} team
                {selected.length === 1 ? "" : "s"}. Hover a day for its split; click a band to filter the page.
              </span>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">
            Run-rate by team · hours per month
          </div>
          <ul className="space-y-3">
            {view.roiTeams.map((t: any) => (
              <li key={t.team}>
                <button
                  onClick={() => toggle("team", t.team)}
                  className="mb-1 flex w-full cursor-pointer items-baseline justify-between gap-3 text-left"
                >
                  <span className={`text-xs ${filters.team.includes(t.team) ? "text-[var(--color-magenta)]" : "text-[#e6e6ea]"}`}>
                    {t.team}
                    {t.unowned ? <span className="ml-2 text-[10px] text-[var(--color-amber)]">{t.unowned} unowned</span> : null}
                  </span>
                  <span className="num text-xs text-[var(--color-fog)]">
                    {nf.format(t.hours_month)} h · {money(t.dollars_month)}
                  </span>
                </button>
                <Bar value={t.hours_month} max={maxTeamHours} color={TEAM_COLOR(t.team)} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-12 border-t border-[var(--color-line)] pt-6">
        <div className="mb-4 flex flex-wrap items-baseline gap-x-4">
          <h3 className="display text-2xl text-white">Duplicate builds detected</h3>
          <span className="text-xs text-[var(--color-fog)]">
            {data.roi.duplicate_summary.pairs} pairs · {data.roi.duplicate_summary.cross_team_pairs} across teams ·{" "}
            {nf.format(data.roi.duplicate_summary.reclaimable_hours_month)} hrs/mo duplicated (
            {money(data.roi.duplicate_summary.reclaimable_dollars_month)})
          </span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {view.duplicates.map((d: any) => (
            <div key={d.id} className="border border-[var(--color-line)] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="num font-mono text-[10px] tracking-[0.16em] text-[var(--color-violet)] uppercase">
                  {(d.similarity * 100).toFixed(0)}% name overlap
                </span>
                <span className="num text-xs text-[var(--color-fog)]">
                  {nf.format(d.duplicated_hours_month)} hrs/mo duplicated
                </span>
              </div>
              {d.builds.map((b: any) => (
                <button
                  key={b.id}
                  onClick={() => apply({ build: b.id })}
                  className="block w-full cursor-pointer text-left text-sm text-white hover:text-[var(--color-magenta)]"
                >
                  {b.name}{" "}
                  <span className="text-xs text-[var(--color-fog)]">
                    · {b.team} · {b.owner ?? "unowned"} · {b.model}
                  </span>
                </button>
              ))}
              <p className="mt-2 text-xs leading-relaxed text-[var(--color-fog)]">
                {d.note}
                {d.shared_credentials.length ? ` Shared credentials: ${d.shared_credentials.join(", ")}.` : ""}
              </p>
            </div>
          ))}
          {view.duplicates.length === 0 ? (
            <p className="text-sm text-[var(--color-fog)]">No duplicate pairs inside the current filter.</p>
          ) : null}
        </div>
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-[var(--color-fog)]">
          Duplication is detected on name and credential overlap, which finds obvious twins and misses
          semantically similar builds with unrelated names. Treat the list as a floor.
        </p>
      </div>
    </Section>
  );
}

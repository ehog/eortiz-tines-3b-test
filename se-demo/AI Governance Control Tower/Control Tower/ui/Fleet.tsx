import { useMemo, useState } from "react";
import { CLASS_COLOR, Chip, Dot, STATUS_COLOR, Section, ago, nf } from "./kit";
import type { Filters } from "./state";

type SortKey = "name" | "team" | "owner" | "model" | "classification" | "risk_score" | "last_run" | "hours_saved_month";

const HEADERS: Array<[SortKey, string, string]> = [
  ["name", "Build", "text-left"],
  ["team", "Team", "text-left"],
  ["owner", "Owner", "text-left"],
  ["model", "Model", "text-left"],
  ["classification", "Data", "text-left"],
  ["risk_score", "Risk", "text-right"],
  ["hours_saved_month", "Hrs/mo", "text-right"],
  ["last_run", "Last run", "text-right"],
];

function riskBand(score: number) {
  return score >= 75 ? "critical" : score >= 55 ? "high" : score >= 35 ? "medium" : "low";
}

export function Fleet({
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
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "risk_score", dir: -1 });

  const rows = useMemo(() => {
    const list = [...view.builds];
    list.sort((a, b) => {
      const av = a[sort.key] ?? "";
      const bv = b[sort.key] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
    return list;
  }, [view.builds, sort]);

  const teams = useMemo(
    () => [...new Set(data.builds.map((b: any) => b.team))].sort() as string[],
    [data.builds],
  );
  const statuses = ["healthy", "warning", "blocked"];

  const heat = useMemo(() => {
    const grid: Record<string, Record<string, any[]>> = {};
    for (const t of teams) {
      grid[t] = { healthy: [], warning: [], blocked: [] };
    }
    for (const b of view.builds) grid[b.team]?.[b.status]?.push(b);
    return grid;
  }, [teams, view.builds]);

  const maxCell = Math.max(
    1,
    ...teams.flatMap((t) => statuses.map((s) => heat[t]?.[s]?.length ?? 0)),
  );

  const models = [...new Set(data.builds.map((b: any) => b.model))].sort() as string[];
  const classes = ["PHI", "PII", "internal", "public"];

  return (
    <Section
      id="fleet"
      eyebrow="Fleet"
      title="Every build, every owner"
      lede="Sortable inventory of all AI-generated builds discovered across 3B/Tines, Claude Code, Replit and the GitHub security suite. Click any row for provenance, credentials and audit trail. Click a team or status in the heatmap to filter the whole page."
      right={
        <div className="flex flex-col items-start gap-2 md:items-end">
          <div className="flex flex-wrap gap-1.5">
            {classes.map((c) => (
              <Chip
                key={c}
                color={CLASS_COLOR[c]}
                active={filters.classification.includes(c)}
                onClick={() => toggle("classification", c)}
              >
                {c}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {models.map((m) => (
              <Chip key={m} active={filters.model.includes(m)} onClick={() => toggle("model", m)}>
                {m}
              </Chip>
            ))}
          </div>
        </div>
      }
    >
      <div className="mb-8 overflow-x-auto scroll-thin">
        <table className="w-full min-w-[560px] border-collapse">
          <tbody>
            <tr>
              <td className="w-40 pb-2" />
              {statuses.map((s) => (
                <td key={s} className="pb-2 text-center">
                  <Chip color={STATUS_COLOR[s]} active={filters.status.includes(s)} onClick={() => toggle("status", s)}>
                    {s}
                  </Chip>
                </td>
              ))}
              <td className="pb-2 pl-4 text-right text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">
                PHI / PII
              </td>
            </tr>
            {teams.map((t) => {
              const sensitive = view.builds.filter(
                (b: any) => b.team === t && (b.classification === "PHI" || b.classification === "PII"),
              ).length;
              return (
                <tr key={t} className="border-t border-[var(--color-line)]">
                  <th
                    scope="row"
                    onClick={() => toggle("team", t)}
                    className={`cursor-pointer py-2 pr-3 text-left text-xs font-medium transition-colors ${
                      filters.team.includes(t) ? "text-[var(--color-magenta)]" : "text-[#d6d6dd] hover:text-white"
                    }`}
                  >
                    {t}
                  </th>
                  {statuses.map((s) => {
                    const n = heat[t]?.[s]?.length ?? 0;
                    const alpha = n === 0 ? 0.06 : 0.18 + (n / maxCell) * 0.82;
                    return (
                      <td key={s} className="px-1 py-1.5">
                        <button
                          onClick={() => {
                            toggle("team", t);
                            if (!filters.status.includes(s)) toggle("status", s);
                          }}
                          title={`${t} · ${n} ${s}`}
                          className="num flex h-8 w-full cursor-pointer items-center justify-center text-xs font-semibold text-white/90 transition-transform duration-100 hover:scale-[1.03]"
                          style={{
                            background: `color-mix(in srgb, ${STATUS_COLOR[s]} ${Math.round(alpha * 100)}%, var(--color-ink-2))`,
                          }}
                        >
                          {n || ""}
                        </button>
                      </td>
                    );
                  })}
                  <td className="num pl-4 text-right text-xs text-[var(--color-fog)]">{sensitive}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto scroll-thin border-t border-[var(--color-line)]">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr>
              {HEADERS.map(([key, label, align]) => (
                <th
                  key={key}
                  onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === -1 ? 1 : -1 }))}
                  className={`${align} cursor-pointer border-b border-[var(--color-line)] py-2.5 text-[10px] font-medium tracking-[0.18em] text-[var(--color-fog)] uppercase transition-colors hover:text-white`}
                >
                  {label}
                  {sort.key === key ? <span className="text-[var(--color-magenta)]">{sort.dir === -1 ? " ↓" : " ↑"}</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((b: any) => (
              <tr
                key={b.id}
                onClick={() => apply({ build: b.id })}
                className="cursor-pointer border-b border-[#1c1c23] transition-colors hover:bg-[var(--color-ink-2)]"
              >
                <td className="py-2.5 pr-4">
                  <div className="flex items-center gap-2">
                    <Dot color={STATUS_COLOR[b.status]} />
                    <span className="font-medium text-white">{b.name}</span>
                    <span className="font-mono text-[10px] tracking-wider text-[#6c6c78] uppercase">{b.type}</span>
                  </div>
                </td>
                <td className="pr-4 text-xs text-[#c9c9d2]">{b.team}</td>
                <td className="pr-4 text-xs">
                  {b.owner ?? <span className="text-[var(--color-amber)]">unowned</span>}
                </td>
                <td className="pr-4 font-mono text-[11px] text-[#c9c9d2]">{b.model}</td>
                <td className="pr-4">
                  <span className="text-[11px] font-semibold tracking-wide uppercase" style={{ color: CLASS_COLOR[b.classification] }}>
                    {b.classification}
                  </span>
                </td>
                <td className="num pr-4 text-right">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: riskBand(b.risk_score) === "low" ? "var(--color-fog)" : STATUS_COLOR[b.risk_score >= 55 ? "blocked" : "warning"] }}
                  >
                    {b.risk_score}
                  </span>
                </td>
                <td className="num pr-4 text-right text-xs text-[#c9c9d2]">{nf.format(b.hours_saved_month)}</td>
                <td className="num pr-1 text-right text-xs text-[var(--color-fog)]">{ago(b.last_run)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-[var(--color-fog)]">
                  No builds match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="mt-3 text-xs text-[var(--color-fog)]">
        Showing {rows.length} of {data.builds.length} discovered builds.
      </div>
    </Section>
  );
}

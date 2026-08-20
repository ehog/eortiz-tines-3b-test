import { useEffect } from "react";
import { CLASS_COLOR, Dot, SEV_COLOR, STATUS_COLOR, ago, nf } from "./kit";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-[var(--color-line)] py-3">
      <div className="mb-1 text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">{label}</div>
      <div className="text-sm text-[#e6e6ea]">{children}</div>
    </div>
  );
}

export function Drawer({ data, buildId, close }: { data: any; buildId: string; close: () => void }) {
  const b = data.builds.find((x: any) => x.id === buildId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  if (!b) return null;

  const findings = data.spillage.findings.filter((f: any) => f.build_id === b.id);
  const audit = data.audit.filter((r: any) => r.item_id === `build:${b.id}` || r.note?.includes(b.name));
  const item = data.pipeline.items.find((i: any) => i.id === `build:${b.id}`);
  const failureRate = b.runs_30d ? (b.failures_30d / b.runs_30d) * 100 : 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="flex-1 cursor-default bg-black/60" onClick={close} aria-label="Close detail" />
      <aside className="w-full max-w-xl overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-ink)] p-6 scroll-thin sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.24em] text-[var(--color-fog)] uppercase">
              <Dot color={STATUS_COLOR[b.status]} /> {b.status} · {b.type} · {b.source}
            </div>
            <h3 className="display text-3xl text-white">{b.name}</h3>
          </div>
          <button
            onClick={close}
            className="cursor-pointer border border-[var(--color-line)] px-2 py-1 text-xs text-[var(--color-fog)] hover:border-[var(--color-magenta)] hover:text-white"
          >
            Close
          </button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-x-6">
          <Field label="Owner">{b.owner ?? <span className="text-[var(--color-amber)]">Unowned — accountability gap</span>}</Field>
          <Field label="Team">{b.team}</Field>
          <Field label="Data classification">
            <span style={{ color: CLASS_COLOR[b.classification] }} className="font-semibold">
              {b.classification}
            </span>
          </Field>
          <Field label="Risk score">
            <span className="num">{b.risk_score}/100</span>
          </Field>
        </div>

        <Field label="Run history (30 days)">
          <div className="num flex items-baseline gap-4">
            <span>{nf.format(b.runs_30d)} runs</span>
            <span className={failureRate > 5 ? "text-[var(--color-coral)]" : "text-[var(--color-fog)]"}>
              {nf.format(b.failures_30d)} failures ({failureRate.toFixed(1)}%)
            </span>
          </div>
          <div className="mt-2 text-xs text-[var(--color-fog)]">
            Last run {ago(b.last_run)} · created {new Date(b.created).toLocaleDateString()} · {nf.format(b.hours_saved_month)} hrs saved/mo
          </div>
        </Field>

        <Field label="Credentials referenced">
          <div className="flex flex-wrap gap-1.5">
            {b.credentials.map((c: string) => (
              <span key={c} className="border border-[var(--color-line)] px-2 py-[3px] font-mono text-[11px] text-[#c9c9d2]">
                {c}
              </span>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--color-fog)]">
            Values are held by the connector proxy and injected at request time — build code and the model never
            see them.
          </p>
        </Field>

        <Field label="Network egress">
          <div className="flex flex-wrap gap-1.5">
            {b.egress.map((d: string) => {
              const bad = b.unapproved_egress.includes(d);
              return (
                <span
                  key={d}
                  className="px-2 py-[3px] font-mono text-[11px]"
                  style={{
                    border: `1px solid ${bad ? "var(--color-magenta)" : "var(--color-line)"}`,
                    color: bad ? "var(--color-magenta)" : "#c9c9d2",
                  }}
                >
                  {d}
                  {bad ? " · unapproved" : ""}
                </span>
              );
            })}
          </div>
        </Field>

        <Field label="AI code provenance">
          <div className="num">{b.provenance.ai_written_pct}% machine-written</div>
          <div className="mt-1 text-xs text-[var(--color-fog)]">
            Generated with {b.provenance.generator_model} · human reviewer{" "}
            {b.provenance.human_reviewer ?? <span className="text-[var(--color-amber)]">none recorded</span>}
          </div>
        </Field>

        {findings.length ? (
          <Field label={`Spillage findings (${findings.length})`}>
            <ul className="space-y-2">
              {findings.map((f: any) => (
                <li key={f.id} className="border-l-2 pl-3" style={{ borderColor: SEV_COLOR[f.severity] }}>
                  <div className="text-sm text-white">{f.pattern_label}</div>
                  <div className="font-mono text-[11px] break-all text-[var(--color-fog)]">
                    {f.surface} → {f.evidence}
                  </div>
                </li>
              ))}
            </ul>
          </Field>
        ) : null}

        {item ? (
          <Field label="Governance position">
            {item.lane === "fast-track" ? "Fast-track · " : "Standard · "}
            {item.stage} — {item.next_action}
          </Field>
        ) : null}

        <Field label={`Audit trail (${audit.length})`}>
          {audit.length === 0 ? (
            <span className="text-[var(--color-fog)]">No state changes recorded yet.</span>
          ) : (
            <ol className="space-y-2">
              {audit.slice(0, 12).map((r: any) => (
                <li key={r.seq} className="font-mono text-[11px] text-[#c9c9d2]">
                  <span className="text-[var(--color-fog)]">#{r.seq} {new Date(r.at).toLocaleString()}</span>{" "}
                  {r.actor} · {r.action} · {r.field}: {r.prior_value ?? "—"} → {r.new_value}
                </li>
              ))}
            </ol>
          )}
        </Field>
      </aside>
    </div>
  );
}

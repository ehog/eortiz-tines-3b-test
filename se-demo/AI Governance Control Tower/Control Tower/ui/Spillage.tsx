import { useState } from "react";
import { Caveat, Chip, SEV_COLOR, Section, ago } from "./kit";
import type { Filters } from "./state";

const SEVS = ["critical", "high", "medium", "low"];

export function Spillage({
  data,
  view,
  filters,
  toggle,
  apply,
  act,
}: {
  data: any;
  view: any;
  filters: Filters;
  toggle: (k: any, v: string) => void;
  apply: (f: Partial<Filters>) => void;
  act: (body: Record<string, unknown>) => Promise<any>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const suggestionFor = (findingId: string) => data.suggestions.find((s: any) => s.finding_id === findingId);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setPending(id);
    try {
      await act({ action: "fix_decision", id, decision });
    } finally {
      setPending(null);
    }
  };

  const counts = SEVS.map((s) => [s, data.spillage.findings.filter((f: any) => f.severity === s).length] as const);

  return (
    <Section
      id="spillage"
      eyebrow="Data spillage"
      title="Where data is leaking"
      lede="Every enumerated input, output and run log is scanned against the detection library for PHI, PII, secrets, client-confidential content and egress to unapproved processors. Matches are shown masked."
      right={
        <div className="flex flex-wrap gap-1.5">
          {counts.map(([s, n]) => (
            <Chip key={s} color={SEV_COLOR[s]} active={filters.severity.includes(s)} onClick={() => toggle("severity", s)}>
              {s} {n}
            </Chip>
          ))}
        </div>
      }
    >
      <Caveat>
        {data.spillage.coverage_note} Findings are evidence of exposure that was observed — absence of a finding on a
        build from a partially covered source is not evidence of safety.
      </Caveat>

      <div className="space-y-3">
        {view.findings.map((f: any) => {
          const s = suggestionFor(f.id);
          const busy = pending === s?.id;
          return (
            <article
              key={f.id}
              className="border-l-2 bg-[var(--color-ink-2)] p-4 sm:p-5"
              style={{ borderColor: SEV_COLOR[f.severity] }}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span
                  className="font-mono text-[10px] font-semibold tracking-[0.2em] uppercase"
                  style={{ color: SEV_COLOR[f.severity] }}
                >
                  {f.severity}
                </span>
                <h3 className="text-base font-semibold text-white">{f.pattern_label}</h3>
                <button
                  onClick={() => apply({ build: f.build_id })}
                  className="cursor-pointer text-xs text-[var(--color-violet)] underline decoration-dotted hover:text-white"
                >
                  {f.build_name}
                </button>
                <span className="text-xs text-[var(--color-fog)]">
                  · {f.team} ·{" "}
                  {f.owner ?? <span className="text-[var(--color-amber)]">unowned</span>} · {ago(f.detected_at)}
                </span>
              </div>

              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div>
                  <div className="mb-1 text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">
                    Matched on {f.surface}
                  </div>
                  <code className="block border border-[var(--color-line)] bg-[var(--color-ink)] p-3 font-mono text-[11px] leading-relaxed break-all text-[#e6e6ea]">
                    {f.evidence}
                  </code>
                  <p className="mt-2 text-xs leading-relaxed text-[var(--color-fog)]">{f.rationale}</p>
                </div>

                {s ? (
                  <div className="border border-[var(--color-line)] bg-[var(--color-ink)] p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-[10px] tracking-[0.2em] text-[var(--color-fog)] uppercase">
                        {s.kind} fix · {s.model}
                      </span>
                      <span
                        className="font-mono text-[10px] uppercase"
                        style={{
                          color:
                            s.decision === "approved"
                              ? "var(--color-mint)"
                              : s.decision === "rejected"
                                ? "var(--color-fog)"
                                : "var(--color-amber)",
                        }}
                      >
                        {s.decision}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-white">{s.title}</div>
                    <pre className="mt-2 overflow-x-auto border-l border-[var(--color-line)] pl-2 font-mono text-[11px] leading-[1.5] scroll-thin">
                      {s.diff.map((l: any, i: number) => (
                        <div key={i} style={{ color: l.sign === "-" ? "var(--color-coral)" : "var(--color-mint)" }}>
                          {l.sign} {l.text}
                        </div>
                      ))}
                    </pre>
                    <p className="mt-2 text-xs text-[var(--color-fog)]">
                      {s.rationale} <span className="text-[#d6d6dd]">If ignored: {s.risk_if_ignored}</span>
                    </p>
                    {s.decision === "pending" ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          disabled={busy}
                          onClick={() => decide(s.id, "approved")}
                          className="cursor-pointer bg-[var(--color-magenta)] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-white uppercase transition-opacity hover:opacity-85 disabled:opacity-50"
                        >
                          {busy ? "Recording…" : "Approve fix"}
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => decide(s.id, "rejected")}
                          className="cursor-pointer border border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold tracking-[0.12em] text-[var(--color-fog)] uppercase transition-colors hover:border-[#3a3a46] hover:text-white disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 font-mono text-[11px] text-[var(--color-fog)]">
                        {s.decision} by {s.decided_by} · {new Date(s.decided_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border border-[var(--color-line)] p-3 text-xs text-[var(--color-fog)]">
                    No fix proposed yet — the suggestion step has not run on this finding.
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {view.findings.length === 0 ? (
          <p className="py-8 text-sm text-[var(--color-fog)]">No findings match this filter.</p>
        ) : null}
      </div>
    </Section>
  );
}

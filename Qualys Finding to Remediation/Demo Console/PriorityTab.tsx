import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type ScorePreview } from "./api";
import type { Shell } from "./App";
import { Badge, Button, Card, Empty, FactorBar, bandTone, shortDate } from "./ui";

const WEIGHT_LABELS: Record<string, string> = {
  severity: "Qualys severity",
  cvss: "CVSS base score",
  threat: "Exploitation status (KEV)",
  criticality: "Asset criticality",
  exposure: "Internet exposure",
};

const ORDER = ["severity", "cvss", "threat", "criticality", "exposure"];

export default function PriorityTab({ shell }: { shell: Shell }) {
  const { state, run, notify } = shell;
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [preview, setPreview] = useState<ScorePreview | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state?.weights && weights === null) setWeights({ ...state.weights });
  }, [state?.weights, weights]);

  const refresh = useCallback(
    async (candidate: Record<string, number>) => {
      setLoading(true);
      try {
        setPreview(await api.scorePreview(candidate));
      } catch (err) {
        notify(`Could not re-score: ${(err as Error).message}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [notify],
  );

  useEffect(() => {
    if (!weights) return;
    const timer = window.setTimeout(() => void refresh(weights), 220);
    return () => window.clearTimeout(timer);
  }, [weights, refresh]);

  const total = useMemo(
    () => (weights ? Object.values(weights).reduce((a, b) => a + b, 0) : 100),
    [weights],
  );

  const dirty = useMemo(() => {
    if (!weights || !state) return false;
    return ORDER.some((key) => weights[key] !== state.weights[key]);
  }, [weights, state]);

  const threshold = preview?.high_priority_score ?? state?.high_priority_score ?? 60;

  return (
    <div className="space-y-4">
      <Card
        title="Scoring weights"
        subtitle={`Each factor contributes a share of the weighted total, which is normalised to a 0-100 score. Current total weight ${total}.`}
        actions={
          <>
            <Button
              variant="primary"
              disabled={!dirty}
              busy={shell.busy === "Apply weights"}
              onClick={() =>
                void run("Apply weights", async () => {
                  await api.setWeights(weights!);
                  notify("Weights saved. The next Prioritize run uses them.");
                })
              }
            >
              Apply to pipeline
            </Button>
            <Button
              busy={shell.busy === "Reset weights"}
              onClick={() =>
                void run("Reset weights", async () => {
                  const res = await api.resetWeights();
                  setWeights({ ...res.weights });
                })
              }
            >
              Reset to defaults
            </Button>
          </>
        }
      >
        {!weights ? (
          <Empty>Loading weights…</Empty>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {ORDER.map((key) => (
              <label key={key} className="block">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-semibold">{WEIGHT_LABELS[key]}</span>
                  <span className="text-[12px] tabular-nums text-[var(--text-secondary)]">
                    {weights[key]} pts ·{" "}
                    {total > 0 ? Math.round((weights[key]! / total) * 100) : 0}% of score
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={weights[key]}
                  onChange={(e) => setWeights({ ...weights, [key]: Number(e.target.value) })}
                  className="mt-2 w-full accent-[var(--accent)]"
                />
              </label>
            ))}
            {dirty && (
              <div className="rounded-md border border-[var(--accent)]/30 bg-[var(--accent-soft)] p-3 text-[12px] text-[var(--accent-deep)] md:col-span-2 xl:col-span-1">
                Previewing unsaved weights against the last scored run. Apply them to change what the
                pipeline uses.
              </div>
            )}
          </div>
        )}
      </Card>

      <Card
        title="Scored findings"
        subtitle={
          preview?.source_stage
            ? `Re-scored live from the last ${preview.source_stage} payload. High priority at ${threshold} or above.`
            : "Run the pipeline to score findings."
        }
        actions={loading ? <Badge tone="info">Re-scoring…</Badge> : null}
      >
        {!preview ? (
          <Empty>Loading scores…</Empty>
        ) : preview.findings.length === 0 ? (
          <Empty>No scored findings yet. Run the pipeline from the Pipeline tab.</Empty>
        ) : (
          <div className="space-y-3">
            {preview.findings.map((f) => {
              const delta =
                f.baseline_score === null ? null : f.risk.risk_score - f.baseline_score;
              return (
                <div
                  key={f.finding_id}
                  className="rounded-[10px] border border-[var(--border)] bg-[var(--card-solid)] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{f.finding_id}</span>
                        <Badge tone={bandTone(f.risk.risk_band)}>{f.risk.risk_band}</Badge>
                        {f.risk.high_priority && <Badge tone="info">high priority</Badge>}
                        {f.kev && <Badge tone="critical">KEV</Badge>}
                      </div>
                      <div className="mt-1 text-[13px]">{f.title}</div>
                      <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
                        {f.hostname} · {f.application} · {f.team} · {f.criticality} criticality ·{" "}
                        {f.exposure} exposure · severity {f.severity} · CVSS {f.cvss_base.toFixed(1)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[26px] leading-none font-bold tabular-nums">
                        {f.risk.risk_score}
                      </div>
                      {delta !== null && delta !== 0 && (
                        <div
                          className={`text-[12px] font-semibold tabular-nums ${
                            delta > 0 ? "text-[var(--red)]" : "text-[var(--green)]"
                          }`}
                        >
                          {delta > 0 ? "▲" : "▼"} {Math.abs(delta)} vs pipeline
                        </div>
                      )}
                      <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
                        SLA {f.risk.sla_days}d · due {shortDate(f.risk.sla_due)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <FactorBar factors={f.risk.factors} total={Math.max(1, total)} />
                  </div>

                  <p className="mt-3 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
                    {f.risk.explanation}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Bands and SLA policy" subtitle="Where each score lands and how long the team gets.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(() => {
            const bands = state?.bands ?? { critical: 80, high: 60, medium: 40 };
            const ranges: { band: "critical" | "high" | "medium" | "low"; range: string }[] = [
              { band: "critical", range: `${bands.critical}–100` },
              { band: "high", range: `${bands.high}–${bands.critical! - 1}` },
              { band: "medium", range: `${bands.medium}–${bands.high! - 1}` },
              { band: "low", range: `0–${bands.medium! - 1}` },
            ];
            return ranges.map(({ band, range }) => (
              <div
                key={band}
                className="rounded-[10px] border border-[var(--border)] bg-[var(--card-solid)] p-3"
              >
                <Badge tone={band}>{band}</Badge>
                <div className="mt-2 text-[13px] font-semibold tabular-nums">score {range}</div>
                <div className="mt-1 text-[12px] text-[var(--text-secondary)]">
                  {state?.sla_days[band] ?? "—"} day SLA
                </div>
                {band === "high" && (
                  <div className="mt-1 text-[11.5px] text-[var(--accent-deep)]">
                    AI package threshold
                  </div>
                )}
              </div>
            ));
          })()}
        </div>
      </Card>
    </div>
  );
}

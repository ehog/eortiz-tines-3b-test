import { useEffect, useState } from "react";
import { Button, Card, Field, inputClass } from "./ui";
import type { ConsoleState, GateConfig } from "./api";

const WEIGHT_LABELS: Array<[keyof GateConfig["weights"], string]> = [
  ["severity", "Severity"],
  ["confidence", "Detection confidence"],
  ["assetCriticality", "Asset criticality"],
  ["businessImpact", "Business impact"],
];

export function ConfigPanel({
  state,
  busy,
  onSave,
  onReplay,
}: {
  state: ConsoleState;
  busy: boolean;
  onSave: (config: GateConfig) => void;
  onReplay: () => void;
}) {
  const [draft, setDraft] = useState<GateConfig>(state.config);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setDraft(state.config);
  }, [state.config, dirty]);

  const update = (fn: (c: GateConfig) => GateConfig) => {
    setDirty(true);
    setDraft((current) => fn(structuredClone(current)));
  };

  const weightTotal = WEIGHT_LABELS.reduce((sum, [k]) => sum + draft.weights[k], 0) || 1;
  const lastAlert = state.decisions[0];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card
        className="lg:col-span-2"
        title="Escalation thresholds"
        subtitle="Stored in the workflow volume and read on every alert — nothing here is hardcoded"
        right={
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setDraft(state.defaults);
                setDirty(true);
              }}
            >
              Load defaults
            </Button>
            <Button
              variant="primary"
              disabled={busy || !dirty}
              onClick={() => {
                onSave(draft);
                setDirty(false);
              }}
            >
              {dirty ? "Save changes" : "Saved"}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Page threshold</span>
                <span className="text-sm font-semibold tabular-nums text-rose-300">{draft.pageThreshold}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={draft.pageThreshold}
                onChange={(e) => update((c) => ({ ...c, pageThreshold: Number(e.target.value) }))}
                className="mt-2 w-full accent-rose-400"
              />
              <p className="mt-1 text-[11px] text-slate-500">At or above this score the on-call analyst is paged.</p>
            </div>
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Suppress floor</span>
                <span className="text-sm font-semibold tabular-nums text-slate-300">{draft.suppressBelowScore}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={draft.suppressBelowScore}
                onChange={(e) => update((c) => ({ ...c, suppressBelowScore: Number(e.target.value) }))}
                className="mt-2 w-full accent-slate-400"
              />
              <p className="mt-1 text-[11px] text-slate-500">Below this score the alert is auto-suppressed instead of queued.</p>
            </div>
          </div>

          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Score weights</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {WEIGHT_LABELS.map(([key, label]) => (
                <div key={key}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-slate-300">{label}</span>
                    <span className="text-[11px] tabular-nums text-slate-400">
                      {draft.weights[key].toFixed(2)} · {Math.round((draft.weights[key] / weightTotal) * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={draft.weights[key]}
                    onChange={(e) => update((c) => ({ ...c, weights: { ...c.weights, [key]: Number(e.target.value) } }))}
                    className="mt-1 w-full accent-sky-400"
                  />
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Weights are normalised, so they do not have to add up to 1.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="After-hours starts (ET)">
              <input
                type="number"
                min={0}
                max={23}
                className={inputClass}
                value={draft.afterHours.startHour}
                onChange={(e) => update((c) => ({ ...c, afterHours: { ...c.afterHours, startHour: Number(e.target.value) } }))}
              />
            </Field>
            <Field label="After-hours ends (ET)">
              <input
                type="number"
                min={0}
                max={23}
                className={inputClass}
                value={draft.afterHours.endHour}
                onChange={(e) => update((c) => ({ ...c, afterHours: { ...c.afterHours, endHour: Number(e.target.value) } }))}
              />
            </Field>
            <Field label="Weekends">
              <select
                className={inputClass}
                value={draft.afterHours.weekendsAlwaysAfterHours ? "yes" : "no"}
                onChange={(e) =>
                  update((c) => ({ ...c, afterHours: { ...c.afterHours, weekendsAlwaysAfterHours: e.target.value === "yes" } }))
                }
              >
                <option value="yes">Always after-hours</option>
                <option value="no">Follow the hour window</option>
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["severityScores", "Severity scores"],
                ["confidenceScores", "Confidence scores"],
                ["assetTierScores", "Asset tier scores"],
                ["businessImpactScores", "Business impact scores"],
              ] as const
            ).map(([group, label]) => (
              <div key={group} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <h4 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</h4>
                <div className="mt-2 space-y-2">
                  {Object.entries(draft[group]).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <span className="flex-1 truncate text-xs text-slate-300">{key.replace(/_/g, " ")}</span>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={value as number}
                        onChange={(e) =>
                          update((c) => ({ ...c, [group]: { ...(c[group] as Record<string, number>), [key]: Number(e.target.value) } }))
                        }
                        className="w-16 rounded-lg border border-slate-700 bg-slate-950/70 px-2 py-1 text-right text-xs tabular-nums text-slate-100 outline-none focus:border-sky-500"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="Prove it is live" subtitle="Re-score the newest alert with the saved config">
          {lastAlert ? (
            <div className="space-y-2 text-xs text-slate-400">
              <p className="text-slate-200">{lastAlert.alert.title}</p>
              <p>
                Last scored {lastAlert.score} against threshold {lastAlert.threshold} → {lastAlert.decision.replace(/_/g, " ")}
              </p>
              <Button variant="primary" disabled={busy} onClick={onReplay}>
                Replay with current config
              </Button>
              <p className="text-[11px] text-slate-500">
                The replay writes a new audit entry marked as a replay, and pages if the new score crosses the threshold.
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Send an alert first, then replay it here after changing the threshold.</p>
          )}
        </Card>

        <Card title="Delivery and digest" subtitle="Where pages and digests go">
          <div className="space-y-3">
            <Field label="Slack channel">
              <input
                className={inputClass}
                value={draft.delivery.slackChannel}
                onChange={(e) => update((c) => ({ ...c, delivery: { ...c.delivery, slackChannel: e.target.value } }))}
              />
            </Field>
            <Field label="Digest email recipient">
              <input
                className={inputClass}
                value={draft.delivery.emailTo}
                onChange={(e) => update((c) => ({ ...c, delivery: { ...c.delivery, emailTo: e.target.value } }))}
              />
            </Field>
            <Field label="On-call name">
              <input
                className={inputClass}
                value={draft.delivery.onCallName}
                onChange={(e) => update((c) => ({ ...c, delivery: { ...c.delivery, onCallName: e.target.value } }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Digest lookback (h)">
                <input
                  type="number"
                  min={1}
                  max={48}
                  className={inputClass}
                  value={draft.digest.lookbackHours}
                  onChange={(e) => update((c) => ({ ...c, digest: { ...c.digest, lookbackHours: Number(e.target.value) } }))}
                />
              </Field>
              <Field label="Digest model">
                <input
                  className={inputClass}
                  value={draft.digest.model}
                  onChange={(e) => update((c) => ({ ...c, digest: { ...c.digest, model: e.target.value } }))}
                />
              </Field>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

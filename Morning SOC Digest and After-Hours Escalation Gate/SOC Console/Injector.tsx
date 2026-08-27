import { useState } from "react";
import { Button, Card, Field, inputClass, ScoreBar, DecisionTag, Empty } from "./ui";
import { etTime, relative, type ConsoleState, type Severity } from "./api";

const SOURCES = ["sentinel", "defender", "servicenow", "proofpoint", "zscaler"];
const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
const CONFIDENCES = ["confirmed", "high", "medium", "low"];
const IMPACTS = ["revenue_impacting", "customer_data", "internal_only", "none"];

export function Injector({
  state,
  now,
  busy,
  onScenario,
  onCustom,
}: {
  state: ConsoleState;
  now: Date;
  busy: boolean;
  onScenario: (id: string) => void;
  onCustom: (alert: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    source: "sentinel",
    title: "Suspicious sign-in followed by mailbox export",
    severity: "high" as Severity,
    confidence: "high",
    user: "dana.reyes",
    hostname: "pay-db-01",
    indicator: "203.0.113.42",
    businessImpact: "customer_data",
    description: "Manually injected alert from the demo console.",
  });

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  const recent = state.decisions.slice(0, 8);

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="space-y-4 lg:col-span-3">
        <Card title="Scenario packs" subtitle="One click sends vendor-shaped alerts through the real gate chain">
          <div className="grid gap-3 sm:grid-cols-2">
            {state.scenarios.map((s) => (
              <div key={s.id} className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <span className="text-xs font-semibold text-slate-100">{s.name}</span>
                <p className="mt-1 flex-1 text-[11px] leading-relaxed text-slate-500">{s.description}</p>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-slate-600">{s.alertCount} alert(s)</span>
                  <Button variant="primary" disabled={busy} onClick={() => onScenario(s.id)}>
                    Send
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Custom alert" subtitle="Posts to /api/test-alert, exactly like the production webhook">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Source">
              <select className={inputClass} value={form.source} onChange={set("source")}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Severity">
              <select className={inputClass} value={form.severity} onChange={set("severity")}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Detection confidence">
              <select className={inputClass} value={form.confidence} onChange={set("confidence")}>
                {CONFIDENCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Business impact">
              <select className={inputClass} value={form.businessImpact} onChange={set("businessImpact")}>
                {IMPACTS.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Host" hint="Matching a CMDB hostname raises the asset criticality factor">
              <input className={inputClass} value={form.hostname} onChange={set("hostname")} list="cmdb-hosts" />
              <datalist id="cmdb-hosts">
                {state.assets.map((a) => (
                  <option key={a.hostname} value={a.hostname} />
                ))}
              </datalist>
            </Field>
            <Field label="User">
              <input className={inputClass} value={form.user} onChange={set("user")} />
            </Field>
            <Field label="Indicator">
              <input className={inputClass} value={form.indicator} onChange={set("indicator")} />
            </Field>
            <Field label="Title">
              <input className={inputClass} value={form.title} onChange={set("title")} />
            </Field>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <Button variant="primary" disabled={busy} onClick={() => onCustom({ ...form, id: `demo-${Date.now()}` })}>
              Send alert to the gate
            </Button>
            <span className="text-[11px] text-slate-500">
              Clock mode <span className="text-slate-300">{state.clockMode.replace(/_/g, " ")}</span> · threshold{" "}
              <span className="text-slate-300">{state.config.pageThreshold}</span>
            </span>
          </div>
        </Card>
      </div>

      <Card className="lg:col-span-2" title="Live results" subtitle="Decisions appear within a few seconds">
        {recent.length === 0 ? (
          <Empty>Send a scenario to see the gate decide.</Empty>
        ) : (
          <ul className="max-h-[36rem] space-y-3 overflow-y-auto pr-1">
            {recent.map((d) => (
              <li key={d.alertId} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-xs text-slate-100">{d.alert.title}</span>
                  <DecisionTag decision={d.decision} />
                </div>
                <div className="mt-2">
                  <ScoreBar score={d.score} threshold={d.threshold} />
                  <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                    <span>
                      score {d.score} · threshold {d.threshold}
                    </span>
                    <span>
                      {etTime(d.decidedAt)} · {relative(d.decidedAt, now)}
                    </span>
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">{d.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

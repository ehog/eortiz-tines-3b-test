import { useState } from "react";
import { Button, Card, Empty, Field, inputClass, TierTag } from "./ui";
import type { Asset, ConsoleState } from "./api";

const TIERS = ["tier0", "tier1", "tier2", "tier3"];
const IMPACTS = ["revenue_impacting", "customer_data", "internal_only", "none"];

const BLANK: Asset = { hostname: "", tier: "tier1", owner: "", businessService: "", businessImpact: "internal_only", notes: "" };

export function Assets({
  state,
  busy,
  onSave,
  onDelete,
}: {
  state: ConsoleState;
  busy: boolean;
  onSave: (asset: Asset) => void;
  onDelete: (hostname: string) => void;
}) {
  const [draft, setDraft] = useState<Asset>(BLANK);
  const set = (key: keyof Asset) => (e: { target: { value: string } }) => setDraft({ ...draft, [key]: e.target.value });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card
        className="lg:col-span-2"
        title="Critical assets (mock ServiceNow CMDB)"
        subtitle="The gate looks the alert host up here; tier and business impact feed the score immediately"
      >
        {state.assets.length === 0 ? (
          <Empty>No assets. Add one to give the gate asset context.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-medium">Hostname</th>
                  <th className="py-2 pr-3 font-medium">Tier</th>
                  <th className="py-2 pr-3 font-medium">Business service</th>
                  <th className="py-2 pr-3 font-medium">Owner</th>
                  <th className="py-2 pr-3 font-medium">Impact</th>
                  <th className="py-2 pr-3 font-medium">Score</th>
                  <th className="py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {state.assets.map((a) => (
                  <tr key={a.hostname} className="border-b border-slate-800/60 last:border-0">
                    <td className="py-2 pr-3 font-mono text-slate-200">{a.hostname}</td>
                    <td className="py-2 pr-3">
                      <TierTag tier={a.tier} />
                    </td>
                    <td className="py-2 pr-3 text-slate-300">{a.businessService}</td>
                    <td className="py-2 pr-3 text-slate-400">{a.owner}</td>
                    <td className="py-2 pr-3 text-slate-400">{a.businessImpact.replace(/_/g, " ")}</td>
                    <td className="py-2 pr-3 tabular-nums text-slate-400">{state.config.assetTierScores[a.tier] ?? "—"}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" onClick={() => setDraft(a)}>
                          Edit
                        </Button>
                        <Button variant="ghost" disabled={busy} onClick={() => onDelete(a.hostname)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-500">
          Unknown hosts score {state.config.assetTierScores.unknown} on the asset factor, so removing a host here visibly lowers its alerts.
        </p>
      </Card>

      <Card dataTour="assets-editor" title={draft.hostname ? `Edit ${draft.hostname}` : "Add an asset"} subtitle="Saved straight to the workflow volume">
        <div className="space-y-3">
          <Field label="Hostname">
            <input className={inputClass} value={draft.hostname} onChange={set("hostname")} placeholder="pay-db-02" />
          </Field>
          <Field label="Tier">
            <select className={inputClass} value={draft.tier} onChange={set("tier")}>
              {TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Business service">
            <input className={inputClass} value={draft.businessService} onChange={set("businessService")} placeholder="Card authorization" />
          </Field>
          <Field label="Owner">
            <input className={inputClass} value={draft.owner} onChange={set("owner")} placeholder="Payments Platform" />
          </Field>
          <Field label="Business impact">
            <select className={inputClass} value={draft.businessImpact} onChange={set("businessImpact")}>
              {IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {i.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <input className={inputClass} value={draft.notes} onChange={set("notes")} placeholder="PCI zone" />
          </Field>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy || !draft.hostname.trim()}
              onClick={() => {
                onSave(draft);
                setDraft(BLANK);
              }}
            >
              Save asset
            </Button>
            <Button onClick={() => setDraft(BLANK)}>Clear</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

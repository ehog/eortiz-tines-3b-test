import { Fragment, useCallback, useEffect, useState } from "react";
import { api, type OwnerEntry, type QualysDetection } from "./api";
import type { Shell } from "./App";
import { Badge, Button, Card, CodeBlock, Empty, Table, shortTime } from "./ui";

const PRESETS = [
  { key: "windows_patch", label: "Windows patch (KEV)" },
  { key: "third_party_library", label: "Third-party library CVE" },
  { key: "code_sqli", label: "Code-level SQL injection" },
  { key: "thin_evidence", label: "Thin-evidence finding" },
];

const EXPOSURES = ["internet", "dmz", "internal", "isolated"];

function severityTone(severity: number): string {
  if (severity >= 5) return "critical";
  if (severity === 4) return "high";
  if (severity === 3) return "medium";
  return "low";
}

function ownerFor(
  detection: QualysDetection,
  owners: Record<string, OwnerEntry>,
  fallback: OwnerEntry,
) {
  const entry = owners[detection.ASSET.HOSTNAME] ?? owners[detection.ASSET.HOSTNAME.toUpperCase()];
  const base = entry ?? fallback;
  return {
    team: base.team,
    application: base.application,
    criticality: base.criticality,
    exposure: detection.ASSET.EXPOSURE_OVERRIDE ?? base.exposure,
    owned: entry !== undefined,
  };
}

const FALLBACK_OWNER: OwnerEntry = {
  application: "Unattributed Assets",
  team: "Security Operations",
  assignment_group: "CAB-Security-Operations",
  owner_email: "secops@acme-demo.com",
  criticality: "medium",
  exposure: "internal",
  environment: "unknown",
};

export default function FindingsTab({ shell }: { shell: Shell }) {
  const { run, notify } = shell;
  const [detections, setDetections] = useState<QualysDetection[] | null>(null);
  const [ownerMap, setOwnerMap] = useState<Record<string, OwnerEntry>>({});
  const [fallback, setFallback] = useState<OwnerEntry>(FALLBACK_OWNER);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, owners] = await Promise.all([api.detections(), api.owners()]);
    setDetections(list.data);
    setOwnerMap(owners.owners);
    setFallback(owners.fallback);
  }, []);

  useEffect(() => {
    void load().catch((err) => notify(`Could not load findings: ${(err as Error).message}`, "error"));
  }, [load, notify]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    const ok = await run(label, async () => {
      await fn();
      await load();
    });
    if (ok) notify(`${label} done.`);
  };

  return (
    <div className="space-y-4">
      <Card anchorId="findings-inject"
        title="Inject a Qualys detection"
        subtitle="Each preset clones a canonical finding as a fresh Active detection, so the next pipeline run picks it up."
        actions={
          <Button variant="ghost" onClick={() => void load()}>
            Refresh
          </Button>
        }
      >
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <Button
              key={preset.key}
              variant="primary"
              busy={shell.busy === `Inject ${preset.label}`}
              onClick={() =>
                void act(`Inject ${preset.label}`, () => api.injectDetection(preset.key))
              }
            >
              + {preset.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card anchorId="findings-table"
        title={`Qualys detections${detections ? ` (${detections.length})` : ""}`}
        subtitle="Simulated from Qualys VMDR. Edit severity, KEV or exposure and re-run the pipeline to watch the risk score move."
      >
        {!detections ? (
          <Empty>Loading detections…</Empty>
        ) : detections.length === 0 ? (
          <Empty>No detections. Use Reset demo in the header to reseed the canonical set.</Empty>
        ) : (
          <Table
            head={[
              "Detection",
              "QID / CVE",
              "Sev",
              "CVSS",
              "Threat",
              "Asset",
              "Owner",
              "Exposure",
              "Status",
              "Last found",
              "",
            ]}
          >
            {detections.map((d) => {
              const owner = ownerFor(d, ownerMap, fallback);
              const isOpen = expanded === d.ID;
              return (
                <Fragment key={d.ID}>
                  <tr className="border-b border-[var(--divider)] align-top hover:bg-[var(--table-hover-bg)]">
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="text-left font-semibold text-[var(--accent-deep)] hover:underline"
                        onClick={() => setExpanded(isOpen ? null : d.ID)}
                      >
                        {d.ID}
                      </button>
                      <div className="max-w-[320px] text-[12px] text-[var(--text-secondary)]">
                        {d.TITLE}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      <div className="tabular-nums">{d.QID}</div>
                      <div className="text-[var(--text-secondary)]">
                        {d.CVE_LIST.length ? d.CVE_LIST.join(", ") : "no CVE"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={severityTone(d.SEVERITY)}>{d.SEVERITY}</Badge>
                    </td>
                    <td className="px-3 py-2 tabular-nums">{d.CVSS.BASE.toFixed(1)}</td>
                    <td className="px-3 py-2">
                      {d.THREAT_INTEL.KNOWN_EXPLOITED ? (
                        <Badge tone="critical">KEV</Badge>
                      ) : d.THREAT_INTEL.EXPLOIT_IN_THE_WILD ? (
                        <Badge tone="high">In the wild</Badge>
                      ) : (
                        <span className="text-[12px] text-[var(--text-muted)]">none</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      <div className="font-semibold">{d.ASSET.HOSTNAME}</div>
                      <div className="max-w-[210px] text-[var(--text-secondary)]">{d.ASSET.OS}</div>
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      <div>{owner.team}</div>
                      <div className="text-[var(--text-secondary)]">
                        {owner.application}
                        {!owner.owned && " (unowned)"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={owner.exposure === "internet" ? "critical" : "neutral"}>
                        {owner.exposure}
                      </Badge>
                      {d.ASSET.EXPOSURE_OVERRIDE && (
                        <div className="mt-1 text-[11px] text-[var(--text-muted)]">overridden</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={d.STATUS === "Fixed" ? "success" : d.STATUS === "Re-Opened" ? "high" : "neutral"}>
                        {d.STATUS}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-[12px] whitespace-nowrap text-[var(--text-secondary)]">
                      {shortTime(d.LAST_FOUND_DATETIME)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col items-end gap-1">
                        <Button variant="ghost" onClick={() => setEditing(editing === d.ID ? null : d.ID)}>
                          Edit
                        </Button>
                        {d.STATUS !== "Fixed" && (
                          <Button
                            variant="ghost"
                            busy={shell.busy === `Mark ${d.ID} remediated`}
                            onClick={() =>
                              void act(`Mark ${d.ID} remediated`, () => api.remediateDetection(d.ID))
                            }
                          >
                            Remediated
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {editing === d.ID && (
                    <tr key={`${d.ID}-edit`} className="border-b border-[var(--divider)] bg-[var(--table-header-bg)]">
                      <td colSpan={11} className="px-3 py-3">
                        <EditRow
                          detection={d}
                          busy={shell.busy === `Update ${d.ID}`}
                          onSave={(body) =>
                            void act(`Update ${d.ID}`, () =>
                              api.editDetection({ id: d.ID, ...body }),
                            ).then(() => setEditing(null))
                          }
                        />
                      </td>
                    </tr>
                  )}

                  {isOpen && (
                    <tr key={`${d.ID}-evidence`} className="border-b border-[var(--divider)]">
                      <td colSpan={11} className="px-3 py-3">
                        <div className="grid gap-3 lg:grid-cols-[1fr_360px]">
                          <CodeBlock
                            code={d.RESULTS || "(no evidence returned)"}
                            label="Qualys RESULTS evidence"
                          />
                          <div className="space-y-3">
                            <div className="rounded-md border border-[var(--border)] bg-[var(--card-solid)] p-3 text-[12px]">
                              <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
                                Affected software
                              </div>
                              {Object.entries(d.SOFTWARE).map(([key, value]) => (
                                <div key={key} className="flex justify-between gap-3 py-0.5">
                                  <span className="text-[var(--text-secondary)]">{key}</span>
                                  <span className="text-right font-medium">
                                    {value === null ? "—" : String(value)}
                                  </span>
                                </div>
                              ))}
                              <div className="mt-2 flex justify-between gap-3 border-t border-[var(--divider)] pt-2">
                                <span className="text-[var(--text-secondary)]">detection type</span>
                                <span className="font-medium">{d.TYPE}</span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-[var(--text-secondary)]">finding type</span>
                                <span className="font-medium">{d.FINDING_TYPE}</span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-[var(--text-secondary)]">times detected</span>
                                <span className="font-medium tabular-nums">{d.TIMES_DETECTED}</span>
                              </div>
                              <div className="flex justify-between gap-3">
                                <span className="text-[var(--text-secondary)]">first found</span>
                                <span className="font-medium">{shortTime(d.FIRST_FOUND_DATETIME)}</span>
                              </div>
                            </div>
                            <div className="rounded-md border border-[var(--border)] bg-[var(--card-solid)] p-3 text-[12px]">
                              <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)] uppercase">
                                Qualys solution text
                              </div>
                              {d.SOLUTION || "(none supplied)"}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {d.ASSET.TAGS.map((tag) => (
                                <Badge key={tag} tone="teal">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}

function EditRow({
  detection,
  busy,
  onSave,
}: {
  detection: QualysDetection;
  busy: boolean;
  onSave: (body: Record<string, unknown>) => void;
}) {
  const [severity, setSeverity] = useState(detection.SEVERITY);
  const [cvss, setCvss] = useState(detection.CVSS.BASE);
  const [kev, setKev] = useState(detection.THREAT_INTEL.KNOWN_EXPLOITED);
  const [wild, setWild] = useState(detection.THREAT_INTEL.EXPLOIT_IN_THE_WILD);
  const [exposure, setExposure] = useState(detection.ASSET.EXPOSURE_OVERRIDE ?? "");

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="text-[12px]">
        <span className="block font-semibold text-[var(--text-secondary)]">Severity</span>
        <select
          value={severity}
          onChange={(e) => setSeverity(Number(e.target.value))}
          className="mt-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1"
        >
          {[1, 2, 3, 4, 5].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="text-[12px]">
        <span className="block font-semibold text-[var(--text-secondary)]">CVSS base</span>
        <input
          type="number"
          min={0}
          max={10}
          step={0.1}
          value={cvss}
          onChange={(e) => setCvss(Number(e.target.value))}
          className="mt-1 w-20 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 tabular-nums"
        />
      </label>

      <label className="flex items-center gap-2 text-[12px] font-semibold">
        <input type="checkbox" checked={kev} onChange={(e) => setKev(e.target.checked)} />
        On CISA KEV
      </label>

      <label className="flex items-center gap-2 text-[12px] font-semibold">
        <input type="checkbox" checked={wild} onChange={(e) => setWild(e.target.checked)} />
        Exploited in the wild
      </label>

      <label className="text-[12px]">
        <span className="block font-semibold text-[var(--text-secondary)]">Exposure override</span>
        <select
          value={exposure}
          onChange={(e) => setExposure(e.target.value)}
          className="mt-1 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1"
        >
          <option value="">use asset owner lookup</option>
          {EXPOSURES.map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
      </label>

      <Button
        variant="primary"
        busy={busy}
        onClick={() =>
          onSave({
            severity,
            cvss_base: cvss,
            kev,
            exploit_in_wild: wild,
            exposure_override: exposure === "" ? null : exposure,
          })
        }
      >
        Save detection
      </Button>
      <span className="text-[11.5px] text-[var(--text-secondary)]">
        Editing a detection changes its fingerprint, so the next pull treats it as updated.
      </span>
    </div>
  );
}

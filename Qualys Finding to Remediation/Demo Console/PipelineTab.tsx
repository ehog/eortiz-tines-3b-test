import { useEffect, useRef, useState } from "react";
import { api, type StageStatus } from "./api";
import type { Shell } from "./App";
import { Badge, Button, Card, Empty, Json, Table, shortTime } from "./ui";

const STAGE_LABELS: Record<string, { label: string; blurb: string }> = {
  pull: { label: "Pull", blurb: "Fetch new or changed Qualys detections" },
  normalize: { label: "Normalize & group", blurb: "Canonical schema, owner lookup, team grouping" },
  prioritize: { label: "Prioritize", blurb: "Weighted risk score, band, SLA, explanation" },
  remediate: { label: "AI remediation", blurb: "Structured package per high-priority finding" },
  sync: { label: "ServiceNow sync", blurb: "One batched change per owning team" },
  chase: { label: "Overdue chase", blurb: "Escalate changes past their SLA date" },
  report: { label: "Report", blurb: "Rolling progress metrics and Markdown" },
};

const PIPELINE_STAGES = ["pull", "normalize", "prioritize", "remediate", "sync"];

const WEBHOOK_SAMPLE = {
  ID: "DET-PUSH-01",
  QID: 91234,
  TYPE: "Confirmed",
  TITLE: "Microsoft Exchange Server Remote Code Execution Vulnerability (KB5042461) Missing",
  CATEGORY: "Windows",
  VULN_CLASS: "Missing Patch",
  SEVERITY: 5,
  CVSS: { BASE: 9.1, TEMPORAL: 8.6, VECTOR: "CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H" },
  CVE_LIST: ["CVE-2024-21410"],
  THREAT_INTEL: {
    KNOWN_EXPLOITED: true,
    EXPLOIT_IN_THE_WILD: true,
    CISA_KEV_DUE_DATE: "2024-02-29",
  },
  PATCH_AVAILABLE: true,
  STATUS: "Active",
  FINDING_TYPE: "missing_patch",
  ASSET: {
    ASSET_ID: "a-push01",
    HOSTNAME: "WEB-DMZ-01",
    IP: "203.0.113.24",
    OS: "Windows Server 2022 Datacenter 21H2 (Build 20348.2402)",
    TAGS: ["DMZ", "Internet-Facing", "Prod"],
  },
  SOFTWARE: {
    product: "Microsoft Exchange Server 2019",
    installed_version: "15.02.1258.012",
    fixed_version: "15.02.1544.004",
  },
  RESULTS:
    "Pushed by Qualys webhook.\n\nExchange build check:\n  Get-ExchangeServer | Select AdminDisplayVersion -> 15.02.1258.012 (CU13)\n  Required build for CVE-2024-21410 mitigation: 15.02.1544.004 (CU14)\n\nExtended Protection state:\n  Get-ExchangeSetting ExtendedProtection -> None (NTLM relay possible)\n\nOWA endpoint https://203.0.113.24/owa reachable from the internet edge ACL.",
  SOLUTION:
    "Install Exchange Server 2019 Cumulative Update 14 (CU14) and enable Extended Protection per Microsoft guidance for CVE-2024-21410.",
  FIRST_FOUND_DATETIME: new Date().toISOString(),
  LAST_FOUND_DATETIME: new Date().toISOString(),
  LAST_UPDATE_DATETIME: new Date().toISOString(),
  TIMES_DETECTED: 1,
};

function statusTone(status: string): string {
  if (status === "success") return "success";
  if (status === "error") return "critical";
  if (status === "skipped") return "medium";
  return "neutral";
}

export default function PipelineTab({ shell }: { shell: Shell }) {
  const { state, run, notify, refreshState } = shell;
  const [selected, setSelected] = useState<string>("prioritize");
  const [payload, setPayload] = useState<unknown>(null);
  const [payloadFor, setPayloadFor] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const [externalId, setExternalId] = useState(
    () => window.localStorage.getItem("qfr.webhook.external_id") ?? "",
  );
  const pollDeadline = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api
      .stagePayload(selected)
      .then((res) => {
        if (!cancelled) {
          setPayload(res.payload);
          setPayloadFor(selected);
        }
      })
      .catch((err) => notify(`Could not load ${selected} payload: ${(err as Error).message}`, "error"));
    return () => {
      cancelled = true;
    };
  }, [selected, notify, state?.stages]);

  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => {
      if (Date.now() > pollDeadline.current) {
        setPolling(false);
        return;
      }
      void refreshState();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [polling, refreshState]);

  // The pipeline runs asynchronously across steps, so stop polling once the last
  // stage of the chain reports the run that the trigger started.
  useEffect(() => {
    if (!polling || !state) return;
    const sync = state.stages.find((s) => s.stage === "sync");
    const pull = state.stages.find((s) => s.stage === "pull");
    if (pull?.status === "skipped") {
      setPolling(false);
      notify("Pull found no new or changed detections, so no downstream stage ran.");
      return;
    }
    if (sync?.run_id && pull?.run_id && sync.run_id === pull.run_id && sync.status !== "never_run") {
      setPolling(false);
      notify(`Pipeline finished: ${sync.summary}`);
    }
    const failed = state.stages.find((s) => s.status === "error" && s.run_id === pull?.run_id);
    if (failed) {
      setPolling(false);
      notify(`Stage ${failed.stage} failed: ${failed.summary}`, "error");
    }
  }, [polling, state, notify]);

  const startPipeline = async () => {
    const ok = await run("Run full pipeline", () => api.runPipeline());
    if (ok) {
      pollDeadline.current = Date.now() + 150_000;
      setPolling(true);
      notify("Pipeline started. Watching stages — the AI stage takes about 20 seconds.");
    }
  };

  const runSingle = async (stage: string) => {
    const ok = await run(`Run ${stage}`, () =>
      stage === "chase"
        ? api.runChase()
        : stage === "report"
          ? api.runReport()
          : stage === "pull"
            ? api.runIncrementalPull()
            : api.runStage(stage),
    );
    if (ok) {
      setSelected(stage);
      notify(`Stage ${stage} ran on its own; downstream steps were not triggered.`);
    }
  };

  const pushWebhook = async () => {
    const ok = await run("Simulate webhook push", async () => {
      window.localStorage.setItem("qfr.webhook.external_id", externalId);
      await api.pushWebhook(externalId, {
        ...WEBHOOK_SAMPLE,
        ID: `DET-PUSH-${Date.now().toString().slice(-5)}`,
      });
    });
    if (ok) {
      pollDeadline.current = Date.now() + 150_000;
      setPolling(true);
      notify("Webhook accepted the pushed detection; the pipeline is running from Normalize.");
    }
  };

  const stages = state?.stages ?? [];

  return (
    <div className="space-y-4">
      <Card
        title="Run the pipeline"
        subtitle="Full run forces a pull so every open detection flows through, even if nothing changed in Qualys."
        actions={
          polling ? (
            <Badge tone="info">
              <span className="size-2 animate-pulse rounded-full bg-[var(--accent)]" /> Run in
              progress
            </Badge>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={shell.busy === "Run full pipeline"} onClick={startPipeline}>
            Run full pipeline
          </Button>
          <Button busy={shell.busy === "Run pull"} onClick={() => void runSingle("pull")}>
            Incremental pull only
          </Button>
          <Button busy={shell.busy === "Run chase"} onClick={() => void runSingle("chase")}>
            Run overdue chase
          </Button>
          <Button busy={shell.busy === "Run report"} onClick={() => void runSingle("report")}>
            Regenerate report
          </Button>
          <span className="text-[12px] text-[var(--text-secondary)]">
            Last pull {shortTime(state?.last_pull_at)}
          </span>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-5">
        {PIPELINE_STAGES.map((stage, index) => {
          const record = stages.find((s) => s.stage === stage);
          const active = selected === stage;
          return (
            <button
              key={stage}
              type="button"
              onClick={() => setSelected(stage)}
              className={`rounded-[10px] border p-3 text-left transition-colors ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--border)] bg-[var(--card-bg)] hover:bg-[var(--table-hover-bg)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[var(--text-muted)]">
                  {index + 1}
                </span>
                <Badge tone={statusTone(record?.status ?? "never_run")}>
                  {record?.status ?? "never run"}
                </Badge>
              </div>
              <div className="mt-1.5 text-[13px] font-semibold">{STAGE_LABELS[stage]!.label}</div>
              <div className="mt-1 text-[11.5px] text-[var(--text-secondary)]">
                {STAGE_LABELS[stage]!.blurb}
              </div>
              <div className="mt-2 flex items-center gap-2 text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                <span>{record?.record_count ?? "—"} records</span>
                <span>·</span>
                <span>{record?.duration_ms !== null && record?.duration_ms !== undefined ? `${record.duration_ms} ms` : "—"}</span>
              </div>
            </button>
          );
        })}
      </div>

      <Card
        title={`${STAGE_LABELS[selected]?.label ?? selected} output`}
        subtitle={stages.find((s) => s.stage === selected)?.summary}
        actions={
          <>
            <Button
              busy={shell.busy === `Run ${selected}`}
              onClick={() => void runSingle(selected)}
              variant="secondary"
            >
              Run this stage only
            </Button>
          </>
        }
      >
        {payloadFor !== selected ? (
          <Empty>Loading stage payload…</Empty>
        ) : payload === null ? (
          <Empty>This stage has no recorded output yet. Run the pipeline to populate it.</Empty>
        ) : (
          <Json value={payload} />
        )}
      </Card>

      <Card
        title="Simulate a Qualys webhook push"
        subtitle="Posts a pushed detection to the workflow's webhook route, which feeds the same normalization step as the scheduled pull."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px]">
            <span className="block font-semibold text-[var(--text-secondary)]">
              Route external ID
            </span>
            <input
              value={externalId}
              onChange={(e) => setExternalId(e.target.value)}
              placeholder="only needed once published"
              className="mt-1 w-72 rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2 py-1 font-mono text-[12px]"
            />
          </label>
          <Button variant="primary" busy={shell.busy === "Simulate webhook push"} onClick={pushWebhook}>
            Push detection
          </Button>
        </div>
        <p className="mt-3 text-[12px] text-[var(--text-secondary)]">
          On a draft branch the webhook route is still space-private, so this works with your session
          and no external ID. Once published, copy the route's external ID from the workflow's Links
          page and paste it here.
        </p>
      </Card>

      <Card title="Recent stage runs" subtitle="Newest first, across every run of this branch.">
        {!state || state.history.length === 0 ? (
          <Empty>No stage runs recorded yet.</Empty>
        ) : (
          <Table head={["Started", "Stage", "Trigger", "Status", "Records", "Duration", "Summary"]}>
            {state.history.map((row) => (
              <tr key={row.id} className="border-b border-[var(--divider)] hover:bg-[var(--table-hover-bg)]">
                <td className="px-3 py-2 whitespace-nowrap text-[12px] text-[var(--text-secondary)]">
                  {shortTime(row.started_at)}
                </td>
                <td className="px-3 py-2 font-semibold">{STAGE_LABELS[row.stage]?.label ?? row.stage}</td>
                <td className="px-3 py-2 text-[12px]">{row.trigger}</td>
                <td className="px-3 py-2">
                  <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.record_count}</td>
                <td className="px-3 py-2 tabular-nums">{row.duration_ms} ms</td>
                <td className="px-3 py-2 text-[12px] text-[var(--text-secondary)]">{row.summary}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Stage detail" subtitle="Every stage the console tracks, including the scheduled ones.">
        <Table head={["Stage", "Status", "Run", "Trigger", "Finished", "Summary", ""]}>
          {stages.map((s: StageStatus) => (
            <tr key={s.stage} className="border-b border-[var(--divider)] hover:bg-[var(--table-hover-bg)]">
              <td className="px-3 py-2 font-semibold">{STAGE_LABELS[s.stage]?.label ?? s.stage}</td>
              <td className="px-3 py-2">
                <Badge tone={statusTone(s.status)}>{s.status}</Badge>
              </td>
              <td className="px-3 py-2 font-mono text-[11.5px] text-[var(--text-secondary)]">
                {s.run_id ?? "—"}
              </td>
              <td className="px-3 py-2 text-[12px]">{s.trigger ?? "—"}</td>
              <td className="px-3 py-2 text-[12px] whitespace-nowrap text-[var(--text-secondary)]">
                {shortTime(s.finished_at)}
              </td>
              <td className="px-3 py-2 text-[12px]">
                {s.summary}
                {s.error && (
                  <div className="mt-1 font-mono text-[11px] text-[var(--red)]">{s.error.split("\n")[0]}</div>
                )}
              </td>
              <td className="px-3 py-2">
                <Button variant="ghost" onClick={() => setSelected(s.stage)}>
                  View output
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

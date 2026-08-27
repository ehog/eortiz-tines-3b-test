// Read/write API behind the demo console for everything that lives in pipeline
// state: stage run history, scoring weights, the demo clock, live score preview,
// and the latest stored report. Findings and changes are read straight from the
// mock Qualys and ServiceNow routes by the browser.
import { parseRequest, respond, jsonBody, type Req } from "./http";
import owners from "./asset-owners.json" with { type: "json" };
import {
  openWrite,
  getConfig,
  setConfig,
  clockOffsetDays,
  demoNow,
  latestStageRows,
  clearSeen,
  type StageRow,
} from "./pipeline-db";
import {
  DEFAULT_WEIGHTS,
  normalizeWeights,
  scoreFinding,
  BANDS,
  SLA_DAYS,
  HIGH_PRIORITY_SCORE,
  type Weights,
} from "./scoring";
import type { Database } from "bun:sqlite";
import type { Envelope, NormalizedFinding } from "./types";

const STAGES = ["pull", "normalize", "prioritize", "remediate", "sync", "chase", "report"] as const;

function weightsOf(db: Database): Weights {
  const stored = getConfig(db, "weights");
  return normalizeWeights(stored ? JSON.parse(stored) : DEFAULT_WEIGHTS);
}

function stageSummary(rows: StageRow[]): Record<string, unknown>[] {
  const latest = new Map<string, StageRow>();
  for (const row of rows) if (!latest.has(row.stage)) latest.set(row.stage, row);
  return STAGES.map((stage) => {
    const row = latest.get(stage);
    return {
      stage,
      status: row?.status ?? "never_run",
      run_id: row?.run_id ?? null,
      trigger: row?.trigger ?? null,
      started_at: row?.started_at ?? null,
      finished_at: row?.finished_at ?? null,
      duration_ms: row?.duration_ms ?? null,
      record_count: row?.record_count ?? null,
      summary: row?.summary ?? "This stage has not run yet.",
      error: row?.error ?? null,
    };
  });
}

function payloadOf(row: StageRow | undefined): unknown {
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function main(raw: string): void {
  const req: Req = parseRequest(raw);
  const db = openWrite();
  const view = req.query.get("view") ?? "state";

  if (req.method === "GET") {
    const rows = latestStageRows(db, 60);
    const now = demoNow(db);

    if (view === "owners") {
      respond(200, { owners: owners.assets, fallback: owners.fallback });
      return;
    }

    if (view === "report") {
      const stored = getConfig(db, "latest_report");
      respond(200, {
        as_of: now.toISOString(),
        report: stored ? JSON.parse(stored) : null,
      });
      return;
    }

    if (view === "stage") {
      const stage = req.query.get("stage") ?? "prioritize";
      const row = rows.find((r) => r.stage === stage && r.status === "success");
      respond(200, { stage, payload: payloadOf(row), record: row ?? null });
      return;
    }

    if (view === "findings") {
      const row = rows.find(
        (r) => (r.stage === "sync" || r.stage === "remediate") && r.status === "success",
      );
      const envelope = payloadOf(row) as Envelope | null;
      respond(200, {
        run_id: envelope?.run_id ?? null,
        stage: row?.stage ?? null,
        generated_at: envelope?.generated_at ?? null,
        findings: envelope?.findings ?? [],
        groups: envelope?.groups ?? [],
        tickets: envelope?.tickets ?? [],
      });
      return;
    }

    respond(200, {
      as_of: now.toISOString(),
      branch: process.env._3B_BRANCH_ID ? "draft" : "live",
      branch_id: process.env._3B_BRANCH_ID ?? null,
      clock_offset_days: clockOffsetDays(db),
      last_pull_at: getConfig(db, "last_pull_at"),
      weights: weightsOf(db),
      default_weights: DEFAULT_WEIGHTS,
      bands: BANDS,
      sla_days: SLA_DAYS,
      high_priority_score: HIGH_PRIORITY_SCORE,
      stages: stageSummary(rows),
      history: rows.slice(0, 30).map((r) => ({
        id: r.id,
        run_id: r.run_id,
        stage: r.stage,
        trigger: r.trigger,
        status: r.status,
        started_at: r.started_at,
        duration_ms: r.duration_ms,
        record_count: r.record_count,
        summary: r.summary,
      })),
      has_report: getConfig(db, "latest_report") !== null,
    });
    return;
  }

  if (req.method === "POST") {
    const body = jsonBody(req);
    const action = String(body.action ?? "");

    if (action === "set_weights") {
      const weights = normalizeWeights(body.weights);
      setConfig(db, "weights", JSON.stringify(weights));
      respond(200, { action, weights });
      return;
    }

    if (action === "reset_weights") {
      setConfig(db, "weights", JSON.stringify(DEFAULT_WEIGHTS));
      respond(200, { action, weights: DEFAULT_WEIGHTS });
      return;
    }

    if (action === "set_clock") {
      const days = Number(body.offset_days);
      if (!Number.isFinite(days) || days < 0 || days > 365) {
        respond(400, { error: "offset_days must be a number between 0 and 365" });
        return;
      }
      setConfig(db, "clock_offset_days", String(Math.round(days)));
      respond(200, { action, clock_offset_days: Math.round(days), as_of: demoNow(db).toISOString() });
      return;
    }

    if (action === "advance_clock") {
      const days = Number(body.days ?? 1);
      if (!Number.isFinite(days)) {
        respond(400, { error: "days must be a number" });
        return;
      }
      const next = Math.max(0, Math.min(365, clockOffsetDays(db) + Math.round(days)));
      setConfig(db, "clock_offset_days", String(next));
      respond(200, { action, clock_offset_days: next, as_of: demoNow(db).toISOString() });
      return;
    }

    if (action === "clear_seen") {
      clearSeen(db);
      respond(200, { action, cleared: true });
      return;
    }

    if (action === "reset_pipeline_state") {
      db.transaction(() => {
        db.run("DELETE FROM stage_runs");
        db.run("DELETE FROM seen");
        db.run("DELETE FROM config WHERE key IN ('latest_report', 'last_pull_at', 'last_pull_total')");
      })();
      respond(200, { action, cleared: true });
      return;
    }

    // Re-scores the last prioritize payload with candidate weights without
    // writing anything, so the console's sliders can preview the effect.
    if (action === "score_preview") {
      const weights = normalizeWeights(body.weights);
      const rows = latestStageRows(db, 60);
      const source =
        rows.find((r) => r.stage === "sync" && r.status === "success") ??
        rows.find((r) => r.stage === "remediate" && r.status === "success") ??
        rows.find((r) => r.stage === "prioritize" && r.status === "success") ??
        rows.find((r) => r.stage === "normalize" && r.status === "success");
      const envelope = payloadOf(source) as Envelope | null;
      const findings: NormalizedFinding[] = envelope?.findings ?? [];
      const now = demoNow(db);
      const scored = findings
        .map((f) => {
          const risk = scoreFinding(f, weights, now);
          return {
            finding_id: f.finding_id,
            title: f.title,
            hostname: f.asset.hostname,
            team: f.owner.team,
            application: f.owner.application,
            criticality: f.owner.criticality,
            exposure: f.owner.exposure,
            severity: f.severity,
            cvss_base: f.cvss_base,
            kev: f.kev,
            exploit_in_wild: f.exploit_in_wild,
            baseline_score: f.risk?.risk_score ?? null,
            risk,
          };
        })
        .sort((a, b) => b.risk.risk_score - a.risk.risk_score);
      respond(200, {
        action,
        weights,
        source_stage: source?.stage ?? null,
        high_priority_score: HIGH_PRIORITY_SCORE,
        findings: scored,
      });
      return;
    }

    respond(400, {
      error: `unknown action '${action}'`,
      valid_actions: [
        "set_weights",
        "reset_weights",
        "set_clock",
        "advance_clock",
        "clear_seen",
        "reset_pipeline_state",
        "score_preview",
      ],
    });
    return;
  }

  respond(405, { error: `method ${req.method} not allowed` });
}

try {
  main(await Bun.stdin.text());
} catch (err) {
  console.error(err instanceof Error ? err.stack : String(err));
  respond(400, { error: err instanceof Error ? err.message : String(err) });
}

// Data API: read-only JSON feed for the Data Operations Console (GET /atlas/data).
//
// One request returns everything the console renders: health headline, recent
// runs with their per-step timelines and structured log lines, quality-score
// trend, rejection-reason breakdown, open quarantines and approved remediations.
// The volume is mounted read-only, so this endpoint cannot mutate pipeline state.

import { openDb, httpResponse, makeLogger, requestLine } from "./lib";

const STEP = "Data API";
const raw = await Bun.stdin.text();
const { query } = requestLine(raw);
const limit = Math.min(Number(query.get("limit") ?? 25) || 25, 100);
const log = makeLogger(STEP, "api");

type RunRow = {
  run_id: string; batch_id: string; chaos: string; started_at: string; finished_at: string | null;
  duration_ms: number | null; status: string; sources: string; records_in: number; records_out: number;
  duplicates: number; rejected: number; quarantined: number; quality_score: number | null;
  error: string | null; triage: string | null;
};

let payload: Record<string, unknown> = {
  ok: true,
  generatedAt: new Date().toISOString(),
  runs: [],
  health: { lastRunStatus: "none", qualityTrend: [], publishedLast24h: 0, openQuarantines: 0, totalPublished: 0 },
  rejectionBreakdown: [],
  quarantine: [],
  remediations: [],
};

try {
  const db = openDb(true);
  const runs = db
    .query<RunRow, [number]>("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
    .all(limit);

  const logsByRun = new Map<string, unknown[]>();
  if (runs.length) {
    const placeholders = runs.map(() => "?").join(",");
    const rows = db
      .query<
        { run_id: string; step: string; ts: string; duration_ms: number; level: string; message: string; data: string | null },
        string[]
      >(
        `SELECT run_id, step, ts, duration_ms, level, message, data FROM step_logs
         WHERE run_id IN (${placeholders}) ORDER BY id ASC`,
      )
      .all(...runs.map((r) => r.run_id));
    for (const row of rows) {
      const list = logsByRun.get(row.run_id) ?? [];
      list.push({
        step: row.step,
        ts: row.ts,
        durationMs: row.duration_ms,
        level: row.level,
        message: row.message,
        data: row.data ? JSON.parse(row.data) : null,
      });
      logsByRun.set(row.run_id, list);
    }
  }

  const rejectionsByRun = new Map<string, { reasonCode: string; count: number }[]>();
  for (const row of db
    .query<{ run_id: string; reason_code: string; n: number }, []>(
      "SELECT run_id, reason_code, COUNT(*) AS n FROM rejections GROUP BY run_id, reason_code",
    )
    .all()) {
    const list = rejectionsByRun.get(row.run_id) ?? [];
    list.push({ reasonCode: row.reason_code, count: row.n });
    rejectionsByRun.set(row.run_id, list);
  }

  // A run left in `running` long past any plausible duration crashed between
  // steps. The store is read-only here, so it is reported as stalled rather
  // than rewritten.
  const stalledBefore = Date.now() - 10 * 60 * 1000;

  const shaped = runs.map((r) => {
    const logs = (logsByRun.get(r.run_id) ?? []) as { step: string; durationMs: number }[];
    // Per-step timeline: first and last log line of each step bound its duration.
    const timeline: { step: string; durationMs: number; lines: number }[] = [];
    for (const line of logs) {
      const existing = timeline.find((t) => t.step === line.step);
      if (existing) {
        existing.durationMs = Math.max(existing.durationMs, line.durationMs ?? 0);
        existing.lines++;
      } else {
        timeline.push({ step: line.step, durationMs: line.durationMs ?? 0, lines: 1 });
      }
    }
    return {
      runId: r.run_id,
      batchId: r.batch_id,
      chaos: r.chaos,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMs: r.duration_ms,
      status:
        r.status === "running" && new Date(r.started_at).getTime() < stalledBefore
          ? "stalled"
          : r.status,
      sources: JSON.parse(r.sources) as string[],
      recordsIn: r.records_in,
      recordsOut: r.records_out,
      duplicates: r.duplicates,
      rejected: r.rejected,
      quarantined: r.quarantined,
      qualityScore: r.quality_score,
      error: r.error ? JSON.parse(r.error) : null,
      triage: r.triage ? JSON.parse(r.triage) : null,
      timeline,
      logs,
      rejectionsByReason: rejectionsByRun.get(r.run_id) ?? [],
    };
  });

  // A rolling 24-hour window rather than a calendar day, so the headline stays
  // meaningful in every timezone the console is opened from.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const publishedLast24h =
    db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM records WHERE published_at >= ?")
      .get(since)?.n ?? 0;
  const totalPublished = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM records").get()?.n ?? 0;
  const openQuarantines =
    db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM quarantine WHERE status = 'open'").get()?.n ?? 0;

  payload = {
    ok: true,
    generatedAt: new Date().toISOString(),
    runs: shaped,
    health: {
      lastRunStatus: shaped[0]?.status ?? "none",
      lastRunId: shaped[0]?.runId ?? null,
      lastRunAt: shaped[0]?.startedAt ?? null,
      qualityTrend: [...shaped]
        .filter((r) => r.qualityScore !== null)
        .reverse()
        .map((r) => ({ runId: r.runId, startedAt: r.startedAt, score: r.qualityScore, status: r.status })),
      publishedLast24h,
      totalPublished,
      openQuarantines,
    },
    rejectionBreakdown: db
      .query<{ reason_code: string; n: number }, []>(
        "SELECT reason_code, COUNT(*) AS n FROM rejections GROUP BY reason_code ORDER BY n DESC",
      )
      .all()
      .map((r) => ({ reasonCode: r.reason_code, count: r.n })),
    quarantine: db
      .query<
        { id: number; run_id: string; trial_id: string; ndc: string; reason_code: string; detail: string; matched_field: string; source: string; status: string; decided_at: string | null; decided_by: string | null },
        []
      >("SELECT * FROM quarantine ORDER BY status = 'open' DESC, id DESC LIMIT 60")
      .all()
      .map((q) => ({
        id: q.id, runId: q.run_id, trialId: q.trial_id, ndc: q.ndc, reasonCode: q.reason_code,
        detail: q.detail, matchedField: q.matched_field, source: q.source, status: q.status,
        decidedAt: q.decided_at, decidedBy: q.decided_by,
      })),
    remediations: db
      .query<{ source: string; from_field: string; to_field: string; approved_at: string; approved_by: string; run_id: string | null }, []>(
        "SELECT * FROM mapping_overrides ORDER BY approved_at DESC",
      )
      .all()
      .map((m) => ({
        source: m.source, fromField: m.from_field, toField: m.to_field,
        approvedAt: m.approved_at, approvedBy: m.approved_by, runId: m.run_id,
      })),
  };
  db.close();
  log.info("served console payload", { runs: shaped.length, openQuarantines, totalPublished });
} catch (err) {
  // A first launch before any run has written the store: answer with an empty
  // but well-formed payload rather than an error the console cannot render.
  log.warn("store unavailable, returning empty payload", {
    error: err instanceof Error ? err.message : String(err),
  });
}

console.log(httpResponse(200, JSON.stringify(payload)));

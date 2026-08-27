import { dbExists, openDb, readRequest, respond, SOURCES } from "./lib";

const req = await readRequest();
const huntId = req.query.get("hunt");

if (!dbExists()) {
  respond(200, JSON.stringify(huntId ? { found: false } : { hunts: [] }));
  process.exit(0);
}

const db = openDb("read");
try {
  if (!huntId) {
    const hunts = db
      .query<
        {
          id: string;
          reason: string;
          demo_mode: string;
          created_at: string;
          status: string;
          report_json: string | null;
          sn_number: string | null;
        },
        []
      >(
        `SELECT id, reason, demo_mode, created_at, status, report_json, sn_number
           FROM hunts ORDER BY created_at DESC, rowid DESC LIMIT 25`,
      )
      .all();

    const list = hunts.map((h) => {
      const counts = db
        .query<{ total: number; hits: number; errors: number }, [string]>(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status = 'hit' THEN 1 ELSE 0 END) AS hits,
                  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors
             FROM source_results WHERE hunt_id = ?`,
        )
        .get(h.id)!;
      const indicatorCount = db
        .query<{ n: number }, [string]>(`SELECT COUNT(*) AS n FROM indicators WHERE hunt_id = ?`)
        .get(h.id)!.n;
      const report = h.report_json ? (JSON.parse(h.report_json) as { matchedCount: number; totalEvents: number }) : null;
      return {
        huntId: h.id,
        reason: h.reason,
        demoMode: h.demo_mode,
        createdAt: h.created_at,
        status: h.status,
        indicatorCount,
        matchedCount: report?.matchedCount ?? null,
        totalEvents: report?.totalEvents ?? null,
        sourceRowsExpected: indicatorCount * SOURCES.length,
        sourceRowsDone: counts.total ?? 0,
        hitRows: counts.hits ?? 0,
        errorRows: counts.errors ?? 0,
        serviceNowNumber: h.sn_number,
      };
    });
    respond(200, JSON.stringify({ hunts: list }));
    process.exit(0);
  }

  const hunt = db
    .query<
      {
        id: string;
        reason: string;
        demo_mode: string;
        created_at: string;
        status: string;
        combined_at: string | null;
        report_json: string | null;
        sn_number: string | null;
        sn_sys_id: string | null;
        sn_created_at: string | null;
        findings_path: string | null;
      },
      [string]
    >(`SELECT * FROM hunts WHERE id = ?`)
    .get(huntId);

  if (!hunt) {
    respond(404, JSON.stringify({ found: false, error: `No hunt ${huntId}` }));
    process.exit(0);
  }

  const indicators = db
    .query<{ value: string; type: string }, [string]>(
      `SELECT value, type FROM indicators WHERE hunt_id = ? ORDER BY position`,
    )
    .all(huntId);

  const rows = db
    .query<{ source: string; indicator: string; status: string; error_reason: string | null; frequency: number }, [string]>(
      `SELECT source, indicator, status, error_reason, frequency FROM source_results WHERE hunt_id = ?`,
    )
    .all(huntId);

  const sources = SOURCES.map((s) => {
    const mine = rows.filter((r) => r.source === s.key);
    const errors = mine.filter((r) => r.status === "error");
    const hits = mine.filter((r) => r.status === "hit");
    const done = mine.length >= indicators.length && indicators.length > 0;
    return {
      source: s.key,
      label: s.label,
      state: !done ? "searching" : errors.length > 0 ? "incomplete" : hits.length > 0 ? "matched" : "clean",
      searched: mine.length,
      expected: indicators.length,
      matched: hits.length,
      events: hits.reduce((sum, r) => sum + r.frequency, 0),
      error: errors[0]?.error_reason ?? null,
    };
  });

  const block = db
    .query<
      {
        requested_at: string;
        slack_channel: string | null;
        slack_message: string | null;
        slack_ts: string | null;
        slack_error: string | null;
        targets_json: string | null;
        decision: string | null;
        decided_at: string | null;
        approver: string | null;
        executed_at: string | null;
        results_json: string | null;
      },
      [string]
    >(`SELECT * FROM block_requests WHERE hunt_id = ?`)
    .get(huntId);

  respond(
    200,
    JSON.stringify({
      found: true,
      hunt: {
        huntId: hunt.id,
        reason: hunt.reason,
        demoMode: hunt.demo_mode,
        createdAt: hunt.created_at,
        status: hunt.status,
        combinedAt: hunt.combined_at,
      },
      indicators,
      sources,
      progress: { expected: indicators.length * SOURCES.length, done: rows.length },
      report: hunt.report_json ? JSON.parse(hunt.report_json) : null,
      serviceNow: hunt.sn_number
        ? {
            number: hunt.sn_number,
            sysId: hunt.sn_sys_id,
            createdAt: hunt.sn_created_at,
            attachment: hunt.findings_path ? `${hunt.id}-findings.json` : null,
            attachmentPath: hunt.findings_path,
          }
        : null,
      blockRequest: block
        ? {
            requestedAt: block.requested_at,
            channel: block.slack_channel,
            message: block.slack_message,
            slackTs: block.slack_ts,
            slackError: block.slack_error,
            targets: JSON.parse(block.targets_json ?? "[]"),
            decision: block.decision,
            decidedAt: block.decided_at,
            approver: block.approver,
            executedAt: block.executed_at,
            results: block.results_json ? JSON.parse(block.results_json) : null,
          }
        : null,
    }),
  );
} finally {
  db.close();
}

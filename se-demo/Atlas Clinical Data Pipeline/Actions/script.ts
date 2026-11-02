// Actions: human-in-the-loop decisions from the console (POST /atlas/action).
//
// Two decisions exist, both attributed to the signed-in operator via the
// platform-injected x-3b-authenticated-email header (never a value from the
// request body, which the caller controls):
//
//   quarantine   approve  -> the PHI finding is a false positive; the record is
//                            released and published
//                dismiss  -> the finding is real; the record stays withheld
//   remediation  approve  -> the AI-proposed field remapping takes effect for
//                            future runs (nothing is applied until this click)

import { openDb, httpResponse, makeLogger, requestLine, bodyOrRaw, persistLogs } from "./lib";

const STEP = "Actions";
const raw = await Bun.stdin.text();
const { method } = requestLine(raw);
const log = makeLogger(STEP, "actions");

function actor(request: string): string {
  const head = request.split(/\r?\n\r?\n/, 1)[0] ?? "";
  for (const line of head.split(/\r?\n/)) {
    const match = line.match(/^x-3b-authenticated-email:\s*(.+)$/i);
    if (match) return match[1].trim();
  }
  return "unauthenticated";
}

if (method !== "POST") {
  console.log(httpResponse(405, JSON.stringify({ error: "use POST" })));
  process.exit(0);
}

let body: Record<string, unknown>;
try {
  body = JSON.parse(bodyOrRaw(raw) || "{}");
} catch {
  console.log(httpResponse(400, JSON.stringify({ error: "body must be JSON" })));
  process.exit(0);
}

const who = actor(raw);
const now = new Date().toISOString();
const db = openDb();
let response: Record<string, unknown>;
let status = 200;

if (body.type === "quarantine") {
  const id = Number(body.id);
  const decision = String(body.decision);
  if (!id || !["approve", "dismiss"].includes(decision)) {
    status = 400;
    response = { error: "quarantine actions need { id, decision: 'approve' | 'dismiss' }" };
  } else {
    const row = db
      .query<
        { id: number; run_id: string; trial_id: string; ndc: string; source: string; status: string },
        [number]
      >("SELECT id, run_id, trial_id, ndc, source, status FROM quarantine WHERE id = ?")
      .get(id);
    if (!row) {
      status = 404;
      response = { error: `quarantine finding ${id} not found` };
    } else {
      const newStatus = decision === "approve" ? "released" : "dismissed";
      db.run("UPDATE quarantine SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?", [
        newStatus, now, who, id,
      ]);
      // Releasing a finding publishes the trial/NDC pair it was blocking. The
      // free-text field that triggered the finding is never persisted, so the
      // published row carries no patient-level data either way.
      if (decision === "approve") {
        db.run(
          `INSERT INTO records (trial_id, ndc, run_id, source, published_at)
           VALUES (?,?,?,?,?)
           ON CONFLICT(trial_id, ndc) DO UPDATE SET published_at = excluded.published_at`,
          [row.trial_id, row.ndc, row.run_id, row.source, now],
        );
      }
      log.info("quarantine decision recorded", {
        findingId: id, trialId: row.trial_id, decision, newStatus, decidedBy: who,
      });
      response = { ok: true, id, status: newStatus, decidedBy: who, decidedAt: now };
    }
  }
} else if (body.type === "remediation") {
  const runId = String(body.runId ?? "");
  const row = db
    .query<{ triage: string | null }, [string]>("SELECT triage FROM runs WHERE run_id = ?")
    .get(runId);
  const triage = row?.triage ? JSON.parse(row.triage) : null;
  const fix = triage?.proposedFix;
  if (!fix || fix.kind !== "mapping_override") {
    status = 400;
    response = { error: `run ${runId} has no approvable remediation` };
  } else {
    db.run(
      `INSERT INTO mapping_overrides (source, from_field, to_field, approved_at, approved_by, run_id)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(source, from_field) DO UPDATE SET
         to_field = excluded.to_field, approved_at = excluded.approved_at,
         approved_by = excluded.approved_by, run_id = excluded.run_id`,
      [fix.source, fix.fromField, fix.toField, now, who, runId],
    );
    log.info("remediation approved", {
      runId, source: fix.source, fromField: fix.fromField, toField: fix.toField, approvedBy: who,
    });
    response = {
      ok: true,
      applied: { source: fix.source, fromField: fix.fromField, toField: fix.toField },
      approvedBy: who,
      approvedAt: now,
      effect: "The remapping applies from the next run onwards.",
    };
  }
} else {
  status = 400;
  response = { error: "type must be 'quarantine' or 'remediation'" };
}

persistLogs(db, log.logs);
db.close();
console.log(httpResponse(status, JSON.stringify(response)));

import { openDb, readRequest, respondHtml } from "./lib";

const req = await readRequest();
const huntId = req.query.get("hunt") ?? "";
const token = req.query.get("token") ?? "";
const decision = (req.query.get("decision") ?? "").toLowerCase();
const approver = req.headers["x-3b-authenticated-email"] ?? "unknown";
const branchPrefix = process.env._3B_BRANCH_ID ? `/__3b/branch/${process.env._3B_BRANCH_ID}` : "";

const page = (title: string, tone: "ok" | "warn" | "bad", body: string, huntLink?: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0b1020; color:#e2e8f5;
         font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif }
  .card { max-width:34rem; padding:2rem 2.25rem; border-radius:1rem; background:#141a2f;
          border:1px solid ${tone === "ok" ? "#15803d" : tone === "warn" ? "#a16207" : "#b91c1c"};
          box-shadow:0 20px 60px rgba(0,0,0,.45) }
  h1 { margin:0 0 .5rem; font-size:1.35rem; color:${tone === "ok" ? "#4ade80" : tone === "warn" ? "#fbbf24" : "#f87171"} }
  p { margin:.4rem 0; color:#c3cbdd }
  code { background:#0b1020; padding:.1rem .35rem; border-radius:.35rem; font-size:.9em }
  a { display:inline-block; margin-top:1.25rem; color:#93c5fd }
</style></head>
<body><div class="card"><h1>${title}</h1>${body}${huntLink ? `<a href="${huntLink}">Open the hunt report</a>` : ""}</div></body></html>`;

if (!huntId || !token || (decision !== "approve" && decision !== "deny")) {
  respondHtml(400, page("Invalid request", "bad", "<p>This link is missing the hunt, token or decision parameter.</p>"));
  process.exit(0);
}

const db = openDb("write");
try {
  const hunt = db
    .query<{ approval_token: string; sn_number: string | null }, [string]>(
      `SELECT approval_token, sn_number FROM hunts WHERE id = ?`,
    )
    .get(huntId);
  if (!hunt || hunt.approval_token !== token) {
    respondHtml(403, page("Approval link rejected", "bad", "<p>The approval token does not match this hunt.</p>"));
    process.exit(0);
  }

  const existing = db
    .query<{ decision: string | null; decided_at: string | null; targets_json: string | null }, [string]>(
      `SELECT decision, decided_at, targets_json FROM block_requests WHERE hunt_id = ?`,
    )
    .get(huntId);

  const reportUrl = `${branchPrefix}/ioc/h/${huntId}`;

  if (!existing) {
    respondHtml(404, page("No block request", "warn", "<p>This hunt has no pending block request.</p>", reportUrl));
    process.exit(0);
  }

  if (existing.decision && existing.decision !== "pending") {
    respondHtml(
      200,
      page(
        "Already decided",
        "warn",
        `<p>This block request was already <strong>${existing.decision}</strong> at <code>${existing.decided_at}</code>.</p>`,
        reportUrl,
      ),
    );
    process.exit(0);
  }

  const decidedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const outcome = decision === "approve" ? "approved" : "denied";
  db.query(`UPDATE block_requests SET decision = ?, decided_at = ?, approver = ? WHERE hunt_id = ?`).run(
    outcome,
    decidedAt,
    approver,
    huntId,
  );

  const targets = JSON.parse(existing.targets_json ?? "[]") as { system: string; action: string; indicator: string }[];

  respondHtml(
    200,
    page(
      decision === "approve" ? "Block request approved" : "Block request denied",
      decision === "approve" ? "ok" : "warn",
      decision === "approve"
        ? `<p>Approved by <code>${approver}</code> at <code>${decidedAt}</code>.</p>
           <p>Submitting ${targets.length} block action(s) to Zscaler and Microsoft Defender.</p>
           ${hunt.sn_number ? `<p>Recorded on ServiceNow <code>${hunt.sn_number}</code>.</p>` : ""}`
        : `<p>Denied by <code>${approver}</code> at <code>${decidedAt}</code>. No blocks were submitted.</p>`,
      reportUrl,
    ),
    // The downstream block submitter reads the decision from these headers.
    { "X-Ioc-Hunt-Id": huntId, "X-Ioc-Decision": outcome, "X-Ioc-Approver": approver },
  );
} finally {
  db.close();
}

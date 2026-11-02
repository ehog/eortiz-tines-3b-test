import { escapeHtml as h, httpResponse, parseHttp, requestLine } from "./http";
import { log, main } from "./log";
import type { CleanupItem } from "./rules";
import { type Plan, listNames, planStatus, readDecision, readPlan } from "./store";

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#0f766e"/><path d="M4 8.5l2.5 2.5L12 5.5" stroke="#fff" stroke-width="2" fill="none"/></svg>`,
  );

function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${h(title)}</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
main{max-width:960px;margin:0 auto;padding:32px 20px}
h1{font-size:22px;margin:0 0 4px}.muted{color:#64748b}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0;margin:16px 0}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top}
th{background:#f1f5f9;font-weight:600;font-size:12px;text-transform:uppercase;color:#475569}
code{font-size:12px;word-break:break-all}
.btn{border:0;border-radius:6px;padding:10px 18px;font-weight:600;color:#fff;cursor:pointer;margin-right:8px}
.approve{background:#15803d}.reject{background:#b91c1c}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;background:#e2e8f0;font-size:12px}
a{color:#0f766e}
</style></head><body><main>${body}</main></body></html>`;
}

function html(status: number, title: string, body: string, headers: Record<string, string> = {}) {
  const content = page(title, body);
  process.stdout.write(httpResponse(status, content, { "Content-Type": "text/html; charset=utf-8", ...headers }));
}

function itemRows(items: CleanupItem[]) {
  return items
    .map((i) => `<tr><td><span class="pill">${h(i.kind)}</span></td><td>${h(i.rgName)}</td>
<td><code>${h(i.id)}</code></td><td>${h(i.reason)}</td></tr>`)
    .join("");
}

function renderPlan(plan: any, preselect: string | null) {
  const items: CleanupItem[] = plan.items;
  const pending = plan.status === "pending";
  const decided = plan.decided_by
    ? `<p class="muted">Decided by ${h(plan.decided_by)} at ${h(plan.decided_at)}</p>` : "";
  const hint = preselect
    ? `<p>You chose <strong>${h(preselect)}</strong> in Slack. Confirm below.</p>` : "";
  const form = pending
    ? `<div class="card">${hint}<form method="post">
<input type="hidden" name="plan" value="${h(plan.id)}">
<button class="btn approve" name="decision" value="approve">Approve and delete ${items.length} item(s)</button>
<button class="btn reject" name="decision" value="reject">Reject</button></form></div>`
    : `<div class="card">This plan is <strong>${h(plan.status)}</strong>; no action is possible.</div>`;
  return `<h1>Cleanup plan <code>${h(plan.id)}</code></h1>
<p class="muted">Created ${h(plan.created_at)} · status <span class="pill">${h(plan.status)}</span></p>
${decided}${form}
<table><thead><tr><th>Kind</th><th>RG</th><th>Resource</th><th>Reason</th></tr></thead>
<tbody>${itemRows(items)}</tbody></table>
<p><a href="../azure-rg">Back to dashboard</a></p>`;
}

function renderList(plans: any[]) {
  const rows = plans
    .map((p) => `<tr><td><a href="?plan=${encodeURIComponent(p.id)}">${h(p.id)}</a></td>
<td>${h(p.created_at)}</td><td><span class="pill">${h(p.status)}</span></td></tr>`)
    .join("");
  return `<h1>Cleanup plans</h1><table><thead><tr><th>Plan</th><th>Created</th><th>Status</th></tr></thead>
<tbody>${rows || `<tr><td colspan="3" class="muted">No plans yet.</td></tr>`}</tbody></table>`;
}

function planView(plan: Plan) {
  const d = readDecision(plan.id);
  return {
    id: plan.id,
    created_at: plan.createdAt,
    status: planStatus(plan),
    decided_by: d?.by ?? null,
    decided_at: d?.at ?? null,
    items: plan.items as CleanupItem[],
  };
}

main("Cleanup approval", async () => {
  const msg = parseHttp(await Bun.stdin.text());
  const { method, query } = requestLine(msg);
  const email = msg.headers["x-3b-authenticated-email"];
  log("info", "approval_started", "Serving cleanup approval.", { method, has_identity: !!email });

  const findPlan = (id: string | null) => {
    const plan = id ? readPlan(id) : null;
    return plan ? planView(plan) : null;
  };

  if (method === "GET") {
    const plan: any = findPlan(query.get("plan"));
    if (plan) {
      const decision = query.get("decision");
      const preselect = decision === "approve" || decision === "reject" ? decision : null;
      html(200, `Cleanup plan ${plan.id}`, renderPlan(plan, preselect));
    } else {
      const plans = listNames("plans").reverse().slice(0, 30)
        .map((n) => findPlan(n.replace(/\.json$/, "")))
        .filter(Boolean);
      html(200, "Cleanup plans", renderList(plans));
    }
    log("info", "approval_completed", "Rendered approval page.");
    return;
  }

  if (method !== "POST") {
    html(405, "Not allowed", "<h1>Method not allowed</h1>");
    return;
  }
  if (!email) {
    log("warn", "approval_unauthenticated", "Decision without an authenticated identity.");
    html(401, "Sign in required", "<h1>Sign in required</h1><p>Open this page from 3B while signed in.</p>");
    return;
  }

  const form = new URLSearchParams(msg.body);
  const decision = form.get("decision");
  const plan: any = findPlan(form.get("plan"));
  if (!plan || (decision !== "approve" && decision !== "reject")) {
    html(400, "Invalid request", "<h1>Invalid plan or decision</h1>");
    return;
  }
  if (plan.status !== "pending") {
    log("warn", "plan_not_pending", "Plan already decided.", { plan_id: plan.id, status: plan.status });
    html(409, "Already decided", `<h1>Plan already ${h(plan.status)}</h1><p><a href="?plan=${h(plan.id)}">View plan</a></p>`);
    return;
  }

  const payload = { planId: plan.id, decision, by: email, at: new Date().toISOString() };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  const verb = decision === "approve" ? "Approved — deletions are running" : "Rejected — nothing will be deleted";
  html(202, "Decision recorded",
    `<h1>${verb}</h1><p class="muted">Plan <code>${h(plan.id)}</code> · ${h(email)}</p>
<p>Results will be posted to Slack and appear on the <a href="../azure-rg">dashboard</a>.</p>`,
    { "X-RGLC-Decision": header });
  log("info", "approval_completed", "Recorded decision for execution.", { plan_id: plan.id, decision });
});

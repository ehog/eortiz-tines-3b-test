import { loadConfig } from "./config";
import { escapeHtml as h, httpResponse } from "./http";
import { log, main } from "./log";
import {
  type Plan,
  activeAllocations,
  listNames,
  planStatus,
  readDecision,
  readRecent,
} from "./store";

const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#1d4ed8"/><path d="M3 11h10M4.5 11V7h2v4M7.5 11V4.5h2V11M10.5 11V8h2v3" stroke="#fff" stroke-width="1.2" fill="none"/></svg>`,
  );

const STYLE = `
body{font:14px/1.5 system-ui,sans-serif;margin:0;background:#f8fafc;color:#0f172a}
header{background:#0f172a;color:#fff;padding:20px 32px}
header h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:#94a3b8}
nav{display:flex;gap:4px;padding:0 32px;background:#1e293b}
nav a{color:#cbd5e1;padding:10px 14px;text-decoration:none;font-weight:500}
nav a:hover{color:#fff;background:#334155}
main{padding:24px 32px;max-width:1280px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:14px}
.card b{display:block;font-size:24px}.card span{color:#64748b;font-size:12px}
section{margin-top:32px}h2{font-size:16px;margin:0 0 8px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e8f0}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:13px}
th{background:#f1f5f9;font-size:11px;text-transform:uppercase;color:#475569}
code{font-size:12px;word-break:break-all}.muted{color:#64748b}
.ok{color:#15803d;font-weight:600}.bad{color:#b91c1c;font-weight:600}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;background:#e2e8f0;font-size:12px}
.banner{background:#fef3c7;border:1px solid #fcd34d;padding:8px 12px;border-radius:6px;margin-bottom:16px}
`;

const OUTCOME_CLASS: Record<string, string> = {
  provisioned: "ok", existing: "muted", skipped: "muted", failed: "bad",
  deleted: "ok", released: "ok", already_gone: "muted", pending: "muted", deferred: "muted",
};

function table(headers: string[], rows: string[][]) {
  const head = headers.map((x) => `<th>${x}</th>`).join("");
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${headers.length}" class="muted">No records yet.</td></tr>`;
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

const outcome = (v: string) => `<span class="${OUTCOME_CLASS[v] ?? ""}">${h(v)}</span>`;
const when = (ts: string | null) => (ts ? h(ts.replace("T", " ").slice(0, 19)) : "");

interface Data {
  provisioning: any[];
  compliance: any[];
  active: any[];
  released: any[];
  plans: (Plan & { status: string; decidedBy: string | null })[];
  deletions: any[];
}

function load(): Data {
  const plans = readRecent<Plan>("plans", 20).map((p) => ({
    ...p,
    status: planStatus(p),
    decidedBy: readDecision(p.id)?.by ?? null,
  }));
  return {
    provisioning: readRecent("provisioning", 50),
    compliance: readRecent("compliance", 50),
    active: activeAllocations().sort((a, b) => b.allocatedAt.localeCompare(a.allocatedAt)),
    released: readRecent("ipam/released", 50),
    plans,
    deletions: readRecent("deletions", 200),
  };
}

function stats(d: Data) {
  const latest = new Map<string, any>();
  for (const c of d.compliance) if (!latest.has(c.rgId)) latest.set(c.rgId, c);
  const failingRgs = [...latest.values()].filter((c) => c.results.some((r: any) => !r.passed)).length;
  return [
    ["Active CIDR allocations", d.active.length],
    ["Networks provisioned (recent)", d.provisioning.filter((p) => p.outcome === "provisioned").length],
    ["RGs failing compliance (latest run)", failingRgs],
    ["Cleanup plans awaiting approval", d.plans.filter((p) => p.status === "pending").length],
    ["Cleanup actions recorded", listNames("deletions").length],
  ];
}

function sections(d: Data) {
  const prov = d.provisioning.map((r) => [
    when(r.ts), h(r.rgName), h(r.location), h(r.template), outcome(r.outcome),
    `<code>${h(r.cidr)}</code>`, `<span class="muted">${h(r.detail)}</span>`,
  ]);
  const comp = d.compliance.flatMap((c) =>
    c.results.map((r: any) => [
      when(c.ts), h(c.rgName), h(r.check),
      r.passed ? `<span class="ok">pass</span>` : `<span class="bad">fail</span>`,
      h(r.detail), `<span class="muted">${h(r.remediation)}</span>`,
    ]),
  );
  const ipam = [
    ...d.active.map((a) => [
      `<code>${h(a.cidr)}</code>`, h(a.rgName), `<span class="pill">allocated</span>`,
      h(a.source), when(a.allocatedAt), "",
    ]),
    ...d.released.map((a) => [
      `<code>${h(a.cidr)}</code>`, h(a.rgName), `<span class="pill">released</span>`,
      h(a.source), when(a.allocatedAt), `${when(a.releasedAt)} by ${h(a.releasedBy)}`,
    ]),
  ];
  const plans = d.plans.map((p) => [
    `<a href="azure-rg/cleanup?plan=${encodeURIComponent(p.id)}">${h(p.id)}</a>`, when(p.createdAt),
    `<span class="pill">${h(p.status)}</span>`, h(p.decidedBy), String(p.items.length),
    `<code>${h(JSON.stringify(p.summary.byKind ?? {}))}</code>`,
  ]);
  const dels = d.deletions.map((r) => [
    when(r.ts), `<code>${h(r.resourceId)}</code>`, h(r.reason), outcome(r.outcome),
    h(r.detail), h(r.approvedBy), when(r.approvedAt), h(r.planId),
  ]);
  return `
<section id="provisioning"><h2>Recent RG provisioning events</h2>
${table(["When", "RG", "Location", "Template", "Outcome", "CIDR", "Detail"], prov)}</section>
<section id="compliance"><h2>Compliance history</h2>
${table(["When", "RG", "Check", "Result", "Detail", "Remediation"], comp)}</section>
<section id="ipam"><h2>IPAM allocations</h2>
${table(["CIDR", "RG", "Status", "Source", "Allocated", "Released"], ipam)}</section>
<section id="plans"><h2>Cleanup plans</h2>
${table(["Plan", "Created", "Status", "Decided by", "Items", "By kind"], plans)}</section>
<section id="audit"><h2>Cleanup audit log</h2>
${table(["When", "Resource", "Reason", "Outcome", "Detail", "Approved by", "Approved at", "Plan"], dels)}</section>`;
}

main("Dashboard", async () => {
  await Bun.stdin.text();
  log("info", "dashboard_started", "Rendering dashboard.");
  const cfg = loadConfig();
  const data = load();
  const cards = stats(data).map(([label, n]) => `<div class="card"><b>${n}</b><span>${h(label)}</span></div>`).join("");
  const banner = cfg.simulate
    ? `<div class="banner">Simulation mode is on — Azure and Entra ID calls are served by the built-in simulator.</div>` : "";
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Azure RG lifecycle dashboard</title>
<link rel="icon" type="image/svg+xml" href="${FAVICON}">
<meta name="viewport" content="width=device-width,initial-scale=1"><style>${STYLE}</style></head><body>
<header><h1>Azure RG lifecycle</h1><p>${cfg.subscriptions.length} target subscription(s) · pools ${h(cfg.ipamPools.join(", "))}</p></header>
<nav><a href="#provisioning">Provisioning</a><a href="#compliance">Compliance</a><a href="#ipam">IPAM</a><a href="#plans">Cleanup plans</a><a href="#audit">Audit log</a></nav>
<main>${banner}<div class="cards">${cards}</div>${sections(data)}</main></body></html>`;
  process.stdout.write(httpResponse(200, html, { "Content-Type": "text/html; charset=utf-8" }));
  log("info", "dashboard_completed", "Rendered dashboard.", { bytes: html.length });
});

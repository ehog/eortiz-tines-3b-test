import { useMemo, useState } from "react";

type Lvl = "H" | "M" | "L";
type Fit = "Native" | "Integration" | "Partial" | "Gap";
type Req = { id: string; title: string; desc: string; evaluator?: string; imp: Lvl; mat: Lvl; score: number; fit: Fit; why: string };

const R: Req[] = [
  { id: "AIV-01", title: "Automated AI Discovery", desc: "Continuously detects and inventories all network and endpoint access to consumer and enterprise AI applications.", evaluator: "Sean Cooper", imp: "H", mat: "M", score: 5, fit: "Integration", why: "Tines has no network/endpoint sensor. It can schedule pulls from SWG/CASB/EDR/DNS sources (Netskope, Zscaler, CrowdStrike, Umbrella) and build a continuous AI-app inventory in Records." },
  { id: "AIV-02", title: "AI Application Catalog", desc: "Maintains a dynamically updated database of global AI services, classifying them by risk profile, tool type, and vendor.", evaluator: "Sean Cooper", imp: "H", mat: "M", score: 5, fit: "Partial", why: "Records can hold a catalog and AI actions can classify new apps by risk and type, but Tines ships no curated global AI-service database. Content has to be sourced or built." },
  { id: "AIV-03", title: "Browser Extension Monitoring", desc: "Tracks and identifies AI utilities operating as browser sidebars, add-ons, or local extensions.", imp: "M", mat: "L", score: 4, fit: "Integration", why: "Depends on browser-management or EDR telemetry (Chrome Enterprise, Island, CrowdStrike). Tines can collect and normalize it and flag AI extensions, but it does no collection itself." },
  { id: "AIV-04", title: "Shadow AI Alerting", desc: "Triggers immediate admin notifications when unauthorized or unvetted AI applications are accessed.", imp: "M", mat: "H", score: 8, fit: "Native", why: "This is core SOAR work: take events in by webhook, check them against an allowlist, then notify through Slack, Teams, or email, open a Case, and optionally ask the user to justify the access." },
  { id: "AIV-05", title: "API Endpoint Detection", desc: "Identifies and logs direct programmatic API requests to external AI model providers.", imp: "H", mat: "M", score: 5, fit: "Integration", why: "Requires proxy, firewall, or DNS logs that show calls to api.openai.com, api.anthropic.com, and similar hosts. Tines can query those sources and correlate the results, but it does not inspect traffic." },
  { id: "AIV-06", title: "Local Model Execution Tracking", desc: "Detects launch and usage of open-source models running locally (Ollama, Llamafile).", imp: "H", mat: "L", score: 4, fit: "Integration", why: "Needs EDR process telemetry. Tines can run EDR hunts on a schedule for ollama and llamafile processes and track the results, but detection quality depends on the EDR." },
  { id: "AIV-07", title: "User and Group Attribution", desc: "Maps AI usage to identities, departments and regions via IdP.", imp: "M", mat: "H", score: 8, fit: "Native", why: "Enriching events with identity data from Okta, Entra ID, or an HRIS is a standard Tines pattern, and the prebuilt integrations are mature." },
  { id: "AIV-08", title: "Prompt and Response Auditing", desc: "Captures and logs exact content of prompts and responses to external AI.", imp: "H", mat: "L", score: 3, fit: "Gap", why: "Tines cannot see third-party prompts unless an AI gateway or proxy provides them. It does log prompts and outputs for AI used inside Tines itself." },
  { id: "AIV-09", title: "Volume and Frequency Metrics", desc: "Counts prompts, sessions and frequency per user/department.", imp: "M", mat: "M", score: 6, fit: "Partial", why: "Tines can aggregate whatever its sources provide into Records and dashboards. Prompt-level counts need gateway data." },
  { id: "AIV-10", title: "Token Consumption Tracking", desc: "Estimates input/output token volumes.", imp: "L", mat: "M", score: 5, fit: "Integration", why: "Tines can pull usage APIs from OpenAI, Anthropic, and Azure on a schedule. Token counts for unmanaged consumer use are not available." },
  { id: "AIV-11", title: "Interaction Intent Classification", desc: "NLP categorization of business purpose.", imp: "L", mat: "H", score: 7, fit: "Native", why: "AI actions can classify text into categories reliably, provided the prompt or session content is available from an upstream source." },
  { id: "AIV-12", title: "Active Session Timing", desc: "Measures active interaction time vs. idle tab.", imp: "L", mat: "L", score: 2, fit: "Gap", why: "Needs telemetry from inside the browser. Tines has no comparable capability." },
  { id: "AIV-13", title: "Cross-Platform Copy-Paste Tracking", desc: "Logs large copy-paste from internal apps into AI web forms.", imp: "H", mat: "L", score: 3, fit: "Gap", why: "Requires DLP or an enterprise browser for capture. Tines only orchestrates the response to those alerts." },
  { id: "AIV-14", title: "Real-Time PII/PHI Detection", desc: "Scans outbound prompts in real time for PII/PHI/PCI.", imp: "H", mat: "L", score: 3, fit: "Gap", why: "Tines is not inline, so it cannot scan prompts in real time. It can check content after the fact and route DLP findings." },
  { id: "AIV-15", title: "Source Code Leakage Prevention", desc: "Detects code, keys and secrets sent to public LLMs.", imp: "M", mat: "L", score: 3, fit: "Gap", why: "Prevention has to happen inline. Tines can automate key rotation and response once a DLP or secrets scanner reports a leak." },
  { id: "AIV-16", title: "IP Scanning", desc: "Flags trade secrets, financials, legal drafts in AI traffic.", imp: "M", mat: "L", score: 3, fit: "Gap", why: "Same limitation as AIV-15: Tines needs an inline inspection source." },
  { id: "AIV-17", title: "Inline Data Redaction", desc: "Masks sensitive data before it leaves the perimeter.", imp: "L", mat: "L", score: 2, fit: "Gap", why: "Tines is not on the path to third-party AI. It can redact data before its own AI actions run." },
  { id: "AIV-18", title: "Interaction Risk Scoring", desc: "Dynamic risk score per AI transaction.", imp: "M", mat: "M", score: 7, fit: "Native", why: "Tines can compute risk scores that combine app risk, user privilege from the IdP, and data sensitivity from DLP, then branch on the result." },
  { id: "AIV-19", title: "Compliance Policy Mapping", desc: "Evaluate transactions against GDPR, CCPA, EU AI Act.", imp: "L", mat: "M", score: 5, fit: "Partial", why: "AI-assisted mapping and rules are possible, but Tines ships no prebuilt regulatory content." },
  { id: "AIV-20", title: "Executive Visibility Dashboard", desc: "Aggregate charts on adoption, top tools, risk exposure.", imp: "M", mat: "M", score: 7, fit: "Native", why: "Records dashboards and 3B web apps can display aggregated adoption and risk metrics. The limit is the quality of the source data." },
  { id: "AIV-21", title: "Cost Attribution Analytics", desc: "Project SaaS spend and identify redundant seats.", imp: "H", mat: "M", score: 6, fit: "Partial", why: "Tines can join vendor billing and seat APIs with IdP data to find unused or duplicate licenses. Pricing reference data is maintained by the customer." },
  { id: "AIV-22", title: "SIEM/SOAR Data Export", desc: "Stream logs and alerts to Splunk, Sentinel via Syslog/Webhooks.", imp: "H", mat: "H", score: 10, fit: "Native", why: "This is Tines's core strength: native HTTP, webhook, and SIEM integrations, plus Tines acts as the SOAR layer itself." },
  { id: "AIV-23", title: "IdP Integration Support", desc: "Native Okta/Entra ID integration for org structure and lifecycle.", imp: "M", mat: "H", score: 9, fit: "Native", why: "Tines supports SSO and SCIM for its own users, and its Okta and Entra integrations drive workflows such as joiner/mover/leaver automation." },
  { id: "AIV-24", title: "Custom Policy Rules Engine", desc: "Granular block/allow/alert rules by risk, role, data type, time.", imp: "M", mat: "H", score: 8, fit: "Native", why: "Workflows express flexible conditional logic. Blocking is carried out by pushing policy to the SWG, CASB, or firewall." },
  { id: "AIV-25", title: "Tamper-Evident Audit Logs", desc: "Cryptographic immutability on AI interaction logs.", imp: "L", mat: "M", score: 5, fit: "Partial", why: "Tines has platform audit logs and can forward data to WORM or immutable storage. It offers no built-in cryptographic sealing." },
  { id: "AIV-26", title: "AI Model Governance", desc: "Tracks which model each user is using.", imp: "H", mat: "M", score: 6, fit: "Partial", why: "Strong for AI used inside Tines, where admins control which models are allowed and per-action models are logged. Governance of external tools depends on gateway or vendor data." },
  { id: "AIV-27", title: "Session Reconstruction", desc: "Reconstruct agent sessions incl. data, tools, other agents.", imp: "M", mat: "M", score: 6, fit: "Partial", why: "Full run and event history is available for agents built in Tines. Reconstructing external agent sessions requires their traces." },
  { id: "AIV-28", title: "Search & Hunting", desc: "Search, filter and pivot across sessions and execution paths.", imp: "H", mat: "M", score: 6, fit: "Partial", why: "Tines can automate hunts across connected tools and search Records. It is not a purpose-built hunting data lake." },
  { id: "AIV-29", title: "Threat Detection", desc: "Detect prompt injection, malicious tool calls, exfiltration.", imp: "H", mat: "L", score: 4, fit: "Partial", why: "Tines can analyze logs and orchestrate the response, but it has no inline prompt-injection detection engine." },
  { id: "AIV-30", title: "Latency Overhead", desc: "<30ms per request impact during live enforcement.", imp: "M", mat: "H", score: 9, fit: "Native", why: "Tines works out of band, so it adds no latency to user AI traffic. It also does no inline enforcement." },
  { id: "AIV-31", title: "Data Privacy", desc: "Evaluate data locally (VPC/on-prem) rather than vendor clouds.", imp: "M", mat: "H", score: 8, fit: "Native", why: "Tines offers self-hosted and dedicated-tenant deployment, in-region AI models, and tunnels to private networks." },
  { id: "AIV-32", title: "App Workload Discovery", desc: "Discover custom AI apps, API gateways, orchestration frameworks.", imp: "H", mat: "M", score: 5, fit: "Integration", why: "Tines can query cloud APIs (AWS Bedrock, Azure OpenAI, GCP Vertex) and CSPM tools to inventory AI workloads." },
];

const W: Record<Lvl, number> = { H: 3, M: 2, L: 1 };
const fitColor: Record<Fit, string> = { Native: "bg-emerald-100 text-emerald-800", Integration: "bg-sky-100 text-sky-800", Partial: "bg-amber-100 text-amber-800", Gap: "bg-rose-100 text-rose-800" };
const barColor = (s: number) => (s >= 8 ? "bg-emerald-500" : s >= 5 ? "bg-amber-400" : "bg-rose-500");
const lvlName: Record<Lvl, string> = { H: "High", M: "Medium", L: "Low" };

export default function App() {
  const [fit, setFit] = useState<Fit | "All">("All");
  const [imp, setImp] = useState<Lvl | "All">("All");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"id" | "score" | "weighted">("id");
  const [open, setOpen] = useState<string | null>(null);

  const weighted = (R.reduce((a, r) => a + r.score * W[r.imp], 0) / R.reduce((a, r) => a + 10 * W[r.imp], 0)) * 100;
  const avg = R.reduce((a, r) => a + r.score, 0) / R.length;
  const fits = (["Native", "Integration", "Partial", "Gap"] as Fit[]).map((f) => ({ f, n: R.filter((r) => r.fit === f).length }));
  const byImp = (["H", "M", "L"] as Lvl[]).map((l) => { const xs = R.filter((r) => r.imp === l); return { l, n: xs.length, avg: xs.reduce((a, r) => a + r.score, 0) / xs.length }; });
  const highGaps = R.filter((r) => r.imp === "H" && r.score <= 4);

  const rows = useMemo(() => {
    let xs = R.filter((r) => (fit === "All" || r.fit === fit) && (imp === "All" || r.imp === imp) && (r.title + r.desc + r.id).toLowerCase().includes(q.toLowerCase()));
    if (sort === "score") xs = [...xs].sort((a, b) => b.score - a.score);
    if (sort === "weighted") xs = [...xs].sort((a, b) => b.score * W[b.imp] - a.score * W[a.imp]);
    return xs;
  }, [fit, imp, q, sort]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-gradient-to-r from-violet-800 to-indigo-700 text-white px-8 py-8">
        <p className="text-violet-200 text-sm uppercase tracking-wider">Requirements evaluation</p>
        <h1 className="text-3xl font-semibold mt-1">Tines vs. AI Visibility Requirements</h1>
        <p className="text-violet-100 mt-2 max-w-3xl text-sm">{R.length} requirements (AIV-01 to AIV-32) scored 1–10. Weighted score uses importance weights High=3, Medium=2, Low=1. Maturity reflects how mature Tines's capability is for each requirement.</p>
      </header>

      <main className="px-8 py-6 space-y-6 max-w-7xl mx-auto">
        <section className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Kpi label="Weighted fit score" value={`${weighted.toFixed(0)}%`} sub="importance-weighted" />
          <Kpi label="Average score" value={avg.toFixed(1)} sub="out of 10" />
          <Kpi label="Native capabilities" value={`${fits[0].n}/${R.length}`} sub="out of the box" />
          <Kpi label="High-importance gaps" value={String(highGaps.length)} sub="High importance, score ≤ 4" tone="rose" />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card title="Fit type (click to filter)">
            {fits.map(({ f, n }) => (
              <button key={f} onClick={() => setFit(fit === f ? "All" : f)} className={`w-full flex items-center gap-3 py-1.5 text-left ${fit !== "All" && fit !== f ? "opacity-40" : ""}`}>
                <span className={`text-xs px-2 py-0.5 rounded w-24 text-center ${fitColor[f]}`}>{f}</span>
                <div className="flex-1 h-3 bg-slate-100 rounded"><div className="h-3 rounded bg-violet-500" style={{ width: `${(n / R.length) * 100}%` }} /></div>
                <span className="text-sm w-6 text-right tabular-nums">{n}</span>
              </button>
            ))}
          </Card>
          <Card title="Average score by importance (click to filter)">
            {byImp.map(({ l, n, avg }) => (
              <button key={l} onClick={() => setImp(imp === l ? "All" : l)} className={`w-full flex items-center gap-3 py-1.5 text-left ${imp !== "All" && imp !== l ? "opacity-40" : ""}`}>
                <span className="text-sm w-24">{lvlName[l]} <span className="text-slate-400">({n})</span></span>
                <div className="flex-1 h-3 bg-slate-100 rounded"><div className={`h-3 rounded ${barColor(avg)}`} style={{ width: `${avg * 10}%` }} /></div>
                <span className="text-sm w-8 text-right tabular-nums">{avg.toFixed(1)}</span>
              </button>
            ))}
          </Card>
          <Card title="Summary">
            <p className="text-sm text-slate-600 leading-relaxed">Tines is an <b>orchestration and response</b> layer, not an inline AI-visibility sensor. It scores highest on alerting, enrichment, identity, SIEM/SOAR integration, policy logic, and data residency. It scores lowest where inline inspection is required: prompt capture, real-time DLP, redaction, and copy-paste tracking. For those, pair it with an SSE/CASB, an enterprise browser, or an AI gateway.</p>
          </Card>
        </section>

        <section className="bg-white rounded-xl border border-slate-200">
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-200">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search requirements…" className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64" />
            <select value={sort} onChange={(e) => setSort(e.target.value as any)} className="border border-slate-300 rounded-md px-2 py-1.5 text-sm">
              <option value="id">Sort: ID</option><option value="score">Sort: Score</option><option value="weighted">Sort: Weighted</option>
            </select>
            {(fit !== "All" || imp !== "All" || q) && <button onClick={() => { setFit("All"); setImp("All"); setQ(""); }} className="text-sm text-violet-700 hover:underline">Clear filters</button>}
            <span className="ml-auto text-sm text-slate-500">{rows.length} of {R.length}</span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr><th className="text-left p-3">ID</th><th className="text-left p-3">Requirement</th><th className="p-3">Importance</th><th className="p-3">Maturity</th><th className="p-3">Fit</th><th className="text-left p-3 w-48">Eval score</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <>
                  <tr key={r.id} onClick={() => setOpen(open === r.id ? null : r.id)} className="border-t border-slate-100 hover:bg-violet-50 cursor-pointer">
                    <td className="p-3 font-mono text-xs text-slate-500">{r.id}</td>
                    <td className="p-3"><div className="font-medium">{r.title}</div><div className="text-slate-500 text-xs">{r.desc}</div></td>
                    <td className="p-3 text-center"><Pill l={r.imp} /></td>
                    <td className="p-3 text-center"><Pill l={r.mat} /></td>
                    <td className="p-3 text-center"><span className={`text-xs px-2 py-0.5 rounded ${fitColor[r.fit]}`}>{r.fit}</span></td>
                    <td className="p-3"><div className="flex items-center gap-2"><div className="flex-1 h-2.5 bg-slate-100 rounded"><div className={`h-2.5 rounded ${barColor(r.score)}`} style={{ width: `${r.score * 10}%` }} /></div><span className="font-semibold tabular-nums w-10">{r.score}/10</span></div></td>
                  </tr>
                  {open === r.id && (
                    <tr key={r.id + "x"} className="bg-violet-50/60"><td /><td colSpan={5} className="p-3 pt-0 text-slate-700"><b>Rationale:</b> {r.why}{r.evaluator && <span className="text-slate-500"> · Evaluator: {r.evaluator}</span>}</td></tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </section>
        <p className="text-xs text-slate-400">Click a row to see the rationale. Scores are an initial assessment based on Tines's public capabilities and should be validated by the named evaluators.</p>
      </main>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "rose" }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="text-xs uppercase text-slate-500">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${tone === "rose" ? "text-rose-600" : "text-violet-800"}`}>{value}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="bg-white rounded-xl border border-slate-200 p-5"><h2 className="text-sm font-semibold text-slate-600 mb-3">{title}</h2>{children}</div>;
}
function Pill({ l }: { l: Lvl }) {
  const c = l === "H" ? "bg-violet-600 text-white" : l === "M" ? "bg-violet-200 text-violet-900" : "bg-slate-200 text-slate-700";
  return <span className={`inline-block w-7 text-xs py-0.5 rounded ${c}`}>{l}</span>;
}

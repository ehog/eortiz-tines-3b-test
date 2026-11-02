import { useCallback, useEffect, useRef, useState } from "react";

type Asset = {
  id: string;
  name: string;
  category: string;
  vendor: string;
  risk_score: number;
  discovered_by: string;
  first_seen_user: string;
  status: "blocked" | "pending_review" | "allowed" | "denied";
  issue_key: string | null;
  justification: string | null;
  approver: string | null;
  updated_at: string;
};

type Issue = {
  key: string;
  fields: {
    summary: string;
    description: string;
    reporter: { emailAddress: string };
    status: { name: string };
    updated: string;
    customfield_asset_id: string;
  };
};

const branch = new URLSearchParams(window.location.search).get("branch");

function url(path: string, params: Record<string, string> = {}) {
  const search = new URLSearchParams(params);
  if (branch) search.set("branch", branch);
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

const STATUS_STYLE: Record<Asset["status"], string> = {
  blocked: "border-rose-400/40 bg-rose-400/10 text-rose-200",
  pending_review: "border-amber-300/40 bg-amber-300/10 text-amber-100",
  allowed: "border-lime-300/40 bg-lime-300/10 text-lime-200",
  denied: "border-zinc-400/30 bg-zinc-400/10 text-zinc-300",
};

const STATUS_LABEL: Record<Asset["status"], string> = {
  blocked: "blocked",
  pending_review: "in review",
  allowed: "allowed",
  denied: "denied",
};

const CATEGORY_LABEL: Record<string, string> = {
  genai_app: "GenAI app",
  browser_extension: "Browser extension",
  mcp_server: "MCP server",
  ai_agent: "AI agent",
  model: "Model",
  ai_saas: "AI SaaS",
};

function riskTone(score: number) {
  if (score >= 80) return "text-rose-300";
  if (score >= 60) return "text-amber-300";
  return "text-lime-300";
}

export default function App() {
  const [view, setView] = useState<"employee" | "admin">("employee");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [assetsRes, issuesRes] = await Promise.all([
        fetch(url("/onyx/api")),
        fetch(url("/jira/api", { resource: "search" })),
      ]);
      if (!assetsRes.ok || !issuesRes.ok) throw new Error("mock API error");
      const assetsBody = (await assetsRes.json()) as { assets: Asset[] };
      const issuesBody = (await issuesRes.json()) as { issues: Issue[] };
      setAssets(assetsBody.assets ?? []);
      setIssues(issuesBody.issues ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "failed to load");
    } finally {
      inFlight.current = false;
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const settle = useCallback(async () => {
    for (const wait of [1200, 2500]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      await refresh();
    }
  }, [refresh]);

  async function requestAccess(asset: Asset, justification: string) {
    setBusy(asset.id);
    setFlash(null);
    try {
      const res = await fetch(url("/request-access"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: asset.id,
          requester: asset.first_seen_user,
          businessJustification: justification,
        }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(body.error ?? res.status));
      const key =
        (body.issue as Issue | undefined)?.key ?? String(body.issue_key ?? "");
      setFlash(`${asset.name} sent for review — Jira ticket ${key}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "request failed");
    } finally {
      setBusy(null);
    }
  }

  async function decide(issue: Issue, decision: "Allow" | "Deny") {
    setBusy(issue.key);
    setFlash(null);
    try {
      const res = await fetch(
        url("/jira/api", { resource: "transitions", key: issue.key }),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transition: { to: decision } }),
        },
      );
      if (!res.ok) throw new Error(`transition failed (${res.status})`);
      setFlash(
        `${issue.key} moved to ${decision} — syncing the decision back to Onyx…`,
      );
      await refresh();
      await settle();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "transition failed");
    } finally {
      setBusy(null);
    }
  }

  const blocked = assets.filter((asset) => asset.status === "blocked");
  const pending = assets.filter((asset) => asset.status === "pending_review");
  const allowed = assets.filter((asset) => asset.status === "allowed");
  const openIssues = issues.filter((issue) =>
    ["Open", "In Review"].includes(issue.fields.status.name),
  );

  return (
    <div className="min-h-screen bg-[#07080c] font-[Chivo_Mono,ui-monospace,monospace] text-zinc-200 selection:bg-lime-300/30">
      <title>AI asset portal — Onyx x 3B</title>
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      <link
        href="https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@300;400;500;700&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,800&display=swap"
        rel="stylesheet"
      />

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 12% 8%, rgba(163,230,53,0.14), transparent 45%), radial-gradient(circle at 88% 0%, rgba(244,63,94,0.12), transparent 40%), linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "auto, auto, 48px 48px, 48px 48px",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-12">
        <header className="flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
          <div>
            <p className="text-xs tracking-[0.4em] text-lime-300/80 uppercase">
              Onyx Security · shadow AI governance
            </p>
            <h1 className="mt-3 font-[Bricolage_Grotesque,serif] text-5xl leading-[0.95] font-extrabold tracking-tight text-white">
              AI asset
              <span className="text-lime-300">.</span>
              <br />
              approval desk
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-zinc-400">
              Every newly discovered AI asset is blocked the moment Onyx sees it.
              Employees raise a Jira request here; an admin moves the ticket to{" "}
              <span className="text-zinc-200">Allow</span> and 3B pushes the
              decision straight back into Onyx.
            </p>
          </div>

          <div className="flex flex-col items-end gap-4">
            <div className="flex rounded-full border border-white/15 bg-white/5 p-1 text-xs uppercase tracking-[0.2em]">
              {(["employee", "admin"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  className={`rounded-full px-4 py-2 transition ${
                    view === mode
                      ? "bg-lime-300 text-black"
                      : "text-zinc-400 hover:text-zinc-100"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            <div className="flex gap-3 text-right text-xs text-zinc-500">
              <Metric label="blocked" value={blocked.length} tone="text-rose-300" />
              <Metric label="in review" value={pending.length} tone="text-amber-300" />
              <Metric label="allowed" value={allowed.length} tone="text-lime-300" />
            </div>
          </div>
        </header>

        {(flash || error) && (
          <div
            className={`mt-8 border-l-2 px-4 py-3 text-sm ${
              error
                ? "border-rose-400 bg-rose-400/10 text-rose-200"
                : "border-lime-300 bg-lime-300/10 text-lime-100"
            }`}
          >
            {error ?? flash}
          </div>
        )}

        {!loaded ? (
          <p className="mt-16 animate-pulse text-sm text-zinc-500">
            Loading asset inventory…
          </p>
        ) : view === "employee" ? (
          <EmployeeView
            blocked={blocked}
            pending={pending}
            allowed={allowed}
            busy={busy}
            onRequest={requestAccess}
          />
        ) : (
          <AdminView
            issues={openIssues}
            assets={assets}
            busy={busy}
            onDecide={decide}
          />
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="min-w-20 border border-white/10 bg-black/40 px-3 py-2">
      <div className={`text-2xl font-bold ${tone}`}>{value}</div>
      <div className="tracking-[0.2em] uppercase">{label}</div>
    </div>
  );
}

function EmployeeView({
  blocked,
  pending,
  allowed,
  busy,
  onRequest,
}: {
  blocked: Asset[];
  pending: Asset[];
  allowed: Asset[];
  busy: string | null;
  onRequest: (asset: Asset, justification: string) => void;
}) {
  return (
    <div className="mt-12 grid gap-12 lg:grid-cols-[1.6fr_1fr]">
      <section>
        <SectionTitle
          eyebrow={`${blocked.length} blocked`}
          title="Blocked for you right now"
        />
        {blocked.length === 0 ? (
          <Empty>Nothing is blocked. Enjoy the quiet.</Empty>
        ) : (
          <ul className="mt-6 space-y-4">
            {blocked.map((asset) => (
              <BlockedCard
                key={asset.id}
                asset={asset}
                busy={busy === asset.id}
                onRequest={onRequest}
              />
            ))}
          </ul>
        )}
      </section>

      <aside className="space-y-10">
        <div>
          <SectionTitle eyebrow="waiting on an admin" title="Your open requests" />
          {pending.length === 0 ? (
            <Empty>No requests in review.</Empty>
          ) : (
            <ul className="mt-6 space-y-3">
              {pending.map((asset) => (
                <li
                  key={asset.id}
                  className="border border-amber-300/20 bg-amber-300/5 px-4 py-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm text-zinc-100">{asset.name}</span>
                    <span className="text-xs text-amber-200">
                      {asset.issue_key}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-400">
                    {asset.justification}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <SectionTitle eyebrow="cleared by security" title="Approved assets" />
          <ul className="mt-6 space-y-2 text-sm">
            {allowed.map((asset) => (
              <li
                key={asset.id}
                className="flex items-baseline justify-between border-b border-white/5 pb-2 text-zinc-300"
              >
                <span>{asset.name}</span>
                <span className="text-xs text-lime-300/80">
                  {asset.approver ?? "policy"}
                </span>
              </li>
            ))}
            {allowed.length === 0 && <Empty>Nothing approved yet.</Empty>}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function BlockedCard({
  asset,
  busy,
  onRequest,
}: {
  asset: Asset;
  busy: boolean;
  onRequest: (asset: Asset, justification: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [justification, setJustification] = useState("");

  return (
    <li className="group border border-white/10 bg-white/[0.02] transition hover:border-lime-300/30">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="font-[Bricolage_Grotesque,serif] text-2xl font-medium text-white">
              {asset.name}
            </h3>
            <Badge status={asset.status} />
          </div>
          <p className="mt-2 text-xs tracking-wide text-zinc-500 uppercase">
            {CATEGORY_LABEL[asset.category] ?? asset.category} · {asset.vendor} ·
            found via {asset.discovered_by.replace("_", " ")}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            first seen for {asset.first_seen_user}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold ${riskTone(asset.risk_score)}`}>
            {asset.risk_score}
          </div>
          <div className="text-[10px] tracking-[0.25em] text-zinc-500 uppercase">
            risk
          </div>
        </div>
      </div>

      {open ? (
        <form
          className="border-t border-white/10 p-5"
          onSubmit={(event) => {
            event.preventDefault();
            onRequest(asset, justification);
          }}
        >
          <label className="text-xs tracking-[0.2em] text-zinc-500 uppercase">
            Business justification
          </label>
          <textarea
            required
            minLength={10}
            rows={3}
            value={justification}
            onChange={(event) => setJustification(event.target.value)}
            placeholder="What will you use it for, and what data will it touch?"
            className="mt-2 w-full resize-none border border-white/10 bg-black/60 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-lime-300/60"
          />
          <div className="mt-3 flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="bg-lime-300 px-4 py-2 text-xs tracking-[0.2em] text-black uppercase transition hover:bg-lime-200 disabled:opacity-40"
            >
              {busy ? "filing ticket…" : "raise Jira request"}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="px-4 py-2 text-xs tracking-[0.2em] text-zinc-500 uppercase hover:text-zinc-300"
            >
              cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="w-full border-t border-white/10 px-5 py-3 text-left text-xs tracking-[0.2em] text-zinc-400 uppercase transition group-hover:text-lime-300"
        >
          request approval →
        </button>
      )}
    </li>
  );
}

function AdminView({
  issues,
  assets,
  busy,
  onDecide,
}: {
  issues: Issue[];
  assets: Asset[];
  busy: string | null;
  onDecide: (issue: Issue, decision: "Allow" | "Deny") => void;
}) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));

  return (
    <div className="mt-12 space-y-12">
      <section>
        <SectionTitle
          eyebrow={`${issues.length} awaiting decision`}
          title="Jira review queue"
        />
        {issues.length === 0 ? (
          <Empty>Queue is clear.</Empty>
        ) : (
          <ul className="mt-6 space-y-4">
            {issues.map((issue) => {
              const asset = byId.get(issue.fields.customfield_asset_id);
              return (
                <li
                  key={issue.key}
                  className="border border-white/10 bg-white/[0.02] p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs tracking-[0.25em] text-lime-300/80 uppercase">
                        {issue.key} · {issue.fields.status.name}
                      </p>
                      <h3 className="mt-2 font-[Bricolage_Grotesque,serif] text-2xl text-white">
                        {issue.fields.summary}
                      </h3>
                      <p className="mt-1 text-xs text-zinc-500">
                        raised by {issue.fields.reporter.emailAddress}
                        {asset ? ` · risk ${asset.risk_score}` : ""}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={busy === issue.key}
                        onClick={() => onDecide(issue, "Allow")}
                        className="bg-lime-300 px-4 py-2 text-xs tracking-[0.2em] text-black uppercase transition hover:bg-lime-200 disabled:opacity-40"
                      >
                        allow
                      </button>
                      <button
                        disabled={busy === issue.key}
                        onClick={() => onDecide(issue, "Deny")}
                        className="border border-rose-400/50 px-4 py-2 text-xs tracking-[0.2em] text-rose-200 uppercase transition hover:bg-rose-400/10 disabled:opacity-40"
                      >
                        deny
                      </button>
                    </div>
                  </div>
                  <pre className="mt-4 overflow-x-auto border-l border-white/10 pl-4 text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
                    {issue.fields.description}
                  </pre>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle eyebrow="onyx inventory" title="All discovered assets" />
        <div className="mt-6 overflow-x-auto border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-[10px] tracking-[0.25em] text-zinc-500 uppercase">
              <tr>
                <th className="px-4 py-3">asset</th>
                <th className="px-4 py-3">category</th>
                <th className="px-4 py-3">risk</th>
                <th className="px-4 py-3">ticket</th>
                <th className="px-4 py-3">status</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-t border-white/5">
                  <td className="px-4 py-3 text-zinc-200">
                    {asset.name}
                    <span className="ml-2 text-xs text-zinc-600">
                      {asset.id}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500 uppercase">
                    {CATEGORY_LABEL[asset.category] ?? asset.category}
                  </td>
                  <td className={`px-4 py-3 ${riskTone(asset.risk_score)}`}>
                    {asset.risk_score}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-500">
                    {asset.issue_key ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge status={asset.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Badge({ status }: { status: Asset["status"] }) {
  return (
    <span
      className={`border px-2 py-1 text-[10px] tracking-[0.2em] uppercase ${STATUS_STYLE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
}: {
  eyebrow: string;
  title: string;
}) {
  return (
    <div>
      <p className="text-[10px] tracking-[0.35em] text-zinc-500 uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-2 font-[Bricolage_Grotesque,serif] text-3xl font-medium text-white">
        {title}
      </h2>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-6 border border-dashed border-white/10 px-4 py-6 text-center text-xs tracking-wide text-zinc-500 uppercase">
      {children}
    </p>
  );
}

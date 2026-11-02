import { useState } from "react";

declare global {
  interface Window { __SUBMIT_URL__: string }
}

type RequestType = "next_ip" | "host" | "a" | "cname";
type Field =
  | "fqdn" | "ip_address" | "network" | "canonical_name"
  | "dns_view" | "network_view";

const TYPES: { id: RequestType; label: string; hint: string }[] = [
  { id: "next_ip", label: "IP reservation", hint: "Next available IP in a network" },
  { id: "host", label: "Host record", hint: "DNS + IPAM in one object" },
  { id: "a", label: "A record", hint: "Name to a specific IPv4" },
  { id: "cname", label: "CNAME", hint: "Alias to another name" },
];

const FIELDS: Record<RequestType, Field[]> = {
  next_ip: ["network", "network_view"],
  host: ["fqdn", "ip_address", "network", "dns_view"],
  a: ["fqdn", "ip_address", "dns_view"],
  cname: ["fqdn", "canonical_name", "dns_view"],
};

const META: Record<Field, { label: string; placeholder: string }> = {
  fqdn: { label: "FQDN", placeholder: "app01.corp.orbia.com" },
  ip_address: { label: "IP address", placeholder: "10.20.30.15" },
  network: { label: "Network (CIDR)", placeholder: "10.20.30.0/24" },
  canonical_name: { label: "Canonical name", placeholder: "target.corp.orbia.com" },
  dns_view: { label: "DNS view", placeholder: "default" },
  network_view: { label: "Network view", placeholder: "default" },
};

type Result =
  | { kind: "ok"; ritm: string; summary: string }
  | { kind: "error"; messages: string[] };

function TypePicker(p: { value: RequestType; onChange: (t: RequestType) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => p.onChange(t.id)}
          className={`rounded-lg border p-3 text-left transition ${
            p.value === t.id
              ? "border-indigo-600 bg-indigo-50 ring-1 ring-indigo-600"
              : "border-slate-200 hover:border-slate-300"
          }`}
        >
          <div className="text-sm font-medium text-slate-900">{t.label}</div>
          <div className="text-xs text-slate-500">{t.hint}</div>
        </button>
      ))}
    </div>
  );
}

function ResultBanner({ result }: { result: Result }) {
  if (result.kind === "ok") {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm">
        <div className="font-medium text-emerald-900">Submitted as {result.ritm}</div>
        <div className="text-emerald-800">{result.summary} is being provisioned.</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {result.messages.map((m) => <div key={m}>{m}</div>)}
    </div>
  );
}

export default function App() {
  const [type, setType] = useState<RequestType>("host");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(window.__SUBMIT_URL__, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_type: type, ...values }),
      });
      const body = await res.json();
      if (!res.ok) {
        setResult({ kind: "error", messages: body.errors ?? ["Submission failed"] });
      } else {
        const summary = body.fqdn ?? body.network ?? "Your request";
        setResult({ kind: "ok", ritm: body.ritmNumber, summary });
        setValues({});
      }
    } catch {
      setResult({ kind: "error", messages: ["Could not reach the server"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 py-12">
      <form
        onSubmit={submit}
        className="mx-auto max-w-xl space-y-6 rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
      >
        <header>
          <h1 className="text-xl font-semibold text-slate-900">DDI request</h1>
          <p className="text-sm text-slate-500">
            Request an IP address or DNS record. Provisioned automatically in Infoblox.
          </p>
        </header>

        <TypePicker value={type} onChange={(t) => { setType(t); setResult(null); }} />

        <div className="space-y-4">
          {FIELDS[type].map((f) => (
            <label key={f} className="block">
              <span className="text-sm font-medium text-slate-700">{META[f].label}</span>
              <input
                value={values[f] ?? ""}
                onChange={(e) => set(f, e.target.value)}
                placeholder={META[f].placeholder}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </label>
          ))}
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Business justification</span>
            <textarea
              rows={3}
              value={values.business_justification ?? ""}
              onChange={(e) => set("business_justification", e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </label>
        </div>

        {result && <ResultBanner result={result} />}

        <button
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? "Submitting…" : "Submit request"}
        </button>
      </form>
    </div>
  );
}

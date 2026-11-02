import { type Catalog, type NvdCandidate, readStdinJson } from "./kev";

const WINDOW_HOURS = 72;
const MAX_CANDIDATES = 150;
const catalog = await readStdinJson<Catalog>();
const inKev = new Set(catalog.vulnerabilities.map((v) => v.cveId));

const fmt = (d: Date) => d.toISOString().replace(/\.\d+Z$/, ".000Z");
const end = new Date();
const start = new Date(end.getTime() - WINDOW_HOURS * 3600_000);

async function fetchSeverity(severity: "CRITICAL" | "HIGH"): Promise<any[]> {
  const url = new URL("https://services.nvd.nist.gov/rest/json/cves/2.0");
  url.searchParams.set("pubStartDate", fmt(start));
  url.searchParams.set("pubEndDate", fmt(end));
  url.searchParams.set("cvssV3Severity", severity);
  url.searchParams.set("noRejected", "");
  url.searchParams.set("resultsPerPage", "2000");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url.toString().replace("noRejected=", "noRejected"));
    if (res.ok) return ((await res.json()) as any).vulnerabilities ?? [];
    console.error(JSON.stringify({ event: "nvd_retry", severity, status: res.status, attempt }));
    await Bun.sleep(7000 * attempt);
  }
  throw new Error(`NVD ${severity} query failed after retries`);
}

let raw: any[] = [];
let nvdError: string | null = null;
try {
  raw = await fetchSeverity("CRITICAL");
  await Bun.sleep(6500); // NVD's keyless rate limit is 5 requests per rolling 30 seconds.
  raw = raw.concat(await fetchSeverity("HIGH"));
} catch (e) {
  nvdError = String((e as Error).message ?? e);
  console.error(JSON.stringify({ event: "nvd_unavailable", error: nvdError }));
}

const seen = new Set<string>();
const candidates: NvdCandidate[] = [];
for (const item of raw) {
  const c = item.cve;
  if (!c?.id || seen.has(c.id) || inKev.has(c.id) || c.vulnStatus === "Rejected") continue;
  seen.add(c.id);
  const m = c.metrics?.cvssMetricV31?.[0] ?? c.metrics?.cvssMetricV30?.[0];
  const description = c.descriptions?.find((d: any) => d.lang === "en")?.value ?? "";
  if (!m || !description) continue;
  candidates.push({
    cveId: c.id,
    published: String(c.published).slice(0, 10),
    cvss: Number(m.cvssData?.baseScore ?? 0),
    severity: String(m.cvssData?.baseSeverity ?? ""),
    cwes: [...new Set<string>((c.weaknesses ?? []).flatMap((w: any) => w.description.map((d: any) => d.value)).filter((v: string) => v.startsWith("CWE-")))],
    description: description.slice(0, 600),
    references: (c.references ?? []).slice(0, 4).map((r: any) => String(r.url)),
  });
}
candidates.sort((a, b) => b.cvss - a.cvss || b.published.localeCompare(a.published));
const trimmed = candidates.slice(0, MAX_CANDIDATES);

console.error(JSON.stringify({ event: "nvd_candidates", fetched: raw.length, candidates: candidates.length, forwarded: trimmed.length }));
console.log(JSON.stringify({ catalog, candidates: trimmed, nvd: { windowHours: WINDOW_HOURS, fetched: raw.length, error: nvdError } }));

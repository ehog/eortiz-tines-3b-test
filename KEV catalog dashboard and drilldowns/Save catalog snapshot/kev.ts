export const FEED_URL =
  "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";
export const CATALOG_PATH = "/storage/kev/catalog.json";
export const DUE_SOON_DAYS = 14;
export const WATCHLIST_DUE_DAYS = 21;
export const WATCHLIST_RETENTION_DAYS = 14;

export type Vulnerability = {
  cveId: string;
  vendor: string;
  product: string;
  name: string;
  dateAdded: string;
  description: string;
  requiredAction: string;
  dueDate: string;
  ransomware: "Yes" | "No";
  notes: string;
  cwes: string[];
  source: "CISA KEV" | "NVD";
  cvss?: number;
  severity?: string;
  aiRationale?: string;
};

export type Catalog = {
  title: string;
  catalogVersion: string;
  dateReleased: string;
  syncedAt: string;
  source: "volume" | "live";
  count: number;
  kevCount: number;
  watchlistCount: number;
  vulnerabilities: Vulnerability[];
};

export type NvdCandidate = {
  cveId: string;
  published: string;
  cvss: number;
  severity: string;
  cwes: string[];
  description: string;
  references: string[];
};

export type RemediationStatus = "overdue" | "due_soon" | "on_track";

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function remediationStatus(dueDate: string, today = todayUtc()): RemediationStatus {
  if (dueDate < today) return "overdue";
  if (dueDate <= addDays(today, DUE_SOON_DAYS)) return "due_soon";
  return "on_track";
}

export function sortVulns(list: Vulnerability[]): Vulnerability[] {
  return list.sort((a, b) => b.dateAdded.localeCompare(a.dateAdded) || b.cveId.localeCompare(a.cveId));
}

export async function fetchKevFeed(): Promise<Catalog> {
  const res = await fetch(FEED_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`CISA feed returned HTTP ${res.status}`);
  const raw: any = await res.json();
  if (!Array.isArray(raw?.vulnerabilities)) throw new Error("CISA feed missing vulnerabilities array");
  const vulnerabilities = sortVulns(
    raw.vulnerabilities.map((v: any): Vulnerability => ({
      cveId: String(v.cveID ?? ""),
      vendor: String(v.vendorProject ?? "").trim(),
      product: String(v.product ?? "").trim(),
      name: String(v.vulnerabilityName ?? ""),
      dateAdded: String(v.dateAdded ?? ""),
      description: String(v.shortDescription ?? ""),
      requiredAction: String(v.requiredAction ?? ""),
      dueDate: String(v.dueDate ?? ""),
      ransomware: v.knownRansomwareCampaignUse === "Known" ? "Yes" : "No",
      notes: String(v.notes ?? ""),
      cwes: Array.isArray(v.cwes) ? v.cwes.map(String) : [],
      source: "CISA KEV",
    })),
  );
  return {
    title: String(raw.title ?? "CISA Catalog of Known Exploited Vulnerabilities"),
    catalogVersion: String(raw.catalogVersion ?? ""),
    dateReleased: String(raw.dateReleased ?? ""),
    syncedAt: new Date().toISOString(),
    source: "live",
    count: vulnerabilities.length,
    kevCount: vulnerabilities.length,
    watchlistCount: 0,
    vulnerabilities,
  };
}

export async function readStdinJson<T>(): Promise<T> {
  const text = await Bun.stdin.text();
  if (!text.trim()) throw new Error("Expected JSON on stdin from the upstream step");
  return JSON.parse(text) as T;
}

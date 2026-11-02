import { addDays, type Catalog, CATALOG_PATH, DUE_SOON_DAYS, fetchKevFeed, readStdinJson, remediationStatus, todayUtc } from "./kev";

type Query = { kind: "catalog" | "metrics"; method: string; params: Record<string, string> };

function respond(status: number, body: unknown) {
  const reason: Record<number, string> = { 200: "OK", 400: "Bad Request", 405: "Method Not Allowed" };
  console.log(`HTTP/1.1 ${status} ${reason[status] ?? ""}\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\n\r\n${JSON.stringify(body)}`);
}

const { kind, method, params } = await readStdinJson<Query>();
if (method !== "GET") {
  respond(405, { error: "Only GET is supported" });
  process.exit(0);
}
const file = Bun.file(CATALOG_PATH);
const catalog: Catalog = (await file.exists()) ? { ...(await file.json()), source: "volume" } : await fetchKevFeed();
const today = todayUtc();
const meta = {
  title: catalog.title, catalogVersion: catalog.catalogVersion, dateReleased: catalog.dateReleased,
  syncedAt: catalog.syncedAt, source: catalog.source, today, dueSoonDays: DUE_SOON_DAYS,
  total: catalog.count, kevCount: catalog.kevCount ?? catalog.count, watchlistCount: catalog.watchlistCount ?? 0,
};

if (kind === "catalog") {
  const status = params.status;
  if (status && !["overdue", "due_soon", "on_track"].includes(status)) {
    respond(400, { error: "status must be overdue, due_soon, or on_track" });
    process.exit(0);
  }
  const vendor = params.vendor?.toLowerCase();
  const product = params.product?.toLowerCase();
  const cve = params.cve?.toUpperCase();
  const search = params.q?.toLowerCase();
  const source = params.source?.toLowerCase();
  const vulnerabilities = catalog.vulnerabilities.filter((v) => {
    if (cve && v.cveId.toUpperCase() !== cve) return false;
    if (vendor && v.vendor.toLowerCase() !== vendor) return false;
    if (product && v.product.toLowerCase() !== product) return false;
    if (params.ransomware === "true" && v.ransomware !== "Yes") return false;
    if (params.ransomware === "false" && v.ransomware !== "No") return false;
    if (source === "kev" && v.source === "NVD") return false;
    if (source === "watchlist" && v.source !== "NVD") return false;
    if (status && remediationStatus(v.dueDate, today) !== status) return false;
    if (search && !`${v.cveId} ${v.vendor} ${v.product} ${v.name} ${v.description}`.toLowerCase().includes(search)) return false;
    return true;
  });
  respond(200, { meta, count: vulnerabilities.length, vulnerabilities });
  process.exit(0);
}

const limit = Math.min(Math.max(Number(params.top ?? 10) || 10, 1), 50);
const kev = catalog.vulnerabilities.filter((v) => v.source !== "NVD");
const since30 = addDays(today, -30);
const status = { overdue: 0, due_soon: 0, on_track: 0 };
const vendors = new Map<string, number>();
const products = new Map<string, { vendor: string; product: string; count: number }>();
const months = new Map<string, number>();
let addedLast30 = 0;
let ransomware = 0;
for (const v of kev) {
  status[remediationStatus(v.dueDate, today)]++;
  if (v.dateAdded >= since30) addedLast30++;
  if (v.ransomware === "Yes") ransomware++;
  vendors.set(v.vendor, (vendors.get(v.vendor) ?? 0) + 1);
  const key = `${v.vendor}\u0000${v.product}`;
  const p = products.get(key) ?? { vendor: v.vendor, product: v.product, count: 0 };
  p.count++;
  products.set(key, p);
  months.set(v.dateAdded.slice(0, 7), (months.get(v.dateAdded.slice(0, 7)) ?? 0) + 1);
}
const monthKeys: string[] = [];
const cursor = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
for (let i = 0; i < 12; i++) {
  monthKeys.unshift(cursor.toISOString().slice(0, 7));
  cursor.setUTCMonth(cursor.getUTCMonth() - 1);
}
respond(200, {
  meta,
  totals: {
    vulnerabilities: kev.length, addedLast30Days: addedLast30, ransomwareLinked: ransomware,
    overdue: status.overdue, dueSoon: status.due_soon, onTrack: status.on_track,
    vendors: vendors.size, products: products.size, watchlist: catalog.vulnerabilities.length - kev.length,
  },
  topVendors: [...vendors].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([vendor, count]) => ({ vendor, count })),
  topProducts: [...products.values()].sort((a, b) => b.count - a.count).slice(0, limit),
  addedByMonth: monthKeys.map((month) => ({ month, count: months.get(month) ?? 0 })),
});

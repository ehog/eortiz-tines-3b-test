import { mkdir } from "node:fs/promises";
import { addDays, type Catalog, CATALOG_PATH, readStdinJson, sortVulns, todayUtc, type Vulnerability, WATCHLIST_RETENTION_DAYS } from "./kev";

type Input = { catalog: Catalog; watchlist: Vulnerability[]; nvd: { error: string | null } };
const { catalog, watchlist } = await readStdinJson<Input>();
if (!catalog?.vulnerabilities?.length) throw new Error("Upstream catalog is empty; keeping previous snapshot");

const previousFile = Bun.file(CATALOG_PATH);
const previous: Catalog | null = (await previousFile.exists()) ? await previousFile.json() : null;

const kevIds = new Set(catalog.vulnerabilities.map((v) => v.cveId));
const cutoff = addDays(todayUtc(), -WATCHLIST_RETENTION_DAYS);
const merged = new Map<string, Vulnerability>();
for (const v of previous?.vulnerabilities ?? []) {
  if (v.source === "NVD" && v.dateAdded >= cutoff && !kevIds.has(v.cveId)) merged.set(v.cveId, v);
}
for (const v of watchlist) if (!kevIds.has(v.cveId)) merged.set(v.cveId, v);
const watch = [...merged.values()];
const promoted = (previous?.vulnerabilities ?? []).filter((v) => v.source === "NVD" && kevIds.has(v.cveId)).map((v) => v.cveId);

const previousKev = new Set((previous?.vulnerabilities ?? []).filter((v) => v.source !== "NVD").map((v) => v.cveId));
const newKev = previous ? catalog.vulnerabilities.filter((v) => !previousKev.has(v.cveId)).map((v) => v.cveId) : [];

const vulnerabilities = sortVulns([...catalog.vulnerabilities, ...watch]);
const snapshot: Catalog = {
  ...catalog,
  source: "volume",
  count: vulnerabilities.length,
  kevCount: catalog.vulnerabilities.length,
  watchlistCount: watch.length,
  vulnerabilities,
};

await mkdir("/storage/kev", { recursive: true });
await Bun.write(CATALOG_PATH, JSON.stringify(snapshot));

const summary = {
  syncedAt: snapshot.syncedAt,
  catalogVersion: snapshot.catalogVersion,
  kevCount: snapshot.kevCount,
  watchlistCount: snapshot.watchlistCount,
  newKevCves: newKev,
  newWatchlistCves: watchlist.map((v) => v.cveId),
  promotedToKev: promoted,
};
console.error(JSON.stringify({ event: "snapshot_saved", kev: snapshot.kevCount, watchlist: watch.length, newKev: newKev.length }));
console.log(JSON.stringify(summary, null, 2));

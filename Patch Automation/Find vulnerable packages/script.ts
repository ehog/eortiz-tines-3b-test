import { findingId, openState } from "./state";

const ORG_ID = "104352";
const BASE = "https://console.automox.com/api";
const MAX_ALERTS = 5;

async function get(path: string): Promise<any> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}o=${ORG_ID}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (attempt === 3) {
        throw new Error(`Automox GET ${path} failed after ${attempt} attempts: network or timeout error. Check connector connectivity and tunnel health.`, { cause: error });
      }
      console.error(`Automox GET ${path}: network or timeout error; retry ${attempt}/2`);
      await Bun.sleep(1000 * 2 ** (attempt - 1) + Math.random() * 250);
      continue;
    }
    if (res.ok) return res.json();
    const retryable = [408, 429, 500, 502, 503, 504].includes(res.status);
    await res.body?.cancel();
    if (!retryable || attempt === 3) {
      throw new Error(`Automox GET ${path} failed: HTTP ${res.status} after ${attempt} attempt(s). ${res.status === 502 ? "Check connector connectivity and tunnel health." : "Check Automox availability, permissions, and request parameters."}`);
    }
    const retryAfter = res.headers.get("Retry-After");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const delay = retryAfter === null ? 0 : Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    if (delay > 10_000) throw new Error(`Automox GET ${path}: HTTP ${res.status}; Retry-After exceeds the retry budget. Retry the scan later.`);
    console.error(`Automox GET ${path}: HTTP ${res.status}; retry ${attempt}/2`);
    await Bun.sleep(Math.max(Number.isFinite(delay) ? delay : 0, 1000 * 2 ** (attempt - 1)) + Math.random() * 250);
  }
  throw new Error(`Automox GET ${path}: retry budget exhausted`);
}

const orgPackages: any[] = await get(`/orgs/${ORG_ID}/packages`);
const vulnerable = new Set(
  orgPackages
    .filter((p) => p.severity && p.severity !== "no_known_cves")
    .map((p) => String(p.package_id ?? p.id)),
);

const devices: any[] = await get("/servers");

const matches: { device_id: number; device_name: string; package_id: string; package_name: string; severity: string }[] = [];
for (const device of devices.slice(0, 500)) {
  const packages: any[] = await get(`/servers/${device.id}/packages`);
  for (const pkg of packages) {
    const id = String(pkg.package_id ?? pkg.id);
    if (!vulnerable.has(id)) continue;
    matches.push({
      device_id: device.id,
      device_name: device.name ?? device.display_name ?? String(device.id),
      package_id: id,
      package_name: pkg.name ?? pkg.display_name ?? id,
      severity: pkg.severity ?? "unknown",
    });
  }
}

console.error(`devices=${devices.length} vulnerable_packages=${vulnerable.size} matches=${matches.length}`);

const now = new Date().toISOString();
const db = openState();
const upsert = db.prepare(`
  INSERT INTO findings (id, device_id, device_name, package_id, package_name, severity, first_seen, last_seen, status)
  VALUES ($id, $device_id, $device_name, $package_id, $package_name, $severity, $now, $now, 'open')
  ON CONFLICT(id) DO UPDATE SET
    device_name = $device_name,
    package_name = $package_name,
    severity = $severity,
    last_seen = $now
`);
db.transaction(() => {
  for (const m of matches) {
    upsert.run({
      $id: findingId(m.device_id, m.package_id),
      $device_id: String(m.device_id),
      $device_name: m.device_name,
      $package_id: m.package_id,
      $package_name: m.package_name,
      $severity: m.severity,
      $now: now,
    });
  }
  // Anything Automox no longer reports as vulnerable is resolved and drops out of the console.
  db.prepare("DELETE FROM findings WHERE last_seen < $now").run({ $now: now });
  db.prepare("INSERT INTO runs (ran_at, devices, matches) VALUES ($now, $devices, $matches)").run({
    $now: now,
    $devices: devices.length,
    $matches: matches.length,
  });
})();
db.close();

if (matches.length === 0) process.exit(0);

console.log(JSON.stringify({ organization_id: ORG_ID, total_matches: matches.length, items: matches.slice(0, MAX_ALERTS) }));

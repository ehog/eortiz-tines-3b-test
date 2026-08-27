import { findingId, openState } from "./state";

const ORG_ID = "104352";
const BASE = "https://console.automox.com/api";
const MAX_ALERTS = 5;

async function get(path: string): Promise<any> {
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}o=${ORG_ID}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
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

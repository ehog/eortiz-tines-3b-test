const DEFENDER_BASE = "https://api.securitycenter.microsoft.com";

const log = (entry: Record<string, unknown>) =>
  console.error(JSON.stringify({ step: "enrich-defender", ts: new Date().toISOString(), ...entry }));

async function defenderGet<T>(path: string): Promise<T | null> {
  const maxAttempts = 5;
  let delayMs = 2000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(`${DEFENDER_BASE}${path}`, { headers: { Accept: "application/json" } });
    if (res.status === 404) return null;
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    const body = await res.text().catch(() => "");
    if (!retryable || attempt === maxAttempts) {
      log({ event: "defender_error", path, status: res.status, body: body.slice(0, 300) });
      return null;
    }
    const wait = Number(res.headers.get("retry-after") ?? 0) * 1000 || delayMs;
    log({ event: "defender_rate_limited", path, status: res.status, wait_ms: wait });
    await new Promise((r) => setTimeout(r, wait));
    delayMs = Math.min(delayMs * 2, 60000);
  }
  return null;
}

const odata = (v: string) => v.replace(/'/g, "''");

type Machine = {
  id: string;
  computerDnsName?: string;
  lastIpAddress?: string;
  lastExternalIpAddress?: string;
  exposureLevel?: string;
  riskScore?: string;
  healthStatus?: string;
  onboardingStatus?: string;
  osPlatform?: string;
  isAadJoined?: boolean;
};

const machineByKey = new Map<string, Machine | null>();

async function findMachine(hostname: string | null, ip: string): Promise<Machine | null> {
  const key = `${hostname ?? ""}|${ip}`;
  if (machineByKey.has(key)) return machineByKey.get(key) ?? null;

  let machine: Machine | null = null;
  if (hostname) {
    const short = hostname.split(".")[0].toLowerCase();
    const res = await defenderGet<{ value: Machine[] }>(
      `/api/machines?$filter=${encodeURIComponent(`startswith(computerDnsName,'${odata(short)}')`)}&$top=20`,
    );
    machine =
      res?.value?.find((m) => (m.computerDnsName ?? "").toLowerCase() === hostname.toLowerCase()) ??
      res?.value?.find((m) => (m.computerDnsName ?? "").toLowerCase().split(".")[0] === short) ??
      null;
  }
  if (!machine && ip) {
    const res = await defenderGet<{ value: Machine[] }>(
      `/api/machines?$filter=${encodeURIComponent(`lastIpAddress eq '${odata(ip)}' or lastExternalIpAddress eq '${odata(ip)}'`)}&$top=5`,
    );
    machine = res?.value?.[0] ?? null;
  }
  machineByKey.set(key, machine);
  return machine;
}

const alertsByMachine = new Map<string, any[]>();
async function activeAlerts(machineId: string) {
  if (alertsByMachine.has(machineId)) return alertsByMachine.get(machineId)!;
  const res = await defenderGet<{ value: any[] }>(
    `/api/machines/${encodeURIComponent(machineId)}/alerts`,
  );
  const alerts = (res?.value ?? [])
    .filter((a) => a.status !== "Resolved")
    .map((a) => ({
      id: a.id,
      title: a.title,
      severity: a.severity,
      status: a.status,
      category: a.category,
      detectedAt: a.alertCreationTime,
    }));
  alertsByMachine.set(machineId, alerts);
  return alerts;
}

const cveCache = new Map<string, { publicExploit: boolean; exploitInKit: boolean; cvss: number | null }>();
async function cveIntel(cve: string) {
  if (cveCache.has(cve)) return cveCache.get(cve)!;
  const v = await defenderGet<any>(`/api/vulnerabilities/${encodeURIComponent(cve)}`);
  const intel = {
    publicExploit: Boolean(v?.publicExploit),
    exploitInKit: Boolean(v?.exploitInKit),
    cvss: typeof v?.cvssV3 === "number" ? v.cvssV3 : null,
  };
  cveCache.set(cve, intel);
  return intel;
}

const input = await Bun.stdin.text();
const payload = JSON.parse(input) as { runAt: string; since: string; until: string; detections: any[] };

const enriched: any[] = [];
for (const d of payload.detections) {
  const machine = await findMachine(d.hostname, d.ip);
  const alerts = machine ? await activeAlerts(machine.id) : [];

  let publicExploit = false;
  let exploitInKit = false;
  let maxCvss: number | null = null;
  for (const cve of d.cves ?? []) {
    const intel = await cveIntel(cve);
    publicExploit = publicExploit || intel.publicExploit;
    exploitInKit = exploitInKit || intel.exploitInKit;
    if (intel.cvss !== null) maxCvss = Math.max(maxCvss ?? 0, intel.cvss);
  }

  const defender = machine
    ? {
        found: true,
        machineId: machine.id,
        computerDnsName: machine.computerDnsName ?? null,
        exposureLevel: machine.exposureLevel ?? "Unknown",
        riskScore: machine.riskScore ?? "Unknown",
        healthStatus: machine.healthStatus ?? "Unknown",
        onboardingStatus: machine.onboardingStatus ?? "Unknown",
        osPlatform: machine.osPlatform ?? null,
        externalIp: machine.lastExternalIpAddress ?? null,
        activeAlerts: alerts,
      }
    : { found: false, exposureLevel: "Unknown", riskScore: "Unknown", activeAlerts: [] as any[] };

  enriched.push({
    ...d,
    internetFacing: d.internetFacing || Boolean(machine?.lastExternalIpAddress && machine.lastExternalIpAddress === d.ip),
    exploit: { qualys: Boolean(d.qualysExploitAvailable), defenderPublicExploit: publicExploit, exploitInKit, maxCvss },
    defender,
  });

  log({
    event: "enriched",
    qid: d.qid,
    asset_id: d.assetId,
    hostname: d.hostname,
    defender_found: defender.found,
    exposure_level: defender.exposureLevel,
    active_alerts: defender.activeAlerts.length,
    public_exploit: publicExploit,
  });
}

console.log(JSON.stringify({ ...payload, detections: enriched }));

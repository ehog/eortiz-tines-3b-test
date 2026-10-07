import { XMLParser } from "fast-xml-parser";

const QUALYS_BASE = process.env.QUALYS_URL ?? "https://qualysapi.qualys.com";
const STATE_DIR = "/storage/vulnrisk_state";
const LOOKBACK_HOURS_DEFAULT = 4;

type Log = Record<string, unknown>;
const log = (entry: Log) =>
  console.error(JSON.stringify({ step: "fetch-qualys", ts: new Date().toISOString(), ...entry }));

function qualysTimestamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function qualysGet(path: string, params: Record<string, string>): Promise<string> {
  const url = new URL(path, QUALYS_BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const maxAttempts = 6;
  let delayMs = 5000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-Requested-With": "3b-workflow", Accept: "application/xml" },
    });
    if (res.ok) return await res.text();

    const retryableStatus = res.status === 409 || res.status === 429 || res.status >= 500;
    const body = await res.text().catch(() => "");
    if (!retryableStatus || attempt === maxAttempts) {
      throw new Error(`Qualys ${path} failed: ${res.status} ${body.slice(0, 500)}`);
    }
    // Qualys signals concurrency/rate limits with 409 plus X-RateLimit-ToWait-Sec.
    const toWait = Number(res.headers.get("x-ratelimit-towait-sec") ?? res.headers.get("retry-after") ?? 0);
    const waitMs = toWait > 0 ? toWait * 1000 : delayMs;
    log({ event: "qualys_rate_limited", status: res.status, attempt, wait_ms: waitMs });
    await new Promise((r) => setTimeout(r, waitMs));
    delayMs = Math.min(delayMs * 2, 120000);
  }
  throw new Error("unreachable");
}

const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true });
const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

function isPrivateIp(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
  if (p[0] === 10 || p[0] === 127) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  return false;
}

async function readWatermark(): Promise<string | null> {
  try {
    const raw = await Bun.file(`${STATE_DIR}/watermark.json`).text();
    return JSON.parse(raw).since ?? null;
  } catch {
    return null;
  }
}

async function readTrackedAssetIds(): Promise<string[]> {
  try {
    const open = JSON.parse(await Bun.file(`${STATE_DIR}/open-tickets.json`).text()) as Record<string, { assetId: string }>;
    return [...new Set(Object.values(open).map((t) => t.assetId).filter(Boolean))];
  } catch {
    return [];
  }
}

async function fetchDetections(extra: Record<string, string>) {
  const hosts: any[] = [];
  let idMin: string | undefined;
  for (let page = 0; page < 50; page++) {
    const params: Record<string, string> = {
      action: "list",
      severities: "4,5",
      status: "New,Active,Re-Opened",
      show_igs: "0",
      truncation_limit: "500",
      ...extra,
    };
    if (idMin) params.id_min = idMin;
    const xml = await qualysGet("/api/2.0/fo/asset/host/vm/detection/", params);
    const doc = parser.parse(xml);
    const response = doc?.HOST_LIST_VM_DETECTION_OUTPUT?.RESPONSE;
    const pageHosts = asArray(response?.HOST_LIST?.HOST);
    hosts.push(...pageHosts);
    const next: string | undefined = response?.WARNING?.URL;
    if (!next) break;
    const m = /[?&]id_min=(\d+)/.exec(next);
    if (!m) break;
    idMin = m[1];
    log({ event: "qualys_page", hosts: pageHosts.length, next_id_min: idMin });
  }
  return hosts;
}

async function fetchKnowledgeBase(qids: string[]) {
  const kb = new Map<string, { title: string; cves: string[]; exploitAvailable: boolean; malwareAvailable: boolean; patchable: boolean }>();
  for (let i = 0; i < qids.length; i += 200) {
    const batch = qids.slice(i, i + 200);
    const xml = await qualysGet("/api/2.0/fo/knowledge_base/vuln/", {
      action: "list",
      ids: batch.join(","),
      details: "All",
    });
    const doc = parser.parse(xml);
    for (const v of asArray(doc?.KNOWLEDGE_BASE_VULN_LIST_OUTPUT?.RESPONSE?.VULN_LIST?.VULN)) {
      const cves = asArray(v?.CVE_LIST?.CVE).map((c: any) => String(c?.ID ?? "")).filter(Boolean);
      kb.set(String(v.QID), {
        title: String(v.TITLE ?? ""),
        cves,
        exploitAvailable: String(v?.CORRELATION?.EXPLOITS ?? v?.EXPLOITABILITY ?? "") !== "" ||
          asArray(v?.THREAT_INTELLIGENCE?.THREAT_INTEL).some((t: any) => /exploit/i.test(String(t?.["#text"] ?? t ?? ""))),
        malwareAvailable: v?.CORRELATION?.MALWARE !== undefined,
        patchable: String(v.PATCHABLE ?? "0") === "1",
      });
    }
  }
  return kb;
}

const now = new Date();
const watermark = await readWatermark();
const since = watermark ?? qualysTimestamp(new Date(now.getTime() - LOOKBACK_HOURS_DEFAULT * 3600_000));
log({ event: "run_start", since, watermark_found: watermark !== null });

const hosts = await fetchDetections({ detection_updated_since: since });

// Closure detection needs current full state for assets we already have tickets for,
// since the incremental query alone cannot distinguish "unchanged" from "fixed".
const trackedAssetIds = await readTrackedAssetIds();
const stillOpen = new Set<string>();
for (let i = 0; i < trackedAssetIds.length; i += 500) {
  const batch = trackedAssetIds.slice(i, i + 500);
  const trackedHosts = await fetchDetections({ ids: batch.join(",") });
  for (const host of trackedHosts) {
    for (const d of asArray(host?.DETECTION_LIST?.DETECTION)) {
      stillOpen.add(`qualys-${String(d.QID)}-${String(host.ID)}`);
    }
  }
}

const detections: any[] = [];
for (const host of hosts) {
  const ip = String(host.IP ?? "");
  for (const d of asArray(host?.DETECTION_LIST?.DETECTION)) {
    const severity = Number(d.SEVERITY ?? 0);
    if (severity < 4) continue;
    detections.push({
      qid: String(d.QID),
      severity,
      status: String(d.STATUS ?? ""),
      firstFound: String(d.FIRST_FOUND_DATETIME ?? ""),
      lastFound: String(d.LAST_FOUND_DATETIME ?? ""),
      timesFound: Number(d.TIMES_FOUND ?? 0),
      port: d.PORT ? String(d.PORT) : null,
      protocol: d.PROTOCOL ? String(d.PROTOCOL) : null,
      results: String(d.RESULTS ?? "").slice(0, 2000),
      assetId: String(host.ID),
      hostId: host.ASSET_ID ? String(host.ASSET_ID) : null,
      ip,
      hostname: String(host.DNS ?? host.NETBIOS ?? "").trim() || null,
      os: String(host.OS ?? ""),
      trackingMethod: String(host.TRACKING_METHOD ?? ""),
      internetFacing: ip !== "" && !isPrivateIp(ip),
    });
  }
}

const qids = [...new Set(detections.map((d) => d.qid))];
const kb = qids.length ? await fetchKnowledgeBase(qids) : new Map();
for (const d of detections) {
  const k = kb.get(d.qid);
  d.title = k?.title ?? `QID ${d.qid}`;
  d.cves = k?.cves ?? [];
  d.qualysExploitAvailable = k?.exploitAvailable ?? false;
  d.malwareAvailable = k?.malwareAvailable ?? false;
  d.patchable = k?.patchable ?? false;
}

log({
  event: "run_fetched",
  hosts: hosts.length,
  detections: detections.length,
  qids: qids.length,
  tracked_assets_checked: trackedAssetIds.length,
  tracked_still_open: stillOpen.size,
});

console.log(
  JSON.stringify({
    runAt: now.toISOString(),
    since,
    until: qualysTimestamp(now),
    trackedAssetIdsChecked: trackedAssetIds,
    stillOpenCorrelationIds: [...stillOpen],
    detections,
  }),
);

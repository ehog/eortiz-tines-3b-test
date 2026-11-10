import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { normalizeAlert } from "./soclib";

const BASE = (process.env.CROWD_STRIKE_URL || "https://api.crowdstrike.com").replace(/\/$/, "");
const DIR = "/storage/crowdstrike_cursor";
const CURSOR = `${DIR}/cursor.json`;
const FIRST_RUN_LOOKBACK_MS = 15 * 60 * 1000;
const PAGE = 500;
const MAX_ALERTS = 2000;

const log = (event: string, data: Record<string, unknown> = {}) =>
  console.error(JSON.stringify({ event, ...data }));

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`CrowdStrike ${init?.method ?? "GET"} ${path.split("?")[0]} → ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function loadCursor(): Promise<{ since: string; seen: string[] }> {
  try {
    const c = JSON.parse(await readFile(CURSOR, "utf8"));
    if (typeof c.since === "string") return { since: c.since, seen: Array.isArray(c.seen) ? c.seen : [] };
  } catch {}
  return { since: new Date(Date.now() - FIRST_RUN_LOOKBACK_MS).toISOString(), seen: [] };
}

const SEV: Record<string, string> = { critical: "critical", high: "high", medium: "medium", low: "low", informational: "low" };
function confidence(n: unknown): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "medium";
  return v >= 80 ? "high" : v >= 50 ? "medium" : "low";
}

function toGateInput(a: any) {
  const sevName = String(a.severity_name ?? "").toLowerCase();
  return {
    source: "crowdstrike",
    externalId: a.composite_id ?? a.id,
    title: a.display_name ?? a.name ?? "CrowdStrike Falcon alert",
    description: a.description,
    severity: SEV[sevName] ?? "medium",
    confidence: confidence(a.confidence),
    host: a.device?.hostname ?? a.hostname,
    user: a.user_name ?? a.user_principal,
    indicator: a.sha256 ?? a.ioc_value ?? a.filename,
    tags: [a.tactic, a.technique, a.product, a.type].filter(Boolean),
    falcon: {
      compositeId: a.composite_id,
      status: a.status,
      tactic: a.tactic,
      technique: a.technique,
      createdTimestamp: a.created_timestamp,
      falconLink: a.falcon_host_link,
      cmdline: a.cmdline,
      deviceId: a.device?.device_id,
    },
  };
}

const cursor = await loadCursor();
const filter = `created_timestamp:>='${cursor.since}'`;
const ids: string[] = [];
for (let offset = 0; offset < MAX_ALERTS; offset += PAGE) {
  const q = new URLSearchParams({ filter, sort: "created_timestamp.asc", limit: String(PAGE), offset: String(offset) });
  const r = await api(`/alerts/queries/alerts/v2?${q}`);
  const page: string[] = r.resources ?? [];
  ids.push(...page);
  const total = r.meta?.pagination?.total ?? 0;
  if (page.length < PAGE || ids.length >= total) break;
}

const seen = new Set(cursor.seen);
const fresh = ids.filter((id) => !seen.has(id));
const entities: any[] = [];
for (let i = 0; i < fresh.length; i += 1000) {
  const r = await api(`/alerts/entities/alerts/v2`, {
    method: "POST",
    body: JSON.stringify({ composite_ids: fresh.slice(i, i + 1000) }),
  });
  entities.push(...(r.resources ?? []));
}
entities.sort((a, b) => String(a.created_timestamp).localeCompare(String(b.created_timestamp)));

const receivedAt = new Date().toISOString();
const lines = entities.map((e, i) =>
  JSON.stringify({ intake: "crowdstrike", alert: normalizeAlert(toGateInput(e), receivedAt, `cs-${i}`) }),
);

// Advance cursor to newest alert timestamp; keep IDs at that boundary to avoid re-ingesting (filter is >=).
const newest = entities.length ? String(entities[entities.length - 1].created_timestamp) : cursor.since;
const boundary = entities.filter((e) => String(e.created_timestamp) === newest).map((e) => e.composite_id);
const nextSeen = newest === cursor.since ? [...new Set([...cursor.seen, ...boundary])] : boundary;
await mkdir(DIR, { recursive: true });
await writeFile(`${CURSOR}.tmp`, JSON.stringify({ since: newest, seen: nextSeen.slice(-5000), updatedAt: receivedAt }));
await rename(`${CURSOR}.tmp`, CURSOR);

log("crowdstrike_poll", { since: cursor.since, matched: ids.length, forwarded: lines.length, nextSince: newest });
if (lines.length) console.log(lines.join("\n"));

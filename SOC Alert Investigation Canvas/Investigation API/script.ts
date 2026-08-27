import { readdir, stat } from "node:fs/promises";
import {
  ROOT,
  SOURCES,
  approvalToken,
  dir,
  readHttpRequest,
  readJson,
  respondJson,
  sanitizeId,
  type Entities,
  type Incident,
  type LogRecord,
  type SourceResult,
} from "./lib";

const request = await readHttpRequest();
const id = request.query.get("id");

if (!id) {
  await respondJson(200, { investigations: await recentInvestigations() });
  process.exit(0);
}

let investigationId: string;
try {
  investigationId = sanitizeId(id);
} catch {
  await respondJson(400, { error: "invalid investigation id" });
  process.exit(0);
}

const base = dir(investigationId);
const incident = await readJson<Incident>(`${base}/incident.json`);
if (!incident) {
  await respondJson(404, { error: "investigation not found", investigationId });
  process.exit(0);
}

const entities = await readJson<Entities>(`${base}/entities.json`);
const timeline = await readJson<Record<string, unknown>>(`${base}/timeline.json`);
const summary = await readJson<Record<string, unknown>>(`${base}/summary.json`);
const servicenow = await readJson<Record<string, unknown>>(`${base}/servicenow.json`);
const actions = (await readJson<Record<string, unknown>[]>(`${base}/actions.json`)) ?? [];

const sources: Record<string, unknown> = {};
const logs: LogRecord[] = [];
for (const source of SOURCES) {
  const result = await readJson<SourceResult>(`${base}/${source}.json`);
  sources[source] = result
    ? {
        source: result.source,
        label: result.label,
        status: result.status,
        mocked: result.mocked,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        recordCount: result.recordCount,
        eventCount: (result.events ?? []).length,
        data: result.data,
      }
    : { source, status: "pending" };
  logs.push(...(result?.logs ?? []));
}
logs.push(...((summary?.logs as LogRecord[] | undefined) ?? []));
logs.push(...((servicenow?.logs as LogRecord[] | undefined) ?? []));
logs.sort((a, b) => a.ts.localeCompare(b.ts));

const proofpoint = (sources.proofpoint as { data?: { screenshots?: Record<string, unknown>[] } }).data;
const device = entities?.devices?.[0] ?? "";

await respondJson(200, {
  investigationId,
  incident,
  entities,
  sources,
  timeline,
  summary,
  servicenow,
  actions,
  logs,
  screenshots: proofpoint?.screenshots ?? [],
  isolate: {
    device,
    token: device ? await approvalToken(investigationId, device) : null,
    alreadyIsolated: actions.some((action) => action.action === "isolate" && action.outcome === "isolated"),
  },
  status: {
    incident: true,
    entities: Boolean(entities),
    sources: Object.fromEntries(
      SOURCES.map((source) => [source, (sources[source] as { status: string }).status === "ok"]),
    ),
    timeline: Boolean(timeline),
    summary: Boolean(summary),
    servicenow: Boolean(servicenow),
    complete: Boolean(summary) && Boolean(servicenow),
  },
});

async function recentInvestigations() {
  let directories: string[] = [];
  try {
    directories = await readdir(ROOT);
  } catch {
    return [];
  }
  const items = [];
  for (const directory of directories) {
    if (!/^[A-Za-z0-9._-]{4,80}$/.test(directory)) continue;
    const incidentFile = await readJson<Incident>(`${ROOT}/${directory}/incident.json`);
    if (!incidentFile) continue;
    const summaryFile = await readJson<Record<string, unknown>>(`${ROOT}/${directory}/summary.json`);
    const ticket = await readJson<Record<string, unknown>>(`${ROOT}/${directory}/servicenow.json`);
    let modified = incidentFile.receivedAt;
    try {
      modified = (await stat(`${ROOT}/${directory}`)).mtime.toISOString();
    } catch {
      // fall back to the recorded receive time
    }
    items.push({
      investigationId: directory,
      title: incidentFile.title,
      source: incidentFile.source,
      severity: incidentFile.severity,
      receivedAt: incidentFile.receivedAt,
      modified,
      disposition: summaryFile?.disposition ?? null,
      confidence: summaryFile?.confidence ?? null,
      servicenowNumber: ticket?.number ?? null,
    });
  }
  return items.sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 25);
}

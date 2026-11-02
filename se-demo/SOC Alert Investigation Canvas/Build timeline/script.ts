import {
  SOURCES,
  dir,
  logger,
  readInput,
  readJson,
  sanitizeId,
  writeJson,
  type Incident,
  type SourceResult,
  type TimelineEvent,
} from "./lib";

const input = await readInput();
const payload = (input.json ?? {}) as Record<string, unknown>;
const investigationId = sanitizeId(payload.investigationId ?? input.query.get("id"));
const force = payload.force === true || input.query.get("force") === "true";
const audit = logger(investigationId, "Build timeline");

const incident = await readJson<Incident>(`${dir(investigationId)}/incident.json`);
if (!incident) throw new Error(`no incident.json for ${investigationId}`);

const results: SourceResult[] = [];
const missing: string[] = [];
for (const source of SOURCES) {
  const result = await readJson<SourceResult>(`${dir(investigationId)}/${source}.json`);
  if (result) results.push(result);
  else missing.push(source);
}

// Every enricher links here, so this step runs once per source; empty stdout suppresses the
// downstream summary until the last enricher has landed.
if (missing.length > 0 && !force) {
  audit.log("timeline_waiting", missing.join(","), `have=${results.length}/${SOURCES.length}`);
  process.exit(0);
}

const events: TimelineEvent[] = [
  {
    id: "incident-0",
    ts: incident.alertTime,
    source: incident.source,
    title: `Alert raised: ${incident.title}`,
    detail: incident.description,
    entity: incident.vendorId,
    severity: incident.severity,
  },
  ...results.flatMap((result) => result.events ?? []),
].sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));

const timeline = {
  investigationId,
  builtAt: new Date().toISOString(),
  alertTime: incident.alertTime,
  sources: results.map((result) => ({
    source: result.source,
    label: result.label,
    status: result.status,
    recordCount: result.recordCount,
    durationMs: result.durationMs,
    eventCount: (result.events ?? []).length,
  })),
  missingSources: missing,
  forced: force && missing.length > 0,
  eventCount: events.length,
  events,
};

await writeJson(`${dir(investigationId)}/timeline.json`, timeline);
audit.log("timeline_built", investigationId, `events=${events.length},sources=${results.length}`);
console.log(JSON.stringify({ investigationId, eventCount: events.length, sources: results.length }));

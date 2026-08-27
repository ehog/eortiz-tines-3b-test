import {
  dir,
  logger,
  readInput,
  readJson,
  sanitizeId,
  writeJson,
  type Entities,
  type Incident,
  type SourceResult,
} from "./lib";
import { LABEL, SOURCE, USE_MOCK, collect } from "./client";

const input = (await readInput()).json as Record<string, unknown> | null;
const investigationId = sanitizeId(input?.investigationId);
const audit = logger(investigationId, `Enrich ${LABEL}`);
const startedAt = new Date();

const incident = await readJson<Incident>(`${dir(investigationId)}/incident.json`);
const entities = await readJson<Entities>(`${dir(investigationId)}/entities.json`);
if (!incident) throw new Error(`no incident.json for ${investigationId}`);
if (!entities) throw new Error(`no entities.json for ${investigationId}`);

audit.log("source_started", SOURCE, USE_MOCK ? "mock" : "live");

try {
  const { data, events, recordCount } = await collect({ incident, entities, audit });
  const finishedAt = new Date();
  const result: SourceResult = {
    investigationId,
    source: SOURCE,
    label: LABEL,
    status: "ok",
    mocked: USE_MOCK,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    recordCount,
    data,
    events: events.map((event, index) => ({ ...event, id: `${SOURCE}-${index}`, source: SOURCE })),
    logs: audit.records,
  };
  audit.log("source_complete", SOURCE, "ok", result.durationMs);
  result.logs = audit.records;
  await writeJson(`${dir(investigationId)}/${SOURCE}.json`, result);
  console.log(JSON.stringify({ investigationId, source: SOURCE, status: "ok", recordCount }));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  audit.log("source_failed", SOURCE, `error:${message}`, Date.now() - startedAt.getTime());
  throw error;
}

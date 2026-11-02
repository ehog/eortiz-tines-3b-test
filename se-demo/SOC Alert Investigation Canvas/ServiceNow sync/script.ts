import {
  SOURCES,
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
import { appendWorkNote, createIncident, findIncident } from "./client";

const input = await readInput();
const payload = (input.json ?? {}) as Record<string, unknown>;
const investigationId = sanitizeId(payload.investigationId ?? input.query.get("id"));
const audit = logger(investigationId, "ServiceNow sync");

const base = dir(investigationId);
const incident = await readJson<Incident>(`${base}/incident.json`);
const entities = await readJson<Entities>(`${base}/entities.json`);
const summary = await readJson<Record<string, unknown>>(`${base}/summary.json`);
if (!incident || !entities || !summary) throw new Error(`investigation ${investigationId} is not ready for ServiceNow`);

const counts: string[] = [];
for (const source of SOURCES) {
  const result = await readJson<SourceResult>(`${base}/${source}.json`);
  counts.push(`${source}: ${result ? `${result.recordCount} records` : "not collected"}`);
}

const digest = [
  `3B investigation ${investigationId}`,
  `Disposition: ${summary.disposition} (confidence ${summary.confidence}%)`,
  "",
  String(summary.summary ?? ""),
  "",
  "Enrichment coverage:",
  ...counts.map((line) => `- ${line}`),
  "",
  "Entities:",
  `- users: ${entities.users.join(", ") || "none"}`,
  `- devices: ${entities.devices.join(", ") || "none"}`,
  `- external IPs: ${entities.externalIps.join(", ") || "none"}`,
  `- domains: ${entities.domains.join(", ") || "none"}`,
  `- hashes: ${entities.hashes.join(", ") || "none"}`,
  "",
  "Recommended actions:",
  ...(Array.isArray(summary.recommendedActions) ? summary.recommendedActions.map((a) => `- ${a}`) : ["- none supplied"]),
].join("\n");

const existing = await findIncident(incident.correlationId, audit);
const record = existing
  ? await appendWorkNote(existing, digest, audit)
  : await createIncident({ incident, summary, digest }, audit);

await writeJson(`${base}/servicenow.json`, {
  investigationId,
  action: existing ? "work_note_appended" : "created",
  correlationId: incident.correlationId,
  ...record,
  workNote: digest,
  logs: audit.records,
});

audit.log("servicenow_synced", String(record.number), existing ? "appended" : "created");
console.log(
  JSON.stringify({ investigationId, servicenow: record.number, action: existing ? "appended" : "created" }),
);

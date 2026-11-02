import { ROOT, type Incident, type LogRecord } from "./lib";

type Audit = { log: (event: string, target: string, outcome: string, durationMs?: number) => void; records: LogRecord[] };

export interface SnowRecord {
  sysId: string;
  number: string;
  url: string;
  state: string;
  assignmentGroup: string;
  priority: string;
  shortDescription: string;
}

/** Flip to false and attach the ServiceNow connector to this step to go live; nothing else changes. */
export const USE_MOCK = true;

const INSTANCE = process.env.SERVICENOW_INSTANCE ?? "contoso-dev";
const TABLE = "sn_si_incident";
const BASE = `https://${INSTANCE}.service-now.com/api/now/table/${TABLE}`;

export async function findIncident(correlationId: string, audit: Audit): Promise<SnowRecord | null> {
  const started = Date.now();
  if (USE_MOCK) {
    // The mock instance is backed by the tickets recorded in previous investigations, so a repeat
    // alert for the same vendor correlation id appends a work note instead of duplicating a ticket.
    const existing = await findRecordedTicket(correlationId);
    audit.log("servicenow_lookup", correlationId, existing ? "found" : "not_found", Date.now() - started);
    return existing;
  }
  const response = await fetch(
    `${BASE}?sysparm_query=correlation_id=${encodeURIComponent(correlationId)}&sysparm_limit=1`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error(`ServiceNow lookup returned ${response.status}`);
  const payload = (await response.json()) as { result?: Record<string, string>[] };
  const first = (payload.result ?? [])[0];
  audit.log("servicenow_lookup", correlationId, first ? "found" : "not_found", Date.now() - started);
  return first ? toRecord(first) : null;
}

export async function createIncident(
  context: { incident: Incident; summary: Record<string, unknown>; digest: string },
  audit: Audit,
): Promise<SnowRecord> {
  const { incident, summary, digest } = context;
  const started = Date.now();
  const body = {
    correlation_id: incident.correlationId,
    short_description: `${incident.title} (${incident.source})`,
    description: `${summary.summary ?? ""}\n\n${digest}`,
    category: "Security incident",
    subcategory: incident.source === "defender" ? "Endpoint" : "Detection",
    urgency: urgencyFor(incident.severity),
    impact: urgencyFor(incident.severity),
    assignment_group: "Security Operations",
    work_notes: digest,
    u_source_system: "Microsoft Sentinel / Defender via 3B",
  };

  if (USE_MOCK) {
    const number = `SIR00${Math.abs(hash(incident.correlationId)) % 90_000 + 10_000}`;
    const record: SnowRecord = {
      sysId: hex(incident.correlationId),
      number,
      url: `https://${INSTANCE}.service-now.com/nav_to.do?uri=${TABLE}.do?sysparm_query=number=${number}`,
      state: "Analysis",
      assignmentGroup: "Security Operations",
      priority: priorityFor(incident.severity),
      shortDescription: body.short_description,
    };
    mockStore.set(incident.correlationId, record);    audit.log("servicenow_create", number, "created", Date.now() - started);
    return record;
  }

  const response = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`ServiceNow create returned ${response.status}: ${await response.text()}`);
  const payload = (await response.json()) as { result: Record<string, string> };
  audit.log("servicenow_create", payload.result.number, "created", Date.now() - started);
  return toRecord(payload.result);
}

export async function appendWorkNote(record: SnowRecord, digest: string, audit: Audit): Promise<SnowRecord> {
  const started = Date.now();
  if (USE_MOCK) {
    audit.log("servicenow_work_note", record.number, "appended", Date.now() - started);
    return record;
  }
  const response = await fetch(`${BASE}/${record.sysId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ work_notes: digest }),
  });
  if (!response.ok) throw new Error(`ServiceNow work note returned ${response.status}`);
  const payload = (await response.json()) as { result: Record<string, string> };
  audit.log("servicenow_work_note", record.number, "appended", Date.now() - started);
  return toRecord(payload.result);
}

const mockStore = new Map<string, SnowRecord>();

async function findRecordedTicket(correlationId: string): Promise<SnowRecord | null> {
  const cached = mockStore.get(correlationId);
  if (cached) return cached;
  const { readdir } = await import("node:fs/promises");
  let directories: string[] = [];
  try {
    directories = await readdir(ROOT);
  } catch {
    return null;
  }
  for (const directory of directories) {
    const file = Bun.file(`${ROOT}/${directory}/servicenow.json`);
    if (!(await file.exists())) continue;
    try {
      const record = (await file.json()) as SnowRecord & { correlationId?: string };
      if (record.correlationId === correlationId && record.number) {
        mockStore.set(correlationId, {
          sysId: record.sysId,
          number: record.number,
          url: record.url,
          state: record.state,
          assignmentGroup: record.assignmentGroup,
          priority: record.priority,
          shortDescription: record.shortDescription,
        });
        return mockStore.get(correlationId) ?? null;
      }
    } catch {
      // a partially written file is ignored rather than failing the sync
    }
  }
  return null;
}

function toRecord(result: Record<string, string>): SnowRecord {
  return {
    sysId: result.sys_id,
    number: result.number,
    url: `https://${INSTANCE}.service-now.com/nav_to.do?uri=${TABLE}.do?sys_id=${result.sys_id}`,
    state: result.state ?? "Analysis",
    assignmentGroup: result.assignment_group ?? "Security Operations",
    priority: result.priority ?? "3",
    shortDescription: result.short_description ?? "",
  };
}

function urgencyFor(severity: string): string {
  if (severity === "high") return "1";
  if (severity === "medium") return "2";
  return "3";
}

function priorityFor(severity: string): string {
  if (severity === "high") return "1 - Critical";
  if (severity === "medium") return "2 - High";
  return "3 - Moderate";
}

function hash(value: string): number {
  let total = 0;
  for (const char of value) total = (total * 31 + char.charCodeAt(0)) | 0;
  return total;
}

function hex(value: string): string {
  return Math.abs(hash(value)).toString(16).padStart(8, "0").repeat(4).slice(0, 32);
}

import { shiftIso } from "./lib";
import { mockDefender } from "./mock";
import type { CollectContext, CollectResult } from "./support";

export const SOURCE = "defender";
export const LABEL = "Microsoft Defender";

/** Flip to false and attach the Defender connector to this step to go live; nothing else changes. */
export const USE_MOCK = true;

const API = "https://api.securitycenter.microsoft.com/api";

export async function collect(context: CollectContext): Promise<CollectResult> {
  if (USE_MOCK) return mockDefender(context);
  return liveDefender(context);
}

async function liveDefender(context: CollectContext): Promise<CollectResult> {
  const { incident, entities, audit } = context;
  const windowStart = shiftIso(incident.alertTime, -120);
  const windowEnd = shiftIso(incident.alertTime, 120);
  const machines: Record<string, unknown>[] = [];
  const activity: Record<string, unknown>[] = [];

  for (const device of entities.devices) {
    const started = Date.now();
    const machine = await request<{ value: Record<string, unknown>[] }>(
      `${API}/machines?$filter=computerDnsName eq '${encodeURIComponent(device)}'`,
    );
    audit.log("defender_machine_lookup", device, "ok", Date.now() - started);
    machines.push(...(machine.value ?? []));

    const machineId = String((machine.value ?? [])[0]?.id ?? "");
    if (!machineId) continue;

    const huntStarted = Date.now();
    const hunt = await request<{ Results: Record<string, unknown>[] }>(`${API}/advancedqueries/run`, {
      method: "POST",
      body: JSON.stringify({
        Query: [
          `let start = datetime(${windowStart});`,
          `let end = datetime(${windowEnd});`,
          `DeviceProcessEvents | where DeviceId == "${machineId}" and Timestamp between (start .. end)`,
          "| project Timestamp, DeviceName, AccountName, FileName, ProcessCommandLine, InitiatingProcessFileName",
          "| order by Timestamp asc | take 200",
        ].join("\n"),
      }),
    });
    audit.log("defender_advanced_hunting", machineId, "ok", Date.now() - huntStarted);
    activity.push(...(hunt.Results ?? []));
  }

  return {
    data: { window: { start: windowStart, end: windowEnd }, machines, endpointActivity: activity, processTree: [] },
    events: activity.map((row) => ({
      ts: String(row.Timestamp ?? incident.alertTime),
      title: `Process: ${row.FileName ?? "unknown"}`,
      detail: String(row.ProcessCommandLine ?? ""),
      entity: String(row.DeviceName ?? ""),
      severity: "informational",
    })),
    recordCount: machines.length + activity.length,
  };
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Defender ${url} returned ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

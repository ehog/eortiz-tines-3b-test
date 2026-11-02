import { shiftIso } from "./lib";
import { mockSentinel } from "./mock";
import type { CollectContext, CollectResult } from "./support";

export const SOURCE = "sentinel";
export const LABEL = "Microsoft Sentinel";

/** Flip to false and attach the Log Analytics connector to this step to go live; nothing else changes. */
export const USE_MOCK = true;

const WORKSPACE_ID = process.env.SENTINEL_WORKSPACE_ID ?? "00000000-0000-0000-0000-000000000000";
const API = `https://api.loganalytics.io/v1/workspaces/${WORKSPACE_ID}/query`;

export async function collect(context: CollectContext): Promise<CollectResult> {
  if (USE_MOCK) return mockSentinel(context);
  return liveSentinel(context);
}

export function buildQueries(context: CollectContext): { entity: string; kind: string; query: string }[] {
  const { entities } = context;
  const queries: { entity: string; kind: string; query: string }[] = [];
  for (const user of entities.users.slice(0, 5)) {
    queries.push({
      entity: user,
      kind: "account",
      query: `SigninLogs | where UserPrincipalName =~ "${user}" | project TimeGenerated, AppDisplayName, IPAddress, Location, ResultType, ResultDescription | order by TimeGenerated asc | take 100`,
    });
  }
  for (const device of entities.devices.slice(0, 5)) {
    queries.push({
      entity: device,
      kind: "host",
      query: `SecurityEvent | where Computer =~ "${device}" | project TimeGenerated, Account, EventID, Activity | order by TimeGenerated asc | take 100`,
    });
  }
  for (const ip of entities.externalIps.slice(0, 10)) {
    queries.push({
      entity: ip,
      kind: "ip",
      query: `union isfuzzy=true CommonSecurityLog, AzureDiagnostics | where DestinationIP == "${ip}" or SourceIP == "${ip}" | project TimeGenerated, DeviceVendor, SourceIP, DestinationIP, DestinationPort, Activity | take 100`,
    });
  }
  return queries;
}

async function liveSentinel(context: CollectContext): Promise<CollectResult> {
  const { incident, audit } = context;
  const timespan = `${shiftIso(incident.alertTime, -1440)}/${shiftIso(incident.alertTime, 240)}`;
  const results: Record<string, unknown>[] = [];
  const events: CollectResult["events"] = [];

  for (const item of buildQueries(context)) {
    const started = Date.now();
    const response = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: item.query, timespan }),
    });
    if (!response.ok) throw new Error(`Sentinel query for ${item.entity} returned ${response.status}`);
    const payload = (await response.json()) as { tables?: { name: string; columns: { name: string }[]; rows: unknown[][] }[] };
    audit.log("sentinel_query", item.entity, "ok", Date.now() - started);
    for (const table of payload.tables ?? []) {
      const rows = table.rows.map((row) =>
        Object.fromEntries(table.columns.map((column, index) => [column.name, row[index]])),
      );
      results.push({ entity: item.entity, table: table.name, query: item.query, rows });
      for (const row of rows) {
        events.push({
          ts: String(row.TimeGenerated ?? incident.alertTime),
          title: `${table.name}: ${row.Activity ?? row.AppDisplayName ?? "event"}`,
          detail: JSON.stringify(row),
          entity: item.entity,
          severity: "informational",
        });
      }
    }
  }

  return { data: { timespan, queries: results }, events, recordCount: results.length };
}

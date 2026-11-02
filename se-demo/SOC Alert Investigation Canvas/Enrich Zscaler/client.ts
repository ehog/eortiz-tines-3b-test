import { shiftIso } from "./lib";
import { mockZscaler } from "./mock";
import type { CollectContext, CollectResult } from "./support";

export const SOURCE = "zscaler";
export const LABEL = "Zscaler Internet Access";

/** Flip to false and attach the Zscaler connector to this step to go live; nothing else changes. */
export const USE_MOCK = true;

const API = "https://api.zsapi.net/zia/api/v1";

export async function collect(context: CollectContext): Promise<CollectResult> {
  if (USE_MOCK) return mockZscaler(context);
  return liveZscaler(context);
}

async function liveZscaler(context: CollectContext): Promise<CollectResult> {
  const { incident, entities, audit } = context;
  const startTime = shiftIso(incident.alertTime, -240);
  const endTime = shiftIso(incident.alertTime, 240);
  const transactions: Record<string, unknown>[] = [];

  const targets = [...entities.domains, ...entities.externalIps, ...entities.users].slice(0, 20);
  for (const target of targets) {
    const started = Date.now();
    const response = await fetch(`${API}/webInsights/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startTime,
        endTime,
        filters: { search: target },
        pageSize: 200,
      }),
    });
    if (!response.ok) throw new Error(`Zscaler lookup for ${target} returned ${response.status}`);
    const payload = (await response.json()) as { records?: Record<string, unknown>[] };
    audit.log("zscaler_web_insights", target, "ok", Date.now() - started);
    transactions.push(...(payload.records ?? []));
  }

  return {
    data: { window: { start: startTime, end: endTime }, transactions },
    events: transactions.map((row) => ({
      ts: String(row.timestamp ?? incident.alertTime),
      title: `Proxy ${row.action ?? "transaction"}: ${row.url ?? row.host ?? "unknown"}`,
      detail: JSON.stringify(row),
      entity: String(row.user ?? ""),
      severity: "informational",
    })),
    recordCount: transactions.length,
  };
}

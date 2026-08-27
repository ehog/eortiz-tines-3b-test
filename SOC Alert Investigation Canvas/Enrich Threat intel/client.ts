import { mockThreatIntel } from "./mock";
import type { CollectContext, CollectResult } from "./support";

export const SOURCE = "threatintel";
export const LABEL = "Threat intelligence";

/** Flip to false and attach the threat-intel connector to this step to go live; nothing else changes. */
export const USE_MOCK = true;

const API = "https://www.virustotal.com/api/v3";

export async function collect(context: CollectContext): Promise<CollectResult> {
  if (USE_MOCK) return mockThreatIntel(context);
  return liveThreatIntel(context);
}

export function indicatorList(context: CollectContext): { value: string; type: string; path: string }[] {
  const { entities } = context;
  return [
    ...entities.externalIps.map((value) => ({ value, type: "ip", path: `ip_addresses/${value}` })),
    ...entities.domains.map((value) => ({ value, type: "domain", path: `domains/${value}` })),
    ...entities.hashes.map((value) => ({ value, type: "file", path: `files/${value}` })),
  ].slice(0, 40);
}

async function liveThreatIntel(context: CollectContext): Promise<CollectResult> {
  const { incident, audit } = context;
  const indicators: Record<string, unknown>[] = [];

  for (const indicator of indicatorList(context)) {
    const started = Date.now();
    const response = await fetch(`${API}/${indicator.path}`);
    if (!response.ok) {
      audit.log("threatintel_lookup", indicator.value, `error:${response.status}`, Date.now() - started);
      continue;
    }
    const payload = (await response.json()) as { data?: { attributes?: Record<string, unknown> } };
    const attributes = payload.data?.attributes ?? {};
    const stats = (attributes.last_analysis_stats ?? {}) as Record<string, number>;
    audit.log("threatintel_lookup", indicator.value, "ok", Date.now() - started);
    indicators.push({
      indicator: indicator.value,
      type: indicator.type,
      malicious: stats.malicious ?? 0,
      suspicious: stats.suspicious ?? 0,
      harmless: stats.harmless ?? 0,
      reputation: attributes.reputation ?? 0,
      firstSeen: attributes.first_submission_date ?? null,
      lastSeen: attributes.last_analysis_date ?? null,
      tags: attributes.tags ?? [],
    });
  }

  return {
    data: { indicators },
    events: indicators
      .filter((item) => Number(item.malicious) > 0)
      .map((item) => ({
        ts: incident.alertTime,
        title: `Malicious verdict for ${item.indicator}`,
        detail: `${item.malicious} engines flagged this ${item.type}`,
        entity: String(item.indicator),
        severity: "high",
      })),
    recordCount: indicators.length,
  };
}

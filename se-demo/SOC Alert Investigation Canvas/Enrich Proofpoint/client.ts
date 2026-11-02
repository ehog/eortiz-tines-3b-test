import { dir } from "./lib";
import { mockProofpoint } from "./mock";
import type { CollectContext, CollectResult } from "./support";

export const SOURCE = "proofpoint";
export const LABEL = "Proofpoint TAP";

/** Flip to false and attach the Proofpoint connector to this step to go live; nothing else changes. */
export const USE_MOCK = true;

const API = "https://tap-api-v2.proofpoint.com/v2";
export const MAX_SCREENSHOTS = 50;

export async function collect(context: CollectContext): Promise<CollectResult> {
  if (USE_MOCK) return mockProofpoint(context);
  return liveProofpoint(context);
}

async function liveProofpoint(context: CollectContext): Promise<CollectResult> {
  const { incident, entities, audit } = context;
  const messages: Record<string, unknown>[] = [];

  for (const user of entities.users.slice(0, 5)) {
    const started = Date.now();
    const response = await fetch(
      `${API}/siem/all?format=json&interval=${encodeURIComponent(
        `${new Date(new Date(incident.alertTime).getTime() - 86_400_000).toISOString()}/${incident.alertTime}`,
      )}`,
    );
    if (!response.ok) throw new Error(`Proofpoint SIEM query returned ${response.status}`);
    const payload = (await response.json()) as {
      messagesDelivered?: Record<string, unknown>[];
      messagesBlocked?: Record<string, unknown>[];
      clicksPermitted?: Record<string, unknown>[];
    };
    audit.log("proofpoint_siem_query", user, "ok", Date.now() - started);
    messages.push(
      ...(payload.messagesDelivered ?? []).filter((m) => JSON.stringify(m).includes(user)),
      ...(payload.messagesBlocked ?? []).filter((m) => JSON.stringify(m).includes(user)),
    );
  }

  const screenshots: Record<string, unknown>[] = [];
  const targets = messages.slice(0, MAX_SCREENSHOTS);
  for (const [index, message] of targets.entries()) {
    const guid = String(message.GUID ?? message.guid ?? index);
    const started = Date.now();
    const response = await fetch(`${API}/forensics?threatId=${encodeURIComponent(guid)}&format=png`);
    if (!response.ok) {
      audit.log("proofpoint_screenshot", guid, `error:${response.status}`, Date.now() - started);
      continue;
    }
    const file = `${String(index).padStart(3, "0")}.png`;
    await Bun.write(`${dir(incident.investigationId)}/screenshots/${file}`, await response.arrayBuffer());
    audit.log("proofpoint_screenshot", guid, "ok", Date.now() - started);
    screenshots.push({ index, file, contentType: "image/png", messageGuid: guid });
  }

  return {
    data: { messages, screenshots, screenshotCount: screenshots.length },
    events: messages.map((message) => ({
      ts: String(message.messageTime ?? incident.alertTime),
      title: `Mail: ${message.subject ?? "(no subject)"}`,
      detail: JSON.stringify(message),
      entity: String((message.recipient as string[] | undefined)?.[0] ?? ""),
      severity: "informational",
    })),
    recordCount: messages.length + screenshots.length,
  };
}

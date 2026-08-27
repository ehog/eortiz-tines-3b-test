import type { LogRecord } from "./lib";

type Audit = { log: (event: string, target: string, outcome: string, durationMs?: number) => void; records: LogRecord[] };

/** Flip to false and attach the Defender connector to this step to go live; nothing else changes. */
export const USE_MOCK = true;

const API = "https://api.securitycenter.microsoft.com/api";

export async function isolateDevice(context: {
  device: string;
  investigationId: string;
  comment: string;
  audit: Audit;
}): Promise<{ machineActionId: string; mocked: boolean }> {
  const { device, investigationId, comment, audit } = context;
  const started = Date.now();

  if (USE_MOCK) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const machineActionId = `mock-action-${investigationId.slice(-6)}-${Date.now().toString(36)}`;
    audit.log("defender_isolate", device, "mock_accepted", Date.now() - started);
    return { machineActionId, mocked: true };
  }

  const lookup = await fetch(`${API}/machines?$filter=computerDnsName eq '${encodeURIComponent(device)}'`, {
    headers: { Accept: "application/json" },
  });
  if (!lookup.ok) throw new Error(`Defender machine lookup returned ${lookup.status}`);
  const machines = (await lookup.json()) as { value?: { id: string }[] };
  const machineId = machines.value?.[0]?.id;
  if (!machineId) throw new Error(`Defender has no machine record for ${device}`);

  const response = await fetch(`${API}/machines/${machineId}/isolate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      Comment: comment || `Isolated from 3B investigation ${investigationId}`,
      IsolationType: "Full",
    }),
  });
  if (!response.ok) throw new Error(`Defender isolate returned ${response.status}: ${await response.text()}`);
  const action = (await response.json()) as { id: string };
  audit.log("defender_isolate", device, "accepted", Date.now() - started);
  return { machineActionId: action.id, mocked: false };
}

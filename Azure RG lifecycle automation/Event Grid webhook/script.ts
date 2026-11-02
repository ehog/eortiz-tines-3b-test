import { loadConfig } from "./config";
import { httpResponse, parseHttp, requestLine } from "./http";
import { log, main } from "./log";

const VALIDATION = "Microsoft.EventGrid.SubscriptionValidationEvent";
const WRITE_SUCCESS = "Microsoft.Resources.ResourceWriteSuccess";
const RG_SUBJECT = /^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)$/i;

function normalize(e: any) {
  return {
    id: e.id,
    type: e.eventType ?? e.type,
    subject: e.subject ?? "",
    data: e.data ?? {},
  };
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}) {
  process.stdout.write(httpResponse(status, JSON.stringify(body), headers));
}

main("Event Grid webhook", async () => {
  const msg = parseHttp(await Bun.stdin.text());
  const { method } = requestLine(msg);
  log("info", "webhook_started", "Received Event Grid delivery.", { method, bytes: msg.body.length });

  if (method === "OPTIONS") {
    const origin = msg.headers["webhook-request-origin"] ?? "*";
    log("info", "cloudevents_handshake", "Answered CloudEvents abuse-protection handshake.");
    respond(200, {}, { "WebHook-Allowed-Origin": origin, "WebHook-Allowed-Rate": "120" });
    return;
  }
  if (method !== "POST") {
    respond(405, { error: "Use POST" });
    return;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(msg.body || "[]");
  } catch {
    log("warn", "invalid_json", "Delivery body is not valid JSON.");
    respond(400, { error: "Invalid JSON" });
    return;
  }
  const events = (Array.isArray(parsed) ? parsed : [parsed]).map(normalize);

  const validation = events.find((e) => e.type === VALIDATION);
  if (validation) {
    log("info", "subscription_validated", "Answered Event Grid validation handshake.", { id: validation.id });
    respond(200, { validationResponse: validation.data.validationCode });
    return;
  }

  const allowed = new Set(loadConfig().subscriptions.map((s) => s.toLowerCase()));
  const accepted = [];
  for (const e of events) {
    const match = RG_SUBJECT.exec(e.subject);
    if (e.type !== WRITE_SUCCESS || !match) {
      log("warn", "event_ignored", "Not a resource group write; ignoring.", { id: e.id, type: e.type });
      continue;
    }
    if (!allowed.has(match[1].toLowerCase())) {
      log("warn", "event_ignored", "Subscription is not a target; ignoring.", { id: e.id, subscription: match[1] });
      continue;
    }
    accepted.push({ eventId: e.id, subscriptionId: match[1], rgName: match[2] });
  }

  log("info", "webhook_completed", "Accepted resource group events.", { received: events.length, accepted: accepted.length });
  respond(200, { accepted: accepted.length, events: accepted });
});

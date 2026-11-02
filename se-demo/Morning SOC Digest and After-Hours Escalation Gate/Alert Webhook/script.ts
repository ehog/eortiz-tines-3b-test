import { normalizeAlert, parseInput, slug } from "./soclib";

const raw = await Bun.stdin.text();
const { body } = parseInput(raw);

const payloads: unknown[] = Array.isArray(body)
  ? body
  : body && typeof body === "object" && Array.isArray((body as { alerts?: unknown[] }).alerts)
    ? (body as { alerts: unknown[] }).alerts
    : [body];

const receivedAt = new Date().toISOString();
const alerts = payloads
  .filter((p) => p && typeof p === "object")
  .map((p, index) => normalizeAlert(p, receivedAt, `${slug(receivedAt)}-${index}`));

if (alerts.length === 0) {
  console.error("No alert objects found in webhook payload; nothing forwarded to the gate.");
  process.exit(1);
}

for (const alert of alerts) {
  console.log(JSON.stringify({ intake: "webhook", alert }));
}

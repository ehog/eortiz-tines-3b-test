import { normalizeAlert, parseInput, slug } from "./soclib";
import { SCENARIOS } from "./scenarios";

const raw = await Bun.stdin.text();
const { body } = parseInput(raw);
const req = (body ?? {}) as { scenario?: string; alert?: unknown; alerts?: unknown[] };

let payloads: unknown[] = [];
let label = "custom";

if (typeof req.scenario === "string") {
  const scenario = SCENARIOS.find((s) => s.id === req.scenario);
  if (!scenario) {
    console.error(`Unknown scenario "${req.scenario}". Known: ${SCENARIOS.map((s) => s.id).join(", ")}`);
    process.exit(1);
  }
  payloads = scenario.alerts;
  label = scenario.id;
} else if (Array.isArray(req.alerts)) {
  payloads = req.alerts;
} else if (req.alert && typeof req.alert === "object") {
  payloads = [req.alert];
} else if (body && typeof body === "object") {
  payloads = [body];
}

const receivedAt = new Date().toISOString();
const alerts = payloads
  .filter((p) => p && typeof p === "object")
  .map((p, index) => normalizeAlert(p, receivedAt, `${slug(receivedAt)}-${index}`));

if (alerts.length === 0) {
  console.error("No alert payload supplied to the test intake.");
  process.exit(1);
}

for (const alert of alerts) {
  console.log(JSON.stringify({ intake: "console", scenario: label, alert }));
}

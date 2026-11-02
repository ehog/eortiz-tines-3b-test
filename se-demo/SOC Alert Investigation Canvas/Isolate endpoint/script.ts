import {
  approvalToken,
  dir,
  logger,
  readHttpRequest,
  readJson,
  respondJson,
  sanitizeId,
  writeJson,
  type Entities,
} from "./lib";
import { isolateDevice } from "./client";

const request = await readHttpRequest();

if (request.method !== "POST") {
  await respondJson(405, { error: "POST required" });
  process.exit(0);
}

let body: Record<string, unknown>;
try {
  body = JSON.parse(request.body || "{}") as Record<string, unknown>;
} catch {
  await respondJson(400, { error: "body must be JSON" });
  process.exit(0);
}

let investigationId: string;
try {
  investigationId = sanitizeId(body.investigationId);
} catch {
  await respondJson(400, { error: "invalid investigation id" });
  process.exit(0);
}

const audit = logger(investigationId, "Isolate endpoint");
const analyst = request.headers["x-3b-authenticated-email"] ?? "unknown";
const device = String(body.device ?? "").trim();
const approved = body.approved === true;
const token = String(body.token ?? "");

if (!device) {
  audit.log("isolate_rejected", "none", "missing_device");
  await respondJson(400, { error: "device is required" });
  process.exit(0);
}

if (!approved) {
  audit.log("isolate_rejected", device, "not_approved");
  await respondJson(403, { error: "explicit human approval is required before isolating an endpoint" });
  process.exit(0);
}

const expected = await approvalToken(investigationId, device);
if (token !== expected) {
  audit.log("isolate_rejected", device, "bad_token");
  await respondJson(403, { error: "approval token does not match this investigation and device" });
  process.exit(0);
}

const entities = await readJson<Entities>(`${dir(investigationId)}/entities.json`);
if (!entities || !entities.devices.some((candidate) => candidate.toLowerCase() === device.toLowerCase())) {
  audit.log("isolate_rejected", device, "device_not_in_investigation");
  await respondJson(409, { error: "device is not an entity of this investigation" });
  process.exit(0);
}

const started = Date.now();
const result = await isolateDevice({ device, investigationId, comment: String(body.comment ?? ""), audit });
const actionsPath = `${dir(investigationId)}/actions.json`;
const actions = (await readJson<Record<string, unknown>[]>(actionsPath)) ?? [];
const record = {
  ts: new Date().toISOString(),
  action: "isolate",
  device,
  analyst,
  approved: true,
  comment: String(body.comment ?? ""),
  outcome: "isolated",
  mocked: result.mocked,
  machineActionId: result.machineActionId,
  durationMs: Date.now() - started,
};
actions.push(record);
await writeJson(actionsPath, actions);
audit.log("isolate_executed", device, `analyst=${analyst}`, record.durationMs);

await respondJson(200, { investigationId, ...record, logs: audit.records });

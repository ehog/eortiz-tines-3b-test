import { API, createClients } from "./arm";
import { ensureConfigFile, loadConfig } from "./config";
import { httpResponse, parseHttp, requestLine } from "./http";
import { audit, log, main } from "./log";

const NAME = /^[-\w._()]{1,89}[-\w_()]$/;

function respond(status: number, body: unknown) {
  process.stdout.write(httpResponse(status, JSON.stringify(body)));
}

main("Simulate RG creation", async () => {
  const msg = parseHttp(await Bun.stdin.text());
  const { method } = requestLine(msg);
  log("info", "simulate_started", "Received simulated RG request.", { method });
  if (method !== "POST") {
    respond(405, { error: "POST a JSON body: { name, location, tags }" });
    return;
  }

  ensureConfigFile();
  const cfg = loadConfig();
  if (!cfg.simulate) {
    log("warn", "simulation_disabled", "Simulation mode is off; rejecting.");
    respond(409, { error: "Simulation mode is disabled in config.json" });
    return;
  }

  const body = JSON.parse(msg.body || "{}");
  const name = String(body.name ?? "");
  if (!NAME.test(name)) {
    respond(400, { error: "name must be a valid resource group name" });
    return;
  }
  const subscriptionId = body.subscriptionId ?? cfg.subscriptions[0];
  const rgPath = `/subscriptions/${subscriptionId}/resourceGroups/${name}`;

  const { arm } = createClients(cfg, { writable: true });
  await arm.put(rgPath, API.resources, {
    location: body.location ?? "eastus",
    tags: body.tags ?? {},
  });
  audit("simulated_rg_created", rgPath, "success", { tags: Object.keys(body.tags ?? {}) });

  const eventId = crypto.randomUUID();
  log("info", "simulate_completed", "Created simulated RG and emitted event.", { rg: name });
  respond(200, { accepted: 1, events: [{ eventId, subscriptionId, rgName: name }] });
});

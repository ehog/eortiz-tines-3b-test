// Run pipeline: the console's trigger endpoint (POST /atlas/run).
//
// It mints the run id and batch id, validates the chaos toggle, answers the
// browser immediately with 202, and hands the trigger payload to Ingest — this
// step's response body is Ingest's stdin, so the pipeline continues after the
// operator's request has already returned.

import { type ChaosMode, bodyOrRaw, httpResponse, makeLogger, requestLine } from "./lib";

const STEP = "Run pipeline";
const CHAOS_MODES: ChaosMode[] = ["none", "schema_drift", "source_timeout", "encoding_error"];

const raw = await Bun.stdin.text();
const { method } = requestLine(raw);

let requested = "none";
let batchOverride: string | null = null;
try {
  const body = JSON.parse(bodyOrRaw(raw) || "{}");
  requested = String(body.simulate_failure ?? body.chaos ?? "none");
  batchOverride = body.batchId ? String(body.batchId) : null;
} catch {
  // An empty or malformed body means a default clean run.
}

const runId = `run_${crypto.randomUUID().slice(0, 8)}`;
const log = makeLogger(STEP, runId);

if (method !== "POST") {
  log.warn("rejected non-POST trigger", { method });
  console.log(httpResponse(405, JSON.stringify({ error: "use POST" })));
  process.exit(0);
}

if (!(CHAOS_MODES as string[]).includes(requested)) {
  log.warn("rejected unknown chaos mode", { requested });
  console.log(
    httpResponse(400, JSON.stringify({ error: `simulate_failure must be one of ${CHAOS_MODES.join(", ")}` })),
  );
  process.exit(0);
}

const trigger = {
  runId,
  batchId: batchOverride ?? `BATCH-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`,
  simulate_failure: requested,
  triggeredBy: "console",
  accepted: true,
};

log.info("run accepted", trigger);
console.log(httpResponse(202, JSON.stringify(trigger)));

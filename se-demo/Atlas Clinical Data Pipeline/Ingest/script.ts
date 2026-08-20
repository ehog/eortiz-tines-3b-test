// Ingest: pulls one batch from three simulated partner feeds.
//
// Responsibilities
//  - accept a trigger payload (batch id + chaos mode) from the console, a cron
//    run, or a manual run
//  - enforce idempotency on batch id: a batch that already completed is never
//    reprocessed
//  - retry a flaky source with exponential backoff before declaring an outage
//  - open the run row so an in-flight or failed run is visible in monitoring

import {
  type ChaosMode,
  type Envelope,
  type SourceName,
  bodyOrRaw,
  feedCsv,
  feedFhir,
  feedXml,
  makeLogger,
  openDb,
  OWNER,
  persistLogs,
} from "./lib";

const STEP = "Ingest";
const SOURCES: SourceName[] = ["partner_fhir", "partner_csv", "partner_legacy_xml"];
const CHAOS_MODES: ChaosMode[] = ["none", "schema_drift", "source_timeout", "encoding_error"];
const BACKOFF_MS = [250, 500, 1000];

const raw = await Bun.stdin.text();
let trigger: Record<string, unknown> = {};
const body = bodyOrRaw(raw).trim();
if (body) {
  try {
    trigger = JSON.parse(body);
  } catch {
    // A manual run or cron tick may send nothing meaningful; defaults apply.
  }
}

const requested = String(trigger.simulate_failure ?? trigger.chaos ?? "none");
const chaos: ChaosMode = (CHAOS_MODES as string[]).includes(requested)
  ? (requested as ChaosMode)
  : "none";
const startedAt = new Date();
const batchId = String(trigger.batchId ?? `BATCH-${startedAt.toISOString().slice(0, 19).replace(/[-:T]/g, "")}`);
const runId = String(trigger.runId ?? `run_${crypto.randomUUID().slice(0, 8)}`);

const log = makeLogger(STEP, runId);
log.info("ingest started", { batchId, chaos, sources: SOURCES });

const db = openDb();

// Idempotency gate: the same batch id is never published twice. Writing no
// stdout stops the pipeline here.
const prior = db
  .query<{ run_id: string; status: string }, [string]>(
    "SELECT run_id, status FROM runs WHERE batch_id = ? AND status IN ('ok','degraded') LIMIT 1",
  )
  .get(batchId);
if (prior) {
  log.warn("duplicate batch suppressed", { batchId, previousRunId: prior.run_id });
  persistLogs(db, log.logs);
  db.close();
  process.exit(0);
}

// Operator-approved remediations (see the Actions step) are the only way a
// field remapping reaches Normalize.
const mappingOverrides: Record<string, string> = {};
for (const row of db
  .query<{ source: string; from_field: string; to_field: string }, []>(
    "SELECT source, from_field, to_field FROM mapping_overrides",
  )
  .all()) {
  mappingOverrides[`${row.source}.${row.from_field}`] = row.to_field;
}

/** Simulated source fetch. `source_timeout` makes the FHIR partner unreachable. */
async function fetchSource(source: SourceName): Promise<string> {
  if (chaos === "source_timeout" && source === "partner_fhir") {
    throw new Error("connect ETIMEDOUT partner-fhir.example:443 after 5000ms");
  }
  if (source === "partner_fhir") return feedFhir(batchId, chaos);
  if (source === "partner_csv") return feedCsv(batchId, chaos);
  return feedXml(batchId, chaos);
}

/** Retry with exponential backoff; ingest is read-only so replay is safe. */
async function withRetries(source: SourceName): Promise<string> {
  let lastError = "";
  for (let attempt = 1; attempt <= BACKOFF_MS.length + 1; attempt++) {
    try {
      const payload = await fetchSource(source);
      if (attempt > 1) log.info("source recovered on retry", { source, attempt });
      return payload;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      log.warn("source fetch failed", { source, attempt, error: lastError });
      const wait = BACKOFF_MS[attempt - 1];
      if (wait === undefined) break;
      await Bun.sleep(wait);
    }
  }
  throw new Error(lastError);
}

const envelope: Envelope = {
  runId,
  batchId,
  chaos,
  startedAt: startedAt.toISOString(),
  sources: SOURCES,
  status: "ok",
  records: [],
  rejections: [],
  quarantine: [],
  counts: { in: 0, normalized: 0, duplicates: 0, rejected: 0, quarantined: 0, out: 0 },
  qualityScore: 0,
  mappingOverrides,
  logs: [],
  error: null,
};

try {
  const [fhir, csv, xml] = await Promise.all([
    withRetries("partner_fhir"),
    withRetries("partner_csv"),
    withRetries("partner_legacy_xml"),
  ]);
  envelope.raw = { fhir, csv, xml };
  // Rough inbound count: FHIR entries + CSV data lines + XML <TRIAL> blocks.
  envelope.counts.in =
    (fhir.match(/"resourceType": "ResearchStudy"/g) ?? []).length +
    Math.max(0, csv.trim().split("\n").length - 1) +
    (xml.match(/<TRIAL>/g) ?? []).length;
  log.info("batch fetched", { recordsIn: envelope.counts.in, bytes: fhir.length + csv.length + xml.length });
} catch (err) {
  envelope.status = "failed";
  envelope.error = {
    source: "partner_fhir",
    field: null,
    recordId: null,
    message: `source unreachable after ${BACKOFF_MS.length + 1} attempts: ${
      err instanceof Error ? err.message : String(err)
    }`,
    changedVsLastGoodRun: "partner_fhir answered within 900ms on the last good run; it now refuses connections.",
    owner: OWNER,
  };
  log.error("ingest failed", { error: envelope.error });
}

db.run(
  `INSERT INTO runs (run_id, batch_id, chaos, started_at, status, sources, records_in)
   VALUES (?,?,?,?,?,?,?)
   ON CONFLICT(run_id) DO UPDATE SET status = excluded.status, records_in = excluded.records_in`,
  [runId, batchId, chaos, envelope.startedAt, "running", JSON.stringify(SOURCES), envelope.counts.in],
);
persistLogs(db, log.logs);
db.close();

envelope.logs = log.logs;
console.log(JSON.stringify(envelope));

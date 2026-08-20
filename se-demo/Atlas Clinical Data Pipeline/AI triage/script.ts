// AI triage: for any run that failed or rejected records, classify the likely
// root cause and draft a remediation note for the data engineering owner.
//
// This is classification, not reasoning, so it runs on a cheap/fast model tier
// with a tight token budget. The model never sees record payloads — only field
// names, reason codes and counts — so no clinical or patient data leaves the
// pipeline.
//
// The step degrades gracefully: with no model connector attached (or on any API
// error) it falls back to a deterministic rule-based classification, so the
// pipeline never fails because triage was unavailable.

import { type Envelope, makeLogger, openDb, persistLogs, OWNER } from "./lib";

const STEP = "AI triage";
const MODEL = "claude-haiku-4-5-20251001";
const envelope: Envelope = JSON.parse(await Bun.stdin.text());
const log = makeLogger(STEP, envelope.runId);

const needsTriage = envelope.status === "failed" || envelope.rejections.length > 0;
if (!needsTriage) {
  log.info("no triage required", { status: envelope.status });
  const db = openDb();
  persistLogs(db, log.logs);
  db.close();
  envelope.logs.push(...log.logs);
  console.log(JSON.stringify(envelope));
  process.exit(0);
}

/** Metadata-only summary of what went wrong. Contains no record values. */
const reasonCounts: Record<string, number> = {};
for (const r of envelope.rejections) {
  reasonCounts[r.reasonCode] = (reasonCounts[r.reasonCode] ?? 0) + 1;
}
const facts = {
  runId: envelope.runId,
  batchId: envelope.batchId,
  status: envelope.status,
  sources: envelope.sources,
  recordsIn: envelope.counts.in,
  recordsOut: envelope.counts.out,
  duplicatesDropped: envelope.counts.duplicates,
  rejectedCount: envelope.counts.rejected,
  rejectionReasonCounts: reasonCounts,
  quarantinedFindings: envelope.counts.quarantined,
  qualityScore: envelope.qualityScore,
  failure: envelope.error,
};

const PROMPT = `You triage failures in a pharma-intelligence data supply chain.

Classify the likely root cause as exactly one of:
  schema_drift   - an upstream partner renamed, removed or reordered a field
  encoding_issue - a partner sent non-UTF-8 or mis-transcoded text
  bad_mapping    - our own normalization mapping is wrong or incomplete
  source_outage  - a partner feed was unreachable or returned nothing

Then write a remediation note of 2-4 sentences addressed to the data engineering
owner (${OWNER}). Be concrete: name the source, the field, and the first action
to take. Plain English, no bullet points, no preamble.

Reply with JSON only: {"rootCause": "...", "confidence": "high|medium|low", "note": "..."}

Run facts:
${JSON.stringify(facts, null, 2)}`;

/** Rule-based classification used when the model is unavailable. */
function fallbackTriage() {
  const error = envelope.error;
  if (error && /unreachable|ETIMEDOUT|refus/i.test(error.message)) {
    return {
      rootCause: "source_outage",
      confidence: "high",
      note: `${error.source} did not answer after four attempts with exponential backoff, so batch ${envelope.batchId} produced no records. ${error.changedVsLastGoodRun ?? ""} Confirm the partner's status page and re-run the batch once the endpoint responds; the pipeline is idempotent on batch id so a re-run is safe.`,
    };
  }
  if (error && error.field) {
    return {
      rootCause: "schema_drift",
      confidence: "high",
      note: `${error.source} changed its contract: required field(s) ${error.field} are no longer present. ${error.changedVsLastGoodRun ?? ""} Approve the proposed field remapping in the console, or ask the partner to restore the original column, then re-run batch ${envelope.batchId}.`,
    };
  }
  if (reasonCounts.ENCODING_DAMAGE) {
    return {
      rootCause: "encoding_issue",
      confidence: "medium",
      note: `${reasonCounts.ENCODING_DAMAGE} record(s) arrived with mis-transcoded text, consistent with a partner writing ISO-8859-1 bytes into a UTF-8 channel. Batch ${envelope.batchId} still published, but the quality score dropped to ${envelope.qualityScore}. Ask the partner to confirm the export encoding and re-ingest the affected day.`,
    };
  }
  const top = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];
  return {
    rootCause: "bad_mapping",
    confidence: "low",
    note: `Batch ${envelope.batchId} published ${envelope.counts.out} of ${envelope.counts.normalized} records; the dominant rejection reason was ${top?.[0] ?? "unknown"} (${top?.[1] ?? 0} records). Review the normalization rules for that field before the next scheduled run — the pattern suggests our mapping, not the partner's data.`,
  };
}

let triage = { ...fallbackTriage(), model: "rule-based fallback" };

try {
  // The connector's proxy injects the real API key; the placeholder below never
  // leaves the sandbox and no secret lives in this repository.
  const base = process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1";
  const response = await fetch(`${base}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": "set-by-connector",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: "user", content: PROMPT }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`anthropic ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const payload = (await response.json()) as { content: { type: string; text?: string }[] };
  const text = payload.content.find((c) => c.type === "text")?.text ?? "";
  const parsed = JSON.parse(text.replace(/^```json\s*|\s*```$/g, "").trim());
  if (!parsed.rootCause || !parsed.note) throw new Error("model returned an unusable shape");
  triage = {
    rootCause: String(parsed.rootCause),
    confidence: String(parsed.confidence ?? "medium"),
    note: String(parsed.note),
    model: MODEL,
  };
  log.info("triage classified by model", { model: MODEL, rootCause: triage.rootCause });
} catch (err) {
  log.warn("model triage unavailable, using rule-based fallback", {
    error: err instanceof Error ? err.message : String(err),
  });
}

// A remediation the operator can approve in the console. Only schema drift on
// the CSV partner has a safe automatic fix today; everything else is advisory.
const unexpected = envelope.error?.changedVsLastGoodRun?.match(/UNIT_PRICE_USD/i);
const proposedFix =
  envelope.error?.source === "partner_csv" && unexpected
    ? {
        kind: "mapping_override" as const,
        source: "partner_csv",
        fromField: "UNIT_PRICE_USD",
        toField: "LIST_PRICE_USD",
        description:
          "Alias partner_csv column UNIT_PRICE_USD to LIST_PRICE_USD so the renamed price column maps to the canonical field.",
      }
    : null;

const record = { ...triage, owner: OWNER, proposedFix, generatedAt: new Date().toISOString() };
envelope.triage = triage;

const db = openDb();
db.run("UPDATE runs SET triage = ? WHERE run_id = ?", [JSON.stringify(record), envelope.runId]);
persistLogs(db, log.logs);
db.close();

envelope.logs.push(...log.logs);
console.log(JSON.stringify(envelope));

// Push path for Qualys detections. Validates the posted payload, normalizes it
// into the same envelope the scheduled pull emits, and feeds normalization.
// Accepts a bare detection, an array of detections, or {data:[...]}.
import { parseRequest, isHttpRequest } from "./http";
import { openWrite, recordStage, markSeen, newRunId } from "./pipeline-db";
import type { PullEnvelope, QualysDetection } from "./types";

const REQUIRED = ["ID", "QID", "TITLE", "SEVERITY", "ASSET"] as const;

function coerce(raw: unknown): QualysDetection {
  const d = raw as Record<string, unknown>;
  const missing = REQUIRED.filter((key) => d[key] === undefined || d[key] === null);
  if (missing.length) throw new Error(`detection is missing required field(s): ${missing.join(", ")}`);
  const asset = (d.ASSET ?? {}) as Record<string, unknown>;
  if (!asset.HOSTNAME) throw new Error("detection ASSET.HOSTNAME is required");
  const cvss = (d.CVSS ?? {}) as Record<string, unknown>;
  const intel = (d.THREAT_INTEL ?? {}) as Record<string, unknown>;
  const nowIso = new Date().toISOString();
  return {
    ID: String(d.ID),
    QID: Number(d.QID),
    TYPE: String(d.TYPE ?? "Confirmed"),
    TITLE: String(d.TITLE),
    CATEGORY: String(d.CATEGORY ?? "Unknown"),
    VULN_CLASS: String(d.VULN_CLASS ?? "Unknown"),
    SEVERITY: Math.min(5, Math.max(1, Math.round(Number(d.SEVERITY)))),
    CVSS: {
      BASE: Number(cvss.BASE ?? 0),
      TEMPORAL: Number(cvss.TEMPORAL ?? cvss.BASE ?? 0),
      VECTOR: String(cvss.VECTOR ?? ""),
    },
    CVE_LIST: Array.isArray(d.CVE_LIST) ? (d.CVE_LIST as string[]).map(String) : [],
    THREAT_INTEL: {
      KNOWN_EXPLOITED: intel.KNOWN_EXPLOITED === true,
      EXPLOIT_IN_THE_WILD: intel.EXPLOIT_IN_THE_WILD === true,
      CISA_KEV_DUE_DATE: intel.CISA_KEV_DUE_DATE ? String(intel.CISA_KEV_DUE_DATE) : null,
    },
    PATCH_AVAILABLE: d.PATCH_AVAILABLE === true,
    STATUS: String(d.STATUS ?? "Active"),
    FINDING_TYPE: String(d.FINDING_TYPE ?? "unknown"),
    ASSET: {
      ASSET_ID: String(asset.ASSET_ID ?? ""),
      HOSTNAME: String(asset.HOSTNAME),
      IP: String(asset.IP ?? ""),
      OS: String(asset.OS ?? "Unknown"),
      TAGS: Array.isArray(asset.TAGS) ? (asset.TAGS as string[]).map(String) : [],
      EXPOSURE_OVERRIDE: asset.EXPOSURE_OVERRIDE ? String(asset.EXPOSURE_OVERRIDE) : null,
    },
    SOFTWARE: (d.SOFTWARE ?? {}) as Record<string, unknown>,
    RESULTS: String(d.RESULTS ?? ""),
    SOLUTION: String(d.SOLUTION ?? ""),
    FIRST_FOUND_DATETIME: String(d.FIRST_FOUND_DATETIME ?? nowIso),
    LAST_FOUND_DATETIME: String(d.LAST_FOUND_DATETIME ?? nowIso),
    LAST_UPDATE_DATETIME: String(d.LAST_UPDATE_DATETIME ?? nowIso),
    TIMES_DETECTED: Number(d.TIMES_DETECTED ?? 1),
  };
}

const startedAt = new Date().toISOString();
const started = Date.now();
const raw = await Bun.stdin.text();

if (!isHttpRequest(raw)) {
  console.error("this step only runs from its webhook route");
  process.exit(1);
}

const req = parseRequest(raw);
if (req.method !== "POST") {
  console.error(`method ${req.method} not allowed; post a Qualys detection payload instead`);
  process.exit(1);
}

const db = openWrite();
const runId = `${newRunId()}-webhook`;

try {
  if (!req.body.trim()) throw new Error("request body is empty");
  const parsed = JSON.parse(req.body) as unknown;
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { data?: unknown[] }).data)
      ? (parsed as { data: unknown[] }).data
      : [parsed];
  if (!list.length) throw new Error("no detections in payload");
  const detections = list.map(coerce);
  for (const d of detections) {
    markSeen(db, [d.ID, d.QID, d.STATUS, d.SEVERITY, d.CVSS.BASE, d.LAST_UPDATE_DATETIME].join("|"), d.ID);
  }

  const payload: PullEnvelope = {
    run_id: runId,
    trigger: "webhook",
    stage: "pull",
    generated_at: new Date().toISOString(),
    detections,
    notes: [`${detections.length} detections received by webhook push`],
  };

  recordStage(db, {
    run_id: runId,
    stage: "pull",
    trigger: "webhook",
    status: "success",
    started_at: startedAt,
    duration_ms: Date.now() - started,
    record_count: detections.length,
    summary: `${detections.length} detections pushed by webhook`,
    payload,
  });

  // stdout is the envelope for the linked normalization step, so the HTTP
  // response is written by the downstream chain's absence of an output step.
  process.stdout.write(JSON.stringify(payload));
  console.error(`webhook accepted ${detections.length} detections as run ${runId}`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  recordStage(db, {
    run_id: runId,
    stage: "pull",
    trigger: "webhook",
    status: "error",
    started_at: startedAt,
    duration_ms: Date.now() - started,
    record_count: 0,
    summary: `webhook rejected: ${message}`,
    payload: {},
    error: message,
  });
  console.error(`webhook rejected payload: ${message}`);
  process.exit(1);
}

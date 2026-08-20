// Seed: writes plausible history so the console is populated on first launch.
//
// Run this by hand once per environment (or before a demo). It clears the store
// and rewrites a known baseline, so it is never scheduled and never linked into
// the pipeline.
//
// The seeded history deliberately contains one hard failure (schema drift, with
// an AI triage note and an approvable remediation attached), one degraded run
// with a low quality score, two clean runs with open PHI quarantines, and
// several healthy runs.

import {
  type SeededRow,
  makeLogger,
  openDb,
  OWNER,
  rng,
} from "./lib";

const STEP = "Seed";
const log = makeLogger(STEP, "seed");
const db = openDb();

const SOURCES = ["partner_fhir", "partner_csv", "partner_legacy_xml"];

type SeedSpec = {
  id: string;
  hoursAgo: number;
  status: "ok" | "degraded" | "failed";
  chaos: string;
  recordsIn: number;
  recordsOut: number;
  duplicates: number;
  rejected: number;
  quarantined: number;
  quality: number | null;
  durationMs: number;
  rejections: [string, number][];
  quarantines?: { trialId: string; ndc: string; reasonCode: string; field: string; detail: string; source: string; status: string }[];
  error?: Record<string, unknown>;
  triage?: Record<string, unknown>;
};

const SPECS: SeedSpec[] = [
  {
    id: "run_seed0001", hoursAgo: 168, status: "ok", chaos: "none",
    recordsIn: 30, recordsOut: 26, duplicates: 1, rejected: 3, quarantined: 0,
    quality: 89.7, durationMs: 4120, rejections: [["ZERO_ENROLLMENT", 1], ["MISSING_NDC", 1], ["FUTURE_DATE", 1]],
  },
  {
    id: "run_seed0002", hoursAgo: 144, status: "ok", chaos: "none",
    recordsIn: 30, recordsOut: 28, duplicates: 1, rejected: 1, quarantined: 0,
    quality: 96.6, durationMs: 3880, rejections: [["ZERO_ENROLLMENT", 1]],
  },
  {
    id: "run_seed0003", hoursAgo: 120, status: "degraded", chaos: "encoding_error",
    recordsIn: 30, recordsOut: 20, duplicates: 1, rejected: 9, quarantined: 0,
    quality: 69, durationMs: 5230,
    rejections: [["ENCODING_DAMAGE", 5], ["INVALID_DATE", 2], ["MISSING_NDC", 2]],
    triage: {
      rootCause: "encoding_issue", confidence: "medium", model: "rule-based fallback", owner: OWNER,
      generatedAt: new Date(Date.now() - 120 * 3600_000 + 5000).toISOString(), proposedFix: null,
      note:
        "Nine records from partner_legacy_xml and partner_fhir arrived with mis-transcoded text, consistent with ISO-8859-1 bytes being written into a UTF-8 channel. The batch still published but the quality score fell to 69. Ask the partner to confirm their export encoding and re-ingest the affected day once corrected.",
    },
  },
  {
    id: "run_seed0004", hoursAgo: 96, status: "ok", chaos: "none",
    recordsIn: 30, recordsOut: 25, duplicates: 1, rejected: 4, quarantined: 0,
    quality: 86.2, durationMs: 4010, rejections: [["PRICE_OUTLIER", 1], ["FUTURE_DATE", 1], ["ZERO_ENROLLMENT", 1], ["UNMAPPED_COUNTRY", 1]],
  },
  {
    id: "run_seed0005", hoursAgo: 72, status: "failed", chaos: "schema_drift",
    recordsIn: 30, recordsOut: 0, duplicates: 0, rejected: 0, quarantined: 0,
    quality: null, durationMs: 1870, rejections: [],
    error: {
      source: "partner_csv", field: "LIST_PRICE_USD", recordId: "NCT04771029",
      message:
        "partner_csv header is missing required field(s) LIST_PRICE_USD; received [NCT_ID, CONDITION, INTERVENTION, SPONSOR, PHASE, SITE_COUNTRY, ENROLLMENT, NDC, UNIT_PRICE_USD, EFFECTIVE_DT]",
      changedVsLastGoodRun:
        "Last good run's header contained LIST_PRICE_USD. The current feed instead carries [UNIT_PRICE_USD] — an unannounced upstream rename.",
      owner: OWNER,
    },
    triage: {
      rootCause: "schema_drift", confidence: "high", model: "claude-haiku-4-5-20251001", owner: OWNER,
      generatedAt: new Date(Date.now() - 72 * 3600_000 + 6000).toISOString(),
      note:
        "partner_csv renamed its price column from LIST_PRICE_USD to UNIT_PRICE_USD without notice, so normalization could not populate the canonical list price and the batch was stopped before publication. Nothing else in the header changed, which points to a deliberate upstream rename rather than a corrupt export. Approve the proposed remapping to unblock delivery, and raise a contract ticket with the partner so the column name is pinned. The batch is idempotent on batch id, so re-running after approval is safe.",
      proposedFix: {
        kind: "mapping_override", source: "partner_csv",
        fromField: "UNIT_PRICE_USD", toField: "LIST_PRICE_USD",
        description:
          "Alias partner_csv column UNIT_PRICE_USD to LIST_PRICE_USD so the renamed price column maps to the canonical field.",
      },
    },
  },
  {
    id: "run_seed0006", hoursAgo: 48, status: "ok", chaos: "none",
    recordsIn: 30, recordsOut: 24, duplicates: 1, rejected: 3, quarantined: 2,
    quality: 89.7, durationMs: 4340, rejections: [["MISSING_NDC", 2], ["ZERO_ENROLLMENT", 1]],
    quarantines: [
      {
        trialId: "NCT04512338", ndc: "58201-4471-02", reasonCode: "PHI_MRN", field: "notes",
        detail: 'Detected medical record number in "notes" (14 chars, value redacted)',
        source: "partner_legacy_xml", status: "open",
      },
      {
        trialId: "NCT04512338", ndc: "58201-4471-02", reasonCode: "PHI_DOB", field: "notes",
        detail: 'Detected date of birth in "notes" (20 chars, value redacted)',
        source: "partner_legacy_xml", status: "open",
      },
    ],
  },
  {
    id: "run_seed0007", hoursAgo: 24, status: "ok", chaos: "none",
    recordsIn: 30, recordsOut: 25, duplicates: 1, rejected: 3, quarantined: 1,
    quality: 89.7, durationMs: 3990, rejections: [["ZERO_ENROLLMENT", 2], ["PRICE_OUTLIER", 1]],
    quarantines: [
      {
        trialId: "NCT04880511", ndc: "70121-9930-01", reasonCode: "PHI_NAME", field: "notes",
        detail: 'Detected personal name in "notes" (16 chars, value redacted)',
        source: "partner_fhir", status: "open",
      },
    ],
  },
  {
    id: "run_seed0008", hoursAgo: 6, status: "ok", chaos: "none",
    recordsIn: 30, recordsOut: 27, duplicates: 1, rejected: 2, quarantined: 0,
    quality: 93.1, durationMs: 3760, rejections: [["ZERO_ENROLLMENT", 1], ["FUTURE_DATE", 1]],
  },
];

const CONDITIONS = ["Non-Small Cell Lung Cancer", "Type 2 Diabetes Mellitus", "Atopic Dermatitis", "Multiple Myeloma", "Idiopathic Pulmonary Fibrosis", "Ulcerative Colitis"];
const INTERVENTIONS = ["Pembrolizumab", "Semaglutide", "Dupilumab", "Teclistamab", "Nintedanib", "Ozanimod"];
const SPONSORS = ["Merck Sharp & Dohme", "Novo Nordisk A/S", "Regeneron Pharmaceuticals", "Janssen Research & Development", "Boehringer Ingelheim", "Bristol-Myers Squibb"];
const COUNTRIES = ["US", "DE", "JP", "GB", "CA", "FR"];
const PHASES = ["PHASE1", "PHASE2", "PHASE3", "PHASE4"];

/** Per-step timeline for a seeded run, mirroring the real steps' log shape. */
function seededLogs(spec: SeedSpec, startedAt: Date) {
  const base = startedAt.getTime();
  const lines: { step: string; offset: number; level: string; message: string; data: unknown }[] = [
    { step: "Ingest", offset: 40, level: "info", message: "ingest started", data: { batchId: `BATCH-SEED-${spec.id.slice(-4)}`, chaos: spec.chaos, sources: SOURCES } },
    { step: "Ingest", offset: 780, level: "info", message: "batch fetched", data: { recordsIn: spec.recordsIn, bytes: 11840 } },
  ];
  if (spec.status === "failed") {
    lines.push({ step: "Normalize", offset: 1180, level: "error", message: "schema drift detected", data: { missing: ["LIST_PRICE_USD"], header: ["NCT_ID", "CONDITION", "INTERVENTION", "SPONSOR", "PHASE", "SITE_COUNTRY", "ENROLLMENT", "NDC", "UNIT_PRICE_USD", "EFFECTIVE_DT"] } });
    lines.push({ step: "Publish", offset: 1520, level: "info", message: "committing run", data: { status: "failed", recordsOut: 0 } });
    lines.push({ step: "AI triage", offset: 1780, level: "info", message: "triage classified by model", data: { model: "claude-haiku-4-5-20251001", rootCause: "schema_drift" } });
    lines.push({ step: "Alert", offset: spec.durationMs, level: "error", message: "PIPELINE RUN FAILED", data: { owner: OWNER, source: "partner_csv", field: "LIST_PRICE_USD" } });
    return lines;
  }
  lines.push({ step: "Normalize", offset: 1420, level: "info", message: "normalized", data: { normalized: spec.recordsIn - spec.duplicates, duplicates: spec.duplicates, encodingIssues: spec.chaos === "encoding_error" ? 3 : 0 } });
  lines.push({ step: "Validate", offset: 2260, level: "info", message: "validated", data: { passed: spec.recordsOut + spec.quarantined, rejected: spec.rejected, qualityScore: spec.quality } });
  lines.push({ step: "PHI guard", offset: 2880, level: spec.quarantined ? "warn" : "info", message: "phi scan complete", data: { quarantineFindings: spec.quarantined, publishable: spec.recordsOut } });
  lines.push({ step: "Publish", offset: 3480, level: "info", message: "committing run", data: { status: spec.status, recordsOut: spec.recordsOut, qualityScore: spec.quality } });
  if (spec.triage) {
    lines.push({ step: "AI triage", offset: 3760, level: "info", message: "triage classified by model", data: { rootCause: spec.triage.rootCause, model: spec.triage.model } });
  }
  lines.push({ step: "Alert", offset: spec.durationMs, level: spec.status === "degraded" ? "warn" : "info", message: spec.status === "degraded" ? "PIPELINE RUN DEGRADED" : "pipeline run clean", data: { status: spec.status, qualityScore: spec.quality } });
  return lines.map((l) => ({ ...l, ts: new Date(base + l.offset).toISOString() }));
}

let publishedRecords = 0;

db.transaction(() => {
  // Seeding establishes a known baseline, so any prior pipeline state is
  // cleared first. This is a bootstrap tool, run by hand — never on a schedule.
  for (const table of ["step_logs", "rejections", "quarantine", "records", "runs", "mapping_overrides"]) {
    db.run(`DELETE FROM ${table}`);
  }

  for (const spec of SPECS) {
    const startedAt = new Date(Date.now() - spec.hoursAgo * 3600_000);
    const finishedAt = new Date(startedAt.getTime() + spec.durationMs);
    db.run(
      `INSERT INTO runs (run_id, batch_id, chaos, started_at, finished_at, duration_ms, status, sources,
         records_in, records_out, duplicates, rejected, quarantined, quality_score, error, triage)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        spec.id, `BATCH-SEED-${spec.id.slice(-4)}`, spec.chaos, startedAt.toISOString(),
        finishedAt.toISOString(), spec.durationMs, spec.status, JSON.stringify(SOURCES),
        spec.recordsIn, spec.recordsOut, spec.duplicates, spec.rejected, spec.quarantined,
        spec.quality, spec.error ? JSON.stringify(spec.error) : null,
        spec.triage ? JSON.stringify(spec.triage) : null,
      ],
    );

    const logStmt = db.prepare(
      "INSERT INTO step_logs (run_id, step, ts, duration_ms, level, message, data) VALUES (?,?,?,?,?,?,?)",
    );
    for (const line of seededLogs(spec, startedAt) as { step: string; ts?: string; offset: number; level: string; message: string; data: unknown }[]) {
      logStmt.run(
        spec.id, line.step, line.ts ?? new Date(startedAt.getTime() + line.offset).toISOString(),
        line.offset, line.level, line.message, JSON.stringify(line.data),
      );
    }

    const rand = rng(spec.id);
    const rejStmt = db.prepare(
      "INSERT INTO rejections (run_id, trial_id, ndc, reason_code, detail, source) VALUES (?,?,?,?,?,?)",
    );
    for (const [code, count] of spec.rejections) {
      for (let i = 0; i < count; i++) {
        rejStmt.run(
          spec.id, `NCT0${4000000 + Math.floor(rand() * 999999)}`,
          `${10000 + Math.floor(rand() * 89999)}-${1000 + Math.floor(rand() * 8999)}-01`,
          code, `${code} raised by quality gate during seeded run ${spec.id}`,
          SOURCES[Math.floor(rand() * SOURCES.length)],
        );
      }
    }

    const quarStmt = db.prepare(
      `INSERT INTO quarantine (run_id, trial_id, ndc, reason_code, detail, matched_field, source, status)
       VALUES (?,?,?,?,?,?,?,?)`,
    );
    for (const q of spec.quarantines ?? []) {
      quarStmt.run(spec.id, q.trialId, q.ndc, q.reasonCode, q.detail, q.field, q.source, q.status);
    }

    // Published records, so "records published today" and the store are real.
    const recStmt = db.prepare(
      `INSERT INTO records (trial_id, ndc, run_id, condition, intervention, sponsor, phase, country,
         enrollment, list_price_usd, effective_date, source, published_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(trial_id, ndc) DO UPDATE SET published_at = excluded.published_at, run_id = excluded.run_id`,
    );
    for (let i = 0; i < spec.recordsOut; i++) {
      const idx = Math.floor(rand() * CONDITIONS.length);
      const row: SeededRow = {
        trialId: `NCT0${4000000 + Math.floor(rand() * 999999)}`,
        condition: CONDITIONS[idx], intervention: INTERVENTIONS[idx], sponsor: SPONSORS[idx],
        phaseRaw: "", countryRaw: "", enrollment: 40 + Math.floor(rand() * 800),
        ndcRaw: "", price: Math.round((rand() * 7000 + 300) * 100) / 100,
        dateRaw: "",
      };
      recStmt.run(
        row.trialId,
        `${10000 + Math.floor(rand() * 89999)}-${1000 + Math.floor(rand() * 8999)}-0${Math.floor(rand() * 9)}`,
        spec.id, row.condition, row.intervention, row.sponsor,
        PHASES[Math.floor(rand() * PHASES.length)], COUNTRIES[Math.floor(rand() * COUNTRIES.length)],
        row.enrollment, row.price,
        `2026-0${1 + Math.floor(rand() * 8)}-1${Math.floor(rand() * 9)}`,
        SOURCES[Math.floor(rand() * SOURCES.length)],
        finishedAt.toISOString(),
      );
      publishedRecords++;
    }
  }
})();

log.info("seeded console history", {
  runs: SPECS.length,
  failed: SPECS.filter((s) => s.status === "failed").length,
  degraded: SPECS.filter((s) => s.status === "degraded").length,
  openQuarantines: SPECS.flatMap((s) => s.quarantines ?? []).length,
  publishedRecords,
});
db.close();

console.log(
  JSON.stringify({ seeded: SPECS.map((s) => s.id), publishedRecords }),
);

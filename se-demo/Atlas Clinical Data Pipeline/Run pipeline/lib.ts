// Shared types, structured logging, SQLite schema and mock-feed generators for
// the Atlas Clinical Data Pipeline. This file is copied verbatim into each step
// that needs it (steps are isolated build contexts and cannot import across
// directories).

import { Database } from "bun:sqlite";

export const DB_PATH = "/storage/atlas/atlas.db";
export const OWNER = "data-engineering@atlas-health.example";

export type ChaosMode =
  | "none"
  | "schema_drift"
  | "source_timeout"
  | "encoding_error";

export type SourceName = "partner_fhir" | "partner_csv" | "partner_legacy_xml";

/** One record in the canonical healthcare schema produced by Normalize. */
export type CanonicalRecord = {
  trialId: string; // NCT identifier, e.g. NCT04932018
  condition: string;
  intervention: string;
  sponsor: string;
  phase: string; // PHASE1 | PHASE2 | PHASE3 | PHASE4 | NA
  country: string; // ISO-3166 alpha-2
  enrollment: number;
  ndc: string; // 5-4-2 normalized National Drug Code
  listPriceUsd: number;
  effectiveDate: string; // ISO-8601 (YYYY-MM-DD)
  source: SourceName;
  sourceRecordId: string;
  /** Free-text fields retained only so the PHI guard can inspect them. */
  notes?: string;
};

export type Rejection = {
  trialId: string;
  ndc: string;
  reasonCode: string;
  detail: string;
  source: SourceName;
};

export type Quarantine = {
  trialId: string;
  ndc: string;
  reasonCode: string;
  detail: string;
  matchedField: string;
  source: SourceName;
};

export type StepLog = {
  ts: string;
  runId: string;
  step: string;
  durationMs: number;
  level: "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
};

/** Owner-attributable failure payload: who broke what, and what changed. */
export type PipelineError = {
  source: SourceName | "pipeline";
  field: string | null;
  recordId: string | null;
  message: string;
  changedVsLastGoodRun: string | null;
  owner: string;
};

/** The envelope that flows step-to-step over stdout/stdin. */
export type Envelope = {
  runId: string;
  batchId: string;
  chaos: ChaosMode;
  startedAt: string;
  sources: SourceName[];
  status: "ok" | "degraded" | "failed";
  raw?: { fhir: string; csv: string; xml: string };
  records: CanonicalRecord[];
  rejections: Rejection[];
  quarantine: Quarantine[];
  counts: {
    in: number;
    normalized: number;
    duplicates: number;
    rejected: number;
    quarantined: number;
    out: number;
  };
  qualityScore: number;
  mappingOverrides: Record<string, string>;
  logs: StepLog[];
  error: PipelineError | null;
  triage?: { rootCause: string; confidence: string; note: string; model: string };
};

// ---------------------------------------------------------------------------
// Structured logging: one JSON object per line on stderr, so the monitoring
// tabs and the console's per-run timeline show the same data.
// ---------------------------------------------------------------------------

export function makeLogger(step: string, runId: string, startedAt = Date.now()) {
  const logs: StepLog[] = [];
  const emit = (
    level: StepLog["level"],
    message: string,
    data?: Record<string, unknown>,
  ) => {
    const entry: StepLog = {
      ts: new Date().toISOString(),
      runId,
      step,
      durationMs: Date.now() - startedAt,
      level,
      message,
      ...(data ? { data } : {}),
    };
    logs.push(entry);
    console.error(JSON.stringify(entry));
    return entry;
  };
  return {
    logs,
    info: (m: string, d?: Record<string, unknown>) => emit("info", m, d),
    warn: (m: string, d?: Record<string, unknown>) => emit("warn", m, d),
    error: (m: string, d?: Record<string, unknown>) => emit("error", m, d),
    elapsed: () => Date.now() - startedAt,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function openDb(readonly = false): Database {
  const db = new Database(DB_PATH, readonly ? { readonly: true } : { create: true });
  if (readonly) {
    // A read-only mount cannot create the sidecar files a pragma write needs,
    // so readers only assert that they will never attempt one.
    db.exec("PRAGMA query_only = 1;");
    return db;
  }
  // Writers are scheduled exclusively on the volume, so the default rollback
  // journal is enough — and unlike WAL it leaves the database fully readable
  // from a read-only mount.
  db.exec("PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;");
  ensureSchema(db);
  return db;
}

export function ensureSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL,
      chaos TEXT NOT NULL DEFAULT 'none',
      started_at TEXT NOT NULL,
      finished_at TEXT,
      duration_ms INTEGER,
      status TEXT NOT NULL,
      sources TEXT NOT NULL,
      records_in INTEGER DEFAULT 0,
      records_out INTEGER DEFAULT 0,
      duplicates INTEGER DEFAULT 0,
      rejected INTEGER DEFAULT 0,
      quarantined INTEGER DEFAULT 0,
      quality_score REAL,
      error TEXT,
      triage TEXT
    );
    CREATE TABLE IF NOT EXISTS step_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      step TEXT NOT NULL,
      ts TEXT NOT NULL,
      duration_ms INTEGER,
      level TEXT,
      message TEXT,
      data TEXT
    );
    CREATE TABLE IF NOT EXISTS records (
      trial_id TEXT NOT NULL,
      ndc TEXT NOT NULL,
      run_id TEXT NOT NULL,
      condition TEXT, intervention TEXT, sponsor TEXT, phase TEXT,
      country TEXT, enrollment INTEGER, list_price_usd REAL,
      effective_date TEXT, source TEXT, published_at TEXT,
      PRIMARY KEY (trial_id, ndc)
    );
    CREATE TABLE IF NOT EXISTS rejections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL, trial_id TEXT, ndc TEXT,
      reason_code TEXT NOT NULL, detail TEXT, source TEXT
    );
    CREATE TABLE IF NOT EXISTS quarantine (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL, trial_id TEXT, ndc TEXT,
      reason_code TEXT NOT NULL, detail TEXT, matched_field TEXT, source TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      decided_at TEXT, decided_by TEXT
    );
    -- Human-approved remediations. Normalize only applies a field remapping
    -- after an operator approves it in the console.
    CREATE TABLE IF NOT EXISTS mapping_overrides (
      source TEXT NOT NULL, from_field TEXT NOT NULL, to_field TEXT NOT NULL,
      approved_at TEXT NOT NULL, approved_by TEXT NOT NULL, run_id TEXT,
      PRIMARY KEY (source, from_field)
    );
    CREATE INDEX IF NOT EXISTS idx_logs_run ON step_logs(run_id);
    CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at DESC);
  `);
}

export function persistLogs(db: Database, logs: StepLog[]) {
  const stmt = db.prepare(
    "INSERT INTO step_logs (run_id, step, ts, duration_ms, level, message, data) VALUES (?,?,?,?,?,?,?)",
  );
  for (const l of logs) {
    stmt.run(
      l.runId,
      l.step,
      l.ts,
      l.durationMs,
      l.level,
      l.message,
      l.data ? JSON.stringify(l.data) : null,
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Strip RFC 7230 framing (request or response) down to the body. */
export function bodyOrRaw(raw: string): string {
  if (!/^[A-Z]+ \S+ HTTP\/\d/.test(raw) && !/^HTTP\/\d(\.\d)? \d{3}/.test(raw)) {
    return raw;
  }
  const sep = raw.match(/\r?\n\r?\n/);
  return sep ? raw.slice(sep.index! + sep[0].length) : "";
}

export function requestLine(raw: string): { method: string; path: string; query: URLSearchParams } {
  const first = raw.split(/\r?\n/, 1)[0] ?? "";
  const [method = "GET", target = "/"] = first.split(" ");
  const url = new URL(target, "http://local");
  return { method: method.toUpperCase(), path: url.pathname, query: url.searchParams };
}

export function httpResponse(status: number, body: string, contentType = "application/json") {
  const bytes = Buffer.byteLength(body);
  return (
    [
      `HTTP/1.1 ${status} ${status === 200 ? "OK" : status === 202 ? "Accepted" : "Error"}`,
      `Content-Type: ${contentType}; charset=utf-8`,
      `Content-Length: ${bytes}`,
      "Cache-Control: no-store",
      "",
      "",
    ].join("\r\n") + body
  );
}

// ---------------------------------------------------------------------------
// Deterministic pseudo-random generator, so a batch id always produces the
// same mock feed. Demos are reproducible and step tests stay stable.
// ---------------------------------------------------------------------------

export function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

// ---------------------------------------------------------------------------
// Mock partner feeds. Three deliberately inconsistent shapes.
// ---------------------------------------------------------------------------

const CONDITIONS = [
  "Non-Small Cell Lung Cancer",
  "Type 2 Diabetes Mellitus",
  "Atopic Dermatitis",
  "Multiple Myeloma",
  "Idiopathic Pulmonary Fibrosis",
  "Ulcerative Colitis",
];
const INTERVENTIONS = [
  "Pembrolizumab",
  "Semaglutide",
  "Dupilumab",
  "Teclistamab",
  "Nintedanib",
  "Ozanimod",
];
const SPONSORS = [
  "Merck Sharp & Dohme",
  "Novo Nordisk A/S",
  "Regeneron Pharmaceuticals",
  "Janssen Research & Development",
  "Boehringer Ingelheim",
  "Bristol-Myers Squibb",
];
const COUNTRIES_RAW = ["USA", "United States", "DEU", "Germany", "JPN", "GBR", "Canada", "FRA"];

export type SeededRow = {
  trialId: string;
  condition: string;
  intervention: string;
  sponsor: string;
  phaseRaw: string;
  countryRaw: string;
  enrollment: number;
  ndcRaw: string;
  price: number;
  dateRaw: string;
};

function seedRows(batchId: string, count: number, offset: number): SeededRow[] {
  const rand = rng(`${batchId}:${offset}`);
  const rows: SeededRow[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.floor(rand() * CONDITIONS.length);
    const trialNum = 4000000 + Math.floor(rand() * 999999);
    const labeler = String(10000 + Math.floor(rand() * 89999));
    const product = String(1000 + Math.floor(rand() * 8999));
    rows.push({
      trialId: `NCT0${trialNum}`,
      condition: CONDITIONS[idx],
      intervention: INTERVENTIONS[idx],
      sponsor: SPONSORS[idx],
      phaseRaw: ["Phase 1", "Phase II", "phase-3", "PHASE 3", "Phase 4", "N/A"][
        Math.floor(rand() * 6)
      ],
      countryRaw: COUNTRIES_RAW[Math.floor(rand() * COUNTRIES_RAW.length)],
      enrollment: Math.floor(rand() * 900) + 20,
      ndcRaw: `${labeler}-${product}-0${Math.floor(rand() * 9)}`,
      price: Math.round((rand() * 8000 + 240) * 100) / 100,
      dateRaw: `2026-0${1 + Math.floor(rand() * 8)}-1${Math.floor(rand() * 9)}`,
    });
  }
  return rows;
}

/** FHIR-ish JSON bundle from partner_fhir. */
export function feedFhir(batchId: string, chaos: ChaosMode): string {
  const rows = seedRows(batchId, 12, 1);
  const bundle = {
    resourceType: "Bundle",
    id: `atlas-${batchId}`,
    type: "collection",
    entry: rows.map((r, i) => ({
      fullUrl: `urn:uuid:fhir-${batchId}-${i}`,
      resource: {
        resourceType: "ResearchStudy",
        identifier: [{ system: "https://clinicaltrials.gov", value: r.trialId }],
        condition: [{ text: r.condition }],
        phase: { coding: [{ display: r.phaseRaw }] },
        sponsor: { display: r.sponsor },
        enrollment: { actual: i === 2 ? 0 : r.enrollment }, // one zero-enrollment record
        site: [{ address: { country: r.countryRaw } }],
        extension: [
          { url: "atlas/intervention", valueString: r.intervention },
          { url: "atlas/ndc", valueString: i === 4 ? "" : r.ndcRaw }, // one missing NDC
          { url: "atlas/listPrice", valueDecimal: i === 1 ? r.price * 12 : r.price }, // one outlier
          { url: "atlas/effectiveDate", valueDate: i === 5 ? "2031-04-01" : r.dateRaw },
        ],
        // Patient-level identifiers must never be published; the PHI guard
        // quarantines this record.
        ...(i === 3
          ? {
              contact: [
                {
                  name: "Maria Gonzalez",
                  telecom: [{ system: "other", value: "MRN 48213997, DOB 1974-03-11" }],
                },
              ],
            }
          : {}),
      },
    })),
  };
  const json = JSON.stringify(bundle, null, 2);
  return chaos === "encoding_error" ? json.replace(/Dupilumab/g, "Dupilumab\uFFFD") : json;
}

/** Pipe-delimited flat file from partner_csv. */
export function feedCsv(batchId: string, chaos: ChaosMode): string {
  const rows = seedRows(batchId, 10, 2);
  // `schema_drift` renames LIST_PRICE_USD upstream without notice.
  const header =
    chaos === "schema_drift"
      ? "NCT_ID|CONDITION|INTERVENTION|SPONSOR|PHASE|SITE_COUNTRY|ENROLLMENT|NDC|UNIT_PRICE_USD|EFFECTIVE_DT"
      : "NCT_ID|CONDITION|INTERVENTION|SPONSOR|PHASE|SITE_COUNTRY|ENROLLMENT|NDC|LIST_PRICE_USD|EFFECTIVE_DT";
  const lines = rows.map(
    (r, i) =>
      [
        r.trialId,
        r.condition,
        r.intervention,
        r.sponsor,
        r.phaseRaw,
        r.countryRaw,
        i === 1 ? 0 : r.enrollment,
        r.ndcRaw.replace(/-/g, ""), // unpadded, undelimited NDC
        r.price,
        r.dateRaw.replace(/-/g, "/"), // MM/DD/YYYY-ish legacy date
      ].join("|"),
  );
  // A duplicate of the first row, to exercise de-duplication.
  lines.push(lines[0]);
  return [header, ...lines].join("\n");
}

/** Legacy XML-style payload from partner_legacy_xml. */
export function feedXml(batchId: string, chaos: ChaosMode): string {
  const rows = seedRows(batchId, 8, 3);
  const body = rows
    .map(
      (r, i) => `  <TRIAL>
    <TRIALID>${r.trialId}</TRIALID>
    <DISEASE>${r.condition}</DISEASE>
    <DRUG>${r.intervention}</DRUG>
    <SPONSORORG>${r.sponsor}</SPONSORORG>
    <STUDYPHASE>${r.phaseRaw}</STUDYPHASE>
    <CTRY>${r.countryRaw}</CTRY>
    <PTS>${r.enrollment}</PTS>
    <NDCCODE>${r.ndcRaw}</NDCCODE>
    <WACPRICE>${r.price}</WACPRICE>
    <EFFDATE>${r.dateRaw.replace(/-/g, "")}</EFFDATE>${
      i === 2
        ? `
    <INVESTIGATORNOTE>Subject James O'Neill, DOB 05/22/1968, MRN 77301882 screened at site 4</INVESTIGATORNOTE>`
        : ""
    }
  </TRIAL>`,
    )
    .join("\n");
  const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>\n<TRIALFEED batch="${batchId}">\n${body}\n</TRIALFEED>`;
  return chaos === "encoding_error"
    ? xml.replace(/O'Neill/g, "O\u00c3\u00a2\u20ac\u2122Neill").replace(/Boehringer/g, "Bo\u00c3\u00abhringer")
    : xml;
}

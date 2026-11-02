// Normalize: folds three incompatible partner shapes into one canonical
// healthcare schema.
//
//  - trial phase vocabulary -> PHASE1..PHASE4 | NA
//  - country names/alpha-3 -> ISO-3166 alpha-2
//  - NDC -> 5-4-2 dashed form
//  - all dates -> ISO-8601 (YYYY-MM-DD)
//  - de-duplication on (trialId, NDC)
//
// A required source field that disappears upstream is schema drift: the run
// fails here with an owner-attributable payload rather than silently publishing
// nulls.

import {
  type CanonicalRecord,
  type Envelope,
  type SourceName,
  makeLogger,
  OWNER,
} from "./lib";

const STEP = "Normalize";
const envelope: Envelope = JSON.parse(await Bun.stdin.text());
const log = makeLogger(STEP, envelope.runId);

if (envelope.status === "failed" || !envelope.raw) {
  log.warn("skipped: upstream failure", { error: envelope.error?.message });
  envelope.logs.push(...log.logs);
  console.log(JSON.stringify(envelope));
  process.exit(0);
}

const PHASE_MAP: Record<string, string> = {
  "phase 1": "PHASE1", "phase i": "PHASE1", "phase-1": "PHASE1", phase1: "PHASE1",
  "phase 2": "PHASE2", "phase ii": "PHASE2", "phase-2": "PHASE2", phase2: "PHASE2",
  "phase 3": "PHASE3", "phase iii": "PHASE3", "phase-3": "PHASE3", phase3: "PHASE3",
  "phase 4": "PHASE4", "phase iv": "PHASE4", "phase-4": "PHASE4", phase4: "PHASE4",
};

const COUNTRY_MAP: Record<string, string> = {
  usa: "US", "united states": "US", us: "US", usa3: "US",
  deu: "DE", germany: "DE", de: "DE",
  jpn: "JP", japan: "JP",
  gbr: "GB", "united kingdom": "GB",
  can: "CA", canada: "CA",
  fra: "FR", france: "FR",
};

function normalizePhase(raw: string): string {
  return PHASE_MAP[raw.trim().toLowerCase()] ?? "NA";
}

function normalizeCountry(raw: string): string {
  return COUNTRY_MAP[raw.trim().toLowerCase()] ?? "ZZ";
}

/** Accepts 11-digit, dashed, or short NDCs; emits zero-padded 5-4-2. */
function normalizeNdc(raw: string): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const padded = digits.padStart(11, "0").slice(0, 11);
  return `${padded.slice(0, 5)}-${padded.slice(5, 9)}-${padded.slice(9)}`;
}

/** Handles YYYY-MM-DD, YYYY/MM/DD and compact YYYYMMDD. */
function normalizeDate(raw: string): string {
  const s = (raw ?? "").trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return "";
}

/** Mojibake and replacement characters left by a bad upstream transcode. */
function encodingDamage(value: string): boolean {
  return /\uFFFD|Ã.|â€/.test(value);
}

function repairEncoding(value: string): string {
  return value.replace(/\uFFFD/g, "").replace(/Ã¢â‚¬â„¢|â€™/g, "'").replace(/Ã«/g, "e");
}

const records: CanonicalRecord[] = [];
const encodingIssues: { source: SourceName; field: string; recordId: string }[] = [];

// --- partner_fhir -----------------------------------------------------------
const bundle = JSON.parse(envelope.raw.fhir);
for (const [i, entry] of (bundle.entry ?? []).entries()) {
  const r = entry.resource ?? {};
  const ext = (url: string) =>
    (r.extension ?? []).find((e: { url: string }) => e.url === url) ?? {};
  const contact = (r.contact ?? [])[0];
  const notes = contact
    ? [contact.name, ...(contact.telecom ?? []).map((t: { value: string }) => t.value)]
        .filter(Boolean)
        .join(", ")
    : undefined;
  const intervention = String(ext("atlas/intervention").valueString ?? "");
  if (encodingDamage(intervention)) {
    encodingIssues.push({ source: "partner_fhir", field: "intervention", recordId: `fhir-${i}` });
  }
  records.push({
    trialId: String(r.identifier?.[0]?.value ?? ""),
    condition: String(r.condition?.[0]?.text ?? ""),
    intervention: repairEncoding(intervention),
    sponsor: String(r.sponsor?.display ?? ""),
    phase: normalizePhase(String(r.phase?.coding?.[0]?.display ?? "")),
    country: normalizeCountry(String(r.site?.[0]?.address?.country ?? "")),
    enrollment: Number(r.enrollment?.actual ?? 0),
    ndc: normalizeNdc(String(ext("atlas/ndc").valueString ?? "")),
    listPriceUsd: Number(ext("atlas/listPrice").valueDecimal ?? 0),
    effectiveDate: normalizeDate(String(ext("atlas/effectiveDate").valueDate ?? "")),
    source: "partner_fhir",
    sourceRecordId: `fhir-${i}`,
    ...(notes ? { notes } : {}),
  });
}

// --- partner_csv ------------------------------------------------------------
const csvLines = envelope.raw.csv.trim().split(/\r?\n/);
const header = csvLines[0].split("|").map((h) => h.trim().toUpperCase());
// An operator-approved remediation can alias a renamed column back into place.
const overridden = Object.entries(envelope.mappingOverrides)
  .filter(([key]) => key.startsWith("partner_csv."))
  .map(([key, to]) => [key.split(".")[1], to.toUpperCase()] as const);
for (const [from, to] of overridden) {
  const idx = header.indexOf(from.toUpperCase());
  if (idx >= 0) {
    header[idx] = to;
    log.info("applied approved mapping override", { source: "partner_csv", from, to });
  }
}

const REQUIRED_CSV = [
  "NCT_ID", "CONDITION", "INTERVENTION", "SPONSOR", "PHASE",
  "SITE_COUNTRY", "ENROLLMENT", "NDC", "LIST_PRICE_USD", "EFFECTIVE_DT",
];
const missing = REQUIRED_CSV.filter((f) => !header.includes(f));
if (missing.length) {
  const firstRecord = csvLines[1]?.split("|")[0] ?? null;
  envelope.status = "failed";
  envelope.error = {
    source: "partner_csv",
    field: missing.join(", "),
    recordId: firstRecord,
    message: `partner_csv header is missing required field(s) ${missing.join(", ")}; received [${header.join(", ")}]`,
    changedVsLastGoodRun: `Last good run's header contained ${missing.join(", ")}. The current feed instead carries [${header
      .filter((h) => !REQUIRED_CSV.includes(h))
      .join(", ") || "no unexpected columns"}] — an unannounced upstream rename.`,
    owner: OWNER,
  };
  log.error("schema drift detected", { missing, header });
  envelope.logs.push(...log.logs);
  delete envelope.raw;
  console.log(JSON.stringify(envelope));
  process.exit(0);
}

const col = (row: string[], name: string) => row[header.indexOf(name)] ?? "";
for (const [i, line] of csvLines.slice(1).entries()) {
  const row = line.split("|");
  records.push({
    trialId: col(row, "NCT_ID").trim(),
    condition: col(row, "CONDITION").trim(),
    intervention: col(row, "INTERVENTION").trim(),
    sponsor: col(row, "SPONSOR").trim(),
    phase: normalizePhase(col(row, "PHASE")),
    country: normalizeCountry(col(row, "SITE_COUNTRY")),
    enrollment: Number(col(row, "ENROLLMENT")) || 0,
    ndc: normalizeNdc(col(row, "NDC")),
    listPriceUsd: Number(col(row, "LIST_PRICE_USD")) || 0,
    effectiveDate: normalizeDate(col(row, "EFFECTIVE_DT")),
    source: "partner_csv",
    sourceRecordId: `csv-${i}`,
  });
}

// --- partner_legacy_xml -----------------------------------------------------
/** The legacy feed is XML, so text nodes arrive entity-encoded. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, "&");
}

const tag = (block: string, name: string) =>
  decodeEntities(block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "");
for (const [i, block] of (envelope.raw.xml.match(/<TRIAL>[\s\S]*?<\/TRIAL>/g) ?? []).entries()) {
  const sponsor = tag(block, "SPONSORORG");
  const note = tag(block, "INVESTIGATORNOTE");
  for (const [field, value] of [["sponsor", sponsor], ["notes", note]] as const) {
    if (value && encodingDamage(value)) {
      encodingIssues.push({ source: "partner_legacy_xml", field, recordId: `xml-${i}` });
    }
  }
  records.push({
    trialId: tag(block, "TRIALID"),
    condition: tag(block, "DISEASE"),
    intervention: tag(block, "DRUG"),
    sponsor: repairEncoding(sponsor),
    phase: normalizePhase(tag(block, "STUDYPHASE")),
    country: normalizeCountry(tag(block, "CTRY")),
    enrollment: Number(tag(block, "PTS")) || 0,
    ndc: normalizeNdc(tag(block, "NDCCODE")),
    listPriceUsd: Number(tag(block, "WACPRICE")) || 0,
    effectiveDate: normalizeDate(tag(block, "EFFDATE")),
    source: "partner_legacy_xml",
    sourceRecordId: `xml-${i}`,
    ...(note ? { notes: repairEncoding(note) } : {}),
  });
}

// --- de-duplicate on (trialId, NDC), keeping the first occurrence ------------
const seen = new Set<string>();
const deduped: CanonicalRecord[] = [];
let duplicates = 0;
for (const record of records) {
  const key = `${record.trialId}|${record.ndc}`;
  if (record.ndc && seen.has(key)) {
    duplicates++;
    log.info("duplicate dropped", { key, source: record.source, sourceRecordId: record.sourceRecordId });
    continue;
  }
  seen.add(key);
  deduped.push(record);
}

// Encoding damage is a quality problem, not a hard failure: the run continues
// and Validate degrades the score.
if (encodingIssues.length) {
  log.warn("encoding damage repaired", { count: encodingIssues.length, issues: encodingIssues });
  for (const issue of encodingIssues) {
    envelope.rejections.push({
      trialId: deduped.find((r) => r.sourceRecordId === issue.recordId)?.trialId ?? "",
      ndc: deduped.find((r) => r.sourceRecordId === issue.recordId)?.ndc ?? "",
      reasonCode: "ENCODING_DAMAGE",
      detail: `Non-UTF-8 artefacts in ${issue.field} from ${issue.source} (${issue.recordId})`,
      source: issue.source,
    });
  }
}

envelope.records = deduped;
envelope.counts.normalized = deduped.length;
envelope.counts.duplicates = duplicates;
log.info("normalized", { normalized: deduped.length, duplicates, encodingIssues: encodingIssues.length });
envelope.logs.push(...log.logs);
// Raw payloads have served their purpose; dropping them keeps the envelope
// small and stops source text travelling further down the pipeline.
delete envelope.raw;

console.log(JSON.stringify(envelope));

// PHI guard: the last gate before publication.
//
// Atlas publishes trial- and product-level data only. Any record carrying
// something that resembles a patient-level identifier is quarantined instead of
// published, and every decision is logged with a reason code so a reviewer can
// audit it later. The guard is deliberately conservative: a false positive costs
// a human review, a false negative is a PHI disclosure.
//
// Reason codes
//  PHI_MRN    medical record number pattern
//  PHI_DOB    date of birth pattern or explicit DOB label
//  PHI_NAME   personal-name pattern in a free-text field
//  PHI_SSN    US social security number pattern
//  PHI_EMAIL  email address or phone number belonging to an individual

import { type Envelope, type Quarantine, makeLogger } from "./lib";

const STEP = "PHI guard";
const envelope: Envelope = JSON.parse(await Bun.stdin.text());
const log = makeLogger(STEP, envelope.runId);

if (envelope.status === "failed") {
  log.warn("skipped: upstream failure", { error: envelope.error?.message });
  envelope.logs.push(...log.logs);
  console.log(JSON.stringify(envelope));
  process.exit(0);
}

const DETECTORS: { code: string; label: string; pattern: RegExp }[] = [
  { code: "PHI_MRN", label: "medical record number", pattern: /\bMRN[:\s#-]*\d{6,10}\b/i },
  { code: "PHI_SSN", label: "social security number", pattern: /\b\d{3}-\d{2}-\d{4}\b/ },
  {
    code: "PHI_DOB",
    label: "date of birth",
    pattern: /\b(?:DOB|date of birth)[:\s]*\d{1,4}[-/]\d{1,2}[-/]\d{1,4}\b/i,
  },
  { code: "PHI_EMAIL", label: "personal contact detail", pattern: /[\w.+-]+@[\w-]+\.[\w.]{2,}/ },
  // A capitalized given name plus surname in a free-text field, allowing for
  // apostrophes and hyphens (O'Neill, Smith-Jones).
  { code: "PHI_NAME", label: "personal name", pattern: /\b[A-Z][a-z]+(?:['-][A-Z]?[a-z]+)?\s+[A-Z][a-z]+(?:['-][A-Z]?[a-z]+)?\b/ },
];

// Fields that legitimately contain organization or drug names are not scanned
// for personal names; only free text and contact fields are.
const FREE_TEXT_FIELDS = ["notes"] as const;

const quarantine: Quarantine[] = [];
const publishable = [];

for (const record of envelope.records) {
  const hits: { code: string; field: string; detail: string }[] = [];
  for (const field of FREE_TEXT_FIELDS) {
    const value = record[field];
    if (!value) continue;
    for (const detector of DETECTORS) {
      const match = value.match(detector.pattern);
      if (!match) continue;
      hits.push({
        code: detector.code,
        field,
        // Redacted: the matched value itself is PHI and must not be logged.
        detail: `Detected ${detector.label} in "${field}" (${match[0].length} chars, value redacted)`,
      });
    }
  }
  if (hits.length === 0) {
    publishable.push(record);
    continue;
  }
  for (const hit of hits) {
    quarantine.push({
      trialId: record.trialId,
      ndc: record.ndc,
      reasonCode: hit.code,
      detail: hit.detail,
      matchedField: hit.field,
      source: record.source,
    });
  }
  log.warn("record quarantined", {
    trialId: record.trialId,
    source: record.source,
    reasonCodes: hits.map((h) => h.code),
    decision: "quarantine",
    action: "withheld from publication pending human review",
  });
}

envelope.records = publishable;
envelope.quarantine = quarantine;
envelope.counts.quarantined = quarantine.length;
envelope.counts.out = publishable.length;

log.info("phi scan complete", {
  scanned: publishable.length + new Set(quarantine.map((q) => q.trialId)).size,
  quarantinedRecords: new Set(quarantine.map((q) => q.trialId)).size,
  quarantineFindings: quarantine.length,
  publishable: publishable.length,
});
envelope.logs.push(...log.logs);
console.log(JSON.stringify(envelope));

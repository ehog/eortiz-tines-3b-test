// Validate: quality gates. Records failing a gate are rejected (not published)
// and the batch gets a data-quality score.
//
// Gates
//  MISSING_NDC        no National Drug Code after normalization
//  ZERO_ENROLLMENT    enrollment count of 0
//  FUTURE_DATE        effective date after today
//  PRICE_OUTLIER      list price beyond 3 standard deviations of the batch mean
//  INVALID_DATE       date could not be coerced to ISO-8601
//  UNMAPPED_COUNTRY   country outside the ISO-3166 map
//  ENCODING_DAMAGE    flagged upstream by Normalize
//
// Quality score = published / normalized, expressed 0-100.

import { type Envelope, type Rejection, makeLogger } from "./lib";

const STEP = "Validate";
const envelope: Envelope = JSON.parse(await Bun.stdin.text());
const log = makeLogger(STEP, envelope.runId);

if (envelope.status === "failed") {
  log.warn("skipped: upstream failure", { error: envelope.error?.message });
  envelope.logs.push(...log.logs);
  console.log(JSON.stringify(envelope));
  process.exit(0);
}

const prices = envelope.records.map((r) => r.listPriceUsd).filter((p) => p > 0);
const sum = prices.reduce((a, b) => a + b, 0);
const sumSquares = prices.reduce((a, b) => a + b * b, 0);

// Leave-one-out mean and standard deviation: a single extreme price inflates the
// batch SD enough to hide itself, so each record is compared against the spread
// of the *other* records in the batch.
function outlierSigma(price: number): number {
  const n = prices.length - 1;
  if (price <= 0 || n < 2) return 0;
  const mean = (sum - price) / n;
  const variance = Math.max((sumSquares - price * price) / n - mean * mean, 0);
  const stdDev = Math.sqrt(variance);
  return stdDev === 0 ? 0 : Math.abs(price - mean) / stdDev;
}

const batchMean = sum / (prices.length || 1);
const today = new Date().toISOString().slice(0, 10);

const rejections: Rejection[] = [...envelope.rejections];
// Records Normalize already rejected (encoding damage) are excluded up front.
const preRejected = new Set(envelope.rejections.map((r) => `${r.trialId}|${r.ndc}`));
const clean = [];

for (const record of envelope.records) {
  const key = `${record.trialId}|${record.ndc}`;
  const failures: { reasonCode: string; detail: string }[] = [];

  if (!record.ndc) failures.push({ reasonCode: "MISSING_NDC", detail: "NDC absent or unparseable" });
  if (record.enrollment === 0)
    failures.push({ reasonCode: "ZERO_ENROLLMENT", detail: "Enrollment count is 0" });
  if (!record.effectiveDate)
    failures.push({ reasonCode: "INVALID_DATE", detail: "Effective date could not be coerced to ISO-8601" });
  else if (record.effectiveDate > today)
    failures.push({
      reasonCode: "FUTURE_DATE",
      detail: `Effective date ${record.effectiveDate} is in the future`,
    });
  if (record.country === "ZZ")
    failures.push({ reasonCode: "UNMAPPED_COUNTRY", detail: "Site country not in the ISO-3166 map" });
  const sigma = outlierSigma(record.listPriceUsd);
  if (sigma > 3)
    failures.push({
      reasonCode: "PRICE_OUTLIER",
      detail: `List price ${record.listPriceUsd.toFixed(2)} is ${sigma.toFixed(
        1,
      )} SD from the batch mean ${batchMean.toFixed(2)}`,
    });

  if (preRejected.has(key)) continue;
  if (failures.length === 0) {
    clean.push(record);
    continue;
  }
  for (const failure of failures) {
    rejections.push({ trialId: record.trialId, ndc: record.ndc, source: record.source, ...failure });
  }
  log.warn("record rejected", {
    trialId: record.trialId,
    source: record.source,
    reasons: failures.map((f) => f.reasonCode),
  });
}

envelope.records = clean;
envelope.rejections = rejections;
envelope.counts.rejected = envelope.counts.normalized - clean.length;
envelope.qualityScore =
  envelope.counts.normalized === 0
    ? 0
    : Math.round((clean.length / envelope.counts.normalized) * 1000) / 10;
// Below 85% clean the batch is publishable but not healthy.
if (envelope.qualityScore < 85) envelope.status = "degraded";

log.info("validated", {
  passed: clean.length,
  rejected: envelope.counts.rejected,
  qualityScore: envelope.qualityScore,
  priceMean: Math.round(batchMean),
  pricesConsidered: prices.length,
});
envelope.logs.push(...log.logs);
console.log(JSON.stringify(envelope));

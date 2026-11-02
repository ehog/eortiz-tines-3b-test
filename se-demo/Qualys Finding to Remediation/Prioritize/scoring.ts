// Deterministic risk scoring. Five weighted factors sum to a 0-100 score; each
// factor reports the points it contributed so the score can be explained in
// plain language. Weights are configurable from the demo console.
import type { NormalizedFinding, RiskAssessment, RiskFactor } from "./types";

export type Weights = {
  severity: number;
  cvss: number;
  threat: number;
  criticality: number;
  exposure: number;
};

export const DEFAULT_WEIGHTS: Weights = {
  severity: 30,
  cvss: 25,
  threat: 20,
  criticality: 15,
  exposure: 10,
};

export const BANDS = { critical: 80, high: 60, medium: 40 } as const;
export const SLA_DAYS = { critical: 3, high: 7, medium: 30, low: 90 } as const;
/** Findings at or above this score get an AI remediation package. */
export const HIGH_PRIORITY_SCORE = BANDS.high;

const CRITICALITY_FACTOR: Record<string, number> = {
  critical: 1,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

const EXPOSURE_FACTOR: Record<string, number> = {
  internet: 1,
  dmz: 0.8,
  internal: 0.35,
  isolated: 0.1,
};

export function normalizeWeights(input: unknown): Weights {
  const raw = (input ?? {}) as Partial<Record<keyof Weights, unknown>>;
  const merged: Weights = { ...DEFAULT_WEIGHTS };
  for (const key of Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[]) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= 0) merged[key] = value;
  }
  return merged;
}

function band(score: number): RiskAssessment["risk_band"] {
  if (score >= BANDS.critical) return "critical";
  if (score >= BANDS.high) return "high";
  if (score >= BANDS.medium) return "medium";
  return "low";
}

export function scoreFinding(
  finding: NormalizedFinding,
  weights: Weights,
  now: Date,
): RiskAssessment {
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const factors: RiskFactor[] = [];

  const severityRatio = Math.min(Math.max(finding.severity, 0), 5) / 5;
  factors.push({
    factor: "Qualys severity",
    input: `severity ${finding.severity} of 5`,
    points: severityRatio * weights.severity,
    max_points: weights.severity,
    detail: `Qualys rates this detection severity ${finding.severity}, which is ${Math.round(
      severityRatio * 100,
    )}% of the maximum severity weight.`,
  });

  const cvssRatio = Math.min(Math.max(finding.cvss_base, 0), 10) / 10;
  factors.push({
    factor: "CVSS base score",
    input: `CVSS ${finding.cvss_base.toFixed(1)}`,
    points: cvssRatio * weights.cvss,
    max_points: weights.cvss,
    detail: `The CVSS v3 base score is ${finding.cvss_base.toFixed(1)} (${finding.cvss_vector || "no vector supplied"}).`,
  });

  const threatRatio = finding.kev ? 1 : finding.exploit_in_wild ? 0.6 : 0;
  factors.push({
    factor: "Exploitation status",
    input: finding.kev
      ? "on the CISA KEV catalog"
      : finding.exploit_in_wild
        ? "exploited in the wild"
        : "no known exploitation",
    points: threatRatio * weights.threat,
    max_points: weights.threat,
    detail: finding.kev
      ? `This CVE is on the CISA Known Exploited Vulnerabilities catalog${
          finding.kev_due_date ? ` with a federal due date of ${finding.kev_due_date}` : ""
        }, so it earns the full exploitation weight.`
      : finding.exploit_in_wild
        ? "Exploitation has been observed in the wild but the CVE is not on the CISA KEV catalog, so it earns 60% of the exploitation weight."
        : "There is no reported exploitation for this finding, so it earns no exploitation points.",
  });

  const criticalityRatio = CRITICALITY_FACTOR[finding.owner.criticality] ?? 0.5;
  factors.push({
    factor: "Asset criticality",
    input: `${finding.owner.criticality} criticality`,
    points: criticalityRatio * weights.criticality,
    max_points: weights.criticality,
    detail: `${finding.asset.hostname} supports ${finding.owner.application}, rated ${finding.owner.criticality} criticality by the asset-owner lookup.`,
  });

  const exposureRatio = EXPOSURE_FACTOR[finding.owner.exposure] ?? 0.35;
  factors.push({
    factor: "Internet exposure",
    input: finding.owner.exposure,
    points: exposureRatio * weights.exposure,
    max_points: weights.exposure,
    detail:
      finding.owner.exposure === "internet"
        ? `${finding.asset.hostname} is reachable from the internet, so the exposure weight applies in full.`
        : `${finding.asset.hostname} is classified as ${finding.owner.exposure}, which attenuates the exposure weight to ${Math.round(
            exposureRatio * 100,
          )}%.`,
  });

  const rawScore = factors.reduce((sum, f) => sum + f.points, 0);
  const score = Math.round((rawScore / total) * 100);
  const riskBand = band(score);
  const slaDays = SLA_DAYS[riskBand];
  const slaDue = new Date(now.getTime() + slaDays * 86_400_000);

  const rounded = factors.map((f) => ({ ...f, points: Math.round(f.points * 10) / 10 }));
  const ranked = [...rounded].sort((a, b) => b.points - a.points);
  const drivers = ranked.filter((f) => f.points > 0).slice(0, 3);
  const zero = rounded.filter((f) => f.points === 0);

  const explanation = [
    `Risk score ${score} of 100 places this finding in the ${riskBand} band, giving a ${slaDays}-day remediation SLA (due ${slaDue
      .toISOString()
      .slice(0, 10)}).`,
    drivers.length
      ? `The score is driven mainly by ${drivers
          .map((f) => `${f.factor.toLowerCase()} (${f.input}, ${f.points} of ${f.max_points} points)`)
          .join("; ")}.`
      : "No factor contributed points to this score.",
    zero.length
      ? `No points came from ${zero.map((f) => f.factor.toLowerCase()).join(" or ")}.`
      : "",
    riskBand === "critical" || riskBand === "high"
      ? "It clears the high-priority threshold, so an AI remediation package is generated and it is batched onto a ServiceNow change for the owning team."
      : "It stays below the high-priority threshold, so it is tracked and listed on the team's change without a generated remediation package.",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    risk_score: score,
    risk_band: riskBand,
    sla_days: slaDays,
    sla_due: slaDue.toISOString(),
    factors: rounded,
    explanation,
    high_priority: score >= HIGH_PRIORITY_SCORE,
  };
}

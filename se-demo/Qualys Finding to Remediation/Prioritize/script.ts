// Scores every finding, explains the score, and rolls the highest score in each
// team group up to the group so the ServiceNow change inherits it.
import { runStage } from "./stage";
import { getConfig, referenceNow } from "./pipeline-db";
import { DEFAULT_WEIGHTS, normalizeWeights, scoreFinding, HIGH_PRIORITY_SCORE } from "./scoring";
import type { Envelope } from "./types";

await runStage<Envelope, Envelope>({
  stage: "prioritize",
  upstreamStage: "normalize",
  handler: async (input, { db, runId, invocation }) => {
    const stored = getConfig(db, "weights");
    const weights = normalizeWeights(stored ? JSON.parse(stored) : DEFAULT_WEIGHTS);
    const now = referenceNow(db, input?.generated_at);

    const findings = (input?.findings ?? []).map((f) => ({
      ...f,
      risk: scoreFinding(f, weights, now),
    }));
    const byId = new Map(findings.map((f) => [f.finding_id, f]));

    const groups = (input?.groups ?? []).map((g) => {
      const scored = g.finding_ids.map((id) => byId.get(id)?.risk).filter((r) => r !== undefined);
      const max = scored.reduce(
        (best, r) => (r!.risk_score > (best?.risk_score ?? -1) ? r! : best),
        scored[0],
      );
      return {
        ...g,
        max_risk_score: max?.risk_score ?? 0,
        risk_band: max?.risk_band ?? "low",
        sla_due: max?.sla_due ?? now.toISOString(),
      };
    });
    groups.sort((a, b) => (b.max_risk_score ?? 0) - (a.max_risk_score ?? 0));

    const highPriority = findings.filter((f) => f.risk.high_priority);
    const payload: Envelope = {
      run_id: input?.run_id ?? runId,
      trigger: input?.trigger ?? invocation.trigger,
      stage: "prioritize",
      generated_at: input?.generated_at ?? new Date().toISOString(),
      findings: findings.sort((a, b) => b.risk.risk_score - a.risk.risk_score),
      groups,
      tickets: [],
      notes: [
        `weights: ${Object.entries(weights)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ")}`,
        `${highPriority.length} of ${findings.length} findings scored at or above the high-priority threshold of ${HIGH_PRIORITY_SCORE}`,
        ...findings.map((f) => `${f.finding_id}: ${f.risk.risk_score} (${f.risk.risk_band})`),
      ],
    };

    return {
      payload,
      count: findings.length,
      summary: `scored ${findings.length} findings, ${highPriority.length} high priority`,
      emit: findings.length > 0,
    };
  },
});

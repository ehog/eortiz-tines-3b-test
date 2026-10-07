const STATE_DIR = "/storage/vulnrisk_state";

const log = (entry: Record<string, unknown>) =>
  console.error(JSON.stringify({ step: "score-and-decide", ts: new Date().toISOString(), ...entry }));

type TrackedTicket = {
  correlationId: string;
  qid: string;
  assetId: string;
  hostname: string | null;
  ip: string;
  sysId: string;
  number: string;
  riskScore: number;
  priority: number;
  firstSeen: string;
  lastSeen: string;
};

async function readOpenTickets(): Promise<Record<string, TrackedTicket>> {
  try {
    return JSON.parse(await Bun.file(`${STATE_DIR}/open-tickets.json`).text());
  } catch {
    return {};
  }
}

const EXPOSURE_POINTS: Record<string, number> = { High: 25, Medium: 15, Low: 5, None: 0, Unknown: 8 };
const DEFENDER_RISK_POINTS: Record<string, number> = { High: 10, Medium: 6, Low: 3, None: 0, Informational: 0, Unknown: 3 };

function scoreDetection(d: any) {
  const factors: Record<string, number> = {};
  factors.qualysSeverity = d.severity >= 5 ? 35 : 25;
  factors.defenderExposure = EXPOSURE_POINTS[d.defender?.exposureLevel ?? "Unknown"] ?? 8;
  factors.defenderRisk = DEFENDER_RISK_POINTS[d.defender?.riskScore ?? "Unknown"] ?? 3;
  factors.internetFacing = d.internetFacing ? 15 : 0;
  factors.exploitAvailable = d.exploit?.defenderPublicExploit || d.exploit?.exploitInKit ? 20 : d.exploit?.qualys ? 12 : 0;
  factors.malware = d.malwareAvailable ? 5 : 0;

  const highSeverityAlerts = (d.defender?.activeAlerts ?? []).filter((a: any) =>
    ["High", "Medium"].includes(a.severity),
  ).length;
  factors.activeAlerts = Math.min(highSeverityAlerts * 5, 10);
  factors.unmanagedEndpoint = d.defender?.found === false ? 5 : 0;

  const total = Math.min(
    100,
    Object.values(factors).reduce((a, b) => a + b, 0),
  );
  return { riskScore: total, factors };
}

function priorityFor(score: number): { priority: number; impact: number; urgency: number; label: string } {
  if (score >= 85) return { priority: 1, impact: 1, urgency: 1, label: "Critical" };
  if (score >= 70) return { priority: 2, impact: 1, urgency: 2, label: "High" };
  if (score >= 50) return { priority: 3, impact: 2, urgency: 2, label: "Moderate" };
  return { priority: 4, impact: 3, urgency: 3, label: "Low" };
}

const payload = JSON.parse(await Bun.stdin.text()) as {
  runAt: string;
  since: string;
  until: string;
  trackedAssetIdsChecked?: string[];
  stillOpenCorrelationIds?: string[];
  detections: any[];
};

const checkedAssets = new Set(payload.trackedAssetIdsChecked ?? []);
const stillOpen = new Set(payload.stillOpenCorrelationIds ?? []);

const open = await readOpenTickets();
const seen = new Set<string>();
const decisions: any[] = [];

for (const d of payload.detections) {
  const correlationId = `qualys-${d.qid}-${d.assetId}`;
  if (seen.has(correlationId)) continue;
  seen.add(correlationId);

  const { riskScore, factors } = scoreDetection(d);
  const p = priorityFor(riskScore);
  const existing = open[correlationId];

  decisions.push({
    action: existing ? "update" : "create",
    correlationId,
    riskScore,
    riskFactors: factors,
    ...p,
    existing: existing ? { sysId: existing.sysId, number: existing.number, previousRiskScore: existing.riskScore } : null,
    detection: d,
  });
}

for (const [correlationId, ticket] of Object.entries(open)) {
  if (seen.has(correlationId)) continue;
  // Only resolve when Qualys was actually asked about this asset this run and no longer reports the QID.
  if (!checkedAssets.has(ticket.assetId) || stillOpen.has(correlationId)) {
    log({ event: "decision_skipped", correlation_id: correlationId, reason: !checkedAssets.has(ticket.assetId) ? "asset_not_checked" : "still_open" });
    continue;
  }
  decisions.push({
    action: "resolve",
    correlationId,
    riskScore: ticket.riskScore,
    priority: ticket.priority,
    existing: { sysId: ticket.sysId, number: ticket.number, previousRiskScore: ticket.riskScore },
    ticket,
  });
}

const counts = decisions.reduce<Record<string, number>>((acc, d) => {
  acc[d.action] = (acc[d.action] ?? 0) + 1;
  return acc;
}, {});
log({ event: "decisions_computed", ...counts, total: decisions.length, tracked_open: Object.keys(open).length });

console.log(JSON.stringify({ runAt: payload.runAt, since: payload.since, until: payload.until, decisions }));

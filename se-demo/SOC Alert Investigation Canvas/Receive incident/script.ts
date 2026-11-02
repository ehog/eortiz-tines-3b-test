import {
  dir,
  logger,
  newInvestigationId,
  parseHttpRequest,
  respondJson,
  sanitizeId,
  writeJson,
  type Incident,
} from "./lib";

const raw = await Bun.stdin.text();
const request = parseHttpRequest(raw);

if (request.method !== "POST" && request.method !== "PUT") {
  await respondJson(405, { error: "send the incident as a POST body" });
  process.exit(0);
}

let payload: Record<string, unknown>;
try {
  payload = JSON.parse(request.body) as Record<string, unknown>;
} catch {
  await respondJson(400, { error: "body must be JSON" });
  process.exit(0);
}

const requestedId = request.query.get("id");
const investigationId = requestedId ? sanitizeId(requestedId) : newInvestigationId();
const audit = logger(investigationId, "Receive incident");

const incident = normalize(payload, investigationId);
await writeJson(`${dir(investigationId)}/incident.json`, incident);
audit.log("incident_received", `${incident.source}:${incident.vendorId}`, "ok");

await respondJson(202, {
  investigationId,
  source: incident.source,
  title: incident.title,
  severity: incident.severity,
  alertTime: incident.alertTime,
});

function normalize(body: Record<string, unknown>, id: string): Incident {
  const isDefender = looksLikeDefender(body);
  const now = new Date().toISOString();
  if (isDefender) {
    const alerts = asArray(body.alerts);
    const first = (alerts[0] ?? {}) as Record<string, unknown>;
    const vendorId = str(body.incidentId ?? body.id ?? first.id) || id;
    return {
      investigationId: id,
      source: "defender",
      vendorId,
      correlationId: `MDE-${vendorId}`,
      title: str(body.displayName ?? first.title) || "Microsoft Defender incident",
      description: str(first.description ?? body.description) || "No description supplied by Defender.",
      severity: normalizeSeverity(str(body.severity ?? first.severity)),
      status: str(body.status ?? first.status) || "active",
      alertTime:
        firstIso([
          first.firstActivityDateTime,
          first.createdDateTime,
          body.createdDateTime,
          body.lastUpdateDateTime,
        ]) ?? now,
      receivedAt: now,
      vendorEntities: alerts.flatMap((alert) => asArray((alert as Record<string, unknown>).evidence)) as Record<
        string,
        unknown
      >[],
      raw: body,
    };
  }

  const properties = (body.properties ?? body) as Record<string, unknown>;
  const vendorId = str(properties.incidentNumber ?? body.name ?? body.id) || id;
  return {
    investigationId: id,
    source: "sentinel",
    vendorId,
    correlationId: `SENTINEL-${vendorId}`,
    title: str(properties.title) || "Microsoft Sentinel incident",
    description: str(properties.description) || "No description supplied by Sentinel.",
    severity: normalizeSeverity(str(properties.severity)),
    status: str(properties.status) || "New",
    alertTime:
      firstIso([
        properties.firstActivityTimeUtc,
        properties.createdTimeUtc,
        properties.lastActivityTimeUtc,
        body.createdTimeUtc,
      ]) ?? now,
    receivedAt: now,
    vendorEntities: [
      ...asArray(properties.entities),
      ...asArray(body.entities),
      ...asArray((body as Record<string, unknown>).Entities),
      ...asArray((properties.relatedEntities as unknown) ?? []),
    ] as Record<string, unknown>[],
    raw: body,
  };
}

function looksLikeDefender(body: Record<string, unknown>): boolean {
  if (Array.isArray(body.alerts)) return true;
  if (body.incidentId !== undefined && body.properties === undefined) return true;
  const odata = str(body["@odata.type"]);
  return odata.includes("security") && body.properties === undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function firstIso(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const text = str(candidate);
    if (!text) continue;
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

function normalizeSeverity(value: string): string {
  const lowered = value.toLowerCase();
  if (["high", "critical"].includes(lowered)) return "high";
  if (lowered === "medium" || lowered === "moderate") return "medium";
  if (lowered === "low") return "low";
  if (lowered.startsWith("info")) return "informational";
  return "medium";
}

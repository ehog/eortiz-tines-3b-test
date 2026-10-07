const SN_BASE = (process.env.SERVICE_NOW_URL ?? "").replace(/\/$/, "");
const STATE_DIR = "/storage/vulnrisk_state";

const decision = (entry: Record<string, unknown>) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
const log = (entry: Record<string, unknown>) =>
  console.error(JSON.stringify({ step: "sync-servicenow", ts: new Date().toISOString(), ...entry }));

if (!SN_BASE) throw new Error("SERVICE_NOW_URL is not set — attach the ServiceNow connector to this step");

async function sn<T>(method: string, path: string, body?: unknown): Promise<T> {
  let delayMs = 2000;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${SN_BASE}${path}`, {
      method,
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return (await res.json()) as T;
    const text = await res.text().catch(() => "");
    if (!(res.status === 429 || res.status >= 500) || attempt === 4) {
      throw new Error(`ServiceNow ${method} ${path} failed: ${res.status} ${text.slice(0, 400)}`);
    }
    log({ event: "servicenow_retry", status: res.status, attempt, wait_ms: delayMs });
    await new Promise((r) => setTimeout(r, delayMs));
    delayMs *= 2;
  }
  throw new Error("unreachable");
}

const q = (v: string) => encodeURIComponent(v);

type Ci = { sys_id: string; name: string; support_group?: { value: string } | string | null; ip_address?: string };

const ciCache = new Map<string, { sysId: string; name: string; supportGroup: string | null } | null>();

async function lookupCi(hostname: string | null, ip: string) {
  const key = `${hostname ?? ""}|${ip}`;
  if (ciCache.has(key)) return ciCache.get(key) ?? null;

  const queries: string[] = [];
  if (hostname) {
    const short = hostname.split(".")[0];
    queries.push(`name=${hostname}`, `name=${short}`, `fqdn=${hostname}`);
  }
  if (ip) queries.push(`ip_address=${ip}`);

  let result: { sysId: string; name: string; supportGroup: string | null } | null = null;
  for (const query of queries) {
    const res = await sn<{ result: Ci[] }>(
      "GET",
      `/api/now/table/cmdb_ci?sysparm_query=${q(query)}&sysparm_limit=1&sysparm_fields=sys_id,name,support_group,ip_address`,
    );
    const ci = res.result?.[0];
    if (ci) {
      const sg = typeof ci.support_group === "object" && ci.support_group ? ci.support_group.value : (ci.support_group as string | undefined);
      result = { sysId: ci.sys_id, name: ci.name, supportGroup: sg && sg !== "" ? sg : null };
      break;
    }
  }
  ciCache.set(key, result);
  return result;
}

function describe(d: any, riskScore: number, factors: Record<string, number>, label: string): string {
  const def = d.defender ?? {};
  const alerts = (def.activeAlerts ?? []) as any[];
  return [
    `Composite risk score: ${riskScore}/100 (${label})`,
    "",
    "== Qualys ==",
    `QID: ${d.qid} — ${d.title}`,
    `Severity: ${d.severity}/5   Status: ${d.status}`,
    `CVEs: ${(d.cves ?? []).join(", ") || "none mapped"}`,
    `Asset ID: ${d.assetId}   Host: ${d.hostname ?? "unknown"} (${d.ip})   OS: ${d.os || "unknown"}`,
    `Port/Protocol: ${d.port ?? "n/a"}/${d.protocol ?? "n/a"}`,
    `First found: ${d.firstFound}   Last found: ${d.lastFound}   Times found: ${d.timesFound}`,
    `Patch available: ${d.patchable ? "yes" : "no"}   Internet-facing: ${d.internetFacing ? "yes" : "no"}`,
    "",
    "== Microsoft Defender ==",
    def.found
      ? [
          `Machine ID: ${def.machineId}   Name: ${def.computerDnsName ?? "unknown"}`,
          `Exposure level: ${def.exposureLevel}   Device risk: ${def.riskScore}`,
          `Health: ${def.healthStatus}   Onboarding: ${def.onboardingStatus}`,
          `Active alerts (${alerts.length}):`,
          ...(alerts.length
            ? alerts.slice(0, 10).map((a) => `  - [${a.severity}] ${a.title} (${a.status}, ${a.category ?? "n/a"}, ${a.detectedAt ?? ""})`)
            : ["  - none"]),
        ].join("\n")
      : "Device not found in Defender — endpoint may be unmanaged or unonboarded.",
    "",
    "== Exploit intelligence ==",
    `Qualys exploit/threat intel: ${d.exploit?.qualys ? "yes" : "no"}`,
    `Defender public exploit: ${d.exploit?.defenderPublicExploit ? "yes" : "no"}   In exploit kit: ${d.exploit?.exploitInKit ? "yes" : "no"}`,
    `Max CVSS v3: ${d.exploit?.maxCvss ?? "unknown"}   Known malware: ${d.malwareAvailable ? "yes" : "no"}`,
    "",
    "== Risk score breakdown ==",
    ...Object.entries(factors).map(([k, v]) => `  ${k}: +${v}`),
    "",
    "== Qualys detection results ==",
    String(d.results ?? "").slice(0, 1500) || "(none)",
  ].join("\n");
}

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

async function readOpen(): Promise<Record<string, TrackedTicket>> {
  try {
    return JSON.parse(await Bun.file(`${STATE_DIR}/open-tickets.json`).text());
  } catch {
    return {};
  }
}

async function findIncident(correlationId: string) {
  const res = await sn<{ result: { sys_id: string; number: string; state: string }[] }>(
    "GET",
    `/api/now/table/incident?sysparm_query=${q(`correlation_id=${correlationId}^stateNOT IN6,7,8`)}&sysparm_limit=1&sysparm_fields=sys_id,number,state`,
  );
  return res.result?.[0] ?? null;
}

const payload = JSON.parse(await Bun.stdin.text()) as {
  runAt: string;
  since: string;
  until: string;
  decisions: any[];
};

const open = await readOpen();
let created = 0;
let updated = 0;
let resolved = 0;
let failed = 0;

for (const dec of payload.decisions) {
  try {
    if (dec.action === "resolve") {
      const t = dec.ticket as TrackedTicket;
      const incident = (await findIncident(dec.correlationId)) ?? { sys_id: t.sysId, number: t.number };
      await sn("PATCH", `/api/now/table/incident/${incident.sys_id}`, {
        state: "6",
        close_code: "Solved (Permanently)",
        close_notes: `Qualys no longer reports QID ${t.qid} on asset ${t.assetId} (${t.hostname ?? t.ip}) at severity 4-5. Remediation verified by automated rescan comparison on ${payload.runAt}. Closing automatically.`,
        work_notes: `Automated vulnerability lifecycle sync: detection absent from Qualys as of ${payload.until}.`,
      });
      delete open[dec.correlationId];
      resolved++;
      decision({
        action: "resolved",
        correlation_id: dec.correlationId,
        incident: incident.number,
        qid: t.qid,
        asset_id: t.assetId,
        hostname: t.hostname,
        reason: "detection_no_longer_reported",
      });
      continue;
    }

    const d = dec.detection;
    const ci = await lookupCi(d.hostname, d.ip);
    const description = describe(d, dec.riskScore, dec.riskFactors, dec.label);
    const shortDescription = `[Risk ${dec.riskScore}] QID ${d.qid} sev ${d.severity} on ${d.hostname ?? d.ip} — ${String(d.title).slice(0, 90)}`;

    const fields: Record<string, unknown> = {
      correlation_id: dec.correlationId,
      correlation_display: "Qualys VM detection",
      short_description: shortDescription,
      description,
      category: "security",
      subcategory: "vulnerability",
      impact: String(dec.impact),
      urgency: String(dec.urgency),
      priority: String(dec.priority),
      ...(ci?.sysId ? { cmdb_ci: ci.sysId } : {}),
      ...(ci?.supportGroup ? { assignment_group: ci.supportGroup } : {}),
    };

    const existing = (await findIncident(dec.correlationId)) ?? (dec.existing ? { sys_id: dec.existing.sysId, number: dec.existing.number } : null);

    let sysId: string;
    let number: string;
    if (existing) {
      const res = await sn<{ result: { sys_id: string; number: string } }>("PATCH", `/api/now/table/incident/${existing.sys_id}`, {
        ...fields,
        work_notes: `Re-observed by Qualys at ${d.lastFound}. Composite risk score now ${dec.riskScore} (was ${dec.existing?.previousRiskScore ?? "unknown"}).`,
      });
      sysId = res.result.sys_id;
      number = res.result.number;
      updated++;
    } else {
      const res = await sn<{ result: { sys_id: string; number: string } }>("POST", "/api/now/table/incident", fields);
      sysId = res.result.sys_id;
      number = res.result.number;
      created++;
    }

    const prior = open[dec.correlationId];
    open[dec.correlationId] = {
      correlationId: dec.correlationId,
      qid: d.qid,
      assetId: d.assetId,
      hostname: d.hostname ?? null,
      ip: d.ip,
      sysId,
      number,
      riskScore: dec.riskScore,
      priority: dec.priority,
      firstSeen: prior?.firstSeen ?? payload.runAt,
      lastSeen: payload.runAt,
    };

    decision({
      action: existing ? "updated" : "created",
      correlation_id: dec.correlationId,
      incident: number,
      qid: d.qid,
      asset_id: d.assetId,
      hostname: d.hostname,
      ip: d.ip,
      qualys_severity: d.severity,
      defender_exposure: d.defender?.exposureLevel ?? "Unknown",
      defender_found: d.defender?.found ?? false,
      active_alerts: (d.defender?.activeAlerts ?? []).length,
      internet_facing: d.internetFacing,
      exploit_available: Boolean(d.exploit?.defenderPublicExploit || d.exploit?.exploitInKit || d.exploit?.qualys),
      risk_score: dec.riskScore,
      priority: dec.priority,
      cmdb_ci: ci?.sysId ?? null,
      assignment_group: ci?.supportGroup ?? null,
    });
  } catch (err) {
    failed++;
    decision({
      action: "failed",
      correlation_id: dec.correlationId,
      intended_action: dec.action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

await Bun.write(`${STATE_DIR}/open-tickets.json`, JSON.stringify(open, null, 2));
// Advance the watermark only when every decision landed, so failures are retried next run.
if (failed === 0) {
  await Bun.write(`${STATE_DIR}/watermark.json`, JSON.stringify({ since: payload.until, updatedAt: payload.runAt }, null, 2));
}

log({ event: "run_complete", created, updated, resolved, failed, tracked_open: Object.keys(open).length, watermark_advanced: failed === 0 });

if (failed > 0) throw new Error(`${failed} of ${payload.decisions.length} ServiceNow decisions failed`);

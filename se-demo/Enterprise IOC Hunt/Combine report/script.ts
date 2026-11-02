import { openDb, readUpstreamJson, SOURCES } from "./lib";

type Upstream = { huntId: string };
type Row = {
  source: string;
  indicator: string;
  status: string;
  error_reason: string | null;
  findings_json: string | null;
  first_seen: string | null;
  last_seen: string | null;
  frequency: number;
};

const upstream = await readUpstreamJson<Upstream>();
const huntId = upstream.huntId;
if (!huntId) throw new Error("Upstream payload has no huntId");

const db = openDb("write");
try {
  const hunt = db
    .query<
      { id: string; reason: string; demo_mode: string; created_at: string; combined_at: string | null },
      [string]
    >(`SELECT id, reason, demo_mode, created_at, combined_at FROM hunts WHERE id = ?`)
    .get(huntId);
  if (!hunt) throw new Error(`Unknown hunt ${huntId}`);

  const indicators = db
    .query<{ value: string; type: string }, [string]>(
      `SELECT value, type FROM indicators WHERE hunt_id = ? ORDER BY position`,
    )
    .all(huntId);

  const rows = db
    .query<Row, [string]>(
      `SELECT source, indicator, status, error_reason, findings_json, first_seen, last_seen, frequency
         FROM source_results WHERE hunt_id = ?`,
    )
    .all(huntId);

  const expected = indicators.length * SOURCES.length;
  if (rows.length < expected) {
    // Fan-in guard: this step runs once per upstream search, so do nothing until every source has reported.
    process.exit(0);
  }

  const byKey = new Map(rows.map((r) => [`${r.source}|${r.indicator}`, r]));

  const sourceHealth = SOURCES.map((s) => {
    const mine = rows.filter((r) => r.source === s.key);
    const errored = mine.filter((r) => r.status === "error");
    const hits = mine.filter((r) => r.status === "hit");
    return {
      source: s.key,
      label: s.label,
      complete: errored.length === 0,
      indicatorsSearched: mine.length - errored.length,
      indicatorsErrored: errored.length,
      matched: hits.length,
      totalEvents: hits.reduce((sum, r) => sum + r.frequency, 0),
      error: errored[0]?.error_reason ?? null,
    };
  });

  const reportIndicators = indicators.map((ind) => {
    const perSource: Record<string, unknown> = {};
    const devices: unknown[] = [];
    const users: unknown[] = [];
    const emailMessages: unknown[] = [];
    const networkConnections: unknown[] = [];
    const proxyActivity: unknown[] = [];
    const alerts: unknown[] = [];
    const stamps: string[] = [];
    let total = 0;
    let found = false;
    const incompleteSources: { source: string; label: string; reason: string }[] = [];

    for (const s of SOURCES) {
      const row = byKey.get(`${s.key}|${ind.value}`);
      if (!row) {
        perSource[s.key] = { label: s.label, status: "error", summary: "Incomplete", error: "No result recorded" };
        incompleteSources.push({ source: s.key, label: s.label, reason: "No result recorded" });
        continue;
      }
      if (row.status === "error") {
        perSource[s.key] = {
          label: s.label,
          status: "error",
          summary: "Incomplete — search did not run to completion",
          error: row.error_reason,
        };
        incompleteSources.push({ source: s.key, label: s.label, reason: row.error_reason ?? "Unknown error" });
        continue;
      }
      if (row.status === "no_match") {
        perSource[s.key] = { label: s.label, status: "no_match", summary: "No matches", frequency: 0 };
        continue;
      }

      found = true;
      total += row.frequency;
      if (row.first_seen) stamps.push(row.first_seen);
      if (row.last_seen) stamps.push(row.last_seen);
      const f = JSON.parse(row.findings_json ?? "{}") as Record<string, any>;
      perSource[s.key] = {
        label: s.label,
        status: "hit",
        summary: summarize(s.key, f, row.frequency),
        frequency: row.frequency,
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        findings: f,
      };

      if (s.key === "defender") {
        for (const d of f.devices ?? []) devices.push({ source: s.label, ...d });
        for (const u of f.users ?? []) users.push({ source: s.label, identity: u.accountUpn, context: `${u.department} — ${u.title}` });
        for (const c of f.networkConnections ?? []) networkConnections.push({ source: s.label, ...c });
        for (const a of f.alerts ?? []) alerts.push({ source: s.label, title: a.title, severity: a.severity, id: a.alertId, at: a.detectedAt, kind: "Defender alert" });
        for (const e of f.fileEvents ?? []) networkConnections.push({ source: s.label, timestamp: e.timestamp, deviceName: e.deviceName, initiatingProcess: e.actionType, remoteTarget: `${e.folderPath}\\${e.fileName}`, remotePort: "-", protocol: "file", action: e.actionType });
      }
      if (s.key === "sentinel") {
        for (const i of f.incidents ?? []) alerts.push({ source: s.label, title: `#${i.incidentNumber} ${i.title}`, severity: i.severity, id: String(i.incidentNumber), at: i.createdAt, kind: `Sentinel incident (${i.status})`, owner: i.owner, url: i.url });
        for (const a of f.alerts ?? []) alerts.push({ source: s.label, title: a.name, severity: a.severity, id: a.alertId, at: a.generatedAt, kind: `Sentinel alert (${a.table})` });
        for (const e of f.entities ?? []) if (e.type === "Account") users.push({ source: s.label, identity: e.value, context: "Sentinel entity" });
        for (const e of f.entities ?? []) if (e.type === "Host") devices.push({ source: s.label, deviceName: e.value, osPlatform: "-", riskScore: "-", lastInternalIp: "-", lastSeen: row.last_seen });
      }
      if (s.key === "proofpoint") {
        for (const m of f.messages ?? []) emailMessages.push({ source: s.label, ...m });
        for (const u of f.users ?? []) users.push({ source: s.label, identity: u.upn, context: u.vap ? "Very Attacked Person" : "Mail recipient" });
      }
      if (s.key === "zscaler") {
        for (const t of f.transactions ?? []) proxyActivity.push({ source: s.label, ...t });
        for (const u of f.users ?? []) users.push({ source: s.label, identity: u.user, context: `${u.department} — ${u.transactions} proxy transactions` });
      }
    }

    stamps.sort();
    return {
      value: ind.value,
      type: ind.type,
      found,
      firstSeen: stamps[0] ?? null,
      lastSeen: stamps[stamps.length - 1] ?? null,
      totalFrequency: total,
      matchedSources: SOURCES.filter((s) => (perSource[s.key] as any)?.status === "hit").map((s) => s.label),
      incompleteSources,
      sources: perSource,
      devices,
      users: dedupe(users, (u: any) => `${u.source}|${u.identity}`),
      emailMessages,
      networkConnections,
      proxyActivity,
      alerts,
    };
  });

  const matched = reportIndicators.filter((i) => i.found);
  const combinedAt = hunt.created_at;
  const report = {
    huntId: hunt.id,
    reason: hunt.reason,
    demoMode: hunt.demo_mode,
    createdAt: hunt.created_at,
    combinedAt,
    indicatorCount: reportIndicators.length,
    matchedCount: matched.length,
    anyFound: matched.length > 0,
    totalEvents: reportIndicators.reduce((s, i) => s + i.totalFrequency, 0),
    incompleteSources: sourceHealth.filter((s) => !s.complete).map((s) => ({ source: s.source, label: s.label, reason: s.error })),
    sourceHealth,
    indicators: reportIndicators,
  };

  const claim = db
    .query(
      `UPDATE hunts SET status = ?, combined_at = ?, report_json = ?
         WHERE id = ? AND combined_at IS NULL`,
    )
    .run(matched.length > 0 ? "found" : "clean", combinedAt, JSON.stringify(report), huntId);

  if (claim.changes === 0) {
    // Another parallel search already produced the report for this hunt.
    process.exit(0);
  }

  console.log(JSON.stringify(report));
} finally {
  db.close();
}

function dedupe<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function summarize(source: string, f: Record<string, any>, frequency: number): string {
  if (source === "defender") {
    return `${f.devices?.length ?? 0} device(s), ${f.users?.length ?? 0} user(s), ${f.networkConnections?.length ?? 0} network event(s), ${f.fileEvents?.length ?? 0} file event(s), ${f.alerts?.length ?? 0} alert(s)`;
  }
  if (source === "sentinel") {
    return `${f.incidents?.length ?? 0} incident(s), ${f.alerts?.length ?? 0} analytics alert(s), ${frequency} matching log row(s)`;
  }
  if (source === "proofpoint") {
    return `${f.messages?.length ?? 0} message(s) — ${f.blocked ?? 0} blocked, ${f.quarantined ?? 0} quarantined, ${f.delivered ?? 0} delivered, ${f.clicksPermitted ?? 0} click(s) permitted`;
  }
  return `${f.transactions?.length ?? 0} proxy transaction(s) — ${f.allowed ?? 0} allowed, ${f.blocked ?? 0} blocked, ${f.users?.length ?? 0} user(s)`;
}

import { parseRequest, respond, jsonBody, type Req } from "./http";
import {
  openWrite,
  listDetections,
  SCHEMA,
  type ListFilters,
} from "./qualys-db";
import { SAMPLE_FINDINGS, PRESETS, type FindingRow } from "./sample-findings";
import type { Database } from "bun:sqlite";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function insert(db: Database, f: FindingRow, id = f.id, now = Date.now()): void {
  db.query(
    `INSERT OR REPLACE INTO findings (
      id, qid, detection_type, title, category, vuln_class, severity,
      cvss_base, cvss_temporal, cvss_vector, cves, kev, exploit_in_wild,
      kev_due_date, patch_available, status, finding_type, asset_id, hostname,
      ip, os, tags, exposure_override, software, results, solution,
      first_found, last_found, last_updated, times_detected
    ) VALUES (
      $id, $qid, $detection_type, $title, $category, $vuln_class, $severity,
      $cvss_base, $cvss_temporal, $cvss_vector, $cves, $kev, $exploit_in_wild,
      $kev_due_date, $patch_available, $status, $finding_type, $asset_id, $hostname,
      $ip, $os, $tags, NULL, $software, $results, $solution,
      $first_found, $last_found, $last_updated, $times_detected
    )`,
  ).run({
    $id: id,
    $qid: f.qid,
    $detection_type: f.detection_type,
    $title: f.title,
    $category: f.category,
    $vuln_class: f.vuln_class,
    $severity: f.severity,
    $cvss_base: f.cvss_base,
    $cvss_temporal: f.cvss_temporal,
    $cvss_vector: f.cvss_vector,
    $cves: JSON.stringify(f.cves),
    $kev: f.kev ? 1 : 0,
    $exploit_in_wild: f.exploit_in_wild ? 1 : 0,
    $kev_due_date: f.kev_due_date,
    $patch_available: f.patch_available ? 1 : 0,
    $status: f.status,
    $finding_type: f.finding_type,
    $asset_id: f.asset_id,
    $hostname: f.hostname,
    $ip: f.ip,
    $os: f.os,
    $tags: JSON.stringify(f.tags),
    $software: JSON.stringify(f.software),
    $results: f.results,
    $solution: f.solution,
    $first_found: iso(now - f.first_found_days_ago * DAY),
    $last_found: iso(now - f.last_found_hours_ago * HOUR),
    $last_updated: iso(now - f.last_found_hours_ago * HOUR),
    $times_detected: f.times_detected,
  });
}

function seed(db: Database): number {
  const now = Date.now();
  db.transaction(() => {
    db.run("DELETE FROM findings");
    for (const f of SAMPLE_FINDINGS) insert(db, f, f.id, now);
    db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded_at', $v)").run({
      $v: iso(now),
    });
  })();
  return SAMPLE_FINDINGS.length;
}

function nextInjectedId(db: Database, base: string): string {
  const existing = db
    .query("SELECT COUNT(*) AS n FROM findings WHERE id LIKE $like")
    .get({ $like: `${base}-INJ%` }) as { n: number };
  return `${base}-INJ${existing.n + 1}`;
}

const EDITABLE: Record<string, "int" | "real" | "text" | "bool"> = {
  severity: "int",
  cvss_base: "real",
  cvss_temporal: "real",
  kev: "bool",
  exploit_in_wild: "bool",
  status: "text",
  exposure_override: "text",
  title: "text",
};

function main(raw: string): void {
  const req: Req = parseRequest(raw);
  const db = openWrite();
  db.run(SCHEMA);

  const count = (db.query("SELECT COUNT(*) AS n FROM findings").get() as { n: number }).n;
  let seeded = 0;
  if (count === 0) seeded = seed(db);

  if (req.method === "GET") {
    const filters: ListFilters = {
      since: req.query.get("since") ?? undefined,
      updatedSince: req.query.get("updated_since") ?? undefined,
      status: req.query.get("status") ?? undefined,
      ids: req.query.get("ids")?.split(",").filter(Boolean),
    };
    const data = listDetections(db, filters);
    respond(200, {
      responseCode: "SUCCESS",
      count: data.length,
      seeded_on_this_request: seeded,
      data,
    });
    return;
  }

  if (req.method === "POST") {
    const body = jsonBody(req);
    const action = String(body.action ?? "");
    if (action === "reset") {
      const n = seed(db);
      respond(200, { responseCode: "SUCCESS", action, count: n });
      return;
    }
    if (action === "inject") {
      const presetKey = String(body.preset ?? "");
      const sourceId = PRESETS[presetKey];
      if (!sourceId) {
        respond(400, {
          responseCode: "INVALID_REQUEST",
          error: `unknown preset '${presetKey}'`,
          valid_presets: Object.keys(PRESETS),
        });
        return;
      }
      const source = SAMPLE_FINDINGS.find((f) => f.id === sourceId)!;
      const id = nextInjectedId(db, sourceId);
      const overrides = (body.overrides ?? {}) as Partial<FindingRow>;
      const clone: FindingRow = {
        ...source,
        ...overrides,
        status: "Active",
        first_found_days_ago: 0,
        last_found_hours_ago: 0,
        times_detected: 1,
      };
      insert(db, clone, id);
      respond(201, {
        responseCode: "SUCCESS",
        action,
        id,
        detection: listDetections(db, { ids: [id] })[0],
      });
      return;
    }
    respond(400, {
      responseCode: "INVALID_REQUEST",
      error: `unknown action '${action}'`,
      valid_actions: ["reset", "inject"],
    });
    return;
  }

  if (req.method === "PATCH") {
    const body = jsonBody(req);
    const id = String(body.id ?? "");
    const exists = db.query("SELECT id FROM findings WHERE id = $id").get({ $id: id });
    if (!exists) {
      respond(404, { responseCode: "NOT_FOUND", error: `no detection '${id}'` });
      return;
    }
    if (body.action === "remediate") {
      db.query(
        "UPDATE findings SET status = 'Fixed', last_updated = $now WHERE id = $id",
      ).run({ $id: id, $now: iso(Date.now()) });
      respond(200, {
        responseCode: "SUCCESS",
        action: "remediate",
        detection: listDetections(db, { ids: [id] })[0],
      });
      return;
    }
    const sets: string[] = [];
    const params: Record<string, string | number | null> = { $id: id, $now: iso(Date.now()) };
    for (const [field, kind] of Object.entries(EDITABLE)) {
      if (!(field in body)) continue;
      const value = body[field];
      if (kind === "bool") params[`$${field}`] = value ? 1 : 0;
      else if (kind === "int") params[`$${field}`] = Math.round(Number(value));
      else if (kind === "real") params[`$${field}`] = Number(value);
      else params[`$${field}`] = value === null || value === "" ? null : String(value);
      sets.push(`${field} = $${field}`);
    }
    if (!sets.length) {
      respond(400, {
        responseCode: "INVALID_REQUEST",
        error: "no editable fields supplied",
        editable: Object.keys(EDITABLE),
      });
      return;
    }
    sets.push("last_updated = $now");
    db.query(`UPDATE findings SET ${sets.join(", ")} WHERE id = $id`).run(params);
    respond(200, {
      responseCode: "SUCCESS",
      action: "update",
      detection: listDetections(db, { ids: [id] })[0],
    });
    return;
  }

  if (req.method === "DELETE") {
    const id = req.query.get("id") ?? "";
    db.query("DELETE FROM findings WHERE id = $id").run({ $id: id });
    respond(200, { responseCode: "SUCCESS", action: "delete", id });
    return;
  }

  respond(405, { responseCode: "INVALID_REQUEST", error: `method ${req.method} not allowed` });
}

try {
  main(await Bun.stdin.text());
} catch (err) {
  console.error(err instanceof Error ? err.stack : String(err));
  respond(400, {
    responseCode: "INVALID_REQUEST",
    error: err instanceof Error ? err.message : String(err),
  });
}

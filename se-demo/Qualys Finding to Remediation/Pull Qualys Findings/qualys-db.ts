// Data layer for the mocked Qualys detection store (volume `qualys_state`).
// `listDetections` returns Qualys-VMDR-shaped detections: it is the seam to
// replace with a real Qualys API call when the mock is swapped out.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "node:fs";

export const DB_DIR = "/storage/qualys_state";
export const DB_PATH = `${DB_DIR}/qualys.db`;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  qid INTEGER NOT NULL,
  detection_type TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  vuln_class TEXT NOT NULL,
  severity INTEGER NOT NULL,
  cvss_base REAL NOT NULL,
  cvss_temporal REAL NOT NULL,
  cvss_vector TEXT NOT NULL,
  cves TEXT NOT NULL,
  kev INTEGER NOT NULL,
  exploit_in_wild INTEGER NOT NULL,
  kev_due_date TEXT,
  patch_available INTEGER NOT NULL,
  status TEXT NOT NULL,
  finding_type TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  hostname TEXT NOT NULL,
  ip TEXT NOT NULL,
  os TEXT NOT NULL,
  tags TEXT NOT NULL,
  exposure_override TEXT,
  software TEXT NOT NULL,
  results TEXT NOT NULL,
  solution TEXT NOT NULL,
  first_found TEXT NOT NULL,
  last_found TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  times_detected INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export type Row = {
  id: string;
  qid: number;
  detection_type: string;
  title: string;
  category: string;
  vuln_class: string;
  severity: number;
  cvss_base: number;
  cvss_temporal: number;
  cvss_vector: string;
  cves: string;
  kev: number;
  exploit_in_wild: number;
  kev_due_date: string | null;
  patch_available: number;
  status: string;
  finding_type: string;
  asset_id: string;
  hostname: string;
  ip: string;
  os: string;
  tags: string;
  exposure_override: string | null;
  software: string;
  results: string;
  solution: string;
  first_found: string;
  last_found: string;
  last_updated: string;
  times_detected: number;
};

export type Detection = {
  ID: string;
  QID: number;
  TYPE: string;
  TITLE: string;
  CATEGORY: string;
  VULN_CLASS: string;
  SEVERITY: number;
  CVSS: { BASE: number; TEMPORAL: number; VECTOR: string };
  CVE_LIST: string[];
  THREAT_INTEL: {
    KNOWN_EXPLOITED: boolean;
    EXPLOIT_IN_THE_WILD: boolean;
    CISA_KEV_DUE_DATE: string | null;
  };
  PATCH_AVAILABLE: boolean;
  STATUS: string;
  FINDING_TYPE: string;
  ASSET: {
    ASSET_ID: string;
    HOSTNAME: string;
    IP: string;
    OS: string;
    TAGS: string[];
    EXPOSURE_OVERRIDE: string | null;
  };
  SOFTWARE: Record<string, unknown>;
  RESULTS: string;
  SOLUTION: string;
  FIRST_FOUND_DATETIME: string;
  LAST_FOUND_DATETIME: string;
  LAST_UPDATE_DATETIME: string;
  TIMES_DETECTED: number;
};

export function openWrite(): Database {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new Database(DB_PATH, { create: true });
  // Rollback journalling, not WAL: readonly mounts cannot create the WAL shared-memory file.
  db.exec("PRAGMA journal_mode = DELETE");
  db.run(SCHEMA);
  return db;
}

/** Returns null when nothing has been seeded yet, so readers can degrade to an empty store. */
export function openRead(): Database | null {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

export function toDetection(row: Row): Detection {
  return {
    ID: row.id,
    QID: row.qid,
    TYPE: row.detection_type,
    TITLE: row.title,
    CATEGORY: row.category,
    VULN_CLASS: row.vuln_class,
    SEVERITY: row.severity,
    CVSS: { BASE: row.cvss_base, TEMPORAL: row.cvss_temporal, VECTOR: row.cvss_vector },
    CVE_LIST: JSON.parse(row.cves),
    THREAT_INTEL: {
      KNOWN_EXPLOITED: row.kev === 1,
      EXPLOIT_IN_THE_WILD: row.exploit_in_wild === 1,
      CISA_KEV_DUE_DATE: row.kev_due_date,
    },
    PATCH_AVAILABLE: row.patch_available === 1,
    STATUS: row.status,
    FINDING_TYPE: row.finding_type,
    ASSET: {
      ASSET_ID: row.asset_id,
      HOSTNAME: row.hostname,
      IP: row.ip,
      OS: row.os,
      TAGS: JSON.parse(row.tags),
      EXPOSURE_OVERRIDE: row.exposure_override,
    },
    SOFTWARE: JSON.parse(row.software),
    RESULTS: row.results,
    SOLUTION: row.solution,
    FIRST_FOUND_DATETIME: row.first_found,
    LAST_FOUND_DATETIME: row.last_found,
    LAST_UPDATE_DATETIME: row.last_updated,
    TIMES_DETECTED: row.times_detected,
  };
}

export type ListFilters = { since?: string; updatedSince?: string; status?: string; ids?: string[] };

export function listDetections(db: Database | null, filters: ListFilters = {}): Detection[] {
  if (!db) return [];
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filters.since) {
    where.push("last_found >= $since");
    params.$since = filters.since;
  }
  if (filters.updatedSince) {
    where.push("last_updated >= $updated_since");
    params.$updated_since = filters.updatedSince;
  }
  if (filters.status) {
    where.push("status = $status");
    params.$status = filters.status;
  }
  let sql = "SELECT * FROM findings";
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += " ORDER BY severity DESC, cvss_base DESC, id ASC";
  const rows = db.query(sql).all(params) as Row[];
  const filtered = filters.ids?.length ? rows.filter((r) => filters.ids!.includes(r.id)) : rows;
  return filtered.map(toDetection);
}

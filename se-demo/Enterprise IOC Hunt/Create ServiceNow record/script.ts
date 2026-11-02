import { mkdirSync } from "node:fs";
import { FINDINGS_DIR, openDb, readUpstreamJson } from "./lib";

type Report = {
  huntId: string;
  reason: string;
  anyFound: boolean;
  matchedCount: number;
  indicatorCount: number;
  totalEvents: number;
  incompleteSources: { label: string; reason: string | null }[];
  sourceHealth: { label: string; matched: number; complete: boolean }[];
  indicators: { value: string; type: string; found: boolean; totalFrequency: number; matchedSources: string[] }[];
};

const report = await readUpstreamJson<Report>();

mkdirSync(FINDINGS_DIR, { recursive: true });
const findingsPath = `${FINDINGS_DIR}/${report.huntId}.json`;
await Bun.write(findingsPath, JSON.stringify(report, null, 2));

const sysId = crypto.randomUUID().replace(/-/g, "");
const number = `INC00${Math.floor(Math.random() * 900000 + 100000)}`;
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const shortDescription = report.anyFound
  ? `IOC hunt ${report.huntId}: ${report.matchedCount} of ${report.indicatorCount} indicators FOUND in the environment`
  : `IOC hunt ${report.huntId}: no matches for ${report.indicatorCount} indicator(s)`;

// Mocked ServiceNow incident creation; the findings JSON on the volume stands in for the attachment.
const record = {
  sys_id: sysId,
  number,
  table: "incident",
  short_description: shortDescription,
  description: [
    `Reason / reference: ${report.reason}`,
    `Indicators searched: ${report.indicatorCount}`,
    `Indicators matched: ${report.matchedCount}`,
    `Total matching events: ${report.totalEvents}`,
    report.incompleteSources.length > 0
      ? `Incomplete sources: ${report.incompleteSources.map((s) => `${s.label} (${s.reason})`).join("; ")}`
      : "All four sources searched successfully.",
    "",
    ...report.indicators.map(
      (i) =>
        `- ${i.value} [${i.type}] ${i.found ? `FOUND in ${i.matchedSources.join(", ")} (${i.totalFrequency} events)` : "no matches"}`,
    ),
  ].join("\n"),
  category: "security",
  subcategory: "threat_hunting",
  urgency: report.anyFound ? "1" : "3",
  impact: report.anyFound ? "2" : "3",
  assignment_group: "Security Operations",
  state: report.anyFound ? "2" : "6",
  opened_at: createdAt,
  attachment: {
    file_name: `${report.huntId}-findings.json`,
    content_type: "application/json",
    size_bytes: Buffer.byteLength(JSON.stringify(report, null, 2)),
    stored_at: findingsPath,
  },
};

const db = openDb("write");
try {
  db.query(`UPDATE hunts SET sn_number = ?, sn_sys_id = ?, sn_created_at = ?, findings_path = ? WHERE id = ?`).run(
    number,
    sysId,
    createdAt,
    findingsPath,
    report.huntId,
  );
} finally {
  db.close();
}

console.log(JSON.stringify({ huntId: report.huntId, servicenow: record }));

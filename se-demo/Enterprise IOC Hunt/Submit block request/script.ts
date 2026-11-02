import { openDb, readUpstreamResponse } from "./lib";

const { headers } = await readUpstreamResponse();
const huntId = headers["x-ioc-hunt-id"] ?? "";
const decision = headers["x-ioc-decision"] ?? "";
const approver = headers["x-ioc-approver"] ?? "unknown";

if (!huntId || decision !== "approved") {
  // Nothing to submit unless a human approved the request.
  process.exit(0);
}

type Target = { indicator: string; type: string; system: string; action: string };

const db = openDb("write");
try {
  const request = db
    .query<{ targets_json: string | null; executed_at: string | null }, [string]>(
      `SELECT targets_json, executed_at FROM block_requests WHERE hunt_id = ?`,
    )
    .get(huntId);
  if (!request) throw new Error(`No block request for hunt ${huntId}`);
  if (request.executed_at) process.exit(0);

  const targets = JSON.parse(request.targets_json ?? "[]") as Target[];
  const executedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  // Mocked enforcement calls: Zscaler URL category update and Defender custom indicator creation.
  const results = targets.map((t) => {
    const isZscaler = t.system === "Zscaler";
    return {
      ...t,
      status: "submitted",
      submittedAt: executedAt,
      reference: isZscaler
        ? `zia-urlcat-BLOCK_THREAT_IOC-${Math.floor(Math.random() * 900000 + 100000)}`
        : `defender-ti-${crypto.randomUUID().slice(0, 8)}`,
      detail: isZscaler
        ? "Added to custom URL category BLOCK_THREAT_IOC; policy activation queued"
        : "Custom indicator created with action Block, generateAlert=true, expiry +90d",
      approver,
    };
  });

  db.query(`UPDATE block_requests SET executed_at = ?, results_json = ? WHERE hunt_id = ?`).run(
    executedAt,
    JSON.stringify(results),
    huntId,
  );

  console.log(JSON.stringify({ huntId, approver, executedAt, submitted: results.length, results }));
} finally {
  db.close();
}

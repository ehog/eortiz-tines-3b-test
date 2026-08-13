import { type Asset, audit, openWritable, seed } from "./db";
import { json, parseBody, parseRequest, requester } from "./http";
import { createIssue, toJira } from "./jira";

const raw = await Bun.stdin.text();
const req = parseRequest(raw);
if (!req) {
  console.error("Request access expects an HTTP request on stdin");
  process.exit(1);
}

function respond(status: number, payload: unknown): never {
  process.stdout.write(json(status, payload));
  process.exit(0);
}

if (req.method.toUpperCase() !== "POST") {
  respond(405, { error: "method_not_allowed", method: req.method });
}

const body = parseBody(req.body);
const assetId = String(body.assetId ?? body.asset_id ?? "").trim();
const justification = String(
  body.businessJustification ?? body.justification ?? "",
).trim();
const reporter = requester(
  req,
  String(body.requester ?? "unknown@example.com"),
);

if (!assetId) respond(400, { error: "assetId_required" });
if (justification.length < 10) {
  respond(400, { error: "business_justification_too_short", minLength: 10 });
}

const db = openWritable();
seed(db);

const asset = db
  .query<Asset, [string]>("SELECT * FROM assets WHERE id = ?")
  .get(assetId);
if (!asset) respond(404, { error: "asset_not_found", id: assetId });

if (asset.status === "allowed") {
  respond(409, {
    error: "asset_already_allowed",
    asset_id: asset.id,
    status: asset.status,
  });
}

if (asset.status === "pending_review" && asset.issue_key) {
  respond(200, {
    asset_id: asset.id,
    status: asset.status,
    issue_key: asset.issue_key,
    message: "A review request is already open for this asset.",
  });
}

const issue = createIssue(db, {
  assetId: asset.id,
  summary: `Approve use of ${asset.name} (${asset.id})`,
  description: [
    `Requester: ${reporter}`,
    `Asset: ${asset.name} (${asset.category}, vendor ${asset.vendor})`,
    `Onyx risk score: ${asset.risk_score}`,
    `Discovered by: ${asset.discovered_by}`,
    "",
    "Business justification:",
    justification,
    "",
    'Transition this issue to "Allow" to unblock the asset in Onyx, or "Deny" to keep it blocked.',
  ].join("\n"),
  reporter,
});

db.query(
  "UPDATE assets SET status = 'pending_review', issue_key = ?, justification = ?, updated_at = ? WHERE id = ?",
).run(issue.key, justification, issue.created_at, asset.id);

audit(db, reporter, "access.requested", asset.id, { issue_key: issue.key });
console.error(`${reporter} requested access to ${asset.id} -> ${issue.key}`);

respond(201, {
  asset_id: asset.id,
  asset_name: asset.name,
  status: "pending_review",
  issue: toJira(issue),
});

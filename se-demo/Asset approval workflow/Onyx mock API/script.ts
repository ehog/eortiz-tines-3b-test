import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  type Asset,
  audit,
  emit,
  nextAssetId,
  now,
  openWritable,
  seed,
} from "./db";
import { json, parseBody, parseRequest, requester } from "./http";

const raw = await Bun.stdin.text();
const req = parseRequest(raw);
if (!req) {
  console.error("Onyx mock API expects an HTTP request on stdin");
  process.exit(1);
}

const db = openWritable();
seed(db);

const segments = req.path.split("/").filter(Boolean);
const assetsIndex = segments.indexOf("assets");
const pathId = assetsIndex === -1 ? undefined : segments[assetsIndex + 1];
const assetId = req.query.get("id") ?? pathId;
const method = (req.query.get("_method") ?? req.method).toUpperCase();

function getAsset(id: string): Asset | null {
  return (
    db.query<Asset, [string]>("SELECT * FROM assets WHERE id = ?").get(id) ??
    null
  );
}

function respond(status: number, payload: unknown): never {
  process.stdout.write(json(status, payload));
  process.exit(0);
}

if (method === "GET" && !assetId) {
  const status = req.query.get("status");
  const assets = status
    ? db
        .query<Asset, [string]>(
          "SELECT * FROM assets WHERE status = ? ORDER BY risk_score DESC, id",
        )
        .all(status)
    : db
        .query<Asset, []>(
          "SELECT * FROM assets ORDER BY risk_score DESC, id",
        )
        .all();
  respond(200, { total: assets.length, assets });
}

if (method === "GET") {
  const asset = getAsset(assetId!);
  if (!asset) respond(404, { error: "asset_not_found", id: assetId });
  respond(200, asset);
}

if (method === "POST" && !assetId) {
  const body = parseBody(req.body);
  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "genai_app");
  if (!name) respond(400, { error: "name_required" });
  if (!ASSET_CATEGORIES.includes(category)) {
    respond(400, { error: "invalid_category", allowed: ASSET_CATEGORIES });
  }

  const at = now();
  const asset: Asset = {
    id: nextAssetId(db),
    name,
    category,
    vendor: String(body.vendor ?? "unknown"),
    risk_score: Number(body.risk_score ?? 50),
    discovered_by: String(body.discovered_by ?? "browser_agent"),
    first_seen_user: String(
      body.first_seen_user ?? requester(req, "unknown@example.com"),
    ),
    status: "blocked",
    issue_key: null,
    justification: null,
    approver: null,
    created_at: at,
    updated_at: at,
  };

  db.query(
    `INSERT INTO assets (id, name, category, vendor, risk_score, discovered_by, first_seen_user, status, created_at, updated_at)
     VALUES ($id, $name, $category, $vendor, $risk_score, $discovered_by, $first_seen_user, $status, $created_at, $updated_at)`,
  ).run({
    $id: asset.id,
    $name: asset.name,
    $category: asset.category,
    $vendor: asset.vendor,
    $risk_score: asset.risk_score,
    $discovered_by: asset.discovered_by,
    $first_seen_user: asset.first_seen_user,
    $status: asset.status,
    $created_at: asset.created_at,
    $updated_at: asset.updated_at,
  });

  audit(db, "onyx", "asset.created", asset.id, {
    status: asset.status,
    reason: "blocked_by_default",
  });
  emit(db, "asset.created", { asset });

  respond(201, asset);
}

if (method === "PATCH" || (method === "POST" && assetId)) {
  const asset = getAsset(assetId!);
  if (!asset) respond(404, { error: "asset_not_found", id: assetId });

  const body = parseBody(req.body);
  const status = body.status === undefined ? asset.status : String(body.status);
  if (!ASSET_STATUSES.includes(status)) {
    respond(400, { error: "invalid_status", allowed: ASSET_STATUSES });
  }

  const justification =
    body.justification === undefined
      ? asset.justification
      : String(body.justification);
  const approver =
    body.approver === undefined ? asset.approver : String(body.approver);
  const issueKey =
    body.issue_key === undefined ? asset.issue_key : String(body.issue_key);

  db.query(
    `UPDATE assets SET status = ?, justification = ?, approver = ?, issue_key = ?, updated_at = ? WHERE id = ?`,
  ).run(status, justification, approver, issueKey, now(), asset.id);

  if (status !== asset.status) {
    audit(db, approver ?? "onyx", "asset.status_changed", asset.id, {
      from: asset.status,
      to: status,
    });
  }

  respond(200, getAsset(asset.id));
}

respond(405, { error: "method_not_allowed", method });

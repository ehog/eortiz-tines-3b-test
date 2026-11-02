import { type Asset, audit, now, openWritable } from "./db";

type Decision = {
  issue_key: string;
  decision: "Allow" | "Deny";
  approver: string;
  source?: string;
};

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("no input");
  process.exit(0);
}

let decisions: Decision[] = [];
try {
  const parsed = JSON.parse(raw) as { decisions?: Decision[] };
  decisions = parsed.decisions ?? [];
} catch {
  console.error("input is not a decision payload; nothing to sync");
  process.exit(0);
}

if (decisions.length === 0) {
  console.error("no decisions to sync");
  process.exit(0);
}

const db = openWritable();
const results = [];

for (const decision of decisions) {
  const target = decision.decision === "Allow" ? "allowed" : "denied";
  const asset = db
    .query<Asset, [string]>("SELECT * FROM assets WHERE issue_key = ?")
    .get(decision.issue_key);

  if (!asset) {
    console.error(`no asset linked to ${decision.issue_key}`);
    results.push({ issue_key: decision.issue_key, result: "asset_not_found" });
    continue;
  }

  if (asset.status === target) {
    console.error(`${asset.id} already ${target}`);
    results.push({
      issue_key: decision.issue_key,
      asset_id: asset.id,
      result: "no_change",
      status: target,
    });
    continue;
  }

  db.query(
    "UPDATE assets SET status = ?, approver = ?, updated_at = ? WHERE id = ?",
  ).run(target, decision.approver, now(), asset.id);
  audit(db, decision.approver, "asset.status_synced", asset.id, {
    from: asset.status,
    to: target,
    issue_key: decision.issue_key,
    source: decision.source ?? "unknown",
  });
  console.error(`${asset.id}: ${asset.status} -> ${target}`);
  results.push({
    issue_key: decision.issue_key,
    asset_id: asset.id,
    result: "updated",
    status: target,
  });
}

console.log(JSON.stringify({ synced: results }, null, 2));

import { type Asset, audit, openWritable } from "./db";

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("no input");
  process.exit(0);
}

const { blocked } = JSON.parse(raw) as { blocked: Asset[] };
if (!Array.isArray(blocked) || blocked.length === 0) {
  console.error("nothing to notify");
  process.exit(0);
}

const db = openWritable();
const portal = "/asset-portal";

const notifications = blocked.map((asset) => {
  const message = [
    `Access to ${asset.name} was blocked by Onyx Security.`,
    `${asset.name} (${asset.category}, ${asset.vendor}) is a newly discovered AI asset with risk score ${asset.risk_score}.`,
    `New assets are blocked by default. If you need it for your work, request approval at ${portal} and an admin will review your request in Jira.`,
  ].join(" ");

  audit(db, "3b", "user.notified", asset.id, {
    recipient: asset.first_seen_user,
    channel: "asset portal",
  });
  console.error(`-> ${asset.first_seen_user}: ${message}`);

  return { asset_id: asset.id, recipient: asset.first_seen_user, message };
});

console.log(JSON.stringify({ notifications }, null, 2));

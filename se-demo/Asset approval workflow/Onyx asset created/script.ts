import { type Asset, audit, drainEvents, openWritable, seed } from "./db";
import { parseBody, parseRequest } from "./http";

const raw = await Bun.stdin.text();
const req = parseRequest(raw);

const db = openWritable();
seed(db);

type Payload = { asset: Asset };

let payloads: Payload[] = [];

if (req && req.method.toUpperCase() === "POST") {
  const body = parseBody(req.body);
  const asset = (body.asset ?? body) as Asset;
  if (!asset || !asset.id) {
    console.error("ignoring asset-created webhook without an asset id");
    process.exit(0);
  }
  payloads = [{ asset }];
} else {
  payloads = drainEvents(db, "asset.created") as Payload[];
}

if (payloads.length === 0) {
  console.error("no new asset-created events");
  process.exit(0);
}

const assets = payloads.map(({ asset }) => {
  const stored = db
    .query<Asset, [string]>("SELECT * FROM assets WHERE id = ?")
    .get(asset.id);
  const resolved = stored ?? asset;
  audit(db, "onyx", "asset.discovered", resolved.id, {
    name: resolved.name,
    category: resolved.category,
    status: resolved.status,
  });
  console.error(
    `discovered ${resolved.name} (${resolved.id}) - status ${resolved.status}`,
  );
  return resolved;
});

const blocked = assets.filter((asset) => asset.status === "blocked");
if (blocked.length === 0) {
  console.error("no blocked assets to notify about");
  process.exit(0);
}

console.log(JSON.stringify({ blocked }));

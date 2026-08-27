import { dir, readHttpRequest, respond, respondJson, sanitizeId } from "./lib";

const request = await readHttpRequest();
const id = request.query.get("id");
const indexParam = request.query.get("index");

if (!id || indexParam === null) {
  await respondJson(400, { error: "id and index query parameters are required" });
  process.exit(0);
}

let investigationId: string;
try {
  investigationId = sanitizeId(id);
} catch {
  await respondJson(400, { error: "invalid investigation id" });
  process.exit(0);
}

const index = Number(indexParam);
if (!Number.isInteger(index) || index < 0 || index > 999) {
  await respondJson(400, { error: "index must be an integer between 0 and 999" });
  process.exit(0);
}

const stem = `${dir(investigationId)}/screenshots/${String(index).padStart(3, "0")}`;
const candidates = [
  { path: `${stem}.svg`, contentType: "image/svg+xml" },
  { path: `${stem}.png`, contentType: "image/png" },
  { path: `${stem}.jpg`, contentType: "image/jpeg" },
];

for (const candidate of candidates) {
  const file = Bun.file(candidate.path);
  if (await file.exists()) {
    await respond(200, new Uint8Array(await file.arrayBuffer()), candidate.contentType);
    process.exit(0);
  }
}

await respondJson(404, { error: "screenshot not found", investigationId, index });

import { classify, openDb, readRequest, respond, type DemoMode } from "./lib";

const MODES: DemoMode[] = ["random", "hits", "clean", "error"];
const MAX_INDICATORS = 25;

const req = await readRequest();

if (req.method === "OPTIONS") {
  respond(200, "{}");
  process.exit(0);
}

if (req.method !== "POST") {
  respond(405, JSON.stringify({ error: "Use POST with { indicators, reason, demoMode }" }));
  process.exit(0);
}

let payload: { indicators?: unknown; reason?: unknown; demoMode?: unknown };
try {
  payload = JSON.parse(req.body || "{}");
} catch {
  respond(400, JSON.stringify({ error: "Request body must be JSON" }));
  process.exit(0);
}

const rawList = Array.isArray(payload.indicators)
  ? payload.indicators.map((v) => String(v))
  : String(payload.indicators ?? "").split(/[\r\n,]+/);

const seen = new Set<string>();
const accepted: { value: string; type: string }[] = [];
const rejected: string[] = [];

for (const raw of rawList) {
  const value = raw.trim();
  if (!value) continue;
  const key = value.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const type = classify(value);
  if (type) accepted.push({ value, type });
  else rejected.push(value);
}

const reason = String(payload.reason ?? "").trim();
const demoMode = (MODES as string[]).includes(String(payload.demoMode))
  ? (String(payload.demoMode) as DemoMode)
  : "random";

const problems: string[] = [];
if (accepted.length === 0) problems.push("Submit at least one valid indicator (IP, domain, URL, SHA1 or SHA256).");
if (rejected.length > 0) problems.push(`Unrecognized indicator format: ${rejected.join(", ")}`);
if (!reason) problems.push("A reason or reference is required (e.g. \"FBI advisory #AA24-109A\").");
if (accepted.length > MAX_INDICATORS) problems.push(`At most ${MAX_INDICATORS} indicators per hunt.`);

if (problems.length > 0) {
  respond(400, JSON.stringify({ error: problems.join(" "), rejected }));
  process.exit(0);
}

const huntId = `hunt_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const approvalToken = crypto.randomUUID().replace(/-/g, "");
const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const db = openDb("write");
try {
  db.transaction(() => {
    db.query(
      `INSERT INTO hunts (id, reason, demo_mode, created_at, status, approval_token)
       VALUES (?, ?, ?, ?, 'searching', ?)`,
    ).run(huntId, reason, demoMode, createdAt, approvalToken);
    const ins = db.query(`INSERT INTO indicators (hunt_id, value, type, position) VALUES (?, ?, ?, ?)`);
    accepted.forEach((ind, i) => ins.run(huntId, ind.value, ind.type, i));
  })();
} finally {
  db.close();
}

respond(
  200,
  JSON.stringify({
    huntId,
    reportPath: `/h/${huntId}`,
    reason,
    demoMode,
    createdAt,
    indicators: accepted,
  }),
);

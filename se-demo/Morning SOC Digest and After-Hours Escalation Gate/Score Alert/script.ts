import {
  decideAlert,
  getClockMode,
  getConfig,
  listAssets,
  openWritable,
  recordDecision,
  saveAlert,
  type Alert,
} from "./soclib";

const raw = await Bun.stdin.text();
const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

type Envelope = { intake?: string; scenario?: string; alert: Alert };

const envelopes: Envelope[] = [];
for (const line of lines) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    console.error(`Skipping non-JSON input line: ${line.slice(0, 120)}`);
    continue;
  }
  const obj = parsed as Envelope & Alert;
  if (obj && typeof obj === "object" && "alert" in obj && obj.alert) envelopes.push(obj as Envelope);
  else if (obj && typeof obj === "object" && "id" in obj && "severity" in obj) envelopes.push({ alert: obj as Alert });
}

if (envelopes.length === 0) {
  console.error("No alerts to score.");
  process.exit(1);
}

const db = openWritable();
const config = getConfig(db);
const assets = listAssets(db);
const clockMode = getClockMode(db);

const paged: unknown[] = [];
const summary: Array<{ id: string; decision: string; score: number }> = [];

for (const { alert, intake, scenario } of envelopes) {
  saveAlert(db, alert);
  const result = decideAlert(alert, config, assets, clockMode);
  recordDecision(db, alert, result);
  summary.push({ id: alert.id, decision: result.decision, score: result.score });
  if (result.decision === "page") {
    paged.push({ alert, result, config, intake: intake ?? "unknown", scenario: scenario ?? null });
  }
}

db.close();

console.error(
  `Scored ${envelopes.length} alert(s) [clock=${clockMode}]: ${summary
    .map((s) => `${s.id} → ${s.decision} (${s.score})`)
    .join("; ")}`,
);

// Only pages travel downstream; deferrals and suppressions stay in the volume for the morning digest.
for (const page of paged) {
  console.log(JSON.stringify(page));
}

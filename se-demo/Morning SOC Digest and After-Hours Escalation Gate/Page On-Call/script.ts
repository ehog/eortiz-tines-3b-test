import { getConfig, openWritable, pageOnCall, type Alert, type GateConfig, type GateResult } from "./soclib";

const raw = await Bun.stdin.text();
const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);

type Envelope = { alert: Alert; result: GateResult; config?: GateConfig };

const envelopes: Envelope[] = [];
for (const line of lines) {
  try {
    const parsed = JSON.parse(line) as Envelope;
    if (parsed?.alert && parsed?.result) envelopes.push(parsed);
  } catch {
    console.error(`Skipping non-JSON input line: ${line.slice(0, 120)}`);
  }
}

if (envelopes.length === 0) {
  console.error("Nothing to page: no scored alerts on stdin.");
  process.exit(1);
}

const db = openWritable();
const stored = getConfig(db);
const results: Array<Record<string, unknown>> = [];
let failures = 0;

for (const { alert, result, config } of envelopes) {
  const effective = config ?? stored;
  const { pageId, slack } = await pageOnCall(db, alert, result, effective);
  if (!slack.ok) failures += 1;
  results.push({ alertId: alert.id, pageId, score: result.score, slackOk: slack.ok, slackError: slack.error ?? null });
  console.error(
    `Page ${pageId} for ${alert.id} (score ${result.score}) → Slack ${slack.ok ? `ok ts=${slack.ts}` : `failed: ${slack.error}`}`,
  );
}

db.close();
console.log(JSON.stringify({ pages: results }));

if (failures > 0) {
  console.error(`${failures} of ${envelopes.length} Slack page notices failed to send.`);
  process.exit(1);
}

import { DEFAULT_CONFIG, mergeConfig, openReadonly, parseInput } from "./soclib";

type Body = { digestId?: number; channels?: string[]; force?: boolean };

const { body } = parseInput(await Bun.stdin.text());
const req = (body && typeof body === "object" ? body : {}) as Body;

const requested = Array.isArray(req.channels)
  ? req.channels.map((c) => String(c).toLowerCase()).filter((c) => c === "email" || c === "slack")
  : ["email", "slack"];

if (requested.length === 0) {
  console.error("No valid channels requested; expected \"email\" and/or \"slack\".");
  process.exit(1);
}

const db = openReadonly();
if (!db) {
  console.error("No digest has been generated yet: the shared state database does not exist.");
  process.exit(1);
}

const cfgRow = db.query<{ json: string }, []>("SELECT json FROM config WHERE id = 1").get();
const config = cfgRow ? mergeConfig(JSON.parse(cfgRow.json)) : structuredClone(DEFAULT_CONFIG);

type Row = { id: number; markdown: string; html: string; slack_text: string; json: string };
const row = req.digestId
  ? db.query<Row, [number]>("SELECT id, markdown, html, slack_text, json FROM digests WHERE id = ?").get(Number(req.digestId))
  : db.query<Row, []>("SELECT id, markdown, html, slack_text, json FROM digests ORDER BY id DESC LIMIT 1").get();
db.close();

if (!row) {
  console.error(req.digestId ? `Digest #${req.digestId} not found.` : "No digest has been generated yet.");
  process.exit(1);
}

const meta = JSON.parse(row.json) as { subject?: string; stats?: Record<string, number> };

console.error(`Sending digest #${row.id} to ${requested.join(" and ")} (force=${req.force !== false}).`);
console.log(
  JSON.stringify({
    digestId: row.id,
    subject: meta.subject ?? `Morning SOC digest #${row.id}`,
    markdown: row.markdown,
    html: row.html,
    slackText: row.slack_text,
    delivery: config.delivery,
    stats: meta.stats ?? {},
    channels: requested,
    force: req.force !== false,
    trigger: "manual_send",
  }),
);

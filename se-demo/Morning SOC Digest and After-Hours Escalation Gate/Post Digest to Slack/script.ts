import { logEvent, openWritable, postSlack, truncate } from "./soclib";

type DigestPayload = {
  digestId: number;
  subject: string;
  slackText: string;
  delivery: { slackChannel: string };
  stats: Record<string, number>;
};

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("No digest payload on stdin.");
  process.exit(1);
}
const digest = JSON.parse(raw) as DigestPayload;
const channel = digest.delivery.slackChannel;

// Slack section blocks cap at 3000 characters, so the digest is chunked on blank lines.
const chunks: string[] = [];
let current = "";
for (const paragraph of digest.slackText.split("\n\n")) {
  if ((current + paragraph).length > 2800) {
    if (current) chunks.push(current.trimEnd());
    current = `${paragraph}\n\n`;
  } else {
    current += `${paragraph}\n\n`;
  }
}
if (current.trim()) chunks.push(current.trimEnd());

const blocks = [
  { type: "header", text: { type: "plain_text", text: truncate(digest.subject, 150) } },
  ...chunks.map((text) => ({ type: "section", text: { type: "mrkdwn", text } })),
  {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Digest #${digest.digestId} · ${digest.stats.duplicatesRemoved ?? 0} duplicates removed · ${digest.stats.multiSourceEntities ?? 0} multi-source correlations · ${digest.stats.pagedOvernight ?? 0} paged overnight`,
      },
    ],
  },
];

const result = await postSlack(channel, truncate(digest.subject, 200), blocks);

const db = openWritable();
const status = result.ok ? `sent ts=${result.ts}` : `failed: ${result.error}`;
db.query("UPDATE digests SET slack_status = ? WHERE id = ?").run(status, digest.digestId);
logEvent(db, new Date().toISOString(), "digest:slack", `Digest #${digest.digestId} to ${channel}: ${result.ok ? "sent" : "failed"}`, {
  digestId: digest.digestId,
  status,
});
db.close();

if (!result.ok) {
  console.error(`Slack post failed: ${result.error}`);
  process.exit(1);
}

console.error(`Digest #${digest.digestId} posted to ${channel} (ts ${result.ts}).`);
console.log(JSON.stringify({ digestId: digest.digestId, channel, ts: result.ts }));

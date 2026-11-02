import { openDb, readUpstreamJson } from "./lib";

const SLACK_CHANNEL = "#eortiz";
const PUBLIC_HOST = "https://eortiz-space.se-demo.3b.run";

type Report = {
  huntId: string;
  reason: string;
  anyFound: boolean;
  matchedCount: number;
  indicatorCount: number;
  totalEvents: number;
  incompleteSources: { label: string; reason: string | null }[];
  indicators: {
    value: string;
    type: string;
    found: boolean;
    totalFrequency: number;
    matchedSources: string[];
    firstSeen: string | null;
    lastSeen: string | null;
  }[];
};

const report = await readUpstreamJson<Report>();

if (!report.anyFound) {
  // Nothing matched, so there is nothing to block and no approval to request.
  process.exit(0);
}

const branchPrefix = process.env._3B_BRANCH_ID ? `/__3b/branch/${process.env._3B_BRANCH_ID}` : "";
const base = `${PUBLIC_HOST}${branchPrefix}`;

const db = openDb("write");
const hunt = db
  .query<{ approval_token: string }, [string]>(`SELECT approval_token FROM hunts WHERE id = ?`)
  .get(report.huntId);
if (!hunt) throw new Error(`Unknown hunt ${report.huntId}`);

const found = report.indicators.filter((i) => i.found);
const targets = found.flatMap((i) => {
  const list: { indicator: string; type: string; system: string; action: string }[] = [];
  if (i.type === "sha1" || i.type === "sha256") {
    list.push({ indicator: i.value, type: i.type, system: "Microsoft Defender", action: "Create custom indicator (FileHash) — Block and remediate" });
  } else {
    list.push({ indicator: i.value, type: i.type, system: "Zscaler", action: `Add to URL category BLOCK_THREAT_IOC (${i.type})` });
    list.push({ indicator: i.value, type: i.type, system: "Microsoft Defender", action: `Create custom indicator (${i.type === "ipv4" || i.type === "ipv6" ? "IpAddress" : i.type === "url" ? "Url" : "DomainName"}) — Block` });
  }
  return list;
});

const decisionUrl = (decision: "approve" | "deny") =>
  `${base}/ioc/api/block-decision?hunt=${encodeURIComponent(report.huntId)}&token=${hunt.approval_token}&decision=${decision}`;
const reportUrl = `${base}/ioc/h/${report.huntId}`;

const lines = [
  `*IOC hunt ${report.huntId} — ${report.matchedCount} of ${report.indicatorCount} indicators FOUND*`,
  `Reason / reference: ${report.reason}`,
  `Total matching events: ${report.totalEvents}`,
  report.incompleteSources.length > 0
    ? `:warning: Incomplete sources: ${report.incompleteSources.map((s) => `${s.label} (${s.reason})`).join("; ")}`
    : "All four sources completed.",
  "",
  "*Matched indicators*",
  ...found.map(
    (i) => `• \`${i.value}\` (${i.type}) — ${i.matchedSources.join(", ")} · ${i.totalFrequency} events · first ${i.firstSeen ?? "?"} · last ${i.lastSeen ?? "?"}`,
  ),
  "",
  "*Requested block actions*",
  ...targets.map((t) => `• ${t.system}: ${t.action} → \`${t.indicator}\``),
  "",
  `<${reportUrl}|Open full report>`,
];
const text = lines.join("\n");

const payload = {
  channel: SLACK_CHANNEL,
  text: `IOC hunt ${report.huntId}: ${report.matchedCount} indicator(s) found — block request needs approval`,
  blocks: [
    { type: "section", text: { type: "mrkdwn", text } },
    {
      type: "actions",
      elements: [
        { type: "button", style: "danger", text: { type: "plain_text", text: "Approve block request" }, url: decisionUrl("approve") },
        { type: "button", text: { type: "plain_text", text: "Deny" }, url: decisionUrl("deny") },
        { type: "button", text: { type: "plain_text", text: "Open report" }, url: reportUrl },
      ],
    },
  ],
};

const requestedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
let slackTs: string | null = null;
let slackError: string | null = null;

try {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { ok?: boolean; ts?: string; error?: string };
  if (!res.ok || !body.ok) slackError = `Slack chat.postMessage failed: ${body.error ?? res.status}`;
  else slackTs = body.ts ?? null;
} catch (err) {
  slackError = `Slack chat.postMessage failed: ${err instanceof Error ? err.message : String(err)}`;
}

try {
  db.query(
    `INSERT OR REPLACE INTO block_requests
       (hunt_id, requested_at, slack_channel, slack_message, slack_ts, slack_error, targets_json, decision)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
  ).run(report.huntId, requestedAt, SLACK_CHANNEL, text, slackTs, slackError, JSON.stringify(targets));
} finally {
  db.close();
}

// A failed Slack post must not lose the pending approval, so it is surfaced on the report instead of failing the step.
if (slackError) console.error(slackError);

console.log(JSON.stringify({ huntId: report.huntId, channel: SLACK_CHANNEL, slackTs, slackError, targets }));

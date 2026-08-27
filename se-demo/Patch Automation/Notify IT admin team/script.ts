const CHANNEL = "eortiz";
const HOST = "https://eortiz-tines-io.se-demo.3b.run";

type Item = {
  device_id: number;
  device_name: string;
  package_id: string;
  package_name: string;
  severity: string;
};

const input = JSON.parse(await Bun.stdin.text()) as { organization_id: string; items: Item[] };

const branch = process.env._3B_BRANCH_ID;
const base = `${HOST}${branch ? `/__3b/branch/${branch}` : ""}/patch-decision`;

function decisionUrl(item: Item, decision: "YES" | "NO") {
  const q = new URLSearchParams({
    decision,
    device_id: String(item.device_id),
    device_name: item.device_name,
    package_id: item.package_id,
    package_name: item.package_name,
    severity: item.severity,
  });
  return `${base}?${q}`;
}

const sent: any[] = [];
for (const item of input.items) {
  const blocks = [
    { type: "header", text: { type: "plain_text", text: "🔔 Security Patch Alert", emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "*⚠️ Vulnerability Detected*\n\nA device requires a critical security update to address known CVEs.",
      },
    },
    { type: "divider" },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*🖥️ Device:*\n\`${item.device_name}\` (${item.device_id})` },
        { type: "mrkdwn", text: `*📦 Package ID:*\n\`${item.package_id}\`` },
        { type: "mrkdwn", text: `*📝 Package Name:*\n${item.package_name}` },
        { type: "mrkdwn", text: `*🔐 Severity:*\n:warning: ${item.severity}` },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "💡 *Recommendation:* Apply this patch as soon as possible to maintain security compliance.",
        },
      ],
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Would you like to patch this device now?*\n\nClick a button below to proceed:" },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", emoji: true, text: "✅ Patch Now" },
          style: "primary",
          url: decisionUrl(item, "YES"),
        },
        {
          type: "button",
          text: { type: "plain_text", emoji: true, text: "⏸️ Postpone" },
          style: "danger",
          url: decisionUrl(item, "NO"),
        },
      ],
    },
  ];

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      channel: CHANNEL,
      text: `Security patch alert: ${item.package_name} on ${item.device_name}`,
      blocks,
    }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack chat.postMessage failed: ${JSON.stringify(body)}`);
  sent.push({ ...item, channel: body.channel, ts: body.ts });
}

console.log(JSON.stringify({ organization_id: input.organization_id, alerts: sent }));

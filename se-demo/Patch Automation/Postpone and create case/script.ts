const TEAM_ID = 132137;
const CHANNEL = "eortiz";
const MODEL = "claude-sonnet-4-5";

type Decision = {
  decision: "YES" | "NO";
  device_id: string;
  device_name: string;
  package_id: string;
  package_name: string;
  severity: string;
  decided_by: string;
  decided_at: string;
};

const raw = (await Bun.stdin.text()).trim();
const decision = JSON.parse(raw.split("\n").at(-1) ?? "{}") as Decision;

if (decision.decision !== "NO") process.exit(0);

const facts = `Device name: ${decision.device_name}
Device ID: ${decision.device_id}
Package name: ${decision.package_name}
Package ID: ${decision.package_id}
Severity: ${decision.severity}
Decision: patching postponed by the admin
Decided by: ${decision.decided_by}
Decided at: ${decision.decided_at}`;

const prompt = `An IT admin was sent a Slack alert about patching a server and chose to POSTPONE immediate patching. Write the markdown description for a Tines case tracking this deferred patch.

Facts (use only these, invent nothing):
${facts}

Requirements:
- Be verbose and visually appealing, using markdown headings, a details table, and bullet lists.
- Include a clear section stating the admin explicitly chose to postpone immediate patching, and the risk of leaving a known-CVE package unpatched.
- Include suggested next steps for the IT team.
- Output the markdown only, with no preamble.`;

const modelRes = await fetch(`${process.env.ANTHROPIC_BASE_URL}/messages`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": "placeholder",
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify({
    model: MODEL,
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  }),
});
const modelBody = await modelRes.json();
if (!modelRes.ok) throw new Error(`Anthropic request failed: ${modelRes.status} ${JSON.stringify(modelBody)}`);
const description: string = modelBody.content.map((b: any) => b.text ?? "").join("").trim();

const caseRes = await fetch(`${process.env.TINES_URL}/api/v2/cases`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    team_id: TEAM_ID,
    name: `Postponed patch: ${decision.package_name} on ${decision.device_name}`,
    priority: "high",
    status: "open",
    description,
    metadata: {
      device_id: decision.device_id,
      package_id: decision.package_id,
      severity: decision.severity,
      decided_by: decision.decided_by,
      decided_at: decision.decided_at,
      source: "Automox patch management (3B)",
    },
  }),
});
const caseBody = await caseRes.json();
if (!caseRes.ok) throw new Error(`Tines case create failed: ${caseRes.status} ${JSON.stringify(caseBody)}`);

const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    channel: CHANNEL,
    text: `Case ${caseBody.case_id} created for postponed patch ${decision.package_name}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "📋 Patch Postponed — Case Created", emoji: true } },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${decision.decided_by}* chose to postpone patching. A case has been opened to track remediation.`,
        },
      },
      { type: "divider" },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*🖥️ Device:*\n\`${decision.device_name}\`` },
          { type: "mrkdwn", text: `*📦 Package:*\n${decision.package_name}` },
          { type: "mrkdwn", text: `*🔐 Severity:*\n${decision.severity}` },
          { type: "mrkdwn", text: `*📁 Case:*\n#${caseBody.case_id} (${caseBody.priority ?? "HIGH"})` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", emoji: true, text: "🔍 Open case in Tines" },
            style: "primary",
            url: caseBody.url,
          },
        ],
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "⚠️ This device remains exposed until the patch is applied." }],
      },
    ],
  }),
});
const slackBody = await slackRes.json();
if (!slackBody.ok) throw new Error(`Slack chat.postMessage failed: ${JSON.stringify(slackBody)}`);

console.log(JSON.stringify({ ...decision, case_id: caseBody.case_id, case_url: caseBody.url }));

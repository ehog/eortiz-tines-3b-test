// Turns a Microsoft Defender alert (stdin, JSON) into a Tines case and returns
// the created case as the HTTP response.

const TEAM_ID = 132137; // Tines team "3B cases"
const base = process.env.TINES_URL;
if (!base) {
  console.error(JSON.stringify({ event: "missing_tines_url" }));
  process.exit(1);
}

function respond(status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  process.stdout.write(
    `HTTP/1.1 ${status} ${status < 400 ? "OK" : "Error"}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

const input = (await Bun.stdin.text()).trim();
let alert: any;
try {
  alert = JSON.parse(input);
} catch {
  console.error(JSON.stringify({ event: "invalid_alert_json" }));
  process.exit(1);
}

const severityToPriority: Record<string, string> = {
  high: "high",
  medium: "medium",
  low: "low",
  informational: "info",
};
const priority = severityToPriority[String(alert.severity ?? "").toLowerCase()] ?? "medium";

const evidence: any[] = Array.isArray(alert.evidence) ? alert.evidence : [];
const device = evidence.find((e) => String(e["@odata.type"]).endsWith("deviceEvidence"));
const user = evidence.find((e) => String(e["@odata.type"]).endsWith("userEvidence"));
const proc = evidence.find((e) => String(e["@odata.type"]).endsWith("processEvidence"));

const hostname = device?.deviceDnsName ?? "unknown";
const upn = user?.userAccount?.userPrincipalName ?? user?.userAccount?.accountName ?? "unknown";
const mitre: string[] = Array.isArray(alert.mitreTechniques) ? alert.mitreTechniques : [];

const lines = [
  `**${alert.title ?? "Microsoft Defender alert"}**`,
  "",
  alert.description ?? "",
  "",
  `- **Severity:** ${alert.severity ?? "unknown"}`,
  `- **Category:** ${alert.category ?? "unknown"}`,
  `- **Device:** ${hostname}`,
  `- **User:** ${upn}`,
  proc ? `- **Process:** \`${proc.imageFile?.fileName ?? ""}\` — \`${proc.processCommandLine ?? ""}\`` : "",
  proc?.imageFile?.sha256 ? `- **SHA256:** \`${proc.imageFile.sha256}\`` : "",
  mitre.length ? `- **MITRE ATT&CK:** ${mitre.join(", ")}` : "",
  `- **First activity:** ${alert.firstActivityDateTime ?? "unknown"}`,
  alert.alertWebUrl ? `- **Defender alert:** ${alert.alertWebUrl}` : "",
  alert.synthetic ? "\n_This case was created from a synthetic test alert._" : "",
].filter((l) => l !== "");

const tags = ["microsoft-defender", alert.category, ...mitre, alert.synthetic ? "synthetic" : null]
  .filter(Boolean)
  .map((t) => String(t).toLowerCase());

const payload = {
  team_id: TEAM_ID,
  name: `[Defender] ${alert.title ?? "Alert"} on ${hostname}`.slice(0, 250),
  description: lines.join("\n"),
  priority,
  status: "open",
  tag_names: tags,
  opened_at: alert.createdDateTime ?? new Date().toISOString(),
  metadata: {
    defender_alert_id: String(alert.id ?? ""),
    defender_incident_id: String(alert.incidentId ?? ""),
    severity: String(alert.severity ?? ""),
    device: hostname,
    user: upn,
    source: String(alert.serviceSource ?? "microsoftDefender"),
  },
  tasks: [
    { description: "Review the alert and process tree in Microsoft Defender" },
    { description: `Validate activity with ${upn}` },
    { description: `Decide whether to isolate ${hostname}` },
  ],
  blocks: [
    ...(alert.recommendedActions
      ? [
          {
            title: "Recommended actions",
            block_type: "note",
            elements: [{ content: String(alert.recommendedActions), note_type: "text", color: "gold" }],
          },
        ]
      : []),
    {
      title: "Raw Defender alert",
      block_type: "file",
      elements: [
        {
          filename: `defender-alert-${alert.id ?? "unknown"}.json`,
          file_contents: Buffer.from(JSON.stringify(alert, null, 2)).toString("base64"),
        },
      ],
    },
  ],
};

const res = await fetch(`${base}/api/v2/cases`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(payload),
});
const text = await res.text();

if (!res.ok) {
  console.error(JSON.stringify({ event: "case_create_failed", status: res.status, body: text.slice(0, 2000) }));
  process.exit(1);
}

const created = JSON.parse(text);
console.error(JSON.stringify({ event: "case_created", case_id: created.case_id, alert_id: alert.id }));
respond(201, {
  case_id: created.case_id,
  name: created.name,
  priority: created.priority,
  url: created.url,
  defender_alert_id: alert.id,
  synthetic: Boolean(alert.synthetic),
});

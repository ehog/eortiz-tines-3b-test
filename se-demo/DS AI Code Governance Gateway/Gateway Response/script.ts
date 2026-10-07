const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("event=response.failed reason=no_input");
  process.exit(1);
}
const s = JSON.parse(raw);

const body = {
  submission_id: s.submission_id,
  status: s.status,
  disposition_reason: s.disposition_reason ?? s.reviewer_comment ?? null,
  risk_score: s.scan?.risk_score ?? null,
  scan_verdict: s.scan?.scan_verdict ?? null,
  findings: (s.scan?.findings ?? []).map((f: any) => ({ rule_id: f.rule_id, severity: f.severity, title: f.title, line: f.line })),
  model_policy: s.model_policy ?? null,
  bypass: s.bypass ?? null,
  credentials_referenced: (s.credentials?.references ?? []).map((c: any) => ({ name: c.name, scope: c.scope })),
  deployment: s.deployment ?? null,
  reviewer: s.reviewer ?? null,
  notification_channel: s.notification?.slack?.channel ?? null,
};

const code = s.status === "blocked" ? 403 : s.status === "deployed" ? 200 : 202;
const reason = code === 403 ? "Forbidden" : code === 200 ? "OK" : "Accepted";
const json = JSON.stringify(body, null, 2);

console.error(`event=gateway.responded submission=${s.submission_id} http_status=${code} status=${s.status}`);

process.stdout.write(
  `HTTP/1.1 ${code} ${reason}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`,
);

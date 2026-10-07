const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("event=notify.failed reason=no_input");
  process.exit(1);
}
const s = JSON.parse(raw);

const bypass = s.bypass?.bypass_attempt === true;
const deployed = Boolean(s.deployment);
const channel = bypass ? "#sec-ai-governance-alerts" : deployed ? "#ai-deployments" : "#ai-governance-review";
const recipients = bypass
  ? ["ciso-office@dentsplysirona.com", "appsec@dentsplysirona.com", s.developer_email]
  : [s.developer_email, "ai-governance@dentsplysirona.com"];

const emoji = bypass ? ":rotating_light:" : deployed ? ":white_check_mark:" : s.status === "blocked" ? ":no_entry:" : ":hourglass_flowing_sand:";
const headline = bypass
  ? `BLOCKED — ungoverned deployment attempt (${s.submission_id})`
  : deployed
    ? `Deployed to production — ${s.submission_id}`
    : s.status === "blocked"
      ? `Blocked by policy scan — ${s.submission_id}`
      : `Awaiting human approval — ${s.submission_id}`;

const lines = [
  `${emoji}  *${headline}*`,
  "",
  `*Developer:* ${s.developer_name} (${s.developer_email || "n/a"})`,
  `*Team / Region:* ${s.team} / ${s.region}`,
  `*Source tool / Model:* ${s.source_tool} / ${s.model_used}`,
  `*Artifact:* ${s.repo}@${s.commit_sha} (${s.branch})`,
  `*Risk score:* ${s.scan?.risk_score ?? "n/a"} (${s.scan?.scan_verdict ?? "n/a"})`,
  `*Model policy:* ${s.model_policy?.compliant ? `compliant (${s.model_policy?.rule_id})` : `VIOLATION — ${s.model_policy?.rule_fired}`}`,
  `*Policies fired:* ${(s.policies_fired ?? []).join(", ") || "none"}`,
];
if (bypass) {
  lines.push("", "*Why this was blocked:*", ...s.bypass.reasons.map((r: any) => `• [${r.rule_id}] ${r.message}`));
}
if (deployed) {
  lines.push("", `*Deployment:* ${s.deployment.deployment_id} → ${s.deployment.namespace}`);
}
if (s.reviewer) lines.push("", `*Reviewer:* ${s.reviewer}`);
if (s.reviewer_comment) lines.push(`*Comment:* ${s.reviewer_comment}`);

const preview = {
  delivery: "SIMULATED — no message left this workflow",
  slack: { channel, text: lines.join("\n") },
  email: {
    to: recipients.filter(Boolean),
    from: "ai-governance@dentsplysirona.com",
    subject: `[AI Governance] ${headline}`,
    body: lines.join("\n").replace(/\*/g, ""),
  },
};

console.error(
  `event=notify.rendered submission=${s.submission_id} channel=${channel} recipients=${preview.email.to.length} kind=${bypass ? "bypass_alert" : deployed ? "deployment" : s.status} delivery=simulated`,
);
console.error(preview.slack.text.split("\n").map((l: string) => `  | ${l}`).join("\n"));

process.stdout.write(JSON.stringify({ ...s, notification: preview }));

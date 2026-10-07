const TEAMS = ["R&D-Endodontics", "Digital Dentistry", "IT-Ops", "Clinical Data"];
const REGIONS = ["US", "DE", "JP"];
const TOOLS = ["claude-code", "github-copilot", "3b-native"];
const MODELS = ["claude-sonnet-4-5", "gpt-4o", "gemini-2.5-pro", "azure-foundry-claude"];

const raw = await Bun.stdin.text();
const sep = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
const headerBlock = raw.slice(0, raw.indexOf(sep) === -1 ? raw.length : raw.indexOf(sep));
const body = raw.indexOf(sep) === -1 ? "" : raw.slice(raw.indexOf(sep) + sep.length);
const requestLine = headerBlock.split(/\r?\n/)[0] ?? "";

let payload: Record<string, any>;
try {
  payload = JSON.parse(body.trim() || "{}");
} catch {
  console.error(`event=intake.rejected reason=invalid_json request="${requestLine}"`);
  process.stdout.write(
    "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n" +
      JSON.stringify({ error: "body must be JSON" }),
  );
  process.exit(1);
}

const missing = ["developer_name", "team", "region", "source_tool", "model_used", "repo", "code_payload"]
  .filter((k) => !payload[k]);
if (missing.length) {
  console.error(`event=intake.rejected reason=missing_fields fields=${missing.join(",")}`);
  process.stdout.write(
    "HTTP/1.1 422 Unprocessable Entity\r\nContent-Type: application/json\r\n\r\n" +
      JSON.stringify({ error: "missing required fields", missing }),
  );
  process.exit(1);
}

const enumErrors: string[] = [];
if (!TEAMS.includes(payload.team)) enumErrors.push(`team must be one of ${TEAMS.join("|")}`);
if (!REGIONS.includes(payload.region)) enumErrors.push(`region must be one of ${REGIONS.join("|")}`);
if (!TOOLS.includes(payload.source_tool)) enumErrors.push(`source_tool must be one of ${TOOLS.join("|")}`);
if (!MODELS.includes(payload.model_used)) enumErrors.push(`model_used must be one of ${MODELS.join("|")}`);
if (enumErrors.length) {
  console.error(`event=intake.rejected reason=invalid_enum detail="${enumErrors.join("; ")}"`);
  process.stdout.write(
    "HTTP/1.1 422 Unprocessable Entity\r\nContent-Type: application/json\r\n\r\n" +
      JSON.stringify({ error: "invalid field values", details: enumErrors }),
  );
  process.exit(1);
}

const now = new Date();
const submission = {
  submission_id: String(payload.submission_id ?? `SUB-${now.toISOString().slice(0, 10).replaceAll("-", "")}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`),
  received_at: now.toISOString(),
  developer_name: String(payload.developer_name),
  developer_email: String(payload.developer_email ?? ""),
  team: String(payload.team),
  region: String(payload.region),
  source_tool: String(payload.source_tool),
  model_used: String(payload.model_used),
  repo: String(payload.repo),
  branch: String(payload.branch ?? "main"),
  commit_sha: String(payload.commit_sha ?? "0000000"),
  description: String(payload.description ?? ""),
  code_payload: String(payload.code_payload),
  runner: String(payload.runner ?? "sanctioned-github-actions"),
  pipeline: String(payload.pipeline ?? "ds-github-actions-prod"),
};

console.error(
  `event=intake.accepted submission=${submission.submission_id} developer="${submission.developer_name}" team="${submission.team}" region=${submission.region} tool=${submission.source_tool} model=${submission.model_used} repo=${submission.repo}@${submission.branch} commit=${submission.commit_sha}`,
);

process.stdout.write(JSON.stringify(submission));

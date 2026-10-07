export const SANCTIONED_REPOS = [
  "dentsplysirona/endo-automation",
  "dentsplysirona/digital-dentistry-agents",
  "dentsplysirona/itops-runbooks",
  "dentsplysirona/clinical-data-platform",
  "dentsplysirona/governance-shared-libs",
];

export const SANCTIONED_PIPELINES = [
  "ds-github-actions-prod",
  "ds-azure-devops-prod",
  "ds-3b-native-deploy",
];

export const SANCTIONED_RUNNERS = [
  "sanctioned-github-actions",
  "ds-azure-hosted-runner",
  "3b-managed-runner",
];

export type BypassResult = {
  bypass_attempt: boolean;
  reasons: { rule_id: string; message: string }[];
  repo_sanctioned: boolean;
  pipeline_sanctioned: boolean;
  runner_sanctioned: boolean;
};

export function detectBypass(s: { repo: string; pipeline?: string; runner?: string }): BypassResult {
  const repo = (s.repo ?? "").toLowerCase();
  const pipeline = s.pipeline ?? "";
  const runner = s.runner ?? "";
  const repo_sanctioned = SANCTIONED_REPOS.includes(repo);
  const pipeline_sanctioned = SANCTIONED_PIPELINES.includes(pipeline);
  const runner_sanctioned = SANCTIONED_RUNNERS.includes(runner);
  const reasons: BypassResult["reasons"] = [];

  if (!repo_sanctioned) {
    reasons.push({ rule_id: "BYP-001", message: `Repository "${s.repo}" is not in the sanctioned repository inventory.` });
  }
  if (!pipeline_sanctioned) {
    reasons.push({ rule_id: "BYP-002", message: `Pipeline "${pipeline || "(none declared)"}" is not a sanctioned CI/CD pipeline.` });
  }
  if (!runner_sanctioned) {
    reasons.push({ rule_id: "BYP-003", message: `Build runner "${runner || "(none declared)"}" is unsanctioned — self-hosted or unregistered runners cannot promote to production.` });
  }

  return {
    bypass_attempt: reasons.length > 0,
    reasons,
    repo_sanctioned,
    pipeline_sanctioned,
    runner_sanctioned,
  };
}

if (import.meta.main) {
  const raw = await Bun.stdin.text();
  if (!raw.trim()) {
    console.error("event=bypass.failed reason=no_input");
    process.exit(1);
  }
  const submission = JSON.parse(raw);
  const bypass = detectBypass(submission);
  console.error(
    `event=bypass.check submission=${submission.submission_id} repo=${submission.repo} pipeline=${submission.pipeline} runner=${submission.runner} bypass_attempt=${bypass.bypass_attempt} rules=${bypass.reasons.map((r) => r.rule_id).join(",") || "none"}`,
  );
  if (bypass.bypass_attempt) {
    console.error(
      `event=security.alert submission=${submission.submission_id} severity=critical kind=ungoverned_origin detail="${bypass.reasons.map((r) => r.message).join(" ")}"`,
    );
  }
  process.stdout.write(JSON.stringify({ ...submission, bypass }));
}

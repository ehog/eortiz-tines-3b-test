import { evaluateModelPolicy, POLICY_VERSION } from "./model-policy";

const raw = await Bun.stdin.text();
if (!raw.trim()) {
  console.error("event=model_policy.failed reason=no_input");
  process.exit(1);
}
const submission = JSON.parse(raw);
const result = evaluateModelPolicy(submission.team, submission.region, submission.model_used);

console.error(
  `event=model_policy.check submission=${submission.submission_id} team="${submission.team}" region=${submission.region} model=${submission.model_used} policy_version=${POLICY_VERSION} rule=${result.rule_id} compliant=${result.compliant} allowed="${result.allowed_models.join(",")}"${result.rule_fired ? ` rule_fired="${result.rule_fired}"` : ""}`,
);

process.stdout.write(JSON.stringify({ ...submission, model_policy: result }));

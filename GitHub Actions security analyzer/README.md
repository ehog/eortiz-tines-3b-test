GHAWA turns GitHub push events into evidence-backed GitHub Actions security reviews, skipping unrelated application changes. This draft defaults to **fixture mode**: no external requests, model calls, GitHub writes, or Slack messages. Repository scripts are never executed.

## Try the demo

Open **GHAWA · Workflow security** from this workflow's Links page (`/ghawa`; space members only). Select one of four clearly labeled synthetic events, inspect **Findings**, **Before / after**, **Coverage & questions**, and **Output previews**, then choose **Run synthetic push** to exercise the persisted workflow. Repeating the same scenario returns the same review and suppresses downstream work.

| Synthetic event | Expected result |
| --- | --- |
| Application change | Skipped: only `src/search.ts` changes |
| Safe workflow change | No deterministic findings; pinned checkout and read-only permissions |
| Unsafe PR handling | High `write-all` and critical privileged PR-code checkout/execution |
| Secret transfer | Critical potential secret-transfer path to the reserved `.invalid` destination |

The fixture agent result is explicitly simulated, not a model-generated investigation. Preview reports are calculated on demand from fixture YAML; stored reviews are created only by running a synthetic push. Export downloads a readable Markdown report. A lack of findings does not certify safety.

## Flow

1. [Receive GitHub push](<Receive GitHub push/script.ts>) verifies the HMAC-SHA256 signature over raw body bytes, checks the repository allowlist, and returns `202` with a stable review ID and status URL. The synthetic route is separate and space-authenticated.
2. [Reserve review](<Reserve review/script.ts>) transactionally deduplicates delivery IDs and `mode/repository/ref/before/after` identities in SQLite. Conflicting delivery reuse fails. Duplicate deliveries emit no downstream data.
3. [Collect evidence](<Collect evidence/script.ts>) fetches the authoritative compare endpoint, paginates commits, and independently inventories `.github/workflows` at both exact SHAs. Workflow blob hashes select actual endpoint changes; full blob contents reconstruct the diff rather than trusting webhook file lists or abbreviated patches.
4. [Check workflow security](<Check workflow security/rules.ts>) parses YAML 1.2 with duplicate-key detection and bounded alias expansion. Rules cover broad token permissions, unsafe PR handling, expression injection, secret transfer/logging, artifact-upload paths, mutable action/image references, self-hosted runner exposure, environment-binding changes, download-and-execute, and obfuscation.
5. [Inspect context (AI Agent)](<Inspect context (AI Agent)/system.md>) is a headless self-looping agent, one model request per invocation. Its sole tool reads referenced files as inert text. No shell, execution, arbitrary URL fetch, write, or merge tool exists.
6. [Finalize report](<Finalize report/script.ts>) validates agent evidence against inspected text, merges findings without removing deterministic observations, stores the report, and appends an audit decision. Agent-only introduction claims remain `unknown` rather than assuming newly introduced behavior.
7. **Reserve outputs → Deliver outputs → Record outputs** separates committed output reservation from external side effects and receipts. Normal repeated deliveries never re-enter this path.

## Inputs and outputs

- `POST /ghawa/push`: GitHub JSON push payload plus `X-Hub-Signature-256`, `X-GitHub-Delivery`, and `X-GitHub-Event: push`. Maximum request size approximately 1.1 MB. Live mode only.
- `POST /ghawa/demo`: `{ "scenario": "unrelated|safe|unsafe-pr|exfiltration" }`. Space-authenticated; always synthetic.
- `GET /ghawa/reports`: recent review summaries and configuration flags. `?id=<reviewId>` returns pending/completed report and delivery receipts. `?fixture=<scenario>` calculates an unstored preview. Space-authenticated.
- Structured findings include rule/category, severity, file/line range, source evidence, rationale, exploit preconditions, confidence, safer alternative, behavior/configuration distinction, and new/pre-existing/resolved/unknown state.
- Check Run and Slack payloads are always previewable. Live GitHub publication needs Checks write access; authorization failures leave a report-only receipt. Slack is limited to active high/critical findings and excludes source-code snippets.

## Enable live integrations explicitly

No connector has been attached in this draft. Do not paste credentials into chat, source files, policy files, or workflow inputs.

1. Assign an operational owner and confirm repository-content retention and AI processing approval before enabling live review.
2. Attach a **HashiCorp Vault** connector to **Receive GitHub push**. Create a Vault KV v2 secret whose `data.data.secret` field contains the GitHub webhook shared secret (at least 32 characters). Enter that secret directly in GitHub's webhook settings and Vault, never into this workflow. Set `webhookSecretUrl` to the exact HTTPS Vault KV v2 read URL. This implementation intentionally supports that response contract; another secret provider requires an adapter, not a credential-entry route.
3. Attach a read-only **GitHub** connector to **Collect evidence** and **Inspect context (AI Agent)**, scoped to the repositories/dependencies to inspect. GitHub.com REST endpoints are used; GitHub Enterprise Server needs an explicit endpoint adaptation.
4. Attach an **Anthropic** connector to **Inspect context (AI Agent)**. Model configuration is [model.json](<Inspect context (AI Agent)/model.json>): `claude-opus-5-5`, adaptive high effort, eight turns, 60,000-token budget, 6,000 output tokens per call. If using a gateway connector, set its documented base URL in `model.json`.
5. To publish, attach a **GitHub App installation** connector with **Checks: write** to **Deliver outputs**. To notify, attach a Slack connector with `chat:write`, invite the bot to the chosen channel, and configure its channel ID.
6. Edit canonical [policy.json](<Collect evidence/policy.json>): set `mode` to `live`, add exact `owner/repository` values to `allowedRepositories`, set `enableAgent`, and independently enable `publishChecks` and `notifySlack`. Set `slackChannel` only when notifications are wanted. Run the source synchronization command below so all step-local policy copies agree.
7. Validate signatures (valid, missing, tampered, Unicode payload), repository allowlist denial, missing connector permissions, and dependency scope in a test repository. Approve external-write tests separately. Live external calls have **not** been tested by this fixture build.
8. Publish only after review. Copy the actual generated webhook URL from Links, including its platform-generated `external_id` parameter; never invent that value. Use GitHub's push event type and `application/json` content type.

The console, report API, and demo API are space-private. The push route uses `external_id` plus independent GitHub HMAC verification. Draft access remains space-private, so real GitHub delivery requires a published route. No public unauthenticated route was added.

## Coverage and edge cases

- **Pagination / truncated diffs:** compare commit pagination is capped at five pages. GitHub's compare file list caps at 300; exact workflow directory inventories avoid relying on that list. Missing/truncated patches are replaced by locally generated diffs from complete fetched contents. Commit-history pagination caps are disclosed; the security scope is endpoint workflow changes, not every intermediate commit.
- **New branch:** the zero before SHA is an empty-ref baseline. Newly present workflows are not proof of newly authored code.
- **Deleted branch:** inspect the before snapshot and resolve removed risks; no Check Run is attempted against the zero after SHA.
- **Force push:** compare endpoint snapshots, not a merge-base diff. Unavailable before commits produce incomplete coverage. Exact-content renames can be recognized without trusting merge-base rename metadata.
- **Renames:** compare metadata plus exact-content identity preserves old workflow baselines where available. Moves across the workflow-directory boundary appear as an addition or deletion; ambiguous modified renames can appear as delete/add. This is not treated as proof of newly authored malicious code.
- **Budgets:** at most 12 changed workflow files, 16 KiB per file, 100 collector API calls, 16 agent content reads, and eight agent turns. API calls have 10-second timeouts, response byte caps, and at most three read attempts with bounded backoff/jitter. Limits, inaccessible files, invalid YAML, symlinks, binary content and rate limits remain visible in the report.
- **Dependencies:** pinned referenced third-party actions and reachable local scripts/actions/workflows are eligible for read-only inspection. Mutable references, Docker images, dynamically computed paths, dependencies beyond budgets, and permission failures remain unresolved. A SHA pin is not a trust endorsement. Repository comments cannot grant new tools or change the reviewer's authority.
- **Environment protections:** a changed/removed environment binding is verifiable in YAML; actual historical required reviewers, bypass permissions and branch protection are not fetched or claimed verified.
- **Rules are heuristics:** shell dataflow is not a complete shell interpreter; conditions, matrices, indirect secret propagation and custom wrappers can require human/agent review. Before/after rule matching uses normalized evidence and severity, not a formal semantic equivalence proof. No arbitrary code is evaluated.
- **Post-push only:** workflow execution may precede the review. This automation is not a merge or execution gate and does not modify workflows, branches, actions, or approvals.

## Reliability, storage, and recovery

`ghawa-state` contains the exclusive-writer review/delivery/output ledger; readers mount it read-only. `ghawa-evidence` stores per-review immutable snapshots, `ghawa-agent` owns per-review context-read records, and `ghawa-conversations` stores bounded agent transcripts. Shared `audit` has serialized append-only daily JSONL records. Secrets used for signature verification remain only in process memory and are never written to state or stdout. Repository contents themselves may be sensitive: limit space access, review source for embedded credentials, and rotate any discovered exposed credentials. Do not add credential storage to these volumes.

Admission stops at 200 reviews rather than silently evicting deduplication records. Reports cap at 2 MB each (under 400 MB total); evidence/context budgets and admission leave substantial room below the 2 GB-per-volume limit. Monitor the shared audit volume separately because other workflows can write it. Archive complete review groups under an approved retention process. Removing ledger records also removes replay protection for those historical identities; do not clear them casually.

Output delivery is **at-most-one automatic attempt**, not a claim of transactional exactly-once delivery across GitHub/Slack and local storage. A reservation is committed before sending. Writes have no automatic network retry because an ambiguous response could otherwise duplicate a Check Run or message. Failures or timeouts record `uncertain` or `not_sent`; authorization failures record report-only fallback. A crash after reservation can omit a notification. Inspect GitHub/Slack and reconcile manually before any resend. Do not rerun **Deliver outputs** blindly.

A pending review older than ten minutes is an operational exception. Inspect the first failed step in run history. API collection failures normally produce an incomplete report. A platform kill/build failure leaves the pending row visible. Resume the failed read/analysis step using its recorded input; do not remove the delivery reservation or accept duplicate pushes as a recovery mechanism. Agent continuation can be resumed using its last `running` output. Re-running **Finalize report** after completion is a no-op. A final report without receipts indicates the output chain needs operator inspection.

No scheduled deletion or failure-notification destination is enabled. The owner must monitor pending reviews, failed runs, uncertain output receipts and storage capacity before unattended live use.

## Tests and source maintenance

Run **Validate analyzer** for deterministic regression checks covering all fixtures, path filters, identity semantics, baseline/new/resolved behavior, malformed YAML, injection, self-hosted runners, mutable actions, environment binding, HMAC byte integrity and branch-aware URLs. This is an executable test step, not a claim that live GitHub/Slack integration was tested. The fixture pipeline and duplicate suppression were exercised step by step. Browser rendering was not independently verified with a browser tool.

Each step runs in isolation, so common source is copied into its container. Canonical shared files are `Collect evidence/common.ts`, `Collect evidence/policy.json`, `Collect evidence/fixtures.ts`, `Check workflow security/rules.ts`, and `Finalize report/report.ts`. After editing these, synchronize with:

```sh
for s in 'Receive GitHub push' 'Run synthetic push' 'Reserve review' 'Check workflow security' 'Inspect context (AI Agent)' 'Finalize report' 'Reserve outputs' 'Deliver outputs' 'Record outputs' 'Read reports'; do
  cp 'Collect evidence/common.ts' "$s/common.ts"
  cp 'Collect evidence/policy.json' "$s/policy.json"
done
for s in 'Run synthetic push' 'Read reports' 'Validate analyzer'; do cp 'Collect evidence/fixtures.ts' "$s/fixtures.ts"; done
for s in 'Read reports' 'Validate analyzer'; do cp 'Check workflow security/rules.ts' "$s/rules.ts"; done
cp 'Collect evidence/common.ts' 'Validate analyzer/common.ts'
cp 'Finalize report/report.ts' 'Read reports/report.ts'
```

Policy changes never attach credentials: use the connector tools separately. Runtime URLs derive from `_3B_WORKFLOW_BASE_URL` so draft/live links stay correctly scoped. This build remains a draft until explicitly published.

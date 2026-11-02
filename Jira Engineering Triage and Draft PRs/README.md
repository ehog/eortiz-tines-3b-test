Demonstrates opted-in Jira tickets progressing through evidence gathering, conservative triage, a tool-using engineering agent, a validated patch, actual isolated tests, and a proposed or real **draft** GitHub PR. Humans retain ticket closure, risky engineering decisions, and PR merging.

## Start the demo

Open **Demo results** from this workflow's Links panel (`/engineering`). It and the replay API require space membership. Use the three replay buttons:

1. **DEMO-101 — synthetic flight-results date bug:** the actual `claude-fable-5` agent reads source and regression tests, stages a minimal patch, and the connector-free test step runs original and patched code under `America/Los_Angeles` and `UTC`. The page shows the diff, commands, exit codes, output, proposed PR, and proposed Jira comment.
2. **DEMO-102 — synthetic ambiguous checkout:** asks for reproduction, environment, observed and expected behavior, and measurable acceptance criteria. No agent or tests run.
3. **DEMO-103 — synthetic payment authorization:** asks for payment/security engineering approval and risk controls. No agent or tests run.

Current draft: `sourceMode = jira`, `liveWrites = false`. Jira is attached only to **Poll Jira** and **Prepare ticket**. GitHub and Jira writeback remain disconnected; Anthropic is connected to the agent. Synthetic replays remain available and never write to either external system, regardless of the live-write flag. A proposed PR has `url: null`; only an actual GitHub API response supplies a PR URL.

Jira intake polls **KAN — Solution Engineering** every 15 minutes after publication, using `project = KAN AND labels = "agent-ready" AND statusCategory != Done ORDER BY updated ASC`. Discovery found no accessible `agent-ready` tickets, so an empty poll is expected. An operator can opt in an open KAN ticket by adding that label; this workflow does not add labels or create tickets. Repository mappings remain empty: real Jira tickets produce triage and human-review evidence, not agent code changes or PRs. Polling is the selected trigger; no Jira webhook registration was performed.

The page generates a fresh replay tag per button click. POST `/engineering/replay` with `{"fixture":"flight-date","replay":"demo-session-1"}` for a reproducible, deduplicated replay. HTTP 202 contains a durable operation ID and status page URL. Stored records retain evidence; the page is not an approval mechanism.

## Pipeline

- [Intake](Intake/README.md) and [Jira webhook](<Jira webhook/README.md>) accept manual replays and webhook issue keys.
- [Poll Jira](<Poll Jira/README.md>) performs bounded paginated JQL reads on a configurable cron.
- [Prepare ticket](<Prepare ticket/README.md>) is the shared ingestion boundary: authoritative Jira reads, project/label checks, reservation, enrichment, and one-ticket-at-a-time queue draining via a self-link.
- [Triage](Triage/README.md) evaluates category, reported urgency, clarity, risk, and suitability. This is deliberately **deterministic conservative policy**, not an AI assessment. Autonomous scope currently admits only clearly specified presentation/date-formatting bugs. Other categories go to human review.
- [Engineering (AI Agent)](<Engineering (AI Agent)/README.md>) self-loops one model request per execution. Tools list, search and read a pinned repository snapshot, stage replacements, or request review. Tools cannot execute commands or write to GitHub.
- [Validate patch](<Validate patch/README.md>) independently rejects unsafe paths, oversized patches, changes to existing tests, and obvious execution/network capabilities.
- [Run isolated tests](<Run isolated tests/README.md>) has **no connectors or volumes**. It runs inspected dependency-free Bun tests in a fresh ephemeral sandbox with a clean child environment and bounded output/time. No package installation or install scripts. Network egress is not asserted to be disabled; use only a vetted sandbox repository without secrets or privileged external services. Static checks are defense-in-depth, not proof against arbitrary malicious code.
- [Publish draft PR](<Publish draft PR/README.md>) produces a proposal in dry-run or creates a non-default branch and draft PR after live gates pass.
- [Report outcome](<Report outcome/README.md>) records terminal evidence and proposes/posts the deduplicated Jira handoff. [Demo results](<Demo results/README.md>) reads it.

Every fan-out recipient checks its input stage. Nonmatching stages produce zero bytes. Agent consumers ignore `status=running`, and the agent's self-link stops on terminal results.

## Configuration

Canonical configuration: [Prepare ticket/settings.json](<Prepare ticket/settings.json>). Steps have local copies because builds are isolated. After editing it, run [Prepare ticket/sync-config.sh](<Prepare ticket/sync-config.sh>) in the workflow checkout, or copy `settings.json` and `common.ts` from Prepare ticket to every other step in the editor. Do not change just one live-write copy.

- `jiraProject`, `jql`, `optInLabel`: poller adds mandatory project/opt-in predicates; enrichment rechecks the current Jira issue.
- `acceptanceCriteriaField`: optional custom-field ID. Null extracts an explicit “Acceptance criteria” section from the description; missing criteria goes to review.
- `repositoryMappings`: project-key map. Each entry requires `repo` in owner/name form and `allowedPaths` with exact paths or directory prefixes ending in `/`. Include relevant source and tests. No wildcards. Empty mappings disable Jira repository work.
- `authorizedDemoRepositories`: entries with exact `repo`, `authorized: true`, `noPrivilegedExternalCI: true`, and `noProductionCredentials: true`. These are operator attestations, not model decisions. Require repository-owner authorization and CI/webhook review first.
- `sourceMode`: `fixture` or `jira`. `liveWrites`: false by default. `jira` plus `false` supports read-only investigations/proposals.
- Cadence: [Poll Jira/config.toml](<Poll Jira/config.toml>), default `*/15 * * * *`. Schedules run only after publication; fixture-mode polling makes no external calls.
- Limits: 10 tickets per poll page, 30 comments, 10 linked issues, 3 changed files, 16 KB patch, 16 tools, 8 model turns, 60,000 cumulative token stopping budget and 600 seconds across turns. One streamed request can cross the remaining input budget before its finish event. Model and effort: [model.json](<Engineering (AI Agent)/model.json>).

## Explicit live setup

1. Assign a human owner and confirm an isolated **demo-only** repository. Disable GitHub Actions. Audit external CI, webhooks, GitHub Apps, and branch/PR event handlers: none may have privileged deployment behavior. This workflow does not change Actions settings, secrets, or repository administration.
2. Configure the repository mapping and authorization allowlist. A mapping alone does not authorize writes or test execution. Agent and publisher independently read `/actions/permissions` and require `enabled: false` before repository tests/publication.
3. Attach 3B connectors:
   - Jira to **Poll Jira**, **Prepare ticket**, **Report outcome**. Issue/comment reads and narrowly scoped comment writes; no project administration.
   - Repository-scoped **read-only GitHub** to **Engineering (AI Agent)**, including Actions settings read.
   - Separate repository-scoped GitHub to **Publish draft PR**, with contents/refs and pull-request writes plus Actions settings read. No secrets/deployment/workflow/organization administration permissions.
   - Never attach any connector to **Run isolated tests**.
4. Configure Jira and set `sourceMode=jira`, retaining `liveWrites=false` for validation. Explicitly enable `liveWrites=true` only after operator review; synchronize all settings copies. Use a fresh opted-in demo ticket for a live attempt: deduplication is keyed to Jira issue key, not updated timestamp.
5. Register the **Jira webhook** URL shown by 3B, including its generated `external_id` parameter. Never invent it. Live access is for holders of that unguessable URL; drafts still require space membership. No public routes are created.
6. Test newly enabled integrations with operator approval before publishing. Jira project/search/issue/comment reads have been verified in this draft; Jira writes and all GitHub integration behavior remain untested and disabled. Jira is already attached to Poll Jira and Prepare ticket; attach it to Report outcome only when writeback is separately approved. Webhook registration is optional and was not performed for the selected polling setup. This draft has not been published.

Publication never pushes to the default branch. It uses deterministic `agent-demo/...` branches and GitHub Git Data APIs, checks the base SHA is still current, creates one commit/branch, then requests `draft:true`. Changed base, foreign branch, failed/not-run tests, enabled Actions, or missing authorization stops writes. Existing PRs must remain open drafts. No merge, deploy, secret update, or Jira transition code exists.

## Reliability and recovery

- Stable operation IDs and an exclusive state writer prevent concurrent reservations. Jira keys process once, preventing comment-triggered loops. Repeated synthetic tags reuse records; new tags intentionally start new runs.
- Reads have 12-second deadlines and at most three attempts for transient network/429/5xx failures with bounded backoff/jitter. Writes are not blindly retried. Deterministic refs, PR head/marker lookups, comment markers and saved effects reconcile retries.
- Before retrying failed writes, inspect GitHub/Jira and the job ledger. Uncertain POSTs stop for manual reconciliation. External-human races remain operator-owned; reserve `agent-demo/` for this workflow. Volume writes commit only on successful step exit, so a process kill during an external write requires checking the external system, not relying solely on the local ledger.
- Errors are explicit terminal `failed` records. Exception routing deliberately exits successfully so records commit and reach the evidence page. Unexpected kills/OOM/platform timeouts can leave nonterminal records: inspect 3B logs and external effects, then resume the last safe step with its original input. Never delete deduplication state and blindly retry a live ticket.
- Resume stalled agents using their last `agent-run` output; transcripts/context persist. Exhausted runtime requires human review rather than resetting budgets.
- Failed cases and human-review questions appear in **Demo results**; live Jira cases also get a comment when possible. No external alert channel was configured. The demo operator must monitor failures/stalled records and assign an alert destination before unattended operation.
- Polling persists its next-page cursor, advances on the next cron, wraps at the end and resets after JQL changes. A stored reservation blocks unsafe automatic retries of downstream failures.

## Audit, storage and capacity

Structured JSON stderr identifies steps, actions, API status/duration and operation IDs. Agent transcripts retain model/tool evidence and token/cache usage. Terminal decisions and external writes append to `/storage/audit/YYYY-MM-DD.jsonl` through exclusive writers. Reporting audits summarized agent/test outcomes; transcripts and execution logs retain intermediate details. Audit records reflect observed outcomes.

`priceline-engineering` stores jobs/effects/poll cursor; `engineering-agent` stores bounded agent context; `conversations` stores transcripts; `audit` is the space-shared audit volume. Readers use read-only mounts. Tests have no volumes. Exclusive writers favor correctness over throughput for this small demo. Never persist credentials.

Each volume is limited to 2 GB. Intake caps at 1,000 retained jobs. Bounded records/transcripts should fit below that, but monitor actual usage and the shared audit volume. Archive evidence/transcripts under your retention policy before raising the cap. Preserve deduplication/effect records or tombstones while Jira tickets remain eligible; deleting them can retrigger work. No automatic destructive pruning occurs.

## Verification

The real agent investigated the synthetic date bug in three model requests. Original code failed both regression tests in America/Los_Angeles and passed in UTC. Proposed code passed both tests in **both** timezones. PR URL remains null. Duplicate intake was skipped. Payment/ambiguous cases route to human review with tests not run. Server-rendered page/API output was exercised. Browser verification was unavailable because the editor was no longer open. For this Jira-source change, connector-backed project/search/issue/comment reads returned HTTP 200. Poll Jira returned zero eligible issues; Prepare ticket rejected unlabelled KAN-18. A synthetic checkout replay reached human review and proposed-only reporting; replaying the same input was deduplicated. An isolated synthetic Jira API fixture verified eligible issue/comment enrichment, acceptance-criteria extraction, repository-free human review, and no writeback requests. Downstream stage guards and webhook validation also passed. The agent and test execution were not re-run end-to-end for the date fixture during this change; the date results above are prior-version evidence. Jira writes and GitHub integrations remain untested and disabled.

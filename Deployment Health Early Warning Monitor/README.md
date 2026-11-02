# Purpose

Correlate recent deployments and ownership from Port with New Relic signals and Splunk error signatures. Provide an actionable early-warning **hypothesis**, never a claim that a deployment caused an incident. Deterministic thresholds determine severity; model confidence cannot escalate or suppress it. No remediation tools exist.

## Current operating mode

- **Fixtures**, **preview-only notifications**, and **no model calls** by default. Nothing has been published or connected to external services.
- The three synthetic scenarios are explicitly labeled. Their investigations are scripted for reproducibility, not represented as production AI results or measured early detection.
- The authenticated dashboard, replay API, and report API are available only to members of this space. No public routes.
- `*/10 * * * *` in [Start assessment/config.toml](<Start assessment/config.toml>) runs every ten minutes **after publication**. Drafts do not run schedules.
- Set an accountable workflow owner before live activation. No owner or live Port schema has been assumed.

## Flow

Start assessment → Collect evidence → Assess signals → Investigate changes (AI Agent) ↺ → Publish warnings → Send authorized Slack.

The agent self-loop performs one model request per execution; the publisher ignores running results. A separate dashboard immediately renders and fetches stored reports. The replay route returns `202` with an operation ID and status URL before collection begins.

Each operation owns its files. Short publication and delivery steps serialize shared deduplication state. Slow collection and investigation do not hold the shared warning-state lock. Stderr contains structured JSON events. Consequential requests, decisions and delivery attempts append audit records to the shared audit volume.

## Demo steps

1. Open **Deployment watch** from the workflow's Links or preview.
2. Choose **All three synthetic scenarios** and **Replay scenario**. Manual replay always forces fixtures and preview notifications, even if the scheduled mode is live.
3. Select **search-service**: normal variation, `healthy`, no warning required.
4. Select **booking-service**: p95 240 → 920 ms; errors 0.4 → 2.8%; saturation 49 → 83%; new `InventoryTimeout` signature, 0 → 86 events. Explicit rules yield `investigate`, not `urgent` (latency is below the 2,000 ms urgent floor). Inspect timeline, baseline/current bars, redacted excerpt, hypothesis, next checks and Slack text.
5. Select **payment-service**: low traffic, stale/incomplete telemetry and unavailable logs. Outcome is `investigate`, health `unknown`, low evidence confidence.
6. Replay **Deteriorating · booking timeout**. The same data and assessment recur; an unchanged warning is marked `suppressed_unchanged`. The complete warning remains visible for demonstration.
7. Use Export evidence to download the selected service assessment. Selected run and service are encoded in the URL.

Fixture timestamps are frozen at 2026-09-30 16:20 UTC. The operation creation timestamp is real; it is not a claimed detection time. Fixture links to external systems are omitted rather than fabricated.

When testing with step tools, execute each linked step individually using the previous execution output. An isolated `runStep` does not traverse downstream links.

## Configuration

Edit [Start assessment/settings.json](<Start assessment/settings.json>). This is editor-managed, secret-free configuration. Replay callers can supply only `scenario` (`all`, `healthy`, `deteriorating`, `incomplete`); they cannot turn on live mode, change queries or authorize Slack.

- `mode`: `fixtures` or `live`.
- `owner`: accountable operator/team; required for live.
- `environment`: exact environment shared by explicit mappings.
- `windows`: deployment lookback 120m, fixed pre-deployment baseline 30m, rolling post-deployment current window up to 10m, 2m ingestion buffer, at least 5m mature data. The current window advances on each collection; it never includes pre-deployment observations.
- `thresholds`: minimum 100 requests in each period, at least 5 saturation samples, timestamps within 5m of window end. Errors also require ≥95% error-field coverage in live NRQL results. Missing fields are unknown, not zero.
- `limits`: at most 12 deployments, 3 Port pages × 50 records, 20 signatures per window, 1 MB response, 8s request timeout, 3 read attempts, 210s collection deadline, 14-day report/state retention. Lower these for slow sources. Query caps explicitly degrade coverage rather than implying completeness.
- `notifications`: `preview` is default. Posting additionally requires `postingAuthorized: true`, a Slack channel ID, and a connector on the isolated sender step.
- `agentEnabled`: false by default. Live mode can enable the real read-only investigation agent after attaching a model connector. Fixtures remain scripted regardless.

### Port: configure the actual schema

Port does not have a universal deployment blueprint. Before enabling live collection, use a read-only Port account to inspect available blueprints and representative entities. Configure:

- `port.baseUrl`: region-appropriate API base (default `https://api.getport.io/v1`).
- `deploymentBlueprint`, `serviceBlueprint`: verified blueprint identifiers.
- `deploymentFields`: dotted paths `service`, `deployedAt`, `version`, `environment`, optional `url`.
- `serviceFields`: dotted paths `owner`, optional `dependencies`.

`service` must resolve to the exact Port service entity identifier; `deployedAt` must reference a real blueprint date-time property under `properties.*`. Ownership may be a property or top-level team value. Dependency mappings must resolve to an array of service identifiers. Arrays of deployment-to-service relations are not automatically guessed; normalize those in Port or adapt the collector deliberately. The collector reads the selected blueprint schema before searching deployments, bounds pagination, and reports mismatches as unknown coverage. Missing deployment mappings fail live activation rather than silently choosing defaults.

### Explicit service mapping contract

Every element of `services` needs `portService`, `environment`, `newRelic`, and `splunk`. Values must be discovered from your systems, not copied from fixture names.

`newRelic` keys:
- `entityGuid`, `eventType`, `entityField`, `environmentField`, `durationField`, `durationUnit` (`seconds` or `milliseconds`), `errorField` (boolean), optional verified `url`.
- `saturation`: `eventType`, `field`, `entityField`, `entityValue`, `environmentField`, `unit` (`fraction` or `percent`). Choose a relevant signal such as connection-pool, queue, worker, CPU or memory utilization. Missing saturation is unknown.
- Global `newRelic.accountId` is a positive integer; `endpoint` is a credential-free regional NerdGraph HTTPS endpoint.

`splunk` keys:
- `index`, `serviceField`, `serviceValue`, `environmentField`, `levelField`, `errorLevel`, `signatureField`.
- Optional `redactedExcerptField` with `excerptFieldApproved: true`: an **already sanitized, approved field** containing representative log text. `_raw` and unsanitized messages must not be mapped here. The workflow applies additional best-effort redaction. Without an approved field, excerpts are intentionally withheld and source links are offered instead.
- Global `splunk.baseUrl`: HTTPS management API base (including port if required). `webUrl`: verified search-page URL for source links.

Queries are generated from allowlisted field/identifier syntax and explicit time boundaries. Neither the caller nor the agent supplies arbitrary SPL/NRQL. Normalized signatures come from an explicitly configured field. A new signature means absent **in the observed baseline**, not globally novel; capped results cannot establish novelty.

### Escalation rules

| Signal | Watch | Investigate | Urgent |
|---|---|---|---|
| p95 latency | ≥1.3× baseline | ≥1.75× | ≥3× **and** ≥2,000 ms |
| Error rate | +0.5 percentage points | +1 pp | ≥5% **and** +1 pp |
| Throughput | — | ≥30% decrease | — |
| Saturation | ≥75% | — | ≥90% |
| Log signatures | — | New ≥10 events, or ≥2× rate and +2 events/min | — |
| Missing/stale/insufficient data | — | Always investigate, health unknown | Never on absence alone |

The most severe valid measured rule wins. Sufficient traffic and freshness gate latency/error escalation. Per-minute log rates normalize unequal baseline/current windows. Confidence is a qualitative evidence-completeness label, not a probability of causation. These are configurable operational thresholds, not statistically calibrated predictions.

### Live enablement and separate Slack authorization

1. Confirm ownership and source schema; populate explicit mappings and verified source links.
2. Attach least-privileged connectors to **Collect evidence**: Port catalog/blueprint reads, New Relic NerdGraph query access, Splunk search access restricted to configured indexes. No credentials belong in files, forms, chat, or volumes.
3. Set live mode but leave notifications preview-only. Run a bounded read-only validation against real entities. The live adapters have not been verified against your tenant data.
4. For genuine model investigation, attach Anthropic to **Investigate changes (AI Agent)**, then set `agentEnabled: true`. Model: `claude-opus-5-5`, adaptive thinking, high effort, maximum 6 turns, 30k-token budget, 3k output tokens per turn. Tools inspect selected services and dependency evidence from the collected snapshot; they do not perform unconstrained live searches. Missing dependency observations remain unknown.
5. Only after separately approving real notifications, attach Slack to **Send authorized Slack**, configure the channel and set both posting flags. The workflow has not requested or exercised this permission. Preview state is separate from posting state, so enabling posting does not inherit preview suppression.
6. Publish explicitly when ready. Publication enables the schedule; building this draft does not.

## Notification state, failures and replay

State is scoped by mode, notification authorization/destination, environment, service and deployment ID. A severity transition, changed coverage gaps, changed signature set, threshold crossing or ≥20% metric/signature-rate change from the last published evidence produces an update. Hypothesis wording alone does not. Recovery after a prior warning can publish a healthy update.

A reservation is committed before the separate Slack sender runs. Source reads retry only transient errors with bounded exponential backoff/jitter; authorization and invalid-query failures do not retry. Source failures are preserved independently, and a collection-coverage assessment warns when Port fails or no scoped deployments are returned.

Slack sending deliberately does **not** blindly retry ambiguous POST failures. Delivery IDs are supplied as `client_msg_id`, finalized receipts suppress repeats, and unknown outcomes require reconciliation. This is not a claim of exactly-once delivery: a process death after Slack accepted a message but before receipt publication can leave an unknown outcome. Search Slack for the message and inspect the attempted audit before authorizing a resend. Reserved/failed/unknown receipts are visible in the report; unchanged evidence will not automatically retry a failed send.

If an operation remains pending for 35 minutes, the API shows `overdue`. Inspect the first failed step in run history. Replay fixtures safely; for a live failure, inspect mappings/permissions and rerun only after resolving the cause. An agent error or invalid result retains the deterministic assessment and records an explicit warning. No failure should be interpreted as healthy.

## Storage and capacity

`deployment_watch_jobs`: per-operation job, evaluated snapshot, report and optional transcript; publisher removes operation directories older than 14 days. Readers mount read-only. `deployment_watch_state`: exclusive short writer for deduplication, entries expire at 14 days. `deployment_watch_deliveries`: exclusive sender receipts; records are small and retained for delivery reconciliation. `audit`: append-only shared daily JSONL under an exclusive writer; never rewritten by this workflow.

At 144 scheduled runs/day and roughly 100–500 KB per capped operation including an agent transcript, 14 days is roughly 0.2–1.0 GB, under the 2 GB per-volume limit. Manual replay bursts and unusually large transcripts can exceed this estimate. Monitor volume utilization and archive audit/receipts under the space retention policy before the cap; no automatic audit deletion occurs. Each collection response is capped at 1 MB and each stored log excerpt at 600 characters. Model transcript persistence is workflow-specific and follows report retention. Platform execution history has separate retention.

## Security and limitations

- No rollback, deployment, restart, write-query, or monitoring-configuration tools.
- Space-private routes; POST-only replay; no user-supplied query, model prompt, or credential entry. All own-route links are runtime branch-aware.
- Logs/metadata are untrusted. Redaction is best-effort, not a DLP guarantee; use upstream sanitization and least-privileged fields. Logs never instruct the agent. Model prose is supplementary and does not alter measured evidence or severity.
- A fixed pre-deployment baseline may be unrepresentative due to seasonality, traffic changes, concurrent deployments, or upstream failures. Multiple deployments can overlap windows; causation is not established.
- New Relic event sampling, instrumentation, units and saturation semantics must be verified. Logs may arrive later than the configured buffer; adjust it to your ingestion characteristics.
- Agent tools are deliberately limited to this bounded snapshot. Dependency impact is unverified unless that dependency is also observed.
- A single post-deployment aggregate establishes a change versus baseline, not a statistically proven rising trend or early-detection advantage. Synthetic data must never be reported as a measured production outcome.
- No connector-backed tenant integration or browser rendering test has been performed. Server rendering and fixture pipeline tests are performed in the draft.

## Common changes and checks

Configuration: [settings.json](<Start assessment/settings.json>). Rules: [evaluate.ts](<Assess signals/evaluate.ts>). Source adapters: [live.ts](<Collect evidence/live.ts>). Synthetic cases: [fixtures.ts](<Collect evidence/fixtures.ts>). Agent policy: [system.md](<Investigate changes (AI Agent)/system.md>). Warning text/material-change logic: [format.ts](<Publish warnings/format.ts>). UI: [App.tsx](<Deployment watch/App.tsx>).

Deterministic developer checks are in [Assess signals/checks.ts](<Assess signals/checks.ts>): normal variation, deterioration, missing telemetry, urgent/watch boundaries, stale/low samples, suppression, changed evidence, recovery, redaction and branch-safe URLs. Run with Bun from that step directory. Tests do not post messages. Live connector acceptance testing is a separate enablement task. Draft checks passed for all three fixture outcomes, unchanged-warning suppression on replay, self-loop termination, running-agent publication suppression, rejection of caller-supplied live mode, POST-only replay, all step execution paths used in fixture mode, and HTML rendering. The deterministic check suite also runs during the assessment step build.

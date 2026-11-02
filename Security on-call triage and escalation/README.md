## Purpose and operating boundary

Reduce repetitive security triage without silently dismissing alerts. The investigator recommends a disposition; deterministic policy routes incidents to urgent escalation or an accountable human review. PagerDuty remains the system of record and continues its existing paging.

**Default: fixtures, no model calls, simulated Slack delivery.** No connectors are attached. Live processing is deliberately disabled until the integration prerequisites below are satisfied. Synthetic items retain their simulation mode even after live mode is enabled.

Open the **On-call console** step's webpage preview from the editor. The console and its APIs are restricted to this space's authenticated members. In simulation, authenticated space members may review synthetic items; live reviews require the configured allowlist. Raw step-test requests do not carry a verified identity and correctly receive 403.

Owner: Security operations. Assign a named operational owner before deployment.

## Flow

1. **Receive PagerDuty** validates an external-ID-protected, signature-verified PagerDuty v3 event; permits configured services; deduplicates event IDs; persists an investigation item; responds 202 with an item ID and status URL.
2. **Fetch context** reads the incident, up to 25 alerts, and service/ownership context. Reads use bounded retries. Oversized, incomplete, or unavailable context prevents safe deferral.
3. **Investigate (AI Agent)** uses the standard durable async self-loop. Simulation emits labeled fixture assessments without a model call. Live uses `claude-opus-5-5`, high effort, adaptive thinking, six model requests maximum, 32,000-token budget, 3,000 output tokens per request. Up to four bounded read tools execute per model turn. The model has no notification, remediation, PagerDuty write, shell, arbitrary URL, or general-purpose search tool.
4. **Route assessment** schema-validates the output, checks source references, restores canonical evidence text/kinds, includes observed risk signals even if the model omitted them, and preserves required-source failures. It writes the assessment, persistent review state, audit entry and notification outbox record.
5. **Claim notifications → Deliver Slack → Record delivery** claims at most three outbox jobs, resolves current PagerDuty on-call and configured Slack identities for urgent items, and records simulated or real delivery results.
6. **Review and replay / Receive Slack** record authenticated reviewer, rationale, time and decision. A version guard, exclusive writer and unique decision key reject stale, repeated or conflicting decisions. Slack actions open a rationale modal. A confirm-benign decision changes only the workflow's review record.
7. **Check deadlines** runs every minute in Live. Pending reviews expire after 30 minutes; unfinished investigations after 10 minutes. Both escalate rather than disappear. Review-notification failures escalate, and uncertain delivery remains visible for operator reconciliation.

The UI is a separate read-only webpage that fetches queue state. It is not on the investigation's critical path.

## Routing rules

Severity is 1–5. Default urgent threshold is 4. Source severity cannot be downgraded by the model.

Urgent routing takes precedence when there is high severity, a compromise indicator, a malicious/urgent recommendation, material uncertainty on a critical asset, insufficient independent benign corroboration, missing context, or risk/gap evidence. Unknown service criticality defaults to critical. A configured critical service always overrides the noncritical list.

Review requires a likely-benign assessment, severity below the threshold, at least two independently named evidence sources classified as benign, and no unresolved missing/risk/gap evidence. Confidence is shown to the reviewer but never grants permission to defer. The policy is intentionally conservative.

## Demo script

All three scenario buttons are labeled synthetic. All notification previews and delivery records say simulated; no real Slack messages are sent.

1. Replay **Approved scanner**. Inspect E1 (owned scanner), E2 (approved time/scope), E3 (blocked requests/no successful authentication), and counterevidence. Observe `pending_review` and the Slack review preview.
2. Enter a rationale such as “E1–E3 match the approved scanner, permitted target and observed scan window; no successful authentication appears.” Select **Confirm benign**. Open **Decision record** and refresh: the verified human identity, rationale and timestamp persist; the decision is locked. PagerDuty is unchanged.
3. Replay **Approved scanner** again as a separate item. Choose **Escalate to on-call**, with a rationale such as “Requesting independent validation of scanner ownership before accepting the exception.” This demonstrates a human escalating a lower-risk item instead of accepting the recommendation. Reuse the scanner scenario because the privileged and ambiguous scenarios must already escalate automatically.
4. Replay **Privileged activity**. Multiple supporting signals route immediately to urgent escalation. Inspect the evidence-backed message and simulated on-call identity.
5. Replay **Missing context**. The critical payments asset and telemetry gap route urgently despite only moderate source severity. Missing evidence is never treated as exculpatory.
6. Replay another scanner item and select **Demo: expire deadline**. The downstream deadline check immediately escalates it in a normal workflow run. In isolated step tests, run **Check deadlines**, **Claim notifications**, **Deliver Slack**, and **Record delivery** explicitly.
7. Try a repeated decision or stale item version through the API: expect 409. Rerun a replay with the same `requestId`: no new item or notification is created.

The build seeded the three scenario types plus a second scanner review item. No human decision is fabricated or pre-recorded. A real signed-in person performs steps 2 and 3 in the console. The verification step uses an explicitly synthetic test actor in an in-memory database; that is a regression test, not a human approval.

### Manual step replay

Run **Replay demo** with:

```json
{"scenario":"scanner","requestId":"demo-scanner-001"}
```

Valid scenarios: `scanner`, `privileged`, `ambiguous`. Change the request ID to create another instance. Empty input uses a stable scanner replay ID. The step is editor-triggered, not an unauthenticated HTTP endpoint.

Normal workflow execution follows configured links. `runStep` tests one step only; pass its execution ID to the next step. The agent's terminal self-loop produces no output.

## Configuration

Canonical files: [settings](<Review and replay/settings.json>) and [shared controls](<Review and replay/common.ts>). Step containers are isolated; run [sync-shared.sh](<Review and replay/sync-shared.sh>) after editing either canonical file. Review the resulting diff and run **Verify controls**. Do not edit generated copies independently.

- `mode`, `liveEnabled`: simulation by default; both must explicitly select live processing.
- `services`: PagerDuty service IDs permitted at intake.
- `criticalServices`, `noncriticalServices`: conservative service criticality policy; unclassified services are critical. Enrichment may still surface risk on any service.
- `highSeverity`, `minBenignEvidence`: routing thresholds.
- `reviewMinutes`, `investigationMinutes`: escalation deadlines.
- `reviewers`: lowercased verified 3B email allowlist for real decisions.
- `simulationSpaceReviewers`: allows authenticated space members to review synthetic items only.
- `slackTeamId`, `slackReviewers`: exact Slack workspace and authorized user IDs.
- `identityMappings`: PagerDuty user ID → Slack user ID. Missing or partial mappings cause fallback, with a recorded identity-resolution failure.
- `reviewChannel`, `urgentChannel`, `fallbackSlackUserId`: Slack IDs, never display names. Use a real accountable fallback responder.
- `signatureVerifierUrl`: authenticated, low-latency HTTPS verification service described below.
- `enrichmentSources`: approved read-only adapters. No sources are assumed connected.
- `maxItems`: 1,000 retained incidents by default; new intake fails visibly when full rather than deleting evidence.
- `maxDeliveryAttempts`: three explicit rate-limit retries maximum.

There is intentionally no incident-update capability. Enabling acknowledgement/resolution or other PagerDuty mutations requires a separately reviewed workflow change, not a hidden switch.

## Live integration setup — required before enabling

Live mode is implemented but **not connected or live-validated** in this draft. PagerDuty was not available here during connector discovery; a supported PagerDuty connector can be authorized. No real service IDs, Slack workspace/channels/reviewers, identity map, signing-secret verification service, or enrichment sources were supplied.

1. Attach read-only PagerDuty credentials to **Fetch context** and **Deliver Slack** for `https://api.pagerduty.com/`. Grant incident/alert/service/on-call reads only; do not grant incident write scopes.
2. Attach Anthropic to **Investigate (AI Agent)** for `https://api.anthropic.com/v1/messages`. The provider connector injects authentication; credentials are never stored in files. Verify the selected model is available in your account before live operation.
3. Attach the intended Slack bot connector to **Deliver Slack** and **Receive Slack**, permitting `chat.postMessage` and `views.open`. Invite the bot to the configured channels. Configure interactive actions with the exact generated Slack callback URL.
4. Provide a signature verification service with its own secret store and attach its connector to **Receive PagerDuty** and **Receive Slack**. Standard outbound PagerDuty/Slack API connectors do not expose incoming webhook signing secrets to step code. This workflow therefore does not pretend an outbound token verifies webhook authenticity. Never paste signing secrets in chat, configuration, request bodies or volumes.
5. Configure both webhook destinations using the platform-generated external-ID URLs from the editor. Preserve the actual generated `external_id` query parameter; do not invent one. Draft routes remain space-private and cannot receive real provider callbacks. After publishing, callbacks require both the generated external ID and a valid provider signature.
6. Fill the configuration fields above, assign the operational owner, add approved enrichment adapters, then set `mode` to `live` and `liveEnabled` to true and synchronize copies. Requests cannot override mode or choose arbitrary destinations.
7. Validate signed/invalid/tampered/stale callbacks, reviewer denial, live on-call fallback, rate limits, uncertain delivery, and deadline escalation in a dedicated test service/channel before production. Real sends require explicit approval.

### Signature verifier contract

POST the configured HTTPS URL through a connector, with:

```json
{"provider":"slack","headers":{"x-slack-signature":"v0=...","x-slack-request-timestamp":"..."},"rawBodyBase64":"..."}
```

PagerDuty uses `provider: "pagerduty"` and `x-pagerduty-signature`. The body is the exact incoming body bytes encoded as base64, not reserialized JSON. Return `{"valid":true}` only after verification; all other results fail closed.

The service must authenticate the workflow caller, select the correct tenant/app secret, perform constant-time HMAC comparison, and enforce provider replay rules. For Slack: HMAC-SHA256 over `v0:<timestamp>:<raw body>`, compare `v0=<hex>`, reject clock skew beyond five minutes. For PagerDuty v3: verify a supported `v1=<HMAC-SHA256(raw body)>` entry against the subscription signing secret. Follow the provider's current specification and test known signed fixtures. The workflow independently checks Slack timestamp format/skew and deduplicates PagerDuty event IDs.

The verifier has a 1.1-second timeout and no retries on the interactive path. Slack modal opening has a one-second timeout and no retries to protect Slack's short interaction deadline. Keep this service nearby and low-latency. Invalid requests must never return `valid:true`. The verifier itself is a prerequisite external service, not deployed by this workflow.

### Read-only enrichment adapter contract

Each source configuration is `{name,category,url,enabled,required}`. Categories may be logs, changes, asset/user context, or approved runbooks. The agent selects a configured source name, never an arbitrary URL. Attach the source's connector to the agent. If a source is workflow-backed, inspect its OpenAPI contract before connecting it and adapt this wrapper to that contract.

GET requests supply `incident_id`, `service_id`, `from`, `to`, `limit=20`. The window is one hour ending at intake time. Return:

```json
{"evidence":[{"text":"A short redacted factual observation","kind":"benign"}],"truncated":false,"missingContext":null}
```

Kinds: `benign`, `compromise`, `risk`, `gap`. The adapter, not arbitrary log text, assigns these normalized signal types. Never copy a user-controlled JSON `kind` directly into trusted evidence. Results receive source-provided provenance IDs at the tool boundary. Required sources must be checked; missing/truncated results block deferral. There are no vendor-specific enrichment adapters configured by default.

## Reliability and operations

- Persisted state: SQLite in `security_oncall_fxrrvpnjxhbk`; short exclusive writer steps serialize queue/decision/outbox updates. Reads are read-only. Slow model and notification work runs outside the queue writer.
- Source context, tool receipts and agent transcripts: separate `security_oncall_transcripts` volume, incident-owned paths. Six turns and bounded source/tool results keep growth bounded per investigation.
- Audit: transaction-local history in SQLite plus append-only daily JSONL in the shared `audit` volume. The queue history is authoritative for state transitions; separate volumes cannot provide an atomic cross-volume commit. Audit-volume access should be tightly restricted. Reviewer identity is intentionally retained for accountability.
- No secrets are persisted. Redaction masks common token, credential, email and SSN patterns before model input and notifications. This is not a universal DLP guarantee: upstream sources must minimize sensitive payloads. Raw webhook execution inputs are retained by the platform before step redaction; apply appropriate execution retention and access controls.
- GET retries are bounded with exponential delay/jitter. Authentication/client errors fail rather than retry indefinitely. Slack `chat.postMessage` is not blindly retried after timeout/5xx: delivery may already have happened. Stable `client_msg_id` supplements, but does not claim, exactly-once delivery.
- Claims older than five minutes become `uncertain`. Inspect Slack and reconcile before any resend. Rate-limit responses explicitly known not to have delivered are retried up to the configured limit. Definitive or uncertain failures remain visible as delivery exceptions; original PagerDuty paging is untouched.
- Investigations whose workers fail before routing escalate at their deadline. Review message failures escalate the item. If Slack itself is unavailable, an independent operator must use the existing PagerDuty incident and the visible exception queue; there is no fictional backup transport.
- Schedule runs only in Live. In the draft, run **Check deadlines** manually or use the demo expiry action. Monitor workflow run failures and the delivery-exception count.
- At 1,000 items, intake returns 503 with a capacity error. No automatic deletion of incidents, decisions or audit history occurs. Export/archive resolved demo or live records under an approved retention policy before capacity is reached. The 2 GB per-volume ceiling still applies, particularly to the shared audit store across workflows. A nominal 1,000 × <1 MB investigation budget stays below 2 GB; monitor actual usage and export transcripts before expansion.

## Tests and acceptance

**Verify controls** contains 17 deterministic assertions covering the three scenario routes, confidence-independent routing, source severity, missing corroboration, malformed assessments, authorization and CSRF boundaries, redaction, locked decisions, expiry, and draft-safe URLs. Its synthetic reviewer tests use an in-memory database and explicitly identify themselves as tests in audit records.

Build verification ran all three fixtures through context → investigator → router → simulated delivery, and exercised the console renderer, disabled live boundaries, unauthenticated API rejection, and deadline checker. Live integrations, cryptographic verifier operation and browser-authenticated human decisions require the acceptance steps above. No live Slack or PagerDuty action was performed.

Useful changes: fixture evidence and shared rules in [common.ts](<Review and replay/common.ts>), agent instructions in [system.md](<Investigate (AI Agent)/system.md>), model limits in [model.json](<Investigate (AI Agent)/model.json>), UI in [App.tsx](<On-call console/App.tsx>), schedules in [Check deadlines/config.toml](<Check deadlines/config.toml>).

A SOC containment demo built to show failure handling explicitly: per-call deadlines, bounded exponential-backoff retries, transient vs permanent classification, forced failures on demand, guardrails that refuse to leave partial containment, a resume that skips completed work, and a durable audit trail.

Everything is driven from an interactive console; the four "external" services are simulated inside the workflow, so the demo is self-contained apart from the Slack alert.

#### Flow

1. An analyst opens [Containment Console](<./Containment Console/README.md>) at `/containment`, sets the alert/endpoint, picks chaos toggles and presses **Run containment**.
2. [Start Run](<./Start Run/README.md>) (`POST /api/runs`) validates input, creates the run and links to the orchestrator.
3. [Containment Orchestrator](<./Containment Orchestrator/README.md>) executes five stages in order, each with its own timeout and retry budget:
   `proofpoint_enrich` → `zscaler_enrich` → `defender_query` → `servicenow_create` → `endpoint_isolate`.
4. [Notify Analyst](<./Notify Analyst/README.md>) posts to Slack when a run ends anything other than `contained`, with what succeeded, what failed, the current system state and a resume link.
5. The console polls [Runs API](<./Runs API/README.md>) and then replays the recorded attempt timeline; [Retry Run](<./Retry Run/README.md>) resumes a failed run and [Demo Reset](<./Demo Reset/README.md>) clears state between demos.

For a presented walkthrough, **Guided tour** in the console header runs a scripted spotlight overlay: an agenda, two short setup stops, then three proof peaks — transient recovery, the guardrail refusing partial containment, and an idempotent resume — closing on the log and audit trail. The peaks launch the real runs themselves; nothing about the tour is simulated. Script and overlay live in [tour.tsx](<./Containment Console/tour.tsx>).

#### Resilience rules

| Stage | Timeout | Retries | Side effect |
| --- | --- | --- | --- |
| `proofpoint_enrich` | 5s | 3 | none |
| `zscaler_enrich` | 4s | 3 | none |
| `defender_query` | 6s | 4 | none |
| `servicenow_create` | 8s | 2 | creates an incident (idempotency key `snow-create:<runId>`) |
| `endpoint_isolate` | 8s | 2 | isolates the device (idempotency key `isolate:<runId>:<machineId>`) |

- Transient: 408, 425, 429, 500, 502, 503, 504, 507, 509, timeouts and network errors. Retried with backoff 1s, 2s, 4s, 8s plus jitter, honoring `Retry-After` when it is larger.
- Permanent: 400, 401, 402, 403, 404, 405, 409, 410, 415, 422, 451. Failed immediately, never retried.

#### Guardrails

- Isolation is only attempted when a ServiceNow incident number exists. If ticket creation fails, isolation is recorded as `skipped_guardrail` and nothing is contained — no partial state.
- If isolation fails after the ticket exists, the incident is patched to `containment incomplete` with the failure detail in `work_notes`, and the analyst is alerted.
- If a later resume finally isolates the endpoint, the incident flag is cleared back to `contained`.
- Each stage commits its outcome to the volume before the next one starts, so a resume skips completed stages instead of repeating their side effects.
- The orchestrator exits 0 even when containment fails: handling the failure *is* the successful outcome, and exiting nonzero would discard the recorded state that makes resume possible.

#### Chaos mode

Toggles are set per run in the console (or in the `chaos` object of `POST /api/runs`). Each can fail N attempts then succeed, or fail always.

| Toggle | Effect |
| --- | --- |
| `proofpoint_500` | HTTP 500 from Proofpoint — transient, retried |
| `zscaler_timeout` | no response until the 4s deadline expires |
| `defender_429` | HTTP 429 with `Retry-After: 1` |
| `servicenow_400` | HTTP 400 rejection — permanent, isolation blocked |
| `isolate_fail` | HTTP 503 on isolation — ticket exists, containment incomplete |

Presets in the console: clean run, transient recovery, Zscaler timeout, permanent reject, partial containment.

#### Simulated services

Proofpoint TAP, Zscaler, Microsoft Defender and ServiceNow are served by a loopback HTTP server started inside the orchestrator ([mocks.ts](<./Containment Orchestrator/mocks.ts>)). Calls are real `fetch` requests with real status codes, latency and `Retry-After` headers, so timeout and retry behavior is genuine. Simulated ticket state, isolation state and chaos counters live in the volume, which is what makes idempotent replay observable across runs.

#### State

Volume `containment_state`, SQLite at `/storage/containment_state/containment.sqlite`: `runs`, `run_stages`, `attempt_log` (one structured log line per attempt), `audit_log` (every attempted action with outcome), `mock_state`. The orchestrator and the three writing routes mount it `concurrency=exclusive`; Runs API mounts it read-only.

#### Routes

All routes are `route_auth = "space"` — only members of the `eortiz` space can reach them.

| Route | Step |
| --- | --- |
| `GET /containment` | Containment Console (webpage) |
| `POST /api/runs` | Start Run |
| `POST /api/runs/retry` | Retry Run |
| `GET /api/runs/list` | Runs API |
| `POST /api/demo/reset` | Demo Reset |

#### Operating notes

- Tune deadlines and retry budgets in `STAGE_CONFIG` in [script.ts](<./Containment Orchestrator/script.ts>); change classification or backoff in [resilient.ts](<./Containment Orchestrator/resilient.ts>).
- Change failure behavior of a simulated service in [mocks.ts](<./Containment Orchestrator/mocks.ts>); add a new chaos toggle in [chaos.ts](<./Containment Orchestrator/chaos.ts>) (copy it to the other steps that import it) and in `CHAOS_META` in [data.ts](<./Containment Console/data.ts>).
- The Slack channel is set by `CHANNEL` in [Notify Analyst](<./Notify Analyst/script.ts>).
- The orchestrator's timeout is 300s so a "fail always" timeout preset can exhaust its retry budget without being cut short.
- Pinned step tests cover the read path and the two input-rejection guards. The orchestrator itself is not pinned: its output embeds real latencies, jittered backoff and timestamps, so a byte-exact replay would always differ. Verify it with the chaos presets instead.

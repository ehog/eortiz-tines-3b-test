Runs the containment pipeline for one run and records everything it attempted. Triggered by a link from [Start Run](<../Start Run/README.md>) or [Retry Run](<../Retry Run/README.md>); stdin is that route's HTTP response, from which it reads `{ runId, mode }` (`mode` is `start` or `resume`).

Behavior:

- Loads the run and its stage state from the `containment_state` volume (mounted `concurrency=exclusive`) and starts at the first stage that has not already succeeded.
- Starts the simulated Proofpoint / Zscaler / Defender / ServiceNow services on loopback ([mocks.ts](./mocks.ts)) using the run's chaos settings, then calls them over real HTTP.
- Wraps every call in [resilient.ts](./resilient.ts): its own `AbortSignal.timeout`, bounded exponential backoff with jitter, `Retry-After` support, and transient/permanent classification. Permanent failures are never retried.
- Enforces the guardrails: no isolation without a ticket number; a failed isolation after a ticket exists patches that incident to `containment incomplete`; a later successful resume clears the flag.
- Writes one structured JSON log line per attempt to stderr and mirrors it into `attempt_log`, plus an `audit_log` row for every attempted action with its outcome.
- Exits 0 even when containment fails — handling failure is the intended outcome, and a nonzero exit would discard the volume state that resume depends on. A missing `runId` with no upstream `error` field is a real error and does fail.

Output (stdout, consumed by [Notify Analyst](<../Notify Analyst/README.md>)): a run summary with `status` (`contained`, `partial`, `blocked`, `failed`), `succeeded`, `skipped`, `failed`, `guardrail`, `systemState` (ticket number/state, isolation state, idempotency keys), `resumeFrom`, `willSkipOnResume` and `retryUrl`.

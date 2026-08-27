Turns Qualys vulnerability findings into batched, owner-assigned ServiceNow changes that carry a
concrete remediation package, then tracks those changes to closure and reports on progress.

Qualys and ServiceNow are **mocked inside this workflow** as real HTTP routes, so the whole thing is
demonstrable end to end without credentials for either product. Anthropic is the only external
service called.

#### What it does

1. **Ingest.** A scheduled pull reads Qualys detections every 15 minutes and emits only the ones that
   are new or changed. A webhook route accepts pushed detections into the same pipeline.
2. **Normalize and group.** Detections become one canonical finding shape, are attributed to an
   application and owning team through [an asset-owner lookup](<Normalize And Group/asset-owners.json>),
   and are grouped by asset and then by team. Assets with no owner record go to a Security Operations
   bucket rather than being dropped.
3. **Prioritize.** A documented weighting of Qualys severity, CVSS, KEV/exploit status, asset
   criticality and internet exposure produces a 0–100 risk score, a band, an SLA date, and a
   plain-language explanation naming each factor's point contribution.
4. **Generate a remediation package.** For every finding at or above the high-priority threshold, one
   structured model call produces the required patch or package version, exact commands for that
   OS/stack, a before/after code fix for code-level findings, prerequisites and reboot impact,
   validation steps, and verbatim citations from the Qualys evidence. When the evidence cannot support
   a specific fix, the package says so and lists what is missing instead of guessing.
5. **Raise changes.** One open ServiceNow change per owning team and application, batching that team's
   findings, with an SLA due date derived from the highest risk score in the batch. Re-running updates
   the existing change rather than duplicating it.
6. **Track and report.** An hourly chase escalates changes past their SLA date. A daily report
   computes opened, closed, overdue, mean time to remediate, SLA attainment and the top recurring
   vulnerability classes over a rolling window.

#### Steps and triggers

| Step | Trigger | Purpose |
| --- | --- | --- |
| [Demo Console](<Demo Console/README.md>) | route `/` (webpage) | The UI that drives the whole demo |
| [Console API](<Console API/README.md>) | route `/api/console` | Pipeline state, weights, demo clock, live re-scoring |
| [Mock Qualys API](<Mock Qualys API/README.md>) | route `/mock/qualys/findings` | Stands in for Qualys VMDR |
| [Mock ServiceNow API](<Mock ServiceNow API/README.md>) | route `/mock/servicenow` | Stands in for the ServiceNow change table |
| [Pull Qualys Findings](<Pull Qualys Findings/README.md>) | cron `*/15 * * * *`, route `/run/pull` | New or changed detections only |
| [Findings Webhook](<Findings Webhook/README.md>) | route `/webhook/qualys` | Pushed detections |
| [Normalize And Group](<Normalize And Group/README.md>) | linked, route `/run/normalize` | Canonical shape, ownership, grouping |
| [Prioritize](<Prioritize/README.md>) | linked, route `/run/prioritize` | Risk score, band, SLA, explanation |
| [Remediation Package (AI)](<Remediation Package (AI)/README.md>) | linked, route `/run/remediate` | The AI remediation package |
| [Sync ServiceNow Tickets](<Sync ServiceNow Tickets/README.md>) | linked, route `/run/sync` | One batched change per team |
| [Chase Overdue Tickets](<Chase Overdue Tickets/README.md>) | cron `0 * * * *`, route `/run/chase` | SLA escalation |
| [Remediation Report](<Remediation Report/README.md>) | cron `0 8 * * *`, route `/run/report` | Progress metrics and Markdown |

Flow: `Pull Qualys Findings` → `Normalize And Group` → `Prioritize` → `Remediation Package (AI)` →
`Sync ServiceNow Tickets`. `Findings Webhook` joins at `Normalize And Group`. `Chase Overdue Tickets`
and `Remediation Report` run on their own schedules over the shared volumes.

Every stage also carries its own route so a single stage can be re-run in isolation from the console.
`?only=1` on those routes records the result without emitting, so no downstream step fires.

#### Access

All routes are space-private except `/webhook/qualys`, which uses `external_id`: 3B mints an
unguessable ID that callers pass as the `external_id` query parameter, and it appears on the
workflow's Links page once published. On a draft branch every route — including the webhook — is
still restricted to members of this space.

#### Storage

Three named volumes, all SQLite with rollback journalling (a read-only mount cannot create a WAL
shared-memory file):

| Volume | Written by | Contents |
| --- | --- | --- |
| `qualys_state` | Mock Qualys API | The mocked detection table |
| `servicenow_store` | Mock ServiceNow API, Sync, Chase | Changes, work notes, SLA dates, closures |
| `pipeline_state` | every pipeline stage, Console API | Scoring weights, demo clock, seen fingerprints, per-stage run records, latest report |

In Live these are space-scoped, so the demo data persists across runs. A draft branch gets its own
isolated copies that are discarded with the draft.

#### Running the demo

Open `/` and use the header controls plus the six tabs.

1. **Reset demo** (header) reseeds the canonical seven Qualys findings, clears the change table, and
   sets the demo clock back to today.
2. **Seed history** (header) backfills three weeks of opened and closed changes so the report, MTTR
   and trend chart have data immediately.
3. **Findings** — show the seven detections, expand one to read the raw Qualys evidence, then inject a
   preset or edit a finding's severity, KEV flag or exposure.
4. **Pipeline** — press **Run full pipeline**. The stage strip fills in as the run progresses; the AI
   stage takes roughly 20 seconds. Expand any stage to read the exact JSON it emitted. **Simulate
   webhook push** demonstrates the push path.
5. **Prioritization** — walk the factor breakdown for the Windows KEV finding, then drag the KEV
   weight and watch every score move live. **Apply to pipeline** makes the change stick.
6. **Remediation** — the three high-priority findings show a Windows patch package with PowerShell
   commands, a third-party library upgrade, and a code-level SQL injection fix as a before/after diff.
   The thin-evidence finding shows the "cannot determine a fix" state.
7. **Tickets** — one change per owning team with its batched findings and work-note timeline.
   **Fast-forward** the clock five days, then **Run overdue chase** to watch SLAs breach and escalate.
8. **Report** — KPIs, opened-vs-closed trend, overdue by team and the recurring vulnerability classes,
   plus the raw Markdown the scheduled step emits.

#### Common changes

- **Scoring weights, bands and SLA days** — [`Prioritize/scoring.ts`](Prioritize/scoring.ts). Weights
  are also editable at runtime from the Prioritization tab; bands, SLA lengths and the high-priority
  threshold are code. A copy of this file lives in [`Console API`](<Console API/scoring.ts>) so the
  console can preview scores without running the pipeline — change both together.
- **Asset ownership** — [`Normalize And Group/asset-owners.json`](<Normalize And Group/asset-owners.json>),
  keyed by hostname, with a `fallback` entry for unattributed assets. A copy in
  [`Console API`](<Console API/asset-owners.json>) lets the console show owners before a run.
- **Sample findings** — [`Mock Qualys API/sample-findings.ts`](<Mock Qualys API/sample-findings.ts>).
- **Model, prompt and thresholds for the AI stage** —
  [`Remediation Package (AI)/system.md`](<Remediation Package (AI)/system.md>) for the instructions and
  the constants at the top of [`script.ts`](<Remediation Package (AI)/script.ts>) for the model,
  concurrency and per-run package cap.
- **Schedules** — the `cron` field in each step's `config.toml`.

#### Replacing the mocks with the real products

Both mocks are deliberately thin, and the swap points are single functions:

- **Qualys** — `Pull Qualys Findings` gets detections from `listDetections()` in
  [`qualys-db.ts`](<Pull Qualys Findings/qualys-db.ts>), which returns the same Qualys-VMDR-shaped
  records the mock route serves. Replace that call with an authenticated request to the Qualys
  Detection API, attach a Qualys connector to the step, and remove the `qualys_state` volume mount.
  Nothing downstream changes, because `Normalize And Group` already consumes the Qualys shape.
- **ServiceNow** — `Sync ServiceNow Tickets` and `Chase Overdue Tickets` call `createTicket`,
  `updateTicket`, `findOpenTicket` and `addWorkNote` in `snow-db.ts`. Replace those with ServiceNow
  Table API requests against `change_request`, attach a ServiceNow connector, and remove the
  `servicenow_store` mount. `Remediation Report` reads the same table and needs the same treatment.
- Delete the two mock steps and the demo controls that reset or seed them once both are real.

#### Tests

Pinned step tests cover the deterministic behaviour: ownership and grouping including the unowned
bucket, scoring a KEV internet-facing critical against a low internal finding, the change create and
update paths with seeded volume fixtures, SLA escalation including the already-chased-today skip, and
report metrics from a seeded change table. Each stage threads one reference timestamp through the run,
so the same input always produces the same output; the `tests/serialize` script in those steps gives
the volume comparison a stable view that ignores wall-clock bookkeeping columns.

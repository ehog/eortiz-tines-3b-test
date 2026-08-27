Two related SOC automations in one project, sharing state and a live demo console.

**A · Morning SOC Digest** — at 06:00 ET on weekdays, pulls the last 14 hours of activity from Sentinel, Defender, ServiceNow, Proofpoint and Zscaler, deduplicates and correlates it by user / host / indicator, has Claude write one prioritised digest (action items with a one-line "why this matters", counts-by-source table, auto-closed and suppressed tail), then emails it and posts it to Slack.

**B · After-Hours Escalation Gate** — receives alerts outside 07:00–19:00 ET, scores severity, detection confidence, asset criticality (mock ServiceNow CMDB lookup) and business impact against configurable weights, pages the on-call analyst only above the configurable threshold, auto-suppresses below the floor, and queues everything else for the morning digest. Every alert gets an audit row with its score breakdown and a plain-English reason.

**Demo console** — [SOC Console](<./SOC Console/README.md>) at `/soc-console` drives the whole thing live: scenario injector, threshold editor, demo clock override, decision audit, mock PagerDuty inbox, CMDB editor and digest preview. Its **Guided tour** button runs a narrated, click-along walkthrough of the whole demo, from the overnight problem to the 3B close.

#### Flow

```
                       ┌─ Alert Webhook (POST /alerts, external_id)
                       ├─ Test Alert Intake (POST /api/test-alert, console)
                       │
                       └─→ Score Alert ──(page only)──→ Page On-Call ──→ Slack + mock PagerDuty inbox
                                │
                                └─ defer / suppress → soc_state volume → morning digest

Collect Overnight Activity (cron 06:00 ET, or POST /api/run-digest)
   └─→ Correlate Overnight Activity
          └─→ Write Digest (Claude) ─┬─→ Email Digest (Gmail)
                                     └─→ Post Digest to Slack
```

#### Steps

| Step | Role |
| --- | --- |
| [Alert Webhook](<./Alert Webhook/README.md>) | External intake at `POST /alerts`, `external_id` auth |
| [Test Alert Intake](<./Test Alert Intake/README.md>) | Console intake and scenario packs at `POST /api/test-alert` |
| [Score Alert](<./Score Alert/README.md>) | Scoring, decision, audit record |
| [Page On-Call](<./Page On-Call/README.md>) | Mock PagerDuty event plus real Slack page notice |
| [Collect Overnight Activity](<./Collect Overnight Activity/README.md>) | Schedule gate and mocked source collection |
| [Correlate Overnight Activity](<./Correlate Overnight Activity/README.md>) | Normalise, dedupe, correlate |
| [Write Digest](<./Write Digest/README.md>) | Claude-written digest in Markdown, HTML and Slack form |
| [Email Digest](<./Email Digest/README.md>) | Sends the digest via Gmail |
| [Post Digest to Slack](<./Post Digest to Slack/README.md>) | Posts the digest to Slack |
| [Run Digest Now](<./Run Digest Now/README.md>) | Manual digest trigger for the console |
| [Console API](<./Console API/README.md>) | Console state and control actions |
| [SOC Console](<./SOC Console/README.md>) | The demo web app |

#### Real vs mocked

- **Real:** Slack (`Slack - For SEs`, channel `C0A8P2B0Y04`), Gmail (`eortiz@tines.io`), Claude (`Anthropic - SE demos`).
- **Mocked:** Sentinel, Defender, ServiceNow, Proofpoint and Zscaler collection lives in [Collect Overnight Activity/sources](<./Collect Overnight Activity/sources>) — one module per vendor, each with the real endpoint noted in a comment for swapping in a connector. PagerDuty paging is a mock event written to the console inbox by `pageOnCall` in `soclib.ts`. The critical-asset CMDB is the `critical_assets` table, editable in the console.

#### Shared state

Volume `soc_state` holds `soc.db` (SQLite): `config`, `demo_clock`, `critical_assets`, `alerts`, `gate_decisions`, `deferred_queue`, `paged_events`, `digests`, `timeline`. Writers mount it `concurrency=exclusive`; the collector mounts it read-only. `soclib.ts` — the shared library each step carries a copy of — owns the schema, defaults, scoring and paging so the gate and the console always agree.

Draft branches get their own volume contents; Live shares the space volume.

#### Access

- `/soc-console`, `/api/console`, `/api/test-alert` and `/api/run-digest` — space members only.
- `/alerts` — `external_id`; call it with the route's generated `external_id` query parameter. Draft access is still floored to space membership until published.

#### Operational notes

- The cron is `0 10,11 * * 1-5` (UTC) and the collector exits with no output unless it is 06:00 in America/New_York, so it fires exactly once a day across DST changes. Manual runs bypass that check.
- Scoring uses the alert's own `receivedAt` as the decision time, so decisions are deterministic and replaying an alert is idempotent — one audit row and one page per alert id.
- Nothing about the gate is hardcoded: thresholds, weights, factor score tables, coverage window, on-call details, Slack channel, email recipient, digest lookback and model all live in `config` and are editable in the console.

#### Common changes

- Replace a mocked source: edit its module under [Collect Overnight Activity/sources](<./Collect Overnight Activity/sources>) and attach that vendor's connector to the step.
- Change scoring shape: `scoreAlert` / `decideAlert` in `soclib.ts` — copy the edit into every step's `soclib.ts`.
- Change digest wording or layout: the prompt and builders in [Write Digest](<./Write Digest/script.ts>).
- Add a demo scenario: `SCENARIOS` in [Test Alert Intake/scenarios.ts](<./Test Alert Intake/scenarios.ts>), mirrored into [Console API/scenarios.ts](<./Console API/scenarios.ts>) so the console lists it.
- Change the guided tour narrative: `STEPS` in [SOC Console/Tour.tsx](<./SOC Console/Tour.tsx>). Each entry names the tab, the `data-tour` anchor, the headline, the two supporting lines, the action to prompt for and the state change that advances it.

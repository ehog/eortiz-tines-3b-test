Analyst-driven indicator hunt across Microsoft Defender, Microsoft Sentinel, Proofpoint and Zscaler, with a combined report per indicator, a ServiceNow record, and a human-approved block request to Zscaler and Defender.

All four search integrations, ServiceNow and the block enforcement calls are **mocked** for demo purposes. Slack is a real connector: the approval request is posted to `#eortiz`.

#### Flow

1. An analyst opens the console at `/ioc` ([IOC Hunt Console](<IOC Hunt Console/README.md>)), pastes indicators, adds a reason/reference, picks a demo mode, and submits.
2. [Submit hunt](<Submit hunt/README.md>) validates and classifies each indicator, records the hunt, and fans out to the four search steps in parallel.
3. [Search Defender](<Search Defender/README.md>), [Search Sentinel](<Search Sentinel/README.md>), [Search Proofpoint](<Search Proofpoint/README.md>) and [Search Zscaler](<Search Zscaler/README.md>) each write one row per indicator with status `hit`, `no_match` or `error`. A failing source exits 0 so the other three still complete.
4. [Combine report](<Combine report/README.md>) is a fan-in: it does nothing until all four sources have reported, then builds the combined report and marks the hunt complete.
5. [Create ServiceNow record](<Create ServiceNow record/README.md>) writes the findings JSON "attachment" and mints a mock INC number.
6. [Request block approval](<Request block approval/README.md>) posts to Slack `#eortiz` with Approve / Deny links when anything was found.
7. [Block decision](<Block decision/README.md>) records the human decision and, on approval, triggers [Submit block request](<Submit block request/README.md>) which performs the mocked Zscaler and Defender enforcement.

The report page polls [Report data](<Report data/README.md>) so searches, the ServiceNow record and the approval outcome all appear live. [Reset demo](<Reset demo/README.md>) clears hunt history between demos.

#### Routes

| Route | Type | Auth | Purpose |
| --- | --- | --- | --- |
| `/ioc` | webpage | space | Console: launcher and shareable report pages (`/ioc/h/<huntId>`) |
| `/ioc/api/hunt` | api | space | Start a hunt |
| `/ioc/api/report` | api | space | Hunt list and live single-hunt state |
| `/ioc/api/block-decision` | other | space | Approve / deny link target used by the Slack message |
| `/ioc/api/reset` | — | space | Clear demo history |

Every route is space-private, so only members of the `eortiz` space can open the console, the report links, or the Slack approval links. Approval identity comes from the `x-3b-authenticated-email` header 3B adds on those authenticated requests.

#### Storage

Named volume `iochunt`, SQLite at `/storage/iochunt/hunts.db` (tables `hunts`, `indicators`, `source_results`, `block_requests`) plus findings JSON under `/storage/iochunt/findings/`. Every writer mounts `iochunt:concurrency=exclusive`; `Report data` mounts `iochunt:ro`. Draft branches have their own isolated copy of the volume.

#### Demo modes

Chosen per hunt in the launcher and stored on the hunt row:

- `random` — each source independently hits, misses, or errors (~8%).
- `hits` — every source matches every indicator.
- `clean` — every source explicitly reports no matches.
- `error` — Microsoft Sentinel fails; the other three return hits. The failing source is `FORCED_ERROR_SOURCE` in each step's `lib.ts`.

#### Common changes

- Slack channel: `SLACK_CHANNEL` in [Request block approval/script.ts](<Request block approval/script.ts>).
- Mock data shapes and volume: the generator in each `Search */script.ts`.
- Shared schema, HTTP helpers, indicator classification and mock plumbing live in a copy of `lib.ts` in every TypeScript step; change one and copy it to the others.
- Replacing a mock with a real integration: attach the relevant connector to that search step and swap its generator for real API calls; the report, ServiceNow and approval steps need no changes.

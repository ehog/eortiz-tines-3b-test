The Data Operations Console: a single-page operator view of the pipeline.

**Route** — `GET /atlas`, space-authenticated (only members of this space can
open it).

It renders immediately and then fetches from this workflow's own routes:
[`/atlas/data`](<../Data API/script.ts>) for everything shown,
[`/atlas/run`](<../Run pipeline/script.ts>) to trigger a run,
[`/atlas/action`](../Actions/script.ts) for the two human decisions.

**Layout**

- Header — pipeline health (last run status, quality score and its delta,
  records published in the last 24 h, open quarantines) and the **Run pipeline** control
  with the chaos toggle exposed.
- Recent runs — a table of runs; selecting one expands its failure payload, AI
  triage note (with the *Approve remediation* button), per-step timeline and the
  structured log lines.
- Data quality — quality score over the scored runs, plus rejection reasons by
  category.
- Quarantine — open PHI findings with approve/withhold actions per finding.

**Request lifecycle** — one polling loop owns every refresh: it waits for each
request to settle before scheduling the next, polls every 3 s while a run is in
flight and every 15 s when idle, and cancels on unmount.

Files: [App.tsx](App.tsx) (page shell and data flow), [ui.tsx](ui.tsx)
(presentational pieces), [api.ts](api.ts) (types and fetch helpers),
[globals.css](globals.css) (design tokens — deep navy surfaces, one teal-to-blue
accent family, red reserved for genuine failures, amber for degraded). No remote
fonts or assets are loaded.

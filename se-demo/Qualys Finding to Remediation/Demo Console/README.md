The single-page app that drives the whole demo: inject findings, run the pipeline stage by stage, watch
changes appear, breach SLAs on demand, and read the progress report.

**Trigger** — the space-private webpage route `/qualys-remediation`. Every other route in the workflow
is a sibling of this one, so the page's own base path is also the prefix for its API calls; on a draft
branch that base path includes the branch prefix.

**Tabs**

- **Findings** — the mock Qualys detection table with severity, CVSS, KEV, owner, exposure and status.
  Rows expand to the raw Qualys `RESULTS` evidence, the software inventory and the vendor solution.
  Inject preset findings, edit severity/CVSS/KEV/exposure inline, or mark one remediated.
- **Pipeline** — the five-stage strip with per-stage status, record count and timing; the exact JSON any
  stage emitted; buttons to run the full pipeline, an incremental pull, a single stage in isolation, the
  overdue chase or the report; and a webhook push simulation.
- **Prioritization** — every finding's score with a factor-contribution bar and the plain-language
  explanation, plus weight sliders that re-score live against the last run and an apply button that
  changes what the pipeline uses.
- **Remediation** — the AI package per finding: required fix and version, copy-ready command blocks, a
  before/after code diff for code-level findings, prerequisites, reboot and service impact, validation
  steps, and the cited Qualys evidence. Undeterminable findings render as an explicit "cannot determine
  a fix" panel listing the missing evidence.
- **Tickets** — a change board grouped by owning team with SLA position, escalation count, the batched
  findings and the work-note timeline. Close a change, fast-forward the demo clock, or run the chase.
- **Report** — KPI tiles, an opened-versus-closed trend, recurring vulnerability classes, per-team and
  per-band breakdowns, the overdue list, and the raw Markdown the scheduled step emits.

The header always shows whether this is the draft or the live version and where the demo clock is
sitting, with **Guided tour** (see below), **Seed history** (backfill three weeks of changes) and
**Reset demo** (reseed findings, clear changes, reset the clock and weights).

**Guided tour** — **Guided tour** in the header starts a presenter-facing walkthrough that builds the
Demo2Win narrative: the before picture, the three peaks (one end-to-end run, the AI remediation package,
follow-up that keeps working after the ticket is filed), and a close on why the workflow holds up in
production. Each step navigates to its tab, highlights its target with a ring, and shows a callout
placed beside the target — the app is never dimmed and stays fully clickable, so the presenter can drive
it by hand mid-step. Every callout carries a collapsible "Why this matters" line, and action steps carry
a **do it for me** button that runs the real API call (inject a finding, run the pipeline, generate a
package, fast-forward and chase, seed history). Keyboard: → or Enter advances, ← goes back, Esc exits.

The narrative lives in [tour-script.ts](tour-script.ts) — edit the copy or reorder steps there. The
overlay engine, including the placement solver that keeps the callout off the highlighted element, is
[TourOverlay.tsx](TourOverlay.tsx). Targets are marked by the `anchorId` prop on `Card`, which renders a
`data-tour` attribute; a step whose anchor is missing falls back to a centered callout with no ring.

**Running the pipeline from the browser** — the run routes are invoked directly by the browser using
your session, rather than server-to-server, so no internal credential is needed. The pipeline itself is
asynchronous across steps, so the Pipeline tab polls console state until the sync stage reports the run
the pull started.

**Files** — [App.tsx](App.tsx) is the shell and routing, [api.ts](api.ts) holds every call and the
response types, [ui.tsx](ui.tsx) the shared primitives, and one file per tab. Styling is Tailwind over
the Tines palette defined as CSS variables in [globals.css](globals.css).

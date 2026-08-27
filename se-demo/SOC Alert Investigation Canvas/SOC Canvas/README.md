The analyst-facing app, served at `/` (space auth) and the thing you drive during a demo. One React step, three views via `BrowserRouter` with the branch-aware basename; it renders immediately and fetches everything from the route steps.

- **Launcher** `/` — three prebuilt scenarios with entity previews and a raw-payload toggle, an advanced panel for a pasted Sentinel or Defender payload, and the recent-investigation table. Launching generates the investigation id client-side, posts the payload to `/incident?id=...`, and navigates to the live run.
- **Live run** `/run/:id` — polls `/api/investigation` every 1.5s, animates intake → entities → five parallel enrichers → timeline → summary → ServiceNow with record counts and latency, streams the structured event log, offers per-source **retry**, **re-run** for the summary and ticket, and **Build timeline anyway** when a source is stuck. Auto-opens the canvas when the disposition lands, unless the guided tour is running and driving navigation itself.
- **Canvas** `/investigation/:id` — disposition banner with confidence and the AI summary, evidence claims that highlight their timeline events, the merged timeline with source and entity filters, the Proofpoint gallery with a keyboard-navigable lightbox, collapsible raw per-tool JSON, ServiceNow status, action history, and the **Isolate endpoint** control behind a two-click confirm that posts the approval token.

#### Guided tour

**Start guided tour** in the launcher header — or the pill on the other two views — runs a nine-stop Demo2Win narrative across all three views: it frames the problem, opens the Defender payload and fires it, waits on the real run to talk through parallel enrichment and the barrier, then walks the disposition, cited evidence, forensics and the gated isolate, which it executes, before a closing recap of what 3B did. It never auto-starts.

Stops live in [tourStops.ts](./tourStops.ts) — copy, spotlight selectors, the click each stop performs, and the run condition it waits for. The overlay in [Tour.tsx](./Tour.tsx) holds tour state above the router (persisted to `sessionStorage`, so a reload resumes), spotlights the union of its stop's selectors, and drives the app by clicking real controls found through `data-tour` attributes — the demo exercises the same code paths a person would. A stop whose target is missing just shows its card, so changing a view never breaks the app.

Scenario payloads live in [scenarios.ts](./scenarios.ts); shared fetchers and types in [api.ts](./api.ts); presentation primitives in [ui.tsx](./ui.tsx).

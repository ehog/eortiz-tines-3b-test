A demo-ready SOC investigation pipeline: a Microsoft Sentinel or Defender incident arrives on a webhook, five enrichment sources run in parallel, everything merges into one chronological timeline, Claude writes an analyst-facing disposition, ServiceNow gets a security incident, and an analyst drives it all from a single web app that also gates endpoint isolation behind explicit human approval.

Every integration except Claude is **mocked**. Each mocked step keeps the real request code beside the fixtures, so going live for one tool is: flip `USE_MOCK` in that step's `client.ts` and attach the connector.

#### Driving the demo

Open the workflow's root route — [SOC Canvas](<./SOC Canvas/README.md>) at `/`. Pick one of three scenarios (Defender-shaped endpoint malware, Sentinel-shaped phishing to suspicious sign-in, Sentinel-shaped proxy exfiltration), or paste your own payload, then watch the live run and land on the analyst canvas.

Or click **Start guided tour** and let the app drive: nine narrated stops that fire the Defender scenario, follow the real run, walk the canvas and execute the gated isolate, each pairing the SOC moment with the 3B capability behind it.

#### Flow

```
Receive incident  →  Extract entities  →  Enrich Defender ────┐
  (POST /incident)                        Enrich Sentinel     │
                                          Enrich Zscaler      ├→ Build timeline → Summarize → ServiceNow sync
                                          Enrich Proofpoint   │     (barrier)      (Claude)      (mock)
                                          Enrich Threat intel ┘
```

All five enrichers link to [Build timeline](<./Build timeline/README.md>), so it runs up to five times and exits with empty stdout — suppressing everything downstream — until the last source file exists.

#### Boundary inputs and outputs

| Route | Auth | Purpose |
| --- | --- | --- |
| `POST /incident?id=<optional>` | space | Incident intake webhook; accepts either vendor shape |
| `GET /` | space | The analyst app (launcher, live run, canvas) |
| `GET /api/investigation[?id=]` | space | Assembled investigation record, or the recent list |
| `GET /api/screenshot?id=&index=` | space | One Proofpoint forensic capture |
| `POST /api/enrich/{defender,sentinel,zscaler,proofpoint,threatintel}` | space | Re-run one enrichment |
| `POST /api/timeline` | space | Rebuild the timeline; `{"force": true}` ignores the barrier |
| `POST /api/summarize`, `POST /api/servicenow` | space | Re-run the AI summary or the ticket sync |
| `POST /api/isolate` | space | Isolate a device; requires `approved: true` plus the page-issued token |

Only members of the `eortiz` space can reach any of these. To let Sentinel or Defender post directly, change `route_auth` to `external_id` in [Receive incident/config.toml](<./Receive incident/config.toml>) and call the route with the minted id.

#### State

One named volume, `investigations`, with a directory per investigation id:

```
<id>/incident.json        normalized incident
<id>/entities.json        extracted entities
<id>/<source>.json        per-source result, timeline events and logs
<id>/screenshots/NNN.svg  Proofpoint captures (mocks are SVG; the live client writes PNG)
<id>/timeline.json        merged, sorted timeline
<id>/summary.json         Claude disposition and evidence
<id>/servicenow.json      ticket record and work note
<id>/actions.json         response actions taken by an analyst
```

Each writer owns its own file, so the volume is mounted writable without exclusive concurrency; the read-only routes mount `investigations:ro`. Draft branches keep their own copy of the volume, and Live shares one per space.

#### External services

- Anthropic (`claude-sonnet-5`) via connector — the only live call.
- Mocked, connector-ready: Microsoft Defender for Endpoint, Microsoft Sentinel (Log Analytics), Zscaler Internet Access, Proofpoint TAP, VirusTotal-style threat intel, ServiceNow `sn_si_incident`.

#### Side effects and safety

Nothing containment-related happens automatically. [Isolate endpoint](<./Isolate endpoint/README.md>) refuses a request without `approved: true`, a matching derived approval token, and a device that is genuinely an entity of the investigation, and it records every attempt in `actions.json` and the structured log.

#### Operational notes

- Every step logs one JSON line per external call to stderr: `{ts, investigationId, step, event, target, outcome, durationMs}`. The same records are mirrored into each source file and surfaced in the app.
- Enrichers, the summary and the ticket sync carry `retry_seconds`, so a transient failure retries the whole step.
- A permanently failing source blocks the barrier — volume writes only publish on success, so no error file lands. Use **retry** on that source or **Build timeline anyway** in the live run view.
- Two enrichers finishing in the same instant could both satisfy the barrier and build the timeline twice; downstream steps overwrite their outputs, so the result is the same.

#### Common changes

- Add a scenario: [SOC Canvas/scenarios.ts](<./SOC Canvas/scenarios.ts>).
- Change the guided-tour narrative: [SOC Canvas/tourStops.ts](<./SOC Canvas/tourStops.ts>).
- Change what a tool returns: that step's `mock.ts`.
- Go live for a tool: `USE_MOCK = false` in its `client.ts`, then attach the connector to that step.
- Change the disposition prompt or model: [Summarize/script.ts](./Summarize/script.ts).

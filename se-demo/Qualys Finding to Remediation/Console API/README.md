Read/write API behind the [Demo Console](<../Demo Console/README.md>) for everything that lives in
pipeline state.

**Trigger** — `GET`/`POST` on the space-private route `/qualys-remediation/api/console`. See
[api.json](api.json) for the full contract.

**Reads**

- default view: branch (draft or live), the demo clock, current and default scoring weights, bands, SLA
  lengths, the high-priority threshold, the latest status of all seven stages, and recent stage runs
- `view=stage&stage=<name>`: the exact JSON that stage last emitted
- `view=findings`: the enriched findings from the latest run, with scores and remediation packages
- `view=report`: the Markdown and metrics the report step last stored
- `view=owners`: the asset-owner map, so the console can show ownership before a run

**Writes**

- `set_weights` / `reset_weights` — change the weights [Prioritize](../Prioritize/README.md) uses
- `set_clock` / `advance_clock` — move the demo clock, which is how SLAs are breached on demand
- `clear_seen` — forget detection fingerprints so the next pull re-emits everything
- `reset_pipeline_state` — clear stage history, fingerprints and the stored report
- `score_preview` — re-score the last run's findings with candidate weights and return the full factor
  breakdown without writing anything, which is what the Prioritization sliders call

Findings and changes are not proxied here: the browser reads those directly from the mock Qualys and
ServiceNow routes, which keeps this step's responsibilities to pipeline state alone.

**Storage** — `pipeline_state` exclusive. [scoring.ts](scoring.ts) and
[asset-owners.json](asset-owners.json) are copies of the originals in
[Prioritize](../Prioritize/scoring.ts) and [Normalize And Group](<../Normalize And Group/asset-owners.json>)
and must be kept in step with them.

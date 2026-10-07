The DS AI Governance Console — the branded single-page app demoed on the call.

**Trigger:** `GET /ds-console` (route auth: space members).

Four tabs in [App.tsx](App.tsx), fed by [Governance API](<../Governance API/script.ts>) through the helpers in [data.ts](data.ts):

- **Overview** — KPI tiles (submissions today, auto-approved, blocked, pending, average time to decision, bypass attempts), a 14-day stacked disposition chart, breakdowns by team, region, source tool, and model, plus raised security events.
- **Review Queue** — pending submissions with risk score and origin; a row opens a drawer with the annotated artifact, every finding (severity, rule id, evidence line), the model-policy verdict, credential references, and the decision form. Decisions POST to `/ds-decision` and the view reloads.
- **Model Policy** — the read-only per-team / per-region allowed-model matrix and the sanctioned repo, pipeline, and runner inventories.
- **Audit Log** — filterable, CSV-exportable ledger of every recorded decision.

Design follows the Dentsply Sirona palette (navy `#002E5D`, teal `#00A3C7`, greys `#F5F7F9` / `#D9E1E8` / `#4A5A67`) with semantic green, amber, and red.

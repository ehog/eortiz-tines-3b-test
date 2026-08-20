The single-pane control tower for the CISO.

**Route:** `GET /ai-governance` — space members only. Fetches [Governance data API](<../Governance data API/script.ts>) at `/ai-governance/data` on load and every 60s (one refresh loop, never overlapping), and posts decisions to [Governance actions](<../Governance actions/script.ts>).

**Sections:** hero KPI strip → fleet table + status heatmap (row opens a detail drawer with run history, credentials, egress, AI provenance, findings and audit trail) → spillage alerts with approve/reject on each proposed fix → shadow AI panel with the live allow/block list and its change history → governance kanban with a visually distinct fast-track lane → ROI (stacked hours-saved chart, run-rate by team, duplicate builds) → trust footer.

**Cross-filtering:** clicking a team, severity, status, classification, model or chart band filters the entire page. All filter state lives in the URL (`?team=…&severity=…&build=…&days=…`), so any view is shareable. `Esc` clears.

**Honesty about data:** source coverage below 100% is stated in the hero, the partial current day is excluded from ROI totals, and both the spillage and duplication sections say what they cannot see.

**Files:** [App.tsx](App.tsx) is the shell; state, URL filters and the fetch loop are in [ui/state.ts](ui/state.ts); shared primitives and the palette in [ui/kit.tsx](ui/kit.tsx); one file per section under `ui/`. Brand tokens (near-black canvas, magenta/violet accents, Archivo display + IBM Plex) are in [globals.css](globals.css).

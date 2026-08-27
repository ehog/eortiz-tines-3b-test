The demo UI at `GET /containment` (space-only, pinned on the Links page). Renders immediately and reads everything from the API routes — it is never downstream of a data step.

Panels:

- **Launch containment** — alert id (regenerable), endpoint, user, severity; posts to [Start Run](<../Start Run/README.md>).
- **Chaos mode** — the five forced-failure toggles with `fail N then succeed` or `fail always`, plus presets (clean run, transient recovery, Zscaler timeout, permanent reject, partial containment).
- **Stage timeline** — the five stages with live/replayed state: pending, in flight, retrying (with the backoff wait), succeeded, retries exhausted, permanent failure, blocked by guardrail, or skipped because it already completed. Follow-up ServiceNow flag actions appear as an extra card.
- **Guardrail banner, system state cards** — ticket number and state, isolation state, contained, safe to retry, idempotency key in effect.
- **Resume panel** — shows which stages will be skipped before firing [Retry Run](<../Retry Run/README.md>); resume with chaos off or with the current panel settings. Opening the page with `?resume=<runId>` (the link in the Slack alert) selects that run.
- **Structured log** and **audit trail** — filterable log lines and expandable audit rows from [Runs API](<../Runs API/README.md>).
- **Guided tour** — the **Guided tour** button in the header opens a spotlight overlay ([tour.tsx](./tour.tsx)) that walks a Demo2Win-shaped script: an agenda card, two short setup stops, then three proof peaks — transient recovery, the guardrail refusal (posed as a cliffhanger before it runs), and the idempotent resume — closing on a recap of the log and audit trail. Every stop carries what you are about to see, a "Look here" pointer at the spotlighted element, an analyst-level and a business-level payoff, and one line on the 3B primitive behind it.

  Three stops drive the real backend: they apply a chaos preset and launch, or resume with chaos off, exactly as clicking the panels would, then hold on that stop until the run finishes. Nothing is faked. The resume peak is skipped when no run is resumable. Anchors are `data-tour` attributes in [App.tsx](./App.tsx) and [components.tsx](./components.tsx); tour state is in memory only, so the tour never appears unasked. `Esc` closes it, arrow keys move between stops, and the app stays clickable through the overlay.

While a run is executing the page polls every 1.2s. Because a step publishes its volume writes when it finishes, intermediate stage state is not visible mid-run; once the run completes the console replays the recorded attempt timeline at 1x, 4x or instantly, using the real recorded timings. **Reset demo** calls [Demo Reset](<../Demo Reset/README.md>).

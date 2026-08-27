The patching web app: browse findings, act on them, review decision history.

**Trigger** — HTTP `GET /console`, `route_auth = "space"`, rendered server-side as a single-page React app (Tailwind, no router).

**Behavior** — renders immediately, then fetches [`/api/patching`](<../Patch data/README.md>) on mount and every 30 seconds. Two views:

- **Findings** — grouped by severity, with search over device and package name and filters for status and severity. Each row offers **Patch now** and **Postpone**, both behind a confirmation dialog that states the real-world effect. Confirming POSTs to [`/api/decide`](<../Record decision/README.md>), updates the row optimistically, shows a toast, and reverts on failure.
- **History** — decision timeline (who decided, from Slack or the app), findings-by-severity bars, and a patched/postponed breakdown per day.

**Guided tour** — the header **Tour** button opens an 8-stop demo overlay ([`Tour.tsx`](./Tour.tsx)): dimmed backdrop, spotlight ring on the highlighted element, and a card with a "So what" value line per stop. Stops are anchored by `data-tour` attributes in [`App.tsx`](./App.tsx) (`metrics`, `filters`, `findings-table`, `row-actions`, `view-switcher`, `history-charts`); a stop whose anchor is missing falls back to a centered card, so the narrative still runs on empty data. The tour switches views as needed and restores the original view on close. Navigation: Next/Back, dots, arrow keys, Esc. It never triggers a decision. Reword it in `TOUR_STEPS`.

**Paths** — API URLs are derived from `window.__ROUTE_PATH__` so the app works on a draft branch and in Live without hardcoding a host.

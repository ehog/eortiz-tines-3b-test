React single-page console served at `/ioc` (space members only). Renders immediately and fetches everything from the API routes, so it has no upstream data step.

- `/` — hunt launcher. Indicators are classified live as you type (badges per type, warning for unrecognized lines), plus a reason/reference field, quick-fill sample IOC sets, a demo-mode selector, and a recent-hunts list that refreshes every 4s.
- `/h/:huntId` — shareable live report. Polls `/ioc/api/report` every 1.5s while searches run and every 3s while an approval is outstanding, then stops. Shows the FOUND / all-clear banner, source health, per-indicator cards with tabs (devices, users, email messages, network connections, proxy activity, alerts and incidents), the ServiceNow panel with downloadable findings JSON, and the block-request panel.

`Reset demo` in the header clears hunt history via `/ioc/api/reset`.

Routing uses `BrowserRouter` with `basename={window.__ROUTE_PATH__}`, which `render.ts` sets to the branch-aware base path, so report links work on drafts and in Live.

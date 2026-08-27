React single-page console served at `/ioc` (space members only). Renders immediately and fetches everything from the API routes, so it has no upstream data step.

- `/` — hunt launcher. Indicators are classified live as you type (badges per type, warning for unrecognized lines), plus a reason/reference field, quick-fill sample IOC sets, a demo-mode selector, and a recent-hunts list that refreshes every 4s.
- `/h/:huntId` — shareable live report. Polls `/ioc/api/report` every 1.5s while searches run and every 3s while an approval is outstanding, then stops. Shows the FOUND / all-clear banner, source health, per-indicator cards with tabs (devices, users, email messages, network connections, proxy activity, alerts and incidents), the ServiceNow panel with downloadable findings JSON, and the block-request panel.

`Reset demo` in the header clears hunt history via `/ioc/api/reset`.

#### Guided demo tour

[tour.tsx](tour.tsx) holds a self-contained spotlight overlay (no extra dependencies) plus the narrative content in two arrays, `LAUNCHER_TOUR` and `REPORT_TOUR`. Each page has its own **Take the tour** button; tours never auto-open and nothing is persisted.

- Every stop follows Tell → Show → Tell: headline, what you're looking at, and a highlighted "So what" value line. The first launcher stop states the outcome up front and the last report stop is the recap.
- Stops attach to elements by `data-tour="…"` attributes in [App.tsx](App.tsx). A stop with no `anchor` renders centered.
- The page is never dimmed. The target gets a red ring and glow, and `placeCard` positions the card in free space below, above, or beside the target so it never covers it — falling back to the roomier corner only when no side clears. Card height is measured with a `ResizeObserver` because it decides which side fits, and a target taller than half the viewport is scrolled to its top so a side stays free.
- The overlay is `pointer-events-none` apart from the card, so the highlighted control stays clickable and the rest of the app keeps working — that is how the launcher tour hands off to the real **Hunt** button.
- `onEnter` drives the form through callbacks `Launcher` publishes with `register()` (apply the sample set, add and remove a deliberately invalid line, select force-hits mode). `Report` publishes booleans the same way, and a stop's `available()` skips it when that data is absent — so a clean hunt shows no approval stops.

To change the narrative, edit the two arrays; to move a spotlight, move the `data-tour` attribute.

Routing uses `BrowserRouter` with `basename={window.__ROUTE_PATH__}`, which `render.ts` sets to the branch-aware base path, so report links work on drafts and in Live.

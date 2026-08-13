The demo UI, served at `/asset-portal` (space auth) as a React page — see [App.tsx](App.tsx).

Two views behind one toggle:

- **Employee** — assets Onyx has blocked, with a business-justification form that `POST`s to [Request access](<../Request access/README.md>), plus the requester's in-review and approved assets.
- **Admin** — the Jira review queue with Allow / Deny buttons that `POST` a transition to [Jira mock API](<../Jira mock API/README.md>), and a table of the whole Onyx inventory.

Data comes from `GET /onyx/api` and `GET /jira/api?resource=search`, fetched in the browser with the visitor's own session; the page has no upstream step so it renders immediately. After an Allow or Deny it re-reads state twice with a short delay so the asynchronous webhook → sync chain has time to land. When the page is opened on a draft branch it forwards the `branch` query parameter on every request.

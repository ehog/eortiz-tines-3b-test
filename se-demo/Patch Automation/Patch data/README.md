Read-only JSON API behind the patch console.

**Trigger** — HTTP `GET /api/patching`, `route_auth = "space"` (members of the workflow's space; browser session, 3B API key, or OAuth token).

**Behavior** — opens `/storage/patching/state.db` read-only and returns everything the console renders in one document: every current finding, the 200 most recent decisions, and rollups (`totals`, `by_severity`, `by_status`, `by_day`) plus the last discovery run. If the database does not exist yet — no scan has run on this branch — it returns the same shape with empty collections rather than failing.

**Volume** — `patching:ro`. Written by [Find vulnerable packages](<../Find vulnerable packages/README.md>), [Handle patch decision](<../Handle patch decision/README.md>) and [Record decision](<../Record decision/README.md>). Schema lives in [state.ts](./state.ts); the response contract is in [api.json](./api.json).

**No downstream links** — this step only answers requests.

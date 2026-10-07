The human approval gate. Backs the Approve / Reject / Request changes buttons in the console.

**Trigger:** `POST /ds-decision` (route auth: space members).

Body: `submission_id`, `decision` (`approve | reject | request-changes`), `reviewer`, and a non-empty `comment`. The comment is mandatory — a decision without a recorded rationale is rejected with `422`. Deciding an already-decided submission returns `409`.

Updates the ledger row, appends a `review.<decision>` audit record with the elapsed decision time, then hands the rehydrated submission to [Deploy to Production](<../Deploy to Production/script.ts>), which promotes only on approval. Contract in [api.json](api.json).

Logs `event=review.decided …`.

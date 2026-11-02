The employee-facing endpoint: `POST /request-access` (space auth), called by the [Asset portal](<../Asset portal/README.md>) form. Contract in [api.json](api.json).

Body: `{ "assetId": "AST-1004", "businessJustification": "…" }`. The requester is taken from the spoof-proof `x-3b-authenticated-email` header when present, otherwise from `requester` in the body.

It creates a mock Jira approval issue (shared helper [jira.ts](jira.ts), the same one the [Jira mock API](<../Jira mock API/README.md>) uses), stores the issue key on the asset, and moves the asset to `pending_review`. Guards: unknown asset → 404, already `allowed` → 409, justification under 10 characters → 400, request already open → 200 with the existing issue key.

Writes `/storage/mock_state/mock.db`. Logic in [script.ts](script.ts).

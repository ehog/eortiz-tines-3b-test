Handles the "a new AI asset was discovered" event. Two ways in:

- Linked from [Onyx mock API](<../Onyx mock API/README.md>) — drains unprocessed `asset.created` rows from the `events` table.
- `POST /onyx/asset-created` (`external_id` auth) — where a real Onyx tenant would send its discovery webhook. The body may be the asset itself or `{ "asset": { … } }`.

It writes an `asset.discovered` audit row per asset and emits `{"blocked": [asset, …]}` for [Notify blocked user](<../Notify blocked user/README.md>). Assets that are not `blocked` produce no output, so the chain stops there.

Reads and writes `/storage/mock_state/mock.db`. Logic in [script.ts](script.ts).

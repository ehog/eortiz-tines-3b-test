`GET /ioc/api/report` (space auth), read-only on the `iochunt` volume. Backs all polling in the console.

- No `hunt` parameter: the 25 most recent hunts with status, indicator counts, search progress and ServiceNow number.
- `?hunt=<huntId>`: live state for one hunt — the hunt row, its indicators, per-source state (`searching`, `matched`, `clean`, `incomplete` with the reason), search progress, the combined report once available, the ServiceNow record, and the block request with its decision and mocked enforcement results.

Returns `{ "hunts": [] }` or `{ "found": false }` before the database exists.

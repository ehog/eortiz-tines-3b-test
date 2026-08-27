Linked from all five enrichment steps, so it executes once per source. It is the barrier: while any of the five source files is missing it logs `timeline_waiting` and exits with empty stdout, which suppresses `Summarize` and everything after it.

Also routed at `POST /api/timeline`. Passing `{"investigationId": "...", "force": true}` builds the timeline from whatever has landed — the escape hatch when one source is permanently failing.

Merges the alert itself and every source event into one array sorted by timestamp, each carrying a stable id and source label, and writes `<id>/timeline.json`.

`tests/serialize` masks `builtAt` so pinned step tests compare volume state deterministically.

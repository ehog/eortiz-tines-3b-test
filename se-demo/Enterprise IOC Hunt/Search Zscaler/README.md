Mocked Zscaler NSS proxy logs search. Triggered by [Submit hunt](<../Submit hunt/script.ts>) in parallel with the other three search steps.

Reads `huntId` from the upstream HTTP response body, waits 1900ms so the live report page fills in one source at a time, then writes one `source_results` row per indicator:

- `hit` — generated findings: proxy transactions with user, device, URL, action, category, threat name and bytes, plus first seen, last seen and a frequency count.
- `no_match` — searched, nothing found.
- `error` — the search did not complete; the reason is stored and the step still exits 0 so the other sources are unaffected.

Which outcome applies comes from the hunt's demo mode (see the workflow [README](../README.md)). Findings are seeded from a deterministic PRNG over the indicator, source and hunt creation time, and every timestamp is derived from the hunt's creation time, so forced modes are reproducible.

Shared plumbing is in [search.ts](search.ts) and [lib.ts](lib.ts). Emits a small per-indicator status summary to [Combine report](<../Combine report/script.ts>).

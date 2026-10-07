Scheduled scan (weekdays 13:00 UTC) that correlates Automox CVE-bearing packages against device inventories.

Calls `GET /api/orgs/{org}/packages`, `GET /api/servers`, and `GET /api/servers/{id}/packages` on `console.automox.com` (Automox connector; org ID is the `ORG_ID` constant). Packages whose `severity` is `no_known_cves` are ignored.

Output: `{ organization_id, total_matches, items: [{ device_id, device_name, package_id, package_name, severity }] }`, capped at `MAX_ALERTS` (5) — the equivalent of the story's Implode/Explode top-5 limiter. Emits nothing when there are no matches, which stops the run.

State: upserts **every** match into the `findings` table in the `patching` volume (`/storage/patching/state.db`, schema in [state.ts](./state.ts)) and records the run in `runs`. Findings Automox no longer reports are deleted, so a patched package disappears from the console on the next scan. Existing findings keep their `first_seen` and decision `status`. The volume is mounted `concurrency=exclusive` because the decision routes update the same rows. The Slack alert cap only limits what is emitted downstream — the console shows all findings.
